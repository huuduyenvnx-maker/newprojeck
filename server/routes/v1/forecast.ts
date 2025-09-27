import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireWriteAccess } from "../../middleware/session-auth";
import { forecastService } from "../../services/forecast";
import { qualityGatesEngine } from "../../services/quality-gates";
import { currencyConverter } from "../../services/currency-converter";
import { 
  generateForecast30dRequestSchema, 
  getForecast30dRequestSchema,
  getVietnameseSeasonalContext,
  isVietnameseMarketHours,
  type GenerateForecast30dRequest,
  type GetForecast30dRequest
} from "../../schemas/v1-requests";
import { 
  createSuccessResponse, 
  createErrorResponse,
  type GenerateForecast30dResponse,
  type GetForecast30dResponse,
  type VietnameseMarketContext,
  type QualityMetrics
} from "../../schemas/v1-responses";

const router = Router();

// Rate limiting tracking (simple in-memory for now)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 10; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Helper function to check rate limits
const checkRateLimit = (clientId: string): { allowed: boolean; remaining: number; resetAt: Date } => {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  
  if (now > clientData.resetTime) {
    // Reset window
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
  
  // Regional specifics mapping
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

// Helper function to convert quality gate results to API format
const buildQualityMetrics = (qualityGateResult: any): QualityMetrics => {
  return {
    ccs_score: qualityGateResult.ccsResult.compositeScore,
    quality_gate_status: qualityGateResult.qualityGateDecision.gateStatus,
    confidence_level: qualityGateResult.qualityGateDecision.confidenceLevel,
    ui_indicator: qualityGateResult.qualityGateDecision.uiIndicator,
    component_scores: {
      agreement_score: qualityGateResult.ccsResult.componentScores.agreementScore,
      evidence_score: qualityGateResult.ccsResult.componentScores.evidenceScore,
      source_credibility_score: qualityGateResult.ccsResult.componentScores.sourceCredibilityScore,
      temporal_consistency_score: qualityGateResult.ccsResult.componentScores.temporalConsistencyScore,
      model_confidence_score: qualityGateResult.ccsResult.componentScores.modelConfidenceScore,
    },
    warning_message: qualityGateResult.qualityGateDecision.warningMessage,
    recommendations: qualityGateResult.overallAssessment.recommendations,
  };
};

// Helper function to convert predictions to API format with currency conversion
const convertPredictionsToApiFormat = async (predictions: any[], exchangeRate: number) => {
  return predictions.map((pred, index) => ({
    date: pred.date,
    days_ahead: index + 1,
    median: pred.median,
    q10: pred.q10,
    q25: pred.q25,
    q75: pred.q75,
    q90: pred.q90,
    confidence: pred.confidence,
    trend: pred.trend,
    volatility: pred.volatility,
    price_vnd: pred.median * exchangeRate,
    price_usd: pred.median,
  }));
};

// ===========================================
// POST /v1/forecast-30d - Generate Forecast
// ===========================================

router.post("/forecast-30d", requireWriteAccess, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
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

    // Validate request body
    let validatedRequest: GenerateForecast30dRequest;
    try {
      validatedRequest = generateForecast30dRequestSchema.parse({
        ...req.body,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid request parameters",
          "Tham số yêu cầu không hợp lệ",
          "validation_error",
          { validation_errors: error.errors },
          requestId
        ));
      }
      throw error;
    }

    const { commodity, region, horizon, confidence_threshold, include_quality_gates, include_llm_verification, context_overrides } = validatedRequest;

    // Check market hours for real-time requests
    if (!isVietnameseMarketHours()) {
      console.log(`Request outside market hours for commodity: ${commodity}, region: ${region}`);
      // Still process but add note in response
    }

    // Get commodity and region details for validation
    const [commodityRecord, regionRecord] = await Promise.all([
      storage.getCommodities().then(commodities => commodities.find(c => c.name === commodity)),
      storage.getRegions().then(regions => regions.find(r => r.name === region))
    ]);

    if (!commodityRecord || !regionRecord) {
      return res.status(400).json(createErrorResponse(
        "INVALID_COMMODITY_REGION",
        "Commodity or region not found in database",
        "Không tìm thấy hàng hóa hoặc khu vực trong cơ sở dữ liệu",
        "validation_error",
        { commodity, region },
        requestId
      ));
    }

    // Generate forecast using existing service
    let forecastResult;
    try {
      // Apply context overrides if provided
      if (context_overrides) {
        console.log(`Applying context overrides for ${commodity} in ${region}:`, context_overrides);
      }

      forecastResult = await forecastService.generateForecast(
        commodityRecord.id, 
        regionRecord.id, 
        horizon
      );
    } catch (error: any) {
      console.error(`Forecast generation failed for ${commodity} in ${region}:`, error);
      
      // Handle specific forecast service errors
      if (error.statusCode === 400) {
        return res.status(400).json(createErrorResponse(
          "INSUFFICIENT_DATA",
          error.message,
          "Không đủ dữ liệu lịch sử để tạo dự báo",
          "insufficient_data",
          null,
          requestId
        ));
      }
      
      return res.status(503).json(createErrorResponse(
        "FORECAST_SERVICE_ERROR",
        "Forecast generation service temporarily unavailable",
        "Dịch vụ tạo dự báo tạm thời không khả dụng",
        "service_unavailable",
        { circuit_breaker_status: "UNKNOWN" },
        requestId
      ));
    }

    // Get the 30d forecast record
    const forecast30dRecord = await storage.getForecast30d(forecastResult.id);
    if (!forecast30dRecord) {
      throw new Error("No 30d forecast record found after generation");
    }

    // Run quality gate analysis if requested
    let qualityMetrics: QualityMetrics | undefined;
    let qualityGateResult;
    
    if (include_quality_gates) {
      try {
        qualityGateResult = await qualityGatesEngine.runQualityGateAnalysis(
          forecastResult.id,
          forecast30dRecord.id
        );
        qualityMetrics = buildQualityMetrics(qualityGateResult);
      } catch (error) {
        console.error(`Quality gate analysis failed for forecast ${forecastResult.id}:`, error);
        // Don't fail the entire request, just note the issue
        qualityMetrics = {
          ccs_score: 50, // Conservative fallback
          quality_gate_status: "publish_caution",
          confidence_level: "medium",
          ui_indicator: "yellow",
          component_scores: {
            agreement_score: 50,
            evidence_score: 50,
            source_credibility_score: 50,
            temporal_consistency_score: 50,
            model_confidence_score: 50,
          },
          recommendations: ["Quality analysis temporarily unavailable - manual review recommended"],
        };
      }
    }

    // Get LLM verification status if requested
    let llmVerificationStatus = {
      status: "pending" as "pending" | "completed" | "failed",
      openai_verification_id: undefined as string | undefined,
      gemini_verification_id: undefined as string | undefined,
      agreement_score: undefined as number | undefined,
    };

    if (include_llm_verification) {
      try {
        // Check if verifications already exist
        const existingVerifications = await storage.getVerificationsByForecast30d({ coopId: req.auth?.coopId || '', userId: req.auth?.userId || '', role: req.auth?.role || 'farmer' }, forecast30dRecord.id);
        
        if (existingVerifications.length >= 2) {
          llmVerificationStatus = {
            status: "completed" as "pending" | "completed" | "failed",
            openai_verification_id: existingVerifications.find(v => v.provider === 'openai')?.id,
            gemini_verification_id: existingVerifications.find(v => v.provider === 'gemini')?.id,
            agreement_score: qualityGateResult?.agreementResult?.agreementScore,
          };
        } else {
          llmVerificationStatus.status = "pending";
          // LLM verification will be triggered by the quality gates if needed
        }
      } catch (error) {
        console.error(`LLM verification check failed:`, error);
        llmVerificationStatus.status = "failed";
      }
    }

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);
    
    // Convert predictions to API format with currency conversion
    const apiPredictions = await convertPredictionsToApiFormat(
      forecastResult.predictions, 
      vietnameseMarketContext.currency_info.exchange_rate_vnd_usd
    );

    // Build response
    const processingTime = Date.now() - startTime;
    const response: GenerateForecast30dResponse = createSuccessResponse({
      forecast_run_id: forecastResult.id,
      forecast_30d_id: forecast30dRecord.id,
      commodity,
      region,
      forecast_date: new Date().toISOString(),
      horizon,
      predictions: apiPredictions,
      metrics: {
        mase: forecastResult.metrics?.mase || 0,
        smape: forecastResult.metrics?.smape || 0,
        picp: forecastResult.metrics?.picp || 0,
        fqs: forecastResult.metrics?.fqs || 0,
        model_version: forecastResult.modelVersion,
      },
      quality_metrics: qualityMetrics!,
      vietnamese_market_context: vietnameseMarketContext,
      llm_verification: llmVerificationStatus,
      processing_info: {
        model_type: forecastResult.method,
        circuit_breaker_status: forecastResult.circuitBreakerStats?.state || "CLOSED",
        fallback_used: forecastResult.method.includes('fallback'),
        optimization_source: forecastResult.mlServiceMetadata?.optimizationSource || "default",
      },
    }, {
      request_id: requestId,
      processing_time_ms: processingTime,
      service_version: "1.0.0",
    });

    // Add rate limit info to metadata
    response.metadata.rate_limit = {
      remaining: rateLimit.remaining,
      reset_at: rateLimit.resetAt.toISOString(),
    };

    res.status(201).json(response);

  } catch (error) {
    console.error(`Internal error in POST /v1/forecast-30d:`, error);
    const processingTime = Date.now() - startTime;
    
    return res.status(500).json(createErrorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      "Đã xảy ra lỗi không mong đợi",
      "internal_error",
      null,
      requestId
    ));
  }
});

// ===========================================
// GET /v1/forecast-30d - Retrieve Forecasts
// ===========================================

router.get("/forecast-30d", requireAuth, async (req: Request, res: Response) => {
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
    let validatedRequest: GetForecast30dRequest;
    try {
      validatedRequest = getForecast30dRequestSchema.parse(req.query);
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

    const { commodity, region, limit, offset, include_quality_gates, include_verifications, active_only, date_range } = validatedRequest;

    // Get commodity and region IDs
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

    // Get forecasts based on parameters
    let forecasts;
    if (active_only) {
      forecasts = await storage.getActiveForecasts({ coopId: req.auth?.coopId || '', userId: req.auth?.userId || '', role: req.auth?.role || 'farmer' }, commodityRecord.id, regionRecord.id);
    } else {
      // Get all forecasts with date range filtering if provided
      forecasts = await storage.getAllActiveForecasts({ coopId: req.auth?.coopId || '', userId: req.auth?.userId || '', role: req.auth?.role || 'farmer' });
    }

    // Apply date filtering
    if (date_range) {
      const startDate = new Date(date_range.start_date);
      const endDate = new Date(date_range.end_date);
      forecasts = forecasts.filter((f: any) => {
        const forecastDate = new Date(f.forecastDate);
        return forecastDate >= startDate && forecastDate <= endDate;
      });
    }

    // Apply pagination
    const total = forecasts.length;
    const paginatedForecasts = forecasts.slice(offset, offset + limit);

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);

    // Enhance forecasts with additional data
    const enhancedForecasts = await Promise.all(
      paginatedForecasts.map(async (forecast: any) => {
        let qualityMetrics: QualityMetrics | undefined;
        
        if (include_quality_gates) {
          try {
            const qualityGate = await qualityGatesEngine.getQualityGateStatus(forecast.id);
            if (qualityGate) {
              // Convert quality gate to metrics format
              const ccsRecord = await storage.getCcsByForecastRun(forecast.id);
              if (ccsRecord) {
                qualityMetrics = {
                  ccs_score: Number(ccsRecord.compositeScore) || 0,
                  quality_gate_status: qualityGate.gateStatus as "auto_publish" | "publish_warning" | "publish_caution" | "hold_review",
                  confidence_level: qualityGate.confidenceLevel as "low" | "medium" | "high" | "below_threshold",
                  ui_indicator: qualityGate.uiIndicator as "green" | "yellow" | "red" | "blocked",
                  component_scores: {
                    agreement_score: Number(ccsRecord.agreementScore) || 0,
                    evidence_score: Number(ccsRecord.evidenceScore) || 0,
                    source_credibility_score: Number(ccsRecord.sourceCredibilityScore) || 0,
                    temporal_consistency_score: Number(ccsRecord.temporalConsistencyScore) || 0,
                    model_confidence_score: Number(ccsRecord.modelConfidenceScore) || 0,
                  },
                  warning_message: qualityGate.warningMessage || undefined,
                  recommendations: [],
                };
              }
            }
          } catch (error) {
            console.error(`Failed to get quality metrics for forecast ${forecast.id}:`, error);
          }
        }

        // Get 30d forecast records for this forecast run
        const forecast30dRecord = await storage.getForecast30d(forecast.id);
        
        // Convert predictions to API format
        const predictions = await convertPredictionsToApiFormat(
          forecast.predictions || [],
          vietnameseMarketContext.currency_info.exchange_rate_vnd_usd
        );

        return {
          forecast_run_id: forecast.id,
          forecast_30d_id: forecast30dRecord?.id || forecast.id,
          commodity,
          region,
          forecast_date: forecast.forecastDate.toISOString(),
          horizon: forecast.horizon,
          predictions,
          quality_metrics: qualityMetrics,
          vietnamese_market_context: vietnameseMarketContext,
        };
      })
    );

    // Build response
    const processingTime = Date.now() - startTime;
    const response: GetForecast30dResponse = createSuccessResponse({
      forecasts: enhancedForecasts,
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + limit < total,
      },
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
    console.error(`Internal error in GET /v1/forecast-30d:`, error);
    const processingTime = Date.now() - startTime;
    
    return res.status(500).json(createErrorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      "Đã xảy ra lỗi không mong đợi",
      "internal_error",
      null,
      requestId
    ));
  }
});

export default router;