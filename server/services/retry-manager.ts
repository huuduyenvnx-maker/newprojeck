import crypto from 'crypto';

// Retry configuration for different API providers
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;      // Starting delay (1000ms = 1s)
  maxDelayMs: number;       // Maximum delay cap (64000ms = 64s)
  jitterFactor: number;     // 0.1 = 10% jitter
  backoffMultiplier: number; // 2.0 for doubling
  timeoutMs: number;        // Request timeout
  rateLimitAware: boolean;  // Handle rate limit errors specially
}

// Provider-specific configurations
const PROVIDER_CONFIGS: Record<string, RetryConfig> = {
  openai: {
    maxAttempts: 3,
    baseDelayMs: 1000,      // 1s, 2s, 4s, 8s sequence
    maxDelayMs: 16000,      // Cap at 16s
    jitterFactor: 0.15,     // 15% jitter
    backoffMultiplier: 2.0,
    timeoutMs: 60000,       // 60s timeout
    rateLimitAware: true
  },
  gemini: {
    maxAttempts: 3,
    baseDelayMs: 1000,      // 1s, 2s, 4s, 8s sequence  
    maxDelayMs: 16000,      // Cap at 16s
    jitterFactor: 0.15,     // 15% jitter
    backoffMultiplier: 2.0,
    timeoutMs: 60000,       // 60s timeout
    rateLimitAware: true
  }
};

// Error classification for retry decisions
interface ErrorClassification {
  isRetryable: boolean;
  isRateLimited: boolean;
  isTimeout: boolean;
  isServerError: boolean;
  category: 'rate_limit' | 'timeout' | 'server_error' | 'client_error' | 'network_error' | 'unknown';
  retryAfter?: number; // Seconds from Retry-After header
  statusCode?: number;
}

// Retry attempt metadata
interface RetryAttempt {
  attemptNumber: number;
  delayMs: number;
  error?: any;
  timestamp: number;
  provider: string;
  operation: string;
}

// Comprehensive retry result
interface RetryResult<T> {
  success: boolean;
  result?: T;
  finalError?: any;
  attempts: RetryAttempt[];
  totalDurationMs: number;
  exhausted: boolean;
}

class RetryManager {
  private requestId: string;
  
  constructor(requestId?: string) {
    this.requestId = requestId || this.generateRequestId();
  }

  private generateRequestId(): string {
    return `retry_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Execute operation with exponential backoff and jitter
   */
  async executeWithRetry<T>(
    provider: string,
    operation: string,
    fn: () => Promise<T>,
    customConfig?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const config = { ...PROVIDER_CONFIGS[provider], ...customConfig };
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();
    let lastError: any;

    console.log(`[${this.requestId}] Starting ${provider} ${operation} with retry (max ${config.maxAttempts} attempts)`);

    for (let attemptNum = 1; attemptNum <= config.maxAttempts; attemptNum++) {
      const attemptStart = Date.now();
      
      try {
        console.log(`[${this.requestId}] ${provider} ${operation} attempt ${attemptNum}/${config.maxAttempts}`);
        
        // Execute with timeout wrapper
        const result = await this.executeWithTimeout(fn, config.timeoutMs);
        
        // Success - log and return
        const attempt: RetryAttempt = {
          attemptNumber: attemptNum,
          delayMs: 0,
          timestamp: attemptStart,
          provider,
          operation
        };
        attempts.push(attempt);

        console.log(`[${this.requestId}] ${provider} ${operation} succeeded on attempt ${attemptNum} (${Date.now() - attemptStart}ms)`);
        
        return {
          success: true,
          result,
          attempts,
          totalDurationMs: Date.now() - startTime,
          exhausted: false
        };

      } catch (error) {
        lastError = error;
        const errorClassification = this.classifyError(error, provider);
        
        // Log attempt details
        const delayMs = attemptNum < config.maxAttempts ? this.calculateDelay(attemptNum, config, errorClassification) : 0;
        const attempt: RetryAttempt = {
          attemptNumber: attemptNum,
          delayMs,
          error: this.serializeError(error),
          timestamp: attemptStart,
          provider,
          operation
        };
        attempts.push(attempt);

        console.log(`[${this.requestId}] ${provider} ${operation} attempt ${attemptNum} failed:`, {
          category: errorClassification.category,
          retryable: errorClassification.isRetryable,
          statusCode: errorClassification.statusCode,
          delayMs,
          duration: Date.now() - attemptStart
        });

        // Check if we should retry
        if (attemptNum >= config.maxAttempts) {
          console.log(`[${this.requestId}] ${provider} ${operation} exhausted all ${config.maxAttempts} attempts`);
          break;
        }

        if (!errorClassification.isRetryable) {
          console.log(`[${this.requestId}] ${provider} ${operation} non-retryable error, aborting retries`);
          break;
        }

        // Wait before next attempt
        if (delayMs > 0) {
          console.log(`[${this.requestId}] ${provider} ${operation} waiting ${delayMs}ms before attempt ${attemptNum + 1}`);
          await this.sleep(delayMs);
        }
      }
    }

    // All attempts failed
    return {
      success: false,
      finalError: lastError,
      attempts,
      totalDurationMs: Date.now() - startTime,
      exhausted: true
    };
  }

  /**
   * Classify error for retry decision making
   */
  private classifyError(error: any, provider: string): ErrorClassification {
    const statusCode = error?.response?.status || error?.status || error?.statusCode;
    const message = error?.message || '';
    const responseData = error?.response?.data || {};

    // OpenAI specific error handling
    if (provider === 'openai') {
      if (statusCode === 429) {
        const retryAfter = this.parseRetryAfter(error?.response?.headers?.['retry-after']);
        return {
          isRetryable: true,
          isRateLimited: true,
          isTimeout: false,
          isServerError: false,
          category: 'rate_limit',
          retryAfter,
          statusCode
        };
      }
      
      if (statusCode >= 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
        return {
          isRetryable: true,
          isRateLimited: false,
          isTimeout: false,
          isServerError: true,
          category: 'server_error',
          statusCode
        };
      }
      
      if (message.includes('timeout') || statusCode === 408) {
        return {
          isRetryable: true,
          isRateLimited: false,
          isTimeout: true,
          isServerError: false,
          category: 'timeout',
          statusCode
        };
      }
    }

    // Gemini specific error handling
    if (provider === 'gemini') {
      if (statusCode === 429 || message.includes('RATE_LIMIT_EXCEEDED')) {
        const retryAfter = this.parseRetryAfter(error?.response?.headers?.['retry-after']);
        return {
          isRetryable: true,
          isRateLimited: true,
          isTimeout: false,
          isServerError: false,
          category: 'rate_limit',
          retryAfter,
          statusCode
        };
      }

      if (statusCode >= 500 || message.includes('INTERNAL') || message.includes('UNAVAILABLE')) {
        return {
          isRetryable: true,
          isRateLimited: false,
          isTimeout: false,
          isServerError: true,
          category: 'server_error',
          statusCode
        };
      }

      if (message.includes('timeout') || message.includes('DEADLINE_EXCEEDED')) {
        return {
          isRetryable: true,
          isRateLimited: false,
          isTimeout: true,
          isServerError: false,
          category: 'timeout',
          statusCode
        };
      }
    }

    // Network errors (ECONNRESET, ENOTFOUND, etc.)
    if (message.includes('ECONNRESET') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT')) {
      return {
        isRetryable: true,
        isRateLimited: false,
        isTimeout: false,
        isServerError: false,
        category: 'network_error',
        statusCode
      };
    }

    // Client errors (4xx except 429) are typically not retryable
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return {
        isRetryable: false,
        isRateLimited: false,
        isTimeout: false,
        isServerError: false,
        category: 'client_error',
        statusCode
      };
    }

    // Default to retryable for unknown errors
    return {
      isRetryable: true,
      isRateLimited: false,
      isTimeout: false,
      isServerError: false,
      category: 'unknown',
      statusCode
    };
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attemptNumber: number, config: RetryConfig, errorClassification: ErrorClassification): number {
    // Use Retry-After header for rate limits if available
    if (errorClassification.isRateLimited && errorClassification.retryAfter) {
      const retryAfterMs = errorClassification.retryAfter * 1000;
      // Add some jitter to avoid thundering herd
      const jitter = retryAfterMs * config.jitterFactor * (Math.random() - 0.5);
      return Math.min(retryAfterMs + jitter, config.maxDelayMs);
    }

    // Standard exponential backoff: baseDelay * (multiplier ^ (attempt - 1))
    const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 1);
    
    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    
    // Add jitter: ±(jitterFactor * delay)
    const jitter = cappedDelay * config.jitterFactor * (Math.random() - 0.5);
    const finalDelay = Math.max(0, cappedDelay + jitter);
    
    return Math.round(finalDelay);
  }

  /**
   * Parse Retry-After header (seconds or HTTP date)
   */
  private parseRetryAfter(retryAfter: string | undefined): number | undefined {
    if (!retryAfter) return undefined;
    
    // If it's a number, it's seconds
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds;
    }
    
    // If it's a date, calculate seconds from now
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
    }
    
    return undefined;
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([fn(), timeoutPromise]);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Serialize error for logging (avoid circular references)
   */
  private serializeError(error: any): any {
    return {
      message: error?.message,
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 3), // First 3 lines only
      statusCode: error?.response?.status || error?.status || error?.statusCode,
      response: error?.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : undefined
    };
  }

  /**
   * Get retry metrics for monitoring
   */
  getRetryMetrics(result: RetryResult<any>): {
    totalAttempts: number;
    totalDurationMs: number;
    averageAttemptDurationMs: number;
    successRate: number;
    finalOutcome: 'success' | 'exhausted' | 'non_retryable';
  } {
    const totalAttempts = result.attempts.length;
    const totalDurationMs = result.totalDurationMs;
    const averageAttemptDurationMs = totalAttempts > 0 ? totalDurationMs / totalAttempts : 0;
    const successRate = result.success ? 1 : 0;
    
    let finalOutcome: 'success' | 'exhausted' | 'non_retryable';
    if (result.success) {
      finalOutcome = 'success';
    } else if (result.exhausted) {
      finalOutcome = 'exhausted';
    } else {
      finalOutcome = 'non_retryable';
    }

    return {
      totalAttempts,
      totalDurationMs,
      averageAttemptDurationMs,
      successRate,
      finalOutcome
    };
  }
}

export { RetryManager, type RetryConfig, type RetryResult, type RetryAttempt, type ErrorClassification };