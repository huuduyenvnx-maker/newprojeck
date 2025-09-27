import { z } from "zod";

// ===========================================
// Standard Response Structure
// ===========================================

export const standardResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
    vietnamese_message: z.string().optional(),
  }).optional(),
  metadata: z.object({
    request_id: z.string().uuid(),
    processing_time_ms: z.number(),
    service_version: z.string(),
    timestamp: z.string().datetime(),
    rate_limit: z.object({
      remaining: z.number(),
      reset_at: z.string().datetime(),
    }).optional(),
  }),
});

// ===========================================
// Vietnamese Market Context Schema
// ===========================================

export const vietnameseMarketContextSchema = z.object({
  currency_info: z.object({
    primary_currency: z.enum(["VND", "USD"]),
    exchange_rate_vnd_usd: z.number(),
    rate_timestamp: z.string().datetime(),
  }),
  seasonal_context: z.object({
    current_season: z.enum(["monsoon", "dry", "harvest", "planting"]),
    seasonal_risk_factor: z.number(),
    harvest_calendar: z.object({
      rice: z.object({
        summer_harvest: z.boolean(),
        autumn_harvest: z.boolean(),
      }),
      coffee_harvest: z.boolean(),
      pepper_harvest: z.boolean(),
    }),
  }),
  regional_specifics: z.object({
    export_orientation: z.number(), // 0-1, how export-focused the region is
    infrastructure_score: z.number(), // 0-100
    climate_risk_level: z.enum(["low", "medium", "high"]),
  }),
});

// ===========================================
// Quality Metrics Schema
// ===========================================

export const qualityMetricsSchema = z.object({
  ccs_score: z.number().min(0).max(100),
  quality_gate_status: z.enum(["auto_publish", "publish_warning", "publish_caution", "hold_review"]),
  confidence_level: z.enum(["high", "medium", "low", "below_threshold"]),
  ui_indicator: z.enum(["green", "yellow", "red", "blocked"]),
  component_scores: z.object({
    agreement_score: z.number().min(0).max(100),
    evidence_score: z.number().min(0).max(100),
    source_credibility_score: z.number().min(0).max(100),
    temporal_consistency_score: z.number().min(0).max(100),
    model_confidence_score: z.number().min(0).max(100),
  }),
  warning_message: z.string().optional(),
  recommendations: z.array(z.string()),
});

// ===========================================
// Forecast Prediction Schema
// ===========================================

export const forecastPredictionSchema = z.object({
  date: z.string().datetime(),
  days_ahead: z.number().int(),
  median: z.number(),
  q10: z.number(),
  q25: z.number(),
  q75: z.number(),
  q90: z.number(),
  confidence: z.number().min(0).max(100),
  trend: z.enum(["up", "down", "stable"]),
  volatility: z.number(),
  price_vnd: z.number().optional(),
  price_usd: z.number().optional(),
});

// ===========================================
// /v1/forecast-30d Response Schemas
// ===========================================

export const generateForecast30dResponseSchema = standardResponseSchema.extend({
  data: z.object({
    forecast_run_id: z.string().uuid(),
    forecast_30d_id: z.string().uuid(),
    commodity: z.string(),
    region: z.string(),
    forecast_date: z.string().datetime(),
    horizon: z.number().int(),
    predictions: z.array(forecastPredictionSchema),
    metrics: z.object({
      mase: z.number(),
      smape: z.number(),
      picp: z.number(),
      fqs: z.number(),
      model_version: z.string(),
    }),
    quality_metrics: qualityMetricsSchema,
    vietnamese_market_context: vietnameseMarketContextSchema,
    llm_verification: z.object({
      status: z.enum(["completed", "pending", "failed"]),
      openai_verification_id: z.string().uuid().optional(),
      gemini_verification_id: z.string().uuid().optional(),
      agreement_score: z.number().min(0).max(100).optional(),
    }),
    processing_info: z.object({
      model_type: z.string(),
      circuit_breaker_status: z.enum(["CLOSED", "OPEN", "HALF_OPEN"]),
      fallback_used: z.boolean(),
      optimization_source: z.enum(["hpo", "default", "cached"]),
    }),
  }),
});

export const getForecast30dResponseSchema = standardResponseSchema.extend({
  data: z.object({
    forecasts: z.array(z.object({
      forecast_run_id: z.string().uuid(),
      forecast_30d_id: z.string().uuid(),
      commodity: z.string(),
      region: z.string(),
      forecast_date: z.string().datetime(),
      horizon: z.number().int(),
      predictions: z.array(forecastPredictionSchema),
      quality_metrics: qualityMetricsSchema.optional(),
      vietnamese_market_context: vietnameseMarketContextSchema,
    })),
    pagination: z.object({
      limit: z.number().int(),
      offset: z.number().int(),
      total: z.number().int(),
      has_more: z.boolean(),
    }),
  }),
});

// ===========================================
// /v1/llm-crosscheck Response Schema
// ===========================================

export const llmCrosscheckResponseSchema = standardResponseSchema.extend({
  data: z.object({
    crosscheck_id: z.string().uuid(),
    verification_type: z.string(),
    openai_verification: z.object({
      verification_id: z.string().uuid(),
      model: z.string(),
      confidence: z.number().min(0).max(100),
      response: z.string(),
      price_assessment: z.object({
        price_target: z.number().optional(),
        price_range: z.object({
          min: z.number(),
          max: z.number(),
        }).optional(),
        trend: z.enum(["bullish", "bearish", "neutral", "unknown"]),
        confidence: z.number().min(0).max(100),
      }),
      verified: z.boolean(),
    }),
    gemini_verification: z.object({
      verification_id: z.string().uuid(),
      model: z.string(),
      confidence: z.number().min(0).max(100),
      response: z.string(),
      price_assessment: z.object({
        price_target: z.number().optional(),
        price_range: z.object({
          min: z.number(),
          max: z.number(),
        }).optional(),
        trend: z.enum(["bullish", "bearish", "neutral", "unknown"]),
        confidence: z.number().min(0).max(100),
      }),
      verified: z.boolean(),
    }),
    agreement_analysis: z.object({
      agreement_score: z.number().min(0).max(100),
      semantic_similarity: z.number().min(0).max(1),
      price_variance: z.number().min(0).max(1),
      trend_alignment: z.number().min(0).max(1),
      confidence_overlap: z.number().min(0).max(1),
      analysis_method: z.string(),
      overall_assessment: z.enum(["high_agreement", "medium_agreement", "low_agreement", "conflicting"]),
      key_differences: z.array(z.string()),
      consensus_points: z.array(z.string()),
    }),
    confidence_metrics: z.object({
      composite_confidence: z.number().min(0).max(100),
      verification_reliability: z.enum(["high", "medium", "low", "degraded"]),
      fallback_mode: z.boolean(),
      processing_notes: z.array(z.string()),
    }),
    vietnamese_market_insights: z.object({
      market_sentiment: z.enum(["bullish", "bearish", "neutral"]),
      export_impact: z.string().optional(),
      seasonal_factors: z.array(z.string()),
      risk_assessment: z.enum(["low", "medium", "high"]),
    }),
  }),
});

// ===========================================
// /v1/actions Response Schema
// ===========================================

export const getActionsResponseSchema = standardResponseSchema.extend({
  data: z.object({
    recommendations: z.array(z.object({
      recommendation_id: z.string().uuid(),
      forecast_run_id: z.string().uuid(),
      action: z.enum(["buy", "sell", "hold", "monitor"]),
      confidence: z.number().min(0).max(100),
      reasoning: z.string(),
      market_timing: z.object({
        entry_timeframe: z.enum(["immediate", "1-3days", "1-2weeks", "monitor"]),
        exit_strategy: z.string(),
        hold_period: z.string(),
      }),
      price_targets: z.object({
        entry_price_vnd: z.number().optional(),
        entry_price_usd: z.number().optional(),
        target_price_vnd: z.number().optional(),
        target_price_usd: z.number().optional(),
        stop_loss_vnd: z.number().optional(),
        stop_loss_usd: z.number().optional(),
      }),
      risk_assessment: z.object({
        risk_level: z.enum(["low", "medium", "high"]),
        risk_factors: z.array(z.string()),
        mitigation_strategies: z.array(z.string()),
      }),
      vietnamese_market_insights: z.object({
        export_opportunity: z.boolean(),
        domestic_demand: z.enum(["low", "medium", "high"]),
        seasonal_timing: z.string(),
        regulatory_considerations: z.array(z.string()),
      }),
      created_at: z.string().datetime(),
    })),
    market_summary: z.object({
      overall_sentiment: z.enum(["bullish", "bearish", "neutral", "mixed"]),
      active_opportunities: z.number().int(),
      high_confidence_actions: z.number().int(),
      risk_distribution: z.object({
        low: z.number().int(),
        medium: z.number().int(),
        high: z.number().int(),
      }),
    }),
    vietnamese_market_context: vietnameseMarketContextSchema,
  }),
});

// ===========================================
// /v1/reliability Response Schema
// ===========================================

export const getReliabilityResponseSchema = standardResponseSchema.extend({
  data: z.object({
    reliability_overview: z.object({
      average_ccs_score: z.number().min(0).max(100),
      quality_gate_distribution: z.object({
        auto_publish: z.number().int(),
        publish_warning: z.number().int(),
        publish_caution: z.number().int(),
        hold_review: z.number().int(),
      }),
      total_forecasts: z.number().int(),
      time_range: z.string(),
    }),
    ccs_distributions: z.array(z.object({
      date: z.string().datetime(),
      ccs_score: z.number().min(0).max(100),
      confidence_level: z.enum(["high", "medium", "low", "below_threshold"]),
      commodity: z.string().optional(),
      region: z.string().optional(),
    })),
    component_breakdown: z.object({
      agreement_scores: z.object({
        average: z.number().min(0).max(100),
        trend: z.enum(["improving", "stable", "declining"]),
        recent_range: z.object({
          min: z.number(),
          max: z.number(),
        }),
      }),
      evidence_scores: z.object({
        average: z.number().min(0).max(100),
        trend: z.enum(["improving", "stable", "declining"]),
        source_breakdown: z.record(z.number()),
      }),
      temporal_consistency: z.object({
        average: z.number().min(0).max(100),
        stability_index: z.number().min(0).max(1),
      }),
      model_confidence: z.object({
        average: z.number().min(0).max(100),
        fallback_rate: z.number().min(0).max(1),
        circuit_breaker_activations: z.number().int(),
      }),
    }),
    historical_performance: z.object({
      accuracy_metrics: z.object({
        mean_absolute_error: z.number(),
        prediction_interval_coverage: z.number().min(0).max(1),
        direction_accuracy: z.number().min(0).max(1),
      }),
      reliability_trends: z.array(z.object({
        period: z.string(),
        avg_ccs: z.number().min(0).max(100),
        forecast_count: z.number().int(),
      })),
    }).optional(),
    vietnamese_market_context: vietnameseMarketContextSchema,
    quality_insights: z.object({
      strengths: z.array(z.string()),
      areas_for_improvement: z.array(z.string()),
      recommendations: z.array(z.string()),
    }),
  }),
});

// ===========================================
// Error Response Schemas
// ===========================================

export const errorResponseSchema = standardResponseSchema.extend({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
    vietnamese_message: z.string(),
    error_type: z.enum([
      "validation_error",
      "service_unavailable", 
      "rate_limit_exceeded",
      "authentication_required",
      "insufficient_data",
      "circuit_breaker_open",
      "internal_error"
    ]),
  }),
  data: z.null(),
});

// ===========================================
// Type exports for TypeScript
// ===========================================

export type StandardResponse<T = any> = z.infer<typeof standardResponseSchema> & { data: T };
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type VietnameseMarketContext = z.infer<typeof vietnameseMarketContextSchema>;
export type QualityMetrics = z.infer<typeof qualityMetricsSchema>;
export type ForecastPrediction = z.infer<typeof forecastPredictionSchema>;

export type GenerateForecast30dResponse = z.infer<typeof generateForecast30dResponseSchema>;
export type GetForecast30dResponse = z.infer<typeof getForecast30dResponseSchema>;
export type LlmCrosscheckResponse = z.infer<typeof llmCrosscheckResponseSchema>;
export type GetActionsResponse = z.infer<typeof getActionsResponseSchema>;
export type GetReliabilityResponse = z.infer<typeof getReliabilityResponseSchema>;

// Helper functions for response building
export const createSuccessResponse = <T>(
  data: T, 
  metadata: { request_id: string; processing_time_ms: number; service_version: string }
): StandardResponse<T> => ({
  success: true,
  data,
  metadata: {
    ...metadata,
    timestamp: new Date().toISOString(),
  },
});

export const createErrorResponse = (
  code: string,
  message: string,
  vietnameseMessage: string,
  errorType: ErrorResponse['error']['error_type'],
  details?: any,
  requestId?: string
): ErrorResponse => ({
  success: false,
  data: null,
  error: {
    code,
    message,
    vietnamese_message: vietnameseMessage,
    error_type: errorType,
    details,
  },
  metadata: {
    request_id: requestId || 'unknown',
    processing_time_ms: 0,
    service_version: '1.0.0',
    timestamp: new Date().toISOString(),
  },
});