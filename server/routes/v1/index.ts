import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import forecastRouter from "./forecast";
import verificationRouter from "./verification";
import actionsRouter from "./actions";
import reliabilityRouter from "./reliability";
import marketPricesRouter from "./market-prices";
import priceComparisonRouter from "./price-comparison";
import { createSuccessResponse, createErrorResponse } from "../../schemas/v1-responses";

const router = Router();

// API Version Info
const API_VERSION = "1.0.0";
const API_RELEASE_DATE = "2025-09-22";
const API_DESCRIPTION = "Vietnamese Agricultural Forecasting API - P0 Standardized Endpoints";

// Global middleware for V1 API
router.use((req: Request, res: Response, next) => {
  // Add API version headers
  res.set({
    'X-API-Version': API_VERSION,
    'X-API-Release-Date': API_RELEASE_DATE,
    'X-Service': 'AgriIntel-Vietnamese-Forecasting',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  // Log API requests (structured logging)
  const requestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.get('X-Request-ID') || uuidv4(),
  };
  
  console.log('V1_API_REQUEST:', JSON.stringify(requestLog));
  
  // Attach request ID for tracking
  req.requestId = requestLog.requestId;
  
  next();
});

// Health check endpoint for V1 API
router.get("/health", (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.requestId || uuidv4();
  
  try {
    const healthStatus = {
      status: "healthy",
      version: API_VERSION,
      release_date: API_RELEASE_DATE,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      endpoints: {
        forecast_30d: "operational",
        market_prices: "operational",
        price_vs_forecast: "operational", 
        llm_crosscheck: "operational",
        actions: "operational",
        reliability: "operational",
      },
      vietnamese_market_features: {
        commodities_supported: ["rice", "coffee", "pepper", "black-pepper", "white-pepper", "cassava", "sweet-potato", "maize", "rubber", "fertilizer"],
        regions_supported: ["mekong-delta", "central-highlands", "red-river-delta", "southeast", "north-central", "south-central", "north-mountain"],
        currencies_supported: ["VND", "USD"],
        seasonal_awareness: true,
        quality_gates_enabled: true,
        llm_verification_enabled: true,
      },
      dependencies: {
        database: "connected",
        ml_service: "available", // Will be checked in actual implementation
        openai_service: "available",
        gemini_service: "available",
        currency_service: "available",
      },
    };

    const processingTime = Date.now() - startTime;
    
    const response = createSuccessResponse(healthStatus, {
      request_id: requestId,
      processing_time_ms: processingTime,
      service_version: API_VERSION,
    });

    res.status(200).json(response);
    
  } catch (error) {
    console.error("V1 Health check failed:", error);
    
    const response = createErrorResponse(
      "HEALTH_CHECK_FAILED",
      "Health check service temporarily unavailable",
      "Dịch vụ kiểm tra tình trạng tạm thời không khả dụng",
      "service_unavailable",
      null,
      requestId
    );
    
    res.status(503).json(response);
  }
});

// API Information endpoint
router.get("/info", (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = req.requestId || uuidv4();
  
  const apiInfo = {
    name: "AgriIntel Vietnamese Agricultural Forecasting API",
    version: API_VERSION,
    description: API_DESCRIPTION,
    release_date: API_RELEASE_DATE,
    documentation_url: "/v1/docs", // Future documentation endpoint
    support_contact: "api-support@agriintel.vn",
    rate_limits: {
      forecast_30d: "10 requests/minute",
      llm_crosscheck: "5 requests/minute", 
      actions: "20 requests/minute",
      reliability: "15 requests/minute",
    },
    endpoints: {
      "/v1/forecast-30d": {
        methods: ["POST", "GET"],
        description: "Generate and retrieve 30-day agricultural commodity forecasts",
        features: ["Quality gates integration", "Vietnamese market context", "Currency conversion"],
      },
      "/v1/llm-crosscheck": {
        methods: ["POST"],
        description: "Dual-LLM verification for forecast validation",
        features: ["OpenAI GPT-4o", "Google Gemini", "Agreement analysis"],
      },
      "/v1/actions": {
        methods: ["GET"],
        description: "Trading recommendations and market actions",
        features: ["Risk assessment", "Vietnamese market insights", "Price targets"],
      },
      "/v1/reliability": {
        methods: ["GET"],
        description: "Quality dashboard metrics and reliability data",
        features: ["CCS distributions", "Historical performance", "Component breakdown"],
      },
    },
    vietnamese_market_specialization: {
      supported_commodities: [
        { name: "rice", regions: ["mekong-delta", "red-river-delta"], export_oriented: true },
        { name: "coffee", regions: ["central-highlands"], export_oriented: true },
        { name: "pepper", regions: ["central-highlands", "south-central"], export_oriented: true },
        { name: "rubber", regions: ["southeast", "south-central"], export_oriented: true },
        { name: "cassava", regions: ["north-central", "southeast"], export_oriented: false },
      ],
      seasonal_calendar: {
        monsoon_season: "May - September",
        rice_harvest: {
          summer: "June - July",
          autumn: "October - November",
        },
        coffee_harvest: "October - February",
        pepper_harvest: "January - April",
      },
      currency_features: {
        primary_currency: "VND",
        secondary_currency: "USD", 
        real_time_conversion: true,
        rate_update_frequency: "hourly",
      },
    },
  };

  const processingTime = Date.now() - startTime;
  
  const response = createSuccessResponse(apiInfo, {
    request_id: requestId,
    processing_time_ms: processingTime,
    service_version: API_VERSION,
  });

  res.status(200).json(response);
});

// Mount individual routers for each endpoint group
router.use(forecastRouter);        // /v1/forecast-30d
router.use(marketPricesRouter);    // /v1/market-prices
router.use(priceComparisonRouter); // /v1/price-vs-forecast
router.use(verificationRouter);    // /v1/llm-crosscheck  
router.use(actionsRouter);         // /v1/actions
router.use(reliabilityRouter);     // /v1/reliability

// 404 handler for V1 API routes
router.use("*", (req: Request, res: Response) => {
  const requestId = req.requestId || uuidv4();
  
  const response = createErrorResponse(
    "ENDPOINT_NOT_FOUND",
    `V1 API endpoint not found: ${req.method} ${req.originalUrl}`,
    `Không tìm thấy điểm cuối API V1: ${req.method} ${req.originalUrl}`,
    "validation_error",
    { 
      available_endpoints: [
        "GET /v1/health",
        "GET /v1/info", 
        "POST /v1/forecast-30d",
        "GET /v1/forecast-30d",
        "GET /v1/market-prices",
        "GET /v1/price-vs-forecast",
        "POST /v1/llm-crosscheck",
        "GET /v1/actions",
        "GET /v1/reliability",
      ],
      documentation: "/v1/docs"
    },
    requestId
  );
  
  res.status(404).json(response);
});

// Error handler for V1 API
router.use((error: any, req: Request, res: Response, next: any) => {
  const requestId = req.requestId || uuidv4();
  
  console.error('V1_API_ERROR:', {
    requestId,
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const response = createErrorResponse(
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred in the V1 API",
    "Đã xảy ra lỗi không mong đợi trong API V1",
    "internal_error",
    isDevelopment ? { 
      error_message: error.message,
      stack_trace: error.stack 
    } : null,
    requestId
  );
  
  res.status(500).json(response);
});

export default router;