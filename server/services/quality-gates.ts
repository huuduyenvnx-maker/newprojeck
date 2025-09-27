import { storage } from "../storage";
import { ccsCalculator, type ComponentScores, type CCSCalculationResult } from "./ccs-calculator";
import { agreementAnalyzer, type AgreementAnalysisResult } from "./agreement-analyzer";
import { evidenceScorer, type EvidenceScoringResult } from "./evidence-scorer";
import { llmVerificationService } from "./llm-verification";
import { 
  type InsertQualityGate, 
  type QualityGate, 
  type CompositeConfidenceScore,
  type ForecastRun,
  type Commodity,
  type Region
} from "@shared/schema";

// Publishing Thresholds
interface PublishingThresholds {
  high: number;      // ≥ 90% - auto-publish with green indicator
  medium: number;    // 70-90% - publish with yellow warning
  low: number;       // 50-70% - publish with red warning
  belowThreshold: number; // < 50% - hold for manual review
}

// Quality Gate Decision
interface QualityGateDecision {
  gateStatus: 'auto_publish' | 'publish_warning' | 'publish_caution' | 'hold_review';
  confidenceLevel: 'high' | 'medium' | 'low' | 'below_threshold';
  publishDecision: 'published' | 'held' | 'manual_override';
  uiIndicator: 'green' | 'yellow' | 'red' | 'blocked';
  warningMessage?: string;
  threshold: number;
  recommendedAction: string;
}

// Temporal Consistency Analysis
interface TemporalConsistencyResult {
  score: number; // 0-100
  historicalAccuracy: number;
  patternStability: number;
  trendConsistency: number;
  outlierDetection: number;
  analysisDetails: any;
}

// Complete Quality Gate Analysis Result
interface QualityGateAnalysisResult {
  ccsResult: CCSCalculationResult;
  agreementResult: AgreementAnalysisResult;
  evidenceResult: EvidenceScoringResult;
  temporalConsistencyResult: TemporalConsistencyResult;
  qualityGateDecision: QualityGateDecision;
  overallAssessment: {
    score: number;
    level: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
}

class QualityGatesEngine {
  private publishingThresholds: PublishingThresholds = {
    high: 90,          // Auto-publish with green indicator
    medium: 70,        // Publish with yellow warning
    low: 50,           // Publish with red warning
    belowThreshold: 50 // Hold for manual review
  };

  /**
   * Run complete quality gate analysis for a forecast run
   */
  async runQualityGateAnalysis(
    forecastRunId: string,
    forecast30dId?: string
  ): Promise<QualityGateAnalysisResult> {
    try {
      console.log(`Starting quality gate analysis for forecast run: ${forecastRunId}`);

      // Get forecast run details
      const forecastRun = await storage.getForecastRun(forecastRunId);
      if (!forecastRun) {
        throw new Error(`Forecast run not found: ${forecastRunId}`);
      }

      // Get commodity and region details
      const [commodity, region] = await Promise.all([
        storage.getCommodity(forecastRun.commodityId),
        storage.getRegion(forecastRun.regionId)
      ]);

      if (!commodity || !region) {
        throw new Error("Commodity or region not found");
      }

      // Run enhanced LLM verification for agreement analysis
      const verificationResult = await this.ensureLLMVerifications(forecastRunId, forecast30dId);
      const verifications = {
        openaiVerification: verificationResult.openaiVerification,
        geminiVerification: verificationResult.geminiVerification
      };

      // Run all quality assessments in parallel with enhanced error handling
      const [evidenceResult, temporalConsistencyResult, agreementResult] = await Promise.all([
        this.runEvidenceAssessment(forecast30dId || forecastRunId, commodity.name, region.name),
        this.runTemporalConsistencyAssessment(forecastRun, commodity, region),
        this.runEnhancedAgreementAssessment(
          verifications.openaiVerification, 
          verifications.geminiVerification,
          verificationResult.verificationHealth
        )
      ]);

      // Calculate model confidence score from forecast metrics
      const modelConfidenceScore = this.calculateModelConfidenceScore(forecastRun);

      // Prepare component scores for CCS calculation
      const componentScores: ComponentScores = {
        agreementScore: agreementResult.agreementScore,
        evidenceScore: evidenceResult.totalScore,
        sourceCredibilityScore: evidenceResult.metrics.sourceCredibilityScore,
        temporalConsistencyScore: temporalConsistencyResult.score,
        modelConfidenceScore
      };

      // Calculate CCS
      const ccsResult = await ccsCalculator.calculateCCS(
        forecastRunId,
        componentScores,
        commodity.name,
        region.name,
        forecast30dId
      );

      // Make quality gate decision
      const qualityGateDecision = this.makeQualityGateDecision(
        ccsResult.compositeScore,
        commodity.name,
        ccsResult
      );

      // Generate overall assessment
      const overallAssessment = this.generateOverallAssessment(
        ccsResult,
        agreementResult,
        evidenceResult,
        temporalConsistencyResult,
        qualityGateDecision
      );

      const result: QualityGateAnalysisResult = {
        ccsResult,
        agreementResult,
        evidenceResult,
        temporalConsistencyResult,
        qualityGateDecision,
        overallAssessment
      };

      // Store results in database
      await this.storeQualityGateResults(forecastRunId, result, commodity.id, region.id, forecast30dId);

      console.log(`Quality gate analysis completed. CCS: ${ccsResult.compositeScore}%, Decision: ${qualityGateDecision.gateStatus}`);

      return result;

    } catch (error) {
      console.error(`Quality gate analysis failed for forecast run ${forecastRunId}:`, error);
      throw error;
    }
  }

  /**
   * Ensure LLM verifications exist for agreement analysis - Enhanced for hardened verification system
   */
  private async ensureLLMVerifications(forecastRunId: string, forecast30dId?: string): Promise<{
    openaiVerification: any;
    geminiVerification: any;
    verificationHealth: {
      healthStatus: any;
      performance: any;
      warnings: string[];
      fallbacksUsed: number;
      verificationStatus: string;
    };
  }> {
    console.log(`[QualityGates] Ensuring LLM verifications for forecast ${forecast30dId || forecastRunId}`);
    
    // Get existing verifications
    let verifications;
    if (forecast30dId) {
      verifications = await storage.getVerificationsByForecast30d(forecast30dId);
    } else {
      // For older forecasts table
      verifications = await storage.getVerifications(forecastRunId);
    }

    let openaiVerification = verifications.find(v => v.provider === 'openai');
    let geminiVerification = verifications.find(v => v.provider === 'gemini');
    let verificationHealth: any = {
      healthStatus: { overall: 'unknown' },
      performance: {},
      warnings: [],
      fallbacksUsed: 0,
      verificationStatus: 'existing'
    };

    // Run hardened LLM verification if not already done or if we need fresh verification
    if (!openaiVerification || !geminiVerification) {
      console.log(`[QualityGates] Running hardened LLM verification (missing: ${!openaiVerification ? 'OpenAI' : ''} ${!geminiVerification ? 'Gemini' : ''})`);
      
      try {
        const hardenedResult = await llmVerificationService.verifyForecast(forecast30dId || forecastRunId);
        
        // Extract verifications from hardened result
        const newVerifications = hardenedResult.verifications;
        verificationHealth = {
          healthStatus: hardenedResult.healthStatus,
          performance: hardenedResult.performance,
          warnings: hardenedResult.warnings,
          fallbacksUsed: hardenedResult.summary.fallbacksUsed,
          verificationStatus: hardenedResult.summary.verificationStatus
        };
        
        console.log(`[QualityGates] Hardened verification completed: ${hardenedResult.summary.verificationStatus} (${hardenedResult.summary.successfulProviders}/${hardenedResult.summary.totalProviders} providers successful)`);
        
        // Update verifications with new results
        if (!openaiVerification) {
          openaiVerification = newVerifications.find(v => 
            v.provider === 'openai' || v.provider.startsWith('openai')
          );
        }
        if (!geminiVerification) {
          geminiVerification = newVerifications.find(v => 
            v.provider === 'gemini' || v.provider.startsWith('gemini')
          );
        }
        
        // Log verification health status
        this.logVerificationHealth(verificationHealth);
        
      } catch (error) {
        console.error(`[QualityGates] Hardened LLM verification failed:`, error);
        verificationHealth.warnings.push(`LLM verification failed: ${error.message}`);
        verificationHealth.verificationStatus = 'failed';
        
        // Try to use any existing verifications even if old
        if (!openaiVerification || !geminiVerification) {
          return this.handleVerificationFailure(forecastRunId, forecast30dId, error);
        }
      }
    }

    // Graceful handling when verifications are missing or failed
    if (!openaiVerification && !geminiVerification) {
      console.error(`[QualityGates] No LLM verifications available for agreement analysis`);
      return this.handleCompleteVerificationFailure(forecastRunId, forecast30dId);
    }
    
    // Handle partial verification availability
    if (!openaiVerification || !geminiVerification) {
      console.warn(`[QualityGates] Partial LLM verification available (OpenAI: ${!!openaiVerification}, Gemini: ${!!geminiVerification})`);
      return this.handlePartialVerificationFailure(openaiVerification, geminiVerification, verificationHealth);
    }

    console.log(`[QualityGates] LLM verifications successfully ensured`);
    return { 
      openaiVerification, 
      geminiVerification, 
      verificationHealth 
    };
  }

  /**
   * Handle complete verification failure with fallback scoring
   */
  private async handleCompleteVerificationFailure(
    forecastRunId: string, 
    forecast30dId?: string
  ): Promise<{
    openaiVerification: any;
    geminiVerification: any;
    verificationHealth: any;
  }> {
    console.warn(`[QualityGates] Using fallback verification approach - no LLM verifications available`);
    
    // Create synthetic verification objects for agreement analysis
    const fallbackVerification = {
      id: `fallback-${Date.now()}`,
      provider: 'statistical_fallback',
      confidence: '0.3',
      verified: false,
      response: 'Statistical fallback verification used due to LLM service unavailability',
      metadata: {
        fallback: true,
        reason: 'Complete LLM verification failure'
      }
    };
    
    return {
      openaiVerification: { ...fallbackVerification, provider: 'openai_fallback' },
      geminiVerification: { ...fallbackVerification, provider: 'gemini_fallback' },
      verificationHealth: {
        healthStatus: { overall: 'unhealthy' },
        performance: { totalDuration: 0 },
        warnings: ['Complete LLM verification failure', 'Using statistical fallback'],
        fallbacksUsed: 2,
        verificationStatus: 'fallback'
      }
    };
  }

  /**
   * Handle partial verification failure
   */
  private async handlePartialVerificationFailure(
    openaiVerification: any,
    geminiVerification: any,
    verificationHealth: any
  ): Promise<{
    openaiVerification: any;
    geminiVerification: any;
    verificationHealth: any;
  }> {
    const missingProvider = !openaiVerification ? 'OpenAI' : 'Gemini';
    console.warn(`[QualityGates] Partial verification failure - missing ${missingProvider}`);
    
    // Create fallback for missing provider
    const fallbackVerification = {
      id: `fallback-${missingProvider.toLowerCase()}-${Date.now()}`,
      provider: `${missingProvider.toLowerCase()}_fallback`,
      confidence: '0.4', // Slightly higher than complete failure
      verified: false,
      response: `Statistical fallback verification for ${missingProvider} due to service unavailability`,
      metadata: {
        fallback: true,
        reason: `${missingProvider} verification failure`,
        partialFailure: true
      }
    };
    
    // Update health status
    verificationHealth.warnings.push(`${missingProvider} verification unavailable`);
    verificationHealth.fallbacksUsed += 1;
    verificationHealth.verificationStatus = 'partial';
    
    return {
      openaiVerification: openaiVerification || fallbackVerification,
      geminiVerification: geminiVerification || fallbackVerification,
      verificationHealth
    };
  }

  /**
   * Handle general verification failure
   */
  private async handleVerificationFailure(
    forecastRunId: string,
    forecast30dId: string | undefined,
    error: any
  ): Promise<{
    openaiVerification: any;
    geminiVerification: any;
    verificationHealth: any;
  }> {
    console.error(`[QualityGates] Verification failure, attempting graceful degradation:`, error);
    
    // Try to get any existing verifications, even if old
    let verifications;
    if (forecast30dId) {
      verifications = await storage.getVerificationsByForecast30d(forecast30dId);
    } else {
      verifications = await storage.getVerifications(forecastRunId);
    }
    
    const existingOpenAI = verifications.find(v => v.provider === 'openai');
    const existingGemini = verifications.find(v => v.provider === 'gemini');
    
    if (existingOpenAI && existingGemini) {
      console.log(`[QualityGates] Using existing verifications from cache`);
      return {
        openaiVerification: existingOpenAI,
        geminiVerification: existingGemini,
        verificationHealth: {
          healthStatus: { overall: 'degraded' },
          performance: { totalDuration: 0 },
          warnings: ['Using cached verifications due to service failure'],
          fallbacksUsed: 0,
          verificationStatus: 'cached'
        }
      };
    }
    
    // If no existing verifications, use complete fallback
    return this.handleCompleteVerificationFailure(forecastRunId, forecast30dId);
  }

  /**
   * Log verification health for monitoring
   */
  private logVerificationHealth(verificationHealth: any): void {
    const { healthStatus, performance, warnings, fallbacksUsed, verificationStatus } = verificationHealth;
    
    console.log(`[QualityGates] Verification Health Status:`, {
      overall: healthStatus.overall,
      openai: healthStatus.openai,
      gemini: healthStatus.gemini,
      status: verificationStatus,
      fallbacks: fallbacksUsed,
      duration: performance.totalDuration,
      warnings: warnings.length
    });
    
    if (warnings.length > 0) {
      console.warn(`[QualityGates] Verification warnings:`, warnings);
    }
    
    if (fallbacksUsed > 0) {
      console.warn(`[QualityGates] ${fallbacksUsed} fallback verification(s) used`);
    }
  }

  /**
   * Run evidence quality assessment
   */
  private async runEvidenceAssessment(
    forecastId: string,
    commodityName: string,
    regionName: string
  ): Promise<EvidenceScoringResult> {
    return await evidenceScorer.scoreEvidence(forecastId, commodityName, regionName);
  }

  /**
   * Run agreement analysis between LLM verifications
   */
  private async runAgreementAssessment(
    openaiVerification: any,
    geminiVerification: any
  ): Promise<AgreementAnalysisResult> {
    // Create a temporary CCS ID for agreement analysis storage
    const tempCcsId = "temp-" + Date.now();
    
    return await agreementAnalyzer.analyzeAgreement(
      openaiVerification.id,
      geminiVerification.id,
      tempCcsId
    );
  }

  /**
   * Enhanced agreement analysis with verification health consideration
   */
  private async runEnhancedAgreementAssessment(
    openaiVerification: any,
    geminiVerification: any,
    verificationHealth: any
  ): Promise<AgreementAnalysisResult> {
    console.log(`[QualityGates] Running enhanced agreement assessment (health: ${verificationHealth.verificationStatus})`);
    
    try {
      // Run standard agreement analysis
      const agreementResult = await this.runAgreementAssessment(openaiVerification, geminiVerification);
      
      // Adjust agreement score based on verification health
      const adjustedResult = this.adjustAgreementForVerificationHealth(agreementResult, verificationHealth);
      
      // Add verification health context to analysis
      adjustedResult.analysisDetails.verificationHealth = {
        healthStatus: verificationHealth.healthStatus,
        fallbacksUsed: verificationHealth.fallbacksUsed,
        verificationStatus: verificationHealth.verificationStatus,
        warnings: verificationHealth.warnings
      };
      
      // Log enhanced assessment details
      console.log(`[QualityGates] Enhanced agreement analysis completed:`, {
        originalScore: agreementResult.agreementScore,
        adjustedScore: adjustedResult.agreementScore,
        healthStatus: verificationHealth.verificationStatus,
        fallbacks: verificationHealth.fallbacksUsed
      });
      
      return adjustedResult;
      
    } catch (error) {
      console.error(`[QualityGates] Enhanced agreement assessment failed:`, error);
      
      // Return degraded agreement result
      return this.createDegradedAgreementResult(verificationHealth, error);
    }
  }

  /**
   * Adjust agreement score based on verification health
   */
  private adjustAgreementForVerificationHealth(
    agreementResult: AgreementAnalysisResult,
    verificationHealth: any
  ): AgreementAnalysisResult {
    let adjustmentFactor = 1.0;
    const adjustmentReasons: string[] = [];
    
    // Adjust based on verification status
    switch (verificationHealth.verificationStatus) {
      case 'success':
        // No adjustment needed
        break;
      case 'partial':
        adjustmentFactor *= 0.85; // 15% reduction for partial verification
        adjustmentReasons.push('Partial LLM verification available');
        break;
      case 'fallback':
        adjustmentFactor *= 0.65; // 35% reduction for fallback verification
        adjustmentReasons.push('Statistical fallback verification used');
        break;
      case 'failed':
        adjustmentFactor *= 0.45; // 55% reduction for failed verification
        adjustmentReasons.push('LLM verification failed');
        break;
      case 'cached':
        adjustmentFactor *= 0.95; // 5% reduction for cached verification
        adjustmentReasons.push('Using cached verification results');
        break;
    }
    
    // Additional adjustment for fallbacks used
    if (verificationHealth.fallbacksUsed > 0) {
      const fallbackPenalty = Math.min(0.3, verificationHealth.fallbacksUsed * 0.1); // Max 30% penalty
      adjustmentFactor *= (1 - fallbackPenalty);
      adjustmentReasons.push(`${verificationHealth.fallbacksUsed} fallback verification(s) used`);
    }
    
    // Additional adjustment for health warnings
    if (verificationHealth.warnings && verificationHealth.warnings.length > 0) {
      const warningPenalty = Math.min(0.15, verificationHealth.warnings.length * 0.03); // Max 15% penalty
      adjustmentFactor *= (1 - warningPenalty);
      adjustmentReasons.push(`${verificationHealth.warnings.length} verification warning(s)`);
    }
    
    // Calculate adjusted score
    const originalScore = agreementResult.agreementScore;
    const adjustedScore = Math.max(0, originalScore * adjustmentFactor);
    
    // Update agreement result
    const adjustedResult = { ...agreementResult };
    adjustedResult.agreementScore = adjustedScore;
    
    // Add adjustment details to analysis
    if (!adjustedResult.analysisDetails.adjustments) {
      adjustedResult.analysisDetails.adjustments = {};
    }
    
    adjustedResult.analysisDetails.adjustments = {
      originalScore,
      adjustedScore,
      adjustmentFactor,
      adjustmentReasons,
      healthBasedAdjustment: true
    };
    
    return adjustedResult;
  }

  /**
   * Create degraded agreement result when analysis fails
   */
  private createDegradedAgreementResult(
    verificationHealth: any,
    error: any
  ): AgreementAnalysisResult {
    console.warn(`[QualityGates] Creating degraded agreement result due to assessment failure`);
    
    return {
      agreementScore: 30, // Conservative low score
      metrics: {
        semanticSimilarity: 0.3,
        priceVariance: 0.7,
        trendAlignment: 0.3,
        confidenceOverlap: 0.3
      },
      analysisDetails: {
        degraded: true,
        error: error.message,
        verificationHealth: {
          healthStatus: verificationHealth.healthStatus,
          fallbacksUsed: verificationHealth.fallbacksUsed,
          verificationStatus: verificationHealth.verificationStatus,
          warnings: [...(verificationHealth.warnings || []), 'Agreement analysis failed']
        },
        fallbackReason: 'Agreement analysis failure with verification health issues'
      },
      method: 'degraded_fallback',
      embeddingModel: 'none_fallback'
    };
  }

  /**
   * Run temporal consistency assessment
   */
  private async runTemporalConsistencyAssessment(
    forecastRun: ForecastRun,
    commodity: Commodity,
    region: Region
  ): Promise<TemporalConsistencyResult> {
    try {
      // Get historical forecast runs for comparison
      const historicalRuns = await storage.getForecastRuns(commodity.id, region.id);
      const recentRuns = historicalRuns
        .filter(run => run.id !== forecastRun.id && run.status === 'completed')
        .sort((a, b) => new Date(b.runDate).getTime() - new Date(a.runDate).getTime())
        .slice(0, 10); // Last 10 runs

      if (recentRuns.length < 2) {
        return {
          score: 50, // Neutral score for insufficient historical data
          historicalAccuracy: 50,
          patternStability: 50,
          trendConsistency: 50,
          outlierDetection: 50,
          analysisDetails: {
            reason: "Insufficient historical data for temporal consistency analysis",
            historicalRunsCount: recentRuns.length,
            minimumRequired: 2
          }
        };
      }

      // Calculate historical accuracy
      const historicalAccuracy = await this.calculateHistoricalAccuracy(recentRuns, commodity, region);

      // Calculate pattern stability
      const patternStability = this.calculatePatternStability(recentRuns, forecastRun);

      // Calculate trend consistency
      const trendConsistency = this.calculateTrendConsistency(recentRuns, forecastRun);

      // Calculate outlier detection
      const outlierDetection = this.calculateOutlierDetection(recentRuns, forecastRun);

      // Weighted average of components
      const weights = {
        historicalAccuracy: 0.4,
        patternStability: 0.25,
        trendConsistency: 0.25,
        outlierDetection: 0.1
      };

      const score = (
        historicalAccuracy * weights.historicalAccuracy +
        patternStability * weights.patternStability +
        trendConsistency * weights.trendConsistency +
        outlierDetection * weights.outlierDetection
      );

      return {
        score: Math.max(0, Math.min(100, score)),
        historicalAccuracy,
        patternStability,
        trendConsistency,
        outlierDetection,
        analysisDetails: {
          historicalRunsAnalyzed: recentRuns.length,
          weights,
          components: {
            historicalAccuracy,
            patternStability,
            trendConsistency,
            outlierDetection
          },
          calculationTimestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error("Temporal consistency assessment failed:", error);
      return {
        score: 30, // Low score for failed analysis
        historicalAccuracy: 30,
        patternStability: 30,
        trendConsistency: 30,
        outlierDetection: 30,
        analysisDetails: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Calculate model confidence score from forecast metrics
   */
  private calculateModelConfidenceScore(forecastRun: ForecastRun): number {
    const metrics = forecastRun.metrics as any;
    if (!metrics) return 50; // Default neutral score

    try {
      // Higher scores for better metrics (lower MASE, SMAPE)
      const maseScore = metrics.mase ? Math.max(0, 100 - (metrics.mase * 50)) : 50;
      const smapeScore = metrics.smape ? Math.max(0, 100 - metrics.smape) : 50;
      const picpScore = metrics.picp ? metrics.picp : 50;
      const fqsScore = metrics.fqs ? metrics.fqs : 50;

      // Weighted average of available metrics
      const availableMetrics = [maseScore, smapeScore, picpScore, fqsScore].filter(score => score !== 50);
      if (availableMetrics.length === 0) return 50;

      return availableMetrics.reduce((sum, score) => sum + score, 0) / availableMetrics.length;
    } catch (error) {
      console.error("Model confidence calculation failed:", error);
      return 50;
    }
  }

  /**
   * Calculate historical accuracy based on past forecast performance
   */
  private async calculateHistoricalAccuracy(
    historicalRuns: ForecastRun[],
    commodity: Commodity,
    region: Region
  ): Promise<number> {
    // Simplified historical accuracy calculation
    // In a real implementation, this would compare forecasts with actual outcomes
    
    let totalAccuracy = 0;
    let validRuns = 0;

    for (const run of historicalRuns) {
      const metrics = run.metrics as any;
      if (metrics && metrics.mase && metrics.smape) {
        // Convert MASE and SMAPE to accuracy scores
        const maseAccuracy = Math.max(0, 100 - (metrics.mase * 50));
        const smapeAccuracy = Math.max(0, 100 - metrics.smape);
        const runAccuracy = (maseAccuracy + smapeAccuracy) / 2;
        
        totalAccuracy += runAccuracy;
        validRuns++;
      }
    }

    return validRuns > 0 ? totalAccuracy / validRuns : 50;
  }

  /**
   * Calculate pattern stability across forecasts
   */
  private calculatePatternStability(historicalRuns: ForecastRun[], currentRun: ForecastRun): number {
    // Simplified pattern stability - compare model types and parameters
    const modelTypes = historicalRuns.map(run => run.model);
    const currentModel = currentRun.model;
    
    const sameModelCount = modelTypes.filter(model => model === currentModel).length;
    const stabilityRatio = sameModelCount / Math.max(1, historicalRuns.length);
    
    return Math.min(100, stabilityRatio * 100 + 20); // Base score + stability bonus
  }

  /**
   * Calculate trend consistency
   */
  private calculateTrendConsistency(historicalRuns: ForecastRun[], currentRun: ForecastRun): number {
    // Simplified trend consistency analysis
    // Would compare forecast directions and magnitudes in a real implementation
    
    if (historicalRuns.length < 2) return 50;
    
    // For now, return a score based on successful completion rate
    const completedRuns = historicalRuns.filter(run => run.status === 'completed');
    const completionRate = completedRuns.length / historicalRuns.length;
    
    return Math.min(100, completionRate * 80 + 20);
  }

  /**
   * Calculate outlier detection score
   */
  private calculateOutlierDetection(historicalRuns: ForecastRun[], currentRun: ForecastRun): number {
    // Simplified outlier detection
    // Would analyze if current forecast parameters are outliers compared to historical norms
    
    const currentMetrics = currentRun.metrics as any;
    if (!currentMetrics) return 50;
    
    // Compare with historical metrics ranges
    const historicalMetrics = historicalRuns.map(run => run.metrics).filter(Boolean);
    if (historicalMetrics.length === 0) return 50;
    
    // For now, assume no outliers detected
    return 85; // High score indicating no outliers
  }

  /**
   * Make quality gate decision based on CCS and thresholds
   */
  private makeQualityGateDecision(
    ccsScore: number,
    commodityName: string,
    ccsResult: CCSCalculationResult
  ): QualityGateDecision {
    // Get commodity-specific threshold
    const commodityThreshold = ccsCalculator.getCommodityThreshold(commodityName);
    
    // Determine confidence level and gate status
    if (ccsScore >= this.publishingThresholds.high) {
      return {
        gateStatus: 'auto_publish',
        confidenceLevel: 'high',
        publishDecision: 'published',
        uiIndicator: 'green',
        threshold: this.publishingThresholds.high,
        recommendedAction: 'Auto-publish with high confidence indicator'
      };
    } else if (ccsScore >= this.publishingThresholds.medium) {
      return {
        gateStatus: 'publish_warning',
        confidenceLevel: 'medium',
        publishDecision: 'published',
        uiIndicator: 'yellow',
        warningMessage: 'Medium confidence forecast - use with caution',
        threshold: this.publishingThresholds.medium,
        recommendedAction: 'Publish with yellow warning indicator'
      };
    } else if (ccsScore >= this.publishingThresholds.low) {
      return {
        gateStatus: 'publish_caution',
        confidenceLevel: 'low',
        publishDecision: 'published',
        uiIndicator: 'red',
        warningMessage: 'Low confidence forecast - requires careful interpretation',
        threshold: this.publishingThresholds.low,
        recommendedAction: 'Publish with red caution indicator'
      };
    } else {
      return {
        gateStatus: 'hold_review',
        confidenceLevel: 'below_threshold',
        publishDecision: 'held',
        uiIndicator: 'blocked',
        warningMessage: `Below quality threshold (${commodityThreshold}% for ${commodityName})`,
        threshold: this.publishingThresholds.belowThreshold,
        recommendedAction: 'Hold for manual review - consider improving data quality'
      };
    }
  }

  /**
   * Generate overall assessment summary
   */
  private generateOverallAssessment(
    ccsResult: CCSCalculationResult,
    agreementResult: AgreementAnalysisResult,
    evidenceResult: EvidenceScoringResult,
    temporalResult: TemporalConsistencyResult,
    decision: QualityGateDecision
  ) {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Analyze strengths
    if (agreementResult.agreementScore >= 85) {
      strengths.push("High LLM agreement indicates robust analysis");
    }
    if (evidenceResult.totalScore >= 80) {
      strengths.push("Strong evidence base with credible sources");
    }
    if (temporalResult.score >= 80) {
      strengths.push("Consistent with historical patterns");
    }
    if (ccsResult.componentScores.modelConfidenceScore >= 80) {
      strengths.push("High statistical model confidence");
    }

    // Analyze weaknesses
    if (agreementResult.agreementScore < 70) {
      weaknesses.push("Low LLM agreement suggests uncertainty");
    }
    if (evidenceResult.totalScore < 60) {
      weaknesses.push("Limited or low-quality evidence");
    }
    if (temporalResult.score < 60) {
      weaknesses.push("Inconsistent with historical patterns");
    }
    if (ccsResult.componentScores.modelConfidenceScore < 60) {
      weaknesses.push("Low statistical model confidence");
    }

    // Generate recommendations
    recommendations.push(...evidenceResult.recommendations);
    
    if (agreementResult.agreementScore < 80) {
      recommendations.push("Review LLM analysis inputs for consistency");
    }
    if (decision.confidenceLevel === 'below_threshold') {
      recommendations.push("Consider additional data sources before publishing");
    }

    return {
      score: ccsResult.compositeScore,
      level: decision.confidenceLevel,
      strengths,
      weaknesses,
      recommendations: [...new Set(recommendations)] // Remove duplicates
    };
  }

  /**
   * Store quality gate results in database
   */
  private async storeQualityGateResults(
    forecastRunId: string,
    result: QualityGateAnalysisResult,
    commodityId: string,
    regionId: string,
    forecast30dId?: string
  ): Promise<void> {
    try {
      // Store CCS result
      const ccsRecord = await ccsCalculator.storeCCSResult(
        forecastRunId,
        commodityId,
        regionId,
        result.ccsResult,
        forecast30dId
      );

      // Store agreement analysis with real CCS ID
      await agreementAnalyzer.storeAgreementAnalysis(
        ccsRecord.id,
        result.agreementResult.analysisDetails.openaiResponse.reasoning ? "openai-id" : "", // Simplified
        result.agreementResult.analysisDetails.geminiResponse.reasoning ? "gemini-id" : "", // Simplified
        result.agreementResult
      );

      // Store quality gate decision
      const qualityGateData: InsertQualityGate = {
        ccsId: ccsRecord.id,
        forecastRunId,
        gateStatus: result.qualityGateDecision.gateStatus,
        confidenceLevel: result.qualityGateDecision.confidenceLevel,
        threshold: result.qualityGateDecision.threshold.toString(),
        publishDecision: result.qualityGateDecision.publishDecision,
        publishedAt: result.qualityGateDecision.publishDecision === 'published' ? new Date() : undefined,
        uiIndicator: result.qualityGateDecision.uiIndicator,
        warningMessage: result.qualityGateDecision.warningMessage,
        qualityMetrics: {
          overallAssessment: result.overallAssessment,
          evidenceMetrics: result.evidenceResult,
          temporalMetrics: result.temporalConsistencyResult,
          agreementMetrics: result.agreementResult.metrics
        }
      };

      await storage.createQualityGate(qualityGateData);

      console.log(`Quality gate results stored for forecast run ${forecastRunId}`);

    } catch (error) {
      console.error("Failed to store quality gate results:", error);
      // Don't throw - this is a storage issue, not a quality gate failure
    }
  }

  /**
   * Apply manual override to quality gate decision
   */
  async applyManualOverride(
    qualityGateId: string,
    overrideReason: string,
    overrideBy: string,
    newPublishDecision: 'published' | 'held'
  ): Promise<QualityGate> {
    return await storage.applyManualOverride(qualityGateId, overrideReason, overrideBy);
  }

  /**
   * Get pending quality gates for manual review
   */
  async getPendingReviews(): Promise<QualityGate[]> {
    return await storage.getPendingQualityGates();
  }

  /**
   * Get quality gate status for a forecast run
   */
  async getQualityGateStatus(forecastRunId: string): Promise<QualityGate | undefined> {
    const gates = await storage.getQualityGatesByForecastRun(forecastRunId);
    return gates[0]; // Most recent gate
  }

  /**
   * Get publishing thresholds configuration
   */
  getPublishingThresholds(): PublishingThresholds {
    return { ...this.publishingThresholds };
  }

  /**
   * Update publishing thresholds for tuning
   */
  updatePublishingThresholds(newThresholds: Partial<PublishingThresholds>): void {
    this.publishingThresholds = { ...this.publishingThresholds, ...newThresholds };
  }
}

export const qualityGatesEngine = new QualityGatesEngine();
export type { QualityGateAnalysisResult, QualityGateDecision, PublishingThresholds, TemporalConsistencyResult };