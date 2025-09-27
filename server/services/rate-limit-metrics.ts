/**
 * Rate Limiting Metrics and Monitoring Service
 * 
 * Provides comprehensive metrics collection, monitoring endpoints, and health integration
 * for the rate limiting system with Vietnamese agricultural market context.
 */

import { Request, Response } from 'express';
import { globalRateLimiter } from '../middleware/rate-limit';
import { ddosGuard } from '../middleware/ddos-guard';
import { llmHealthMonitor } from './llm-health-monitor';
import { rateLimitConfig } from './rate-limit-config';

interface RateLimitMetrics {
  timestamp: string;
  uptime: number;
  
  // Request counters
  requests: {
    total: number;
    allowed: number;
    blocked: number;
    block_rate: number;
  };
  
  // By endpoint breakdown
  by_endpoint: {
    [endpoint: string]: {
      total: number;
      allowed: number;
      blocked: number;
      policy_id: string;
      block_rate: number;
    };
  };
  
  // By role breakdown
  by_role: {
    [role: string]: {
      total: number;
      allowed: number;
      blocked: number;
      block_rate: number;
    };
  };
  
  // By key type (user vs IP)
  by_key_type: {
    user: { total: number; allowed: number; blocked: number };
    ip: { total: number; allowed: number; blocked: number };
    internal: { total: number; allowed: number; blocked: number };
  };
  
  // Performance metrics
  performance: {
    avg_response_time: number;
    cache_hit_rate: number;
    burst_usage_rate: number;
    soft_start_usage_rate: number;
  };
  
  // DDoS protection metrics
  ddos_protection: {
    global_capacity_remaining: number;
    surge_mode_active: boolean;
    active_ip_bans: number;
    temporary_bans_total: number;
    anomaly_detections: number;
    system_utilization: number;
  };
  
  // Health indicators
  health: {
    overall_status: 'healthy' | 'degraded' | 'critical';
    block_rate_status: 'normal' | 'warning' | 'critical';
    ddos_status: 'normal' | 'surge' | 'under_attack';
    alerts: Array<{
      level: 'warning' | 'critical';
      message: string;
      message_vietnamese: string;
      timestamp: string;
    }>;
  };
  
  // Vietnamese agricultural context
  agricultural_context: {
    peak_season_adjustments_active: number;
    trading_hours_active: boolean;
    rural_friendly_features: {
      soft_start_requests: number;
      burst_allowance_used: number;
      cooperative_mode_active: boolean;
    };
    commodity_breakdown: {
      [commodity: string]: {
        requests: number;
        peak_season_multiplier: number;
      };
    };
  };
}

interface AlertThresholds {
  block_rate_warning: number; // 5%
  block_rate_critical: number; // 15%
  ddos_utilization_warning: number; // 80%
  ddos_utilization_critical: number; // 95%
  response_time_warning: number; // 5000ms
  response_time_critical: number; // 10000ms
}

/**
 * Rate Limit Metrics Collection Service
 */
export class RateLimitMetricsService {
  private startTime = Date.now();
  private alertThresholds: AlertThresholds = {
    block_rate_warning: 0.05,
    block_rate_critical: 0.15,
    ddos_utilization_warning: 0.80,
    ddos_utilization_critical: 0.95,
    response_time_warning: 5000,
    response_time_critical: 10000
  };
  
  private metricsHistory: RateLimitMetrics[] = [];
  private readonly MAX_HISTORY_LENGTH = 144; // 12 hours at 5-minute intervals
  
  constructor() {
    this.startPeriodicCollection();
  }

  /**
   * Get current comprehensive metrics
   */
  async getCurrentMetrics(): Promise<RateLimitMetrics> {
    const now = new Date();
    
    // Get metrics from components
    const rateLimiterStats = globalRateLimiter.getStats();
    const ddosMetrics = ddosGuard.getMetrics();
    const healthMetrics = llmHealthMonitor.getHealthMetrics();
    
    // Calculate derived metrics
    const totalRequests = rateLimiterStats.metrics.counters.requests_total;
    const blockedRequests = rateLimiterStats.metrics.counters.requests_blocked;
    const blockRate = totalRequests > 0 ? blockedRequests / totalRequests : 0;
    
    // Build comprehensive metrics
    const metrics: RateLimitMetrics = {
      timestamp: now.toISOString(),
      uptime: Date.now() - this.startTime,
      
      requests: {
        total: totalRequests,
        allowed: rateLimiterStats.metrics.counters.requests_allowed,
        blocked: blockedRequests,
        block_rate: blockRate
      },
      
      by_endpoint: this.buildEndpointMetrics(rateLimiterStats.metrics.by_endpoint),
      by_role: this.buildRoleMetrics(rateLimiterStats.metrics.by_role),
      by_key_type: this.buildKeyTypeMetrics(rateLimiterStats.metrics),
      
      performance: {
        avg_response_time: rateLimiterStats.metrics.performance.avg_response_time,
        cache_hit_rate: rateLimiterStats.cache.hitRate || 0,
        burst_usage_rate: rateLimiterStats.metrics.rates.burst_usage_rate,
        soft_start_usage_rate: totalRequests > 0 
          ? rateLimiterStats.metrics.counters.soft_start_used / totalRequests 
          : 0
      },
      
      ddos_protection: {
        global_capacity_remaining: ddosMetrics.globalState.requestCount,
        surge_mode_active: ddosMetrics.globalState.surgeMode,
        active_ip_bans: ddosMetrics.active_bans,
        temporary_bans_total: ddosMetrics.ips_banned_temporary,
        anomaly_detections: ddosMetrics.anomaly_detections,
        system_utilization: ddosMetrics.system_utilization
      },
      
      health: this.buildHealthIndicators(blockRate, ddosMetrics, rateLimiterStats),
      agricultural_context: this.buildAgriculturalContextMetrics()
    };
    
    return metrics;
  }

  /**
   * Express handler for /internal/metrics endpoint
   */
  async handleMetricsRequest(req: Request, res: Response): Promise<void> {
    try {
      const format = req.query.format as string || 'json';
      const metrics = await this.getCurrentMetrics();
      
      if (format === 'prometheus') {
        const prometheusMetrics = this.formatForPrometheus(metrics);
        res.set('Content-Type', 'text/plain');
        res.send(prometheusMetrics);
      } else {
        res.json(metrics);
      }
      
    } catch (error) {
      console.error('[RateLimitMetrics] Failed to generate metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate rate limiting metrics',
        messageVietnamese: 'Không thể tạo số liệu giới hạn tần suất',
        error: 'METRICS_GENERATION_FAILED',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get metrics history for trend analysis
   */
  getMetricsHistory(hours: number = 1): RateLimitMetrics[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.metricsHistory.filter(
      metric => new Date(metric.timestamp).getTime() > cutoff
    );
  }

  /**
   * Check for alert conditions and report to health monitor
   */
  async checkAlertConditions(): Promise<void> {
    const metrics = await this.getCurrentMetrics();
    
    // Block rate alerts
    if (metrics.requests.block_rate > this.alertThresholds.block_rate_critical) {
      llmHealthMonitor.recordServiceInteraction(
        'openai',
        false,
        0,
        'CRITICAL_BLOCK_RATE',
        {
          block_rate: metrics.requests.block_rate,
          threshold: this.alertThresholds.block_rate_critical,
          total_requests: metrics.requests.total,
          blocked_requests: metrics.requests.blocked
        }
      );
    } else if (metrics.requests.block_rate > this.alertThresholds.block_rate_warning) {
      llmHealthMonitor.recordServiceInteraction(
        'openai',
        true,
        metrics.performance.avg_response_time,
        'WARNING_BLOCK_RATE',
        {
          block_rate: metrics.requests.block_rate,
          threshold: this.alertThresholds.block_rate_warning
        }
      );
    }
    
    // DDoS utilization alerts
    if (metrics.ddos_protection.system_utilization > this.alertThresholds.ddos_utilization_critical) {
      llmHealthMonitor.recordServiceInteraction(
        'gemini',
        false,
        0,
        'CRITICAL_SYSTEM_UTILIZATION',
        {
          utilization: metrics.ddos_protection.system_utilization,
          surge_mode: metrics.ddos_protection.surge_mode_active,
          active_bans: metrics.ddos_protection.active_ip_bans
        }
      );
    }
    
    // Response time alerts
    if (metrics.performance.avg_response_time > this.alertThresholds.response_time_critical) {
      llmHealthMonitor.recordServiceInteraction(
        'openai',
        false,
        metrics.performance.avg_response_time,
        'CRITICAL_RESPONSE_TIME',
        {
          avg_response_time: metrics.performance.avg_response_time,
          threshold: this.alertThresholds.response_time_critical
        }
      );
    }
  }

  /**
   * Get dashboard summary for admin UI
   */
  async getDashboardSummary(): Promise<any> {
    const metrics = await this.getCurrentMetrics();
    const history = this.getMetricsHistory(1);
    
    // Calculate trends
    const trends = this.calculateTrends(history);
    
    return {
      status: metrics.health.overall_status,
      last_updated: metrics.timestamp,
      
      summary: {
        requests_per_minute: this.calculateRequestsPerMinute(history),
        block_rate_percentage: (metrics.requests.block_rate * 100).toFixed(2),
        active_policies: rateLimitConfig.getAllPolicies().length,
        ddos_protection_active: metrics.ddos_protection.surge_mode_active,
        rural_features_usage: metrics.agricultural_context.rural_friendly_features
      },
      
      alerts: metrics.health.alerts,
      
      endpoints: {
        most_blocked: this.getMostBlockedEndpoint(metrics.by_endpoint),
        highest_traffic: this.getHighestTrafficEndpoint(metrics.by_endpoint)
      },
      
      trends: {
        block_rate_trend: trends.block_rate,
        traffic_trend: trends.requests,
        response_time_trend: trends.response_time
      },
      
      vietnamese_context: {
        trading_hours_active: metrics.agricultural_context.trading_hours_active,
        peak_seasons_active: Object.keys(metrics.agricultural_context.commodity_breakdown)
          .filter(commodity => metrics.agricultural_context.commodity_breakdown[commodity].peak_season_multiplier > 1),
        cooperative_friendly_requests: metrics.agricultural_context.rural_friendly_features.soft_start_requests
      }
    };
  }

  private buildEndpointMetrics(endpointStats: any): any {
    const result: any = {};
    
    Object.entries(endpointStats).forEach(([endpoint, stats]: [string, any]) => {
      result[endpoint] = {
        total: stats.total,
        allowed: stats.allowed,
        blocked: stats.blocked,
        policy_id: this.getPolicyIdForEndpoint(endpoint),
        block_rate: stats.total > 0 ? stats.blocked / stats.total : 0
      };
    });
    
    return result;
  }

  private buildRoleMetrics(roleStats: any): any {
    const result: any = {};
    
    Object.entries(roleStats).forEach(([role, stats]: [string, any]) => {
      result[role] = {
        total: stats.total,
        allowed: stats.allowed,
        blocked: stats.blocked,
        block_rate: stats.total > 0 ? stats.blocked / stats.total : 0
      };
    });
    
    return result;
  }

  private buildKeyTypeMetrics(metricsStats: any): any {
    // This would need to be enhanced to track by key type
    // For now, return placeholder structure
    return {
      user: { total: 0, allowed: 0, blocked: 0 },
      ip: { total: 0, allowed: 0, blocked: 0 },
      internal: { total: 0, allowed: 0, blocked: 0 }
    };
  }

  private buildHealthIndicators(blockRate: number, ddosMetrics: any, rateLimiterStats: any): any {
    const alerts = [];
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let blockRateStatus: 'normal' | 'warning' | 'critical' = 'normal';
    let ddosStatus: 'normal' | 'surge' | 'under_attack' = 'normal';
    
    // Block rate assessment
    if (blockRate > this.alertThresholds.block_rate_critical) {
      blockRateStatus = 'critical';
      overallStatus = 'critical';
      alerts.push({
        level: 'critical' as const,
        message: `Critical block rate: ${(blockRate * 100).toFixed(1)}%`,
        message_vietnamese: `Tỷ lệ chặn nghiêm trọng: ${(blockRate * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString()
      });
    } else if (blockRate > this.alertThresholds.block_rate_warning) {
      blockRateStatus = 'warning';
      if (overallStatus === 'healthy') overallStatus = 'degraded';
      alerts.push({
        level: 'warning' as const,
        message: `High block rate: ${(blockRate * 100).toFixed(1)}%`,
        message_vietnamese: `Tỷ lệ chặn cao: ${(blockRate * 100).toFixed(1)}%`,
        timestamp: new Date().toISOString()
      });
    }
    
    // DDoS assessment
    if (ddosMetrics.system_utilization > 0.95) {
      ddosStatus = 'under_attack';
      overallStatus = 'critical';
    } else if (ddosMetrics.globalState.surgeMode) {
      ddosStatus = 'surge';
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }
    
    return {
      overall_status: overallStatus,
      block_rate_status: blockRateStatus,
      ddos_status: ddosStatus,
      alerts
    };
  }

  private buildAgriculturalContextMetrics(): any {
    const config = rateLimitConfig.getAgriculturalContext();
    
    // Get current commodity seasons
    const commodityBreakdown: any = {};
    const commonCommodities = ['rice', 'coffee', 'pepper', 'rubber'];
    
    let peakSeasonAdjustments = 0;
    commonCommodities.forEach(commodity => {
      const { isPeak, multiplier } = rateLimitConfig.isPeakSeason(commodity);
      commodityBreakdown[commodity] = {
        requests: 0, // Would need tracking in actual implementation
        peak_season_multiplier: multiplier
      };
      if (isPeak) peakSeasonAdjustments++;
    });
    
    return {
      peak_season_adjustments_active: peakSeasonAdjustments,
      trading_hours_active: rateLimitConfig.isVietnameseTradingHours(),
      rural_friendly_features: {
        soft_start_requests: 0, // Would need tracking
        burst_allowance_used: 0, // Would need tracking
        cooperative_mode_active: config.COOPERATIVE_USAGE.cooperativeModeEnabled
      },
      commodity_breakdown: commodityBreakdown
    };
  }

  private formatForPrometheus(metrics: RateLimitMetrics): string {
    const lines = [
      '# HELP agriintel_rate_limit_requests_total Total number of rate limited requests',
      '# TYPE agriintel_rate_limit_requests_total counter',
      `agriintel_rate_limit_requests_total ${metrics.requests.total}`,
      '',
      '# HELP agriintel_rate_limit_blocked_total Total number of blocked requests',
      '# TYPE agriintel_rate_limit_blocked_total counter', 
      `agriintel_rate_limit_blocked_total ${metrics.requests.blocked}`,
      '',
      '# HELP agriintel_rate_limit_block_rate Current block rate (0-1)',
      '# TYPE agriintel_rate_limit_block_rate gauge',
      `agriintel_rate_limit_block_rate ${metrics.requests.block_rate}`,
      '',
      '# HELP agriintel_ddos_system_utilization Current DDoS protection system utilization',
      '# TYPE agriintel_ddos_system_utilization gauge',
      `agriintel_ddos_system_utilization ${metrics.ddos_protection.system_utilization}`,
      '',
      '# HELP agriintel_ddos_active_bans Number of currently active IP bans',
      '# TYPE agriintel_ddos_active_bans gauge',
      `agriintel_ddos_active_bans ${metrics.ddos_protection.active_ip_bans}`,
      ''
    ];
    
    // Add endpoint-specific metrics
    Object.entries(metrics.by_endpoint).forEach(([endpoint, stats]) => {
      const sanitized = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`agriintel_endpoint_requests_total{endpoint="${endpoint}"} ${stats.total}`);
      lines.push(`agriintel_endpoint_blocked_total{endpoint="${endpoint}"} ${stats.blocked}`);
    });
    
    return lines.join('\n');
  }

  private getPolicyIdForEndpoint(endpoint: string): string {
    // Extract method and path from endpoint string
    const [method, path] = endpoint.split(':');
    if (method && path) {
      const policy = rateLimitConfig.getPolicyForRoute(method, path);
      return policy.id;
    }
    return 'unknown';
  }

  private calculateTrends(history: RateLimitMetrics[]): any {
    if (history.length < 2) {
      return { block_rate: 'stable', requests: 'stable', response_time: 'stable' };
    }
    
    const recent = history[history.length - 1];
    const previous = history[0];
    
    return {
      block_rate: this.calculateTrend(previous.requests.block_rate, recent.requests.block_rate),
      requests: this.calculateTrend(previous.requests.total, recent.requests.total),
      response_time: this.calculateTrend(previous.performance.avg_response_time, recent.performance.avg_response_time)
    };
  }

  private calculateTrend(oldValue: number, newValue: number): 'increasing' | 'decreasing' | 'stable' {
    const change = (newValue - oldValue) / (oldValue || 1);
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private calculateRequestsPerMinute(history: RateLimitMetrics[]): number {
    if (history.length < 2) return 0;
    
    const recent = history[history.length - 1];
    const previous = history[history.length - 2];
    const timeDiff = (new Date(recent.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 60000; // minutes
    const requestDiff = recent.requests.total - previous.requests.total;
    
    return timeDiff > 0 ? requestDiff / timeDiff : 0;
  }

  private getMostBlockedEndpoint(endpoints: any): { endpoint: string; block_rate: number } {
    let maxBlockRate = 0;
    let maxEndpoint = 'none';
    
    Object.entries(endpoints).forEach(([endpoint, stats]: [string, any]) => {
      if (stats.block_rate > maxBlockRate) {
        maxBlockRate = stats.block_rate;
        maxEndpoint = endpoint;
      }
    });
    
    return { endpoint: maxEndpoint, block_rate: maxBlockRate };
  }

  private getHighestTrafficEndpoint(endpoints: any): { endpoint: string; requests: number } {
    let maxRequests = 0;
    let maxEndpoint = 'none';
    
    Object.entries(endpoints).forEach(([endpoint, stats]: [string, any]) => {
      if (stats.total > maxRequests) {
        maxRequests = stats.total;
        maxEndpoint = endpoint;
      }
    });
    
    return { endpoint: maxEndpoint, requests: maxRequests };
  }

  private startPeriodicCollection(): void {
    // Collect metrics every 5 minutes
    setInterval(async () => {
      try {
        const metrics = await this.getCurrentMetrics();
        this.metricsHistory.push(metrics);
        
        // Keep history bounded
        if (this.metricsHistory.length > this.MAX_HISTORY_LENGTH) {
          this.metricsHistory = this.metricsHistory.slice(-this.MAX_HISTORY_LENGTH);
        }
        
        // Check for alert conditions
        await this.checkAlertConditions();
        
      } catch (error) {
        console.error('[RateLimitMetrics] Failed to collect periodic metrics:', error);
      }
    }, 300000); // 5 minutes
  }
}

// Export singleton instance
export const rateLimitMetrics = new RateLimitMetricsService();
export type { RateLimitMetrics, AlertThresholds };