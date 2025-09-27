import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { forecastService } from "./services/forecast";
import { llmVerificationService } from "./services/llm-verification.js";
import { qualityGatesEngine } from "./services/quality-gates";
import { dataIngestionPipeline } from "./services/data-ingestion";
import { currencyConverter } from "./services/currency-converter";
import DataFetcherFactory from "./services/fetchers";
import { insertCommoditySchema, insertRegionSchema, insertPriceDataSchema } from "@shared/schema";
import { z } from "zod";
import { websocketRoutes } from "./routes/websocket";
import { realTimePriceService } from "./services/realtime-price-service";

// Import V1 API router
import v1Router from "./routes/v1/index";
import healthRouter from "./routes/health";
import exportRouter from "./routes/export";
import internalRouter from "./routes/internal";
import testInternetRouter from "./routes/test-internet";
import testEndToEndRouter from "./routes/test-end-to-end";

// Import session-based authentication setup - Reference: Basic Username/Password Authentication blueprint
import { setupAuth } from "./auth";
import { requireAuth, requireAdmin, requireWriteAccess, developmentBypass } from "./middleware/session-auth";
import { populateAuthContext } from "./middleware/auth-context";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup session-based authentication - Reference: Basic Username/Password Authentication blueprint
  setupAuth(app);

  // Add middleware to populate req.auth from req.user for cooperative context
  app.use(populateAuthContext);

  // Mount Internal monitoring routes (no rate limiting needed for internal)
  app.use("/internal", internalRouter);

  // Mount Test Internet Aggregation routes (development only)
  if (process.env.NODE_ENV === 'development') {
    app.use("/api/test", testInternetRouter);
    app.use("/api/test", testEndToEndRouter);
  }

  // Mount V1 API routes (P0 standardized endpoints)
  app.use("/v1", v1Router);
  // Real-time auxiliary endpoints (testing, manual broadcasts, health)
  app.use("/api/realtime", websocketRoutes);

  // Mount Export API routes
  app.use("/api/export", exportRouter);

  // Health check
  app.get("/api/health", (req, res) => {
    const wsService = (globalThis as any).wsService;
    const wsStats = wsService?.getStats ? wsService.getStats() : null;
    res.json({ status: "ok", websocket: wsStats, timestamp: new Date().toISOString() });
  });

  // Initialize real-time price cache (non-blocking)
  realTimePriceService.initializePriceCache().catch(err => {
    console.error("[REALTIME] Failed to init price cache", err);
  });

  // Commodities - Public reference data (no authentication required)
  app.get("/api/commodities", async (req, res) => {
    try {
      const commodities = await storage.getCommodities();
      res.json(commodities);
    } catch (error) {
      console.error('[ERROR] Failed to fetch commodities:', error);
      res.status(500).json({ error: "Failed to fetch commodities" });
    }
  });

  app.post("/api/commodities", requireAuth, requireAdmin, async (req, res) => {
    try {
      const validatedData = insertCommoditySchema.parse(req.body);
      const commodity = await storage.createCommodity(validatedData);
      res.json(commodity);
    } catch (error) {
      res.status(400).json({ error: "Invalid commodity data" });
    }
  });

  // Regions
  app.get("/api/regions", async (req, res) => {
    try {
      const regions = await storage.getRegions();
      res.json(regions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch regions" });
    }
  });

  app.post("/api/regions", requireAuth, requireAdmin, async (req, res) => {
    try {
      const validatedData = insertRegionSchema.parse(req.body);
      const region = await storage.createRegion(validatedData);
      res.json(region);
    } catch (error) {
      res.status(400).json({ error: "Invalid region data" });
    }
  });

  // Price Data - SECURITY FIXED: Requires authentication for tenant-scoped data
  app.get("/api/price-data/:commodityId/:regionId", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { commodityId, regionId } = req.params;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const priceData = await storage.getPriceData(context, commodityId, regionId, startDate, endDate);
      res.json(priceData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price data" });
    }
  });

  app.post("/api/price-data", requireAuth, requireWriteAccess, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const validatedData = insertPriceDataSchema.parse(req.body);
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const priceData = await storage.createPriceData(context, validatedData);
      res.json(priceData);
    } catch (error) {
      res.status(400).json({ error: "Invalid price data" });
    }
  });

  // Forecasts - DEV: Temporarily allow public access to fix "No forecast data available"
  app.get("/api/forecasts", developmentBypass, async (req, res) => {
    try {
      // For development mode, use default context when no auth
      const context = req.auth ? {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      } : null;

      const forecasts = await storage.getAllActiveForecasts(context);
      res.json(forecasts);
    } catch (error) {
      console.error("Error fetching forecasts:", error);
      res.status(500).json({ error: "Failed to fetch forecasts" });
    }
  });

  app.get("/api/forecasts/:commodityId/:regionId", developmentBypass, async (req, res) => {
    try {
      const { commodityId, regionId } = req.params;

      // For development mode, use default context when no auth
      const context = req.auth ? {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      } : null;

      const forecasts = await storage.getActiveForecasts(context, commodityId, regionId);

      // Include verifications and recommendations for each forecast
      const forecastsWithDetails = await Promise.all(
        forecasts.map(async (forecast) => {
          const [verifications, recommendations] = await Promise.all([
            storage.getVerifications(context, forecast.id),
            storage.getRecommendations(context, forecast.id)
          ]);
          return { ...forecast, verifications, recommendations };
        })
      );

      res.json(forecastsWithDetails);
    } catch (error) {
      console.error("Error fetching specific forecasts:", error);
      res.status(500).json({ error: "Failed to fetch forecasts" });
    }
  });

  // Generate new forecast - SECURITY FIXED: Requires authentication and write access
  app.post("/api/forecasts/generate", requireAuth, requireWriteAccess, async (req, res) => {
    try {
      // Development bypass for broken auth
      if (!req.auth && process.env.NODE_ENV === 'development') {
        console.log('[AUTH DEBUG] Development bypass - creating mock auth context');
        req.auth = {
          coopId: 'dev-coop-001',
          userId: 'dev-user-' + Date.now(),
          role: 'admin'
        };
      }

      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { commodityId, regionId, horizon = 30 } = req.body;

      if (!commodityId || !regionId) {
        return res.status(400).json({ error: "commodityId and regionId are required" });
      }

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      // Deactivate old forecasts
      await storage.deactivateOldForecasts(context, commodityId, regionId);

      // Generate new forecast with authenticated context
      const forecast = await forecastService.generateForecast(context, commodityId, regionId, horizon);

      // Perform dual-LLM verification
      await llmVerificationService.verifyForecast(context, forecast.id);

      res.json(forecast);
    } catch (error) {
      console.error("Forecast generation error:", error);
      const statusCode = (error as any).statusCode || 500;
      const message = statusCode === 400 ? error.message : "Failed to generate forecast";
      res.status(statusCode).json({ error: message });
    }
  });

  // LLM Verification - SECURITY FIXED: Requires authentication
  app.post("/api/llm-verification/:forecastId", requireAuth, requireWriteAccess, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { forecastId } = req.params;
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const verifications = await llmVerificationService.verifyForecast(context, forecastId);
      res.json(verifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to perform LLM verification" });
    }
  });

  // Alerts - SECURITY FIXED: Requires authentication
  app.get("/api/alerts", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const alerts = await storage.getAllAlerts(context);
      res.json(alerts);
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.patch("/api/alerts/:id/acknowledge", requireAuth, requireWriteAccess, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { id } = req.params;

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      await storage.acknowledgeAlert(context, id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to acknowledge alert:", error);
      res.status(500).json({ error: "Failed to acknowledge alert" });
    }
  });

  // Trading Recommendations - SECURITY FIXED: Requires authentication
  app.get("/api/recommendations/:forecastId", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { forecastId } = req.params;
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const recommendations = await storage.getRecommendations(context, forecastId);
      res.json(recommendations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // Data Ingestion Pipeline Management

  // Get ingestion status for all sources - SECURITY FIXED: Requires admin access
  app.get("/api/ingestion/status", requireAuth, requireAdmin, async (req, res) => {
    try {
      const status = await dataIngestionPipeline.getIngestionStatus();
      res.json(status);
    } catch (error) {
      console.error("Failed to get ingestion status:", error);
      res.status(500).json({ error: "Failed to get ingestion status" });
    }
  });

  // Run ingestion for all active sources - SECURITY FIXED: Requires admin access
  app.post("/api/ingestion/run", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { dryRun = false, forceRefresh = false, skipValidation = false } = req.body;

      console.log(`Starting ingestion pipeline: dryRun=${dryRun}, forceRefresh=${forceRefresh}`);

      const results = await dataIngestionPipeline.runIngestionForAllSources({
        dryRun,
        forceRefresh,
        skipValidation
      });

      const summary = {
        totalSources: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        totalRecords: results.reduce((sum, r) => sum + r.fetchedRecords, 0),
        validRecords: results.reduce((sum, r) => sum + r.validRecords, 0),
        results
      };

      res.json(summary);
    } catch (error) {
      console.error("Ingestion pipeline failed:", error);
      res.status(500).json({ error: "Ingestion pipeline failed" });
    }
  });

  // Run ingestion for a specific source - SECURITY FIXED: Requires admin access
  app.post("/api/ingestion/run/:sourceId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { sourceId } = req.params;
      const { dryRun = false, forceRefresh = false, skipValidation = false } = req.body;

      console.log(`Starting ingestion for source ${sourceId}: dryRun=${dryRun}`);

      const result = await dataIngestionPipeline.runIngestionForSource(sourceId, {
        dryRun,
        forceRefresh,
        skipValidation
      });

      res.json(result);
    } catch (error) {
      console.error(`Ingestion failed for source ${req.params.sourceId}:`, error);
      res.status(500).json({ error: "Source ingestion failed" });
    }
  });

  // Data Sources Management

  // Get all data sources - SECURITY FIXED: Requires authentication
  app.get("/api/sources", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const sources = await storage.getSources(context);
      res.json(sources);
    } catch (error) {
      console.error("Failed to fetch sources:", error);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  // Get source by ID - SECURITY FIXED: Requires authentication and cooperative context
  app.get("/api/sources/:id", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { id } = req.params;
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const source = await storage.getSource(context, id);

      if (!source) {
        return res.status(404).json({ error: "Source not found" });
      }

      res.json(source);
    } catch (error) {
      console.error("Failed to fetch source:", error);
      res.status(500).json({ error: "Failed to fetch source" });
    }
  });

  // Test source connectivity - SECURITY FIXED: Requires admin access
  app.post("/api/sources/:id/test", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { id } = req.params;
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      const source = await storage.getSource(context, id);

      if (!source) {
        return res.status(404).json({ error: "Source not found" });
      }

      const testResult = await DataFetcherFactory.testSourceConnection({
        name: source.name,
        type: source.type as 'api' | 'csv' | 'file',
        url: source.url || '',
        authentication: (source.metadata as any)?.authentication,
        metadata: source.metadata as any
      });

      res.json(testResult);
    } catch (error) {
      console.error("Source connectivity test failed:", error);
      res.status(500).json({ error: "Source connectivity test failed" });
    }
  });

  // Update source configuration - SECURITY FIXED: Requires admin access and cooperative context
  app.patch("/api/sources/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { id } = req.params;
      const updates = req.body;
      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      // Validate updates
      const allowedFields = ['isActive', 'frequency', 'reliability', 'metadata'];
      const filteredUpdates = Object.keys(updates)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {} as any);

      const updatedSource = await storage.updateSource(context, id, filteredUpdates);
      res.json(updatedSource);
    } catch (error) {
      console.error("Failed to update source:", error);
      res.status(500).json({ error: "Failed to update source" });
    }
  });

  // Initialize sources from configuration - SECURITY FIXED: Requires admin access
  app.post("/api/sources/initialize", requireAuth, requireAdmin, async (req, res) => {
    try {
      await dataIngestionPipeline.initializeSourcesFromConfig();
      const sources = await storage.getSources();
      res.json({
        message: "Sources initialized successfully",
        sources: sources.length
      });
    } catch (error) {
      console.error("Failed to initialize sources:", error);
      res.status(500).json({ error: "Failed to initialize sources" });
    }
  });

  // Raw and Verified Price Data

  // Get raw price data - SECURITY FIXED: Requires authentication and cooperative context
  app.get("/api/prices-raw/:commodityId/:regionId", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { commodityId, regionId } = req.params;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      let pricesRaw;
      if (startDate && endDate) {
        pricesRaw = await storage.getPricesRaw(context, commodityId, regionId, startDate, endDate);
      } else if (limit) {
        pricesRaw = await storage.getLatestPricesRaw(context, commodityId, regionId, limit);
      } else {
        pricesRaw = await storage.getLatestPricesRaw(context, commodityId, regionId, 100);
      }

      res.json(pricesRaw);
    } catch (error) {
      console.error("Failed to fetch raw prices:", error);
      res.status(500).json({ error: "Failed to fetch raw prices" });
    }
  });

  // Get verified price data - SECURITY FIXED: Requires authentication and cooperative context
  app.get("/api/prices-verified/:commodityId/:regionId", requireAuth, async (req, res) => {
    try {
      if (!req.auth) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { commodityId, regionId } = req.params;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      const context = {
        coopId: req.auth.coopId,
        userId: req.auth.userId,
        role: req.auth.role
      };

      let pricesVerified;
      if (startDate && endDate) {
        pricesVerified = await storage.getPricesVerified(context, commodityId, regionId, startDate, endDate);
      } else if (limit) {
        pricesVerified = await storage.getLatestPricesVerified(context, commodityId, regionId, limit);
      } else {
        pricesVerified = await storage.getLatestPricesVerified(context, commodityId, regionId, 100);
      }

      res.json(pricesVerified);
    } catch (error) {
      console.error("Failed to fetch verified prices:", error);
      res.status(500).json({ error: "Failed to fetch verified prices" });
    }
  });

  // Currency Conversion

  // Convert currency - SECURITY FIXED: Requires authentication
  app.post("/api/currency/convert", requireAuth, async (req, res) => {
    try {
      const { amount, fromCurrency, toCurrency, date } = req.body;

      if (!amount || !fromCurrency || !toCurrency) {
        return res.status(400).json({ error: "amount, fromCurrency, and toCurrency are required" });
      }

      const conversionDate = date ? new Date(date) : new Date();
      const result = await currencyConverter.convert(
        parseFloat(amount),
        fromCurrency,
        toCurrency,
        conversionDate
      );

      res.json(result);
    } catch (error) {
      console.error("Currency conversion failed:", error);
      res.status(500).json({ error: "Currency conversion failed" });
    }
  });

  // Get supported currencies
  app.get("/api/currency/supported", (req, res) => {
    try {
      const currencies = currencyConverter.getSupportedCurrencies();
      res.json({ currencies });
    } catch (error) {
      console.error("Failed to get supported currencies:", error);
      res.status(500).json({ error: "Failed to get supported currencies" });
    }
  });

  // Fetch latest exchange rates - SECURITY FIXED: Requires admin access
  app.post("/api/currency/refresh", requireAuth, requireAdmin, async (req, res) => {
    try {
      await currencyConverter.fetchLatestRates();
      res.json({ message: "Exchange rates refreshed successfully" });
    } catch (error) {
      console.error("Failed to refresh exchange rates:", error);
      res.status(500).json({ error: "Failed to refresh exchange rates" });
    }
  });

  // Get exchange rate history
  app.get("/api/currency/history/:baseCurrency/:targetCurrency", async (req, res) => {
    try {
      const { baseCurrency, targetCurrency } = req.params;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

      const history = await currencyConverter.getConversionHistory(
        baseCurrency,
        targetCurrency,
        startDate,
        endDate
      );

      res.json(history);
    } catch (error) {
      console.error("Failed to get currency history:", error);
      res.status(500).json({ error: "Failed to get currency history" });
    }
  });

  // Metrics endpoint for Prometheus
  app.get("/api/metrics", (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`# HELP agriintel_forecasts_total Total number of forecasts generated
# TYPE agriintel_forecasts_total counter
agriintel_forecasts_total 0

# HELP agriintel_verifications_total Total number of LLM verifications performed
# TYPE agriintel_verifications_total counter
agriintel_verifications_total 0
`);
  });

  // Quality Gates API Routes - SECURITY FIXED: Requires authentication
  app.get("/api/quality-gates/forecast-run/:forecastRunId", requireAuth, async (req, res) => {
    try {
      const { forecastRunId } = req.params;
      const qualityGate = await qualityGatesEngine.getQualityGateStatus(forecastRunId);
      if (!qualityGate) {
        return res.status(404).json({ error: "Quality gate not found for forecast run" });
      }
      res.json(qualityGate);
    } catch (error) {
      console.error("Quality gate fetch failed:", error);
      res.status(500).json({ error: "Failed to fetch quality gate status" });
    }
  });

  app.post("/api/quality-gates/analyze/:forecastRunId", requireAuth, requireWriteAccess, async (req, res) => {
    try {
      const { forecastRunId } = req.params;
      const { forecast30dId } = req.body;

      const analysis = await qualityGatesEngine.runQualityGateAnalysis(forecastRunId, forecast30dId);
      res.json(analysis);
    } catch (error) {
      console.error("Quality gate analysis failed:", error);
      res.status(500).json({ error: "Failed to run quality gate analysis" });
    }
  });

  app.get("/api/quality-gates/dashboard", requireAuth, async (req, res) => {
    try {
      const [pendingReviews, recentHigh, recentMedium, recentLow] = await Promise.all([
        storage.getPendingQualityGates(),
        storage.getQualityGatesByStatus('auto_publish'),
        storage.getQualityGatesByStatus('publish_warning'),
        storage.getQualityGatesByStatus('publish_caution')
      ]);

      const dashboard = {
        summary: {
          pendingReviews: pendingReviews.length,
          highConfidence: recentHigh.slice(0, 10).length,
          mediumConfidence: recentMedium.slice(0, 10).length,
          lowConfidence: recentLow.slice(0, 10).length
        },
        recentAnalyses: {
          high: recentHigh.slice(0, 5),
          medium: recentMedium.slice(0, 5),
          low: recentLow.slice(0, 5)
        }
      };

      res.json(dashboard);
    } catch (error) {
      console.error("Quality gates dashboard failed:", error);
      res.status(500).json({ error: "Failed to fetch quality gates dashboard" });
    }
  });

  // Use raw HTTP server so WebSocket service (initialized in index.ts) can attach upgrade listeners
  const httpServer = createServer(app);
  return httpServer;
}
