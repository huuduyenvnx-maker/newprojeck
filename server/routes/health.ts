/**
 * Health Check API Routes
 * 
 * Provides comprehensive health monitoring endpoints for LLM verification system.
 * Supports Vietnamese agricultural forecasting platform monitoring requirements.
 */

import express from 'express';
import { llmHealthMonitor, type LLMHealthMetrics } from '../services/llm-health-monitor';
import { circuitBreakerManager } from '../services/circuit-breaker';
import { verificationCache } from '../services/verification-cache';

const router = express.Router();

/**
 * GET /health - Basic health check
 */
router.get('/', async (req, res) => {
  try {
    const healthMetrics = llmHealthMonitor.getHealthMetrics();
    const overallStatus = healthMetrics.overall.status;
    
    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        openai: healthMetrics.openai.status,
        gemini: healthMetrics.gemini.status,
        overall: overallStatus
      },
      uptime: Math.min(healthMetrics.openai.uptime, healthMetrics.gemini.uptime),
      healthy: overallStatus === 'healthy'
    };

    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 206 : 503;

    res.status(statusCode).json(response);
  } catch (error) {
    console.error('[HealthAPI] Health check failed:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      healthy: false
    });
  }
});

/**
 * GET /health/detailed - Comprehensive health status
 */
router.get('/detailed', async (req, res) => {
  try {
    const healthMetrics = llmHealthMonitor.getHealthMetrics();
    const systemHealth = await circuitBreakerManager.getSystemHealth();
    const cacheStats = verificationCache.getStats();

    const response = {
      timestamp: new Date().toISOString(),
      overall: {
        status: healthMetrics.overall.status,
        healthy: healthMetrics.overall.status === 'healthy',
        uptime: healthMetrics.overall.uptime,
        responseTime: healthMetrics.overall.responseTime
      },
      services: {
        openai: {
          status: healthMetrics.openai.status,
          responseTime: healthMetrics.openai.responseTime,
          errorRate: healthMetrics.openai.errorRate,
          consecutiveFailures: healthMetrics.openai.consecutiveFailures,
          uptime: healthMetrics.openai.uptime,
          circuitBreaker: {
            state: healthMetrics.circuitBreakers.openai.state,
            failureCount: healthMetrics.circuitBreakers.openai.failureCount,
            isHealthy: healthMetrics.circuitBreakers.openai.isHealthy,
            lastFailure: healthMetrics.circuitBreakers.openai.lastFailure,
            nextRetry: healthMetrics.circuitBreakers.openai.nextRetry
          }
        },
        gemini: {
          status: healthMetrics.gemini.status,
          responseTime: healthMetrics.gemini.responseTime,
          errorRate: healthMetrics.gemini.errorRate,
          consecutiveFailures: healthMetrics.gemini.consecutiveFailures,
          uptime: healthMetrics.gemini.uptime,
          circuitBreaker: {
            state: healthMetrics.circuitBreakers.gemini.state,
            failureCount: healthMetrics.circuitBreakers.gemini.failureCount,
            isHealthy: healthMetrics.circuitBreakers.gemini.isHealthy,
            lastFailure: healthMetrics.circuitBreakers.gemini.lastFailure,
            nextRetry: healthMetrics.circuitBreakers.gemini.nextRetry
          }
        }
      },
      cache: {
        hitRate: healthMetrics.cache.hitRate,
        missRate: healthMetrics.cache.missRate,
        totalEntries: healthMetrics.cache.totalEntries,
        memoryUsage: healthMetrics.cache.memoryUsage,
        averageAge: healthMetrics.cache.averageAge,
        evictionRate: healthMetrics.cache.evictionRate,
        detailed: cacheStats
      },
      performance: {
        averageResponseTime: healthMetrics.performance.averageResponseTime,
        p95ResponseTime: healthMetrics.performance.p95ResponseTime,
        p99ResponseTime: healthMetrics.performance.p99ResponseTime,
        requestsPerMinute: healthMetrics.performance.requestsPerMinute,
        successRate: healthMetrics.performance.successRate,
        verificationThroughput: healthMetrics.performance.verificationThroughput,
        fallbackUsageRate: healthMetrics.performance.fallbackUsageRate
      },
      alerts: {
        active: llmHealthMonitor.getActiveAlerts(),
        critical: llmHealthMonitor.getActiveAlerts().filter(a => a.level === 'critical'),
        warnings: llmHealthMonitor.getActiveAlerts().filter(a => a.level === 'warning')
      }
    };

    res.json(response);
  } catch (error) {
    console.error('[HealthAPI] Detailed health check failed:', error);
    res.status(500).json({
      error: 'Detailed health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/metrics - Performance metrics and trends
 */
router.get('/metrics', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours as string) || 1, 24); // Max 24 hours
    const dashboardData = llmHealthMonitor.generateDashboardData();

    const response = {
      timestamp: new Date().toISOString(),
      timeframe: `${hours} hour(s)`,
      summary: dashboardData.summary,
      trends: {
        responseTime: llmHealthMonitor.getMetricsHistory('service_interaction', hours)
          .map(r => ({ timestamp: r.timestamp, value: r.responseTime })),
        successRate: llmHealthMonitor.getMetricsHistory('service_interaction', hours)
          .reduce((acc, r, i, arr) => {
            const bucketSize = Math.max(1, Math.floor(arr.length / 20)); // 20 data points max
            if (i % bucketSize === 0) {
              const bucket = arr.slice(i, i + bucketSize);
              const successCount = bucket.filter(b => b.success).length;
              acc.push({
                timestamp: r.timestamp,
                value: (successCount / bucket.length) * 100
              });
            }
            return acc;
          }, [] as any[]),
        verificationVolume: llmHealthMonitor.getMetricsHistory('verification_performance', hours)
          .map(r => ({ timestamp: r.timestamp, value: 1 })) // Count of verifications
      },
      services: dashboardData.services,
      performance: dashboardData.healthStatus.performance
    };

    res.json(response);
  } catch (error) {
    console.error('[HealthAPI] Metrics retrieval failed:', error);
    res.status(500).json({
      error: 'Metrics retrieval failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/alerts - Active alerts and incidents
 */
router.get('/alerts', async (req, res) => {
  try {
    const activeAlerts = llmHealthMonitor.getActiveAlerts();
    const level = req.query.level as string;

    let filteredAlerts = activeAlerts;
    if (level && ['info', 'warning', 'error', 'critical'].includes(level)) {
      filteredAlerts = activeAlerts.filter(alert => alert.level === level);
    }

    const response = {
      timestamp: new Date().toISOString(),
      total: filteredAlerts.length,
      level: level || 'all',
      alerts: filteredAlerts.map(alert => ({
        id: alert.id,
        level: alert.level,
        message: alert.message,
        service: alert.service,
        timestamp: alert.timestamp,
        resolved: alert.resolved,
        metadata: alert.metadata
      })),
      summary: {
        critical: activeAlerts.filter(a => a.level === 'critical').length,
        error: activeAlerts.filter(a => a.level === 'error').length,
        warning: activeAlerts.filter(a => a.level === 'warning').length,
        info: activeAlerts.filter(a => a.level === 'info').length
      }
    };

    res.json(response);
  } catch (error) {
    console.error('[HealthAPI] Alerts retrieval failed:', error);
    res.status(500).json({
      error: 'Alerts retrieval failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/dashboard - Complete dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const dashboardData = llmHealthMonitor.generateDashboardData();
    res.json(dashboardData);
  } catch (error) {
    console.error('[HealthAPI] Dashboard data retrieval failed:', error);
    res.status(500).json({
      error: 'Dashboard data retrieval failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/system - System-wide health status
 */
router.get('/system', async (req, res) => {
  try {
    const healthMetrics = llmHealthMonitor.getHealthMetrics();
    const systemHealth = await circuitBreakerManager.getSystemHealth();

    const response = {
      timestamp: new Date().toISOString(),
      system: {
        status: healthMetrics.overall.status,
        healthy: healthMetrics.overall.status === 'healthy',
        degraded: healthMetrics.overall.status === 'degraded',
        unhealthy: healthMetrics.overall.status === 'unhealthy'
      },
      providers: {
        total: systemHealth.providers.length,
        available: systemHealth.availableProviders.length,
        healthy: systemHealth.providers.filter(p => p.circuitState === 'CLOSED').length,
        details: systemHealth.providers.map(p => ({
          provider: p.provider,
          circuitState: p.circuitState,
          healthy: p.healthy,
          responseTime: p.responseTimeMs,
          lastCheck: p.lastCheck
        }))
      },
      resilience: {
        circuitBreakersActive: systemHealth.providers.filter(p => p.circuitState === 'OPEN').length,
        fallbacksAvailable: true, // Always available through statistical fallback
        cacheActive: healthMetrics.cache.totalEntries > 0,
        retryMechanismActive: true
      },
      recommendations: generateSystemRecommendations(healthMetrics, systemHealth)
    };

    res.json(response);
  } catch (error) {
    console.error('[HealthAPI] System health check failed:', error);
    res.status(500).json({
      error: 'System health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /health/test - Manual health test endpoint
 */
router.post('/test', async (req, res) => {
  try {
    const { provider, timeout = 10000 } = req.body;

    console.log(`[HealthAPI] Manual health test initiated for ${provider || 'all providers'}`);

    if (provider && !['openai', 'gemini'].includes(provider)) {
      return res.status(400).json({
        error: 'Invalid provider. Must be "openai" or "gemini"',
        timestamp: new Date().toISOString()
      });
    }

    // Perform health test
    const startTime = Date.now();
    const systemHealth = await circuitBreakerManager.getSystemHealth();
    const testDuration = Date.now() - startTime;

    const response = {
      timestamp: new Date().toISOString(),
      testDuration,
      provider: provider || 'all',
      results: {
        system: systemHealth.overall,
        providers: provider ? 
          systemHealth.providers.filter(p => p.provider === provider) :
          systemHealth.providers
      },
      recommendations: [] as string[]
    };

    // Add recommendations based on test results
    if (systemHealth.overall === 'unhealthy') {
      response.recommendations.push('System is unhealthy - investigate provider failures');
    }
    if (systemHealth.availableProviders.length < systemHealth.providers.length) {
      response.recommendations.push('Some providers are unavailable - check circuit breaker status');
    }
    if (testDuration > 5000) {
      response.recommendations.push('Health check took longer than expected - potential performance issues');
    }

    res.json(response);
  } catch (error) {
    console.error('[HealthAPI] Manual health test failed:', error);
    res.status(500).json({
      error: 'Manual health test failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Generate system recommendations based on health status
 */
function generateSystemRecommendations(healthMetrics: LLMHealthMetrics, systemHealth: any): string[] {
  const recommendations: string[] = [];

  // Performance recommendations
  if (healthMetrics.performance.averageResponseTime > 5000) {
    recommendations.push('High average response time detected - consider optimization');
  }

  // Cache recommendations
  if (healthMetrics.cache.hitRate < 0.5) {
    recommendations.push('Low cache hit rate - review caching strategy');
  }

  // Circuit breaker recommendations
  const openCircuits = systemHealth.providers.filter((p: any) => p.circuitState === 'OPEN');
  if (openCircuits.length > 0) {
    recommendations.push(`${openCircuits.length} circuit breaker(s) open - service recovery needed`);
  }

  // Alert recommendations
  const criticalAlerts = healthMetrics.alerts.filter(a => a.level === 'critical');
  if (criticalAlerts.length > 0) {
    recommendations.push(`${criticalAlerts.length} critical alert(s) require immediate attention`);
  }

  // Fallback usage recommendations
  if (healthMetrics.performance.fallbackUsageRate > 0.2) {
    recommendations.push('High fallback usage rate - investigate primary service reliability');
  }

  return recommendations;
}

export default router;