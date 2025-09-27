// Vietnamese Agricultural Market Verification Fallback Service
// Provides statistical validation when LLM services are unavailable

import { storage } from "../storage";
import type { ForecastMetrics } from "@shared/schema";

// Fallback verification result
interface FallbackVerificationResult {
  verified: boolean;
  confidence: number;           // 0.0 - 1.0
  analysis: string;
  method: 'statistical' | 'historical' | 'market_patterns' | 'minimal';
  score: number;               // 0-100 composite score
  factors: FallbackValidationFactors;
  warnings: string[];
  provider: 'statistical_fallback';
  metadata: any;
}

// Validation factors breakdown
interface FallbackValidationFactors {
  statisticalSoundness: number;    // 0-100: MASE, SMAPE, PICP analysis
  historicalConsistency: number;   // 0-100: Alignment with historical patterns
  seasonalAlignment: number;       // 0-100: Vietnamese agricultural calendar alignment
  marketFundamentals: number;      // 0-100: Basic market logic validation
  volatilityReasonableness: number; // 0-100: Volatility within expected bounds
  trendConsistency: number;        // 0-100: Trend direction consistency
}

// Vietnamese agricultural market patterns
interface VietnameseMarketPatterns {
  commodity: string;
  region: string;
  seasonalPatterns: {
    month: number;              // 1-12
    expectedVolatility: number; // Expected volatility %
    trendBias: 'bullish' | 'bearish' | 'neutral';
    marketEvents: string[];     // Seasonal market events
  }[];
  historicalVolatilityRange: { min: number; max: number };
  typicalPriceChangeRange: { min: number; max: number }; // % per month
  governmentInterventionLikely: boolean;
  exportSeasonality: boolean;
}

// Market-specific thresholds
interface MarketValidationThresholds {
  commodity: string;
  maseThreshold: number;      // Above this is concerning
  smapeThreshold: number;     // Above this is concerning
  picpMinimum: number;        // Below this is concerning
  maxMonthlyVolatility: number; // % change per month
  maxDailyVolatility: number;   // % change per day
}

class VerificationFallbackService {
  private vietnameseMarketPatterns: Map<string, VietnameseMarketPatterns> = new Map();
  private validationThresholds: Map<string, MarketValidationThresholds> = new Map();
  
  constructor() {
    this.initializeVietnameseMarketPatterns();
    this.initializeValidationThresholds();
    console.log('[FallbackVerification] Initialized Vietnamese agricultural market patterns');
  }

  /**
   * Main fallback verification when LLM services are unavailable
   */
  async performFallbackVerification(
    forecastId: string,
    context: any,
    reason: string = 'LLM services unavailable'
  ): Promise<FallbackVerificationResult> {
    console.log(`[FallbackVerification] Starting fallback verification for forecast ${forecastId}`);
    console.log(`[FallbackVerification] Reason: ${reason}`);

    try {
      // Get forecast data
      const forecast = await storage.getForecast(forecastId);
      if (!forecast) {
        return this.createMinimalFallbackResult('Forecast not found', reason);
      }

      // Determine verification method based on available data
      const verificationMethod = this.selectVerificationMethod(forecast);
      console.log(`[FallbackVerification] Using ${verificationMethod} method`);

      switch (verificationMethod) {
        case 'statistical':
          return await this.performStatisticalValidation(forecast);
        case 'historical':
          return await this.performHistoricalValidation(forecast);
        case 'market_patterns':
          return await this.performMarketPatternValidation(forecast);
        default:
          return this.createMinimalFallbackResult('Limited validation performed', reason);
      }

    } catch (error) {
      console.error('[FallbackVerification] Error in fallback verification:', error);
      return this.createMinimalFallbackResult('Fallback verification failed', reason, error);
    }
  }

  /**
   * Statistical validation based on forecast metrics
   */
  private async performStatisticalValidation(forecast: any): Promise<FallbackVerificationResult> {
    const metrics = forecast.metrics || {};
    const predictions = Array.isArray(forecast.predictions) ? forecast.predictions : [];
    const thresholds = this.validationThresholds.get(forecast.commodityId);
    
    const factors: FallbackValidationFactors = {
      statisticalSoundness: this.evaluateStatisticalSoundness(metrics, thresholds),
      historicalConsistency: await this.evaluateHistoricalConsistency(forecast),
      seasonalAlignment: this.evaluateSeasonalAlignment(forecast),
      marketFundamentals: this.evaluateMarketFundamentals(forecast),
      volatilityReasonableness: this.evaluateVolatilityReasonableness(predictions, forecast.commodityId),
      trendConsistency: this.evaluateTrendConsistency(predictions)
    };

    const compositeScore = this.calculateCompositeScore(factors);
    const verified = compositeScore >= 60; // 60% threshold for statistical verification
    const confidence = Math.min(0.8, compositeScore / 100); // Cap at 80% for fallback

    const analysis = this.generateStatisticalAnalysis(factors, metrics, forecast);
    const warnings = this.generateWarnings(factors, forecast);

    return {
      verified,
      confidence,
      analysis,
      method: 'statistical',
      score: compositeScore,
      factors,
      warnings,
      provider: 'statistical_fallback',
      metadata: {
        metrics,
        thresholds: thresholds || 'default',
        predictionsCount: predictions.length,
        commodityId: forecast.commodityId,
        regionId: forecast.regionId
      }
    };
  }

  /**
   * Historical pattern validation
   */
  private async performHistoricalValidation(forecast: any): Promise<FallbackVerificationResult> {
    console.log('[FallbackVerification] Performing historical pattern validation');
    
    // Get historical data for comparison
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 2); // 2 years of history
    
    const historicalData = await storage.getPricesVerified(
      forecast.commodityId,
      forecast.regionId,
      startDate,
      endDate
    );

    const factors: FallbackValidationFactors = {
      statisticalSoundness: this.evaluateStatisticalSoundness(forecast.metrics || {}),
      historicalConsistency: this.evaluateHistoricalPriceConsistency(forecast, historicalData),
      seasonalAlignment: this.evaluateSeasonalAlignment(forecast),
      marketFundamentals: this.evaluateMarketFundamentals(forecast),
      volatilityReasonableness: this.evaluateHistoricalVolatilityAlignment(forecast, historicalData),
      trendConsistency: this.evaluateTrendConsistency(forecast.predictions || [])
    };

    const compositeScore = this.calculateCompositeScore(factors);
    const verified = compositeScore >= 55; // Lower threshold for historical validation
    const confidence = Math.min(0.7, compositeScore / 100); // Cap at 70% for historical fallback

    const analysis = this.generateHistoricalAnalysis(factors, historicalData, forecast);
    const warnings = this.generateWarnings(factors, forecast);

    return {
      verified,
      confidence,
      analysis,
      method: 'historical',
      score: compositeScore,
      factors,
      warnings,
      provider: 'statistical_fallback',
      metadata: {
        historicalDataPoints: historicalData.length,
        historicalPeriod: '24 months',
        commodityId: forecast.commodityId,
        regionId: forecast.regionId
      }
    };
  }

  /**
   * Vietnamese market pattern validation
   */
  private async performMarketPatternValidation(forecast: any): Promise<FallbackVerificationResult> {
    const marketPatterns = this.vietnameseMarketPatterns.get(forecast.commodityId);
    const currentMonth = new Date().getMonth() + 1;
    
    const factors: FallbackValidationFactors = {
      statisticalSoundness: this.evaluateStatisticalSoundness(forecast.metrics || {}),
      historicalConsistency: await this.evaluateHistoricalConsistency(forecast),
      seasonalAlignment: this.evaluateVietnameseSeasonalAlignment(forecast, marketPatterns, currentMonth),
      marketFundamentals: this.evaluateVietnameseMarketFundamentals(forecast, marketPatterns),
      volatilityReasonableness: this.evaluateVolatilityAgainstVietnamesePatterns(forecast, marketPatterns),
      trendConsistency: this.evaluateVietnameseTrendLogic(forecast, marketPatterns, currentMonth)
    };

    const compositeScore = this.calculateCompositeScore(factors, 'vietnamese_patterns');
    const verified = compositeScore >= 50; // Lower threshold but more market-aware
    const confidence = Math.min(0.65, compositeScore / 100); // Cap at 65% for pattern fallback

    const analysis = this.generateVietnameseMarketAnalysis(factors, marketPatterns, forecast, currentMonth);
    const warnings = this.generateVietnameseMarketWarnings(factors, forecast, marketPatterns);

    return {
      verified,
      confidence,
      analysis,
      method: 'market_patterns',
      score: compositeScore,
      factors,
      warnings,
      provider: 'statistical_fallback',
      metadata: {
        marketPatterns: marketPatterns?.commodity || 'unknown',
        currentMonth,
        seasonalBias: marketPatterns?.seasonalPatterns?.[currentMonth - 1]?.trendBias || 'neutral',
        commodityId: forecast.commodityId,
        regionId: forecast.regionId
      }
    };
  }

  /**
   * Evaluation methods for validation factors
   */
  private evaluateStatisticalSoundness(
    metrics: any,
    thresholds?: MarketValidationThresholds
  ): number {
    const mase = metrics.mase || 1.0;
    const smape = metrics.smape || 100;
    const picp = metrics.picp || 0.5;
    
    const maseThreshold = thresholds?.maseThreshold || 1.0;
    const smapeThreshold = thresholds?.smapeThreshold || 25;
    const picpMinimum = thresholds?.picpMinimum || 0.8;
    
    let score = 0;
    
    // MASE evaluation (40% weight) - Lower is better
    if (mase <= 0.8) score += 40;
    else if (mase <= maseThreshold) score += 30;
    else if (mase <= maseThreshold * 1.5) score += 15;
    
    // SMAPE evaluation (35% weight) - Lower is better  
    if (smape <= 10) score += 35;
    else if (smape <= smapeThreshold) score += 25;
    else if (smape <= smapeThreshold * 1.5) score += 10;
    
    // PICP evaluation (25% weight) - Higher is better
    if (picp >= 0.9) score += 25;
    else if (picp >= picpMinimum) score += 18;
    else if (picp >= 0.7) score += 10;
    
    return Math.min(100, score);
  }

  private async evaluateHistoricalConsistency(forecast: any): Promise<number> {
    // Simplified historical consistency check
    // In a full implementation, this would compare against actual historical forecasts
    
    const predictions = forecast.predictions || [];
    if (predictions.length === 0) return 30; // Minimal score for no predictions
    
    // Check for reasonable price progression
    let consistencyScore = 50; // Base score
    
    // Check for extreme jumps
    for (let i = 1; i < predictions.length; i++) {
      const prevPrice = predictions[i - 1].median;
      const currPrice = predictions[i].median;
      const change = Math.abs((currPrice - prevPrice) / prevPrice);
      
      if (change > 0.1) { // More than 10% daily change
        consistencyScore -= 5;
      }
    }
    
    // Bonus for reasonable volatility patterns
    if (predictions.every(p => p.confidence >= 0.3)) {
      consistencyScore += 10;
    }
    
    return Math.max(0, Math.min(100, consistencyScore));
  }

  private evaluateSeasonalAlignment(forecast: any): number {
    const currentMonth = new Date().getMonth() + 1;
    const marketPatterns = this.vietnameseMarketPatterns.get(forecast.commodityId);
    
    if (!marketPatterns) return 50; // Neutral score when no patterns available
    
    const seasonalPattern = marketPatterns.seasonalPatterns.find(
      p => p.month === currentMonth
    );
    
    if (!seasonalPattern) return 50;
    
    // Extract trend from predictions
    const predictions = forecast.predictions || [];
    if (predictions.length < 2) return 50;
    
    const startPrice = predictions[0].median;
    const endPrice = predictions[predictions.length - 1].median;
    const trendDirection = endPrice > startPrice ? 'bullish' : (endPrice < startPrice ? 'bearish' : 'neutral');
    
    // Score based on seasonal alignment
    if (seasonalPattern.trendBias === trendDirection) return 80;
    if (seasonalPattern.trendBias === 'neutral' || trendDirection === 'neutral') return 65;
    return 30; // Counter-seasonal trend
  }

  private evaluateMarketFundamentals(forecast: any): number {
    // Basic market logic validation
    let score = 50; // Base score
    
    const predictions = forecast.predictions || [];
    if (predictions.length === 0) return 30;
    
    // Check for reasonable confidence intervals
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    if (avgConfidence >= 0.6) score += 15;
    else if (avgConfidence >= 0.4) score += 10;
    else score -= 10;
    
    // Check for reasonable prediction intervals
    const avgIntervalWidth = predictions.reduce((sum, p) => {
      const width = (p.q90 - p.q10) / p.median;
      return sum + width;
    }, 0) / predictions.length;
    
    if (avgIntervalWidth >= 0.1 && avgIntervalWidth <= 0.4) score += 15; // 10-40% interval width
    else if (avgIntervalWidth > 0.4) score -= 10; // Too wide
    else score -= 5; // Too narrow
    
    // Check for forecast horizon reasonableness
    if (forecast.horizon <= 30) score += 10; // Good horizon
    else if (forecast.horizon <= 90) score += 5; // Reasonable horizon
    else score -= 10; // Long horizon
    
    return Math.max(0, Math.min(100, score));
  }

  private evaluateVolatilityReasonableness(predictions: any[], commodityId: string): number {
    if (predictions.length < 2) return 50;
    
    const thresholds = this.validationThresholds.get(commodityId);
    const maxDailyVolatility = thresholds?.maxDailyVolatility || 0.05; // 5% default
    
    let volatilityScore = 80; // Start with good score
    
    // Check daily volatility
    for (let i = 1; i < predictions.length; i++) {
      const prevPrice = predictions[i - 1].median;
      const currPrice = predictions[i].median;
      const dailyChange = Math.abs((currPrice - prevPrice) / prevPrice);
      
      if (dailyChange > maxDailyVolatility * 2) {
        volatilityScore -= 20; // Excessive volatility
      } else if (dailyChange > maxDailyVolatility) {
        volatilityScore -= 10; // High volatility
      }
    }
    
    return Math.max(0, volatilityScore);
  }

  private evaluateTrendConsistency(predictions: any[]): number {
    if (predictions.length < 3) return 50;
    
    const prices = predictions.map(p => p.median);
    let consistentDirections = 0;
    let totalDirections = 0;
    
    // Check for consistent trend direction
    for (let i = 2; i < prices.length; i++) {
      const trend1 = prices[i - 1] - prices[i - 2];
      const trend2 = prices[i] - prices[i - 1];
      
      if ((trend1 > 0 && trend2 > 0) || (trend1 < 0 && trend2 < 0) || (Math.abs(trend1) < 0.001 && Math.abs(trend2) < 0.001)) {
        consistentDirections++;
      }
      totalDirections++;
    }
    
    const consistencyRatio = totalDirections > 0 ? consistentDirections / totalDirections : 0.5;
    return Math.round(consistencyRatio * 100);
  }

  // Vietnamese market-specific evaluation methods
  private evaluateVietnameseSeasonalAlignment(
    forecast: any,
    marketPatterns: VietnameseMarketPatterns | undefined,
    currentMonth: number
  ): number {
    if (!marketPatterns) return this.evaluateSeasonalAlignment(forecast);
    
    const seasonalPattern = marketPatterns.seasonalPatterns.find(p => p.month === currentMonth);
    if (!seasonalPattern) return 50;
    
    let alignmentScore = 50; // Base score
    
    // Check volatility alignment
    const predictions = forecast.predictions || [];
    if (predictions.length > 1) {
      const forecastVolatility = this.calculateVolatility(predictions);
      const expectedVolatility = seasonalPattern.expectedVolatility / 100;
      
      const volatilityRatio = Math.min(forecastVolatility / expectedVolatility, expectedVolatility / forecastVolatility);
      alignmentScore += Math.round(volatilityRatio * 30); // Up to 30 points for volatility alignment
    }
    
    // Check trend alignment
    const trendAlignment = this.evaluateSeasonalAlignment(forecast);
    alignmentScore += Math.round(trendAlignment * 0.2); // 20% weight for trend
    
    return Math.min(100, alignmentScore);
  }

  private evaluateVietnameseMarketFundamentals(
    forecast: any,
    marketPatterns: VietnameseMarketPatterns | undefined
  ): number {
    let fundamentalsScore = this.evaluateMarketFundamentals(forecast);
    
    if (!marketPatterns) return fundamentalsScore;
    
    // Adjust based on Vietnamese market characteristics
    if (marketPatterns.governmentInterventionLikely) {
      // More stable price expectations during intervention periods
      const predictions = forecast.predictions || [];
      const totalVolatility = this.calculateVolatility(predictions);
      
      if (totalVolatility < 0.15) { // Less than 15% volatility
        fundamentalsScore += 10; // Bonus for stability during intervention
      } else {
        fundamentalsScore -= 5; // Penalty for high volatility during intervention
      }
    }
    
    if (marketPatterns.exportSeasonality) {
      // Consider export season dynamics
      const currentMonth = new Date().getMonth() + 1;
      const isExportSeason = this.isVietnameseExportSeason(forecast.commodityId, currentMonth);
      
      if (isExportSeason) {
        // Higher volatility expected during export season
        fundamentalsScore += 5;
      }
    }
    
    return Math.min(100, fundamentalsScore);
  }

  private evaluateVolatilityAgainstVietnamesePatterns(
    forecast: any,
    marketPatterns: VietnameseMarketPatterns | undefined
  ): number {
    if (!marketPatterns) return this.evaluateVolatilityReasonableness(forecast.predictions || [], forecast.commodityId);
    
    const predictions = forecast.predictions || [];
    if (predictions.length < 2) return 50;
    
    const forecastVolatility = this.calculateVolatility(predictions);
    const { min: minExpected, max: maxExpected } = marketPatterns.historicalVolatilityRange;
    
    let volatilityScore = 80;
    
    if (forecastVolatility >= minExpected && forecastVolatility <= maxExpected) {
      volatilityScore = 90; // Within expected range
    } else if (forecastVolatility > maxExpected) {
      const excess = (forecastVolatility - maxExpected) / maxExpected;
      volatilityScore = Math.max(20, 90 - (excess * 50)); // Penalty for excess volatility
    } else {
      const shortfall = (minExpected - forecastVolatility) / minExpected;
      volatilityScore = Math.max(60, 90 - (shortfall * 30)); // Smaller penalty for low volatility
    }
    
    return Math.round(volatilityScore);
  }

  private evaluateVietnameseTrendLogic(
    forecast: any,
    marketPatterns: VietnameseMarketPatterns | undefined,
    currentMonth: number
  ): number {
    if (!marketPatterns) return this.evaluateTrendConsistency(forecast.predictions || []);
    
    const baseConsistency = this.evaluateTrendConsistency(forecast.predictions || []);
    const seasonalPattern = marketPatterns.seasonalPatterns.find(p => p.month === currentMonth);
    
    if (!seasonalPattern) return baseConsistency;
    
    // Adjust based on Vietnamese market logic
    let trendLogicScore = baseConsistency;
    
    // Check if trend aligns with typical market events
    if (seasonalPattern.marketEvents.length > 0) {
      // During major market events, trends should be more pronounced
      const predictions = forecast.predictions || [];
      if (predictions.length > 1) {
        const startPrice = predictions[0].median;
        const endPrice = predictions[predictions.length - 1].median;
        const trendStrength = Math.abs((endPrice - startPrice) / startPrice);
        
        if (seasonalPattern.marketEvents.some(event => 
          event.includes('harvest') || event.includes('export') || event.includes('planting'))) {
          if (trendStrength > 0.05) { // At least 5% movement during major events
            trendLogicScore += 10;
          } else {
            trendLogicScore -= 5; // Penalty for weak trends during major events
          }
        }
      }
    }
    
    return Math.min(100, trendLogicScore);
  }

  /**
   * Utility methods
   */
  private calculateVolatility(predictions: any[]): number {
    if (predictions.length < 2) return 0;
    
    const prices = predictions.map(p => p.median);
    const returns = [];
    
    for (let i = 1; i < prices.length; i++) {
      const returnVal = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(returnVal);
    }
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance); // Standard deviation
  }

  private isVietnameseExportSeason(commodityId: string, month: number): boolean {
    // Simplified export season logic for Vietnamese commodities
    const exportSeasons: Record<string, number[]> = {
      'rice': [10, 11, 12, 1, 2], // Oct-Feb main export season
      'coffee': [11, 12, 1, 2, 3, 4], // Nov-Apr export season
      'pepper': [1, 2, 3, 4, 5], // Jan-May export season
      'cashew': [1, 2, 3, 4, 5, 6] // Jan-Jun export season
    };
    
    return exportSeasons[commodityId]?.includes(month) || false;
  }

  private calculateCompositeScore(factors: FallbackValidationFactors, weightingScheme: string = 'standard'): number {
    const weights = this.getWeightingScheme(weightingScheme);
    
    return Math.round(
      factors.statisticalSoundness * weights.statistical +
      factors.historicalConsistency * weights.historical +
      factors.seasonalAlignment * weights.seasonal +
      factors.marketFundamentals * weights.fundamentals +
      factors.volatilityReasonableness * weights.volatility +
      factors.trendConsistency * weights.trend
    );
  }

  private getWeightingScheme(scheme: string): Record<string, number> {
    const schemes = {
      standard: {
        statistical: 0.25,
        historical: 0.20,
        seasonal: 0.15,
        fundamentals: 0.20,
        volatility: 0.10,
        trend: 0.10
      },
      vietnamese_patterns: {
        statistical: 0.20,
        historical: 0.15,
        seasonal: 0.25, // Higher weight for seasonal patterns
        fundamentals: 0.25, // Higher weight for market fundamentals
        volatility: 0.10,
        trend: 0.05
      }
    };
    
    return schemes[scheme] || schemes.standard;
  }

  private selectVerificationMethod(forecast: any): 'statistical' | 'historical' | 'market_patterns' | 'minimal' {
    const hasMetrics = forecast.metrics && (forecast.metrics.mase || forecast.metrics.smape || forecast.metrics.picp);
    const hasPredictions = Array.isArray(forecast.predictions) && forecast.predictions.length > 0;
    const hasMarketPatterns = this.vietnameseMarketPatterns.has(forecast.commodityId);
    
    if (hasMetrics && hasPredictions) {
      return 'statistical';
    } else if (hasPredictions && hasMarketPatterns) {
      return 'market_patterns';
    } else if (hasPredictions) {
      return 'historical';
    } else {
      return 'minimal';
    }
  }

  private createMinimalFallbackResult(
    reason: string,
    originalReason: string,
    error?: any
  ): FallbackVerificationResult {
    return {
      verified: false,
      confidence: 0.2, // Very low confidence for minimal fallback
      analysis: `Minimal fallback verification: ${reason}. ${originalReason}`,
      method: 'minimal',
      score: 20,
      factors: {
        statisticalSoundness: 20,
        historicalConsistency: 20,
        seasonalAlignment: 20,
        marketFundamentals: 20,
        volatilityReasonableness: 20,
        trendConsistency: 20
      },
      warnings: [
        'Limited verification data available',
        'LLM services unavailable',
        'Fallback verification only'
      ],
      provider: 'statistical_fallback',
      metadata: {
        reason,
        originalReason,
        error: error?.message,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Analysis generation methods
   */
  private generateStatisticalAnalysis(factors: FallbackValidationFactors, metrics: any, forecast: any): string {
    const score = this.calculateCompositeScore(factors);
    
    let analysis = `Statistical Fallback Verification (Score: ${score}/100):\n\n`;
    
    // Statistical soundness
    if (factors.statisticalSoundness >= 70) {
      analysis += `✓ Strong statistical metrics: MASE=${metrics.mase?.toFixed(3) || 'N/A'}, SMAPE=${metrics.smape?.toFixed(1) || 'N/A'}%, PICP=${metrics.picp?.toFixed(2) || 'N/A'}\n`;
    } else if (factors.statisticalSoundness >= 50) {
      analysis += `⚠ Moderate statistical metrics: Some concerns with forecast accuracy measures\n`;
    } else {
      analysis += `⚠ Weak statistical metrics: Significant concerns with forecast quality\n`;
    }
    
    // Market fundamentals
    if (factors.marketFundamentals >= 70) {
      analysis += `✓ Sound market fundamentals: Forecast follows reasonable market logic\n`;
    } else {
      analysis += `⚠ Market fundamental concerns: Forecast may not align with basic market principles\n`;
    }
    
    // Vietnamese market context
    analysis += `\nVietnamese Agricultural Market Context:\n`;
    analysis += `- Seasonal alignment: ${factors.seasonalAlignment}/100\n`;
    analysis += `- Volatility assessment: ${factors.volatilityReasonableness}/100\n`;
    analysis += `- Historical consistency: ${factors.historicalConsistency}/100\n`;
    
    analysis += `\nNote: This is a statistical fallback verification. For full validation, dual-LLM verification is recommended.`;
    
    return analysis;
  }

  private generateHistoricalAnalysis(factors: FallbackValidationFactors, historicalData: any[], forecast: any): string {
    const score = this.calculateCompositeScore(factors);
    
    let analysis = `Historical Pattern Fallback Verification (Score: ${score}/100):\n\n`;
    
    analysis += `Historical data analysis based on ${historicalData.length} data points over 24 months:\n\n`;
    
    if (factors.historicalConsistency >= 70) {
      analysis += `✓ Good historical consistency: Forecast aligns well with historical patterns\n`;
    } else if (factors.historicalConsistency >= 50) {
      analysis += `⚠ Moderate historical consistency: Some deviations from historical patterns\n`;
    } else {
      analysis += `⚠ Poor historical consistency: Significant deviations from historical patterns\n`;
    }
    
    if (factors.volatilityReasonableness >= 70) {
      analysis += `✓ Volatility within historical bounds\n`;
    } else {
      analysis += `⚠ Volatility outside typical historical range\n`;
    }
    
    analysis += `\nVietnamese Market Seasonal Assessment:\n`;
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });
    analysis += `- Current month: ${currentMonth} (seasonal alignment: ${factors.seasonalAlignment}/100)\n`;
    analysis += `- Trend consistency: ${factors.trendConsistency}/100\n`;
    
    analysis += `\nNote: Analysis based on historical patterns only. LLM verification recommended for comprehensive assessment.`;
    
    return analysis;
  }

  private generateVietnameseMarketAnalysis(
    factors: FallbackValidationFactors,
    marketPatterns: VietnameseMarketPatterns | undefined,
    forecast: any,
    currentMonth: number
  ): string {
    const score = this.calculateCompositeScore(factors, 'vietnamese_patterns');
    const monthName = new Date(2024, currentMonth - 1).toLocaleString('default', { month: 'long' });
    
    let analysis = `Vietnamese Agricultural Market Fallback Verification (Score: ${score}/100):\n\n`;
    
    analysis += `Market-specific analysis for ${forecast.commodityId} in ${forecast.regionId}:\n`;
    analysis += `Current month: ${monthName} (${currentMonth})\n\n`;
    
    if (marketPatterns) {
      const seasonalPattern = marketPatterns.seasonalPatterns.find(p => p.month === currentMonth);
      if (seasonalPattern) {
        analysis += `Seasonal expectations for ${monthName}:\n`;
        analysis += `- Expected volatility: ${seasonalPattern.expectedVolatility}%\n`;
        analysis += `- Seasonal bias: ${seasonalPattern.trendBias}\n`;
        analysis += `- Market events: ${seasonalPattern.marketEvents.join(', ') || 'None'}\n\n`;
      }
      
      if (marketPatterns.governmentInterventionLikely) {
        analysis += `⚠ Government intervention possible - expect reduced volatility\n`;
      }
      
      if (marketPatterns.exportSeasonality) {
        const isExportSeason = this.isVietnameseExportSeason(forecast.commodityId, currentMonth);
        analysis += `${isExportSeason ? '🚢' : '📦'} ${isExportSeason ? 'Export season active' : 'Domestic market focus'}\n`;
      }
    }
    
    analysis += `\nValidation factors:\n`;
    analysis += `- Seasonal alignment: ${factors.seasonalAlignment}/100\n`;
    analysis += `- Market fundamentals: ${factors.marketFundamentals}/100\n`;
    analysis += `- Volatility reasonableness: ${factors.volatilityReasonableness}/100\n`;
    analysis += `- Statistical soundness: ${factors.statisticalSoundness}/100\n`;
    
    analysis += `\nNote: Vietnamese market-specific validation. Full LLM verification provides deeper market insights.`;
    
    return analysis;
  }

  private generateWarnings(factors: FallbackValidationFactors, forecast: any): string[] {
    const warnings: string[] = [];
    
    if (factors.statisticalSoundness < 50) {
      warnings.push('Poor statistical metrics - forecast reliability questionable');
    }
    
    if (factors.volatilityReasonableness < 40) {
      warnings.push('Excessive volatility detected - may indicate model instability');
    }
    
    if (factors.seasonalAlignment < 40) {
      warnings.push('Forecast conflicts with typical seasonal patterns');
    }
    
    if (factors.marketFundamentals < 40) {
      warnings.push('Forecast violates basic market logic principles');
    }
    
    if (factors.historicalConsistency < 40) {
      warnings.push('Significant deviation from historical patterns');
    }
    
    if (factors.trendConsistency < 40) {
      warnings.push('Inconsistent trend direction - potential model artifacts');
    }
    
    // Forecast-specific warnings
    const predictions = forecast.predictions || [];
    if (predictions.length > 30) {
      warnings.push('Long forecast horizon reduces reliability');
    }
    
    if (predictions.some(p => p.confidence < 0.3)) {
      warnings.push('Very low confidence intervals detected');
    }
    
    return warnings;
  }

  private generateVietnameseMarketWarnings(
    factors: FallbackValidationFactors,
    forecast: any,
    marketPatterns: VietnameseMarketPatterns | undefined
  ): string[] {
    const warnings = this.generateWarnings(factors, forecast);
    
    if (!marketPatterns) {
      warnings.push('No Vietnamese market patterns available for this commodity');
      return warnings;
    }
    
    const currentMonth = new Date().getMonth() + 1;
    const seasonalPattern = marketPatterns.seasonalPatterns.find(p => p.month === currentMonth);
    
    if (seasonalPattern && factors.seasonalAlignment < 50) {
      warnings.push(`Forecast conflicts with ${seasonalPattern.trendBias} seasonal bias for this month`);
    }
    
    if (marketPatterns.governmentInterventionLikely && factors.volatilityReasonableness > 80) {
      warnings.push('High volatility unexpected during potential government intervention period');
    }
    
    const predictions = forecast.predictions || [];
    if (predictions.length > 0) {
      const forecastVolatility = this.calculateVolatility(predictions);
      if (forecastVolatility > marketPatterns.historicalVolatilityRange.max * 1.5) {
        warnings.push('Forecast volatility significantly exceeds historical Vietnamese market patterns');
      }
    }
    
    return warnings;
  }

  /**
   * Initialize Vietnamese market patterns and thresholds
   */
  private initializeVietnameseMarketPatterns(): void {
    // Rice market patterns
    this.vietnameseMarketPatterns.set('rice', {
      commodity: 'rice',
      region: 'vietnam',
      seasonalPatterns: [
        { month: 1, expectedVolatility: 8, trendBias: 'bullish', marketEvents: ['winter-spring planting', 'export season'] },
        { month: 2, expectedVolatility: 6, trendBias: 'bullish', marketEvents: ['export peak'] },
        { month: 3, expectedVolatility: 7, trendBias: 'neutral', marketEvents: ['export season end'] },
        { month: 4, expectedVolatility: 9, trendBias: 'bearish', marketEvents: ['pre-harvest preparation'] },
        { month: 5, expectedVolatility: 12, trendBias: 'bearish', marketEvents: ['winter-spring harvest begins'] },
        { month: 6, expectedVolatility: 15, trendBias: 'bearish', marketEvents: ['main harvest season'] },
        { month: 7, expectedVolatility: 18, trendBias: 'bearish', marketEvents: ['harvest peak', 'summer-autumn planting'] },
        { month: 8, expectedVolatility: 16, trendBias: 'neutral', marketEvents: ['summer-autumn growing'] },
        { month: 9, expectedVolatility: 14, trendBias: 'neutral', marketEvents: ['monsoon impact'] },
        { month: 10, expectedVolatility: 12, trendBias: 'bullish', marketEvents: ['summer-autumn harvest', 'export preparation'] },
        { month: 11, expectedVolatility: 10, trendBias: 'bullish', marketEvents: ['harvest completion', 'export season begins'] },
        { month: 12, expectedVolatility: 8, trendBias: 'bullish', marketEvents: ['export season', 'year-end demand'] }
      ],
      historicalVolatilityRange: { min: 0.05, max: 0.20 },
      typicalPriceChangeRange: { min: -15, max: 25 },
      governmentInterventionLikely: true,
      exportSeasonality: true
    });

    // Coffee market patterns
    this.vietnameseMarketPatterns.set('coffee', {
      commodity: 'coffee',
      region: 'vietnam',
      seasonalPatterns: [
        { month: 1, expectedVolatility: 12, trendBias: 'bullish', marketEvents: ['export peak', 'international price correlation'] },
        { month: 2, expectedVolatility: 10, trendBias: 'bullish', marketEvents: ['export season'] },
        { month: 3, expectedVolatility: 14, trendBias: 'neutral', marketEvents: ['weather monitoring'] },
        { month: 4, expectedVolatility: 16, trendBias: 'neutral', marketEvents: ['flowering season'] },
        { month: 5, expectedVolatility: 18, trendBias: 'bearish', marketEvents: ['rainy season begins'] },
        { month: 6, expectedVolatility: 20, trendBias: 'bearish', marketEvents: ['fruit development'] },
        { month: 7, expectedVolatility: 22, trendBias: 'neutral', marketEvents: ['monsoon peak'] },
        { month: 8, expectedVolatility: 20, trendBias: 'neutral', marketEvents: ['fruit maturation'] },
        { month: 9, expectedVolatility: 18, trendBias: 'bullish', marketEvents: ['harvest preparation'] },
        { month: 10, expectedVolatility: 25, trendBias: 'bearish', marketEvents: ['harvest begins', 'supply increase'] },
        { month: 11, expectedVolatility: 28, trendBias: 'bearish', marketEvents: ['main harvest', 'export preparation'] },
        { month: 12, expectedVolatility: 15, trendBias: 'bullish', marketEvents: ['harvest end', 'export season begins'] }
      ],
      historicalVolatilityRange: { min: 0.10, max: 0.35 },
      typicalPriceChangeRange: { min: -30, max: 40 },
      governmentInterventionLikely: false,
      exportSeasonality: true
    });

    // Pepper market patterns
    this.vietnameseMarketPatterns.set('pepper', {
      commodity: 'pepper',
      region: 'vietnam',
      seasonalPatterns: [
        { month: 1, expectedVolatility: 15, trendBias: 'bullish', marketEvents: ['export season', 'quality premium'] },
        { month: 2, expectedVolatility: 12, trendBias: 'bullish', marketEvents: ['peak export'] },
        { month: 3, expectedVolatility: 14, trendBias: 'neutral', marketEvents: ['international demand'] },
        { month: 4, expectedVolatility: 16, trendBias: 'neutral', marketEvents: ['planting season'] },
        { month: 5, expectedVolatility: 18, trendBias: 'bearish', marketEvents: ['rainy season'] },
        { month: 6, expectedVolatility: 20, trendBias: 'bearish', marketEvents: ['growing season'] },
        { month: 7, expectedVolatility: 22, trendBias: 'neutral', marketEvents: ['weather risk'] },
        { month: 8, expectedVolatility: 20, trendBias: 'neutral', marketEvents: ['development phase'] },
        { month: 9, expectedVolatility: 18, trendBias: 'bullish', marketEvents: ['pre-harvest'] },
        { month: 10, expectedVolatility: 25, trendBias: 'bearish', marketEvents: ['harvest begins'] },
        { month: 11, expectedVolatility: 30, trendBias: 'bearish', marketEvents: ['main harvest', 'supply peak'] },
        { month: 12, expectedVolatility: 20, trendBias: 'neutral', marketEvents: ['harvest end', 'quality sorting'] }
      ],
      historicalVolatilityRange: { min: 0.12, max: 0.40 },
      typicalPriceChangeRange: { min: -35, max: 50 },
      governmentInterventionLikely: false,
      exportSeasonality: true
    });
  }

  private initializeValidationThresholds(): void {
    // Rice validation thresholds
    this.validationThresholds.set('rice', {
      commodity: 'rice',
      maseThreshold: 0.9,
      smapeThreshold: 20,
      picpMinimum: 0.85,
      maxMonthlyVolatility: 0.15, // 15% per month
      maxDailyVolatility: 0.03    // 3% per day
    });

    // Coffee validation thresholds
    this.validationThresholds.set('coffee', {
      commodity: 'coffee',
      maseThreshold: 1.2,
      smapeThreshold: 30,
      picpMinimum: 0.80,
      maxMonthlyVolatility: 0.25, // 25% per month
      maxDailyVolatility: 0.05    // 5% per day
    });

    // Pepper validation thresholds
    this.validationThresholds.set('pepper', {
      commodity: 'pepper',
      maseThreshold: 1.5,
      smapeThreshold: 35,
      picpMinimum: 0.75,
      maxMonthlyVolatility: 0.30, // 30% per month
      maxDailyVolatility: 0.06    // 6% per day
    });
  }

  // Additional evaluation methods
  private evaluateHistoricalPriceConsistency(forecast: any, historicalData: any[]): number {
    if (historicalData.length === 0) return 30;
    
    const predictions = forecast.predictions || [];
    if (predictions.length === 0) return 30;
    
    // Calculate historical price statistics
    const historicalPrices = historicalData.map(d => parseFloat(d.price)).filter(p => !isNaN(p));
    if (historicalPrices.length === 0) return 30;
    
    const avgHistoricalPrice = historicalPrices.reduce((sum, p) => sum + p, 0) / historicalPrices.length;
    const historicalVolatility = this.calculateHistoricalVolatility(historicalPrices);
    
    // Compare forecast starting point with recent historical prices
    const forecastStartPrice = predictions[0].median;
    const priceDeviation = Math.abs(forecastStartPrice - avgHistoricalPrice) / avgHistoricalPrice;
    
    let consistencyScore = 80; // Base score
    
    // Penalize if forecast starts too far from historical average
    if (priceDeviation > 0.5) { // More than 50% deviation
      consistencyScore -= 30;
    } else if (priceDeviation > 0.2) { // More than 20% deviation
      consistencyScore -= 15;
    }
    
    // Check if forecast volatility aligns with historical volatility
    const forecastVolatility = this.calculateVolatility(predictions);
    const volatilityRatio = Math.abs(forecastVolatility - historicalVolatility) / historicalVolatility;
    
    if (volatilityRatio > 1.0) { // More than 100% different
      consistencyScore -= 20;
    } else if (volatilityRatio > 0.5) { // More than 50% different
      consistencyScore -= 10;
    }
    
    return Math.max(0, Math.min(100, consistencyScore));
  }

  private evaluateHistoricalVolatilityAlignment(forecast: any, historicalData: any[]): number {
    if (historicalData.length === 0) return 50;
    
    const predictions = forecast.predictions || [];
    if (predictions.length === 0) return 50;
    
    const historicalPrices = historicalData.map(d => parseFloat(d.price)).filter(p => !isNaN(p));
    const historicalVolatility = this.calculateHistoricalVolatility(historicalPrices);
    const forecastVolatility = this.calculateVolatility(predictions);
    
    // Score based on how close forecast volatility is to historical volatility
    const volatilityRatio = Math.min(forecastVolatility / historicalVolatility, historicalVolatility / forecastVolatility);
    
    if (volatilityRatio >= 0.8) return 90; // Very close
    if (volatilityRatio >= 0.6) return 75; // Close
    if (volatilityRatio >= 0.4) return 60; // Moderate
    if (volatilityRatio >= 0.2) return 40; // Different
    return 20; // Very different
  }

  private calculateHistoricalVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const returnVal = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(returnVal);
    }
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
}

// Export singleton instance
export const verificationFallbackService = new VerificationFallbackService();
export { VerificationFallbackService, type FallbackVerificationResult, type FallbackValidationFactors };