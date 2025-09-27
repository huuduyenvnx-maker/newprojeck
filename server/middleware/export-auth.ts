/**
 * Authentication middleware for export endpoints
 * Replaces insecure client-provided X-User-ID with proper server-side authentication
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extended Request interface to include authenticated user info
export interface AuthenticatedRequest extends Request {
  userId: string;
  userRole: 'admin' | 'user' | 'analyst';
  isAuthenticated: boolean;
  requestId: string;
}

// Simple session-based authentication (would integrate with actual auth system)
const userSessions = new Map<string, { 
  userId: string; 
  userRole: 'admin' | 'user' | 'analyst'; 
  lastActivity: number;
  ipAddress: string;
}>();

// Session timeout (1 hour)
const SESSION_TIMEOUT = 60 * 60 * 1000;

/**
 * Authentication middleware for export endpoints
 * Validates session and authenticates users
 */
export const authenticateExportUser = (
  req: Request, 
  res: Response, 
  next: NextFunction
): void => {
  const authReq = req as AuthenticatedRequest;
  
  // Generate or get request ID for tracking
  authReq.requestId = req.get('X-Request-ID') || uuidv4();
  
  // DEVELOPMENT MODE: Allow access with mock user for development
  const isDevMode = process.env.NODE_ENV === 'development';
  
  if (isDevMode) {
    // Create mock authenticated user for development
    authReq.userId = 'dev-user-' + uuidv4();
    authReq.userRole = 'admin';
    authReq.isAuthenticated = true;
    
    console.log(`[Export Auth] Development bypass enabled for ${req.method} ${req.path}`);
    return next();
  }
  
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
      code: 'EXPORT_AUTH_001'
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
      code: 'EXPORT_AUTH_002'
    });
    return;
  }

  // Verify IP address consistency (basic security measure)
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  if (session.ipAddress !== clientIp) {
    console.warn(`Session IP mismatch for user ${session.userId}: expected ${session.ipAddress}, got ${clientIp}`);
    
    // In production, this might be more strict
    // For now, just log the warning and continue
  }

  // Update last activity
  session.lastActivity = now;
  userSessions.set(sessionToken, session);

  // Attach authenticated user info to request
  authReq.userId = session.userId;
  authReq.userRole = session.userRole;
  authReq.isAuthenticated = true;

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
 * Role-based authorization middleware
 * Ensures users have appropriate permissions for export operations
 */
export const authorizeExportOperation = (
  requiredRoles: Array<'admin' | 'user' | 'analyst'> = ['admin', 'user', 'analyst']
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

    if (!requiredRoles.includes(authReq.userRole)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions for export operation',
        messageVietnamese: 'Không có quyền thực hiện xuất dữ liệu',
        error: 'INSUFFICIENT_PERMISSIONS',
        code: 'EXPORT_AUTH_004',
        requiredRoles,
        userRole: authReq.userRole
      });
      return;
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
  userRole: 'admin' | 'user' | 'analyst' = 'user',
  ipAddress: string = '127.0.0.1'
): string => {
  const sessionToken = uuidv4();
  
  userSessions.set(sessionToken, {
    userId,
    userRole,
    lastActivity: Date.now(),
    ipAddress
  });

  console.log(`Created test session: ${sessionToken} for user ${userId} with role ${userRole}`);
  return sessionToken;
};

/**
 * Get active session count for monitoring
 */
export const getActiveSessionCount = (): number => {
  const now = Date.now();
  let activeCount = 0;
  
  userSessions.forEach((session, token) => {
    if (now - session.lastActivity <= SESSION_TIMEOUT) {
      activeCount++;
    } else {
      // Clean up expired sessions
      userSessions.delete(token);
    }
  });
  
  return activeCount;
};

/**
 * Clean up expired sessions (should be called periodically)
 */
export const cleanupExpiredSessions = (): number => {
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
  
  return cleanedCount;
};

// Clean up expired sessions every 30 minutes
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);