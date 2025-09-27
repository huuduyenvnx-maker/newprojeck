import { storage } from "../storage";
import { type InsertForecast, type InsertTradingRecommendation, type InsertForecastRun, type InsertForecast30d } from "@shared/schema";
import { qualityGatesEngine } from "./quality-gates";
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface ForecastPrediction {
  date: string;
  median: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  confidence: number;
  trend: string;
  volatility: number;
}

interface HistoricalPrice {
  date: string;
  price: number;
  currency: string;
  volume?: number;
}

interface PythonMLResponse {
  commodity_id: string;
  region_id: string;
  forecast_date: string;
  horizon: number;
  model_type: string;
  model_version: string;
  predictions: ForecastPrediction[];
  metrics: ForecastMetrics;
  metadata: any;
  status: string;
}

// Environment configuration with fallbacks
const PYTHON_ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_SERVICE_TIMEOUT = parseInt(process.env.ML_SERVICE_TIMEOUT || '120000');
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5');
const CIRCUIT_BREAKER_TIMEOUT = parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '60000');
const HEALTH_CHECK_TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000');
const MAX_RETRIES = parseInt(process.env.ML_SERVICE_MAX_RETRIES || '3');

// HPO Integration interfaces
interface HPOBestParameters {
  commodity_id: string;
  region_id: string;
  best_parameters: Record<string, any>;
  performance_metrics: {
    mase: number;
    smape: number;
    picp: number;
  };
  model_version: string;
  last_updated: string;
  mlflow_run_id: string;
}

interface OptimizedForecastParams {
  model_type: string;
  parameters?: Record<string, any>;
  use_optimized: boolean;
  optimization_source: string;
}

interface ForecastMetrics {
  mase: number;
  smape: number;
  picp: number;
  coverage: number;
  fqs: number; // Forecast Quality Score
}

// Circuit Breaker State Management
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN', 
  HALF_OPEN = 'HALF_OPEN'
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  timeout: number;
  monitoringWindowSize: number;
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  async call<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.timeout) {
        console.log('Circuit breaker transitioning to HALF_OPEN');
        this.state = CircuitState.HALF_OPEN;
      } else {
        console.log('Circuit breaker is OPEN, using fallback');
        if (fallback) {
          return await fallback();
        }
        throw new Error('Circuit breaker is OPEN and no fallback provided');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) {
        // Re-check state after onFailure() as it might have changed to OPEN
        const currentState = this.getState();
        if (currentState === CircuitState.OPEN) {
          return await fallback();
        }
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      console.log('Circuit breaker transitioning to CLOSED after successful call');
      this.state = CircuitState.CLOSED;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.config.failureThreshold) {
      console.log(`Circuit breaker transitioning to OPEN after ${this.failureCount} failures`);
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.state === CircuitState.OPEN
    };
  }
}

// Request correlation and structured logging
interface RequestContext {
  requestId: string;
  timestamp: number;
  commodityId: string;
  regionId: string;
  operation: string;
}

class StructuredLogger {
  static log(level: 'INFO' | 'WARN' | 'ERROR', context: RequestContext, message: string, metadata?: any) {
    const logEntry = {
      level,
      timestamp: new Date().toISOString(),
      requestId: context.requestId,
      commodityId: context.commodityId,
      regionId: context.regionId,
      operation: context.operation,
      message,
      duration: Date.now() - context.timestamp,
      ...metadata
    };
    
    console.log(JSON.stringify(logEntry));
  }

  static error(context: RequestContext, message: string, error: any) {
    this.log('ERROR', context, message, {
      error: {
        message: error.message,
        stack: error.stack,
        statusCode: error.response?.status,
        responseData: error.response?.data
      }
    });
  }
}

// Health probe implementation with retry logic
class MLServiceHealthProbe {
  private lastHealthCheck = 0;
  private healthStatus = false;
  private readonly healthCheckInterval = 30000; // 30 seconds
  
  async checkHealth(requestId: string): Promise<boolean> {
    const now = Date.now();
    
    // Use cached health status if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval && this.healthStatus) {
      return this.healthStatus;
    }
    
    try {
      const response = await axios.get(`${PYTHON_ML_SERVICE_URL}/health`, {
        timeout: HEALTH_CHECK_TIMEOUT,
        headers: { 'x-request-id': requestId }
      });
      
      this.healthStatus = response.data.status === 'healthy';
      this.lastHealthCheck = now;
      
      return this.healthStatus;
    } catch (error) {
      console.error(`Health check failed for request ${requestId}:`, error);
      this.healthStatus = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  async waitForHealth(requestId: string, maxWaitTime = 60000): Promise<boolean> {
    const startTime = Date.now();
    let attempts = 0;
    
    while (Date.now() - startTime < maxWaitTime) {
      attempts++;
      
      if (await this.checkHealth(requestId)) {
        console.log(`ML service healthy after ${attempts} attempts (${Date.now() - startTime}ms)`);
        return true;
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempts) + Math.random() * 1000, 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    console.error(`ML service failed to become healthy after ${maxWaitTime}ms`);
    return false;
  }
}

class ForecastService {
  private circuitBreaker: CircuitBreaker;
  private healthProbe: MLServiceHealthProbe;
  private requestCache: Map<string, any> = new Map();

  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      timeout: CIRCUIT_BREAKER_TIMEOUT,
      monitoringWindowSize: 10
    });
    this.healthProbe = new MLServiceHealthProbe();
  }

  async generateForecast(commodityId: string, regionId: string, horizon: number = 30): Promise<any> {
    const requestId = uuidv4();
    const context: RequestContext = {
      requestId,
      timestamp: Date.now(),
      commodityId,
      regionId,
      operation: 'generateForecast'
    };

    StructuredLogger.log('INFO', context, `Starting ML forecast generation with horizon ${horizon}`);

    try {
      // Check ML service health first
      const isHealthy = await this.healthProbe.checkHealth(requestId);
      if (!isHealthy) {
        StructuredLogger.log('WARN', context, 'ML service not healthy, waiting for recovery');
        await this.healthProbe.waitForHealth(requestId, 30000); // 30 second max wait
      }

      // Get historical price data - use verified prices for better quality
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 2); // 2 years of history
      
      const historicalData = await storage.getPricesVerified(commodityId, regionId, startDate, endDate);
      
      if (historicalData.length < 30) {
        const error = new Error("Insufficient historical data for forecasting");
        (error as any).statusCode = 400;
        StructuredLogger.error(context, 'Insufficient historical data', error);
        throw error;
      }

      StructuredLogger.log('INFO', context, `Retrieved ${historicalData.length} historical data points`);

      // Get optimized parameters before calling ML service
      const optimizedParams = await this.getOptimizedParameters(commodityId, regionId);
      
      // Call Python ML microservice with circuit breaker
      const mlForecast = await this.circuitBreaker.call(
        () => this.callPythonMLServiceWithRetry(commodityId, regionId, historicalData, horizon, context),
        () => this.getFallbackForecast(commodityId, regionId, horizon, context)
      );
      
      // Create forecast run for metadata tracking with HPO information
      const forecastRun = await this.createForecastRun(commodityId, regionId, horizon, mlForecast, optimizedParams);
      
      // Store 30-day forecasts in new table structure
      await this.storeForecast30d(forecastRun.id, commodityId, regionId, mlForecast);
      
      // Generate trading recommendations
      const compatiblePredictions = this.convertToCompatibleFormat(mlForecast.predictions);
      await this.generateTradingRecommendations(forecastRun.id, compatiblePredictions, mlForecast.metrics);
      
      // Return forecast run data for frontend compatibility
      const result = {
        id: forecastRun.id,
        commodityId,
        regionId,
        forecastDate: new Date(),
        horizon: mlForecast.horizon,
        method: `ml_${mlForecast.model_type}`,
        predictions: compatiblePredictions,
        metrics: mlForecast.metrics,
        modelVersion: mlForecast.model_version,
        isActive: true,
        mlServiceMetadata: mlForecast.metadata,
        requestId,
        circuitBreakerStats: this.circuitBreaker.getStats()
      };
      
      StructuredLogger.log('INFO', context, 'ML forecast generated successfully', { 
        predictionCount: compatiblePredictions.length,
        modelType: mlForecast.model_type 
      });
      return result;
      
    } catch (error) {
      StructuredLogger.error(context, 'ML forecast generation failed', error);
      throw error;
    }
  }

  private async callPythonMLServiceWithRetry(
    commodityId: string, 
    regionId: string, 
    historicalData: any[], 
    horizon: number, 
    context: RequestContext
  ): Promise<PythonMLResponse> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        StructuredLogger.log('INFO', context, `ML service call attempt ${attempt}/${MAX_RETRIES}`);
        
        const result = await this.callPythonMLService(commodityId, regionId, historicalData, horizon);
        
        if (attempt > 1) {
          StructuredLogger.log('INFO', context, `ML service call succeeded on attempt ${attempt}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
          StructuredLogger.log('WARN', context, `ML service call failed, retrying in ${delay}ms`, { 
            attempt, 
            error: error instanceof Error ? error.message : String(error) 
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  private async getFallbackForecast(
    commodityId: string, 
    regionId: string, 
    horizon: number, 
    context: RequestContext
  ): Promise<PythonMLResponse> {
    StructuredLogger.log('WARN', context, 'Using fallback forecast due to ML service unavailability');
    
    // Generate a simple trend-based fallback forecast
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1); // 1 year for trend calculation
    
    const recentData = await storage.getPricesVerified(commodityId, regionId, startDate, endDate);
    
    if (recentData.length === 0) {
      throw new Error("No data available for fallback forecast");
    }
    
    // Calculate simple trend
    const prices = recentData.map(d => parseFloat(d.price || d.priceUsd || "0"));
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const trend = prices.length > 1 ? (prices[prices.length - 1] - prices[0]) / prices.length : 0;
    
    const predictions: ForecastPrediction[] = [];
    const startDate_pred = new Date();
    startDate_pred.setDate(startDate_pred.getDate() + 1);
    
    for (let i = 0; i < horizon; i++) {
      const date = new Date(startDate_pred);
      date.setDate(date.getDate() + i);
      
      const basePrice = avgPrice + (trend * i);
      const volatility = 0.05; // 5% volatility
      
      predictions.push({
        date: date.toISOString().split('T')[0],
        median: basePrice,
        q10: basePrice * (1 - volatility * 2),
        q25: basePrice * (1 - volatility),
        q75: basePrice * (1 + volatility),
        q90: basePrice * (1 + volatility * 2),
        confidence: 0.6, // Lower confidence for fallback
        trend: trend > 0 ? "up" : trend < 0 ? "down" : "stable",
        volatility: volatility
      });
    }
    
    return {
      commodity_id: commodityId,
      region_id: regionId,
      forecast_date: new Date().toISOString().split('T')[0],
      horizon,
      model_type: "fallback",
      model_version: "v1.0.0-fallback",
      predictions,
      metrics: {
        mase: 1.0,
        smape: 0.1,
        picp: 0.6,
        coverage: 0.6,
        fqs: 0.5
      },
      metadata: { fallback: true, reason: "ml_service_unavailable" },
      status: "completed"
    };
  }

  /**
   * Retrieve optimized parameters from HPO service
   */
  private async getOptimizedParameters(commodityId: string, regionId: string): Promise<OptimizedForecastParams> {
    try {
      console.log(`🔍 Retrieving optimized parameters for ${commodityId} in ${regionId}`);
      
      const response = await axios.get(
        `${PYTHON_ML_SERVICE_URL}/best-parameters/${commodityId}/${regionId}`,
        { timeout: 10000 }
      );
      
      if (response.status === 200) {
        const hpoData: HPOBestParameters = response.data;
        
        console.log(`✅ Found optimized parameters for ${commodityId}:`, {
          model_version: hpoData.model_version,
          mase: hpoData.performance_metrics.mase,
          picp: hpoData.performance_metrics.picp
        });
        
        // Determine best model type from parameters
        let modelType = 'ensemble'; // Default
        if (hpoData.best_parameters.model_type) {
          modelType = hpoData.best_parameters.model_type;
        } else if (hpoData.best_parameters.final_weights) {
          modelType = 'ensemble';
        } else if (hpoData.best_parameters.p !== undefined) {
          modelType = 'arima';
        } else if (hpoData.best_parameters.trend !== undefined) {
          modelType = 'ets';
        } else if (hpoData.best_parameters.n_estimators !== undefined) {
          modelType = 'lightgbm';
        }
        
        return {
          model_type: modelType,
          parameters: hpoData.best_parameters,
          use_optimized: true,
          optimization_source: `mlflow_run_${hpoData.mlflow_run_id}`
        };
      }
      
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.log(`ℹ️ No optimized parameters found for ${commodityId} in ${regionId}, using defaults`);
      } else {
        console.warn(`⚠️ Failed to retrieve optimized parameters: ${error}`);
      }
    }
    
    // Return default configuration if no optimized parameters found
    return {
      model_type: 'ensemble',
      parameters: undefined,
      use_optimized: false,
      optimization_source: 'default'
    };
  }

  /**
   * Trigger HPO optimization for a commodity-region pair
   */
  async triggerHPOptimization(commodityId: string, regionId: string, historicalData: any[], options: {
    optimization_type?: 'single_model' | 'ensemble_weights' | 'multi_objective';
    model_type?: string;
    n_trials?: number;
  } = {}): Promise<any> {
    try {
      console.log(`🚀 Triggering HPO for ${commodityId} in ${regionId}`);
      
      // Prepare historical data for HPO
      const historicalPrices: HistoricalPrice[] = historicalData.map(item => ({
        date: item.date instanceof Date ? item.date.toISOString().split('T')[0] : String(item.date).split('T')[0],
        price: parseFloat(String(item.price || item.priceUsd || "0")),
        currency: String(item.currency || "USD"),
        volume: item.volume ? parseFloat(String(item.volume)) : undefined
      }));
      
      const requestPayload = {
        commodity_id: commodityId,
        region_id: regionId,
        historical_prices: historicalPrices,
        optimization_type: options.optimization_type || 'multi_objective',
        model_type: options.model_type || 'ensemble',
        n_trials: options.n_trials || 100,
        timeout: 3600
      };
      
      const response = await axios.post(
        `${PYTHON_ML_SERVICE_URL}/optimize`,
        requestPayload,
        { 
          timeout: 5000, // Quick response for async operation
          headers: { 'Content-Type': 'application/json' }
        }
      );
      
      if (response.status === 200) {
        console.log(`✅ HPO initiated successfully: ${response.data.study_name}`);
        return response.data;
      }
      
      throw new Error(`HPO service returned status ${response.status}`);
      
    } catch (error) {
      console.error(`❌ Failed to trigger HPO: ${error}`);
      throw new Error(`HPO trigger failed: ${error}`);
    }
  }

  private async callPythonMLService(commodityId: string, regionId: string, historicalData: any[], horizon: number): Promise<PythonMLResponse> {
    try {
      // Prepare historical data for Python service with proper data type conversion
      const historicalPrices: HistoricalPrice[] = historicalData.map(item => {
        // Ensure proper numeric conversion for database decimal types
        const price = parseFloat(String(item.price || item.priceUsd || "0"));
        const volume = item.volume ? parseFloat(String(item.volume)) : undefined;
        
        // Validate that we have clean numbers
        if (isNaN(price) || price <= 0) {
          throw new Error(`Invalid price value: ${item.price}`);
        }
        if (volume !== undefined && (isNaN(volume) || volume < 0)) {
          throw new Error(`Invalid volume value: ${item.volume}`);
        }
        
        return {
          date: item.date instanceof Date ? item.date.toISOString().split('T')[0] : String(item.date).split('T')[0],
          price: price,
          currency: String(item.currency || "USD"),
          volume: volume
        };
      });
      
      // Get optimized parameters for this commodity-region combination
      const optimizedParams = await this.getOptimizedParameters(commodityId, regionId);
      
      const requestPayload = {
        commodity_id: commodityId,
        region_id: regionId,
        historical_prices: historicalPrices,
        horizon: horizon,
        model_type: optimizedParams.model_type,
        // Include optimized parameters if available
        ...(optimizedParams.parameters && { optimized_parameters: optimizedParams.parameters })
      };
      
      console.log(`📊 Using ${optimizedParams.use_optimized ? 'optimized' : 'default'} parameters for ${optimizedParams.model_type} model`);
      
      console.log(`Calling Python ML service with ${historicalPrices.length} historical data points`);
      
      // Call Python FastAPI service
      const response = await axios.post(`${PYTHON_ML_SERVICE_URL}/forecast`, requestPayload, {
        timeout: 120000, // 2 minute timeout for model training and forecasting
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Python ML service returned status ${response.status}`);
      }
      
      console.log(`Python ML service responded successfully with ${response.data.predictions.length} predictions`);
      return response.data as PythonMLResponse;
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMsg = error.response?.data?.detail || error.message;
        console.error(`Python ML service error: ${errorMsg}`);
        throw new Error(`ML service error: ${errorMsg}`);
      }
      console.error(`Failed to call Python ML service: ${error}`);
      throw error;
    }
  }

  private async createForecastRun(commodityId: string, regionId: string, horizon: number, mlResponse: PythonMLResponse, optimizedParams?: OptimizedForecastParams): Promise<any> {
    // Enhance metadata with HPO information
    const enhancedMetadata = {
      ...mlResponse.metadata,
      hpo_enabled: optimizedParams?.use_optimized || false,
      optimization_source: optimizedParams?.optimization_source || 'default',
      optimized_parameters: optimizedParams?.use_optimized ? optimizedParams.parameters : null
    };
    
    const forecastRunData: InsertForecastRun = {
      commodityId,
      regionId,
      runDate: new Date(),
      horizon,
      model: mlResponse.model_type,
      modelVersion: mlResponse.model_version,
      parameters: enhancedMetadata,
      status: "completed",
      completedAt: new Date(),
      metrics: mlResponse.metrics
    };
    
    const forecastRun = await storage.createForecastRun(forecastRunData);
    console.log(`✅ SUCCESS: Created forecast run record with ID: ${forecastRun.id} (HPO: ${optimizedParams?.use_optimized ? 'enabled' : 'disabled'})`);
    return forecastRun;
  }
  
  private async storeForecast30d(forecastRunId: string, commodityId: string, regionId: string, mlResponse: PythonMLResponse): Promise<void> {
    const forecastDate = new Date();
    const forecasts30d: InsertForecast30d[] = [];
    
    for (let i = 0; i < mlResponse.predictions.length; i++) {
      const prediction = mlResponse.predictions[i];
      const targetDate = new Date(prediction.date);
      
      forecasts30d.push({
        forecastRunId,
        commodityId,
        regionId,
        forecastDate,
        targetDate,
        daysAhead: i + 1,
        median: prediction.median.toString(),
        q10: prediction.q10.toString(),
        q25: prediction.q25.toString(),
        q75: prediction.q75.toString(),
        q90: prediction.q90.toString(),
        confidence: prediction.confidence.toString(),
        trend: prediction.trend,
        volatility: prediction.volatility.toString(),
        isActive: true
      });
    }
    
    const insertedForecasts = await storage.bulkInsertForecasts30d(forecasts30d);
    console.log(`✅ SUCCESS: Stored ${insertedForecasts.length} forecast predictions in forecasts_30d table`);
    
    // Add INFO log with inserted row counts for verification
    console.log(`📊 FORECAST SUCCESS METRICS:
      - Forecast Run ID: ${forecastRunId}
      - Commodity: ${commodityId}
      - Region: ${regionId}
      - Forecasts 30d inserted: ${insertedForecasts.length} rows
      - Date range: ${forecasts30d[0]?.targetDate} to ${forecasts30d[forecasts30d.length - 1]?.targetDate}
      - Model: ${mlResponse.model_type} v${mlResponse.model_version}`);

    // Run Quality Gates Analysis
    try {
      console.log(`🔍 Starting quality gate analysis for forecast run: ${forecastRunId}`);
      const qualityAnalysis = await qualityGatesEngine.runQualityGateAnalysis(
        forecastRunId,
        insertedForecasts[0]?.id // Use first forecast30d as reference
      );
      
      console.log(`✅ Quality Gate Analysis Complete:
        - CCS Score: ${qualityAnalysis.ccsResult.compositeScore}%
        - Confidence Level: ${qualityAnalysis.qualityGateDecision.confidenceLevel}
        - Gate Status: ${qualityAnalysis.qualityGateDecision.gateStatus}
        - UI Indicator: ${qualityAnalysis.qualityGateDecision.uiIndicator}`);
        
    } catch (qualityError) {
      console.error(`❌ Quality gate analysis failed for ${forecastRunId}:`, qualityError);
      // Don't fail the entire forecast - quality gates are supplementary
    }
  }
  
  private convertToCompatibleFormat(predictions: ForecastPrediction[]): any[] {
    // Convert Python ML predictions to format expected by existing frontend
    return predictions.map(pred => ({
      date: pred.date,
      median: pred.median,
      q10: pred.q10,
      q90: pred.q90,
      confidence: pred.confidence
    }));
  }

  private async generateTradingRecommendations(forecastRunId: string, predictions: any[], metrics: ForecastMetrics) {
    const firstPrediction = predictions[0];
    const lastPrediction = predictions[predictions.length - 1];
    
    // Determine action based on trend
    const priceChange = (lastPrediction.median - firstPrediction.median) / firstPrediction.median;
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    
    let action: string;
    let riskLevel: string;
    let reasoning: string;

    if (priceChange > 0.05 && avgConfidence > 0.8) {
      action = "buy";
      riskLevel = "medium";
      reasoning = "Strong upward trend expected with high confidence. Consider accumulating positions over 7-10 days.";
    } else if (priceChange < -0.05 && avgConfidence > 0.8) {
      action = "sell";
      riskLevel = "medium";
      reasoning = "Significant downward trend expected. Consider reducing exposure or hedging positions.";
    } else {
      action = "hold";
      riskLevel = "low";
      reasoning = "Price movements within normal range. Monitor for trend confirmation.";
    }

    const recommendation: InsertTradingRecommendation = {
      forecastId: forecastRunId,
      action,
      confidence: avgConfidence.toString(),
      entryPrice: firstPrediction.q10.toString(),
      targetPrice: lastPrediction.median.toString(),
      stopLoss: (firstPrediction.median * 0.95).toString(), // 5% stop loss
      riskLevel,
      reasoning,
      metadata: {
        priceChange: priceChange * 100,
        horizonDays: predictions.length,
        volatility: (lastPrediction.q90 - lastPrediction.q10) / lastPrediction.median
      }
    };

    await storage.createRecommendation(recommendation);
  }
}

export const forecastService = new ForecastService();
