import crypto from 'crypto';

// Circuit breaker states
enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing fast, not calling service
  HALF_OPEN = 'HALF_OPEN' // Testing service recovery
}

// Circuit breaker configuration
interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures to trip circuit
  recoveryTimeoutMs: number;     // Time to wait before testing recovery
  successThreshold: number;      // Successes needed in half-open to close
  monitoringWindowMs: number;    // Rolling window for failure tracking
  responseTimeThresholdMs: number; // Response time considered failure
  minimumRequestCount: number;   // Minimum requests before circuit can trip
}

// Provider-specific circuit breaker configurations
const PROVIDER_CONFIGS: Record<string, CircuitBreakerConfig> = {
  openai: {
    failureThreshold: 5,         // Trip after 5 consecutive failures
    recoveryTimeoutMs: 60000,    // 60 seconds recovery timeout
    successThreshold: 3,         // Need 3 successes to close from half-open
    monitoringWindowMs: 300000,  // 5 minute monitoring window
    responseTimeThresholdMs: 30000, // 30 second response time threshold
    minimumRequestCount: 3       // Need at least 3 requests to trip
  },
  gemini: {
    failureThreshold: 5,         // Trip after 5 consecutive failures
    recoveryTimeoutMs: 60000,    // 60 seconds recovery timeout
    successThreshold: 3,         // Need 3 successes to close from half-open
    monitoringWindowMs: 300000,  // 5 minute monitoring window
    responseTimeThresholdMs: 30000, // 30 second response time threshold
    minimumRequestCount: 3       // Need at least 3 requests to trip
  }
};

// Request metrics tracking
interface RequestMetrics {
  timestamp: number;
  success: boolean;
  responseTimeMs: number;
  error?: string;
  statusCode?: number;
}

// Circuit breaker statistics
interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  tripCount: number; // How many times circuit has tripped
  averageResponseTimeMs: number;
  failureRate: number; // Percentage 0-100
  uptime: number; // Percentage 0-100
  lastStateChange: number;
  recentRequests: RequestMetrics[];
}

// Health check result
interface HealthCheckResult {
  provider: string;
  healthy: boolean;
  circuitState: CircuitState;
  responseTimeMs?: number;
  lastCheck: number;
  error?: string;
  stats: CircuitBreakerStats;
}

class CircuitBreaker {
  private provider: string;
  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  
  // Failure tracking
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private lastStateChange = Date.now();
  private tripCount = 0;
  
  // Request tracking for statistics
  private recentRequests: RequestMetrics[] = [];
  private requestId = 0;

  constructor(provider: string, customConfig?: Partial<CircuitBreakerConfig>) {
    this.provider = provider;
    this.config = { ...PROVIDER_CONFIGS[provider], ...customConfig };
    console.log(`[CircuitBreaker:${provider}] Initialized with config:`, this.config);
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
    operationName = 'operation'
  ): Promise<T> {
    const requestId = `${this.provider}-${++this.requestId}`;
    const startTime = Date.now();

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.recoveryTimeoutMs) {
        console.log(`[CircuitBreaker:${this.provider}] Circuit OPEN, failing fast for ${operationName}`);
        
        if (fallback) {
          console.log(`[CircuitBreaker:${this.provider}] Using fallback for ${operationName}`);
          return await fallback();
        } else {
          throw new Error(`Circuit breaker is OPEN for ${this.provider}. Service unavailable. Next test in ${Math.round((this.config.recoveryTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s`);
        }
      } else {
        // Transition to half-open for testing
        console.log(`[CircuitBreaker:${this.provider}] Transitioning to HALF_OPEN for recovery test`);
        this.transitionToHalfOpen();
      }
    }

    try {
      console.log(`[CircuitBreaker:${this.provider}] Executing ${operationName} (${requestId})`);
      const result = await operation();
      const responseTime = Date.now() - startTime;
      
      this.recordSuccess(responseTime, operationName);
      console.log(`[CircuitBreaker:${this.provider}] Success for ${operationName} (${responseTime}ms)`);
      
      return result;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.recordFailure(error, responseTime, operationName);
      
      console.log(`[CircuitBreaker:${this.provider}] Failure for ${operationName} (${responseTime}ms):`, error.message);
      
      // If circuit is now open and fallback is available, use it
      if (this.state === CircuitState.OPEN && fallback) {
        console.log(`[CircuitBreaker:${this.provider}] Circuit tripped, using fallback for ${operationName}`);
        return await fallback();
      }
      
      throw error;
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(responseTimeMs: number, operation: string): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = Date.now();
    
    // Check for slow responses
    const isSlow = responseTimeMs > this.config.responseTimeThresholdMs;
    
    this.addRequestMetric({
      timestamp: Date.now(),
      success: !isSlow, // Slow responses are considered failures
      responseTimeMs,
      error: isSlow ? `Slow response (${responseTimeMs}ms > ${this.config.responseTimeThresholdMs}ms)` : undefined
    });

    if (isSlow) {
      console.log(`[CircuitBreaker:${this.provider}] Slow response detected for ${operation}: ${responseTimeMs}ms`);
      this.consecutiveFailures = 1; // Treat slow response as failure
      return;
    }

    // State transitions based on success
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        console.log(`[CircuitBreaker:${this.provider}] Closing circuit after ${this.consecutiveSuccesses} successful half-open requests`);
        this.transitionToClosed();
      }
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(error: any, responseTimeMs: number, operation: string): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    
    const statusCode = error?.response?.status || error?.status || error?.statusCode;
    
    this.addRequestMetric({
      timestamp: Date.now(),
      success: false,
      responseTimeMs,
      error: error.message,
      statusCode
    });

    // Check if we should trip the circuit
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      if (this.shouldTripCircuit()) {
        console.log(`[CircuitBreaker:${this.provider}] Tripping circuit after ${this.consecutiveFailures} consecutive failures`);
        this.transitionToOpen();
      }
    }
  }

  /**
   * Determine if circuit should trip based on failure patterns
   */
  private shouldTripCircuit(): boolean {
    // Need minimum requests before tripping
    if (this.recentRequests.length < this.config.minimumRequestCount) {
      return false;
    }
    
    // Trip on consecutive failures
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }
    
    // Trip on high failure rate in monitoring window
    const now = Date.now();
    const windowRequests = this.recentRequests.filter(
      r => now - r.timestamp <= this.config.monitoringWindowMs
    );
    
    if (windowRequests.length >= this.config.minimumRequestCount) {
      const failures = windowRequests.filter(r => !r.success).length;
      const failureRate = failures / windowRequests.length;
      
      if (failureRate >= (this.config.failureThreshold / (this.config.failureThreshold + 1))) {
        console.log(`[CircuitBreaker:${this.provider}] High failure rate detected: ${(failureRate * 100).toFixed(1)}%`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Add request metric and maintain sliding window
   */
  private addRequestMetric(metric: RequestMetrics): void {
    this.recentRequests.push(metric);
    
    // Keep only recent requests (sliding window)
    const cutoff = Date.now() - this.config.monitoringWindowMs;
    this.recentRequests = this.recentRequests.filter(r => r.timestamp > cutoff);
    
    // Limit memory usage - keep max 1000 recent requests
    if (this.recentRequests.length > 1000) {
      this.recentRequests = this.recentRequests.slice(-1000);
    }
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastStateChange = Date.now();
    console.log(`[CircuitBreaker:${this.provider}] Circuit CLOSED - normal operation resumed`);
  }

  /**
   * Transition to OPEN state  
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.consecutiveSuccesses = 0;
    this.tripCount++;
    this.lastStateChange = Date.now();
    console.log(`[CircuitBreaker:${this.provider}] Circuit OPEN - failing fast (trip #${this.tripCount})`);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
    console.log(`[CircuitBreaker:${this.provider}] Circuit HALF_OPEN - testing service recovery`);
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    const now = Date.now();
    const windowRequests = this.recentRequests.filter(
      r => now - r.timestamp <= this.config.monitoringWindowMs
    );
    
    const totalRequests = windowRequests.length;
    const failures = windowRequests.filter(r => !r.success).length;
    const successes = totalRequests - failures;
    const failureRate = totalRequests > 0 ? (failures / totalRequests) * 100 : 0;
    const uptime = totalRequests > 0 ? (successes / totalRequests) * 100 : 100;
    
    const avgResponseTime = windowRequests.length > 0 
      ? windowRequests.reduce((sum, r) => sum + r.responseTimeMs, 0) / windowRequests.length
      : 0;

    return {
      state: this.state,
      failureCount: this.consecutiveFailures,
      successCount: this.consecutiveSuccesses,
      totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      tripCount: this.tripCount,
      averageResponseTimeMs: Math.round(avgResponseTime),
      failureRate: Math.round(failureRate * 100) / 100,
      uptime: Math.round(uptime * 100) / 100,
      lastStateChange: this.lastStateChange,
      recentRequests: windowRequests.slice(-10) // Last 10 requests
    };
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const stats = this.getStats();
    
    try {
      // Simple health check - just test circuit state
      let healthy = this.state !== CircuitState.OPEN;
      
      // Additional health criteria
      if (healthy) {
        healthy = stats.failureRate < 50; // Less than 50% failure rate
        healthy = healthy && (stats.averageResponseTimeMs < this.config.responseTimeThresholdMs || stats.totalRequests === 0);
      }

      return {
        provider: this.provider,
        healthy,
        circuitState: this.state,
        responseTimeMs: Date.now() - startTime,
        lastCheck: Date.now(),
        stats
      };
      
    } catch (error) {
      return {
        provider: this.provider,
        healthy: false,
        circuitState: this.state,
        responseTimeMs: Date.now() - startTime,
        lastCheck: Date.now(),
        error: error.message,
        stats
      };
    }
  }

  /**
   * Force reset circuit breaker (for testing/admin purposes)
   */
  reset(): void {
    console.log(`[CircuitBreaker:${this.provider}] Manual reset triggered`);
    this.transitionToClosed();
    this.recentRequests = [];
    this.tripCount = 0;
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if circuit allows requests
   */
  isCallAllowed(): boolean {
    if (this.state === CircuitState.OPEN) {
      // Allow call if recovery timeout has passed
      return Date.now() - this.lastFailureTime >= this.config.recoveryTimeoutMs;
    }
    return true; // CLOSED and HALF_OPEN allow calls
  }
}

/**
 * Circuit Breaker Manager - manages multiple circuit breakers
 */
class CircuitBreakerManager {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  
  constructor() {
    // Initialize circuit breakers for LLM providers
    this.initializeProvider('openai');
    this.initializeProvider('gemini');
  }

  private initializeProvider(provider: string): void {
    if (!this.circuitBreakers.has(provider)) {
      const circuitBreaker = new CircuitBreaker(provider);
      this.circuitBreakers.set(provider, circuitBreaker);
      console.log(`[CircuitBreakerManager] Initialized circuit breaker for ${provider}`);
    }
  }

  getCircuitBreaker(provider: string): CircuitBreaker {
    if (!this.circuitBreakers.has(provider)) {
      throw new Error(`Circuit breaker not found for provider: ${provider}`);
    }
    return this.circuitBreakers.get(provider)!;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    provider: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>,
    operationName = 'operation'
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(provider);
    return await circuitBreaker.execute(operation, fallback, operationName);
  }

  /**
   * Get health status for all circuit breakers
   */
  async getHealthStatus(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    for (const [provider, circuitBreaker] of this.circuitBreakers) {
      const healthResult = await circuitBreaker.healthCheck();
      results.push(healthResult);
    }
    
    return results;
  }

  /**
   * Get overall system health summary
   */
  async getSystemHealth(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    providers: HealthCheckResult[];
    availableProviders: string[];
    degradedProviders: string[];
    failedProviders: string[];
  }> {
    const providers = await this.getHealthStatus();
    const availableProviders = providers.filter(p => p.healthy).map(p => p.provider);
    const degradedProviders = providers.filter(p => !p.healthy && p.circuitState === CircuitState.HALF_OPEN).map(p => p.provider);
    const failedProviders = providers.filter(p => !p.healthy && p.circuitState === CircuitState.OPEN).map(p => p.provider);
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (availableProviders.length === providers.length) {
      overall = 'healthy';
    } else if (availableProviders.length > 0) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }

    return {
      overall,
      providers,
      availableProviders,
      degradedProviders,
      failedProviders
    };
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    console.log('[CircuitBreakerManager] Resetting all circuit breakers');
    for (const circuitBreaker of this.circuitBreakers.values()) {
      circuitBreaker.reset();
    }
  }

  /**
   * Reset specific circuit breaker
   */
  reset(provider: string): void {
    const circuitBreaker = this.circuitBreakers.get(provider);
    if (circuitBreaker) {
      circuitBreaker.reset();
    } else {
      throw new Error(`Circuit breaker not found for provider: ${provider}`);
    }
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();
export { CircuitBreaker, CircuitState, type CircuitBreakerConfig, type CircuitBreakerStats, type HealthCheckResult };