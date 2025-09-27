import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { createServer } from "http";
import { WebSocketService } from "./services/websocket-service";

// Rate limiting imports
import { ddosGuard } from "./middleware/ddos-guard";
import { createRateLimitMiddleware, type RateLimitedRequest } from "./middleware/rate-limit";
import { rateLimitConfig } from "./services/rate-limit-config";
import { rateLimitMetrics } from "./services/rate-limit-metrics";

// CRITICAL SECURITY: Validate required environment variables at startup
function validateEnvironmentVariables() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ CRITICAL: DATABASE_URL is required!');
    console.error('   AgriIntel requires PostgreSQL database connection.');

    if (process.env.NODE_ENV === 'production') {
      console.error('\n❌ ABORTING: Cannot start in production without database');
      process.exit(1);
    } else {
      console.error('\n⚠️  DEVELOPMENT MODE: Please configure DATABASE_URL');
    }
  } else {
    console.log('✅ Database connection configured');
  }
}

// Validate environment before initialization
validateEnvironmentVariables();

const app = express();

// Trust proxy configuration for proper IP extraction - SECURITY HARDENED
// Only trust specific known proxy hops, NOT all proxies to prevent IP spoofing
app.set('trust proxy', ['127.0.0.1', 'loopback', 'linklocal', 'uniquelocal']);

// Global DDoS protection - MUST be applied early
app.use(ddosGuard.protect());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request ID and context middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Add request ID for tracing
  const rateLimitReq = req as RateLimitedRequest;
  rateLimitReq.requestId = req.get('X-Request-ID') || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // SECURE internal service detection - SECURITY HARDENED
  // Only trust localhost IPs, NOT spoofable headers
  const isInternalService = req.ip === '127.0.0.1' || req.ip === '::1';

  if (isInternalService) {
    rateLimitReq.userRole = 'internal';
    rateLimitReq.isAuthenticated = true;
    rateLimitReq.userId = 'internal-service';
  }

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (requestPath.startsWith("/api") || requestPath.startsWith("/v1")) {
      let logLine = `${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Core rate limiting middleware - applied to all routes except static assets
app.use((req, res, next) => {
  const requestPath = req.path;

  // Skip rate limiting for static assets
  if (requestPath.startsWith('/assets/') ||
    requestPath.startsWith('/favicon') ||
    requestPath.endsWith('.js') ||
    requestPath.endsWith('.css') ||
    requestPath.endsWith('.png') ||
    requestPath.endsWith('.jpg') ||
    requestPath.endsWith('.svg')) {
    return next();
  }

  // Apply rate limiting middleware
  const rateLimitMiddleware = createRateLimitMiddleware((req: RateLimitedRequest) => {
    // Determine policy based on route
    const policy = rateLimitConfig.getPolicyForRoute(req.method, req.path, {
      isInternal: req.userRole === 'internal',
      userAgent: req.get('User-Agent')
    });

    return policy;
  });

  rateLimitMiddleware(req, res, next);
});

// Setup authentication middleware AFTER rate limiting but BEFORE routes
setupAuth(app);

// ML Service management
let mlServiceProcess: ChildProcess | null = null;

/**
 * Health probe for external ML services with retry logic
 */
async function healthProbeExternalMLService(mlServiceUrl: string, maxRetries: number = 5): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`${mlServiceUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });
      if (response.ok) {
        log(`✅ External ML Service healthy at ${mlServiceUrl} (attempt ${attempt}/${maxRetries})`);
        return true;
      } else {
        log(`⚠️ External ML Service responded with status ${response.status} (attempt ${attempt}/${maxRetries})`);
      }
    } catch (error) {
      log(`⚠️ ML Service health check attempt ${attempt}/${maxRetries} failed: ${error}`);
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
  log(`❌ External ML Service at ${mlServiceUrl} failed all ${maxRetries} health check attempts`);
  return false;
}

/**
 * Setup ML service based on environment and configuration
 */
async function setupMLService(): Promise<void> {
  const ML_SERVICE_URL = process.env.ML_SERVICE_URL;
  const START_EMBEDDED_ML = process.env.START_EMBEDDED_ML === 'true';
  const isProduction = app.get("env") === "production";

  // Production configuration
  if (isProduction) {
    if (ML_SERVICE_URL) {
      log(`🔗 Using external ML Service at: ${ML_SERVICE_URL}`);
      const isHealthy = await healthProbeExternalMLService(ML_SERVICE_URL);
      if (!isHealthy) {
        log("❌ External ML Service is not healthy. Forecast generation may fail.");
      }
      return;
    } else if (START_EMBEDDED_ML) {
      log("🚀 Starting embedded ML service in production mode (START_EMBEDDED_ML=true)");
      await startEmbeddedMLService();
      return;
    } else {
      log("ℹ️ No ML service configured for production. Set ML_SERVICE_URL or START_EMBEDDED_ML=true");
      log("📋 Required environment variables for production:");
      log("   - ML_SERVICE_URL: URL of external ML service (e.g., http://ml-service:8000)");
      log("   - START_EMBEDDED_ML: Set to 'true' to auto-start embedded service");
      return;
    }
  }

  // Development mode - always start embedded service
  log("🔧 Development mode: starting embedded ML service");
  await startEmbeddedMLService();
}

/**
 * Start embedded ML service (internal Python service)
 */
async function startEmbeddedMLService(): Promise<void> {
  const ML_SERVICE_PORT = process.env.ML_SERVICE_PORT || '8000';
  const ML_SERVICE_HOST = process.env.ML_SERVICE_HOST || '0.0.0.0';

  log("🐍 Starting embedded Python ML Service...");

  // Check if ml-service directory exists
  const mlServicePath = path.join(process.cwd(), 'ml-service');
  if (!existsSync(mlServicePath)) {
    log("❌ ML service directory not found at: " + mlServicePath);
    return;
  }

  // Start Python ML service
  try {
    mlServiceProcess = spawn('python', ['-m', 'uvicorn', 'main:app',
      '--host', ML_SERVICE_HOST,
      '--port', ML_SERVICE_PORT,
      '--reload'], {
      cwd: mlServicePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ML_SERVICE_PORT, ML_SERVICE_HOST }
    });

    if (mlServiceProcess.stdout) {
      mlServiceProcess.stdout.on('data', (data) => {
        log(`[ML Service] ${data.toString().trim()}`);
      });
    }

    if (mlServiceProcess.stderr) {
      mlServiceProcess.stderr.on('data', (data) => {
        log(`[ML Service Error] ${data.toString().trim()}`);
      });
    }

    mlServiceProcess.on('error', (error) => {
      log(`❌ ML Service spawn error: ${error.message}`);
    });

    mlServiceProcess.on('exit', (code, signal) => {
      log(`ML Service exited with code ${code}, signal ${signal}`);
      mlServiceProcess = null;
    });

    // Wait a bit for service to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Simple health check
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`http://localhost:${ML_SERVICE_PORT}/health`, {
        method: 'GET',
        timeout: 5000
      });
      if (response.ok) {
        log(`✅ ML Service healthy at http://localhost:${ML_SERVICE_PORT}`);
      } else {
        log(`⚠️ ML Service responded with status ${response.status}`);
      }
    } catch (error) {
      log(`⚠️ ML Service health check failed (service may still be starting): ${error}`);
    }

  } catch (error) {
    log(`❌ Failed to start ML Service: ${error}`);
  }
}

// Cleanup on process exit
process.on('SIGINT', () => {
  log("🛑 Shutting down services...");
  if (mlServiceProcess) {
    mlServiceProcess.kill('SIGTERM');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  log("🛑 Shutting down services...");
  if (mlServiceProcess) {
    mlServiceProcess.kill('SIGTERM');
  }
  process.exit(0);
});

(async () => {
  // Create HTTP server first
  const httpServer = createServer(app);
  const server = await registerRoutes(app);

  // Initialize WebSocket service
  const wsService = new WebSocketService(httpServer);

  // Make WebSocket service available globally for broadcasting
  (globalThis as any).wsService = wsService;

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Setup ML service for both development and production
  await setupMLService();

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  // Use httpServer instead of server to support WebSocket
  httpServer.listen(port, "0.0.0.0", () => {
    log(`🚀 AgriIntel server running on port ${port}`);
    log(`📊 WebSocket endpoint: ws://localhost:${port}/api/ws`);
    log(`🔌 WebSocket stats: ${JSON.stringify(wsService.getStats(), null, 2)}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('🛑 SIGTERM received, shutting down gracefully');
    wsService.cleanup();
    httpServer.close(() => {
      log('🔌 HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    log('🛑 SIGINT received, shutting down gracefully');
    wsService.cleanup();
    httpServer.close(() => {
      log('🔌 HTTP server closed');
      process.exit(0);
    });
  });
})();
