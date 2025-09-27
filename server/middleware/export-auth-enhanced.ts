/**
 * Enhanced Authentication Middleware for Export Endpoints
 * 
 * Replaces insecure client-provided X-User-ID with proper server-side authentication
 * and integrates with the unified rate limiting system.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { type RateLimitedRequest } from './rate-limit';

// Extended Request interface to include authenticated user info
export interface AuthenticatedRequest extends RateLimitedRequest {
  userId: string;
  userRole: 'admin' | 'user' | 'analyst' | 'internal';
  isAuthenticated: boolean;
  requestId: string;
}

// Simple session-based authentication (would integrate with actual auth system)
const userSessions = new Map<string, { 
  userId: string; 
  userRole: 'admin' | 'user' | 'analyst' | 'internal'; 
  lastActivity: number;
  ipAddress: string;
  permissions: string[];
}>();

// Session timeout (1 hour)
const SESSION_TIMEOUT = 60 * 60 * 1000;

/**
 * Enhanced authentication middleware for export endpoints
 * Validates session, authenticates users, and sets up rate limiting context
 */
export const authenticateExportUser = (
  req: Request, 
  res: Response, 
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;
  
  // Generate or get request ID for tracking
  authReq.requestId = authReq.requestId || req.get('X-Request-ID') || uuidv4();
  
  // For development, use a simple session-based approach
  // In production, this would integrate with proper authentication system
  const sessionToken = req.get('Authorization')?.replace('Bearer ', '') || 
                      req.cookies?.sessionToken ||
                      req.get('X-Session-Token');
  
  if (!sessionToken) {
    res.status(401).json({
      success: false,
      message: 'Authentication required for export operations',
      messageVietnamese: 'Cần xác thực để thực hiện xuất dữ liệu',
      error: 'MISSING_AUTH_TOKEN',
      code: 'EXPORT_AUTH_001',
      guidance: {
        message: 'Please provide a valid session token via Authorization header',
        messageVietnamese: 'Vui lòng cung cấp token phiên hợp lệ qua header Authorization'
      }
    });
    return;
  }

  // Check session validity
  const session = userSessions.get(sessionToken);
  const now = Date.now();
  
  if (!session || now - session.lastActivity > SESSION_TIMEOUT) {
    // Remove expired session
    if (session) {
      userSessions.delete(sessionToken);
    }
    
    res.status(401).json({
      success: false,
      message: 'Session expired or invalid',
      messageVietnamese: 'Phiên làm việc đã hết hạn hoặc không hợp lệ',
      error: 'INVALID_SESSION',
      code: 'EXPORT_AUTH_002',
      guidance: {
        message: 'Please log in again to continue',
        messageVietnamese: 'Vui lòng đăng nhập lại để tiếp tục'
      }
    });
    return;
  }

  // Verify IP address consistency (basic security measure)
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  if (session.ipAddress !== clientIp && session.ipAddress !== 'internal') {
    console.warn(`Session IP mismatch for user ${session.userId}: expected ${session.ipAddress}, got ${clientIp}`);
    
    // In production, this might be more strict
    // For now, just log the warning and continue
  }

  // Update last activity
  session.lastActivity = now;
  userSessions.set(sessionToken, session);

  // Attach authenticated user info to request (for rate limiting and authorization)
  authReq.userId = session.userId;
  authReq.userRole = session.userRole;
  authReq.isAuthenticated = true;
  
  // Set rate limiting key for unified system
  authReq.rateLimitKey = `user:${session.userId}:${req.method}:${req.path}`;

  // Log authenticated export request
  console.log('EXPORT_AUTH_SUCCESS:', JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId: authReq.requestId,
    userId: authReq.userId,
    userRole: authReq.userRole,
    method: req.method,
    path: req.path,
    ip: clientIp
  }));

  next();
};

/**
 * Role-based authorization middleware with Vietnamese agricultural context
 * Ensures users have appropriate permissions for export operations
 */
export const authorizeExportOperation = (
  requiredRoles: Array<'admin' | 'user' | 'analyst' | 'internal'> = ['admin', 'user', 'analyst'],
  requiredPermissions: string[] = []
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.isAuthenticated) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        messageVietnamese: 'Cần xác thực',
        error: 'NOT_AUTHENTICATED',
        code: 'EXPORT_AUTH_003'
      });
      return;
    }

    // Check role-based access
    if (!requiredRoles.includes(authReq.userRole)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions for export operation',
        messageVietnamese: 'Không có quyền thực hiện xuất dữ liệu',
        error: 'INSUFFICIENT_PERMISSIONS',
        code: 'EXPORT_AUTH_004',
        details: {
          requiredRoles,
          userRole: authReq.userRole,
          guidance: 'Contact your administrator for access to export features',
          guidanceVietnamese: 'Liên hệ quản trị viên để được cấp quyền xuất dữ liệu'
        }
      });
      return;
    }

    // Check permission-based access (for fine-grained control)
    if (requiredPermissions.length > 0) {
      const session = userSessions.get(req.get('Authorization')?.replace('Bearer ', '') || '');
      const userPermissions = session?.permissions || [];
      
      const hasRequiredPermissions = requiredPermissions.every(perm => 
        userPermissions.includes(perm) || userPermissions.includes('*')
      );
      
      if (!hasRequiredPermissions) {
        res.status(403).json({
          success: false,
          message: 'Missing required permissions',
          messageVietnamese: 'Thiếu quyền cần thiết',
          error: 'MISSING_PERMISSIONS',
          code: 'EXPORT_AUTH_005',
          details: {
            required: requiredPermissions,
            granted: userPermissions
          }
        });
        return;
      }
    }

    next();
  };
};

/**
 * Development helper function to create a test session
 * In production, sessions would be created through proper login flow
 */
export const createTestSession = (
  userId: string = 'test-user-001',
  userRole: 'admin' | 'user' | 'analyst' | 'internal' = 'user',
  ipAddress: string = '127.0.0.1',
  permissions: string[] = ['export:basic', 'forecast:read']
): string => {
  const sessionToken = uuidv4();
  
  userSessions.set(sessionToken, {
    userId,
    userRole,
    lastActivity: Date.now(),
    ipAddress,
    permissions
  });

  console.log(`Created test session: ${sessionToken} for user ${userId} with role ${userRole}`);
  return sessionToken;
};

/**
 * Create administrative session for internal services
 */
export const createInternalSession = (): string => {
  return createTestSession(
    'internal-service',
    'internal',
    'internal',
    ['*'] // All permissions
  );
};

/**
 * Agricultural cooperative session creation
 * For shared NAT environments with multiple users
 */
export const createCooperativeSession = (
  cooperativeId: string,
  userId: string,
  userRole: 'user' | 'analyst' = 'user',
  ipAddress: string = '127.0.0.1'
): string => {
  const fullUserId = `coop-${cooperativeId}-${userId}`;
  const permissions = [
    'export:basic',
    'forecast:read',
    'price-data:read',
    ...(userRole === 'analyst' ? ['forecast:generate', 'llm:verify'] : [])
  ];
  
  return createTestSession(fullUserId, userRole, ipAddress, permissions);
};

/**
 * Get current session info for debugging
 */
export const getSessionInfo = (sessionToken: string) => {
  const session = userSessions.get(sessionToken);
  if (!session) return null;
  
  return {
    userId: session.userId,
    userRole: session.userRole,
    lastActivity: new Date(session.lastActivity).toISOString(),
    ipAddress: session.ipAddress,
    permissions: session.permissions,
    isExpired: Date.now() - session.lastActivity > SESSION_TIMEOUT
  };
};

/**
 * Clean up expired sessions
 */
export const cleanupExpiredSessions = (): void => {
  const now = Date.now();
  let cleanedCount = 0;
  
  userSessions.forEach((session, token) => {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      userSessions.delete(token);
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} expired export sessions`);
  }
};

/**
 * Get session statistics for monitoring
 */
export const getSessionStats = () => {
  const now = Date.now();
  const sessions = Array.from(userSessions.values());
  
  return {
    total: sessions.length,
    active: sessions.filter(s => now - s.lastActivity < SESSION_TIMEOUT).length,
    byRole: sessions.reduce((acc, session) => {
      acc[session.userRole] = (acc[session.userRole] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    oldestSession: sessions.length > 0 ? 
      Math.min(...sessions.map(s => s.lastActivity)) : null
  };
};

// Clean up expired sessions every 30 minutes
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);

export type { AuthenticatedRequest };