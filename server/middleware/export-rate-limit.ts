/**
 * Enhanced rate limiting middleware specifically for export endpoints
 * Implements per-user concurrency limits and request rate limiting
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './export-auth';

// Rate limiting storage
const userRateLimits = new Map<string, { 
  count: number; 
  resetTime: number; 
  concurrentJobs: Set<string>;
  totalDataExported: number; // Track data volume
  lastRequestTime: number;
}>();

// Global rate limiting (by IP for unauthenticated requests)
const ipRateLimits = new Map<string, { count: number; resetTime: number }>();

// Configuration
const EXPORT_RATE_LIMITS = {
  // Requests per minute per authenticated user
  REQUESTS_PER_USER_PER_MINUTE: 10,
  
  // Maximum concurrent export jobs per user
  MAX_CONCURRENT_JOBS_PER_USER: 3,
  
  // Maximum data exported per user per hour (in MB)
  MAX_DATA_PER_USER_PER_HOUR: 500,
  
  // Requests per minute per IP (for unauthenticated)
  REQUESTS_PER_IP_PER_MINUTE: 5,
  
  // Time windows
  RATE_LIMIT_WINDOW: 60 * 1000, // 1 minute
  DATA_LIMIT_WINDOW: 60 * 60 * 1000, // 1 hour
  
  // Burst allowance for premium users
  BURST_ALLOWANCE_ADMIN: 5,
  BURST_ALLOWANCE_ANALYST: 3,
};

/**
 * Check and update user rate limits
 */
const checkUserRateLimit = (
  userId: string, 
  userRole: 'admin' | 'user' | 'analyst'
): { 
  allowed: boolean; 
  remaining: number; 
  resetAt: Date; 
  reason?: string;
  concurrentJobs: number;
} => {
  const now = Date.now();
  const userData = userRateLimits.get(userId) || { 
    count: 0, 
    resetTime: now + EXPORT_RATE_LIMITS.RATE_LIMIT_WINDOW,
    concurrentJobs: new Set<string>(),
    totalDataExported: 0,
    lastRequestTime: now
  };
  
  // Reset counters if window expired
  if (now > userData.resetTime) {
    userData.count = 0;
    userData.resetTime = now + EXPORT_RATE_LIMITS.RATE_LIMIT_WINDOW;
  }
  
  // Reset data export tracking if hour expired
  if (now > userData.lastRequestTime + EXPORT_RATE_LIMITS.DATA_LIMIT_WINDOW) {
    userData.totalDataExported = 0;
  }
  
  userData.lastRequestTime = now;
  
  // Determine rate limit based on user role
  let requestLimit = EXPORT_RATE_LIMITS.REQUESTS_PER_USER_PER_MINUTE;
  if (userRole === 'admin') {
    requestLimit += EXPORT_RATE_LIMITS.BURST_ALLOWANCE_ADMIN;
  } else if (userRole === 'analyst') {
    requestLimit += EXPORT_RATE_LIMITS.BURST_ALLOWANCE_ANALYST;
  }
  
  // Check concurrent jobs limit
  if (userData.concurrentJobs.size >= EXPORT_RATE_LIMITS.MAX_CONCURRENT_JOBS_PER_USER) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(userData.resetTime),
      reason: 'Too many concurrent export jobs',
      concurrentJobs: userData.concurrentJobs.size
    };
  }
  
  // Check request rate limit
  if (userData.count >= requestLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(userData.resetTime),
      reason: 'Request rate limit exceeded',
      concurrentJobs: userData.concurrentJobs.size
    };
  }
  
  // Check data export limit
  if (userData.totalDataExported >= EXPORT_RATE_LIMITS.MAX_DATA_PER_USER_PER_HOUR) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(userData.resetTime),
      reason: 'Data export volume limit exceeded',
      concurrentJobs: userData.concurrentJobs.size
    };
  }
  
  // Update counters
  userData.count++;
  userRateLimits.set(userId, userData);
  
  return {
    allowed: true,
    remaining: requestLimit - userData.count,
    resetAt: new Date(userData.resetTime),
    concurrentJobs: userData.concurrentJobs.size
  };
};

/**
 * Check IP-based rate limits (fallback for unauthenticated requests)
 */
const checkIpRateLimit = (clientIp: string): { 
  allowed: boolean; 
  remaining: number; 
  resetAt: Date; 
} => {
  const now = Date.now();
  const ipData = ipRateLimits.get(clientIp) || { 
    count: 0, 
    resetTime: now + EXPORT_RATE_LIMITS.RATE_LIMIT_WINDOW
  };
  
  if (now > ipData.resetTime) {
    ipData.count = 0;
    ipData.resetTime = now + EXPORT_RATE_LIMITS.RATE_LIMIT_WINDOW;
  }
  
  if (ipData.count >= EXPORT_RATE_LIMITS.REQUESTS_PER_IP_PER_MINUTE) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(ipData.resetTime)
    };
  }
  
  ipData.count++;
  ipRateLimits.set(clientIp, ipData);
  
  return {
    allowed: true,
    remaining: EXPORT_RATE_LIMITS.REQUESTS_PER_IP_PER_MINUTE - ipData.count,
    resetAt: new Date(ipData.resetTime)
  };
};

/**
 * Enhanced rate limiting middleware for export endpoints
 */
export const exportRateLimit = (
  req: Request, 
  res: Response, 
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  
  let rateLimitResult;
  
  if (authReq.isAuthenticated) {
    // Use user-based rate limiting for authenticated requests
    rateLimitResult = checkUserRateLimit(authReq.userId, authReq.userRole);
  } else {
    // Fallback to IP-based rate limiting
    rateLimitResult = checkIpRateLimit(clientIp);
  }
  
  // Set rate limit headers
  res.set({
    'X-RateLimit-Limit': authReq.isAuthenticated ? 
      `${EXPORT_RATE_LIMITS.REQUESTS_PER_USER_PER_MINUTE}` : 
      `${EXPORT_RATE_LIMITS.REQUESTS_PER_IP_PER_MINUTE}`,
    'X-RateLimit-Remaining': `${rateLimitResult.remaining}`,
    'X-RateLimit-Reset': `${Math.ceil(rateLimitResult.resetAt.getTime() / 1000)}`,
    'X-RateLimit-Window': `${EXPORT_RATE_LIMITS.RATE_LIMIT_WINDOW / 1000}s`
  });
  
  if (authReq.isAuthenticated) {
    res.set({
      'X-Export-Concurrent-Jobs': `${('concurrentJobs' in rateLimitResult) ? rateLimitResult.concurrentJobs : 0}`,
      'X-Export-Max-Concurrent': `${EXPORT_RATE_LIMITS.MAX_CONCURRENT_JOBS_PER_USER}`
    });
  }
  
  if (!rateLimitResult.allowed) {
    console.warn('EXPORT_RATE_LIMIT_EXCEEDED:', JSON.stringify({
      timestamp: new Date().toISOString(),
      userId: authReq.userId || 'anonymous',
      userRole: authReq.userRole || 'none',
      ip: clientIp,
      path: req.path,
      reason: 'Rate limit exceeded',
      concurrentJobs: ('concurrentJobs' in rateLimitResult) ? rateLimitResult.concurrentJobs : 0
    }));
    
    res.status(429).json({
      success: false,
      message: 'Too many export requests',
      messageVietnamese: 'Quá nhiều yêu cầu xuất dữ liệu',
      error: 'Rate limit exceeded',
      code: 'EXPORT_RATE_LIMIT_001',
      rateLimitInfo: {
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt.toISOString(),
        retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
        concurrentJobs: ('concurrentJobs' in rateLimitResult) ? rateLimitResult.concurrentJobs : 0,
        maxConcurrent: EXPORT_RATE_LIMITS.MAX_CONCURRENT_JOBS_PER_USER
      }
    });
    return;
  }
  
  // Log successful rate limit check
  if (authReq.isAuthenticated) {
    console.log('EXPORT_RATE_LIMIT_PASSED:', JSON.stringify({
      timestamp: new Date().toISOString(),
      userId: authReq.userId,
      userRole: authReq.userRole,
      path: req.path,
      remaining: rateLimitResult.remaining,
      concurrentJobs: ('concurrentJobs' in rateLimitResult) ? rateLimitResult.concurrentJobs : 0
    }));
  }
  
  next();
};

/**
 * Add a job to user's concurrent job tracking
 */
export const addConcurrentJob = (userId: string, jobId: string): void => {
  const userData = userRateLimits.get(userId);
  if (userData) {
    userData.concurrentJobs.add(jobId);
    userRateLimits.set(userId, userData);
    
    console.log(`Added concurrent job ${jobId} for user ${userId}. Total: ${userData.concurrentJobs.size}`);
  }
};

/**
 * Remove a job from user's concurrent job tracking
 */
export const removeConcurrentJob = (userId: string, jobId: string): void => {
  const userData = userRateLimits.get(userId);
  if (userData) {
    userData.concurrentJobs.delete(jobId);
    userRateLimits.set(userId, userData);
    
    console.log(`Removed concurrent job ${jobId} for user ${userId}. Remaining: ${userData.concurrentJobs.size}`);
  }
};

/**
 * Track data exported by user (for volume limiting)
 */
export const trackDataExported = (userId: string, sizeInMB: number): void => {
  const userData = userRateLimits.get(userId);
  if (userData) {
    userData.totalDataExported += sizeInMB;
    userRateLimits.set(userId, userData);
    
    console.log(`User ${userId} exported ${sizeInMB}MB. Total this hour: ${userData.totalDataExported}MB`);
  }
};

/**
 * Get current rate limit status for a user
 */
export const getUserRateLimitStatus = (userId: string): {
  requestsRemaining: number;
  concurrentJobs: number;
  dataExportedThisHour: number;
  canCreateNewJob: boolean;
} => {
  const userData = userRateLimits.get(userId);
  if (!userData) {
    return {
      requestsRemaining: EXPORT_RATE_LIMITS.REQUESTS_PER_USER_PER_MINUTE,
      concurrentJobs: 0,
      dataExportedThisHour: 0,
      canCreateNewJob: true
    };
  }
  
  const now = Date.now();
  const requestsRemaining = userData.resetTime > now ? 
    Math.max(0, EXPORT_RATE_LIMITS.REQUESTS_PER_USER_PER_MINUTE - userData.count) : 
    EXPORT_RATE_LIMITS.REQUESTS_PER_USER_PER_MINUTE;
  
  return {
    requestsRemaining,
    concurrentJobs: userData.concurrentJobs.size,
    dataExportedThisHour: userData.totalDataExported,
    canCreateNewJob: userData.concurrentJobs.size < EXPORT_RATE_LIMITS.MAX_CONCURRENT_JOBS_PER_USER
  };
};

/**
 * Clean up old rate limit data
 */
export const cleanupRateLimitData = (): void => {
  const now = Date.now();
  let cleanedUsers = 0;
  let cleanedIps = 0;
  
  // Clean up user rate limits
  userRateLimits.forEach((userData, userId) => {
    if (now > userData.resetTime + EXPORT_RATE_LIMITS.DATA_LIMIT_WINDOW) {
      userRateLimits.delete(userId);
      cleanedUsers++;
    }
  });
  
  // Clean up IP rate limits
  ipRateLimits.forEach((ipData, ip) => {
    if (now > ipData.resetTime + EXPORT_RATE_LIMITS.DATA_LIMIT_WINDOW) {
      ipRateLimits.delete(ip);
      cleanedIps++;
    }
  });
  
  if (cleanedUsers > 0 || cleanedIps > 0) {
    console.log(`Cleaned up rate limit data: ${cleanedUsers} users, ${cleanedIps} IPs`);
  }
};

// Clean up old data every hour
setInterval(cleanupRateLimitData, 60 * 60 * 1000);