import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createServer, type IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { log } from '../vite';
import { db } from '../db';
import { priceData, commodities, regions } from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';

interface WebSocketClient {
    id: string;
    socket: WebSocket;
    subscriptions: Set<string>;
    userId?: string;
    coopId?: string;
    lastHeartbeat: Date;
}

interface PriceUpdate {
    commodityId: string;
    regionId: string;
    price: number;
    currency: string;
    timestamp: string;
    source: string;
    changePercent: number;
    trend: 'up' | 'down' | 'stable';
}

interface ForecastAlert {
    id: string;
    type: 'forecast_published' | 'quality_warning' | 'price_anomaly';
    commodityId: string;
    regionId: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
    data: any;
    timestamp: string;
}

class WebSocketService {
    private wss: WebSocketServer;
    private clients: Map<string, WebSocketClient> = new Map();
    private heartbeatInterval: NodeJS.Timeout;
    private priceCache: Map<string, PriceUpdate> = new Map();

    constructor(server: any) {
        this.wss = new WebSocketServer({
            server,
            path: '/api/ws',
            clientTracking: true
        });

        this.setupWebSocketHandlers();
        this.startHeartbeat();
        this.initializePriceCache();

        log('🔌 WebSocket service initialized');
    }

    private setupWebSocketHandlers() {
        this.wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
            const clientId = this.generateClientId();
            const client: WebSocketClient = {
                id: clientId,
                socket,
                subscriptions: new Set(),
                lastHeartbeat: new Date()
            };

            this.clients.set(clientId, client);

            // Parse authentication from query parameters
            const url = parseUrl(request.url || '', true);
            const token = url.query.token as string;
            const userId = url.query.userId as string;
            const coopId = url.query.coopId as string;

            if (userId && coopId) {
                client.userId = userId;
                client.coopId = coopId;
                log(`🔌 Client ${clientId} connected (User: ${userId}, Coop: ${coopId})`);
            } else {
                log(`🔌 Anonymous client ${clientId} connected`);
            }

            // Send initial connection message
            this.sendMessage(client, {
                type: 'connection',
                data: {
                    clientId,
                    timestamp: new Date().toISOString(),
                    message: 'Connected to AgriIntel WebSocket'
                }
            });

            // Handle incoming messages
            socket.on('message', (data: RawData) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleClientMessage(client, message);
                } catch (error) {
                    log(`❌ Invalid WebSocket message from ${clientId}: ${error}`);
                }
            });

            // Handle client disconnect
            socket.on('close', () => {
                this.clients.delete(clientId);
                log(`🔌 Client ${clientId} disconnected`);
            });

            // Handle errors
            socket.on('error', (error: Error) => {
                log(`❌ WebSocket error for client ${clientId}: ${error.message}`);
                this.clients.delete(clientId);
            });
        });

        this.wss.on('error', (error: Error) => {
            log(`❌ WebSocket server error: ${error.message}`);
        });
    }

    private handleClientMessage(client: WebSocketClient, message: any) {
        const { type, data } = message;

        switch (type) {
            case 'subscribe':
                this.handleSubscription(client, data);
                break;

            case 'unsubscribe':
                this.handleUnsubscription(client, data);
                break;

            case 'heartbeat':
                client.lastHeartbeat = new Date();
                this.sendMessage(client, { type: 'pong', data: { timestamp: new Date().toISOString() } });
                break;

            case 'get_price':
                this.handlePriceRequest(client, data);
                break;

            case 'get_subscriptions':
                this.sendMessage(client, {
                    type: 'subscriptions',
                    data: Array.from(client.subscriptions)
                });
                break;

            default:
                log(`⚠️ Unknown message type from client ${client.id}: ${type}`);
        }
    }

    private handleSubscription(client: WebSocketClient, data: any) {
        const { commodityId, regionId, type: subType = 'price' } = data;

        if (!commodityId && !regionId && !subType) {
            // Subscribe to all updates
            client.subscriptions.add('all');
            log(`📡 Client ${client.id} subscribed to ALL updates`);
        } else {
            const subscriptionKey = `${subType}:${commodityId || '*'}:${regionId || '*'}`;
            client.subscriptions.add(subscriptionKey);
            log(`📡 Client ${client.id} subscribed to ${subscriptionKey}`);
        }

        this.sendMessage(client, {
            type: 'subscription_confirmed',
            data: { subscriptionKey: data, timestamp: new Date().toISOString() }
        });

        // Send current price if available
        if (commodityId && regionId && subType === 'price') {
            const cacheKey = `${commodityId}:${regionId}`;
            const cachedPrice = this.priceCache.get(cacheKey);
            if (cachedPrice) {
                this.sendMessage(client, {
                    type: 'price_update',
                    data: cachedPrice
                });
            }
        }
    }

    private handleUnsubscription(client: WebSocketClient, data: any) {
        const { commodityId, regionId, type: subType = 'price' } = data;
        const subscriptionKey = `${subType}:${commodityId || '*'}:${regionId || '*'}`;

        client.subscriptions.delete(subscriptionKey);
        log(`📡 Client ${client.id} unsubscribed from ${subscriptionKey}`);

        this.sendMessage(client, {
            type: 'unsubscription_confirmed',
            data: { subscriptionKey: data, timestamp: new Date().toISOString() }
        });
    }

    private async handlePriceRequest(client: WebSocketClient, data: any) {
        try {
            const { commodityId, regionId } = data;

            if (!commodityId || !regionId) {
                throw new Error('commodityId and regionId are required');
            }

            // Fetch latest price from database
            const latestPrice = await db
                .select()
                .from(priceData)
                .where(and(
                    eq(priceData.commodityId, commodityId),
                    eq(priceData.regionId, regionId),
                    client.coopId ? eq(priceData.coopId, client.coopId) : undefined
                ))
                .orderBy(desc(priceData.date))
                .limit(1);

            if (latestPrice.length > 0) {
                const price = latestPrice[0];
                this.sendMessage(client, {
                    type: 'price_response',
                    data: {
                        commodityId: price.commodityId,
                        regionId: price.regionId,
                        price: parseFloat(price.price),
                        currency: price.currency,
                        timestamp: price.date,
                        source: price.source
                    }
                });
            } else {
                this.sendMessage(client, {
                    type: 'price_response',
                    data: null,
                    error: 'No price data found'
                });
            }
        } catch (error) {
            log(`❌ Error handling price request: ${error}`);
            this.sendMessage(client, {
                type: 'error',
                data: { message: error instanceof Error ? error.message : String(error) }
            });
        }
    }

    private sendMessage(client: WebSocketClient, message: any) {
        if (client.socket.readyState === WebSocket.OPEN) {
            try {
                client.socket.send(JSON.stringify(message));
            } catch (error) {
                log(`❌ Error sending message to client ${client.id}: ${error}`);
            }
        }
    }

    private broadcast(message: any, filter?: (client: WebSocketClient) => boolean) {
        this.clients.forEach((client) => {
            if (!filter || filter(client)) {
                this.sendMessage(client, message);
            }
        });
    }

    // Public methods for broadcasting updates
    public broadcastPriceUpdate(priceUpdate: PriceUpdate) {
        // Update cache
        const cacheKey = `${priceUpdate.commodityId}:${priceUpdate.regionId}`;
        this.priceCache.set(cacheKey, priceUpdate);

        // Broadcast to subscribed clients
        this.broadcast({
            type: 'price_update',
            data: priceUpdate
        }, (client) => {
            return client.subscriptions.has('all') ||
                client.subscriptions.has(`price:${priceUpdate.commodityId}:${priceUpdate.regionId}`) ||
                client.subscriptions.has(`price:${priceUpdate.commodityId}:*`) ||
                client.subscriptions.has(`price:*:${priceUpdate.regionId}`) ||
                client.subscriptions.has('price:*:*');
        });

        log(`📊 Broadcasted price update for ${priceUpdate.commodityId} in ${priceUpdate.regionId}: $${priceUpdate.price}`);
    }

    public broadcastForecastUpdate(commodityId: string, regionId: string, forecastData: any) {
        this.broadcast({
            type: 'forecast_update',
            data: {
                commodityId,
                regionId,
                ...forecastData,
                timestamp: new Date().toISOString()
            }
        }, (client) => {
            return client.subscriptions.has('all') ||
                client.subscriptions.has(`forecast:${commodityId}:${regionId}`) ||
                client.subscriptions.has(`forecast:${commodityId}:*`) ||
                client.subscriptions.has(`forecast:*:${regionId}`);
        });

        log(`🔮 Broadcasted forecast update for ${commodityId} in ${regionId}`);
    }

    public broadcastAlert(alert: ForecastAlert) {
        this.broadcast({
            type: 'alert',
            data: alert
        }, (client) => {
            return client.subscriptions.has('all') ||
                client.subscriptions.has(`alert:${alert.commodityId}:${alert.regionId}`) ||
                client.subscriptions.has(`alert:${alert.commodityId}:*`) ||
                client.subscriptions.has('alert:*:*');
        });

        log(`🚨 Broadcasted ${alert.severity} alert: ${alert.message}`);
    }

    public broadcastSystemNotification(notification: any) {
        this.broadcast({
            type: 'system_notification',
            data: {
                ...notification,
                timestamp: new Date().toISOString()
            }
        });

        log(`📢 Broadcasted system notification: ${notification.message}`);
    }

    private startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            const now = new Date();
            const staleThreshold = 60000; // 1 minute

            this.clients.forEach((client, clientId) => {
                const timeSinceHeartbeat = now.getTime() - client.lastHeartbeat.getTime();

                if (timeSinceHeartbeat > staleThreshold) {
                    log(`💔 Removing stale client ${clientId} (last heartbeat: ${client.lastHeartbeat})`);
                    client.socket.terminate();
                    this.clients.delete(clientId);
                } else {
                    // Send ping to active clients
                    this.sendMessage(client, {
                        type: 'ping',
                        data: { timestamp: now.toISOString() }
                    });
                }
            });
        }, 30000); // Check every 30 seconds
    }

    private async initializePriceCache() {
        try {
            // Load recent prices into cache
            const recentPrices = await db
                .select()
                .from(priceData)
                .orderBy(desc(priceData.date))
                .limit(1000);

            const priceMap = new Map<string, any>();

            recentPrices.forEach((price: any) => {
                const key = `${price.commodityId}:${price.regionId}`;
                const existing = priceMap.get(key);

                if (!existing || new Date(price.date) > new Date(existing.date)) {
                    priceMap.set(key, price);
                }
            });

            // Convert to cache format
            priceMap.forEach((price, key) => {
                const priceUpdate: PriceUpdate = {
                    commodityId: price.commodityId,
                    regionId: price.regionId,
                    price: parseFloat(price.price),
                    currency: price.currency,
                    timestamp: price.date,
                    source: price.source,
                    changePercent: 0, // Would need historical data to calculate
                    trend: 'stable'
                };
                this.priceCache.set(key, priceUpdate);
            });

            log(`📊 Initialized price cache with ${this.priceCache.size} entries`);
        } catch (error) {
            log(`❌ Error initializing price cache: ${error}`);
        }
    }

    private generateClientId(): string {
        return `client_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }

    public getStats() {
        const activeClients = Array.from(this.clients.values()).filter(
            client => client.socket.readyState === WebSocket.OPEN
        );

        return {
            totalClients: this.clients.size,
            activeClients: activeClients.length,
            totalSubscriptions: activeClients.reduce((sum, client) => sum + client.subscriptions.size, 0),
            cacheSize: this.priceCache.size,
            uptime: process.uptime()
        };
    }

    public cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.clients.forEach((client) => {
            client.socket.close();
        });

        this.clients.clear();
        this.priceCache.clear();

        log('🧹 WebSocket service cleaned up');
    }
}

export { WebSocketService, type PriceUpdate, type ForecastAlert };