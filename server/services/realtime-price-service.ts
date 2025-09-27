import { db } from '../db';
import { priceData, llmVerifications } from '../../shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import type { PriceUpdate, ForecastAlert } from './websocket-service';

interface PriceChangeData {
    commodityId: string;
    regionId: string;
    currentPrice: number;
    previousPrice: number;
    changePercent: number;
    trend: 'up' | 'down' | 'stable';
    currency: string;
    source: string;
}

class RealTimePriceService {
    private priceCache = new Map<string, any>();
    private alertThresholds = {
        significantChange: 5, // 5% price change
        extremeChange: 15,    // 15% price change
        anomalyThreshold: 25  // 25% price change (potential anomaly)
    };

    async initializePriceCache() {
        try {
            // Load recent prices (last 7 days) for trend calculation
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const recentPrices = await db
                .select()
                .from(priceData)
                .where(and(
                    // Only get recent data
                    // eq(priceData.date, sevenDaysAgo.toISOString().split('T')[0])
                ))
                .orderBy(desc(priceData.date))
                .limit(5000);

            // Group by commodity-region pairs
            const priceGroups = new Map<string, any[]>();

            recentPrices.forEach(price => {
                const key = `${price.commodityId}:${price.regionId}`;
                if (!priceGroups.has(key)) {
                    priceGroups.set(key, []);
                }
                priceGroups.get(key)!.push(price);
            });

            // Cache the most recent price for each commodity-region
            priceGroups.forEach((prices, key) => {
                prices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                this.priceCache.set(key, prices[0]);
            });

            console.log(`📊 Initialized price cache with ${this.priceCache.size} commodity-region pairs`);
        } catch (error) {
            console.error('❌ Error initializing price cache:', error);
        }
    }

    async processPriceUpdate(newPriceData: any): Promise<PriceUpdate | null> {
        const key = `${newPriceData.commodityId}:${newPriceData.regionId}`;
        const cachedPrice = this.priceCache.get(key);

        const currentPrice = parseFloat(newPriceData.price);
        let changePercent = 0;
        let trend: 'up' | 'down' | 'stable' = 'stable';

        if (cachedPrice) {
            const previousPrice = parseFloat(cachedPrice.price);
            changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

            if (Math.abs(changePercent) > 1) { // More than 1% change
                trend = changePercent > 0 ? 'up' : 'down';
            }
        }

        // Update cache
        this.priceCache.set(key, newPriceData);

        const priceUpdate: PriceUpdate = {
            commodityId: newPriceData.commodityId,
            regionId: newPriceData.regionId,
            price: currentPrice,
            currency: newPriceData.currency,
            timestamp: newPriceData.date || new Date().toISOString(),
            source: newPriceData.source,
            changePercent,
            trend
        };

        // Broadcast the price update
        await this.broadcastPriceUpdate(priceUpdate);

        // Check for alerts
        await this.checkPriceAlerts(priceUpdate, cachedPrice);

        return priceUpdate;
    }

    private async broadcastPriceUpdate(priceUpdate: PriceUpdate) {
        try {
            // Get WebSocket service from global
            const wsService = (globalThis as any).wsService;
            if (wsService) {
                wsService.broadcastPriceUpdate(priceUpdate);
            }
        } catch (error) {
            console.error('❌ Error broadcasting price update:', error);
        }
    }

    private async checkPriceAlerts(priceUpdate: PriceUpdate, previousPrice?: any) {
        const { changePercent, commodityId, regionId } = priceUpdate;

        // Check for significant price changes
        if (Math.abs(changePercent) >= this.alertThresholds.significantChange) {
            let severity: 'low' | 'medium' | 'high' = 'low';
            let alertType: 'forecast_published' | 'quality_warning' | 'price_anomaly' = 'price_anomaly';

            if (Math.abs(changePercent) >= this.alertThresholds.extremeChange) {
                severity = 'medium';
            }
            if (Math.abs(changePercent) >= this.alertThresholds.anomalyThreshold) {
                severity = 'high';
            }

            const alert: ForecastAlert = {
                id: `alert_${Date.now()}_${Math.random().toString(36).substring(2)}`,
                type: alertType,
                commodityId,
                regionId,
                severity,
                message: this.generateAlertMessage(priceUpdate, changePercent),
                data: {
                    priceUpdate,
                    previousPrice,
                    changePercent,
                    threshold: this.getThresholdForSeverity(severity)
                },
                timestamp: new Date().toISOString()
            };

            await this.broadcastAlert(alert);
        }
    }

    private generateAlertMessage(priceUpdate: PriceUpdate, changePercent: number): string {
        const direction = changePercent > 0 ? 'tăng' : 'giảm';
        const absChange = Math.abs(changePercent).toFixed(1);

        return `Giá ${priceUpdate.commodityId} tại ${priceUpdate.regionId} ${direction} ${absChange}% - hiện tại: ${priceUpdate.price.toLocaleString()} ${priceUpdate.currency}`;
    }

    private getThresholdForSeverity(severity: 'low' | 'medium' | 'high'): number {
        switch (severity) {
            case 'low': return this.alertThresholds.significantChange;
            case 'medium': return this.alertThresholds.extremeChange;
            case 'high': return this.alertThresholds.anomalyThreshold;
            default: return this.alertThresholds.significantChange;
        }
    }

    private async broadcastAlert(alert: ForecastAlert) {
        try {
            const wsService = (globalThis as any).wsService;
            if (wsService) {
                wsService.broadcastAlert(alert);
            }

            console.log(`🚨 Price alert: ${alert.message} (${alert.severity})`);
        } catch (error) {
            console.error('❌ Error broadcasting alert:', error);
        }
    }

    async broadcastForecastUpdate(commodityId: string, regionId: string, forecastData: any) {
        try {
            const wsService = (globalThis as any).wsService;
            if (wsService) {
                wsService.broadcastForecastUpdate(commodityId, regionId, {
                    ...forecastData,
                    message: `Dự báo mới cho ${commodityId} tại ${regionId}`,
                    confidence: forecastData.confidence || 0.85,
                    horizon: forecastData.horizon || '30_days'
                });
            }
        } catch (error) {
            console.error('❌ Error broadcasting forecast update:', error);
        }
    }

    async broadcastQualityAlert(commodityId: string, regionId: string, qualityIssue: any) {
        const alert: ForecastAlert = {
            id: `quality_${Date.now()}_${Math.random().toString(36).substring(2)}`,
            type: 'quality_warning',
            commodityId,
            regionId,
            severity: qualityIssue.severity || 'medium',
            message: `Cảnh báo chất lượng dữ liệu cho ${commodityId} tại ${regionId}: ${qualityIssue.message}`,
            data: qualityIssue,
            timestamp: new Date().toISOString()
        };

        await this.broadcastAlert(alert);
    }

    // Method to manually trigger price updates (for testing or batch processing)
    async triggerPriceUpdate(commodityId: string, regionId: string, price: number, source = 'manual') {
        const priceData = {
            commodityId,
            regionId,
            price: price.toString(),
            currency: 'VND',
            date: new Date().toISOString(),
            source
        };

        return await this.processPriceUpdate(priceData);
    }

    // Get current price for a commodity-region pair
    getCurrentPrice(commodityId: string, regionId: string) {
        const key = `${commodityId}:${regionId}`;
        return this.priceCache.get(key);
    }

    // Get price history for trend analysis
    async getPriceHistory(commodityId: string, regionId: string, days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const history = await db
                .select()
                .from(priceData)
                .where(and(
                    eq(priceData.commodityId, commodityId),
                    eq(priceData.regionId, regionId)
                ))
                .orderBy(desc(priceData.date))
                .limit(days * 5); // Assuming multiple prices per day

            return history;
        } catch (error) {
            console.error('❌ Error fetching price history:', error);
            return [];
        }
    }

    // Statistics about price updates
    getStats() {
        return {
            cachedPrices: this.priceCache.size,
            alertThresholds: this.alertThresholds,
            lastUpdate: new Date().toISOString()
        };
    }

    // Update alert thresholds
    updateAlertThresholds(thresholds: Partial<typeof this.alertThresholds>) {
        this.alertThresholds = { ...this.alertThresholds, ...thresholds };
        console.log('📊 Updated alert thresholds:', this.alertThresholds);
    }
}

// Global instance
const realTimePriceService = new RealTimePriceService();

export { RealTimePriceService, realTimePriceService };