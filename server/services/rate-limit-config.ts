/**
 * Rate Limit Policy Configuration for Vietnamese Agricultural Intelligence Platform
 * 
 * Defines tiered rate limits by endpoint and role, optimized for Vietnamese agricultural 
 * market patterns including rural connectivity, cooperative usage, and expensive ML operations.
 */

import { RateLimitPolicy } from '../middleware/rate-limit';

/**
 * Vietnamese Agricultural Endpoint Categories
 */
export enum EndpointCategory {
  FORECASTING = 'forecasting',
  LLM_VERIFICATION = 'llm_verification', 
  STANDARD_API = 'standard_api',
  EXPORT = 'export',
  HEALTH = 'health',
  INTERNAL = 'internal'
}

/**
 * Policy Templates for Different Agricultural Use Cases
 */
const POLICY_TEMPLATES = {
  // High-cost forecasting operations
  FORECASTING_GENERATE: {
    id: 'forecast_generate',
    description: 'Forecast generation endpoints (POST /v1/forecast-30d)',
    capacity: 10, // 10 requests per minute base
    refillRate: 10 / 60, // Refill 10 tokens per minute
    burstAllowance: 3, // Allow short bursts for retry scenarios
    windowSize: 60000, // 1 minute window
    maxRequests: 10,
    softStartRequests: 2, // Extra requests for new rural users
    softStartWindow: 60000,
    roleModifiers: {
      admin: 2.0, // 20 requests/min
      analyst: 1.5, // 15 requests/min
      user: 1.0, // 10 requests/min (base)
      internal: 10.0 // 100 requests/min for ML service
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Forecasting retrieval (less expensive)
  FORECASTING_RETRIEVE: {
    id: 'forecast_retrieve',
    description: 'Forecast retrieval endpoints (GET /v1/forecast-30d)',
    capacity: 60,
    refillRate: 1, // 1 token per second = 60/min
    burstAllowance: 10,
    windowSize: 60000,
    maxRequests: 60,
    softStartRequests: 5,
    softStartWindow: 30000,
    roleModifiers: {
      admin: 2.0, // 120/min
      analyst: 1.5, // 90/min  
      user: 1.0, // 60/min
      internal: 5.0 // 300/min
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Expensive LLM verification
  LLM_CROSSCHECK: {
    id: 'llm_crosscheck',
    description: 'LLM verification endpoints (POST /v1/llm-crosscheck)',
    capacity: 5, // Very restrictive for expensive operations
    refillRate: 5 / 60, // 5 per minute
    burstAllowance: 2,
    windowSize: 60000,
    maxRequests: 5,
    softStartRequests: 1,
    softStartWindow: 60000,
    roleModifiers: {
      admin: 2.0, // 10/min
      analyst: 1.5, // 7-8/min
      user: 1.0, // 5/min
      internal: 4.0 // 20/min
    },
    ruralFriendly: true,
    cooperativeMode: false // More strict due to cost
  } as RateLimitPolicy,

  // Standard API endpoints
  STANDARD_API: {
    id: 'standard_api',
    description: 'Standard API endpoints (actions, reliability)',
    capacity: 120,
    refillRate: 2, // 120/min
    burstAllowance: 20,
    windowSize: 60000,
    maxRequests: 120,
    softStartRequests: 10,
    softStartWindow: 30000,
    roleModifiers: {
      admin: 2.0,
      analyst: 1.5,
      user: 1.0,
      internal: 3.0
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Export operations
  EXPORT_CREATE: {
    id: 'export_create',
    description: 'Export job creation endpoints',
    capacity: 3, // Very restrictive
    refillRate: 3 / 60,
    burstAllowance: 1,
    windowSize: 60000,
    maxRequests: 3,
    softStartRequests: 1,
    softStartWindow: 120000, // 2 minutes
    roleModifiers: {
      admin: 2.0, // 6/min
      analyst: 1.5, // 4-5/min
      user: 1.0, // 3/min
      internal: 5.0 // 15/min
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Export downloads (less restrictive)
  EXPORT_DOWNLOAD: {
    id: 'export_download',
    description: 'Export download endpoints',
    capacity: 10,
    refillRate: 10 / 60,
    burstAllowance: 3,
    windowSize: 60000,
    maxRequests: 10,
    softStartRequests: 2,
    softStartWindow: 60000,
    roleModifiers: {
      admin: 2.0,
      analyst: 1.5,
      user: 1.0,
      internal: 3.0
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Health and info endpoints (very lenient)
  HEALTH_INFO: {
    id: 'health_info',
    description: 'Health check and info endpoints',
    capacity: 300, // Very generous for health checks
    refillRate: 5, // 300/min
    burstAllowance: 50,
    windowSize: 60000,
    maxRequests: 300,
    softStartRequests: 20,
    softStartWindow: 10000, // 10 seconds
    roleModifiers: {
      admin: 1.0, // Same for all roles
      analyst: 1.0,
      user: 1.0,
      internal: 2.0 // Slightly higher for internal monitoring
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy,

  // Fallback default policy
  DEFAULT: {
    id: 'default',
    description: 'Default rate limiting policy',
    capacity: 60,
    refillRate: 1,
    burstAllowance: 10,
    windowSize: 60000,
    maxRequests: 60,
    softStartRequests: 5,
    softStartWindow: 60000,
    roleModifiers: {
      admin: 2.0,
      analyst: 1.5,
      user: 1.0,
      internal: 5.0
    },
    ruralFriendly: true,
    cooperativeMode: true
  } as RateLimitPolicy
};

/**
 * Route-to-Policy Mapping
 * Maps Express route patterns to rate limiting policies
 */
export const ROUTE_POLICY_MAP: { [routePattern: string]: RateLimitPolicy } = {
  // V1 API Forecasting Endpoints
  'POST:/v1/forecast-30d': POLICY_TEMPLATES.FORECASTING_GENERATE,
  'POST:/v1/forecast-30d/generate': POLICY_TEMPLATES.FORECASTING_GENERATE,
  'GET:/v1/forecast-30d': POLICY_TEMPLATES.FORECASTING_RETRIEVE,
  'GET:/v1/forecast-30d/:id': POLICY_TEMPLATES.FORECASTING_RETRIEVE,

  // V1 API LLM Verification
  'POST:/v1/llm-crosscheck': POLICY_TEMPLATES.LLM_CROSSCHECK,
  'POST:/v1/llm-crosscheck/verify': POLICY_TEMPLATES.LLM_CROSSCHECK,

  // V1 API Standard Endpoints
  'GET:/v1/actions': POLICY_TEMPLATES.STANDARD_API,
  'GET:/v1/actions/:commodityId/:regionId': POLICY_TEMPLATES.STANDARD_API,
  'GET:/v1/reliability': POLICY_TEMPLATES.STANDARD_API,
  'GET:/v1/reliability/dashboard': POLICY_TEMPLATES.STANDARD_API,

  // Export API Endpoints
  'POST:/api/export/market-data': POLICY_TEMPLATES.EXPORT_CREATE,
  'POST:/api/export/forecast-results': POLICY_TEMPLATES.EXPORT_CREATE,
  'POST:/api/export/price-history': POLICY_TEMPLATES.EXPORT_CREATE,
  'GET:/api/export/job/:id': POLICY_TEMPLATES.EXPORT_DOWNLOAD,
  'GET:/api/export/download/:id': POLICY_TEMPLATES.EXPORT_DOWNLOAD,
  'GET:/api/export/status/:id': POLICY_TEMPLATES.EXPORT_DOWNLOAD,

  // Health and Info Endpoints
  'GET:/v1/health': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/v1/info': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/api/health': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/health': POLICY_TEMPLATES.HEALTH_INFO,
  
  // Internal monitoring endpoints - SECURITY HARDENED with explicit policies
  'GET:/internal/metrics': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/internal/system-health': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/internal/ip-status/:ip': POLICY_TEMPLATES.HEALTH_INFO,
  'POST:/internal/whitelist-ip': POLICY_TEMPLATES.HEALTH_INFO,
  'POST:/internal/blacklist-ip': POLICY_TEMPLATES.HEALTH_INFO,
  'POST:/internal/surge-mode': POLICY_TEMPLATES.HEALTH_INFO,
  'POST:/internal/exit-surge': POLICY_TEMPLATES.HEALTH_INFO,
  'GET:/internal/agricultural-context': POLICY_TEMPLATES.HEALTH_INFO,

  // Legacy API endpoints (for backward compatibility)
  'POST:/api/forecasts/generate': POLICY_TEMPLATES.FORECASTING_GENERATE,
  'GET:/api/forecasts': POLICY_TEMPLATES.FORECASTING_RETRIEVE,
  'GET:/api/forecasts/:commodityId/:regionId': POLICY_TEMPLATES.FORECASTING_RETRIEVE,
  'POST:/api/llm-verification/:forecastId': POLICY_TEMPLATES.LLM_CROSSCHECK,
  
  // Market Explorer essential endpoints - more lenient for UI loading
  'GET:/api/commodities': POLICY_TEMPLATES.STANDARD_API,
  'GET:/api/regions': POLICY_TEMPLATES.STANDARD_API,
  'GET:/v1/market-prices': POLICY_TEMPLATES.STANDARD_API
};

/**
 * Global Rate Limits for Cross-Cutting Concerns
 */
export const GLOBAL_LIMITS = {
  // Overall system protection
  GLOBAL_REQUEST_RATE: {
    capacity: 1000, // 1000 requests per minute across all endpoints
    refillRate: 1000 / 60,
    windowSize: 60000
  },

  // Per-IP anomaly detection thresholds
  IP_ANOMALY_THRESHOLDS: {
    requests_per_minute: 200, // Trigger investigation at 200+ req/min from single IP
    error_rate_threshold: 0.5, // 50% error rate triggers temporary ban
    burst_threshold: 50, // 50 requests in 10 seconds triggers slowdown
    ban_duration: 300000, // 5 minute temporary bans
    progressive_penalties: true // Increase ban duration for repeat offenders
  },

  // LLM endpoint global protection
  LLM_GLOBAL_LIMITS: {
    capacity: 100, // Max 100 LLM requests per minute across all users
    refillRate: 100 / 60,
    windowSize: 60000,
    surge_mode_threshold: 80, // At 80% capacity, enter surge mode
    queue_max_size: 50, // Queue up to 50 requests when at capacity
    queue_timeout: 30000 // 30 second queue timeout
  },

  // Export global protection  
  EXPORT_GLOBAL_LIMITS: {
    capacity: 50, // Max 50 export jobs per minute globally
    concurrent_jobs_limit: 20, // Max 20 concurrent export jobs system-wide
    per_user_concurrent_limit: 2, // Max 2 concurrent jobs per user
    file_size_limit_mb: 100, // Max 100MB per export
    total_daily_exports_gb: 10 // Max 10GB total exports per day
  }
};

/**
 * Vietnamese Agricultural Context Configuration
 */
export const AGRICULTURAL_CONTEXT = {
  // Rural connectivity accommodations
  RURAL_CONNECTIVITY: {
    softStartEnabled: true,
    softStartDuration: 120000, // 2 minutes
    burstToleranceMultiplier: 1.5, // 50% more tolerance for rural users
    retryGracePeriod: 5000, // 5 seconds before counting as separate request
    connectionQualityHints: true // Provide connection quality hints in responses
  },

  // Agricultural cooperative patterns
  COOPERATIVE_USAGE: {
    sharedNATDetection: true, // Detect users behind same NAT
    cooperativeModeEnabled: true, // Allow higher limits for same IP with different users
    bulkOperationSupport: true, // Special handling for bulk agricultural data requests
    seasonalAdjustments: true, // Adjust limits based on agricultural seasons
    peakSeasonMultiplier: 1.3 // 30% higher limits during harvest/planting seasons
  },

  // Vietnamese market context
  MARKET_CONTEXT: {
    tradingHoursAdjustment: true, // Higher limits during Vietnamese trading hours
    localizedResponses: true, // Vietnamese error messages
    currencyConversionLimits: true, // Special limits for VND/USD conversion
    commoditySeasonality: {
      rice: { peak_months: [9, 10, 11, 12, 1, 2], multiplier: 1.5 },
      coffee: { peak_months: [10, 11, 12, 1, 2, 3], multiplier: 1.4 },
      pepper: { peak_months: [1, 2, 3, 4], multiplier: 1.3 },
      rubber: { peak_months: [6, 7, 8, 9], multiplier: 1.2 }
    }
  }
};

/**
 * Rate Limit Policy Configuration Service
 */
export class RateLimitConfigService {
  private policies = new Map<string, RateLimitPolicy>();
  private routeMap = new Map<string, RateLimitPolicy>();
  private globalLimits = GLOBAL_LIMITS;
  private agriculturalContext = AGRICULTURAL_CONTEXT;

  constructor() {
    this.initializePolicies();
    this.initializeRouteMapping();
  }

  /**
   * Get policy for a specific route and request context
   */
  getPolicyForRoute(method: string, path: string, context?: {
    isInternal?: boolean;
    commodity?: string;
    season?: string;
    userAgent?: string;
  }): RateLimitPolicy {
    const routeKey = `${method.toUpperCase()}:${path}`;
    
    // Check for exact route match first
    let policy = this.routeMap.get(routeKey);
    
    // Try pattern matching for parameterized routes
    if (!policy) {
      policy = this.findPolicyByPattern(method, path);
    }
    
    // Fall back to default policy
    if (!policy) {
      policy = POLICY_TEMPLATES.DEFAULT;
      console.warn(`[RateLimitConfig] No policy found for ${routeKey}, using default`);
    }
    
    // Apply contextual adjustments
    if (context) {
      policy = this.applyContextualAdjustments(policy, context);
    }
    
    return policy;
  }

  /**
   * Get policy by ID
   */
  getPolicyById(policyId: string): RateLimitPolicy | null {
    return this.policies.get(policyId) || null;
  }

  /**
   * Get global limits configuration
   */
  getGlobalLimits() {
    return { ...this.globalLimits };
  }

  /**
   * Get agricultural context configuration
   */
  getAgriculturalContext() {
    return { ...this.agriculturalContext };
  }

  /**
   * Check if current time is peak season for a commodity
   */
  isPeakSeason(commodity: string): { isPeak: boolean; multiplier: number } {
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const commodityConfig = this.agriculturalContext.MARKET_CONTEXT.commoditySeasonality[commodity as keyof typeof this.agriculturalContext.MARKET_CONTEXT.commoditySeasonality];
    
    if (!commodityConfig) {
      return { isPeak: false, multiplier: 1.0 };
    }
    
    const isPeak = commodityConfig.peak_months.includes(currentMonth);
    return { 
      isPeak, 
      multiplier: isPeak ? commodityConfig.multiplier : 1.0 
    };
  }

  /**
   * Check if current time is Vietnamese trading hours
   */
  isVietnameseTradingHours(): boolean {
    const now = new Date();
    const vietnamHour = (now.getUTCHours() + 7) % 24; // UTC+7 for Vietnam
    
    // Vietnamese markets typically trade 9:00-15:00
    return vietnamHour >= 9 && vietnamHour <= 15;
  }

  /**
   * Get all registered policies for monitoring/debugging
   */
  getAllPolicies(): RateLimitPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get route mapping for debugging
   */
  getRouteMapping(): { [route: string]: string } {
    const mapping: { [route: string]: string } = {};
    this.routeMap.forEach((policy, route) => {
      mapping[route] = policy.id;
    });
    return mapping;
  }

  private initializePolicies(): void {
    Object.values(POLICY_TEMPLATES).forEach(policy => {
      this.policies.set(policy.id, policy);
    });
    
    console.log(`[RateLimitConfig] Initialized ${this.policies.size} rate limiting policies`);
  }

  private initializeRouteMapping(): void {
    Object.entries(ROUTE_POLICY_MAP).forEach(([route, policy]) => {
      this.routeMap.set(route, policy);
    });
    
    console.log(`[RateLimitConfig] Mapped ${this.routeMap.size} routes to policies`);
  }

  private findPolicyByPattern(method: string, path: string): RateLimitPolicy | null {
    const methodUpper = method.toUpperCase();
    
    // Try common pattern matches
    const patterns = [
      { pattern: /^\/v1\/forecast-30d\/[^\/]+$/, policy: POLICY_TEMPLATES.FORECASTING_RETRIEVE },
      { pattern: /^\/v1\/actions\/[^\/]+\/[^\/]+$/, policy: POLICY_TEMPLATES.STANDARD_API },
      { pattern: /^\/api\/export\/(job|status|download)\/[^\/]+$/, policy: POLICY_TEMPLATES.EXPORT_DOWNLOAD },
      { pattern: /^\/api\/forecasts\/[^\/]+\/[^\/]+$/, policy: POLICY_TEMPLATES.FORECASTING_RETRIEVE },
      { pattern: /^\/api\/llm-verification\/[^\/]+$/, policy: POLICY_TEMPLATES.LLM_CROSSCHECK },
      // SECURITY HARDENED: Catch-all pattern for internal routes
      { pattern: /^\/internal\/.*/, policy: POLICY_TEMPLATES.HEALTH_INFO }
    ];
    
    for (const { pattern, policy } of patterns) {
      if (pattern.test(path)) {
        return policy;
      }
    }
    
    return null;
  }

  private applyContextualAdjustments(basePolicy: RateLimitPolicy, context: {
    isInternal?: boolean;
    commodity?: string;
    season?: string;
    userAgent?: string;
  }): RateLimitPolicy {
    let adjustedPolicy = { ...basePolicy };
    
    // Internal service bypass
    if (context.isInternal) {
      adjustedPolicy.capacity *= 10;
      adjustedPolicy.refillRate *= 10;
      adjustedPolicy.maxRequests *= 10;
    }
    
    // Seasonal adjustments for agricultural commodities
    if (context.commodity) {
      const { isPeak, multiplier } = this.isPeakSeason(context.commodity);
      if (isPeak) {
        adjustedPolicy.capacity = Math.floor(adjustedPolicy.capacity * multiplier);
        adjustedPolicy.maxRequests = Math.floor(adjustedPolicy.maxRequests * multiplier);
        adjustedPolicy.refillRate *= multiplier;
      }
    }
    
    // Trading hours adjustment
    if (this.isVietnameseTradingHours()) {
      const tradingMultiplier = 1.2; // 20% higher during trading hours
      adjustedPolicy.capacity = Math.floor(adjustedPolicy.capacity * tradingMultiplier);
      adjustedPolicy.maxRequests = Math.floor(adjustedPolicy.maxRequests * tradingMultiplier);
    }
    
    return adjustedPolicy;
  }
}

// Export singleton instance
export const rateLimitConfig = new RateLimitConfigService();

// Export policy templates for direct access
export { POLICY_TEMPLATES };
export type { RateLimitPolicy };