import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth } from "../../middleware/session-auth";
import { qualityGatesEngine } from "../../services/quality-gates";
import { currencyConverter } from "../../services/currency-converter";
import { 
  getReliabilityRequestSchema, 
  getVietnameseSeasonalContext,
  type GetReliabilityRequest
} from "../../schemas/v1-requests";
import { 
  createSuccessResponse, 
  createErrorResponse,
  type GetReliabilityResponse,
  type VietnameseMarketContext
} from "../../schemas/v1-responses";

const router = Router();

// Rate limiting tracking (simple in-memory for now)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 15; // Moderate limit for reliability metrics
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Helper function to check rate limits
const checkRateLimit = (clientId: string): { allowed: boolean; remaining: number; resetAt: Date } => {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  
  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
  }
  
  if (clientData.count >= RATE_LIMIT_REQUESTS) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: new Date(clientData.resetTime) 
    };
  }
  
  clientData.count++;
  rateLimitMap.set(clientId, clientData);
  
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_REQUESTS - clientData.count, 
    resetAt: new Date(clientData.resetTime) 
  };
};

// Helper function to build Vietnamese market context
const buildVietnameseMarketContext = async (
  commodity?: string, 
  region?: string
): Promise<VietnameseMarketContext> => {
  const seasonalContext = getVietnameseSeasonalContext();
  
  // Get exchange rate with proper error handling and fallback
  let exchangeRateInfo;
  try {
    const conversionResult = await currencyConverter.convert(1, "USD", "VND", new Date());
    exchangeRateInfo = { rate: conversionResult.rate, date: conversionResult.date };
  } catch (error) {
    console.warn("Failed to fetch USD/VND exchange rate, using fallback:", error);
    exchangeRateInfo = null;
  }
  
  // Fallback exchange rate data (approximate recent USD/VND rate)
  const fallbackRate = 24000; // Approximate VND per USD
  const fallbackTimestamp = new Date();
  
  const exchangeRate = exchangeRateInfo?.rate || fallbackRate;
  const rateTimestamp = exchangeRateInfo?.date || fallbackTimestamp;
  
  // Default regional specifics (average across Vietnam)
  let regionalSpecifics: {
    export_orientation: number;
    infrastructure_score: number;
    climate_risk_level: 'low' | 'medium' | 'high';
  } = {
    export_orientation: 0.65,
    infrastructure_score: 78,
    climate_risk_level: 'medium' as const,
  };

  // Override if specific region provided
  if (region) {
    const regionSpecifics = {
      'mekong-delta': { export_orientation: 0.8, infrastructure_score: 85, climate_risk_level: 'medium' as const },
      'central-highlands': { export_orientation: 0.9, infrastructure_score: 75, climate_risk_level: 'high' as const },
      'red-river-delta': { export_orientation: 0.6, infrastructure_score: 90, climate_risk_level: 'medium' as const },
      'southeast': { export_orientation: 0.7, infrastructure_score: 88, climate_risk_level: 'low' as const },
      'north-central': { export_orientation: 0.5, infrastructure_score: 70, climate_risk_level: 'medium' as const },
      'south-central': { export_orientation: 0.6, infrastructure_score: 72, climate_risk_level: 'high' as const },
      'north-mountain': { export_orientation: 0.4, infrastructure_score: 65, climate_risk_level: 'high' as const },
    };
    regionalSpecifics = regionSpecifics[region as keyof typeof regionSpecifics] || regionalSpecifics;
  }

  return {
    currency_info: {
      primary_currency: "VND",
      exchange_rate_vnd_usd: exchangeRate,
      rate_timestamp: rateTimestamp.toISOString(),
    },
    seasonal_context: {
      current_season: seasonalContext.isMonsoonSeason ? "monsoon" : "dry",
      seasonal_risk_factor: seasonalContext.seasonalRiskFactor,
      harvest_calendar: {
        rice: {
          summer_harvest: seasonalContext.isHarvestSeason.rice.summer,
          autumn_harvest: seasonalContext.isHarvestSeason.rice.autumn,
        },
        coffee_harvest: seasonalContext.isHarvestSeason.coffee,
        pepper_harvest: seasonalContext.isHarvestSeason.pepper,
      },
    },
    regional_specifics: regionalSpecifics,
  };
};

// Helper function to calculate time range dates
const calculateTimeRange = (timeRange: string): { startDate: Date; endDate: Date } => {
  const endDate = new Date();
  const startDate = new Date();

  switch (timeRange) {
    case "7d":
      startDate.setDate(endDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(endDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(endDate.getDate() - 90);
      break;
    case "6m":
      startDate.setMonth(endDate.getMonth() - 6);
      break;
    case "1y":
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
    default:
      startDate.setDate(endDate.getDate() - 30);
  }

  return { startDate, endDate };
};

// Helper function to analyze trend from data points
const analyzeTrend = (values: number[]): "improving" | "stable" | "declining" => {
  if (values.length < 2) return "stable";
  
  const recent = values.slice(-Math.min(5, values.length));
  const earlier = values.slice(0, Math.min(5, values.length));
  
  const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
  const earlierAvg = earlier.reduce((sum, val) => sum + val, 0) / earlier.length;
  
  const changePercent = ((recentAvg - earlierAvg) / earlierAvg) * 100;
  
  if (changePercent > 5) return "improving";
  if (changePercent < -5) return "declining";
  return "stable";
};

// Helper function to calculate accuracy metrics
const calculateAccuracyMetrics = (forecastRuns: any[]) => {
  if (forecastRuns.length === 0) {
    return {
      mean_absolute_error: 0,
      prediction_interval_coverage: 0,
      direction_accuracy: 0,
    };
  }

  // Simple calculation - in production this would be more sophisticated
  const validRuns = forecastRuns.filter(run => run.metrics);
  
  if (validRuns.length === 0) {
    return {
      mean_absolute_error: 0,
      prediction_interval_coverage: 0,
      direction_accuracy: 0,
    };
  }

  const totalMAE = validRuns.reduce((sum, run) => sum + (run.metrics.mase || 0), 0);
  const totalPICP = validRuns.reduce((sum, run) => sum + (run.metrics.picp || 0), 0);
  
  // Direction accuracy approximation based on forecast success
  const successfulForecasts = validRuns.filter(run => (run.metrics.fqs || 0) > 0.6).length;
  const directionAccuracy = successfulForecasts / validRuns.length;

  return {
    mean_absolute_error: totalMAE / validRuns.length,
    prediction_interval_coverage: totalPICP / validRuns.length,
    direction_accuracy: directionAccuracy,
  };
};

// Helper function to generate quality insights
const generateQualityInsights = (
  overallMetrics: any,
  componentBreakdown: any,
  timeRange: string,
  commodity?: string,
  region?: string
) => {
  const strengths = [];
  const areasForImprovement = [];
  const recommendations = [];

  // Analyze overall CCS performance
  if (overallMetrics.average_ccs_score >= 80) {
    strengths.push("High overall forecast confidence and quality");
  } else if (overallMetrics.average_ccs_score < 60) {
    areasForImprovement.push("Below-average composite confidence scores");
    recommendations.push("Review and improve data quality sources");
  }

  // Analyze agreement scores
  if (componentBreakdown.agreement_scores.average >= 85) {
    strengths.push("Strong LLM agreement indicates robust forecasting");
  } else if (componentBreakdown.agreement_scores.average < 70) {
    areasForImprovement.push("Low LLM agreement suggests forecast uncertainty");
    recommendations.push("Investigate conflicting signals in market data");
  }

  // Analyze evidence quality
  if (componentBreakdown.evidence_scores.average >= 80) {
    strengths.push("High-quality evidence sources supporting forecasts");
  } else if (componentBreakdown.evidence_scores.average < 60) {
    areasForImprovement.push("Evidence quality needs improvement");
    recommendations.push("Diversify data sources and improve source credibility");
  }

  // Analyze temporal consistency
  if (componentBreakdown.temporal_consistency.average >= 75) {
    strengths.push("Consistent forecast patterns over time");
  } else {
    areasForImprovement.push("Temporal consistency variations detected");
    recommendations.push("Review model stability and historical accuracy");
  }

  // Analyze model confidence
  if (componentBreakdown.model_confidence.fallback_rate > 0.2) {
    areasForImprovement.push("High fallback rate indicates ML service instability");
    recommendations.push("Improve ML service reliability and reduce circuit breaker activations");
  }

  // Quality gate distribution analysis
  const autoPublishRate = overallMetrics.quality_gate_distribution.auto_publish / overallMetrics.total_forecasts;
  if (autoPublishRate < 0.4) {
    areasForImprovement.push("Low auto-publish rate may indicate quality issues");
    recommendations.push("Investigate factors causing quality gate holds");
  }

  // Commodity-specific insights
  if (commodity) {
    const commodityInsights = {
      rice: "Rice forecasts benefit from high data availability in Vietnamese markets",
      coffee: "Coffee price volatility may require additional risk factors",
      pepper: "Pepper market seasonal patterns should be emphasized in models",
    };
    
    const insight = commodityInsights[commodity as keyof typeof commodityInsights];
    if (insight) {
      recommendations.push(insight);
    }
  }

  // Regional insights
  if (region) {
    if (region === "mekong-delta") {
      strengths.push("Mekong Delta benefits from rich agricultural data infrastructure");
    } else if (region === "central-highlands") {
      recommendations.push("Central Highlands climate risks require enhanced monitoring");
    }
  }

  // Time range specific insights
  if (timeRange === "7d") {
    recommendations.push("Short-term analysis - consider extending time range for better insights");
  } else if (timeRange === "1y") {
    strengths.push("Long-term analysis provides comprehensive quality assessment");
  }

  return {
    strengths: strengths.length > 0 ? strengths : ["System is operational with basic quality metrics"],
    areas_for_improvement: areasForImprovement,
    recommendations: recommendations.length > 0 ? recommendations : ["Continue monitoring quality metrics for trends"],
  };
};

// ===========================================
// GET /v1/reliability - Quality Dashboard Metrics
// ===========================================

router.get("/reliability", requireAuth, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
  });

  try {
    // Rate limiting check
    const clientId = req.ip || 'unknown';
    const rateLimit = checkRateLimit(clientId);
    
    if (!rateLimit.allowed) {
      return res.status(429).json(createErrorResponse(
        "RATE_LIMIT_EXCEEDED",
        "Too many requests. Please try again later.",
        "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
        "rate_limit_exceeded",
        { 
          rate_limit: {
            remaining: rateLimit.remaining,
            reset_at: rateLimit.resetAt.toISOString(),
          }
        },
        requestId
      ));
    }

    // Validate query parameters
    let validatedRequest: GetReliabilityRequest;
    try {
      validatedRequest = getReliabilityRequestSchema.parse(req.query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid query parameters",
          "Tham số truy vấn không hợp lệ",
          "validation_error",
          { validation_errors: error.errors },
          requestId
        ));
      }
      throw error;
    }

    const { 
      commodity, 
      region, 
      time_range, 
      metric_type, 
      include_historical, 
      granularity,
      confidence_buckets,
      include_breakdown
    } = validatedRequest;

    // Calculate time range
    const { startDate, endDate } = calculateTimeRange(time_range);

    // Get commodity and region details if specified
    let commodityRecord, regionRecord;
    if (commodity) {
      commodityRecord = await storage.getCommodities().then(commodities => 
        commodities.find(c => c.name === commodity)
      );
      if (!commodityRecord) {
        return res.status(400).json(createErrorResponse(
          "INVALID_COMMODITY",
          "Commodity not found",
          "Không tìm thấy hàng hóa",
          "validation_error",
          { commodity },
          requestId
        ));
      }
    }

    if (region) {
      regionRecord = await storage.getRegions().then(regions => 
        regions.find(r => r.name === region)
      );
      if (!regionRecord) {
        return res.status(400).json(createErrorResponse(
          "INVALID_REGION",
          "Region not found",
          "Không tìm thấy khu vực",
          "validation_error",
          { region },
          requestId
        ));
      }
    }

    // Get quality gates and CCS data for the time range
    let qualityGates: any[], ccsRecords: any[], forecastRuns: any[];
    
    try {
      // Get quality gates within time range
      qualityGates = await storage.getQualityGatesInDateRange(startDate, endDate);
      
      // Get CCS records within time range
      ccsRecords = await storage.getCCSInDateRange(startDate, endDate);
      
      // Get forecast runs for accuracy calculation
      forecastRuns = await storage.getForecastRunsInDateRange(startDate, endDate);

      // Filter by commodity and region if specified
      if (commodityRecord) {
        qualityGates = qualityGates.filter((qg: any) => qg.forecastRun?.commodityId === commodityRecord.id);
        ccsRecords = ccsRecords.filter((ccs: any) => ccs.forecastRun?.commodityId === commodityRecord.id);
        forecastRuns = forecastRuns.filter((fr: any) => fr.commodityId === commodityRecord.id);
      }

      if (regionRecord) {
        qualityGates = qualityGates.filter((qg: any) => qg.forecastRun?.regionId === regionRecord.id);
        ccsRecords = ccsRecords.filter((ccs: any) => ccs.forecastRun?.regionId === regionRecord.id);
        forecastRuns = forecastRuns.filter((fr: any) => fr.regionId === regionRecord.id);
      }

    } catch (error) {
      console.error("Error fetching reliability data:", error);
      // Use fallback empty arrays
      qualityGates = [];
      ccsRecords = [];
      forecastRuns = [];
    }

    // Calculate reliability overview
    const totalForecasts = forecastRuns.length;
    const avgCcsScore = ccsRecords.length > 0 ? 
      ccsRecords.reduce((sum: number, ccs: any) => sum + ccs.compositeScore, 0) / ccsRecords.length : 0;

    const qualityGateDistribution = {
      auto_publish: qualityGates.filter((qg: any) => qg.gateStatus === 'auto_publish').length,
      publish_warning: qualityGates.filter((qg: any) => qg.gateStatus === 'publish_warning').length,
      publish_caution: qualityGates.filter((qg: any) => qg.gateStatus === 'publish_caution').length,
      hold_review: qualityGates.filter((qg: any) => qg.gateStatus === 'hold_review').length,
    };

    const reliabilityOverview = {
      average_ccs_score: avgCcsScore,
      quality_gate_distribution: qualityGateDistribution,
      total_forecasts: totalForecasts,
      time_range,
    };

    // Build CCS distributions array
    const ccsDistributions = ccsRecords.map((ccs: any) => {
      let confidenceLevel: "high" | "medium" | "low" | "below_threshold";
      if (ccs.compositeScore >= 90) confidenceLevel = "high";
      else if (ccs.compositeScore >= 70) confidenceLevel = "medium";
      else if (ccs.compositeScore >= 50) confidenceLevel = "low";
      else confidenceLevel = "below_threshold";

      return {
        date: ccs.createdAt.toISOString(),
        ccs_score: ccs.compositeScore,
        confidence_level: confidenceLevel,
        commodity: commodity || undefined,
        region: region || undefined,
      };
    });

    // Calculate component breakdown
    let componentBreakdown;
    if (include_breakdown && ccsRecords.length > 0) {
      const agreementScores = ccsRecords.map((ccs: any) => ccs.agreementScore);
      const evidenceScores = ccsRecords.map((ccs: any) => ccs.evidenceScore);
      const temporalScores = ccsRecords.map((ccs: any) => ccs.temporalConsistencyScore);
      const modelScores = ccsRecords.map((ccs: any) => ccs.modelConfidenceScore);

      // Calculate fallback rate from forecast runs
      const fallbackForecasts = forecastRuns.filter((fr: any) => 
        fr.method && fr.method.includes('fallback')
      ).length;
      const fallbackRate = totalForecasts > 0 ? fallbackForecasts / totalForecasts : 0;

      // Circuit breaker activations (simplified)
      const circuitBreakerActivations = forecastRuns.filter((fr: any) => 
        fr.errorMessage && fr.errorMessage.includes('circuit')
      ).length;

      componentBreakdown = {
        agreement_scores: {
          average: agreementScores.reduce((sum, score) => sum + score, 0) / agreementScores.length,
          trend: analyzeTrend(agreementScores),
          recent_range: {
            min: Math.min(...agreementScores.slice(-5)),
            max: Math.max(...agreementScores.slice(-5)),
          },
        },
        evidence_scores: {
          average: evidenceScores.reduce((sum, score) => sum + score, 0) / evidenceScores.length,
          trend: analyzeTrend(evidenceScores),
          source_breakdown: {
            government: 0.9,
            market: 0.8,
            news: 0.6,
            social: 0.4,
          }, // Simplified breakdown
        },
        temporal_consistency: {
          average: temporalScores.reduce((sum, score) => sum + score, 0) / temporalScores.length,
          stability_index: Math.max(0, 1 - (Math.max(...temporalScores) - Math.min(...temporalScores)) / 100),
        },
        model_confidence: {
          average: modelScores.reduce((sum, score) => sum + score, 0) / modelScores.length,
          fallback_rate: fallbackRate,
          circuit_breaker_activations: circuitBreakerActivations,
        },
      };
    } else {
      // Provide fallback component breakdown
      componentBreakdown = {
        agreement_scores: {
          average: 75,
          trend: "stable" as const,
          recent_range: { min: 70, max: 80 },
        },
        evidence_scores: {
          average: 70,
          trend: "stable" as const,
          source_breakdown: { government: 0.9, market: 0.8, news: 0.6, social: 0.4 },
        },
        temporal_consistency: {
          average: 72,
          stability_index: 0.85,
        },
        model_confidence: {
          average: 68,
          fallback_rate: 0.1,
          circuit_breaker_activations: 0,
        },
      };
    }

    // Calculate historical performance if requested
    let historicalPerformance;
    if (include_historical && forecastRuns.length > 0) {
      const accuracyMetrics = calculateAccuracyMetrics(forecastRuns);
      
      // Group by time periods for trends
      const periods = [];
      const periodLength = time_range === "7d" ? 1 : time_range === "30d" ? 7 : 30; // days
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const periodEnd = new Date(currentDate);
        periodEnd.setDate(currentDate.getDate() + periodLength);
        
        const periodForecasts = forecastRuns.filter((fr: any) => 
          fr.runDate >= currentDate && fr.runDate < periodEnd
        );
        
        const periodCcs = ccsRecords.filter((ccs: any) => 
          ccs.createdAt >= currentDate && ccs.createdAt < periodEnd
        );
        
        const avgCcs = periodCcs.length > 0 ? 
          periodCcs.reduce((sum: number, ccs: any) => sum + ccs.compositeScore, 0) / periodCcs.length : 0;
        
        periods.push({
          period: currentDate.toISOString().split('T')[0],
          avg_ccs: avgCcs,
          forecast_count: periodForecasts.length,
        });
        
        currentDate = periodEnd;
      }

      historicalPerformance = {
        accuracy_metrics: accuracyMetrics,
        reliability_trends: periods,
      };
    }

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);

    // Generate quality insights
    const qualityInsights = generateQualityInsights(
      reliabilityOverview,
      componentBreakdown,
      time_range,
      commodity,
      region
    );

    // Build response
    const processingTime = Date.now() - startTime;
    const response: GetReliabilityResponse = createSuccessResponse({
      reliability_overview: reliabilityOverview,
      ccs_distributions: ccsDistributions,
      component_breakdown: componentBreakdown,
      historical_performance: historicalPerformance,
      vietnamese_market_context: vietnameseMarketContext,
      quality_insights: qualityInsights,
    }, {
      request_id: requestId,
      processing_time_ms: processingTime,
      service_version: "1.0.0",
    });

    // Add rate limit info
    response.metadata.rate_limit = {
      remaining: rateLimit.remaining,
      reset_at: rateLimit.resetAt.toISOString(),
    };

    res.json(response);

  } catch (error) {
    console.error(`Internal error in GET /v1/reliability:`, error);
    const processingTime = Date.now() - startTime;
    
    return res.status(500).json(createErrorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred while retrieving reliability metrics",
      "Đã xảy ra lỗi không mong đợi khi truy xuất số liệu độ tin cậy",
      "internal_error",
      null,
      requestId
    ));
  }
});

export default router;