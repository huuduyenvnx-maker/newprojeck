import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { realTimePriceService } from "../services/realtime-price-service";

const router = Router();

// Schema validation for WebSocket testing endpoints
const TestPriceUpdateSchema = z.object({
    commodityId: z.string().min(1, "Commodity ID is required"),
    regionId: z.string().min(1, "Region ID is required"),
    price: z.number().positive("Price must be positive"),
    source: z.string().optional().default("test_api")
});

const TestForecastSchema = z.object({
    commodityId: z.string().min(1, "Commodity ID is required"),
    regionId: z.string().min(1, "Region ID is required"),
    forecast: z.object({
        predicted_price: z.number().positive(),
        confidence: z.number().min(0).max(1),
        horizon: z.enum(["7_days", "30_days", "90_days"]).default("30_days"),
        model_used: z.string().optional().default("ensemble"),
        metadata: z.record(z.any()).optional()
    })
});

// WebSocket health endpoint
router.get("/health", (req: Request, res: Response) => {
    try {
        const wsService = (globalThis as any).wsService;

        if (!wsService) {
            return res.status(503).json({
                success: false,
                error: "WebSocket service not available",
                timestamp: new Date().toISOString()
            });
        }

        const wsStats = wsService.getStats();
        const priceStats = realTimePriceService.getStats();

        res.json({
            success: true,
            websocket: {
                status: "active",
                ...wsStats
            },
            priceService: {
                status: "active",
                ...priceStats
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Test price update broadcast
router.post("/test/price-update", async (req: Request, res: Response) => {
    try {
        const validation = TestPriceUpdateSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                details: validation.error.errors,
                timestamp: new Date().toISOString()
            });
        }

        const { commodityId, regionId, price, source } = validation.data;

        const priceUpdate = await realTimePriceService.triggerPriceUpdate(
            commodityId,
            regionId,
            price,
            source
        );

        res.json({
            success: true,
            message: "Price update broadcasted successfully",
            data: priceUpdate,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Test forecast update broadcast
router.post("/test/forecast-update", async (req: Request, res: Response) => {
    try {
        const validation = TestForecastSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                details: validation.error.errors,
                timestamp: new Date().toISOString()
            });
        }

        const { commodityId, regionId, forecast } = validation.data;

        await realTimePriceService.broadcastForecastUpdate(commodityId, regionId, forecast);

        res.json({
            success: true,
            message: "Forecast update broadcasted successfully",
            data: {
                commodityId,
                regionId,
                forecast
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Test quality alert broadcast
router.post("/test/quality-alert", async (req: Request, res: Response) => {
    try {
        const { commodityId, regionId, issue, severity } = req.body;

        if (!commodityId || !regionId || !issue) {
            return res.status(400).json({
                success: false,
                error: "commodityId, regionId, and issue are required",
                timestamp: new Date().toISOString()
            });
        }

        const qualityIssue = {
            message: issue,
            severity: severity || "medium",
            source: "test_api",
            details: req.body.details || {}
        };

        await realTimePriceService.broadcastQualityAlert(commodityId, regionId, qualityIssue);

        res.json({
            success: true,
            message: "Quality alert broadcasted successfully",
            data: qualityIssue,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Test system notification broadcast
router.post("/test/system-notification", async (req: Request, res: Response) => {
    try {
        const { message, type, priority } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                error: "Message is required",
                timestamp: new Date().toISOString()
            });
        }

        const wsService = (globalThis as any).wsService;

        if (!wsService) {
            return res.status(503).json({
                success: false,
                error: "WebSocket service not available",
                timestamp: new Date().toISOString()
            });
        }

        const notification = {
            message,
            type: type || "info",
            priority: priority || "normal",
            source: "test_api"
        };

        wsService.broadcastSystemNotification(notification);

        res.json({
            success: true,
            message: "System notification broadcasted successfully",
            data: notification,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Get current price for a commodity-region pair
router.get("/price/:commodityId/:regionId", async (req: Request, res: Response) => {
    try {
        const { commodityId, regionId } = req.params;

        const currentPrice = realTimePriceService.getCurrentPrice(commodityId, regionId);

        if (!currentPrice) {
            return res.status(404).json({
                success: false,
                error: "Price not found for the specified commodity and region",
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            data: {
                commodityId,
                regionId,
                price: parseFloat(currentPrice.price),
                currency: currentPrice.currency,
                timestamp: currentPrice.date,
                source: currentPrice.source
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Get price history for trend analysis
router.get("/price-history/:commodityId/:regionId", async (req: Request, res: Response) => {
    try {
        const { commodityId, regionId } = req.params;
        const days = parseInt(req.query.days as string) || 7;

        if (days < 1 || days > 90) {
            return res.status(400).json({
                success: false,
                error: "Days must be between 1 and 90",
                timestamp: new Date().toISOString()
            });
        }

        const history = await realTimePriceService.getPriceHistory(commodityId, regionId, days);

        res.json({
            success: true,
            data: {
                commodityId,
                regionId,
                days,
                history: history.map(price => ({
                    price: parseFloat(price.price),
                    currency: price.currency,
                    timestamp: price.date,
                    source: price.source
                }))
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

// Update alert thresholds
router.put("/alert-thresholds", (req: Request, res: Response) => {
    try {
        const { significantChange, extremeChange, anomalyThreshold } = req.body;

        const thresholds: any = {};
        if (typeof significantChange === 'number' && significantChange > 0) {
            thresholds.significantChange = significantChange;
        }
        if (typeof extremeChange === 'number' && extremeChange > 0) {
            thresholds.extremeChange = extremeChange;
        }
        if (typeof anomalyThreshold === 'number' && anomalyThreshold > 0) {
            thresholds.anomalyThreshold = anomalyThreshold;
        }

        if (Object.keys(thresholds).length === 0) {
            return res.status(400).json({
                success: false,
                error: "No valid thresholds provided",
                timestamp: new Date().toISOString()
            });
        }

        realTimePriceService.updateAlertThresholds(thresholds);

        res.json({
            success: true,
            message: "Alert thresholds updated successfully",
            data: realTimePriceService.getStats().alertThresholds,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        });
    }
});

export { router as websocketRoutes };