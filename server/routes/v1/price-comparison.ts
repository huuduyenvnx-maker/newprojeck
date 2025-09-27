import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth } from "../../middleware/session-auth";
import { currencyConverter } from "../../services/currency-converter";
import { 
  createSuccessResponse, 
  createErrorResponse,
  type VietnameseMarketContext
} from "../../schemas/v1-responses";
import { 
  getVietnameseSeasonalContext,
  isVietnameseMarketHours 
} from "../../schemas/v1-requests";

const router = Router();

// Rate limiting tracking (simple in-memory for now)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 15; // requests per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Request schema for price vs forecast comparison
const getPriceVsForecastRequestSchema = z.object({
  commodity: z.string().min(1, "Commodity is required"),
  region: z.string().min(1, "Region is required"),
  date_range: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }).optional(),
  forecast_horizon: z.coerce.number().int().min(1).max(90).default(30),
  currency: z.enum(["VND", "USD"]).default("VND"),
  include_accuracy_metrics: z.coerce.boolean().default(true),
  granularity: z.enum(["daily", "weekly"]).default("daily")
});

type GetPriceVsForecastRequest = z.infer<typeof getPriceVsForecastRequestSchema>;

interface PriceVsForecastResponse {
  commodity: string;
  region: string;
  currency: string;
  comparison_period: {
    start_date: string;
    end_date: string;
    days_analyzed: number;
  };
  data_points: Array<{
    date: string;
    actual_price: number | null;
    forecast_price: number | null;
    forecast_confidence: number | null;
    forecast_lower_bound: number | null;
    forecast_upper_bound: number | null;
    error_absolute: number | null;
    error_percentage: number | null;
    within_confidence_band: boolean | null;
    data_quality: {
      actual: "verified" | "raw" | "missing";
      forecast: "high" | "medium" | "low" | "missing";
    };
  }>;
  accuracy_metrics: {
    mae: number; // Mean Absolute Error
    mape: number; // Mean Absolute Percentage Error  
    rmse: number; // Root Mean Square Error
    picp: number; // Prediction Interval Coverage Probability
    forecast_bias: number; // Average forecast error (positive = overestimate)
    accuracy_trend: "improving" | "stable" | "declining";
    valid_comparisons: number;
    total_comparisons: number;
  } | null;
  forecast_performance: {
    overall_accuracy: "excellent" | "good" | "fair" | "poor";
    confidence_calibration: "well_calibrated" | "overconfident" | "underconfident";
    trend_accuracy: "accurate" | "somewhat_accurate" | "inaccurate";
    recommendations: string[];
  };
  vietnamese_market_context: VietnameseMarketContext;
}

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

// Helper function to calculate accuracy metrics
const calculateAccuracyMetrics = (dataPoints: Array<{
  actual_price: number | null;
  forecast_price: number | null;
  forecast_lower_bound: number | null;
  forecast_upper_bound: number | null;
  within_confidence_band: boolean | null;
}>) => {
  // Filter valid comparison points
  const validPoints = dataPoints.filter(point => 
    point.actual_price !== null && 
    point.forecast_price !== null &&
    point.actual_price > 0 &&
    point.forecast_price > 0
  );

  if (validPoints.length === 0) {
    return {
      mae: 0,
      mape: 0,
      rmse: 0,
      picp: 0,
      forecast_bias: 0,
      accuracy_trend: 'stable' as const,
      valid_comparisons: 0,
      total_comparisons: dataPoints.length,
    };
  }

  // Calculate MAE (Mean Absolute Error)
  const mae = validPoints.reduce((sum, point) => {
    return sum + Math.abs(point.actual_price! - point.forecast_price!);
  }, 0) / validPoints.length;

  // Calculate MAPE (Mean Absolute Percentage Error)
  const mape = validPoints.reduce((sum, point) => {
    const percentageError = Math.abs(point.actual_price! - point.forecast_price!) / point.actual_price! * 100;
    return sum + percentageError;
  }, 0) / validPoints.length;

  // Calculate RMSE (Root Mean Square Error)
  const mse = validPoints.reduce((sum, point) => {
    const error = point.actual_price! - point.forecast_price!;
    return sum + (error * error);
  }, 0) / validPoints.length;
  const rmse = Math.sqrt(mse);

  // Calculate PICP (Prediction Interval Coverage Probability)
  const pointsWithBands = validPoints.filter(point => point.within_confidence_band !== null);
  const picp = pointsWithBands.length > 0 
    ? (pointsWithBands.filter(point => point.within_confidence_band).length / pointsWithBands.length) * 100
    : 0;

  // Calculate forecast bias (positive = overestimate, negative = underestimate)
  const forecast_bias = validPoints.reduce((sum, point) => {
    return sum + (point.forecast_price! - point.actual_price!);
  }, 0) / validPoints.length;

  // Calculate accuracy trend (simple approach: compare first half vs second half)
  const midPoint = Math.floor(validPoints.length / 2);
  const firstHalf = validPoints.slice(0, midPoint);
  const secondHalf = validPoints.slice(midPoint);

  const firstHalfMAE = firstHalf.length > 0 
    ? firstHalf.reduce((sum, point) => sum + Math.abs(point.actual_price! - point.forecast_price!), 0) / firstHalf.length
    : mae;
  const secondHalfMAE = secondHalf.length > 0 
    ? secondHalf.reduce((sum, point) => sum + Math.abs(point.actual_price! - point.forecast_price!), 0) / secondHalf.length
    : mae;

  let accuracy_trend: "improving" | "stable" | "declining";
  const improvementThreshold = 0.05; // 5% change threshold
  const improvement = (firstHalfMAE - secondHalfMAE) / firstHalfMAE;

  if (improvement > improvementThreshold) {
    accuracy_trend = 'improving';
  } else if (improvement < -improvementThreshold) {
    accuracy_trend = 'declining';
  } else {
    accuracy_trend = 'stable';
  }

  return {
    mae,
    mape,
    rmse,
    picp,
    forecast_bias,
    accuracy_trend,
    valid_comparisons: validPoints.length,
    total_comparisons: dataPoints.length,
  };
};

// Helper function to assess forecast performance
const assessForecastPerformance = (metrics: any) => {
  const { mape, picp, forecast_bias, accuracy_trend } = metrics;
  
  // Overall accuracy based on MAPE
  let overall_accuracy: "excellent" | "good" | "fair" | "poor";
  if (mape < 5) overall_accuracy = "excellent";
  else if (mape < 10) overall_accuracy = "good";
  else if (mape < 20) overall_accuracy = "fair";
  else overall_accuracy = "poor";

  // Confidence calibration based on PICP (should be around 90% for well-calibrated intervals)
  let confidence_calibration: "well_calibrated" | "overconfident" | "underconfident";
  if (picp >= 85 && picp <= 95) confidence_calibration = "well_calibrated";
  else if (picp < 85) confidence_calibration = "overconfident";
  else confidence_calibration = "underconfident";

  // Trend accuracy assessment
  let trend_accuracy: "accurate" | "somewhat_accurate" | "inaccurate";
  if (accuracy_trend === 'improving' || (accuracy_trend === 'stable' && mape < 15)) {
    trend_accuracy = "accurate";
  } else if (mape < 25) {
    trend_accuracy = "somewhat_accurate";
  } else {
    trend_accuracy = "inaccurate";
  }

  // Generate recommendations
  const recommendations: string[] = [];
  
  if (mape > 15) {
    recommendations.push("Consider model retraining to improve forecast accuracy");
  }
  if (Math.abs(forecast_bias) > 0.1) {
    const biasDirection = forecast_bias > 0 ? "overestimation" : "underestimation";
    recommendations.push(`Address systematic ${biasDirection} bias in forecasts`);
  }
  if (picp < 80) {
    recommendations.push("Confidence intervals may be too narrow - consider uncertainty quantification adjustments");
  }
  if (picp > 95) {
    recommendations.push("Confidence intervals may be too wide - model confidence could be improved");
  }
  if (accuracy_trend === 'declining') {
    recommendations.push("Forecast accuracy is declining - investigate potential data drift or market changes");
  }

  return {
    overall_accuracy,
    confidence_calibration,
    trend_accuracy,
    recommendations,
  };
};

// ===========================================
// GET /v1/price-vs-forecast - Compare Prices with Forecasts
// ===========================================

router.get("/price-vs-forecast", requireAuth, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Cache-Control': 'private, max-age=600', // 10 minutes private cache for comparison data
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
    let validatedRequest: GetPriceVsForecastRequest;
    try {
      validatedRequest = getPriceVsForecastRequestSchema.parse(req.query);
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

    const { commodity, region, date_range, forecast_horizon, currency, include_accuracy_metrics, granularity } = validatedRequest;

    // Check market hours for real-time requests
    if (!isVietnameseMarketHours()) {
      console.log(`Price vs forecast comparison request outside market hours for commodity: ${commodity}, region: ${region}`);
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

    // Get cooperative context for data access
    const context = {
      coopId: req.auth?.coopId || '',
      userId: req.auth?.userId || '',
      role: req.auth?.role || 'farmer'
    };

    // Calculate date range for comparison
    const endDate = date_range?.end_date ? new Date(date_range.end_date) : new Date();
    const startDate = date_range?.start_date ? new Date(date_range.start_date) : new Date(endDate.getTime() - forecast_horizon * 24 * 60 * 60 * 1000);

    // Get actual price data
    const actualPrices = await storage.getVerifiedPriceData(context, commodityRecord.id, regionRecord.id, startDate, endDate);

    // Get forecast data that overlaps with the actual price period
    const forecasts = await storage.getForecastsForComparison(context, commodityRecord.id, regionRecord.id, startDate, endDate);

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);
    const exchangeRate = vietnameseMarketContext.currency_info.exchange_rate_vnd_usd;

    // Create data points for comparison
    const dateMap = new Map<string, any>();
    
    // Add actual prices
    actualPrices.forEach(price => {
      const dateKey = price.date.toISOString().split('T')[0];
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          actual_price: null,
          forecast_price: null,
          forecast_confidence: null,
          forecast_lower_bound: null,
          forecast_upper_bound: null,
          error_absolute: null,
          error_percentage: null,
          within_confidence_band: null,
          data_quality: {
            actual: "missing" as const,
            forecast: "missing" as const,
          }
        });
      }
      
      const point = dateMap.get(dateKey);
      point.actual_price = currency === "VND" ? price.price * exchangeRate : price.price / exchangeRate;
      point.data_quality.actual = price.qualityScore >= 90 ? "verified" : "raw";
    });

    // Add forecast data
    forecasts.forEach((forecast: any) => {
      forecast.predictions?.forEach((pred: any, index: number) => {
        const forecastDate = new Date(forecast.forecastDate.getTime() + index * 24 * 60 * 60 * 1000);
        const dateKey = forecastDate.toISOString().split('T')[0];
        
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, {
            date: dateKey,
            actual_price: null,
            forecast_price: null,
            forecast_confidence: null,
            forecast_lower_bound: null,
            forecast_upper_bound: null,
            error_absolute: null,
            error_percentage: null,
            within_confidence_band: null,
            data_quality: {
              actual: "missing" as const,
              forecast: "missing" as const,
            }
          });
        }
        
        const point = dateMap.get(dateKey);
        point.forecast_price = currency === "VND" ? pred.median * exchangeRate : pred.median / exchangeRate;
        point.forecast_confidence = pred.confidence || null;
        point.forecast_lower_bound = pred.q10 ? (currency === "VND" ? pred.q10 * exchangeRate : pred.q10 / exchangeRate) : null;
        point.forecast_upper_bound = pred.q90 ? (currency === "VND" ? pred.q90 * exchangeRate : pred.q90 / exchangeRate) : null;
        point.data_quality.forecast = pred.confidence >= 80 ? "high" : pred.confidence >= 60 ? "medium" : "low";
      });
    });

    // Calculate errors and confidence band coverage
    const dataPoints = Array.from(dateMap.values()).map(point => {
      if (point.actual_price && point.forecast_price) {
        point.error_absolute = Math.abs(point.actual_price - point.forecast_price);
        point.error_percentage = (point.error_absolute / point.actual_price) * 100;
        
        if (point.forecast_lower_bound !== null && point.forecast_upper_bound !== null) {
          point.within_confidence_band = point.actual_price >= point.forecast_lower_bound && point.actual_price <= point.forecast_upper_bound;
        }
      }
      
      return point;
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Calculate accuracy metrics if requested
    let accuracy_metrics = null;
    if (include_accuracy_metrics) {
      accuracy_metrics = calculateAccuracyMetrics(dataPoints);
    }

    // Assess forecast performance
    const forecast_performance = assessForecastPerformance(accuracy_metrics || { mape: 0, picp: 0, forecast_bias: 0, accuracy_trend: 'stable' });

    // Build response
    const processingTime = Date.now() - startTime;
    const response = createSuccessResponse<PriceVsForecastResponse>({
      commodity,
      region,
      currency,
      comparison_period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        days_analyzed: Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
      },
      data_points: dataPoints,
      accuracy_metrics,
      forecast_performance,
      vietnamese_market_context: vietnameseMarketContext,
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

    res.json(response);

  } catch (error) {
    console.error(`Internal error in GET /v1/price-vs-forecast:`, error);
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