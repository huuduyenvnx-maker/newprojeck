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
const RATE_LIMIT_REQUESTS = 20; // requests per minute (higher for market data)
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Request schema for market prices
const getMarketPricesRequestSchema = z.object({
  commodity: z.string().min(1, "Commodity is required"),
  region: z.string().min(1, "Region is required"),
  date_range: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  include_raw: z.coerce.boolean().default(false),
  currency: z.enum(["VND", "USD"]).default("VND"),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("daily")
});

type GetMarketPricesRequest = z.infer<typeof getMarketPricesRequestSchema>;

interface MarketPricesResponse {
  commodity: string;
  region: string;
  currency: string;
  granularity: string;
  market_prices: Array<{
    date: string;
    price_vnd: number;
    price_usd: number;
    volume?: number;
    data_quality: "verified" | "raw" | "interpolated";
    source: string;
    confidence_level: "high" | "medium" | "low";
  }>;
  price_statistics: {
    min_price: number;
    max_price: number;
    avg_price: number;
    volatility: number;
    trend_direction: "up" | "down" | "stable";
  };
  vietnamese_market_context: VietnameseMarketContext;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
  };
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

// Helper function to calculate price statistics
const calculatePriceStatistics = (prices: Array<{ price_vnd: number }>) => {
  if (prices.length === 0) {
    return {
      min_price: 0,
      max_price: 0,
      avg_price: 0,
      volatility: 0,
      trend_direction: 'stable' as const
    };
  }

  const priceValues = prices.map(p => p.price_vnd);
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const avgPrice = priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length;
  
  // Calculate volatility (coefficient of variation)
  const variance = priceValues.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / priceValues.length;
  const volatility = avgPrice > 0 ? Math.sqrt(variance) / avgPrice : 0;
  
  // Calculate trend direction
  const firstHalf = priceValues.slice(0, Math.floor(priceValues.length / 2));
  const secondHalf = priceValues.slice(Math.ceil(priceValues.length / 2));
  
  const firstHalfAvg = firstHalf.reduce((sum, price) => sum + price, 0) / firstHalf.length;
  const secondHalfAvg = secondHalf.reduce((sum, price) => sum + price, 0) / secondHalf.length;
  
  let trendDirection: 'up' | 'down' | 'stable';
  const changePercent = Math.abs(secondHalfAvg - firstHalfAvg) / firstHalfAvg;
  
  if (changePercent < 0.05) { // Less than 5% change
    trendDirection = 'stable';
  } else if (secondHalfAvg > firstHalfAvg) {
    trendDirection = 'up';
  } else {
    trendDirection = 'down';
  }

  return {
    min_price: minPrice,
    max_price: maxPrice,
    avg_price: avgPrice,
    volatility: volatility,
    trend_direction: trendDirection
  };
};

// ===========================================
// GET /v1/market-prices - Retrieve Market Prices
// ===========================================

router.get("/market-prices", requireAuth, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Cache-Control': 'private, max-age=300', // 5 minutes private cache for market data
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
    let validatedRequest: GetMarketPricesRequest;
    try {
      validatedRequest = getMarketPricesRequestSchema.parse(req.query);
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

    const { commodity, region, date_range, limit, offset, include_raw, currency, granularity } = validatedRequest;

    // Check market hours for real-time requests
    if (!isVietnameseMarketHours()) {
      console.log(`Market data request outside market hours for commodity: ${commodity}, region: ${region}`);
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

    // Retrieve price data based on parameters
    const startDate = date_range?.start_date ? new Date(date_range.start_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
    const endDate = date_range?.end_date ? new Date(date_range.end_date) : new Date(); // Default: now

    let priceData;
    if (include_raw) {
      // Get raw price data (includes unverified data)
      priceData = await storage.getPriceData(context, commodityRecord.id, regionRecord.id, startDate, endDate);
    } else {
      // Get only verified price data
      priceData = await storage.getVerifiedPriceData(context, commodityRecord.id, regionRecord.id, startDate, endDate);
    }

    // Build Vietnamese market context
    const vietnameseMarketContext = await buildVietnameseMarketContext(commodity, region);
    const exchangeRate = vietnameseMarketContext.currency_info.exchange_rate_vnd_usd;

    // Process price data and apply currency conversion
    const processedPrices = priceData.map((price: any) => {
      // Determine data quality level
      let dataQuality: "verified" | "raw" | "interpolated";
      if (price.qualityScore && price.qualityScore >= 90) {
        dataQuality = "verified";
      } else if (price.isInterpolated) {
        dataQuality = "interpolated";
      } else {
        dataQuality = "raw";
      }

      // Determine confidence level based on source and quality
      let confidenceLevel: "high" | "medium" | "low";
      if (price.qualityScore && price.qualityScore >= 95) {
        confidenceLevel = "high";
      } else if (price.qualityScore && price.qualityScore >= 80) {
        confidenceLevel = "medium";
      } else {
        confidenceLevel = "low";
      }

      return {
        date: price.date.toISOString().split('T')[0], // YYYY-MM-DD format
        price_vnd: currency === "VND" ? price.price : price.price * exchangeRate,
        price_usd: currency === "USD" ? price.price : price.price / exchangeRate,
        volume: price.volume || undefined,
        data_quality: dataQuality,
        source: price.source || "unknown",
        confidence_level: confidenceLevel,
      };
    });

    // Apply pagination
    const total = processedPrices.length;
    const paginatedPrices = processedPrices.slice(offset, offset + limit);

    // Calculate price statistics
    const priceStatistics = calculatePriceStatistics(paginatedPrices);

    // Build response
    const processingTime = Date.now() - startTime;
    const response = createSuccessResponse<MarketPricesResponse>({
      commodity,
      region,
      currency,
      granularity,
      market_prices: paginatedPrices,
      price_statistics: priceStatistics,
      vietnamese_market_context: vietnameseMarketContext,
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

    // Add rate limit info to metadata
    response.metadata.rate_limit = {
      remaining: rateLimit.remaining,
      reset_at: rateLimit.resetAt.toISOString(),
    };

    res.json(response);

  } catch (error) {
    console.error(`Internal error in GET /v1/market-prices:`, error);
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