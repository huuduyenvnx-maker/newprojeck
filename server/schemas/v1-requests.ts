import { z } from "zod";

// Vietnamese Market Configuration
export const VIETNAMESE_COMMODITIES = [
  "rice", "coffee", "pepper", "black-pepper", "white-pepper", 
  "cassava", "sweet-potato", "maize", "rubber", "fertilizer"
] as const;

export const VIETNAMESE_REGIONS = [
  "mekong-delta", "central-highlands", "red-river-delta", 
  "southeast", "north-central", "south-central", "north-mountain"
] as const;

export const CURRENCIES = ["VND", "USD"] as const;
export const RISK_TOLERANCE_LEVELS = ["low", "medium", "high", "conservative", "aggressive"] as const;
export const VERIFICATION_TYPES = ["full", "quick", "consensus", "detailed"] as const;
export const METRIC_TYPES = ["ccs", "quality_gates", "evidence", "agreement", "temporal_consistency"] as const;

// Base request schema with common fields
export const baseRequestSchema = z.object({
  request_id: z.string().uuid().optional(),
  client_version: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

// Vietnamese text normalization helper
export const vietnameseTextSchema = z.string().transform((str) => {
  // Normalize Vietnamese text - remove extra spaces, handle diacritics
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
});

// Commodity validation with Vietnamese market context
export const commoditySchema = z.enum(VIETNAMESE_COMMODITIES, {
  errorMap: () => ({ 
    message: `Commodity must be one of: ${VIETNAMESE_COMMODITIES.join(', ')}. Supported Vietnamese agricultural commodities only.` 
  })
});

// Region validation with Vietnamese market context
export const regionSchema = z.enum(VIETNAMESE_REGIONS, {
  errorMap: () => ({ 
    message: `Region must be one of: ${VIETNAMESE_REGIONS.join(', ')}. Supported Vietnamese agricultural regions only.` 
  })
});

// Currency validation
export const currencySchema = z.enum(CURRENCIES).default("VND");

// Date range validation
export const dateRangeSchema = z.object({
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
}).refine((data) => new Date(data.start_date) < new Date(data.end_date), {
  message: "start_date must be before end_date",
});

// Confidence threshold validation
export const confidenceThresholdSchema = z.number()
  .min(0, "Confidence threshold must be between 0 and 100")
  .max(100, "Confidence threshold must be between 0 and 100")
  .default(70);

// ===========================================
// /v1/forecast-30d Request Schemas
// ===========================================

export const generateForecast30dRequestSchema = baseRequestSchema.extend({
  commodity: commoditySchema,
  region: regionSchema,
  horizon: z.number().int().min(1).max(30).default(30),
  confidence_threshold: confidenceThresholdSchema,
  include_quality_gates: z.boolean().default(true),
  include_llm_verification: z.boolean().default(true),
  currency: currencySchema,
  context_overrides: z.object({
    seasonal_factor: z.number().min(0.5).max(2.0).optional(),
    market_sentiment: z.enum(["bullish", "bearish", "neutral"]).optional(),
    monsoon_impact: z.boolean().optional(),
    harvest_season: z.boolean().optional(),
  }).optional(),
});

export const getForecast30dRequestSchema = z.object({
  commodity: commoditySchema,
  region: regionSchema,
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).default(0),
  include_quality_gates: z.boolean().default(true),
  include_verifications: z.boolean().default(false),
  active_only: z.boolean().default(true),
  date_range: dateRangeSchema.optional(),
});

// ===========================================
// /v1/llm-crosscheck Request Schemas
// ===========================================

export const llmCrosscheckRequestSchema = baseRequestSchema.extend({
  forecast_data: z.object({
    forecast_run_id: z.string().uuid().optional(),
    forecast_30d_id: z.string().uuid().optional(),
    commodity: commoditySchema,
    region: regionSchema,
    predictions: z.array(z.object({
      date: z.string().datetime(),
      median: z.number(),
      q10: z.number(),
      q25: z.number(),
      q75: z.number(),
      q90: z.number(),
      confidence: z.number().min(0).max(100),
      trend: z.enum(["up", "down", "stable"]),
    })).min(1),
    metrics: z.object({
      mase: z.number().optional(),
      smape: z.number().optional(),
      picp: z.number().optional(),
      fqs: z.number().optional(),
    }).optional(),
  }),
  verification_type: z.enum(VERIFICATION_TYPES).default("full"),
  context_overrides: z.object({
    market_focus: z.array(z.string()).optional(),
    risk_factors: z.array(z.string()).optional(),
    seasonal_context: z.string().optional(),
    vietnamese_market_specifics: z.boolean().default(true),
  }).optional(),
  force_reverification: z.boolean().default(false),
});

// ===========================================
// /v1/actions Request Schemas
// ===========================================

export const getActionsRequestSchema = z.object({
  commodity: commoditySchema,
  region: regionSchema,
  risk_tolerance: z.enum(RISK_TOLERANCE_LEVELS).default("medium"),
  timeframe: z.enum(["1d", "7d", "14d", "30d"]).default("30d"),
  min_confidence: confidenceThresholdSchema,
  currency: currencySchema,
  include_inactive: z.boolean().default(false),
  action_types: z.array(z.enum(["buy", "sell", "hold", "monitor"])).default(["buy", "sell", "hold"]),
  vietnamese_market_context: z.object({
    export_focus: z.boolean().default(false),
    domestic_market: z.boolean().default(true),
    seasonal_adjustments: z.boolean().default(true),
  }).optional(),
});

// ===========================================
// /v1/reliability Request Schemas  
// ===========================================

export const getReliabilityRequestSchema = z.object({
  commodity: commoditySchema.optional(),
  region: regionSchema.optional(),
  time_range: z.enum(["7d", "30d", "90d", "6m", "1y"]).default("30d"),
  metric_type: z.enum(METRIC_TYPES).default("ccs"),
  include_historical: z.boolean().default(false),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  confidence_buckets: z.boolean().default(true),
  include_breakdown: z.boolean().default(true),
});

// ===========================================
// Type exports for TypeScript
// ===========================================

export type GenerateForecast30dRequest = z.infer<typeof generateForecast30dRequestSchema>;
export type GetForecast30dRequest = z.infer<typeof getForecast30dRequestSchema>;
export type LlmCrosscheckRequest = z.infer<typeof llmCrosscheckRequestSchema>;
export type GetActionsRequest = z.infer<typeof getActionsRequestSchema>;
export type GetReliabilityRequest = z.infer<typeof getReliabilityRequestSchema>;

// Vietnamese market validation helpers
export const isVietnameseCommodity = (commodity: string): commodity is typeof VIETNAMESE_COMMODITIES[number] => {
  return VIETNAMESE_COMMODITIES.includes(commodity as any);
};

export const isVietnameseRegion = (region: string): region is typeof VIETNAMESE_REGIONS[number] => {
  return VIETNAMESE_REGIONS.includes(region as any);
};

// Seasonal context helpers
export const getVietnameseSeasonalContext = (date = new Date()) => {
  const month = date.getMonth() + 1; // 1-12
  return {
    isMonsoonSeason: [5, 6, 7, 8, 9].includes(month),
    isHarvestSeason: {
      rice: {
        summer: [6, 7].includes(month),
        autumn: [10, 11].includes(month),
      },
      coffee: [10, 11, 12, 1, 2].includes(month),
      pepper: [1, 2, 3, 4].includes(month),
    },
    seasonalRiskFactor: [5, 6, 7, 8, 9].includes(month) ? 1.2 : 1.0, // Higher risk during monsoon
  };
};

// Market hours validation for Vietnamese exchanges
export const isVietnameseMarketHours = (timestamp = new Date()) => {
  const vietnamTime = new Date(timestamp.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const hour = vietnamTime.getHours();
  const dayOfWeek = vietnamTime.getDay(); // 0 = Sunday
  
  // Vietnam markets typically operate Monday-Friday, 9:00-15:00
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 15;
};