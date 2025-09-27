import crypto from 'crypto';

// Cache configuration
interface CacheConfig {
  defaultTtlMs: number;        // Default TTL for cached items (30 minutes)
  maxCacheSize: number;        // Maximum number of cached items
  cleanupIntervalMs: number;   // How often to clean expired items
  similarityThreshold: number; // Threshold for content similarity (0.85 = 85%)
  enableSimilarityDeduplication: boolean; // Enable content-based deduplication
}

const DEFAULT_CONFIG: CacheConfig = {
  defaultTtlMs: 30 * 60 * 1000, // 30 minutes
  maxCacheSize: 10000,          // 10k cached verification results
  cleanupIntervalMs: 5 * 60 * 1000, // Cleanup every 5 minutes
  similarityThreshold: 0.85,    // 85% similarity threshold
  enableSimilarityDeduplication: true
};

// Cached verification result
interface CachedVerification {
  key: string;
  fingerprint: string;
  result: any;                  // The verification result
  timestamp: number;            // When cached
  expiresAt: number;           // When to expire
  ttlMs: number;               // Original TTL
  accessCount: number;         // How many times accessed
  lastAccessed: number;        // Last access timestamp
  metadata: {
    commodityId: string;
    regionId: string;
    forecastHash: string;
    contentSignature: string;  // For similarity matching
    requestContext: any;
  };
}

// Cache hit/miss statistics
interface CacheStats {
  hits: number;
  misses: number;
  similarityHits: number;      // Hits due to content similarity
  evictions: number;           // Items evicted due to size limits
  expirations: number;         // Items expired due to TTL
  totalRequests: number;
  hitRate: number;            // Percentage
  averageResponseTime: number; // Average time to retrieve from cache
  cacheSize: number;          // Current cache size
  memoryUsage: number;        // Estimated memory usage in bytes
}

// Request fingerprinting context
interface ForecastVerificationContext {
  commodityId: string;
  regionId: string;
  predictions: any[];
  metrics: any;
  method: string;
  horizon: number;
  modelVersion: string;
  additionalContext?: any;
}

// Content similarity result
interface SimilarityResult {
  isSimilar: boolean;
  similarity: number;         // 0-1 score
  matchingKey?: string;       // Key of similar cached item
  matchingItem?: CachedVerification;
}

class VerificationCache {
  private cache: Map<string, CachedVerification> = new Map();
  private config: CacheConfig;
  private stats: CacheStats;
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(customConfig?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.stats = {
      hits: 0,
      misses: 0,
      similarityHits: 0,
      evictions: 0,
      expirations: 0,
      totalRequests: 0,
      hitRate: 0,
      averageResponseTime: 0,
      cacheSize: 0,
      memoryUsage: 0
    };
    
    this.startCleanupTimer();
    console.log('[VerificationCache] Initialized with config:', this.config);
  }

  /**
   * Generate fingerprint for forecast verification request
   */
  generateFingerprint(context: ForecastVerificationContext, provider: string): string {
    // Create deterministic content hash based on verification inputs
    const contentData = {
      commodityId: context.commodityId,
      regionId: context.regionId,
      method: context.method,
      horizon: context.horizon,
      modelVersion: context.modelVersion,
      provider: provider,
      // Include key prediction characteristics for fingerprinting
      predictionsSignature: this.createPredictionsSignature(context.predictions),
      metricsSignature: this.createMetricsSignature(context.metrics),
      additionalSignature: this.createAdditionalSignature(context.additionalContext)
    };
    
    const contentString = JSON.stringify(contentData, Object.keys(contentData).sort());
    return crypto.createHash('sha256').update(contentString).digest('hex').substring(0, 16);
  }

  /**
   * Create content signature for similarity matching
   */
  private createContentSignature(context: ForecastVerificationContext): string {
    // Create signature based on semantic content (less strict than fingerprint)
    const semanticData = {
      commodity: context.commodityId,
      region: context.regionId,
      method: context.method,
      horizon: context.horizon,
      // Price range and trends (rounded for similarity)
      priceRange: this.extractPriceRange(context.predictions),
      trendDirection: this.extractTrendDirection(context.predictions),
      qualityTier: this.extractQualityTier(context.metrics)
    };
    
    const semanticString = JSON.stringify(semanticData, Object.keys(semanticData).sort());
    return crypto.createHash('md5').update(semanticString).digest('hex').substring(0, 12);
  }

  /**
   * Get cached verification result
   */
  async get(
    context: ForecastVerificationContext,
    provider: string,
    enableSimilarityMatch = true
  ): Promise<{ result: any; cacheHit: boolean; similarity?: number } | null> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    
    const fingerprint = this.generateFingerprint(context, provider);
    const cacheKey = `${provider}:${fingerprint}`;
    
    // Direct cache hit
    const cachedItem = this.cache.get(cacheKey);
    if (cachedItem && !this.isExpired(cachedItem)) {
      this.recordCacheHit(cachedItem, Date.now() - startTime);
      console.log(`[VerificationCache] Direct hit for ${provider}:${context.commodityId} (${fingerprint})`);
      return {
        result: cachedItem.result,
        cacheHit: true
      };
    }

    // Similarity-based matching if enabled
    if (enableSimilarityMatch && this.config.enableSimilarityDeduplication) {
      const contentSignature = this.createContentSignature(context);
      const similarityResult = await this.findSimilarCachedItem(contentSignature, provider, context);
      
      if (similarityResult.isSimilar && similarityResult.matchingItem) {
        this.recordSimilarityHit(similarityResult.matchingItem, Date.now() - startTime);
        console.log(`[VerificationCache] Similarity hit for ${provider}:${context.commodityId} (similarity: ${(similarityResult.similarity * 100).toFixed(1)}%)`);
        return {
          result: similarityResult.matchingItem.result,
          cacheHit: true,
          similarity: similarityResult.similarity
        };
      }
    }

    // Cache miss
    this.stats.misses++;
    this.updateHitRate();
    console.log(`[VerificationCache] Miss for ${provider}:${context.commodityId} (${fingerprint})`);
    
    return null;
  }

  /**
   * Store verification result in cache
   */
  async set(
    context: ForecastVerificationContext,
    provider: string,
    result: any,
    customTtlMs?: number
  ): Promise<void> {
    const fingerprint = this.generateFingerprint(context, provider);
    const cacheKey = `${provider}:${fingerprint}`;
    const ttl = customTtlMs || this.config.defaultTtlMs;
    const now = Date.now();
    
    // Remove existing item if present
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    }
    
    // Create cached verification item
    const cachedItem: CachedVerification = {
      key: cacheKey,
      fingerprint,
      result,
      timestamp: now,
      expiresAt: now + ttl,
      ttlMs: ttl,
      accessCount: 0,
      lastAccessed: now,
      metadata: {
        commodityId: context.commodityId,
        regionId: context.regionId,
        forecastHash: this.createForecastHash(context),
        contentSignature: this.createContentSignature(context),
        requestContext: {
          method: context.method,
          horizon: context.horizon,
          modelVersion: context.modelVersion
        }
      }
    };
    
    // Enforce cache size limits
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictLeastRecentlyUsed();
    }
    
    this.cache.set(cacheKey, cachedItem);
    this.updateCacheStats();
    
    console.log(`[VerificationCache] Stored ${provider}:${context.commodityId} (${fingerprint}) TTL: ${Math.round(ttl / 1000)}s`);
  }

  /**
   * Invalidate cache entries for updated forecasts
   */
  async invalidateByForecast(commodityId: string, regionId: string, forecastId?: string): Promise<number> {
    let invalidatedCount = 0;
    
    for (const [key, cachedItem] of this.cache.entries()) {
      // Match by commodity and region
      if (cachedItem.metadata.commodityId === commodityId && 
          cachedItem.metadata.regionId === regionId) {
        this.cache.delete(key);
        invalidatedCount++;
      }
    }
    
    this.updateCacheStats();
    console.log(`[VerificationCache] Invalidated ${invalidatedCount} items for ${commodityId}:${regionId}`);
    return invalidatedCount;
  }

  /**
   * Invalidate cache entries by provider (for service outages)
   */
  async invalidateByProvider(provider: string): Promise<number> {
    let invalidatedCount = 0;
    
    for (const [key, cachedItem] of this.cache.entries()) {
      if (key.startsWith(`${provider}:`)) {
        this.cache.delete(key);
        invalidatedCount++;
      }
    }
    
    this.updateCacheStats();
    console.log(`[VerificationCache] Invalidated ${invalidatedCount} items for provider ${provider}`);
    return invalidatedCount;
  }

  /**
   * Find similar cached items based on content similarity
   */
  private async findSimilarCachedItem(
    contentSignature: string,
    provider: string,
    context: ForecastVerificationContext
  ): Promise<SimilarityResult> {
    const candidates: { key: string; item: CachedVerification; similarity: number }[] = [];
    
    // Find potential matches from same provider and similar context
    for (const [key, cachedItem] of this.cache.entries()) {
      if (key.startsWith(`${provider}:`) && 
          !this.isExpired(cachedItem) &&
          cachedItem.metadata.commodityId === context.commodityId &&
          cachedItem.metadata.regionId === context.regionId) {
        
        const similarity = this.calculateContentSimilarity(
          contentSignature,
          cachedItem.metadata.contentSignature,
          context,
          cachedItem
        );
        
        if (similarity >= this.config.similarityThreshold) {
          candidates.push({ key, item: cachedItem, similarity });
        }
      }
    }
    
    if (candidates.length === 0) {
      return { isSimilar: false, similarity: 0 };
    }
    
    // Return best match
    const bestMatch = candidates.sort((a, b) => b.similarity - a.similarity)[0];
    
    return {
      isSimilar: true,
      similarity: bestMatch.similarity,
      matchingKey: bestMatch.key,
      matchingItem: bestMatch.item
    };
  }

  /**
   * Calculate content similarity between two verification contexts
   */
  private calculateContentSimilarity(
    signature1: string,
    signature2: string,
    context1: ForecastVerificationContext,
    cachedItem: CachedVerification
  ): number {
    // Signature-based similarity (60% weight)
    const signatureSimilarity = signature1 === signature2 ? 1.0 : 0.0;
    
    // Context-based similarity (40% weight)
    let contextSimilarity = 0.0;
    let contextFactors = 0;
    
    // Method similarity
    if (context1.method === cachedItem.metadata.requestContext.method) {
      contextSimilarity += 1.0;
    }
    contextFactors += 1;
    
    // Horizon similarity (allow ±2 day difference)
    const horizonDiff = Math.abs(context1.horizon - cachedItem.metadata.requestContext.horizon);
    const horizonSimilarity = Math.max(0, 1.0 - (horizonDiff / 10.0)); // 10% penalty per day diff
    contextSimilarity += horizonSimilarity;
    contextFactors += 1;
    
    // Model version similarity
    if (context1.modelVersion === cachedItem.metadata.requestContext.modelVersion) {
      contextSimilarity += 1.0;
    }
    contextFactors += 1;
    
    // Calculate weighted average
    const avgContextSimilarity = contextFactors > 0 ? contextSimilarity / contextFactors : 0;
    const overallSimilarity = (signatureSimilarity * 0.6) + (avgContextSimilarity * 0.4);
    
    return overallSimilarity;
  }

  /**
   * Helper functions for creating signatures
   */
  private createPredictionsSignature(predictions: any[]): string {
    if (!Array.isArray(predictions) || predictions.length === 0) return 'empty';
    
    // Create signature based on key price points and trends
    const keyPoints = predictions.map(p => ({
      median: Math.round(p.median * 100) / 100, // Round to 2 decimals
      confidence: Math.round(p.confidence * 10) / 10, // Round to 1 decimal
      trend: p.trend
    }));
    
    return crypto.createHash('md5').update(JSON.stringify(keyPoints)).digest('hex').substring(0, 8);
  }

  private createMetricsSignature(metrics: any): string {
    if (!metrics) return 'empty';
    
    // Round metrics for consistent signature
    const roundedMetrics = {
      mase: metrics.mase ? Math.round(metrics.mase * 1000) / 1000 : null,
      smape: metrics.smape ? Math.round(metrics.smape * 100) / 100 : null,
      picp: metrics.picp ? Math.round(metrics.picp * 100) / 100 : null,
      fqs: metrics.fqs ? Math.round(metrics.fqs * 100) / 100 : null
    };
    
    return crypto.createHash('md5').update(JSON.stringify(roundedMetrics)).digest('hex').substring(0, 8);
  }

  private createAdditionalSignature(additionalContext: any): string {
    if (!additionalContext) return 'empty';
    return crypto.createHash('md5').update(JSON.stringify(additionalContext)).digest('hex').substring(0, 8);
  }

  private createForecastHash(context: ForecastVerificationContext): string {
    const forecastData = {
      commodity: context.commodityId,
      region: context.regionId,
      predictions: context.predictions,
      metrics: context.metrics
    };
    return crypto.createHash('sha256').update(JSON.stringify(forecastData)).digest('hex').substring(0, 16);
  }

  /**
   * Extract semantic features for similarity matching
   */
  private extractPriceRange(predictions: any[]): string {
    if (!Array.isArray(predictions) || predictions.length === 0) return 'unknown';
    
    const prices = predictions.map(p => p.median).filter(p => typeof p === 'number');
    if (prices.length === 0) return 'unknown';
    
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    
    // Categorize price range relative to average
    const rangePercent = (range / avgPrice) * 100;
    
    if (rangePercent < 5) return 'stable';
    if (rangePercent < 15) return 'moderate';
    if (rangePercent < 30) return 'volatile';
    return 'highly_volatile';
  }

  private extractTrendDirection(predictions: any[]): string {
    if (!Array.isArray(predictions) || predictions.length < 2) return 'unknown';
    
    const prices = predictions.map(p => p.median).filter(p => typeof p === 'number');
    if (prices.length < 2) return 'unknown';
    
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;
    
    if (Math.abs(change) < 2) return 'flat';
    return change > 0 ? 'rising' : 'falling';
  }

  private extractQualityTier(metrics: any): string {
    if (!metrics) return 'unknown';
    
    const mase = metrics.mase || 1.0;
    const smape = metrics.smape || 100;
    const picp = metrics.picp || 0;
    
    // Simple quality classification
    if (mase < 0.8 && smape < 10 && picp > 0.9) return 'excellent';
    if (mase < 1.0 && smape < 20 && picp > 0.8) return 'good';
    if (mase < 1.5 && smape < 30 && picp > 0.7) return 'fair';
    return 'poor';
  }

  /**
   * Cache maintenance and statistics
   */
  private isExpired(cachedItem: CachedVerification): boolean {
    return Date.now() > cachedItem.expiresAt;
  }

  private recordCacheHit(cachedItem: CachedVerification, responseTimeMs: number): void {
    cachedItem.accessCount++;
    cachedItem.lastAccessed = Date.now();
    this.stats.hits++;
    this.updateHitRate();
    this.updateResponseTime(responseTimeMs);
  }

  private recordSimilarityHit(cachedItem: CachedVerification, responseTimeMs: number): void {
    cachedItem.accessCount++;
    cachedItem.lastAccessed = Date.now();
    this.stats.hits++;
    this.stats.similarityHits++;
    this.updateHitRate();
    this.updateResponseTime(responseTimeMs);
  }

  private evictLeastRecentlyUsed(): void {
    if (this.cache.size === 0) return;
    
    let lruKey = '';
    let lruTime = Date.now();
    
    for (const [key, cachedItem] of this.cache.entries()) {
      if (cachedItem.lastAccessed < lruTime) {
        lruTime = cachedItem.lastAccessed;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      console.log(`[VerificationCache] Evicted LRU item: ${lruKey}`);
    }
  }

  private updateHitRate(): void {
    this.stats.hitRate = this.stats.totalRequests > 0 
      ? (this.stats.hits / this.stats.totalRequests) * 100 
      : 0;
  }

  private updateResponseTime(responseTimeMs: number): void {
    this.stats.averageResponseTime = (this.stats.averageResponseTime + responseTimeMs) / 2;
  }

  private updateCacheStats(): void {
    this.stats.cacheSize = this.cache.size;
    // Rough memory usage estimation
    this.stats.memoryUsage = this.cache.size * 1024; // ~1KB per cached item
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredItems();
    }, this.config.cleanupIntervalMs);
  }

  private cleanupExpiredItems(): void {
    let expiredCount = 0;
    const now = Date.now();
    
    for (const [key, cachedItem] of this.cache.entries()) {
      if (cachedItem.expiresAt < now) {
        this.cache.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.stats.expirations += expiredCount;
      this.updateCacheStats();
      console.log(`[VerificationCache] Cleaned up ${expiredCount} expired items`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateCacheStats();
    return { ...this.stats };
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    const clearedCount = this.cache.size;
    this.cache.clear();
    this.updateCacheStats();
    console.log(`[VerificationCache] Cleared ${clearedCount} items from cache`);
  }

  /**
   * Get cache keys matching pattern
   */
  getKeys(pattern?: string): string[] {
    if (!pattern) {
      return Array.from(this.cache.keys());
    }
    
    const regex = new RegExp(pattern);
    return Array.from(this.cache.keys()).filter(key => regex.test(key));
  }

  /**
   * Shutdown cache (cleanup timers)
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    console.log('[VerificationCache] Shutdown complete');
  }
}

// Export singleton instance
export const verificationCache = new VerificationCache();
export { VerificationCache, type CacheConfig, type CachedVerification, type CacheStats, type ForecastVerificationContext };