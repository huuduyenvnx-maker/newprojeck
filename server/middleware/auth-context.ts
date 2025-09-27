// Middleware to populate req.auth from req.user for cooperative context
// This bridges session-based auth with existing routes that expect req.auth
import { Request, Response, NextFunction } from "express";
import { CooperativeContext } from "../storage";

declare global {
  namespace Express {
    interface Request {
      auth?: CooperativeContext;
    }
  }
}

export function populateAuthContext(req: Request, res: Response, next: NextFunction) {
  // Clear any existing auth context
  req.auth = undefined;
  
  try {
    // Check if passport is properly initialized and user is authenticated
    // Add safer type checking to prevent "not a function" errors
    const isAuthenticated = (typeof req.isAuthenticated === 'function') ? req.isAuthenticated() : false;
    
    if (isAuthenticated && req.user && req.user.id) {
      // For now, use development defaults for cooperative context
      // TODO: Implement proper cooperative membership lookup when multi-tenant system is built
      req.auth = {
        coopId: 'dev-coop-001', // Development default cooperative
        userId: req.user.id,
        role: 'admin' // Development default role - all users are admin for now
      };
    }
  } catch (error) {
    console.warn('[Auth Context] Error checking authentication:', error);
    // Continue without auth context in case of error
  }
  
  next();
}