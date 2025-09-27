import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireWriteAccess } from "../../middleware/session-auth";
import { qualityGatesEngine } from "../../services/quality-gates";
import { currencyConverter } from "../../services/currency-converter";
import { 
  getActionsRequestSchema, 
  getVietnameseSeasonalContext,
  isVietnameseMarketHours,
  type GetActionsRequest
} from "../../schemas/v1-requests";
import { 
  createSuccessResponse, 
  createErrorResponse,
  type GetActionsResponse,
  type VietnameseMarketContext
} from "../../schemas/v1-responses";

const router = Router();

// Rate limiting tracking (simple in-memory for now)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 20; // Higher limit for actions (read-only)
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
  commodity: string, 
  region: string
): Promise<VietnameseMarketContext> => {
  const seasonalContext = getVietnameseSeasonalContext();
  
  // Get exchange rate with proper error handling and fallback
  let exchangeRateInfo;
  try {
    // Note: Using fallback exchange rate for now until proper method is available
    exchangeRateInfo = { rate: 24000, date: new Date() }; // Fallback USD to VND rate
  } catch (error) {
    console.warn("Failed to fetch USD/VND exchange rate, using fallback:", error);
    exchangeRateInfo = null;
  }
  
  // Fallback exchange rate data (approximate recent USD/VND rate)
  const fallbackRate = 24000; // Approximate VND per USD
  const fallbackTimestamp = new Date();
  
  const exchangeRate = exchangeRateInfo?.rate || fallbackRate;
  const rateTimestamp = exchangeRateInfo?.date || fallbackTimestamp;
  
  const regionalSpecifics = {
    'mekong-delta': { export_orientation: 0.8, infrastructure_score: 85, climate_risk_level: 'medium' as const },
    'central-highlands': { export_orientation: 0.9, infrastructure_score: 75, climate_risk_level: 'high' as const },
    'red-river-delta': { export_orientation: 0.6, infrastructure_score: 90, climate_risk_level: 'medium' as const },
    'southeast': { export_orientation: 0.7, infrastructure_score: 88, climate_risk_level: 'low' as const },
    'north-central': { export_orientation: 0.5, infrastructure_score: 70, climate_risk_level: 'medium' as const },
    'south-central': { export_orientation: 0.6, infrastructure_score: 72, climate_risk_level: 'high' as const },
    'north-mountain': { export_orientation: 0.4, infrastructure_score: 65, climate_risk_level: 'high' as const },
  };

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
    regional_specifics: regionalSpecifics[region as keyof typeof regionalSpecifics] || {
      export_orientation: 0.6,
      infrastructure_score: 75,
      climate_risk_level: 'medium',
    },
  };
};

// Helper function to determine market timing based on quality metrics and market conditions
const determineMarketTiming = (
  ccsScore: number, 
  confidence: number, 
  vietnameseContext: VietnameseMarketContext,
  action: string
): { entry_timeframe: "immediate" | "1-3days" | "1-2weeks" | "monitor"; exit_strategy: string; hold_period: string } => {
  const isHighConfidence = ccsScore >= 80 && confidence >= 80;
  const isMediumConfidence = ccsScore >= 60 && confidence >= 60;
  const isMarketHours = isVietnameseMarketHours();
  const isMonsoonSeason = vietnameseContext.seasonal_context.current_season === "monsoon";
  
  if (action === "hold" || action === "monitor") {
    return {
      entry_timeframe: "monitor",
      exit_strategy: "Wait for stronger signal or market change",
      hold_period: "Continuous monitoring required"
    };
  }

  let entry_timeframe: "immediate" | "1-3days" | "1-2weeks" | "monitor";
  let exit_strategy: string;
  let hold_period: string;

  if (isHighConfidence && isMarketHours && !isMonsoonSeason) {
    entry_timeframe = "immediate";
    exit_strategy = "Take profit at target or stop loss activation";
    hold_period = action === "buy" ? "1-4 weeks" : "1-2 weeks";
  } else if (isMediumConfidence && !isMonsoonSeason) {
    entry_timeframe = "1-3days";
    exit_strategy = "Monitor daily, exit on confidence degradation";
    hold_period = "2-6 weeks";
  } else if (isMonsoonSeason) {
    entry_timeframe = "1-2weeks";
    exit_strategy = "Wait for seasonal stability, monitor weather patterns";
    hold_period = "Post-monsoon period (1-3 months)";
  } else {
    entry_timeframe = "monitor";
    exit_strategy = "Wait for confidence improvement";
    hold_period = "Until quality metrics improve";
  }

  return { entry_timeframe, exit_strategy, hold_period };
};

// Helper function to calculate price targets based on predictions and risk tolerance
const calculatePriceTargets = (
  currentPrice: number,
  predictions: any[],
  action: string,
  riskTolerance: string,
  exchangeRate: number
) => {
  if (!predictions || predictions.length === 0) {
    return {
      entry_price_vnd: undefined,
      entry_price_usd: undefined,
      target_price_vnd: undefined,
      target_price_usd: undefined,
      stop_loss_vnd: undefined,
      stop_loss_usd: undefined,
    };
  }

  const targetPrediction = predictions[Math.min(predictions.length - 1, 29)]; // 30-day target
  const expectedPrice = targetPrediction.median;
  
  // Risk tolerance multipliers
  const riskMultipliers = {
    conservative: { target: 1.05, stop: 0.97 },
    low: { target: 1.08, stop: 0.95 },
    medium: { target: 1.12, stop: 0.92 },
    high: { target: 1.18, stop: 0.88 },
    aggressive: { target: 1.25, stop: 0.85 },
  };

  const multiplier = riskMultipliers[riskTolerance as keyof typeof riskMultipliers] || riskMultipliers.medium;

  let targetPriceUsd, stopLossUsd;
  
  if (action === "buy") {
    targetPriceUsd = expectedPrice * multiplier.target;
    stopLossUsd = currentPrice * multiplier.stop;
  } else if (action === "sell") {
    targetPriceUsd = expectedPrice * (2 - multiplier.target); // Inverse for sell
    stopLossUsd = currentPrice * (2 - multiplier.stop);
  } else {
    // For hold/monitor, use current price as baseline
    targetPriceUsd = expectedPrice;
    stopLossUsd = currentPrice * multiplier.stop;
  }

  return {
    entry_price_vnd: currentPrice * exchangeRate,
    entry_price_usd: currentPrice,
    target_price_vnd: targetPriceUsd * exchangeRate,
    target_price_usd: targetPriceUsd,
    stop_loss_vnd: stopLossUsd * exchangeRate,
    stop_loss_usd: stopLossUsd,
  };
};

// Helper function to generate Vietnamese market insights
const generateVietnameseMarketInsights = (
  commodity: string,
  region: string,
  action: string,
  vietnameseContext: VietnameseMarketContext,
  seasonalContext: any
) => {
  const exportOriented = vietnameseContext.regional_specifics.export_orientation > 0.7;
  const isHarvestSeason = seasonalContext.isHarvestSeason[commodity as keyof typeof seasonalContext.isHarvestSeason];
  
  // Export opportunity assessment
  const exportOpportunity = exportOriented && (action === "sell" || action === "hold");
  
  // Domestic demand assessment
  let domesticDemand: "low" | "medium" | "high";
  if (commodity === "rice" && region.includes("delta")) {
    domesticDemand = isHarvestSeason ? "high" : "medium";
  } else if (commodity === "coffee" && exportOriented) {
    domesticDemand = "low"; // Coffee is primarily export-oriented
  } else {
    domesticDemand = "medium";
  }
  
  // Seasonal timing insights
  let seasonalTiming: string;
  if (seasonalContext.isMonsoonSeason) {
    seasonalTiming = "Monsoon season - higher risk for transportation and storage";
  } else if (isHarvestSeason) {
    seasonalTiming = `${commodity} harvest season - supply peak expected`;
  } else {
    seasonalTiming = "Off-season - stable supply conditions";
  }
  
  // Regulatory considerations
  const regulatoryConsiderations = [];
  if (exportOriented) {
    regulatoryConsiderations.push("Export license and quota requirements");
    regulatoryConsiderations.push("International trade regulations compliance");
  }
  if (commodity === "rice") {
    regulatoryConsiderations.push("Food security regulations may apply");
  }
  if (seasonalContext.isMonsoonSeason) {
    regulatoryConsiderations.push("Weather-related transport restrictions possible");
  }

  return {
    export_opportunity: exportOpportunity,
    domestic_demand: domesticDemand,
    seasonal_timing: seasonalTiming,
    regulatory_considerations: regulatoryConsiderations,
  };
};

// Helper function to assess risk factors and mitigation strategies
const assessRiskAndMitigation = (
  commodity: string,
  region: string,
  action: string,
  ccsScore: number,
  vietnameseContext: VietnameseMarketContext
) => {
  const riskFactors = [];
  const mitigationStrategies = [];

  // Quality/confidence risks
  if (ccsScore < 70) {
    riskFactors.push("Below-average forecast confidence");
    mitigationStrategies.push("Monitor daily price movements and quality updates");
  }

  // Weather risks
  if (vietnameseContext.seasonal_context.current_season === "monsoon") {
    riskFactors.push("Monsoon weather impact on production and logistics");
    mitigationStrategies.push("Consider weather insurance or delayed execution");
  }

  // Regional risks
  if (vietnameseContext.regional_specifics.climate_risk_level === "high") {
    riskFactors.push("High climate risk in target region");
    mitigationStrategies.push("Diversify across multiple regions if possible");
  }

  // Currency risks
  if (action === "buy" || action === "sell") {
    riskFactors.push("VND/USD exchange rate volatility");
    mitigationStrategies.push("Consider currency hedging for large positions");
  }

  // Export/import risks
  if (vietnameseContext.regional_specifics.export_orientation > 0.7) {
    riskFactors.push("International market volatility exposure");
    mitigationStrategies.push("Monitor global commodity prices and trade policies");
  }

  // Infrastructure risks
  if (vietnameseContext.regional_specifics.infrastructure_score < 75) {
    riskFactors.push("Transportation and storage limitations");
    mitigationStrategies.push("Plan for additional logistics costs and delays");
  }

  // Determine overall risk level
  let riskLevel: "low" | "medium" | "high";
  if (riskFactors.length <= 2 && ccsScore >= 80) {
    riskLevel = "low";
  } else if (riskFactors.length <= 4 && ccsScore >= 60) {
    riskLevel = "medium";
  } else {
    riskLevel = "high";
  }

  return {
    risk_level: riskLevel,
    risk_factors: riskFactors,
    mitigation_strategies: mitigationStrategies,
  };
};

// ===========================================
// GET /v1/actions - Trading Recommendations
// ===========================================

router.get("/actions", requireAuth, async (req: Request, res: Response) => {
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
    let validatedRequest: GetActionsRequest;
    try {
      validatedRequest = getActionsRequestSchema.parse(req.query);
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
      risk_tolerance, 
      timeframe, 
      min_confidence, 
      currency,
      include_inactive,
      action_types,
      vietnamese_market_context: marketContextOverrides
    } = validatedRequest;

    // Get commodity and region details
    const [commodityRecord, regionRecord] = await Promise.all([
      storage.getCommodities().then(commodities => commodities.find(c => c.name === commodity)),
      storage.getRegions().then(regions => regions.find(r => r.name === region))
    ]);

    if (!commodityRecord || !regionRecord) {
      return res.status(400).json(createErrorResponse(
        "INVALID_COMMODITY_REGION",
        "Commodity or region not found",
        "Không tìm thấy hàng hóa hoặc khu vực",
        "validation_error",
        { commodity, region },
        requestId
      ));
    }

    // Get active forecasts for the commodity and region
    const forecasts = await storage.getActiveForecasts(commodityRecord.id, regionRecord.id);
    
    if (forecasts.length === 0) {
      return res.status(404).json(createErrorResponse(
        "NO_FORECASTS_AVAILABLE",
        "No active forecasts available for the specified commodity and region",
        "Không có dự báo hoạt động nào cho hàng hóa và khu vực đã chỉ định",
        "insufficient_data",
        { commodity, region },
        requestId
      ));
    }

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);
    const seasonalContext = getVietnameseSeasonalContext();

    // Get recommendations from storage and enhance them
    const recommendations = [];
    let totalRecommendations = 0;
    let highConfidenceCount = 0;
    const riskDistribution = { low: 0, medium: 0, high: 0 };

    for (const forecast of forecasts) {
      try {
        // Get existing trading recommendations
        const existingRecommendations = await storage.getRecommendations(forecast.id);
        
        // Get quality gate status for confidence assessment
        let ccsScore = 50; // Default fallback
        let qualityGateStatus = "publish_caution";
        
        try {
          const qualityGate = await qualityGatesEngine.getQualityGateStatus(forecast.id);
          if (qualityGate) {
            qualityGateStatus = qualityGate.gateStatus;
            
            // Get CCS score
            const ccsRecord = await storage.getCcs(forecast.id);
            if (ccsRecord) {
              ccsScore = typeof ccsRecord.compositeScore === 'string' ? parseFloat(ccsRecord.compositeScore) : ccsRecord.compositeScore;
            }
          }
        } catch (error) {
          console.log(`Could not get quality metrics for forecast ${forecast.id}, using defaults`);
        }

        // Filter by confidence threshold
        if (ccsScore < min_confidence) {
          continue;
        }

        // Process existing recommendations or generate new ones
        for (const rec of existingRecommendations) {
          // Filter by action types
          if (!action_types.includes(rec.action as any)) {
            continue;
          }

          // Filter by confidence
          const recConfidence = parseFloat(rec.confidence);
          if (recConfidence < min_confidence) {
            continue;
          }

          totalRecommendations++;
          if (recConfidence >= 80 && ccsScore >= 80) {
            highConfidenceCount++;
          }

          // Calculate price targets with currency conversion
          const currentPrice = (forecast.predictions && Array.isArray(forecast.predictions) && forecast.predictions[0]) ? forecast.predictions[0].median : 100; // Fallback price
          const priceTargets = calculatePriceTargets(
            currentPrice,
            Array.isArray(forecast.predictions) ? forecast.predictions : [],
            rec.action,
            risk_tolerance,
            vietnameseMarketContext.currency_info.exchange_rate_vnd_usd
          );

          // Determine market timing
          const marketTiming = determineMarketTiming(
            ccsScore,
            recConfidence,
            vietnameseMarketContext,
            rec.action
          );

          // Assess risk factors
          const riskAssessment = assessRiskAndMitigation(
            commodity,
            region,
            rec.action,
            ccsScore,
            vietnameseMarketContext
          );

          // Update risk distribution counter
          riskDistribution[riskAssessment.risk_level]++;

          // Generate Vietnamese market insights
          const vietnameseMarketInsights = generateVietnameseMarketInsights(
            commodity,
            region,
            rec.action,
            vietnameseMarketContext,
            seasonalContext
          );

          recommendations.push({
            recommendation_id: rec.id,
            forecast_run_id: forecast.id,
            action: rec.action as "buy" | "sell" | "hold" | "monitor",
            confidence: recConfidence,
            reasoning: rec.reasoning,
            market_timing: marketTiming,
            price_targets: priceTargets,
            risk_assessment: riskAssessment,
            vietnamese_market_insights: vietnameseMarketInsights,
            created_at: rec.createdAt ? rec.createdAt.toISOString() : new Date().toISOString(),
          });
        }

        // If no existing recommendations, create default recommendations based on forecast
        if (existingRecommendations.length === 0 && forecast.predictions && Array.isArray(forecast.predictions) && forecast.predictions.length > 0) {
          const lastPrediction = forecast.predictions[forecast.predictions.length - 1];
          const firstPrediction = forecast.predictions[0];
          
          if (lastPrediction && firstPrediction) {
            const priceChange = (lastPrediction.median - firstPrediction.median) / firstPrediction.median;
            
            let recommendedAction: "buy" | "sell" | "hold" | "monitor";
            let reasoning: string;
            let actionConfidence = Math.min(ccsScore, 90); // Cap at 90% for generated recommendations
            
            if (priceChange > 0.05 && ccsScore >= 70) {
              recommendedAction = "buy";
              reasoning = `Forecast shows ${(priceChange * 100).toFixed(1)}% price increase expected over ${timeframe}`;
            } else if (priceChange < -0.05 && ccsScore >= 70) {
              recommendedAction = "sell";
              reasoning = `Forecast shows ${Math.abs(priceChange * 100).toFixed(1)}% price decrease expected over ${timeframe}`;
            } else if (ccsScore >= 60) {
              recommendedAction = "hold";
              reasoning = `Stable price trend expected with ${ccsScore.toFixed(1)}% forecast confidence`;
            } else {
              recommendedAction = "monitor";
              reasoning = `Low forecast confidence (${ccsScore.toFixed(1)}%) - monitor for better signals`;
              actionConfidence = Math.max(actionConfidence, 40); // Minimum confidence for monitor
            }

            // Filter by action types
            if (action_types.includes(recommendedAction)) {
              totalRecommendations++;
              if (actionConfidence >= 80 && ccsScore >= 80) {
                highConfidenceCount++;
              }

              const priceTargets = calculatePriceTargets(
                firstPrediction.median,
                Array.isArray(forecast.predictions) ? forecast.predictions : [],
                recommendedAction,
                risk_tolerance,
                vietnameseMarketContext.currency_info.exchange_rate_vnd_usd
              );

              const marketTiming = determineMarketTiming(
                ccsScore,
                actionConfidence,
                vietnameseMarketContext,
                recommendedAction
              );

              const riskAssessment = assessRiskAndMitigation(
                commodity,
                region,
                recommendedAction,
                ccsScore,
                vietnameseMarketContext
              );

              riskDistribution[riskAssessment.risk_level]++;

              const vietnameseMarketInsights = generateVietnameseMarketInsights(
                commodity,
                region,
                recommendedAction,
                vietnameseMarketContext,
                seasonalContext
              );

              recommendations.push({
                recommendation_id: uuidv4(),
                forecast_run_id: forecast.id,
                action: recommendedAction,
                confidence: actionConfidence,
                reasoning: reasoning,
                market_timing: marketTiming,
                price_targets: priceTargets,
                risk_assessment: riskAssessment,
                vietnamese_market_insights: vietnameseMarketInsights,
                created_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error processing forecast ${forecast.id}:`, error);
        // Continue with other forecasts
      }
    }

    // Determine overall market sentiment
    const buyActions = recommendations.filter(r => r.action === "buy").length;
    const sellActions = recommendations.filter(r => r.action === "sell").length;
    const holdActions = recommendations.filter(r => r.action === "hold").length;
    const monitorActions = recommendations.filter(r => r.action === "monitor").length;

    let overallSentiment: "bullish" | "bearish" | "neutral" | "mixed";
    if (buyActions > sellActions + holdActions) {
      overallSentiment = "bullish";
    } else if (sellActions > buyActions + holdActions) {
      overallSentiment = "bearish";
    } else if (holdActions > buyActions + sellActions) {
      overallSentiment = "neutral";
    } else {
      overallSentiment = "mixed";
    }

    // Build market summary
    const marketSummary = {
      overall_sentiment: overallSentiment,
      active_opportunities: recommendations.filter(r => r.action !== "monitor").length,
      high_confidence_actions: highConfidenceCount,
      risk_distribution: riskDistribution,
    };

    // Sort recommendations by confidence (highest first)
    recommendations.sort((a, b) => b.confidence - a.confidence);

    // Build response
    const processingTime = Date.now() - startTime;
    const response: GetActionsResponse = createSuccessResponse({
      recommendations,
      market_summary: marketSummary,
      vietnamese_market_context: vietnameseMarketContext,
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
    console.error(`Internal error in GET /v1/actions:`, error);
    const processingTime = Date.now() - startTime;
    
    return res.status(500).json(createErrorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred while retrieving trading recommendations",
      "Đã xảy ra lỗi không mong đợi khi truy xuất khuyến nghị giao dịch",
      "internal_error",
      null,
      requestId
    ));
  }
});

export default router;