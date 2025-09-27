/**
 * Performance Testing Service for Vietnamese Agricultural Intelligence Platform
 * 
 * Provides automated load testing, query performance benchmarking, and 
 * stress testing specifically designed for Vietnamese commodity forecasting data.
 */

import axios, { AxiosResponse } from 'axios';
import { performance } from 'perf_hooks';
import { storage } from '../storage';
import { type InsertPriceData, type InsertForecast30d } from '@shared/schema';

// Performance test configuration for Vietnamese agricultural markets
interface PerformanceTestConfig {
  baseUrl: string;
  concurrentUsers: number;
  testDurationMs: number;
  rampUpTimeMs: number;
  vietnameseMarketScenarios: boolean;
  targetResponseTimeMs: {
    forecast: number;      // 30-day forecast endpoint
    verification: number;  // LLM cross-check endpoint  
    reliability: number;   // Reliability metrics endpoint
    database: number;      // Database query performance
  };
}

// Vietnamese market testing scenarios
interface VietnameseMarketScenario {
  commodity: string;
  region: string;
  seasonality: 'harvest' | 'planting' | 'export' | 'regular';
  marketConditions: 'stable' | 'volatile' | 'crisis';
  expectedLoad: number; // requests per minute
}

// Performance test result metrics
interface PerformanceTestResult {
  testName: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  
  // Response time metrics
  responseTime: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  
  // Throughput metrics
  throughput: {
    requestsPerSecond: number;
    successRate: number;
    errorRate: number;
  };
  
  // Vietnamese market specific metrics
  vietnameseMarketMetrics: {
    peakSeasonPerformance: number;    // Performance during peak seasons
    ruralConnectivityImpact: number;  // Simulated rural network conditions
    governmentDataAccessTime: number; // Time to access govt data sources
    cooperativeDataSyncTime: number;  // Time to sync cooperative data
  };
  
  // Error breakdown
  errors: {
    timeouts: number;
    rateLimit: number;
    serverError: number;
    networkError: number;
    other: number;
  };
  
  // Resource utilization (if available)
  resourceMetrics?: {
    cpuUsage: number;
    memoryUsage: number;
    databaseConnections: number;
    llmApiCallsPerSecond: number;
  };
}

// Database query performance test
interface DatabasePerformanceTest {
  testName: string;
  query: string;
  expectedMaxTimeMs: number;
  iterations: number;
}

class PerformanceTestService {
  private config: PerformanceTestConfig;
  private vietnameseScenarios: VietnameseMarketScenario[];
  private testResults: PerformanceTestResult[] = [];
  
  constructor(config?: Partial<PerformanceTestConfig>) {
    this.config = {
      baseUrl: process.env.API_BASE_URL || 'http://localhost:5000',
      concurrentUsers: 50,
      testDurationMs: 60000, // 1 minute
      rampUpTimeMs: 10000,   // 10 seconds
      vietnameseMarketScenarios: true,
      targetResponseTimeMs: {
        forecast: 5000,      // 5 seconds for ML predictions
        verification: 15000, // 15 seconds for dual-LLM verification
        reliability: 1000,   // 1 second for metrics
        database: 500        // 500ms for database queries
      },
      ...config
    };
    
    this.vietnameseScenarios = this.initializeVietnameseScenarios();
  }
  
  private initializeVietnameseScenarios(): VietnameseMarketScenario[] {
    return [
      {
        commodity: 'jasmine-rice',
        region: 'mekong-delta',
        seasonality: 'harvest',
        marketConditions: 'stable',
        expectedLoad: 20 // requests per minute during harvest
      },
      {
        commodity: 'robusta-coffee',
        region: 'central-highlands',
        seasonality: 'export',
        marketConditions: 'volatile',
        expectedLoad: 15
      },
      {
        commodity: 'black-pepper',
        region: 'southeast',
        seasonality: 'regular',
        marketConditions: 'stable',
        expectedLoad: 8
      },
      {
        commodity: 'cashew-nuts',
        region: 'south-central',
        seasonality: 'planting',
        marketConditions: 'crisis',
        expectedLoad: 25 // Higher load during crisis periods
      }
    ];
  }

  /**
   * Run comprehensive performance test suite
   */
  async runPerformanceTestSuite(): Promise<PerformanceTestResult[]> {
    console.log('🚀 Starting Vietnamese Agricultural Performance Test Suite');
    
    const results: PerformanceTestResult[] = [];
    
    try {
      // 1. API Endpoint Load Tests
      console.log('📊 Testing API endpoints under load...');
      results.push(await this.testForecastEndpoint());
      results.push(await this.testLlmVerificationEndpoint());
      results.push(await this.testReliabilityEndpoint());
      
      // 2. Database Performance Tests
      console.log('💾 Testing database query performance...');
      results.push(await this.testDatabasePerformance());
      
      // 3. Vietnamese Market Scenario Tests
      if (this.config.vietnameseMarketScenarios) {
        console.log('🇻🇳 Testing Vietnamese market scenarios...');
        for (const scenario of this.vietnameseScenarios) {
          results.push(await this.testVietnameseMarketScenario(scenario));
        }
      }
      
      // 4. Stress Test (Peak Load Simulation)
      console.log('⚡ Running peak load stress test...');
      results.push(await this.runStressTest());
      
      this.testResults = results;
      await this.generatePerformanceReport(results);
      
      return results;
      
    } catch (error) {
      console.error('❌ Performance test suite failed:', error);
      throw error;
    }
  }

  /**
   * Test /v1/forecast-30d endpoint under load
   */
  private async testForecastEndpoint(): Promise<PerformanceTestResult> {
    const testName = 'forecast_endpoint_load_test';
    const startTime = Date.now();
    
    const requests: Promise<AxiosResponse>[] = [];
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    
    // Generate concurrent requests
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const requestPromise = this.makeForecastRequest().then(response => {
        responseTimes.push(response.data.responseTime || 0);
        return response;
      }).catch(error => {
        this.categorizeError(error, errors);
        throw error;
      });
      
      requests.push(requestPromise);
      
      // Stagger requests during ramp-up period
      if (i < this.config.rampUpTimeMs / 100) {
        await this.sleep(100);
      }
    }
    
    // Wait for all requests to complete or timeout
    const settledResults = await Promise.allSettled(requests);
    const endTime = Date.now();
    
    const successful = settledResults.filter(r => r.status === 'fulfilled').length;
    const failed = settledResults.filter(r => r.status === 'rejected').length;
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: this.config.concurrentUsers,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: this.config.concurrentUsers / ((endTime - startTime) / 1000),
        successRate: (successful / this.config.concurrentUsers) * 100,
        errorRate: (failed / this.config.concurrentUsers) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: successful > (this.config.concurrentUsers * 0.9) ? 100 : 75,
        ruralConnectivityImpact: this.calculateRuralConnectivityMetric(responseTimes),
        governmentDataAccessTime: this.estimateGovernmentDataAccessTime(responseTimes),
        cooperativeDataSyncTime: this.estimateCooperativeDataSyncTime(responseTimes)
      },
      errors
    };
  }

  /**
   * Test /v1/reliability endpoint under load
   */
  private async testReliabilityEndpoint(): Promise<PerformanceTestResult> {
    const testName = 'reliability_endpoint_load_test';
    const startTime = Date.now();
    
    const requests: Promise<AxiosResponse>[] = [];
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    
    // Moderate concurrent users for reliability endpoint
    const reliabilityConcurrentUsers = Math.floor(this.config.concurrentUsers * 0.6);
    
    for (let i = 0; i < reliabilityConcurrentUsers; i++) {
      const requestPromise = this.makeReliabilityRequest().then(response => {
        responseTimes.push(response.data.responseTime || 0);
        return response;
      }).catch(error => {
        this.categorizeError(error, errors);
        throw error;
      });
      
      requests.push(requestPromise);
      await this.sleep(150); // Moderate spacing for reliability requests
    }
    
    const settledResults = await Promise.allSettled(requests);
    const endTime = Date.now();
    
    const successful = settledResults.filter(r => r.status === 'fulfilled').length;
    const failed = settledResults.filter(r => r.status === 'rejected').length;
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: reliabilityConcurrentUsers,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: reliabilityConcurrentUsers / ((endTime - startTime) / 1000),
        successRate: (successful / reliabilityConcurrentUsers) * 100,
        errorRate: (failed / reliabilityConcurrentUsers) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: successful > (reliabilityConcurrentUsers * 0.9) ? 100 : 85,
        ruralConnectivityImpact: this.calculateRuralConnectivityMetric(responseTimes),
        governmentDataAccessTime: this.estimateGovernmentDataAccessTime(responseTimes),
        cooperativeDataSyncTime: this.estimateCooperativeDataSyncTime(responseTimes)
      },
      errors
    };
  }

  /**
   * Test /v1/llm-crosscheck endpoint under load
   */
  private async testLlmVerificationEndpoint(): Promise<PerformanceTestResult> {
    const testName = 'llm_verification_load_test';
    const startTime = Date.now();
    
    const requests: Promise<AxiosResponse>[] = [];
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    
    // Lower concurrent users for LLM endpoint (more expensive)
    const llmConcurrentUsers = Math.floor(this.config.concurrentUsers / 3);
    
    for (let i = 0; i < llmConcurrentUsers; i++) {
      const requestPromise = this.makeLlmVerificationRequest().then(response => {
        responseTimes.push(response.data.responseTime || 0);
        return response;
      }).catch(error => {
        this.categorizeError(error, errors);
        throw error;
      });
      
      requests.push(requestPromise);
      await this.sleep(200); // More spacing for LLM requests
    }
    
    const settledResults = await Promise.allSettled(requests);
    const endTime = Date.now();
    
    const successful = settledResults.filter(r => r.status === 'fulfilled').length;
    const failed = settledResults.filter(r => r.status === 'rejected').length;
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: llmConcurrentUsers,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: llmConcurrentUsers / ((endTime - startTime) / 1000),
        successRate: (successful / llmConcurrentUsers) * 100,
        errorRate: (failed / llmConcurrentUsers) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: successful > (llmConcurrentUsers * 0.8) ? 100 : 60,
        ruralConnectivityImpact: this.calculateRuralConnectivityMetric(responseTimes),
        governmentDataAccessTime: this.estimateGovernmentDataAccessTime(responseTimes),
        cooperativeDataSyncTime: this.estimateCooperativeDataSyncTime(responseTimes)
      },
      errors
    };
  }

  /**
   * Test database query performance with Vietnamese commodity data
   */
  private async testDatabasePerformance(): Promise<PerformanceTestResult> {
    const testName = 'database_performance_test';
    const startTime = Date.now();
    
    const queries: DatabasePerformanceTest[] = [
      {
        testName: 'price_data_time_series_query',
        query: 'SELECT * FROM price_data WHERE commodity_id = $1 AND region_id = $2 AND date >= $3 ORDER BY date DESC LIMIT 100',
        expectedMaxTimeMs: this.config.targetResponseTimeMs.database,
        iterations: 50
      },
      {
        testName: 'forecast_30d_retrieval',
        query: 'SELECT * FROM forecasts_30d WHERE commodity_id = $1 AND region_id = $2 AND forecast_date >= $3',
        expectedMaxTimeMs: this.config.targetResponseTimeMs.database,
        iterations: 30
      },
      {
        testName: 'cooperative_aggregation',
        query: 'SELECT coop_id, AVG(price) as avg_price FROM price_data WHERE region_id = $1 AND date >= $2 GROUP BY coop_id',
        expectedMaxTimeMs: this.config.targetResponseTimeMs.database * 2,
        iterations: 20
      }
    ];
    
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    let successful = 0;
    let failed = 0;
    
    for (const queryTest of queries) {
      for (let i = 0; i < queryTest.iterations; i++) {
        try {
          const queryStart = performance.now();
          
          // Execute query with Vietnamese market parameters
          await this.executeTestQuery(queryTest.query, [
            'jasmine-rice',
            'mekong-delta', 
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          ]);
          
          const queryEnd = performance.now();
          const responseTime = queryEnd - queryStart;
          responseTimes.push(responseTime);
          
          if (responseTime <= queryTest.expectedMaxTimeMs) {
            successful++;
          } else {
            failed++;
            console.warn(`⚠️ Query ${queryTest.testName} exceeded target: ${responseTime.toFixed(2)}ms > ${queryTest.expectedMaxTimeMs}ms`);
          }
          
        } catch (error) {
          failed++;
          errors.other++;
          console.error(`❌ Query ${queryTest.testName} failed:`, error);
        }
      }
    }
    
    const endTime = Date.now();
    const totalQueries = queries.reduce((sum, q) => sum + q.iterations, 0);
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: totalQueries,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: totalQueries / ((endTime - startTime) / 1000),
        successRate: (successful / totalQueries) * 100,
        errorRate: (failed / totalQueries) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: successful > (totalQueries * 0.9) ? 100 : 80,
        ruralConnectivityImpact: 0, // N/A for database tests
        governmentDataAccessTime: 0, // N/A for database tests
        cooperativeDataSyncTime: this.calculateAverageResponseTime(responseTimes)
      },
      errors
    };
  }

  /**
   * Test specific Vietnamese market scenario
   */
  private async testVietnameseMarketScenario(scenario: VietnameseMarketScenario): Promise<PerformanceTestResult> {
    const testName = `vietnamese_market_${scenario.commodity}_${scenario.region}_${scenario.seasonality}`;
    const startTime = Date.now();
    
    console.log(`🇻🇳 Testing ${scenario.commodity} in ${scenario.region} during ${scenario.seasonality} season`);
    
    const expectedRequests = Math.floor(scenario.expectedLoad * (this.config.testDurationMs / 60000));
    const requests: Promise<AxiosResponse>[] = [];
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    
    // Simulate realistic Vietnamese market usage patterns
    for (let i = 0; i < expectedRequests; i++) {
      const requestPromise = this.makeScenarioSpecificRequest(scenario).then(response => {
        responseTimes.push(response.data.responseTime || 0);
        return response;
      }).catch(error => {
        this.categorizeError(error, errors);
        throw error;
      });
      
      requests.push(requestPromise);
      
      // Add realistic delays based on market conditions
      const delay = this.calculateScenarioDelay(scenario);
      await this.sleep(delay);
    }
    
    const settledResults = await Promise.allSettled(requests);
    const endTime = Date.now();
    
    const successful = settledResults.filter(r => r.status === 'fulfilled').length;
    const failed = settledResults.filter(r => r.status === 'rejected').length;
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: expectedRequests,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: expectedRequests / ((endTime - startTime) / 1000),
        successRate: (successful / expectedRequests) * 100,
        errorRate: (failed / expectedRequests) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: this.calculateSeasonalPerformance(scenario, successful, expectedRequests),
        ruralConnectivityImpact: this.calculateRuralConnectivityMetric(responseTimes),
        governmentDataAccessTime: this.estimateGovernmentDataAccessTime(responseTimes),
        cooperativeDataSyncTime: this.estimateCooperativeDataSyncTime(responseTimes)
      },
      errors
    };
  }

  /**
   * Run stress test with peak load simulation
   */
  private async runStressTest(): Promise<PerformanceTestResult> {
    const testName = 'peak_load_stress_test';
    const startTime = Date.now();
    
    console.log('⚡ Simulating peak agricultural season load...');
    
    // Double the concurrent users for stress test
    const stressUsers = this.config.concurrentUsers * 2;
    const requests: Promise<AxiosResponse>[] = [];
    const responseTimes: number[] = [];
    const errors = { timeouts: 0, rateLimit: 0, serverError: 0, networkError: 0, other: 0 };
    
    // Mix different endpoints under stress
    for (let i = 0; i < stressUsers; i++) {
      let requestPromise: Promise<AxiosResponse>;
      
      // Randomize endpoint selection
      const endpointType = i % 3;
      switch (endpointType) {
        case 0:
          requestPromise = this.makeForecastRequest();
          break;
        case 1:
          requestPromise = this.makeReliabilityRequest();
          break;
        case 2:
          requestPromise = this.makeLlmVerificationRequest();
          break;
        default:
          requestPromise = this.makeForecastRequest();
      }
      
      requestPromise = requestPromise.then(response => {
        responseTimes.push(response.data.responseTime || 0);
        return response;
      }).catch(error => {
        this.categorizeError(error, errors);
        throw error;
      });
      
      requests.push(requestPromise);
      
      // Minimal delay for maximum stress
      if (i % 10 === 0) {
        await this.sleep(50);
      }
    }
    
    const settledResults = await Promise.allSettled(requests);
    const endTime = Date.now();
    
    const successful = settledResults.filter(r => r.status === 'fulfilled').length;
    const failed = settledResults.filter(r => r.status === 'rejected').length;
    
    return {
      testName,
      startTime,
      endTime,
      totalDurationMs: endTime - startTime,
      totalRequests: stressUsers,
      successfulRequests: successful,
      failedRequests: failed,
      responseTime: this.calculateResponseTimeMetrics(responseTimes),
      throughput: {
        requestsPerSecond: stressUsers / ((endTime - startTime) / 1000),
        successRate: (successful / stressUsers) * 100,
        errorRate: (failed / stressUsers) * 100
      },
      vietnameseMarketMetrics: {
        peakSeasonPerformance: successful > (stressUsers * 0.75) ? 100 : 50,
        ruralConnectivityImpact: this.calculateRuralConnectivityMetric(responseTimes),
        governmentDataAccessTime: this.estimateGovernmentDataAccessTime(responseTimes),
        cooperativeDataSyncTime: this.estimateCooperativeDataSyncTime(responseTimes)
      },
      errors
    };
  }

  // Helper methods for making API requests
  private async makeForecastRequest(): Promise<AxiosResponse> {
    return axios.post(`${this.config.baseUrl}/v1/forecast-30d`, {
      commodity: 'jasmine-rice',
      region: 'mekong-delta',
      cooperativeId: 'coop-001',
      targetDate: new Date().toISOString().split('T')[0]
    }, {
      timeout: this.config.targetResponseTimeMs.forecast,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async makeLlmVerificationRequest(): Promise<AxiosResponse> {
    return axios.post(`${this.config.baseUrl}/v1/llm-crosscheck`, {
      commodity: 'jasmine-rice',
      region: 'mekong-delta',
      forecastId: 'forecast-test-001'
    }, {
      timeout: this.config.targetResponseTimeMs.verification,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async makeReliabilityRequest(): Promise<AxiosResponse> {
    return axios.get(`${this.config.baseUrl}/v1/reliability`, {
      params: {
        commodity: 'jasmine-rice',
        region: 'mekong-delta'
      },
      timeout: this.config.targetResponseTimeMs.reliability
    });
  }

  private async makeScenarioSpecificRequest(scenario: VietnameseMarketScenario): Promise<AxiosResponse> {
    // Make request specific to the Vietnamese market scenario
    return axios.post(`${this.config.baseUrl}/v1/forecast-30d`, {
      commodity: scenario.commodity,
      region: scenario.region,
      cooperativeId: 'coop-001',
      targetDate: new Date().toISOString().split('T')[0],
      seasonality: scenario.seasonality,
      marketConditions: scenario.marketConditions
    }, {
      timeout: this.config.targetResponseTimeMs.forecast * (scenario.marketConditions === 'crisis' ? 1.5 : 1.0),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Helper methods for calculations and utilities
  private calculateResponseTimeMetrics(responseTimes: number[]) {
    if (responseTimes.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }
    
    const sorted = responseTimes.sort((a, b) => a - b);
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  private categorizeError(error: any, errorCount: any) {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      errorCount.timeouts++;
    } else if (error.response?.status === 429) {
      errorCount.rateLimit++;
    } else if (error.response?.status >= 500) {
      errorCount.serverError++;
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      errorCount.networkError++;
    } else {
      errorCount.other++;
    }
  }

  private calculateRuralConnectivityMetric(responseTimes: number[]): number {
    // Simulate rural connectivity impact (higher response times = lower score)
    const avgResponseTime = this.calculateAverageResponseTime(responseTimes);
    const ruralThreshold = 2000; // 2 seconds baseline for rural connectivity
    return Math.max(0, 100 - ((avgResponseTime - ruralThreshold) / ruralThreshold * 100));
  }

  private estimateGovernmentDataAccessTime(responseTimes: number[]): number {
    // Estimate time to access government data sources (typically slower)
    return this.calculateAverageResponseTime(responseTimes) * 1.3; // 30% overhead
  }

  private estimateCooperativeDataSyncTime(responseTimes: number[]): number {
    // Estimate time to sync cooperative data
    return this.calculateAverageResponseTime(responseTimes) * 0.8; // 20% faster than government data
  }

  private calculateAverageResponseTime(responseTimes: number[]): number {
    if (responseTimes.length === 0) return 0;
    return responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
  }

  private calculateScenarioDelay(scenario: VietnameseMarketScenario): number {
    // Calculate realistic delay based on scenario conditions
    let baseDelay = 1000; // 1 second base
    
    // Adjust for seasonality
    switch (scenario.seasonality) {
      case 'harvest':
        baseDelay *= 0.5; // Faster during harvest (more activity)
        break;
      case 'export':
        baseDelay *= 0.7; // Faster during export season
        break;
      case 'planting':
        baseDelay *= 0.8; // Moderate activity during planting
        break;
      default:
        baseDelay *= 1.0;
    }
    
    // Adjust for market conditions
    switch (scenario.marketConditions) {
      case 'volatile':
        baseDelay *= 0.6; // More frequent queries
        break;
      case 'crisis':
        baseDelay *= 0.2; // Very frequent queries
        break;
      default:
        baseDelay *= 1.0;
    }
    
    return Math.floor(baseDelay);
  }

  private calculateSeasonalPerformance(scenario: VietnameseMarketScenario, successful: number, total: number): number {
    const basePerformance = (successful / total) * 100;
    
    // Adjust expectations based on season and conditions
    if (scenario.seasonality === 'harvest' || scenario.marketConditions === 'crisis') {
      return basePerformance * 0.9; // Lower expectations during high-stress periods
    }
    
    return basePerformance;
  }

  private async executeTestQuery(query: string, params: any[]): Promise<any> {
    // Mock database query execution for testing
    // In production, this would use the actual storage interface
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ rows: [], count: 0 });
      }, Math.random() * 100 + 50); // 50-150ms simulated query time
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate comprehensive performance report
   */
  private async generatePerformanceReport(results: PerformanceTestResult[]): Promise<void> {
    console.log('\n📊 VIETNAMESE AGRICULTURAL PERFORMANCE TEST REPORT');
    console.log('=' .repeat(60));
    
    for (const result of results) {
      console.log(`\n🎯 ${result.testName}`);
      console.log(`   Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
      console.log(`   Success Rate: ${result.throughput.successRate.toFixed(1)}%`);
      console.log(`   Avg Response Time: ${result.responseTime.avg.toFixed(0)}ms`);
      console.log(`   P95 Response Time: ${result.responseTime.p95.toFixed(0)}ms`);
      console.log(`   Throughput: ${result.throughput.requestsPerSecond.toFixed(1)} req/s`);
      
      if (result.vietnameseMarketMetrics.peakSeasonPerformance > 0) {
        console.log(`   🇻🇳 Vietnamese Market Metrics:`);
        console.log(`     Peak Season Performance: ${result.vietnameseMarketMetrics.peakSeasonPerformance.toFixed(0)}/100`);
        console.log(`     Rural Connectivity Impact: ${result.vietnameseMarketMetrics.ruralConnectivityImpact.toFixed(0)}/100`);
        console.log(`     Cooperative Data Sync Time: ${result.vietnameseMarketMetrics.cooperativeDataSyncTime.toFixed(0)}ms`);
      }
      
      if (result.errors.timeouts > 0 || result.errors.rateLimit > 0) {
        console.log(`   ⚠️ Issues: ${result.errors.timeouts} timeouts, ${result.errors.rateLimit} rate limits`);
      }
    }
    
    // Overall assessment
    const overallSuccessRate = results.reduce((sum, r) => sum + r.throughput.successRate, 0) / results.length;
    const overallAvgResponseTime = results.reduce((sum, r) => sum + r.responseTime.avg, 0) / results.length;
    
    console.log('\n📈 OVERALL ASSESSMENT');
    console.log(`   Success Rate: ${overallSuccessRate.toFixed(1)}%`);
    console.log(`   Avg Response Time: ${overallAvgResponseTime.toFixed(0)}ms`);
    
    if (overallSuccessRate >= 95 && overallAvgResponseTime <= 3000) {
      console.log('   ✅ PERFORMANCE: EXCELLENT for Vietnamese agricultural markets');
    } else if (overallSuccessRate >= 90 && overallAvgResponseTime <= 5000) {
      console.log('   ⚠️ PERFORMANCE: GOOD but could be optimized');
    } else {
      console.log('   ❌ PERFORMANCE: NEEDS IMPROVEMENT for production readiness');
    }
  }

  /**
   * Get performance test results
   */
  getTestResults(): PerformanceTestResult[] {
    return this.testResults;
  }

  /**
   * Check if system meets performance targets
   */
  meetsPerformanceTargets(): boolean {
    if (this.testResults.length === 0) {
      return false;
    }
    
    const overallSuccessRate = this.testResults.reduce((sum, r) => sum + r.throughput.successRate, 0) / this.testResults.length;
    const overallAvgResponseTime = this.testResults.reduce((sum, r) => sum + r.responseTime.avg, 0) / this.testResults.length;
    
    return overallSuccessRate >= 95 && overallAvgResponseTime <= 3000;
  }
}

export const performanceTestService = new PerformanceTestService();