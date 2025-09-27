/**
 * Global DDoS Protection Middleware for Vietnamese Agricultural Intelligence Platform
 * 
 * Provides system-wide protection against distributed attacks while maintaining
 * accessibility for legitimate Vietnamese agricultural users with rural connectivity.
 * 
 * Features:
 * - Global token bucket with surge mode detection
 * - Per-IP anomaly detection with progressive penalties
 * - Slow-down mode before full blocking
 * - Request timeout guards for POST endpoints
 * - Rural-friendly temporary bans with exponential backoff
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { llmHealthMonitor } from '../services/llm-health-monitor';

// DDoS Protection State Management
interface IPTrackingState {
  requestCount: number;
  errorCount: number;
  lastRequest: number;
  windowStart: number;
  violationHistory: number[]; // Timestamps of violations
  banExpiry: number;
  banLevel: number; // Progressive ban level (1, 2, 3...)
  slowDownUntil: number;
  requestTimes: number[]; // For burst detection
  metadata: {
    userAgent?: string;
    firstSeen: number;
    totalRequests: number;
    country?: string;
    isBot?: boolean;
  };
}

interface GlobalProtectionState {
  requestCount: number;
  capacity: number;
  lastRefill: number;
  surgeMode: boolean;
  surgeStartTime: number;
  totalBlocked: number;
  totalProcessed: number;
  systemUtilization: number;
}

interface DDoSMetrics {
  // Request counters
  requests_total: number;
  requests_allowed: number;
  requests_blocked: number;
  requests_slowed: number;
  
  // Ban metrics
  ips_banned_temporary: number;
  ips_banned_permanent: number;
  active_bans: number;
  
  // Surge mode metrics
  surge_mode_activations: number;
  surge_mode_duration: number;
  current_surge_mode: boolean;
  
  // Performance metrics
  avg_response_time: number;
  system_utilization: number;
  anomaly_detections: number;
}

/**
 * DDoS Guard Configuration
 */
const DDOS_CONFIG = {
  // Global protection settings
  GLOBAL: {
    capacity: 1000, // 1000 requests per minute baseline
    refillRate: 1000 / 60, // Refill rate in requests per second
    surgeThreshold: 0.8, // Enter surge mode at 80% capacity
    surgeModePenalty: 0.5, // Reduce capacity by 50% in surge mode
    surgeModeCooldown: 300000, // 5 minutes before exiting surge mode
    
    // Request timeout protection
    defaultTimeout: 30000, // 30 seconds default
    postTimeoutMultiplier: 2.0, // POST requests get 2x timeout
    heavyEndpointTimeout: 60000, // Forecast/LLM endpoints get 60s
  },
  
  // Per-IP anomaly detection
  PER_IP: {
    windowSize: 60000, // 1 minute window
    maxRequests: 200, // Max 200 requests per minute per IP
    errorRateThreshold: 0.5, // 50% error rate triggers investigation
    burstThreshold: 50, // 50 requests in 10 seconds triggers slowdown
    burstWindow: 10000, // 10 second burst detection window
    
    // Progressive banning
    banDurations: [300000, 600000, 1800000, 3600000], // 5min, 10min, 30min, 1hr
    maxBanLevel: 4,
    violationCooldown: 3600000, // 1 hour to cool down violation level
    
    // Slow-down mode
    slowdownDuration: 60000, // 1 minute slowdown
    slowdownDelay: 2000, // 2 second delay per request
  },
  
  // Rural connectivity accommodations
  RURAL_FRIENDLY: {
    enabled: true,
    softBanDuration: 120000, // 2 minute soft bans for first offense
    gracePeriodMultiplier: 1.5, // 50% more lenient thresholds
    cooperativeIPWhitelist: true, // Allow known cooperative IPs higher limits
    retryGracePeriod: 5000, // 5 second grace period for retries
  },
  
  // Vietnamese market context
  MARKET_CONTEXT: {
    tradingHoursLeniency: true, // More lenient during trading hours
    holidayModeEnabled: true, // Relaxed limits during Vietnamese holidays
    agriculturalSeasonAdjustments: true, // Adjust for planting/harvest seasons
    localizedResponses: true, // Vietnamese error messages for bans
  }
};

/**
 * DDoS Guard Class
 */
class DDoSGuard {
  private ipStates = new Map<string, IPTrackingState>();
  private globalState: GlobalProtectionState;
  private metrics: DDoSMetrics;
  private cleanupInterval: NodeJS.Timeout;
  private whitelistedIPs = new Set<string>();
  private blacklistedIPs = new Set<string>();

  constructor() {
    this.globalState = {
      requestCount: 0,
      capacity: DDOS_CONFIG.GLOBAL.capacity,
      lastRefill: Date.now(),
      surgeMode: false,
      surgeStartTime: 0,
      totalBlocked: 0,
      totalProcessed: 0,
      systemUtilization: 0
    };

    this.metrics = this.initializeMetrics();
    this.initializeWhitelists();
    this.startCleanupProcess();
    
    console.log('[DDoSGuard] Initialized with global capacity:', DDOS_CONFIG.GLOBAL.capacity);
  }

  /**
   * Main middleware function for DDoS protection
   */
  protect() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const clientIP = this.getClientIP(req);
      const requestId = req.get('X-Request-ID') || crypto.randomBytes(8).toString('hex');
      
      try {
        // Skip protection for whitelisted IPs
        if (this.whitelistedIPs.has(clientIP)) {
          return next();
        }
        
        // Immediate block for blacklisted IPs
        if (this.blacklistedIPs.has(clientIP)) {
          return this.blockRequest(res, 'BLACKLISTED_IP', clientIP, requestId);
        }
        
        // Update global state
        this.refillGlobalBucket();
        this.updateSystemUtilization();
        
        // Check global capacity first
        const globalCheck = this.checkGlobalCapacity(req);
        if (!globalCheck.allowed) {
          this.metrics.requests_blocked++;
          return this.handleGlobalCapacityExceeded(res, globalCheck, clientIP, requestId);
        }
        
        // Check per-IP limits and anomalies
        const ipCheck = this.checkIPLimits(clientIP, req);
        if (!ipCheck.allowed) {
          this.metrics.requests_blocked++;
          return this.handleIPLimitExceeded(res, ipCheck, clientIP, requestId);
        }
        
        // Apply slowdown if needed
        if (ipCheck.shouldSlowDown) {
          await this.applySlowdown(ipCheck.slowdownDelay);
          this.metrics.requests_slowed++;
        }
        
        // Set request timeout based on endpoint type
        this.setRequestTimeout(req, res);
        
        // Record successful check
        this.recordSuccessfulRequest(clientIP, req);
        this.metrics.requests_allowed++;
        this.metrics.requests_total++;
        
        // Add monitoring headers
        this.addMonitoringHeaders(res, clientIP);
        
        next();
        
      } catch (error) {
        console.error('[DDoSGuard] Protection middleware error:', error);
        // In case of error, log but allow request to proceed
        this.metrics.requests_allowed++; // Count as allowed to avoid false blocks
        next();
      } finally {
        // Record response time
        const responseTime = Date.now() - startTime;
        this.updateMetrics(responseTime);
      }
    };
  }

  /**
   * Get current DDoS protection metrics
   */
  getMetrics(): DDoSMetrics & { globalState: GlobalProtectionState } {
    return {
      ...this.metrics,
      globalState: { ...this.globalState }
    };
  }

  /**
   * Get IP-specific status for debugging
   */
  getIPStatus(ip: string): IPTrackingState | null {
    return this.ipStates.get(ip) || null;
  }

  /**
   * Manually whitelist an IP (for trusted agricultural cooperatives)
   */
  whitelistIP(ip: string, reason: string): void {
    this.whitelistedIPs.add(ip);
    console.log(`[DDoSGuard] Whitelisted IP ${ip}: ${reason}`);
  }

  /**
   * Manually blacklist an IP
   */
  blacklistIP(ip: string, reason: string): void {
    this.blacklistedIPs.add(ip);
    console.log(`[DDoSGuard] Blacklisted IP ${ip}: ${reason}`);
  }

  /**
   * Force exit surge mode (admin override)
   */
  exitSurgeMode(): void {
    if (this.globalState.surgeMode) {
      this.globalState.surgeMode = false;
      this.globalState.capacity = DDOS_CONFIG.GLOBAL.capacity;
      console.log('[DDoSGuard] Surge mode manually disabled');
    }
  }

  private getClientIP(req: Request): string {
    // Handle various proxy configurations
    const forwarded = req.get('X-Forwarded-For');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    return req.get('X-Real-IP') || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           'unknown';
  }

  private refillGlobalBucket(): void {
    const now = Date.now();
    const timePassed = (now - this.globalState.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * DDOS_CONFIG.GLOBAL.refillRate;
    
    this.globalState.requestCount = Math.min(
      this.globalState.capacity, 
      this.globalState.requestCount + tokensToAdd
    );
    this.globalState.lastRefill = now;
    
    // Check if should exit surge mode
    if (this.globalState.surgeMode) {
      const surgeAge = now - this.globalState.surgeStartTime;
      if (surgeAge > DDOS_CONFIG.GLOBAL.surgeModeCooldown && 
          this.globalState.systemUtilization < 0.5) {
        this.exitSurgeMode();
      }
    }
  }

  private updateSystemUtilization(): void {
    const utilizationRatio = 1 - (this.globalState.requestCount / this.globalState.capacity);
    this.globalState.systemUtilization = utilizationRatio;
    
    // Enter surge mode if utilization too high
    if (!this.globalState.surgeMode && utilizationRatio > DDOS_CONFIG.GLOBAL.surgeThreshold) {
      this.enterSurgeMode();
    }
  }

  private enterSurgeMode(): void {
    console.warn('[DDoSGuard] Entering surge mode - high system utilization detected');
    
    this.globalState.surgeMode = true;
    this.globalState.surgeStartTime = Date.now();
    this.globalState.capacity = Math.floor(
      DDOS_CONFIG.GLOBAL.capacity * (1 - DDOS_CONFIG.GLOBAL.surgeModePenalty)
    );
    
    this.metrics.surge_mode_activations++;
    this.metrics.current_surge_mode = true;
    
    // Alert monitoring system
    llmHealthMonitor.recordServiceInteraction(
      'openai', 
      false, 
      0, 
      'SURGE_MODE_ACTIVATED',
      { 
        utilization: this.globalState.systemUtilization,
        newCapacity: this.globalState.capacity 
      }
    );
  }

  private checkGlobalCapacity(req: Request): { allowed: boolean; reason?: string; retryAfter?: number } {
    if (this.globalState.requestCount < 1) {
      this.globalState.totalBlocked++;
      const retryAfter = Math.ceil(1 / DDOS_CONFIG.GLOBAL.refillRate);
      
      return { 
        allowed: false, 
        reason: 'GLOBAL_CAPACITY_EXCEEDED',
        retryAfter
      };
    }
    
    // Consume token
    this.globalState.requestCount--;
    this.globalState.totalProcessed++;
    
    return { allowed: true };
  }

  private checkIPLimits(ip: string, req: Request): {
    allowed: boolean;
    reason?: string;
    shouldSlowDown: boolean;
    slowdownDelay: number;
    retryAfter?: number;
  } {
    const now = Date.now();
    const state = this.getOrCreateIPState(ip, req);
    
    // Check if IP is currently banned
    if (state.banExpiry > now) {
      return {
        allowed: false,
        reason: 'TEMPORARILY_BANNED',
        shouldSlowDown: false,
        slowdownDelay: 0,
        retryAfter: Math.ceil((state.banExpiry - now) / 1000)
      };
    }
    
    // Reset window if needed
    if (now - state.windowStart > DDOS_CONFIG.PER_IP.windowSize) {
      state.requestCount = 0;
      state.errorCount = 0;
      state.windowStart = now;
      state.requestTimes = [];
    }
    
    // Check request rate limit
    if (state.requestCount >= DDOS_CONFIG.PER_IP.maxRequests) {
      this.recordViolation(state, 'RATE_LIMIT_EXCEEDED');
      return {
        allowed: false,
        reason: 'IP_RATE_LIMIT_EXCEEDED',
        shouldSlowDown: false,
        slowdownDelay: 0,
        retryAfter: Math.ceil((state.windowStart + DDOS_CONFIG.PER_IP.windowSize - now) / 1000)
      };
    }
    
    // Check for burst patterns
    const recentRequests = state.requestTimes.filter(t => now - t < DDOS_CONFIG.PER_IP.burstWindow);
    if (recentRequests.length >= DDOS_CONFIG.PER_IP.burstThreshold) {
      // Apply slowdown instead of blocking
      state.slowDownUntil = now + DDOS_CONFIG.PER_IP.slowdownDuration;
      this.recordViolation(state, 'BURST_PATTERN_DETECTED');
      
      return {
        allowed: true,
        shouldSlowDown: true,
        slowdownDelay: DDOS_CONFIG.PER_IP.slowdownDelay
      };
    }
    
    // Check error rate
    if (state.requestCount > 10) { // Only check after minimum requests
      const errorRate = state.errorCount / state.requestCount;
      if (errorRate > DDOS_CONFIG.PER_IP.errorRateThreshold) {
        this.recordViolation(state, 'HIGH_ERROR_RATE');
        return {
          allowed: false,
          reason: 'HIGH_ERROR_RATE_DETECTED',
          shouldSlowDown: false,
          slowdownDelay: 0,
          retryAfter: 300 // 5 minutes
        };
      }
    }
    
    // Check if should slow down (from previous burst detection)
    const shouldSlowDown = state.slowDownUntil > now;
    
    // Update state
    state.requestCount++;
    state.lastRequest = now;
    state.requestTimes.push(now);
    state.metadata.totalRequests++;
    
    // Keep requestTimes array bounded
    if (state.requestTimes.length > 100) {
      state.requestTimes = state.requestTimes.slice(-50);
    }
    
    return {
      allowed: true,
      shouldSlowDown,
      slowdownDelay: shouldSlowDown ? DDOS_CONFIG.PER_IP.slowdownDelay : 0
    };
  }

  private getOrCreateIPState(ip: string, req: Request): IPTrackingState {
    let state = this.ipStates.get(ip);
    
    if (!state) {
      const now = Date.now();
      state = {
        requestCount: 0,
        errorCount: 0,
        lastRequest: now,
        windowStart: now,
        violationHistory: [],
        banExpiry: 0,
        banLevel: 0,
        slowDownUntil: 0,
        requestTimes: [],
        metadata: {
          userAgent: req.get('User-Agent'),
          firstSeen: now,
          totalRequests: 0,
          isBot: this.detectBot(req.get('User-Agent') || '')
        }
      };
      
      this.ipStates.set(ip, state);
    }
    
    return state;
  }

  private recordViolation(state: IPTrackingState, reason: string): void {
    const now = Date.now();
    state.violationHistory.push(now);
    
    // Clean old violations (older than cooldown period)
    state.violationHistory = state.violationHistory.filter(
      t => now - t < DDOS_CONFIG.PER_IP.violationCooldown
    );
    
    // Progressive banning based on violation history
    const recentViolations = state.violationHistory.length;
    if (recentViolations >= 3) { // 3 violations trigger ban
      const banLevel = Math.min(state.banLevel + 1, DDOS_CONFIG.PER_IP.maxBanLevel);
      const banDuration = DDOS_CONFIG.PER_IP.banDurations[banLevel - 1] || DDOS_CONFIG.PER_IP.banDurations[DDOS_CONFIG.PER_IP.banDurations.length - 1];
      
      state.banExpiry = now + banDuration;
      state.banLevel = banLevel;
      this.metrics.ips_banned_temporary++;
      
      console.warn(`[DDoSGuard] Temporarily banned IP for ${reason}: ban level ${banLevel}, duration ${banDuration}ms`);
    }
    
    this.metrics.anomaly_detections++;
  }

  private async applySlowdown(delay: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  private setRequestTimeout(req: Request, res: Response): void {
    let timeout = DDOS_CONFIG.GLOBAL.defaultTimeout;
    
    // Increase timeout for POST requests
    if (req.method === 'POST') {
      timeout *= DDOS_CONFIG.GLOBAL.postTimeoutMultiplier;
    }
    
    // Special timeout for heavy endpoints
    const heavyEndpoints = ['/v1/forecast-30d', '/v1/llm-crosscheck', '/api/forecasts/generate'];
    if (heavyEndpoints.some(endpoint => req.path.includes(endpoint))) {
      timeout = DDOS_CONFIG.GLOBAL.heavyEndpointTimeout;
    }
    
    req.setTimeout(timeout, () => {
      console.warn(`[DDoSGuard] Request timeout for ${req.method} ${req.path} from ${this.getClientIP(req)}`);
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Request timeout',
          messageVietnamese: 'Yêu cầu đã hết thời gian chờ',
          error: 'REQUEST_TIMEOUT',
          code: 'DDOS_TIMEOUT_001',
          guidance: {
            message: 'Request took too long to process. Please try again with smaller data or check your connection.',
            messageVietnamese: 'Yêu cầu mất quá nhiều thời gian xử lý. Vui lòng thử lại với ít dữ liệu hơn hoặc kiểm tra kết nối của bạn.'
          }
        });
      }
    });
  }

  private recordSuccessfulRequest(ip: string, req: Request): void {
    // This will be called when request completes successfully
    // For now, we just ensure the IP state exists
    this.getOrCreateIPState(ip, req);
  }

  private addMonitoringHeaders(res: Response, ip: string): void {
    const state = this.ipStates.get(ip);
    if (state) {
      res.set({
        'X-DDoS-Remaining': Math.max(0, DDOS_CONFIG.PER_IP.maxRequests - state.requestCount).toString(),
        'X-DDoS-Reset': Math.ceil((state.windowStart + DDOS_CONFIG.PER_IP.windowSize) / 1000).toString(),
        'X-Global-Capacity': Math.floor(this.globalState.requestCount).toString()
      });
      
      if (this.globalState.surgeMode) {
        res.set('X-DDoS-Surge-Mode', 'active');
      }
    }
  }

  private handleGlobalCapacityExceeded(
    res: Response, 
    globalCheck: any, 
    ip: string, 
    requestId: string
  ): void {
    console.warn('DDOS_GLOBAL_CAPACITY_EXCEEDED:', JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      ip,
      surgeMode: this.globalState.surgeMode,
      utilization: this.globalState.systemUtilization
    }));
    
    const retryAfter = globalCheck.retryAfter || 60;
    
    res.status(503).json({
      success: false,
      message: 'System temporarily overloaded',
      messageVietnamese: 'Hệ thống tạm thời quá tải, vui lòng thử lại sau',
      error: 'SYSTEM_OVERLOAD',
      code: 'DDOS_GLOBAL_001',
      retryAfter,
      guidance: {
        message: 'High system load detected. Please wait before retrying.',
        messageVietnamese: 'Phát hiện tải hệ thống cao. Vui lòng đợi trước khi thử lại.',
        suggestedDelay: Math.min(retryAfter, 300)
      }
    });
  }

  private handleIPLimitExceeded(
    res: Response,
    ipCheck: any,
    ip: string,
    requestId: string
  ): void {
    console.warn('DDOS_IP_LIMIT_EXCEEDED:', JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      ip,
      reason: ipCheck.reason,
      retryAfter: ipCheck.retryAfter
    }));
    
    const vietnameseMessages: { [key: string]: string } = {
      'TEMPORARILY_BANNED': 'IP tạm thời bị chặn do hoạt động bất thường',
      'IP_RATE_LIMIT_EXCEEDED': 'Đã vượt quá giới hạn số lượng yêu cầu từ IP này',
      'HIGH_ERROR_RATE_DETECTED': 'Phát hiện tỷ lệ lỗi cao từ IP này'
    };
    
    res.status(429).json({
      success: false,
      message: 'IP rate limit exceeded',
      messageVietnamese: vietnameseMessages[ipCheck.reason] || 'Đã vượt quá giới hạn từ IP này',
      error: ipCheck.reason,
      code: 'DDOS_IP_001',
      retryAfter: ipCheck.retryAfter,
      guidance: {
        message: 'Please reduce request frequency or check for automated requests.',
        messageVietnamese: 'Vui lòng giảm tần suất yêu cầu hoặc kiểm tra các yêu cầu tự động.',
        contactSupport: 'If you believe this is an error, please contact support with your IP address.'
      }
    });
  }

  private blockRequest(res: Response, reason: string, ip: string, requestId: string): void {
    console.warn('DDOS_REQUEST_BLOCKED:', JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      ip,
      reason
    }));
    
    res.status(403).json({
      success: false,
      message: 'Request blocked',
      messageVietnamese: 'Yêu cầu bị chặn',
      error: reason,
      code: 'DDOS_BLOCK_001'
    });
  }

  private detectBot(userAgent: string): boolean {
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /java/i
    ];
    
    return botPatterns.some(pattern => pattern.test(userAgent));
  }

  private updateMetrics(responseTime: number): void {
    // Update running average response time
    this.metrics.avg_response_time = (this.metrics.avg_response_time + responseTime) / 2;
    this.metrics.system_utilization = this.globalState.systemUtilization;
    this.metrics.active_bans = Array.from(this.ipStates.values())
      .filter(state => state.banExpiry > Date.now()).length;
  }

  private initializeMetrics(): DDoSMetrics {
    return {
      requests_total: 0,
      requests_allowed: 0,
      requests_blocked: 0,
      requests_slowed: 0,
      ips_banned_temporary: 0,
      ips_banned_permanent: 0,
      active_bans: 0,
      surge_mode_activations: 0,
      surge_mode_duration: 0,
      current_surge_mode: false,
      avg_response_time: 0,
      system_utilization: 0,
      anomaly_detections: 0
    };
  }

  private initializeWhitelists(): void {
    // Add common Vietnamese ISP ranges and agricultural cooperative IPs
    const defaultWhitelist = [
      '127.0.0.1', // localhost
      '::1', // IPv6 localhost
    ];
    
    // In production, these would come from configuration
    defaultWhitelist.forEach(ip => this.whitelistedIPs.add(ip));
    
    console.log(`[DDoSGuard] Initialized with ${this.whitelistedIPs.size} whitelisted IPs`);
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredStates();
      this.reportMetrics();
    }, 300000); // Every 5 minutes
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
    let cleaned = 0;
    
    this.ipStates.forEach((state, ip) => {
      if (state.lastRequest < cutoff && state.banExpiry < now) {
        this.ipStates.delete(ip);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      console.log(`[DDoSGuard] Cleaned up ${cleaned} expired IP states`);
    }
  }

  private reportMetrics(): void {
    const metrics = this.getMetrics();
    console.log('[DDoSGuard] Metrics:', JSON.stringify({
      requests_total: metrics.requests_total,
      requests_blocked: metrics.requests_blocked,
      block_rate: metrics.requests_total > 0 ? metrics.requests_blocked / metrics.requests_total : 0,
      active_bans: metrics.active_bans,
      surge_mode: metrics.current_surge_mode,
      system_utilization: metrics.system_utilization
    }));
    
    // Report to health monitor
    llmHealthMonitor.recordServiceInteraction(
      'gemini',
      true,
      metrics.avg_response_time,
      undefined,
      {
        ddos_metrics: {
          block_rate: metrics.requests_total > 0 ? metrics.requests_blocked / metrics.requests_total : 0,
          active_bans: metrics.active_bans,
          surge_mode: metrics.current_surge_mode
        }
      }
    );
  }
}

// Export singleton instance
export const ddosGuard = new DDoSGuard();
export type { DDoSMetrics, IPTrackingState };