import { storage } from "../storage";
import { openaiService } from "./openai.js";
import { geminiService } from "./gemini.js";
import { type InsertLlmVerification } from "@shared/schema";
import { RetryManager } from "./retry-manager";
import { circuitBreakerManager } from "./circuit-breaker";
import { verificationCache, type ForecastVerificationContext } from "./verification-cache";
import { verificationFallbackService, type FallbackVerificationResult } from "./verification-fallback";
import { llmHealthMonitor } from "./llm-health-monitor";
import crypto from 'crypto';

interface VerificationResult {
  provider: string;
  model: string;
  confidence: number;
  verified: boolean;
  response: string;
  metadata: any;
  cacheHit?: boolean;
  similarity?: number;
  fallbackUsed?: boolean;
  retryAttempts?: number;
  circuitBreakerUsed?: boolean;
}

interface HardenedVerificationResult {
  verifications: any[];
  summary: {
    totalProviders: number;
    successfulProviders: number;
    failedProviders: number;
    cacheHitRate: number;
    fallbacksUsed: number;
    averageConfidence: number;
    verificationStatus: 'success' | 'partial' | 'fallback' | 'failed';
    providersUsed: string[];
  };
  healthStatus: {
    openai: string;
    gemini: string;
    overall: string;
  };
  performance: {
    totalDuration: number;
    cachePerformance: any;
    retryMetrics: any;
  };
  warnings: string[];
}

interface VietnameseMarketContext {
  commodityType: 'rice' | 'coffee' | 'pepper' | 'cashew' | 'other';
  region: 'mekong_delta' | 'central_highlands' | 'red_river_delta' | 'north_central' | 'other';
  seasonalFactors: {
    currentMonth: number;
    harvestSeason: boolean;
    plantingSeason: boolean;
    exportSeason: boolean;
    weatherRisk: 'low' | 'medium' | 'high';
  };
  marketFactors: {
    governmentInterventionRisk: boolean;
    exportDemand: 'low' | 'medium' | 'high';
    currencyVolatility: 'low' | 'medium' | 'high';
    internationalPriceCorrelation: boolean;
  };
  riskFactors: string[];
}

class LlmVerificationService {
  private requestId: string;
  
  constructor() {
    this.requestId = this.generateRequestId();
  }

  private generateRequestId(): string {
    return `llm_verify_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Enhanced forecast verification with full hardening
   */
  async verifyForecast(forecastId: string, coopId: string = 'default-coop-id', userId: string = 'system', role: string = 'system'): Promise<HardenedVerificationResult> {
    const startTime = Date.now();
    this.requestId = this.generateRequestId();
    
    console.log(`[LLMVerification:${this.requestId}] Starting hardened verification for forecast ${forecastId}`);
    
    try {
      const forecast = await storage.getForecast(forecastId);
      if (!forecast) {
        throw new Error("Forecast not found");
      }

      // Prepare verification context with Vietnamese market insights
      const verificationContext = this.prepareVerificationContext(forecast);
      const vietnameseContext = this.buildVietnameseMarketContext(forecast);
      const enhancedContext = this.enhanceContextWithVietnameseMarket(verificationContext, vietnameseContext);
      
      console.log(`[LLMVerification:${this.requestId}] Context prepared for ${vietnameseContext.commodityType} in ${vietnameseContext.region}`);
      
      // Check system health before proceeding
      const systemHealth = await circuitBreakerManager.getSystemHealth();
      console.log(`[LLMVerification:${this.requestId}] System health: ${systemHealth.overall} (${systemHealth.availableProviders.length}/${systemHealth.providers.length} providers available)`);
      
      // Perform verification with all hardening features
      const verificationResults = await this.performHardenedVerification(
        forecastId,
        verificationContext,
        enhancedContext,
        vietnameseContext,
        coopId
      );
      
      // Calculate performance metrics and report to health monitor
      const totalDuration = Date.now() - startTime;
      const cachePerformance = verificationCache.getStats();
      
      // Record verification metrics for monitoring
      llmHealthMonitor.recordVerificationMetrics(
        totalDuration,
        verificationResults.summary.verificationStatus === 'success',
        verificationResults.summary.fallbacksUsed,
        verificationResults.summary.cacheHitRate > 0,
        verificationResults.summary.providersUsed || []
      );
      
      console.log(`[LLMVerification:${this.requestId}] Completed in ${totalDuration}ms with ${verificationResults.verifications.length} verifications`);
      
      return {
        verifications: verificationResults.verifications,
        summary: verificationResults.summary,
        healthStatus: {
          openai: systemHealth.providers.find(p => p.provider === 'openai')?.circuitState || 'unknown',
          gemini: systemHealth.providers.find(p => p.provider === 'gemini')?.circuitState || 'unknown',
          overall: systemHealth.overall
        },
        performance: {
          totalDuration,
          cachePerformance,
          retryMetrics: verificationResults.retryMetrics
        },
        warnings: verificationResults.warnings
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[LLMVerification:${this.requestId}] Critical error:`, errorMessage);
      
      // Emergency fallback
      const fallbackResult = await this.emergencyFallback(forecastId, error, coopId);
      
      // Record failure metrics for monitoring
      const totalDuration = Date.now() - startTime;
      llmHealthMonitor.recordVerificationMetrics(
        totalDuration,
        false, // Emergency fallback indicates failure
        1, // One fallback used
        false, // No cache hit during emergency
        [] // No successful providers
      );
      
      return {
        verifications: [fallbackResult],
        summary: {
          totalProviders: 2,
          successfulProviders: 0,
          failedProviders: 2,
          cacheHitRate: 0,
          fallbacksUsed: 1,
          averageConfidence: fallbackResult.confidence,
          verificationStatus: 'fallback'
        },
        healthStatus: {
          openai: 'error',
          gemini: 'error',
          overall: 'unhealthy'
        },
        performance: {
          totalDuration: Date.now() - startTime,
          cachePerformance: verificationCache.getStats(),
          retryMetrics: {}
        },
        warnings: ['Emergency fallback used', 'All LLM providers failed', error.message]
      };
    }
  }

  /**
   * Perform hardened verification with all providers
   */
  private async performHardenedVerification(
    forecastId: string,
    verificationContext: ForecastVerificationContext,
    enhancedContext: string,
    vietnameseContext: VietnameseMarketContext,
    coopId: string
  ): Promise<{
    verifications: any[];
    summary: HardenedVerificationResult['summary'];
    retryMetrics: any;
    warnings: string[];
  }> {
    const startTime = Date.now();
    const verifications: any[] = [];
    const warnings: string[] = [];
    let cacheHits = 0;
    let fallbacksUsed = 0;
    const retryMetrics: any = {};

    console.log(`[LLMVerification:${this.requestId}] Starting parallel provider verification`);
    
    // Execute both providers concurrently with independent error handling
    const [openaiResult, geminiResult] = await Promise.allSettled([
      this.verifyWithOpenAI(verificationContext, enhancedContext),
      this.verifyWithGemini(verificationContext, enhancedContext)
    ]);

    // Process OpenAI result
    if (openaiResult.status === 'fulfilled') {
      const result = openaiResult.value;
      if (result.cacheHit) cacheHits++;
      if (result.fallbackUsed) fallbacksUsed++;
      retryMetrics.openai = result.metadata.retryMetrics;
      
      const storedVerification = await this.storeVerification(forecastId, result);
      verifications.push(storedVerification);
    } else {
      console.error(`[LLMVerification:${this.requestId}] OpenAI verification failed:`, openaiResult.reason);
      warnings.push(`OpenAI verification failed: ${openaiResult.reason}`);
      
      // Use statistical fallback for OpenAI failure
      const fallback = await this.createFallbackVerification(forecastId, 'openai', openaiResult.reason, coopId);
      verifications.push(fallback);
      fallbacksUsed++;
    }

    // Process Gemini result
    if (geminiResult.status === 'fulfilled') {
      const result = geminiResult.value;
      if (result.cacheHit) cacheHits++;
      if (result.fallbackUsed) fallbacksUsed++;
      retryMetrics.gemini = result.metadata.retryMetrics;
      
      const storedVerification = await this.storeVerification(forecastId, result);
      verifications.push(storedVerification);
    } else {
      console.error(`[LLMVerification:${this.requestId}] Gemini verification failed:`, geminiResult.reason);
      warnings.push(`Gemini verification failed: ${geminiResult.reason}`);
      
      // Use statistical fallback for Gemini failure
      const fallback = await this.createFallbackVerification(forecastId, 'gemini', geminiResult.reason, coopId);
      verifications.push(fallback);
      fallbacksUsed++;
    }

    // If all providers failed, use comprehensive statistical fallback
    if (verifications.length === 0 || verifications.every(v => v.fallbackUsed)) {
      console.log(`[LLMVerification:${this.requestId}] All providers failed, using comprehensive fallback`);
      const comprehensiveFallback = await verificationFallbackService.performFallbackVerification(
        forecastId,
        verificationContext,
        'All LLM providers unavailable'
      );
      
      const fallbackVerification = await this.createFallbackVerificationFromStatistical(
        forecastId,
        comprehensiveFallback,
        coopId
      );
      verifications.push(fallbackVerification);
      fallbacksUsed++;
      warnings.push('Comprehensive statistical fallback used');
    }

    // Calculate summary statistics
    const successfulProviders = verifications.filter(v => v.verified && !v.fallbackUsed).length;
    const totalProviders = 2; // OpenAI and Gemini
    const cacheHitRate = verifications.length > 0 ? (cacheHits / verifications.length) * 100 : 0;
    const averageConfidence = verifications.length > 0 
      ? verifications.reduce((sum, v) => sum + parseFloat(v.confidence), 0) / verifications.length 
      : 0;

    // Determine verification status
    let verificationStatus: HardenedVerificationResult['summary']['verificationStatus'];
    if (successfulProviders === totalProviders) {
      verificationStatus = 'success';
    } else if (successfulProviders > 0) {
      verificationStatus = 'partial';
    } else if (fallbacksUsed > 0) {
      verificationStatus = 'fallback';
    } else {
      verificationStatus = 'failed';
    }

    // Add Vietnamese market context warnings
    const marketWarnings = this.generateVietnameseMarketWarnings(vietnameseContext, verifications);
    warnings.push(...marketWarnings);

    // Extract provider names that were used
    const providersUsed = verifications.map(v => v.provider).filter(p => p && !p.includes('fallback'));
    
    return {
      verifications,
      summary: {
        totalProviders,
        successfulProviders,
        failedProviders: totalProviders - successfulProviders,
        cacheHitRate,
        fallbacksUsed,
        averageConfidence,
        verificationStatus,
        providersUsed
      },
      retryMetrics,
      warnings
    };
  }

  /**
   * Prepare verification context for caching and LLM calls
   */
  private prepareVerificationContext(forecast: any): ForecastVerificationContext {
    const predictions = Array.isArray(forecast.predictions) ? forecast.predictions : [];
    const metrics = forecast.metrics || {};
    
    return {
      commodityId: forecast.commodityId,
      regionId: forecast.regionId,
      predictions,
      metrics,
      method: forecast.method || 'unknown',
      horizon: forecast.horizon || 30,
      modelVersion: forecast.modelVersion || 'v1.0',
      additionalContext: {
        forecastId: forecast.id,
        createdAt: forecast.createdAt,
        requestId: this.requestId
      }
    };
  }

  /**
   * Build Vietnamese market context for enhanced verification
   */
  private buildVietnameseMarketContext(forecast: any): VietnameseMarketContext {
    const currentMonth = new Date().getMonth() + 1;
    
    // Map commodity and region to Vietnamese market categories
    const commodityType = this.mapToVietnameseCommodity(forecast.commodityId);
    const region = this.mapToVietnameseRegion(forecast.regionId);
    
    // Determine seasonal factors
    const seasonalFactors = this.getSeasonalFactors(commodityType, currentMonth);
    
    // Assess market factors
    const marketFactors = this.getMarketFactors(commodityType, region, currentMonth);
    
    // Identify risk factors
    const riskFactors = this.identifyRiskFactors(commodityType, region, currentMonth, forecast);
    
    return {
      commodityType,
      region,
      seasonalFactors,
      marketFactors,
      riskFactors
    };
  }

  /**
   * Enhance context with Vietnamese agricultural market insights
   */
  private enhanceContextWithVietnameseMarket(
    verificationContext: ForecastVerificationContext,
    vietnameseContext: VietnameseMarketContext
  ): string {
    const predictions = verificationContext.predictions;
    const metrics = verificationContext.metrics;
    
    const contextString = `
    Vietnamese Agricultural Commodity Forecast Verification
    
    === BASIC FORECAST INFORMATION ===
    - Commodity: ${verificationContext.commodityId} (${vietnameseContext.commodityType})
    - Region: ${verificationContext.regionId} (${vietnameseContext.region})
    - Method: ${verificationContext.method}
    - Horizon: ${verificationContext.horizon} days
    - Model Version: ${verificationContext.modelVersion}
    
    === PRICE PREDICTIONS ===
    - Start Price: $${predictions[0]?.median?.toFixed(2) || 'N/A'}
    - End Price: $${predictions[predictions.length - 1]?.median?.toFixed(2) || 'N/A'}
    - Price Change: ${predictions.length > 1 ? (((predictions[predictions.length - 1]?.median - predictions[0]?.median) / predictions[0]?.median * 100)?.toFixed(1) || 'N/A') + '%' : 'N/A'}
    - Average Confidence: ${predictions.length > 0 ? (predictions.reduce((sum: number, p: any) => sum + p.confidence, 0) / predictions.length).toFixed(3) : 'N/A'}
    - Prediction Count: ${predictions.length}
    
    === STATISTICAL QUALITY METRICS ===
    - MASE (Mean Absolute Scaled Error): ${metrics.mase?.toFixed(3) || 'N/A'}
    - SMAPE (Symmetric Mean Absolute Percentage Error): ${metrics.smape?.toFixed(1) || 'N/A'}%
    - PICP (Prediction Interval Coverage Probability): ${metrics.picp?.toFixed(3) || 'N/A'}
    - FQS (Forecast Quality Score): ${metrics.fqs?.toFixed(2) || 'N/A'}
    
    === VIETNAMESE MARKET CONTEXT ===
    Current Month: ${vietnameseContext.seasonalFactors.currentMonth} (${new Date().toLocaleString('default', { month: 'long' })})
    
    Seasonal Factors:
    - Harvest Season: ${vietnameseContext.seasonalFactors.harvestSeason ? 'Yes' : 'No'}
    - Planting Season: ${vietnameseContext.seasonalFactors.plantingSeason ? 'Yes' : 'No'}
    - Export Season: ${vietnameseContext.seasonalFactors.exportSeason ? 'Yes' : 'No'}
    - Weather Risk Level: ${vietnameseContext.seasonalFactors.weatherRisk}
    
    Market Factors:
    - Government Intervention Risk: ${vietnameseContext.marketFactors.governmentInterventionRisk ? 'High' : 'Low'}
    - Export Demand: ${vietnameseContext.marketFactors.exportDemand}
    - VND Currency Volatility: ${vietnameseContext.marketFactors.currencyVolatility}
    - International Price Correlation: ${vietnameseContext.marketFactors.internationalPriceCorrelation ? 'Yes' : 'No'}
    
    Risk Factors: ${vietnameseContext.riskFactors.join(', ') || 'None identified'}
    
    === VERIFICATION INSTRUCTIONS ===
    As an expert in Vietnamese agricultural markets, please analyze this forecast considering:
    
    1. STATISTICAL SOUNDNESS: Are the MASE, SMAPE, and PICP metrics reasonable for ${vietnameseContext.commodityType} forecasting?
    2. VIETNAMESE SEASONAL PATTERNS: Does the forecast align with typical seasonal behavior for ${vietnameseContext.commodityType} in ${vietnameseContext.region}?
    3. MARKET FUNDAMENTALS: Are the price movements consistent with current Vietnamese agricultural market conditions?
    4. VOLATILITY ASSESSMENT: Is the predicted volatility reasonable given Vietnamese commodity market characteristics?
    5. RISK FACTOR ANALYSIS: Has the forecast adequately considered the identified risk factors?
    
    Provide your analysis in JSON format with:
    {
      "verified": boolean,
      "confidence": number (0.0 to 1.0),
      "analysis": "detailed assessment focusing on Vietnamese market context",
      "vietnamese_market_factors": {
        "seasonal_alignment": "assessment of seasonal pattern alignment",
        "market_logic": "evaluation of market fundamental consistency",
        "risk_assessment": "analysis of identified risk factors",
        "volatility_assessment": "evaluation of volatility reasonableness"
      },
      "recommendations": ["specific recommendations for forecast improvement"],
      "warnings": ["any concerns or warnings"]
    }
    `;
    
    return contextString;
  }

  /**
   * Enhanced OpenAI verification with all hardening features
   */
  private async verifyWithOpenAI(
    verificationContext: ForecastVerificationContext,
    enhancedContext: string
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cached = await verificationCache.get(verificationContext, 'openai');
      if (cached && cached.cacheHit) {
        console.log(`[LLMVerification:${this.requestId}] OpenAI cache hit${cached.similarity ? ` (similarity: ${(cached.similarity * 100).toFixed(1)}%)` : ''}`);
        return {
          ...cached.result,
          cacheHit: true,
          similarity: cached.similarity,
          metadata: {
            ...cached.result.metadata,
            cacheHit: true,
            responseTime: Date.now() - startTime
          }
        };
      }
      
      console.log(`[LLMVerification:${this.requestId}] OpenAI cache miss, calling API`);
      
      // Create retry manager for this request
      const retryManager = new RetryManager(this.requestId);
      
      // Execute with circuit breaker and retry logic
      const retryResult = await circuitBreakerManager.execute(
        'openai',
        () => retryManager.executeWithRetry(
          'openai',
          'verifyForecast',
          () => openaiService.verifyForecast(enhancedContext)
        ),
        () => this.getFallbackVerification('openai', 'Circuit breaker fallback'),
        'forecast_verification'
      );
      
      let result: VerificationResult;
      
      if (retryResult.success && retryResult.result) {
        const apiResult = retryResult.result;
        result = {
          provider: "openai",
          model: "gpt-5",
          confidence: apiResult.confidence,
          verified: apiResult.verified,
          response: apiResult.analysis,
          retryAttempts: retryResult.attempts.length,
          metadata: {
            temperature: 0.2,
            tokens: apiResult.tokens || 0,
            responseTime: Date.now() - startTime,
            retryMetrics: retryManager.getRetryMetrics(retryResult),
            requestId: this.requestId
          }
        };
        
        // Cache successful result
        await verificationCache.set(verificationContext, 'openai', result);
        console.log(`[LLMVerification:${this.requestId}] OpenAI verification successful (${retryResult.attempts.length} attempts)`);
        
      } else {
        // Handle retry exhaustion
        console.log(`[LLMVerification:${this.requestId}] OpenAI verification failed after ${retryResult.attempts.length} attempts`);
        result = {
          provider: "openai",
          model: "gpt-5",
          confidence: 0,
          verified: false,
          response: `Verification failed: ${retryResult.finalError?.message || 'Unknown error'}`,
          retryAttempts: retryResult.attempts.length,
          circuitBreakerUsed: true,
          metadata: {
            error: retryResult.finalError?.message,
            exhausted: retryResult.exhausted,
            retryMetrics: retryManager.getRetryMetrics(retryResult),
            responseTime: Date.now() - startTime,
            requestId: this.requestId
          }
        };
      }
      
      return result;
      
    } catch (error) {
      console.error(`[LLMVerification:${this.requestId}] OpenAI verification critical error:`, error);
      return {
        provider: "openai",
        model: "gpt-5",
        confidence: 0,
        verified: false,
        response: "Critical verification failure",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          responseTime: Date.now() - startTime,
          requestId: this.requestId
        }
      };
    }
  }

  /**
   * Enhanced Gemini verification with all hardening features
   */
  private async verifyWithGemini(
    verificationContext: ForecastVerificationContext,
    enhancedContext: string
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cached = await verificationCache.get(verificationContext, 'gemini');
      if (cached && cached.cacheHit) {
        console.log(`[LLMVerification:${this.requestId}] Gemini cache hit${cached.similarity ? ` (similarity: ${(cached.similarity * 100).toFixed(1)}%)` : ''}`);
        return {
          ...cached.result,
          cacheHit: true,
          similarity: cached.similarity,
          metadata: {
            ...cached.result.metadata,
            cacheHit: true,
            responseTime: Date.now() - startTime
          }
        };
      }
      
      console.log(`[LLMVerification:${this.requestId}] Gemini cache miss, calling API`);
      
      // Create retry manager for this request
      const retryManager = new RetryManager(this.requestId);
      
      // Execute with circuit breaker and retry logic
      const retryResult = await circuitBreakerManager.execute(
        'gemini',
        () => retryManager.executeWithRetry(
          'gemini',
          'verifyForecast',
          () => geminiService.verifyForecast(enhancedContext)
        ),
        () => this.getFallbackVerification('gemini', 'Circuit breaker fallback'),
        'forecast_verification'
      );
      
      let result: VerificationResult;
      
      if (retryResult.success && retryResult.result) {
        const apiResult = retryResult.result;
        result = {
          provider: "gemini",
          model: "gemini-2.5-pro",
          confidence: apiResult.confidence,
          verified: apiResult.verified,
          response: apiResult.analysis,
          retryAttempts: retryResult.attempts.length,
          metadata: {
            temperature: 0.1,
            tokens: apiResult.tokens || 0,
            responseTime: Date.now() - startTime,
            retryMetrics: retryManager.getRetryMetrics(retryResult),
            requestId: this.requestId
          }
        };
        
        // Cache successful result
        await verificationCache.set(verificationContext, 'gemini', result);
        console.log(`[LLMVerification:${this.requestId}] Gemini verification successful (${retryResult.attempts.length} attempts)`);
        
      } else {
        // Handle retry exhaustion
        console.log(`[LLMVerification:${this.requestId}] Gemini verification failed after ${retryResult.attempts.length} attempts`);
        result = {
          provider: "gemini",
          model: "gemini-2.5-pro",
          confidence: 0,
          verified: false,
          response: `Verification failed: ${retryResult.finalError?.message || 'Unknown error'}`,
          retryAttempts: retryResult.attempts.length,
          circuitBreakerUsed: true,
          metadata: {
            error: retryResult.finalError?.message,
            exhausted: retryResult.exhausted,
            retryMetrics: retryManager.getRetryMetrics(retryResult),
            responseTime: Date.now() - startTime,
            requestId: this.requestId
          }
        };
      }
      
      return result;
      
    } catch (error) {
      console.error(`[LLMVerification:${this.requestId}] Gemini verification critical error:`, error);
      return {
        provider: "gemini",
        model: "gemini-2.5-pro",
        confidence: 0,
        verified: false,
        response: "Critical verification failure",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          responseTime: Date.now() - startTime,
          requestId: this.requestId
        }
      };
    }
  }

  /**
   * Vietnamese market mapping functions
   */
  private mapToVietnameseCommodity(commodityId: string): VietnameseMarketContext['commodityType'] {
    const mappings: Record<string, VietnameseMarketContext['commodityType']> = {
      'rice': 'rice',
      'coffee': 'coffee', 
      'pepper': 'pepper',
      'cashew': 'cashew'
    };
    return mappings[commodityId.toLowerCase()] || 'other';
  }

  private mapToVietnameseRegion(regionId: string): VietnameseMarketContext['region'] {
    const mappings: Record<string, VietnameseMarketContext['region']> = {
      'mekong': 'mekong_delta',
      'delta': 'mekong_delta',
      'central': 'central_highlands',
      'highlands': 'central_highlands',
      'north': 'red_river_delta',
      'red_river': 'red_river_delta'
    };
    
    const region = Object.keys(mappings).find(key => 
      regionId.toLowerCase().includes(key)
    );
    
    return region ? mappings[region] : 'other';
  }

  private getSeasonalFactors(commodityType: string, month: number): VietnameseMarketContext['seasonalFactors'] {
    // Vietnamese agricultural calendar
    const seasonalData: Record<string, any> = {
      rice: {
        harvestMonths: [5, 6, 7, 10, 11],
        plantingMonths: [1, 2, 7, 8],
        exportMonths: [10, 11, 12, 1, 2],
        weatherRiskMonths: [6, 7, 8, 9] // Monsoon season
      },
      coffee: {
        harvestMonths: [10, 11, 12],
        plantingMonths: [4, 5],
        exportMonths: [11, 12, 1, 2, 3, 4],
        weatherRiskMonths: [5, 6, 7, 8, 9]
      },
      pepper: {
        harvestMonths: [10, 11, 12],
        plantingMonths: [4, 5, 6],
        exportMonths: [1, 2, 3, 4, 5],
        weatherRiskMonths: [6, 7, 8, 9]
      }
    };

    const data = seasonalData[commodityType] || seasonalData['rice']; // Default to rice

    return {
      currentMonth: month,
      harvestSeason: data.harvestMonths.includes(month),
      plantingSeason: data.plantingMonths.includes(month),
      exportSeason: data.exportMonths.includes(month),
      weatherRisk: data.weatherRiskMonths.includes(month) ? 'high' : 'low'
    };
  }

  private getMarketFactors(
    commodityType: string, 
    region: string, 
    month: number
  ): VietnameseMarketContext['marketFactors'] {
    // Government intervention patterns
    const governmentIntervention = commodityType === 'rice' && month >= 5 && month <= 7; // Harvest support
    
    // Export demand patterns
    const exportDemand = this.calculateExportDemand(commodityType, month);
    
    // Currency volatility (higher during export seasons)
    const currencyVolatility = exportDemand === 'high' ? 'high' : 'medium';
    
    // International price correlation
    const internationalCorrelation = ['coffee', 'pepper'].includes(commodityType);

    return {
      governmentInterventionRisk: governmentIntervention,
      exportDemand,
      currencyVolatility,
      internationalPriceCorrelation: internationalCorrelation
    };
  }

  private calculateExportDemand(commodityType: string, month: number): 'low' | 'medium' | 'high' {
    const exportSeasons: Record<string, number[]> = {
      rice: [10, 11, 12, 1, 2],
      coffee: [11, 12, 1, 2, 3, 4],
      pepper: [1, 2, 3, 4, 5]
    };

    const isExportSeason = exportSeasons[commodityType]?.includes(month);
    return isExportSeason ? 'high' : 'medium';
  }

  private identifyRiskFactors(
    commodityType: string,
    region: string,
    month: number,
    forecast: any
  ): string[] {
    const risks: string[] = [];

    // Weather risks
    if ([6, 7, 8, 9].includes(month)) {
      risks.push('Monsoon season weather volatility');
    }

    // Market timing risks
    const seasonalFactors = this.getSeasonalFactors(commodityType, month);
    if (seasonalFactors.harvestSeason) {
      risks.push('Harvest season price pressure');
    }

    // Currency risks during export seasons
    if (seasonalFactors.exportSeason) {
      risks.push('VND exchange rate volatility');
    }

    // Government policy risks
    if (commodityType === 'rice') {
      risks.push('Government intervention in rice market');
    }

    // Quality risks by region
    if (region === 'central_highlands' && commodityType === 'coffee') {
      risks.push('Quality premium/discount variation');
    }

    // Long-term forecast risks
    if (forecast.horizon > 30) {
      risks.push('Extended forecast horizon reduces accuracy');
    }

    return risks;
  }

  private generateVietnameseMarketWarnings(
    vietnameseContext: VietnameseMarketContext,
    verifications: any[]
  ): string[] {
    const warnings: string[] = [];

    // High risk season warnings
    if (vietnameseContext.seasonalFactors.weatherRisk === 'high') {
      warnings.push(`High weather risk season for ${vietnameseContext.commodityType} - increased forecast uncertainty expected`);
    }

    // Government intervention warnings
    if (vietnameseContext.marketFactors.governmentInterventionRisk) {
      warnings.push('Government intervention possible - market dynamics may not follow typical patterns');
    }

    // Export season volatility warnings
    if (vietnameseContext.seasonalFactors.exportSeason && vietnameseContext.marketFactors.currencyVolatility === 'high') {
      warnings.push('Export season with high VND volatility - currency effects may impact price forecasts');
    }

    // Low confidence warnings
    const averageConfidence = verifications.length > 0 
      ? verifications.reduce((sum, v) => sum + parseFloat(v.confidence), 0) / verifications.length 
      : 0;
    
    if (averageConfidence < 0.5) {
      warnings.push(`Low verification confidence (${(averageConfidence * 100).toFixed(1)}%) - recommend manual review`);
    }

    return warnings;
  }

  /**
   * Fallback and emergency methods
   */
  private async getFallbackVerification(provider: string, reason: string): Promise<VerificationResult> {
    return {
      provider,
      model: provider === 'openai' ? 'gpt-5' : 'gemini-2.5-pro',
      confidence: 0.3, // Low confidence for fallback
      verified: false,
      response: `Fallback verification: ${reason}`,
      fallbackUsed: true,
      metadata: {
        fallback: true,
        reason,
        timestamp: Date.now()
      }
    };
  }

  private async createFallbackVerification(
    forecastId: string,
    provider: string,
    reason: any,
    coopId: string
  ): Promise<any> {
    const fallbackResult = await verificationFallbackService.performFallbackVerification(
      forecastId,
      {},
      `Provider ${provider} failed: ${reason}`
    );

    const verificationData: InsertLlmVerification = {
      forecastId,
      provider: `${provider}_fallback`,
      model: 'statistical_fallback',
      prompt: 'Statistical fallback verification',
      response: fallbackResult.analysis,
      confidence: fallbackResult.confidence.toString(),
      verified: fallbackResult.verified,
      metadata: {
        fallback: true,
        method: fallbackResult.method,
        score: fallbackResult.score,
        originalProvider: provider,
        reason: reason.toString()
      }
    };

    return await storage.createVerification({ coopId, userId, role }, verificationData);
  }

  private async createFallbackVerificationFromStatistical(
    forecastId: string,
    fallbackResult: FallbackVerificationResult,
    coopId: string
  ): Promise<any> {
    const verificationData: InsertLlmVerification = {
      forecastId,
      provider: fallbackResult.provider,
      model: 'statistical_fallback',
      prompt: 'Comprehensive statistical verification',
      response: fallbackResult.analysis,
      confidence: fallbackResult.confidence.toString(),
      verified: fallbackResult.verified,
      metadata: {
        fallback: true,
        method: fallbackResult.method,
        score: fallbackResult.score,
        factors: fallbackResult.factors,
        warnings: fallbackResult.warnings
      }
    };

    return await storage.createVerification({ coopId, userId, role }, verificationData);
  }

  private async emergencyFallback(forecastId: string, error: any, coopId: string): Promise<any> {
    try {
      const fallbackResult = await verificationFallbackService.performFallbackVerification(
        forecastId,
        {},
        `Emergency fallback: ${error.message}`
      );

      return await this.createFallbackVerificationFromStatistical(forecastId, fallbackResult);
    } catch (fallbackError) {
      console.error(`[LLMVerification:${this.requestId}] Emergency fallback failed:`, fallbackError);
      
      // Last resort minimal verification
      const verificationData: InsertLlmVerification = {
        forecastId,
        provider: 'emergency_fallback',
        model: 'minimal',
        prompt: 'Emergency minimal verification',
        response: `Emergency verification failed. Original error: ${error.message}. Fallback error: ${fallbackError.message}`,
        confidence: '0.1',
        verified: false,
        metadata: {
          emergency: true,
          originalError: error.message,
          fallbackError: fallbackError.message,
          timestamp: Date.now()
        }
      };

      return await storage.createVerification({ coopId, userId, role }, verificationData);
    }
  }

  private async storeVerification(forecastId: string, result: VerificationResult): Promise<any> {
    const verificationData: InsertLlmVerification = {
      forecastId,
      provider: result.provider,
      model: result.model,
      prompt: "Enhanced Vietnamese agricultural forecast verification",
      response: result.response,
      confidence: result.confidence.toString(),
      verified: result.verified,
      metadata: {
        ...result.metadata,
        cacheHit: result.cacheHit || false,
        similarity: result.similarity,
        fallbackUsed: result.fallbackUsed || false,
        retryAttempts: result.retryAttempts || 0,
        circuitBreakerUsed: result.circuitBreakerUsed || false
      }
    };

    return await storage.createVerification({ coopId, userId, role }, verificationData);
  }

  /**
   * Calculate composite confidence score with enhanced weighting
   */
  calculateCompositeConfidenceScore(verifications: any[]): number {
    if (verifications.length === 0) return 0;
    
    const validVerifications = verifications.filter(v => v.verified);
    if (validVerifications.length === 0) return 0;
    
    // Enhanced weights considering hardening features
    const weights = { 
      openai: 0.55,       // Slightly lower due to hardening redundancy
      gemini: 0.35,       // Slightly lower due to hardening redundancy
      statistical_fallback: 0.1  // Lower weight for fallback methods
    };
    
    let totalWeight = 0;
    let weightedSum = 0;
    
    validVerifications.forEach(v => {
      const baseWeight = weights[v.provider as keyof typeof weights] || 0.5;
      
      // Adjust weight based on hardening features
      let adjustedWeight = baseWeight;
      
      // Reduce weight for fallback verifications
      if (v.metadata?.fallback) {
        adjustedWeight *= 0.7;
      }
      
      // Increase weight for cache hits (previously verified similar content)
      if (v.metadata?.cacheHit && v.metadata?.similarity > 0.9) {
        adjustedWeight *= 1.1;
      }
      
      // Reduce weight for high retry attempts (unstable service)
      if (v.metadata?.retryAttempts > 2) {
        adjustedWeight *= 0.9;
      }
      
      const confidence = parseFloat(v.confidence);
      weightedSum += confidence * adjustedWeight;
      totalWeight += adjustedWeight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
}

export const llmVerificationService = new LlmVerificationService();