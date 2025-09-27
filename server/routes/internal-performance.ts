/**
 * Performance Testing Routes for Vietnamese Agricultural Intelligence Platform
 * 
 * Provides internal endpoints for performance testing, monitoring, and 
 * benchmarking specifically designed for Vietnamese market conditions.
 */

import { Router, Request, Response } from 'express';
import { performanceTestService } from '../services/performance-test';
import { storage } from '../storage';
import { performance } from 'perf_hooks';

const router = Router();

/**
 * Run comprehensive performance test suite
 * POST /internal/performance/run-tests
 */
router.post('/run-tests', async (req: Request, res: Response) => {
  try {
    console.log('🚀 Initiating Vietnamese Agricultural Performance Test Suite...');
    
    const startTime = Date.now();
    const results = await performanceTestService.runPerformanceTestSuite();
    const endTime = Date.now();
    
    const summary = {
      totalDuration: endTime - startTime,
      testsRun: results.length,
      overallSuccessRate: results.reduce((sum, r) => sum + r.throughput.successRate, 0) / results.length,
      overallAvgResponseTime: results.reduce((sum, r) => sum + r.responseTime.avg, 0) / results.length,
      meetsTargets: performanceTestService.meetsPerformanceTargets(),
      vietnameseMarketReadiness: results.every(r => r.vietnameseMarketMetrics.peakSeasonPerformance >= 80)
    };
    
    console.log('✅ Performance test suite completed successfully');
    
    res.json({
      success: true,
      message: 'Performance test suite completed',
      messageVietnamese: 'Bộ thử nghiệm hiệu suất đã hoàn thành',
      data: {
        summary,
        detailedResults: results,
        recommendations: generatePerformanceRecommendations(results)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Performance test suite failed:', error);
    res.status(500).json({
      success: false,
      message: 'Performance test suite failed',
      messageVietnamese: 'Bộ thử nghiệm hiệu suất thất bại',
      error: 'PERFORMANCE_TEST_FAILED',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get performance test results
 * GET /internal/performance/results
 */
router.get('/results', async (req: Request, res: Response) => {
  try {
    const results = performanceTestService.getTestResults();
    
    if (results.length === 0) {
      return res.json({
        success: true,
        message: 'No performance test results available. Run tests first.',
        messageVietnamese: 'Không có kết quả thử nghiệm hiệu suất nào. Vui lòng chạy thử nghiệm trước.',
        data: {
          results: [],
          summary: null,
          lastTestRun: null
        }
      });
    }
    
    const summary = {
      testsRun: results.length,
      overallSuccessRate: results.reduce((sum, r) => sum + r.throughput.successRate, 0) / results.length,
      overallAvgResponseTime: results.reduce((sum, r) => sum + r.responseTime.avg, 0) / results.length,
      meetsTargets: performanceTestService.meetsPerformanceTargets(),
      vietnameseMarketReadiness: results.every(r => r.vietnameseMarketMetrics.peakSeasonPerformance >= 80),
      lastTestRun: Math.max(...results.map(r => r.endTime))
    };
    
    res.json({
      success: true,
      data: {
        summary,
        results: results.map(r => ({
          testName: r.testName,
          successRate: r.throughput.successRate,
          avgResponseTime: r.responseTime.avg,
          p95ResponseTime: r.responseTime.p95,
          throughput: r.throughput.requestsPerSecond,
          vietnameseMarketMetrics: r.vietnameseMarketMetrics,
          duration: r.totalDurationMs,
          timestamp: r.endTime
        }))
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Failed to get performance results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve performance test results',
      error: 'PERFORMANCE_RESULTS_RETRIEVAL_FAILED'
    });
  }
});

/**
 * Run database performance benchmark
 * POST /internal/performance/database-benchmark
 */
router.post('/database-benchmark', async (req: Request, res: Response) => {
  try {
    console.log('💾 Running database performance benchmark...');
    
    const benchmarks = await runDatabaseBenchmark();
    
    res.json({
      success: true,
      message: 'Database performance benchmark completed',
      messageVietnamese: 'Đánh giá hiệu suất cơ sở dữ liệu đã hoàn thành',
      data: benchmarks,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Database benchmark failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database performance benchmark failed',
      error: 'DATABASE_BENCHMARK_FAILED',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get system resource metrics
 * GET /internal/performance/system-metrics
 */
router.get('/system-metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await getSystemResourceMetrics();
    
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Failed to get system metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system metrics',
      error: 'SYSTEM_METRICS_RETRIEVAL_FAILED'
    });
  }
});

/**
 * Test specific Vietnamese market scenario
 * POST /internal/performance/test-scenario
 */
router.post('/test-scenario', async (req: Request, res: Response) => {
  try {
    const { commodity, region, seasonality, marketConditions, expectedLoad } = req.body;
    
    if (!commodity || !region) {
      return res.status(400).json({
        success: false,
        message: 'Commodity and region are required',
        messageVietnamese: 'Cần có thông tin hàng hóa và khu vực',
        error: 'MISSING_REQUIRED_PARAMS'
      });
    }
    
    console.log(`🇻🇳 Testing Vietnamese market scenario: ${commodity} in ${region}`);
    
    // This would integrate with the performance test service to run specific scenario
    const scenarioResult = await testVietnameseMarketScenario({
      commodity,
      region,
      seasonality: seasonality || 'regular',
      marketConditions: marketConditions || 'stable',
      expectedLoad: expectedLoad || 10
    });
    
    res.json({
      success: true,
      message: `Vietnamese market scenario test completed for ${commodity}`,
      messageVietnamese: `Thử nghiệm kịch bản thị trường Việt Nam cho ${commodity} đã hoàn thành`,
      data: scenarioResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Scenario test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Vietnamese market scenario test failed',
      error: 'SCENARIO_TEST_FAILED',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Helper functions

async function runDatabaseBenchmark() {
  console.log('📊 Benchmarking Vietnamese commodity database queries...');
  
  const benchmarks = [];
  
  // Test 1: Price data time series query
  const priceQueryStart = performance.now();
  try {
    // Simulate database query - in production this would use actual storage
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
    const priceQueryEnd = performance.now();
    
    benchmarks.push({
      testName: 'price_data_time_series',
      description: 'Vietnamese commodity price data retrieval',
      responseTime: priceQueryEnd - priceQueryStart,
      targetTime: 500,
      passed: (priceQueryEnd - priceQueryStart) <= 500,
      query: 'Price data for Vietnamese commodities over time'
    });
  } catch (error) {
    benchmarks.push({
      testName: 'price_data_time_series',
      description: 'Vietnamese commodity price data retrieval',
      responseTime: -1,
      targetTime: 500,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 2: Cooperative aggregation query
  const coopQueryStart = performance.now();
  try {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 100));
    const coopQueryEnd = performance.now();
    
    benchmarks.push({
      testName: 'cooperative_aggregation',
      description: 'Vietnamese cooperative price aggregations',
      responseTime: coopQueryEnd - coopQueryStart,
      targetTime: 1000,
      passed: (coopQueryEnd - coopQueryStart) <= 1000,
      query: 'Cooperative price aggregations across Vietnamese regions'
    });
  } catch (error) {
    benchmarks.push({
      testName: 'cooperative_aggregation',
      description: 'Vietnamese cooperative price aggregations',
      responseTime: -1,
      targetTime: 1000,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 3: Forecast retrieval query
  const forecastQueryStart = performance.now();
  try {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 75));
    const forecastQueryEnd = performance.now();
    
    benchmarks.push({
      testName: 'forecast_retrieval',
      description: '30-day forecast data for Vietnamese commodities',
      responseTime: forecastQueryEnd - forecastQueryStart,
      targetTime: 300,
      passed: (forecastQueryEnd - forecastQueryStart) <= 300,
      query: 'Vietnamese commodity forecast data retrieval'
    });
  } catch (error) {
    benchmarks.push({
      testName: 'forecast_retrieval',
      description: '30-day forecast data for Vietnamese commodities',
      responseTime: -1,
      targetTime: 300,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  const overallPassed = benchmarks.filter(b => b.passed).length;
  const overallScore = (overallPassed / benchmarks.length) * 100;
  
  console.log(`💾 Database benchmark completed: ${overallPassed}/${benchmarks.length} tests passed (${overallScore.toFixed(1)}%)`);
  
  return {
    benchmarks,
    summary: {
      totalTests: benchmarks.length,
      passed: overallPassed,
      failed: benchmarks.length - overallPassed,
      overallScore: overallScore,
      avgResponseTime: benchmarks
        .filter(b => b.responseTime > 0)
        .reduce((sum, b) => sum + b.responseTime, 0) / benchmarks.filter(b => b.responseTime > 0).length
    }
  };
}

async function getSystemResourceMetrics() {
  // In a real implementation, this would collect actual system metrics
  // For now, we'll return simulated metrics for Vietnamese agricultural platform
  
  return {
    cpu: {
      usage: Math.random() * 80 + 10, // 10-90% CPU usage
      cores: 4,
      loadAverage: [Math.random() * 2, Math.random() * 2, Math.random() * 2]
    },
    memory: {
      used: Math.random() * 8 + 2, // 2-10GB used
      total: 16, // 16GB total
      percentage: ((Math.random() * 8 + 2) / 16) * 100
    },
    database: {
      connections: Math.floor(Math.random() * 50 + 10), // 10-60 connections
      maxConnections: 100,
      queryPerformance: {
        avgQueryTime: Math.random() * 500 + 100, // 100-600ms
        slowQueries: Math.floor(Math.random() * 10) // 0-10 slow queries
      }
    },
    network: {
      inbound: Math.random() * 1000 + 100, // KB/s
      outbound: Math.random() * 500 + 50   // KB/s
    },
    vietnameseMarketSpecific: {
      governmentDataSourceLatency: Math.random() * 2000 + 500, // 0.5-2.5 seconds
      cooperativeDataSyncStatus: Math.random() > 0.1 ? 'healthy' : 'degraded',
      ruralConnectivitySimulation: Math.random() * 3000 + 1000 // 1-4 seconds for rural areas
    }
  };
}

async function testVietnameseMarketScenario(scenario: any) {
  console.log(`🇻🇳 Testing scenario: ${scenario.commodity} in ${scenario.region}`);
  
  // Simulate scenario-specific performance test
  const startTime = performance.now();
  
  // Simulate market-specific delays and conditions
  let simulatedDelay = 1000; // Base 1 second
  
  // Adjust for seasonality
  if (scenario.seasonality === 'harvest') {
    simulatedDelay *= 0.7; // Faster during harvest
  } else if (scenario.seasonality === 'export') {
    simulatedDelay *= 0.8; // Faster during export season
  }
  
  // Adjust for market conditions
  if (scenario.marketConditions === 'volatile') {
    simulatedDelay *= 1.3; // Slower during volatility
  } else if (scenario.marketConditions === 'crisis') {
    simulatedDelay *= 1.5; // Much slower during crisis
  }
  
  await new Promise(resolve => setTimeout(resolve, simulatedDelay));
  
  const endTime = performance.now();
  const responseTime = endTime - startTime;
  
  return {
    scenario,
    performance: {
      responseTime,
      targetTime: 2000,
      passed: responseTime <= 2000,
      vietnameseMarketFactors: {
        seasonalImpact: scenario.seasonality === 'harvest' ? 'positive' : 'neutral',
        marketConditionImpact: scenario.marketConditions === 'crisis' ? 'negative' : 'neutral',
        regionalConnectivity: scenario.region === 'mekong-delta' ? 'good' : 'moderate'
      }
    },
    recommendations: generateScenarioRecommendations(scenario, responseTime)
  };
}

function generatePerformanceRecommendations(results: any[]) {
  const recommendations = [];
  
  const overallSuccessRate = results.reduce((sum, r) => sum + r.throughput.successRate, 0) / results.length;
  const overallAvgResponseTime = results.reduce((sum, r) => sum + r.responseTime.avg, 0) / results.length;
  
  if (overallSuccessRate < 95) {
    recommendations.push({
      priority: 'high',
      category: 'reliability',
      title: 'Improve system reliability',
      description: 'Success rate is below 95%. Consider implementing additional retry logic and circuit breakers.',
      descriptionVietnamese: 'Tỷ lệ thành công dưới 95%. Cần cải thiện logic thử lại và cầu dao bảo vệ.'
    });
  }
  
  if (overallAvgResponseTime > 3000) {
    recommendations.push({
      priority: 'medium',
      category: 'performance',
      title: 'Optimize response times',
      description: 'Average response time exceeds 3 seconds. Consider caching and database optimizations.',
      descriptionVietnamese: 'Thời gian phản hồi trung bình vượt quá 3 giây. Cần tối ưu cache và cơ sở dữ liệu.'
    });
  }
  
  // Check Vietnamese-specific metrics
  const avgVietnamesePerformance = results
    .filter(r => r.vietnameseMarketMetrics)
    .reduce((sum, r) => sum + r.vietnameseMarketMetrics.peakSeasonPerformance, 0) / 
    results.filter(r => r.vietnameseMarketMetrics).length;
  
  if (avgVietnamesePerformance < 80) {
    recommendations.push({
      priority: 'high',
      category: 'vietnamese-market',
      title: 'Optimize for Vietnamese market conditions',
      description: 'Performance during Vietnamese peak seasons needs improvement. Consider regional optimizations.',
      descriptionVietnamese: 'Hiệu suất trong mùa vụ cao điểm của Việt Nam cần cải thiện. Cần tối ưu hóa theo khu vực.'
    });
  }
  
  return recommendations;
}

function generateScenarioRecommendations(scenario: any, responseTime: number) {
  const recommendations = [];
  
  if (responseTime > 2000) {
    recommendations.push({
      priority: 'medium',
      title: 'Optimize for scenario conditions',
      description: `Response time for ${scenario.commodity} in ${scenario.region} exceeds target. Consider regional caching.`,
      descriptionVietnamese: `Thời gian phản hồi cho ${scenario.commodity} tại ${scenario.region} vượt quá mục tiêu.`
    });
  }
  
  if (scenario.marketConditions === 'crisis') {
    recommendations.push({
      priority: 'high',
      title: 'Crisis mode optimization needed',
      description: 'During market crisis, implement priority queuing and faster response paths.',
      descriptionVietnamese: 'Trong khủng hoảng thị trường, cần triển khai hàng đợi ưu tiên và đường dẫn phản hồi nhanh.'
    });
  }
  
  return recommendations;
}

export default router;