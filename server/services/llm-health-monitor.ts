/**
 * LLM Health Monitor Service
 * 
 * Provides comprehensive logging and monitoring for LLM service health,
 * performance metrics, and alerting for Vietnamese agricultural forecasting platform.
 */

import { storage } from "../storage";

// Health Status Types
interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  responseTime: number;
  errorRate: number;
  consecutiveFailures: number;
  uptime: number;
  metadata: any;
}

interface LLMHealthMetrics {
  openai: ServiceHealth;
  gemini: ServiceHealth;
  overall: ServiceHealth;
  circuitBreakers: {
    openai: CircuitBreakerStatus;
    gemini: CircuitBreakerStatus;
  };
  cache: CacheHealthMetrics;
  performance: PerformanceMetrics;
  alerts: Alert[];
}

interface CircuitBreakerStatus {
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailure: Date | null;
  nextRetry: Date | null;
  isHealthy: boolean;
}

interface CacheHealthMetrics {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  totalEntries: number;
  averageAge: number;
  memoryUsage: number;
}

interface PerformanceMetrics {
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerMinute: number;
  successRate: number;
  verificationThroughput: number;
  fallbackUsageRate: number;
}

interface Alert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  service: string;
  resolved: boolean;
  metadata: any;
}

// Monitoring Configuration
interface MonitoringConfig {
  healthCheckInterval: number; // milliseconds
  metricsRetentionPeriod: number; // hours
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    consecutiveFailures: number;
    cacheHitRate: number;
  };
  enableAlerting: boolean;
  enableMetricsCollection: boolean;
}

class LLMHealthMonitor {
  private config: MonitoringConfig;
  private healthMetrics: LLMHealthMetrics;
  private metricsHistory: Map<string, any[]> = new Map();
  private alertHistory: Alert[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;

  constructor() {
    this.config = {
      healthCheckInterval: 60000, // 1 minute
      metricsRetentionPeriod: 24, // 24 hours
      alertThresholds: {
        errorRate: 0.05, // 5%
        responseTime: 5000, // 5 seconds
        consecutiveFailures: 3,
        cacheHitRate: 0.70 // 70%
      },
      enableAlerting: true,
      enableMetricsCollection: true
    };

    this.healthMetrics = this.initializeHealthMetrics();
    this.startMonitoring();
  }

  /**
   * Initialize health metrics structure
   */
  private initializeHealthMetrics(): LLMHealthMetrics {
    const defaultServiceHealth: ServiceHealth = {
      status: 'unknown',
      lastCheck: new Date(),
      responseTime: 0,
      errorRate: 0,
      consecutiveFailures: 0,
      uptime: 100,
      metadata: {}
    };

    return {
      openai: { ...defaultServiceHealth },
      gemini: { ...defaultServiceHealth },
      overall: { ...defaultServiceHealth },
      circuitBreakers: {
        openai: {
          state: 'closed',
          failureCount: 0,
          lastFailure: null,
          nextRetry: null,
          isHealthy: true
        },
        gemini: {
          state: 'closed',
          failureCount: 0,
          lastFailure: null,
          nextRetry: null,
          isHealthy: true
        }
      },
      cache: {
        hitRate: 0,
        missRate: 0,
        evictionRate: 0,
        totalEntries: 0,
        averageAge: 0,
        memoryUsage: 0
      },
      performance: {
        averageResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        requestsPerMinute: 0,
        successRate: 100,
        verificationThroughput: 0,
        fallbackUsageRate: 0
      },
      alerts: []
    };
  }

  /**
   * Start continuous health monitoring
   */
  public startMonitoring(): void {
    if (this.isMonitoring) {
      console.log('[LLMHealthMonitor] Monitoring already active');
      return;
    }

    console.log(`[LLMHealthMonitor] Starting health monitoring (interval: ${this.config.healthCheckInterval}ms)`);
    this.isMonitoring = true;

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
        await this.collectMetrics();
        await this.evaluateAlerts();
        this.cleanupOldMetrics();
      } catch (error) {
        console.error('[LLMHealthMonitor] Health check cycle failed:', error);
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('[LLMHealthMonitor] Health monitoring stopped');
  }

  /**
   * Record LLM service interaction for health tracking
   */
  public recordServiceInteraction(
    provider: 'openai' | 'gemini',
    success: boolean,
    responseTime: number,
    errorType?: string,
    metadata?: any
  ): void {
    const timestamp = new Date();
    const serviceHealth = this.healthMetrics[provider];

    // Update response time (rolling average)
    serviceHealth.responseTime = (serviceHealth.responseTime + responseTime) / 2;
    serviceHealth.lastCheck = timestamp;

    // Update error tracking
    if (success) {
      serviceHealth.consecutiveFailures = 0;
      serviceHealth.status = responseTime > this.config.alertThresholds.responseTime ? 'degraded' : 'healthy';
    } else {
      serviceHealth.consecutiveFailures++;
      serviceHealth.status = serviceHealth.consecutiveFailures >= this.config.alertThresholds.consecutiveFailures 
        ? 'unhealthy' : 'degraded';
    }

    // Record interaction for metrics
    this.recordMetricsData('service_interaction', {
      provider,
      success,
      responseTime,
      errorType,
      timestamp,
      metadata
    });

    // Check for alert conditions
    this.checkServiceAlerts(provider, serviceHealth);

    console.log(`[LLMHealthMonitor] ${provider.toUpperCase()} interaction recorded: ${success ? 'SUCCESS' : 'FAILURE'} (${responseTime}ms)`);
  }

  /**
   * Record circuit breaker state change
   */
  public recordCircuitBreakerState(
    provider: 'openai' | 'gemini',
    state: 'closed' | 'open' | 'half_open',
    failureCount: number,
    lastFailure?: Date
  ): void {
    const circuitBreaker = this.healthMetrics.circuitBreakers[provider];
    const previousState = circuitBreaker.state;

    circuitBreaker.state = state;
    circuitBreaker.failureCount = failureCount;
    circuitBreaker.isHealthy = state === 'closed';
    
    if (lastFailure) {
      circuitBreaker.lastFailure = lastFailure;
    }

    // Calculate next retry time for open state
    if (state === 'open') {
      circuitBreaker.nextRetry = new Date(Date.now() + (failureCount * 2000)); // Exponential backoff
    } else {
      circuitBreaker.nextRetry = null;
    }

    // Log state change
    if (previousState !== state) {
      console.log(`[LLMHealthMonitor] ${provider.toUpperCase()} circuit breaker: ${previousState} → ${state} (failures: ${failureCount})`);
      
      // Generate alert for critical state changes
      if (state === 'open') {
        this.generateAlert('error', `${provider.toUpperCase()} circuit breaker opened`, provider, {
          failureCount,
          previousState,
          newState: state
        });
      } else if (state === 'closed' && previousState === 'open') {
        this.generateAlert('info', `${provider.toUpperCase()} circuit breaker closed - service recovered`, provider, {
          previousState,
          newState: state
        });
      }
    }

    this.recordMetricsData('circuit_breaker_state', {
      provider,
      state,
      failureCount,
      timestamp: new Date(),
      stateChange: previousState !== state
    });
  }

  /**
   * Record cache performance metrics
   */
  public recordCacheMetrics(
    operation: 'hit' | 'miss' | 'eviction' | 'set',
    responseTime?: number,
    cacheSize?: number
  ): void {
    const cache = this.healthMetrics.cache;
    
    // Update cache metrics based on operation
    switch (operation) {
      case 'hit':
        cache.hitRate = (cache.hitRate * 0.9) + (1 * 0.1); // Weighted moving average
        break;
      case 'miss':
        cache.missRate = (cache.missRate * 0.9) + (1 * 0.1);
        break;
      case 'eviction':
        cache.evictionRate = (cache.evictionRate * 0.9) + (1 * 0.1);
        break;
    }

    if (cacheSize !== undefined) {
      cache.totalEntries = cacheSize;
    }

    this.recordMetricsData('cache_operation', {
      operation,
      responseTime,
      cacheSize,
      timestamp: new Date(),
      hitRate: cache.hitRate,
      missRate: cache.missRate
    });

    // Check cache health alerts
    if (cache.hitRate < this.config.alertThresholds.cacheHitRate) {
      this.generateAlert('warning', `Cache hit rate below threshold: ${(cache.hitRate * 100).toFixed(1)}%`, 'cache', {
        hitRate: cache.hitRate,
        threshold: this.config.alertThresholds.cacheHitRate
      });
    }
  }

  /**
   * Record verification performance metrics
   */
  public recordVerificationMetrics(
    totalTime: number,
    success: boolean,
    fallbacksUsed: number,
    cacheHit: boolean,
    providersUsed: string[]
  ): void {
    const performance = this.healthMetrics.performance;
    
    // Update performance metrics
    performance.averageResponseTime = (performance.averageResponseTime + totalTime) / 2;
    performance.successRate = (performance.successRate * 0.95) + ((success ? 100 : 0) * 0.05);
    performance.fallbackUsageRate = (performance.fallbackUsageRate * 0.9) + ((fallbacksUsed > 0 ? 1 : 0) * 0.1);

    this.recordMetricsData('verification_performance', {
      totalTime,
      success,
      fallbacksUsed,
      cacheHit,
      providersUsed,
      timestamp: new Date(),
      successRate: performance.successRate,
      fallbackUsageRate: performance.fallbackUsageRate
    });

    console.log(`[LLMHealthMonitor] Verification metrics recorded: ${totalTime}ms (success: ${success}, fallbacks: ${fallbacksUsed}, cache: ${cacheHit})`);
  }

  /**
   * Get current health metrics
   */
  public getHealthMetrics(): LLMHealthMetrics {
    this.updateOverallHealth();
    return { ...this.healthMetrics };
  }

  /**
   * Get health status for specific service
   */
  public getServiceHealth(service: 'openai' | 'gemini' | 'overall'): ServiceHealth {
    this.updateOverallHealth();
    return { ...this.healthMetrics[service] };
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): Alert[] {
    return this.healthMetrics.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Get metrics history for specific metric
   */
  public getMetricsHistory(metricType: string, hours: number = 1): any[] {
    const history = this.metricsHistory.get(metricType) || [];
    const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
    
    return history.filter(record => record.timestamp >= cutoff);
  }

  /**
   * Generate health dashboard data
   */
  public generateDashboardData(): any {
    const now = new Date();
    const last24h = this.getMetricsHistory('service_interaction', 24);
    const last1h = this.getMetricsHistory('service_interaction', 1);

    return {
      timestamp: now,
      healthStatus: this.getHealthMetrics(),
      summary: {
        totalRequests24h: last24h.length,
        totalRequests1h: last1h.length,
        successRate24h: last24h.length > 0 ? 
          (last24h.filter(r => r.success).length / last24h.length) * 100 : 100,
        activeAlerts: this.getActiveAlerts().length,
        criticalAlerts: this.getActiveAlerts().filter(a => a.level === 'critical').length,
        avgResponseTime: this.healthMetrics.performance.averageResponseTime,
        cacheHitRate: this.healthMetrics.cache.hitRate * 100
      },
      services: {
        openai: {
          status: this.healthMetrics.openai.status,
          responseTime: this.healthMetrics.openai.responseTime,
          circuitBreakerState: this.healthMetrics.circuitBreakers.openai.state,
          uptime: this.healthMetrics.openai.uptime
        },
        gemini: {
          status: this.healthMetrics.gemini.status,
          responseTime: this.healthMetrics.gemini.responseTime,
          circuitBreakerState: this.healthMetrics.circuitBreakers.gemini.state,
          uptime: this.healthMetrics.gemini.uptime
        }
      },
      alerts: this.getActiveAlerts(),
      trends: {
        responseTime: this.getMetricsHistory('service_interaction', 1)
          .map(r => ({ timestamp: r.timestamp, value: r.responseTime })),
        successRate: this.calculateTrendData('success_rate', 1),
        cacheHitRate: this.calculateTrendData('cache_hit_rate', 1)
      }
    };
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Check each service individually
      await Promise.all([
        this.checkServiceHealth('openai'),
        this.checkServiceHealth('gemini')
      ]);

      // Update overall health
      this.updateOverallHealth();

      console.log('[LLMHealthMonitor] Health check completed:', {
        openai: this.healthMetrics.openai.status,
        gemini: this.healthMetrics.gemini.status,
        overall: this.healthMetrics.overall.status
      });

    } catch (error) {
      console.error('[LLMHealthMonitor] Health check failed:', error);
    }
  }

  /**
   * Check individual service health
   */
  private async checkServiceHealth(provider: 'openai' | 'gemini'): Promise<void> {
    const serviceHealth = this.healthMetrics[provider];
    const timeSinceLastCheck = Date.now() - serviceHealth.lastCheck.getTime();

    // If no recent interactions, mark as unknown
    if (timeSinceLastCheck > 300000) { // 5 minutes
      serviceHealth.status = 'unknown';
      return;
    }

    // Calculate uptime based on recent success rate
    const recentInteractions = this.getMetricsHistory('service_interaction', 1)
      .filter(r => r.provider === provider);
    
    if (recentInteractions.length > 0) {
      const successCount = recentInteractions.filter(r => r.success).length;
      serviceHealth.uptime = (successCount / recentInteractions.length) * 100;
      serviceHealth.errorRate = ((recentInteractions.length - successCount) / recentInteractions.length);
    }
  }

  /**
   * Update overall health based on individual services
   */
  private updateOverallHealth(): void {
    const { openai, gemini } = this.healthMetrics;
    const overall = this.healthMetrics.overall;

    // Determine overall status
    if (openai.status === 'healthy' && gemini.status === 'healthy') {
      overall.status = 'healthy';
    } else if (openai.status === 'unhealthy' && gemini.status === 'unhealthy') {
      overall.status = 'unhealthy';
    } else {
      overall.status = 'degraded';
    }

    // Calculate average metrics
    overall.responseTime = (openai.responseTime + gemini.responseTime) / 2;
    overall.uptime = (openai.uptime + gemini.uptime) / 2;
    overall.errorRate = (openai.errorRate + gemini.errorRate) / 2;
    overall.lastCheck = new Date();
  }

  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<void> {
    if (!this.config.enableMetricsCollection) return;

    const timestamp = new Date();
    
    // Calculate performance metrics
    const recentInteractions = this.getMetricsHistory('service_interaction', 1);
    if (recentInteractions.length > 0) {
      const responseTimes = recentInteractions.map(r => r.responseTime);
      responseTimes.sort((a, b) => a - b);
      
      this.healthMetrics.performance.p95ResponseTime = responseTimes[Math.floor(responseTimes.length * 0.95)];
      this.healthMetrics.performance.p99ResponseTime = responseTimes[Math.floor(responseTimes.length * 0.99)];
      this.healthMetrics.performance.requestsPerMinute = recentInteractions.length;
    }

    this.recordMetricsData('performance_snapshot', {
      timestamp,
      metrics: { ...this.healthMetrics.performance }
    });
  }

  /**
   * Evaluate and generate alerts
   */
  private async evaluateAlerts(): Promise<void> {
    if (!this.config.enableAlerting) return;

    // Check for system-wide issues
    const overall = this.healthMetrics.overall;
    
    if (overall.status === 'unhealthy') {
      this.generateAlert('critical', 'LLM verification system unhealthy - both providers degraded', 'system', {
        openaiStatus: this.healthMetrics.openai.status,
        geminiStatus: this.healthMetrics.gemini.status
      });
    }

    // Check performance thresholds
    if (overall.responseTime > this.config.alertThresholds.responseTime) {
      this.generateAlert('warning', `High response time: ${overall.responseTime.toFixed(0)}ms`, 'performance', {
        responseTime: overall.responseTime,
        threshold: this.config.alertThresholds.responseTime
      });
    }

    // Check cache performance
    const cacheHitRate = this.healthMetrics.cache.hitRate;
    if (cacheHitRate < this.config.alertThresholds.cacheHitRate) {
      this.generateAlert('warning', `Low cache hit rate: ${(cacheHitRate * 100).toFixed(1)}%`, 'cache', {
        hitRate: cacheHitRate,
        threshold: this.config.alertThresholds.cacheHitRate
      });
    }
  }

  /**
   * Check service-specific alerts
   */
  private checkServiceAlerts(provider: 'openai' | 'gemini', serviceHealth: ServiceHealth): void {
    if (serviceHealth.consecutiveFailures >= this.config.alertThresholds.consecutiveFailures) {
      this.generateAlert('error', `${provider.toUpperCase()} service: ${serviceHealth.consecutiveFailures} consecutive failures`, provider, {
        consecutiveFailures: serviceHealth.consecutiveFailures,
        status: serviceHealth.status
      });
    }

    if (serviceHealth.errorRate > this.config.alertThresholds.errorRate) {
      this.generateAlert('warning', `${provider.toUpperCase()} high error rate: ${(serviceHealth.errorRate * 100).toFixed(1)}%`, provider, {
        errorRate: serviceHealth.errorRate,
        threshold: this.config.alertThresholds.errorRate
      });
    }
  }

  /**
   * Generate alert
   */
  private generateAlert(
    level: 'info' | 'warning' | 'error' | 'critical',
    message: string,
    service: string,
    metadata: any = {}
  ): void {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      level,
      message,
      timestamp: new Date(),
      service,
      resolved: false,
      metadata
    };

    this.alertHistory.push(alert);
    this.healthMetrics.alerts.push(alert);

    // Keep only recent alerts in memory
    if (this.healthMetrics.alerts.length > 100) {
      this.healthMetrics.alerts = this.healthMetrics.alerts.slice(-50);
    }

    console.log(`[LLMHealthMonitor] ALERT [${level.toUpperCase()}] ${service}: ${message}`, metadata);
  }

  /**
   * Record metrics data with automatic cleanup
   */
  private recordMetricsData(metricType: string, data: any): void {
    if (!this.metricsHistory.has(metricType)) {
      this.metricsHistory.set(metricType, []);
    }

    const history = this.metricsHistory.get(metricType)!;
    history.push(data);

    // Limit history size for memory management
    if (history.length > 10000) {
      this.metricsHistory.set(metricType, history.slice(-5000));
    }
  }

  /**
   * Calculate trend data for dashboard
   */
  private calculateTrendData(metricType: string, hours: number): any[] {
    const history = this.getMetricsHistory('service_interaction', hours);
    const buckets: Map<number, number[]> = new Map();

    // Group by 5-minute buckets
    history.forEach(record => {
      const bucket = Math.floor(record.timestamp.getTime() / (5 * 60 * 1000));
      if (!buckets.has(bucket)) {
        buckets.set(bucket, []);
      }
      
      if (metricType === 'success_rate') {
        buckets.get(bucket)!.push(record.success ? 100 : 0);
      }
    });

    // Calculate averages for each bucket
    return Array.from(buckets.entries()).map(([bucket, values]) => ({
      timestamp: new Date(bucket * 5 * 60 * 1000),
      value: values.reduce((sum, val) => sum + val, 0) / values.length
    }));
  }

  /**
   * Clean up old metrics to prevent memory leaks
   */
  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - (this.config.metricsRetentionPeriod * 60 * 60 * 1000));

    this.metricsHistory.forEach((history, metricType) => {
      const filteredHistory = history.filter(record => record.timestamp >= cutoff);
      this.metricsHistory.set(metricType, filteredHistory);
    });

    // Clean up old alerts
    this.alertHistory = this.alertHistory.filter(alert => 
      alert.timestamp >= cutoff || alert.level === 'critical'
    );
  }
}

// Export singleton instance
export const llmHealthMonitor = new LLMHealthMonitor();
export type { LLMHealthMetrics, ServiceHealth, Alert, PerformanceMetrics };