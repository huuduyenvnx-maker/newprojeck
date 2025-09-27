/**
 * Core Rate Limiting Middleware for Vietnamese Agricultural Intelligence Platform
 * 
 * Implements hybrid token bucket + sliding window algorithm with Vietnamese market context.
 * Features:
 * - Per-user and per-IP rate limiting with endpoint-specific rules
 * - Burst allowance and soft start for rural connectivity patterns
 * - Standard rate limit headers with Vietnamese localized responses
 * - LRU cache with garbage collection for memory management
 * - Integration with health monitoring and structured logging
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { llmHealthMonitor } from '../services/llm-health-monitor';

// Extended Request interface for rate limiting context
export interface RateLimitedRequest extends Request {
  userId?: string;
  userRole?: 'admin' | 'user' | 'analyst' | 'internal';
  isAuthenticated?: boolean;
  requestId: string;
  routeId: string;
  rateLimitKey: string;
}

// Rate limit bucket state
interface TokenBucket {
  tokens: number;
  capacity: number;
  refillRate: number; // tokens per second
  lastRefill: number;
  burstTokens: number; // additional burst capacity
  softStartUsed: number; // track soft start usage
}

// Sliding window counter for fairness
interface SlidingWindow {
  requests: number[];
  windowStart: number;
  windowSize: number; // in milliseconds
}

// Combined rate limit state
interface RateLimitState {
  bucket: TokenBucket;
  window: SlidingWindow;
  violations: number;
  lastRequest: number;
  metadata: {
    keyType: 'user' | 'ip' | 'internal';
    endpoint: string;
    policyId: string;
    firstSeen: number;
  };
}

// LRU cache node for memory management
interface LRUNode {
  key: string;
  value: RateLimitState;
  prev?: LRUNode;
  next?: LRUNode;
  accessTime: number;
}

// Rate limit policy configuration
export interface RateLimitPolicy {
  id: string;
  description: string;
  
  // Token bucket parameters
  capacity: number; // max tokens
  refillRate: number; // tokens per second
  burstAllowance: number; // extra tokens for bursts
  
  // Sliding window parameters
  windowSize: number; // in milliseconds
  maxRequests: number; // max requests per window
  
  // Rural connectivity support
  softStartRequests: number; // allow N extra requests initially
  softStartWindow: number; // time window for soft start (ms)
  
  // Role-based modifiers
  roleModifiers: {
    admin: number; // multiplier for admin users
    analyst: number; // multiplier for analyst users
    user: number; // base rate (1.0)
    internal: number; // multiplier for internal services
  };
  
  // Vietnamese market context
  ruralFriendly: boolean; // enable extra leniency
  cooperativeMode: boolean; // allow shared IP usage
}

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  headers: Record<string, string>;
  reason?: string;
  policyId: string;
  keyType: 'user' | 'ip' | 'internal';
  burstUsed: boolean;
  softStartUsed: boolean;
  
  // Metrics for monitoring
  metrics: {
    tokensConsumed: number;
    windowRequests: number;
    violationCount: number;
    responseTime: number;
  };
}

/**
 * LRU Cache for rate limit states with automatic garbage collection
 */
class RateLimitCache {
  private capacity: number;
  private cache = new Map<string, LRUNode>();
  private head: LRUNode;
  private tail: LRUNode;
  private lastCleanup = Date.now();
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute
  private readonly MAX_AGE = 600000; // 10 minutes

  constructor(capacity = 10000) {
    this.capacity = capacity;
    
    // Initialize dummy head and tail
    this.head = { key: '', value: null as any, accessTime: 0 };
    this.tail = { key: '', value: null as any, accessTime: 0 };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: string): RateLimitState | null {
    const node = this.cache.get(key);
    if (!node) return null;

    // Move to head (most recently used)
    this.moveToHead(node);
    node.accessTime = Date.now();
    
    // Periodic cleanup
    this.maybeCleanup();
    
    return node.value;
  }

  set(key: string, value: RateLimitState): void {
    const existing = this.cache.get(key);
    
    if (existing) {
      existing.value = value;
      existing.accessTime = Date.now();
      this.moveToHead(existing);
      return;
    }

    const newNode: LRUNode = {
      key,
      value,
      accessTime: Date.now()
    };

    this.cache.set(key, newNode);
    this.addToHead(newNode);

    if (this.cache.size > this.capacity) {
      const tail = this.removeTail();
      if (tail) {
        this.cache.delete(tail.key);
      }
    }
  }

  private moveToHead(node: LRUNode): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private addToHead(node: LRUNode): void {
    node.prev = this.head;
    node.next = this.head.next;
    if (this.head.next) this.head.next.prev = node;
    this.head.next = node;
  }

  private removeNode(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
  }

  private removeTail(): LRUNode | null {
    const lastNode = this.tail.prev;
    if (lastNode && lastNode !== this.head) {
      this.removeNode(lastNode);
      return lastNode;
    }
    return null;
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.CLEANUP_INTERVAL) return;

    this.lastCleanup = now;
    const cutoff = now - this.MAX_AGE;
    const toDelete: string[] = [];

    this.cache.forEach((node, key) => {
      if (node.accessTime < cutoff) {
        toDelete.push(key);
      }
    });

    toDelete.forEach(key => {
      const node = this.cache.get(key);
      if (node) {
        this.removeNode(node);
        this.cache.delete(key);
      }
    });

    if (toDelete.length > 0) {
      console.log(`[RateLimit] Cleaned up ${toDelete.length} expired entries`);
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      hitRate: 0, // Would need to track hits/misses for accurate calculation
      lastCleanup: this.lastCleanup
    };
  }
}

/**
 * Core Rate Limiter with Hybrid Algorithm
 */
class RateLimiter {
  private cache = new RateLimitCache(10000);
  private policies = new Map<string, RateLimitPolicy>();
  private defaultPolicy: RateLimitPolicy;
  private metricsCollector = new RateLimitMetrics();

  constructor() {
    this.defaultPolicy = this.createDefaultPolicy();
    this.initializeCleanupInterval();
  }

  /**
   * Register a rate limiting policy
   */
  registerPolicy(routePattern: string, policy: RateLimitPolicy): void {
    this.policies.set(routePattern, policy);
    console.log(`[RateLimit] Registered policy '${policy.id}' for route '${routePattern}'`);
  }

  /**
   * Check if request should be rate limited
   */
  checkRateLimit(
    key: string,
    policy: RateLimitPolicy,
    userRole: string = 'user',
    metadata: any = {}
  ): RateLimitResult {
    const startTime = Date.now();
    const state = this.getOrCreateState(key, policy, metadata);
    
    // Apply role-based modifiers
    const roleMultiplier = policy.roleModifiers[userRole as keyof typeof policy.roleModifiers] || 1.0;
    const adjustedPolicy = this.adjustPolicyForRole(policy, roleMultiplier);
    
    // Refill token bucket
    this.refillBucket(state.bucket, adjustedPolicy);
    
    // Check sliding window
    const windowAllowed = this.checkSlidingWindow(state.window, adjustedPolicy);
    
    // Check token bucket
    const bucketResult = this.checkTokenBucket(state.bucket, adjustedPolicy, state);
    
    // Combine results
    const allowed = windowAllowed.allowed && bucketResult.allowed;
    const remaining = Math.min(windowAllowed.remaining, bucketResult.remaining);
    const resetTime = Math.max(windowAllowed.resetTime, bucketResult.resetTime);
    
    // Update violation counter
    if (!allowed) {
      state.violations++;
    } else {
      state.violations = Math.max(0, state.violations - 1);
    }
    
    state.lastRequest = Date.now();

    // Generate result
    const result: RateLimitResult = {
      allowed,
      remaining,
      resetTime,
      retryAfter: allowed ? undefined : Math.ceil((resetTime - Date.now()) / 1000),
      headers: this.generateHeaders(allowed, remaining, resetTime, state.violations),
      policyId: policy.id,
      keyType: state.metadata.keyType,
      burstUsed: bucketResult.burstUsed,
      softStartUsed: bucketResult.softStartUsed,
      reason: allowed ? undefined : this.determineReason(windowAllowed, bucketResult),
      metrics: {
        tokensConsumed: bucketResult.tokensConsumed,
        windowRequests: state.window.requests.length,
        violationCount: state.violations,
        responseTime: Date.now() - startTime
      }
    };

    // Record metrics
    this.metricsCollector.recordRequest(result, policy, userRole);
    
    return result;
  }

  /**
   * Get rate limiting statistics
   */
  getStats() {
    return {
      cache: this.cache.getStats(),
      metrics: this.metricsCollector.getStats(),
      policies: Array.from(this.policies.keys())
    };
  }

  private getOrCreateState(key: string, policy: RateLimitPolicy, metadata: any): RateLimitState {
    let state = this.cache.get(key);
    
    if (!state) {
      state = {
        bucket: {
          tokens: policy.capacity,
          capacity: policy.capacity,
          refillRate: policy.refillRate,
          lastRefill: Date.now(),
          burstTokens: policy.burstAllowance,
          softStartUsed: 0
        },
        window: {
          requests: [],
          windowStart: Date.now(),
          windowSize: policy.windowSize
        },
        violations: 0,
        lastRequest: Date.now(),
        metadata: {
          keyType: metadata.keyType || 'ip',
          endpoint: metadata.endpoint || '',
          policyId: policy.id,
          firstSeen: Date.now()
        }
      };
      
      this.cache.set(key, state);
    }
    
    return state;
  }

  private refillBucket(bucket: TokenBucket, policy: RateLimitPolicy): void {
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000; // in seconds
    const tokensToAdd = timePassed * bucket.refillRate;
    
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  private checkSlidingWindow(window: SlidingWindow, policy: RateLimitPolicy): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
  } {
    const now = Date.now();
    const windowStart = now - window.windowSize;
    
    // Remove old requests
    window.requests = window.requests.filter(timestamp => timestamp > windowStart);
    
    const remaining = Math.max(0, policy.maxRequests - window.requests.length);
    const allowed = window.requests.length < policy.maxRequests;
    
    if (allowed) {
      window.requests.push(now);
    }
    
    const resetTime = now + window.windowSize;
    
    return { allowed, remaining, resetTime };
  }

  private checkTokenBucket(bucket: TokenBucket, policy: RateLimitPolicy, state: RateLimitState): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    tokensConsumed: number;
    burstUsed: boolean;
    softStartUsed: boolean;
  } {
    const now = Date.now();
    let tokensConsumed = 1;
    let burstUsed = false;
    let softStartUsed = false;
    
    // Check if we can use soft start
    const timeSinceFirstSeen = now - state.metadata.firstSeen;
    const canUseSoftStart = policy.ruralFriendly && 
                           timeSinceFirstSeen < policy.softStartWindow && 
                           bucket.softStartUsed < policy.softStartRequests;
    
    if (bucket.tokens >= tokensConsumed) {
      // Normal consumption
      bucket.tokens -= tokensConsumed;
    } else if (bucket.burstTokens > 0 && policy.burstAllowance > 0) {
      // Use burst tokens
      const needed = tokensConsumed - bucket.tokens;
      if (bucket.burstTokens >= needed) {
        bucket.tokens = 0;
        bucket.burstTokens -= needed;
        burstUsed = true;
      } else if (canUseSoftStart) {
        // Use soft start as last resort
        bucket.tokens = 0;
        bucket.burstTokens = 0;
        bucket.softStartUsed++;
        softStartUsed = true;
      } else {
        // Not allowed
        const timeToRefill = (tokensConsumed - bucket.tokens) / bucket.refillRate * 1000;
        return {
          allowed: false,
          remaining: Math.floor(bucket.tokens),
          resetTime: now + timeToRefill,
          tokensConsumed: 0,
          burstUsed: false,
          softStartUsed: false
        };
      }
    } else if (canUseSoftStart) {
      // Use soft start
      bucket.softStartUsed++;
      softStartUsed = true;
    } else {
      // Not allowed
      const timeToRefill = tokensConsumed / bucket.refillRate * 1000;
      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        resetTime: now + timeToRefill,
        tokensConsumed: 0,
        burstUsed: false,
        softStartUsed: false
      };
    }
    
    // Gradually refill burst tokens
    if (bucket.burstTokens < policy.burstAllowance) {
      bucket.burstTokens = Math.min(
        policy.burstAllowance,
        bucket.burstTokens + bucket.refillRate * 0.1 // Slow refill for burst
      );
    }
    
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetTime: now + (bucket.capacity - bucket.tokens) / bucket.refillRate * 1000,
      tokensConsumed,
      burstUsed,
      softStartUsed
    };
  }

  private adjustPolicyForRole(policy: RateLimitPolicy, multiplier: number): RateLimitPolicy {
    if (multiplier === 1.0) return policy;
    
    return {
      ...policy,
      capacity: Math.floor(policy.capacity * multiplier),
      refillRate: policy.refillRate * multiplier,
      maxRequests: Math.floor(policy.maxRequests * multiplier),
      burstAllowance: Math.floor(policy.burstAllowance * multiplier)
    };
  }

  private generateHeaders(allowed: boolean, remaining: number, resetTime: number, violations: number): Record<string, string> {
    const headers: Record<string, string> = {
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
    };
    
    if (!allowed) {
      headers['Retry-After'] = Math.ceil((resetTime - Date.now()) / 1000).toString();
      headers['X-RateLimit-Violations'] = violations.toString();
    }
    
    return headers;
  }

  private determineReason(windowResult: any, bucketResult: any): string {
    if (!windowResult.allowed) {
      return 'REQUEST_WINDOW_EXCEEDED';
    }
    if (!bucketResult.allowed) {
      return 'TOKEN_BUCKET_EXHAUSTED';
    }
    return 'RATE_LIMIT_EXCEEDED';
  }

  private createDefaultPolicy(): RateLimitPolicy {
    return {
      id: 'default',
      description: 'Default rate limiting policy',
      capacity: 60,
      refillRate: 1, // 1 token per second = 60 per minute
      burstAllowance: 10,
      windowSize: 60000, // 1 minute
      maxRequests: 60,
      softStartRequests: 5,
      softStartWindow: 60000,
      roleModifiers: {
        admin: 2.0,
        analyst: 1.5,
        user: 1.0,
        internal: 10.0
      },
      ruralFriendly: true,
      cooperativeMode: true
    };
  }

  private initializeCleanupInterval(): void {
    setInterval(() => {
      const stats = this.cache.getStats();
      console.log(`[RateLimit] Cache stats: ${stats.size}/${stats.capacity} entries`);
      
      // Record cache metrics to health monitor
      llmHealthMonitor.recordCacheMetrics('hit', undefined, stats.size);
    }, 300000); // Every 5 minutes
  }
}

/**
 * Metrics collector for rate limiting
 */
class RateLimitMetrics {
  private counters = {
    requests_total: 0,
    requests_allowed: 0,
    requests_blocked: 0,
    burst_used: 0,
    soft_start_used: 0
  };
  
  private histograms: { [key: string]: number[] } = {
    response_time: [],
    remaining_tokens: []
  };

  private by_endpoint: { [key: string]: any } = {};
  private by_role: { [key: string]: any } = {};

  recordRequest(result: RateLimitResult, policy: RateLimitPolicy, role: string): void {
    this.counters.requests_total++;
    
    if (result.allowed) {
      this.counters.requests_allowed++;
    } else {
      this.counters.requests_blocked++;
    }
    
    if (result.burstUsed) {
      this.counters.burst_used++;
    }
    
    if (result.softStartUsed) {
      this.counters.soft_start_used++;
    }
    
    // Record histograms
    this.histograms.response_time.push(result.metrics.responseTime);
    this.histograms.remaining_tokens.push(result.remaining);
    
    // Keep histograms bounded
    if (this.histograms.response_time.length > 1000) {
      this.histograms.response_time = this.histograms.response_time.slice(-500);
    }
    if (this.histograms.remaining_tokens.length > 1000) {
      this.histograms.remaining_tokens = this.histograms.remaining_tokens.slice(-500);
    }
    
    // Track by endpoint
    if (!this.by_endpoint[policy.id]) {
      this.by_endpoint[policy.id] = { allowed: 0, blocked: 0, total: 0 };
    }
    this.by_endpoint[policy.id].total++;
    this.by_endpoint[policy.id][result.allowed ? 'allowed' : 'blocked']++;
    
    // Track by role
    if (!this.by_role[role]) {
      this.by_role[role] = { allowed: 0, blocked: 0, total: 0 };
    }
    this.by_role[role].total++;
    this.by_role[role][result.allowed ? 'allowed' : 'blocked']++;
  }

  getStats() {
    const totalRequests = this.counters.requests_total;
    const blockRate = totalRequests > 0 ? this.counters.requests_blocked / totalRequests : 0;
    
    return {
      counters: { ...this.counters },
      rates: {
        block_rate: blockRate,
        success_rate: totalRequests > 0 ? this.counters.requests_allowed / totalRequests : 1,
        burst_usage_rate: totalRequests > 0 ? this.counters.burst_used / totalRequests : 0
      },
      by_endpoint: { ...this.by_endpoint },
      by_role: { ...this.by_role },
      performance: {
        avg_response_time: this.histograms.response_time.length > 0 
          ? this.histograms.response_time.reduce((a, b) => a + b) / this.histograms.response_time.length 
          : 0
      }
    };
  }
}

// Global rate limiter instance
const globalRateLimiter = new RateLimiter();

/**
 * Express middleware factory for rate limiting
 */
export function createRateLimitMiddleware(
  getPolicyFn: (req: RateLimitedRequest) => RateLimitPolicy
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rateLimitReq = req as RateLimitedRequest;
    const startTime = Date.now();
    
    try {
      // Extract request context
      rateLimitReq.requestId = rateLimitReq.requestId || crypto.randomBytes(8).toString('hex');
      rateLimitReq.routeId = `${req.method}:${req.route?.path || req.path}`;
      
      // Determine rate limiting key
      const keyType = rateLimitReq.isAuthenticated ? 'user' : 'ip';
      const keyValue = rateLimitReq.isAuthenticated 
        ? rateLimitReq.userId! 
        : req.ip || req.connection.remoteAddress || 'unknown';
      
      rateLimitReq.rateLimitKey = `${keyType}:${keyValue}:${rateLimitReq.routeId}`;
      
      // Get appropriate policy
      const policy = getPolicyFn(rateLimitReq);
      
      // Check rate limit
      const result = globalRateLimiter.checkRateLimit(
        rateLimitReq.rateLimitKey,
        policy,
        rateLimitReq.userRole || 'user',
        {
          keyType,
          endpoint: rateLimitReq.routeId,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        }
      );
      
      // Set standard headers
      Object.entries(result.headers).forEach(([key, value]) => {
        res.set(key, value);
      });
      
      res.set('X-RateLimit-Limit', policy.capacity.toString());
      res.set('X-RateLimit-Policy', policy.id);
      
      // Handle blocked request
      if (!result.allowed) {
        // Log structured warning
        console.warn('RATE_LIMIT_EXCEEDED:', JSON.stringify({
          timestamp: new Date().toISOString(),
          requestId: rateLimitReq.requestId,
          key: rateLimitReq.rateLimitKey,
          policyId: result.policyId,
          reason: result.reason,
          remaining: result.remaining,
          retryAfter: result.retryAfter,
          violations: result.metrics.violationCount,
          endpoint: rateLimitReq.routeId,
          userRole: rateLimitReq.userRole,
          ip: req.ip
        }));
        
        // Vietnamese localized error response
        const vietnameseMessage = getVietnameseErrorMessage(result.reason || 'RATE_LIMIT_EXCEEDED');
        
        res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          messageVietnamese: vietnameseMessage,
          error: result.reason || 'RATE_LIMIT_EXCEEDED',
          code: 'AGRI_RATE_LIMIT_001',
          retryAfter: result.retryAfter,
          rateLimitInfo: {
            remaining: result.remaining,
            resetTime: new Date(result.resetTime).toISOString(),
            policyId: result.policyId,
            keyType: result.keyType,
            burstUsed: result.burstUsed,
            softStartUsed: result.softStartUsed
          },
          guidance: {
            message: 'For rural connectivity issues, try reducing request frequency',
            messageVietnamese: 'Đối với vấn đề kết nối nông thôn, hãy thử giảm tần suất yêu cầu',
            backoffStrategy: 'exponential',
            suggestedDelay: Math.min(result.retryAfter || 60, 300) // Cap at 5 minutes
          }
        });
        
        return;
      }
      
      // Log successful request (debug level)
      if (process.env.NODE_ENV === 'development') {
        console.log('RATE_LIMIT_PASSED:', JSON.stringify({
          requestId: rateLimitReq.requestId,
          key: rateLimitReq.rateLimitKey,
          remaining: result.remaining,
          burstUsed: result.burstUsed,
          softStartUsed: result.softStartUsed,
          responseTime: Date.now() - startTime
        }));
      }
      
      next();
      
    } catch (error) {
      console.error('Rate limiting middleware error:', error);
      // In case of error, allow request to proceed but log the issue
      next();
    }
  };
}

/**
 * Get Vietnamese error message for rate limit reason
 */
function getVietnameseErrorMessage(reason: string): string {
  const messages: { [key: string]: string } = {
    'REQUEST_WINDOW_EXCEEDED': 'Đã vượt quá giới hạn số lượng yêu cầu trong khoảng thời gian cho phép',
    'TOKEN_BUCKET_EXHAUSTED': 'Đã hết token yêu cầu, vui lòng chờ một chút trước khi thử lại',
    'RATE_LIMIT_EXCEEDED': 'Đã vượt quá giới hạn tần suất yêu cầu, vui lòng chờ trước khi thử lại',
    'DDOS_PROTECTION': 'Phát hiện hoạt động bất thường, tạm thời hạn chế truy cập để bảo vệ hệ thống'
  };
  
  return messages[reason] || 'Đã vượt quá giới hạn yêu cầu, vui lòng thử lại sau';
}

export { globalRateLimiter, RateLimitPolicy, RateLimitResult };
export type { RateLimitedRequest };