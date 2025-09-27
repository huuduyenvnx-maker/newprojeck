/**
 * Internal Monitoring and Management Routes
 * 
 * Provides internal endpoints for rate limiting metrics, health monitoring,
 * and administrative functions for the Vietnamese Agricultural Intelligence Platform.
 */

import { Router, Request, Response } from 'express';
import { rateLimitMetrics } from '../services/rate-limit-metrics';
import { globalRateLimiter } from '../middleware/rate-limit';
import { ddosGuard } from '../middleware/ddos-guard';
import { rateLimitConfig } from '../services/rate-limit-config';
import { llmHealthMonitor } from '../services/llm-health-monitor';
import performanceRouter from './internal-performance';

const router = Router();

/**
 * Rate limiting metrics endpoint for Grafana/Prometheus monitoring
 * GET /internal/metrics
 * GET /internal/metrics?format=prometheus
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    await rateLimitMetrics.handleMetricsRequest(req, res);
  } catch (error) {
    console.error('[Internal] Metrics endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal metrics service unavailable',
      messageVietnamese: 'Dịch vụ số liệu nội bộ không khả dụng',
      error: 'METRICS_SERVICE_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Rate limiting dashboard summary
 * GET /internal/rate-limit-dashboard
 */
router.get('/rate-limit-dashboard', async (req: Request, res: Response) => {
  try {
    const dashboard = await rateLimitMetrics.getDashboardSummary();
    res.json({
      success: true,
      data: dashboard,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Internal] Dashboard endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate dashboard data',
      messageVietnamese: 'Không thể tạo dữ liệu bảng điều khiển',
      error: 'DASHBOARD_GENERATION_FAILED'
    });
  }
});

/**
 * Rate limiting statistics and health
 * GET /internal/rate-limit-status
 */
router.get('/rate-limit-status', (req: Request, res: Response) => {
  try {
    const rateLimiterStats = globalRateLimiter.getStats();
    const ddosMetrics = ddosGuard.getMetrics();
    const policies = rateLimitConfig.getAllPolicies();
    const routing = rateLimitConfig.getRouteMapping();

    res.json({
      success: true,
      data: {
        rate_limiter: rateLimiterStats,
        ddos_protection: ddosMetrics,
        policies: {
          total: policies.length,
          list: policies.map(p => ({
            id: p.id,
            description: p.description,
            capacity: p.capacity,
            refillRate: p.refillRate,
            ruralFriendly: p.ruralFriendly
          }))
        },
        routing: routing,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Internal] Rate limit status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rate limit status',
      error: 'STATUS_RETRIEVAL_FAILED'
    });
  }
});

/**
 * LLM Health Monitor integration
 * GET /internal/llm-health  
 */
router.get('/llm-health', (req: Request, res: Response) => {
  try {
    const healthMetrics = llmHealthMonitor.getHealthMetrics();
    const dashboard = llmHealthMonitor.generateDashboardData();
    
    res.json({
      success: true,
      data: {
        health: healthMetrics,
        dashboard: dashboard,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Internal] LLM health endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get LLM health data',
      error: 'LLM_HEALTH_FAILED'
    });
  }
});

/**
 * IP management endpoints for agricultural cooperatives
 * POST /internal/whitelist-ip
 */
router.post('/whitelist-ip', (req: Request, res: Response) => {
  try {
    const { ip, reason } = req.body;
    
    if (!ip || !reason) {
      return res.status(400).json({
        success: false,
        message: 'IP address and reason are required',
        messageVietnamese: 'Cần có địa chỉ IP và lý do',
        error: 'MISSING_PARAMETERS'
      });
    }
    
    ddosGuard.whitelistIP(ip, reason);
    
    res.json({
      success: true,
      message: `IP ${ip} whitelisted successfully`,
      messageVietnamese: `Đã thêm IP ${ip} vào danh sách cho phép`,
      data: { ip, reason, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[Internal] IP whitelist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to whitelist IP',
      error: 'WHITELIST_FAILED'
    });
  }
});

/**
 * POST /internal/blacklist-ip
 */
router.post('/blacklist-ip', (req: Request, res: Response) => {
  try {
    const { ip, reason } = req.body;
    
    if (!ip || !reason) {
      return res.status(400).json({
        success: false,
        message: 'IP address and reason are required',
        messageVietnamese: 'Cần có địa chỉ IP và lý do',
        error: 'MISSING_PARAMETERS'
      });
    }
    
    ddosGuard.blacklistIP(ip, reason);
    
    res.json({
      success: true,
      message: `IP ${ip} blacklisted successfully`,
      messageVietnamese: `Đã thêm IP ${ip} vào danh sách chặn`,
      data: { ip, reason, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[Internal] IP blacklist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to blacklist IP',
      error: 'BLACKLIST_FAILED'
    });
  }
});

/**
 * GET /internal/ip-status/:ip
 */
router.get('/ip-status/:ip', (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const status = ddosGuard.getIPStatus(ip);
    
    res.json({
      success: true,
      data: {
        ip,
        status: status || null,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Internal] IP status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get IP status',
      error: 'IP_STATUS_FAILED'
    });
  }
});

/**
 * Administrative controls
 * POST /internal/exit-surge-mode
 */
router.post('/exit-surge-mode', (req: Request, res: Response) => {
  try {
    ddosGuard.exitSurgeMode();
    
    res.json({
      success: true,
      message: 'Surge mode disabled',
      messageVietnamese: 'Đã tắt chế độ tăng cường bảo vệ',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Internal] Exit surge mode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to exit surge mode',
      error: 'SURGE_MODE_EXIT_FAILED'
    });
  }
});

/**
 * Agricultural season context information
 * GET /internal/agricultural-context
 */
router.get('/agricultural-context', (req: Request, res: Response) => {
  try {
    const context = rateLimitConfig.getAgriculturalContext();
    const tradingHours = rateLimitConfig.isVietnameseTradingHours();
    
    // Check peak seasons for major commodities
    const commodities = ['rice', 'coffee', 'pepper', 'rubber'];
    const seasonInfo = commodities.map(commodity => ({
      commodity,
      ...rateLimitConfig.isPeakSeason(commodity)
    }));
    
    res.json({
      success: true,
      data: {
        context,
        trading_hours_active: tradingHours,
        current_seasons: seasonInfo,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Internal] Agricultural context error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agricultural context',
      error: 'CONTEXT_RETRIEVAL_FAILED'
    });
  }
});

/**
 * System health overview combining all monitoring systems
 * GET /internal/system-health
 */
router.get('/system-health', async (req: Request, res: Response) => {
  try {
    const [rateLimitMetricsData, ddosMetricsData, llmHealth] = await Promise.all([
      rateLimitMetrics.getCurrentMetrics(),
      ddosGuard.getMetrics(),
      llmHealthMonitor.getHealthMetrics()
    ]);
    
    // Overall system health assessment
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    const issues = [];
    
    if (rateLimitMetricsData.health.overall_status === 'critical' || 
        llmHealth.overall.status === 'unhealthy') {
      overallStatus = 'critical';
    } else if (rateLimitMetricsData.health.overall_status === 'degraded' || 
               llmHealth.overall.status === 'degraded' ||
               ddosMetricsData.current_surge_mode) {
      overallStatus = 'degraded';
    }
    
    // Collect issues
    if (rateLimitMetricsData.requests.block_rate > 0.15) {
      issues.push('High rate limiting block rate');
    }
    if (ddosMetricsData.current_surge_mode) {
      issues.push('DDoS protection in surge mode');
    }
    if (llmHealth.overall.status === 'unhealthy') {
      issues.push('LLM services unhealthy');
    }
    
    res.json({
      success: true,
      data: {
        overall_status: overallStatus,
        issues,
        components: {
          rate_limiting: {
            status: rateLimitMetricsData.health.overall_status,
            block_rate: rateLimitMetricsData.requests.block_rate,
            requests_per_minute: rateLimitMetricsData.requests.total
          },
          ddos_protection: {
            status: ddosMetricsData.current_surge_mode ? 'surge' : 'normal',
            system_utilization: ddosMetricsData.system_utilization,
            active_bans: ddosMetricsData.active_bans
          },
          llm_services: {
            status: llmHealth.overall.status,
            openai: llmHealth.openai.status,
            gemini: llmHealth.gemini.status
          }
        },
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Internal] System health error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system health',
      error: 'SYSTEM_HEALTH_FAILED'
    });
  }
});

/**
 * Data ingestion trigger endpoint for scheduler integration
 * POST /internal/trigger-ingestion
 */
router.post('/trigger-ingestion', async (req: Request, res: Response) => {
  console.log('🚀 [Internal] Triggering automated data ingestion pipeline...');
  
  try {
    const { 
      commodities = ['Gạo trắng 5% tấm', 'Cà phê Robusta FAQ', 'Tiêu đen FAQ'],
      region = 'Vietnam',
      force_refresh = false,
      provider = 'gemini'
    } = req.body;
    
    console.log(`📊 Triggering ingestion for ${commodities.length} commodities in ${region} via ${provider}`);
    
    // Import internet aggregation service
    const { internetAggregationService } = await import('../services/internet-aggregation');
    const { dataIngestionPipeline } = await import('../services/data-ingestion');
    
    // Step 1: Internet aggregation with dual-LLM verification
    const startTime = Date.now();
    const aggregationResult = await internetAggregationService.aggregateCommodityPrices(
      commodities,
      region
    );
    
    if (!aggregationResult.success || aggregationResult.commodities.length === 0) {
      console.warn('⚠️ No verified commodities found from internet aggregation');
      return res.json({
        success: false,
        message: 'No verified data collected from internet sources',
        aggregation_result: aggregationResult,
        timestamp: new Date().toISOString()
      });
    }
    
    // Step 2: Persist to staging and verified tables
    console.log('💾 Persisting verified data to database...');
    
    // Create test context for automated ingestion
    const context = {
      coopId: 'dev-coop-001',
      userId: 'scheduler-automation',
      role: 'admin' as const
    };
    
    // Import storage for data persistence
    const { storage } = await import('../storage');
    
    // Create internet aggregation source if it doesn't exist
    let sourceId: string;
    try {
      const existingSources = await storage.getActiveSources(context);
      const existingSource = existingSources.find(s => s.name === 'Internet Aggregated Source');
      
      if (existingSource) {
        sourceId = existingSource.id;
        console.log(`Using existing internet source: ${sourceId}`);
      } else {
        const testSource = {
          coopId: context.coopId,
          name: 'Internet Aggregated Source',
          type: 'internet' as const,
          url: 'https://internet.aggregation',
          frequency: 'daily' as const,
          reliability: "0.9",
          isActive: true,
          metadata: {
            confidence_threshold: 0.7,
            verification_level: 'dual_llm',
            aggregation_providers: ['openai', 'gemini']
          }
        };
        const createdSource = await storage.createSource(context, testSource);
        sourceId = createdSource.id;
        console.log(`Created new internet source: ${sourceId}`);
      }
    } catch (error: any) {
      console.error('Error managing internet source:', error);
      throw new Error(`Failed to create/find internet source: ${error.message}`);
    }

    // Get commodities and regions for mapping names to IDs
    const allCommodities = await storage.getCommodities();
    const allRegions = await storage.getRegions();
    
    // Process each verified commodity and persist to database
    const persistedData = [];
    for (const commodity of aggregationResult.commodities) {
      try {
        // Map commodity name to ID
        const commodityRecord = allCommodities.find(c => 
          c.name.toLowerCase().includes(commodity.commodity.toLowerCase()) ||
          commodity.commodity.toLowerCase().includes(c.name.toLowerCase())
        );
        
        // Map region name to ID  
        const regionRecord = allRegions.find(r =>
          r.name.toLowerCase().includes(commodity.region.toLowerCase()) ||
          commodity.region.toLowerCase().includes(r.name.toLowerCase())
        );
        
        if (!commodityRecord || !regionRecord) {
          console.warn(`⚠️ Skipping ${commodity.commodity} - commodity or region not found in database`);
          continue;
        }
        
        // Create price data entry matching the expected schema
        const priceData = {
          coopId: context.coopId,
          sourceId: sourceId,
          commodityId: commodityRecord.id,
          regionId: regionRecord.id,
          date: commodity.date,
          price: commodity.price.toString(),
          currency: commodity.currency,
          volume: null,
          unit: commodity.unit,
          rawData: {
            sources: commodity.sources,
            evidence: commodity.evidence,
            confidence: commodity.confidence,
            aggregation_metadata: commodity.metadata
          },
          evidenceUrls: commodity.sources,
          sourceType: 'internet' as const,
          pageHashes: commodity.evidence.map(e => e.pageHash).filter(Boolean),
          aggregationMetadata: {
            confidence: commodity.confidence,
            verification_level: commodity.metadata?.verificationLevel || 'dual_llm',
            extracted_at: new Date().toISOString(),
            methodology: 'dual_llm_cross_verification'
          },
          isProcessed: false
        };
        
        // Save to pricesRaw table
        const saved = await storage.createPricesRaw(context, priceData);
        persistedData.push(saved);
        
        console.log(`✅ Saved verified price for ${commodity.commodity}: $${commodity.price} (confidence: ${commodity.confidence})`);
      } catch (error) {
        console.error(`❌ Failed to save commodity ${commodity.commodity}:`, error);
      }
    }
    
    // Step 3: Trigger forecast generation for affected commodities
    console.log('📈 Triggering forecast generation...');
    const { forecastService } = await import('../services/forecast');
    
    const forecastResults = [];
    for (const data of persistedData.slice(0, 3)) { // Limit to 3 to avoid timeout
      try {
        const forecast = await forecastService.generateForecast(
          context,
          data.commodityId,
          data.regionId
        );
        forecastResults.push(forecast);
        console.log(`📊 Generated forecast for ${data.commodityId}`);
      } catch (error) {
        console.error(`Failed to generate forecast for ${data.commodityId}:`, error);
      }
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`🎉 Ingestion pipeline completed in ${processingTime}ms`);
    
    // Return success response
    res.json({
      success: true,
      message: 'Data ingestion pipeline completed successfully',
      data: {
        aggregation_result: {
          success: aggregationResult.success,
          commodities_collected: aggregationResult.commodities.length,
          sources_processed: aggregationResult.metadata.totalSources,
          average_confidence: aggregationResult.metadata.averageConfidence,
          processing_time_ms: aggregationResult.metadata.processingTime
        },
        persistence_result: {
          commodities_saved: persistedData.length,
          forecasts_generated: forecastResults.length
        },
        total_processing_time_ms: processingTime,
        validation_score: aggregationResult.metadata.averageConfidence
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [Internal] Data ingestion pipeline failed:', error);
    res.status(500).json({
      success: false,
      message: 'Data ingestion pipeline failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Mount performance testing routes
router.use('/performance', performanceRouter);

export default router;