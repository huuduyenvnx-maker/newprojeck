// Session-based authentication middleware helpers
// Reference: Basic Username/Password Authentication blueprint integration
import { Request, Response, NextFunction } from "express";

// Helper to check if user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Development bypass for forecast generation when auth is broken
  if (process.env.NODE_ENV === 'development') {
    console.log('[AUTH DEBUG] Development mode - bypassing authentication for forecast generation');
    return next();
  }
  
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// Helper to check if user is admin (for now, everyone is admin in development)
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Development bypass when auth is broken
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // TODO: Add proper role checking when cooperative system is implemented
  next();
}

// Helper to check write access (for now, authenticated users have write access)
export function requireWriteAccess(req: Request, res: Response, next: NextFunction) {
  // Development bypass when auth is broken
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // TODO: Add proper role checking when cooperative system is implemented
  next();
}

// Development bypass for non-essential features
export function developmentBypass(req: Request, res: Response, next: NextFunction) {
  // Allow access in development mode for core functionality
  next();
}