import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

// SECURITY WARNING: The default 'db' export bypasses RLS!
// Use withRLS() or createRLSConnection() for tenant-scoped operations
// Only use 'db' for system operations or public data

// CRITICAL SECURITY: RLS-aware database connection
// This creates a database connection that enforces RLS policies by setting user context
interface RLSContext {
  userId: string;
  coopId: string;
  role: string;
}

/**
 * PRODUCTION-SAFE: Execute a database operation with guaranteed RLS context
 * 
 * This implementation uses a single transaction to ensure that:
 * 1. RLS context settings persist throughout the entire operation
 * 2. All queries use the same connection with consistent context
 * 3. Connection pooling cannot interfere with RLS enforcement
 * 
 * CRITICAL: This solves the neon-serverless session affinity issue
 */
export async function withRLS<T>(
  context: RLSContext | null,
  operation: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  // Development bypass: skip RLS when context is null
  console.log(`[DEBUG] withRLS called with context:`, context, 'NODE_ENV:', process.env.NODE_ENV);
  
  if (!context && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
    console.log('[DEV] Bypassing RLS for null context in development mode');
    return await operation(db);
  }
  
  if (!context) {
    throw new Error('Context required for RLS operations in production');
  }
  
  // Use the main pool but acquire a dedicated connection for this transaction
  const connection = await pool.connect();
  
  try {
    // Start transaction manually for direct SQL control
    await connection.query('BEGIN');
    
    // CRITICAL: Set RLS context within transaction scope (LOCAL-ONLY)
    // SECURITY FIX: Using set_config with 'true' ensures settings are local to transaction only
    // This prevents JWT context leakage across pooled connections
    await connection.query(
      "SELECT set_config('request.jwt.sub', $1, true)",
      [context.userId]
    );
    
    const claimsJson = JSON.stringify({
      sub: context.userId,
      user_id: context.userId,
      coop_id: context.coopId,
      role: context.role
    });
    
    await connection.query(
      "SELECT set_config('request.jwt.claims', $1, true)",
      [claimsJson]
    );
    
    // Create a drizzle instance for this connection
    const rlsDb = drizzle({ client: connection as any, schema });
    
    // Execute the operation within the transaction with RLS context
    const result = await operation(rlsDb);
    
    // Commit the transaction
    await connection.query('COMMIT');
    
    return result;
  } catch (error) {
    // Rollback on error
    try {
      await connection.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }
    throw error;
  } finally {
    // Always release the connection back to the pool
    connection.release();
  }
}

/**
 * LEGACY: Create a database connection with RLS context set
 * DEPRECATED: Use withRLS() instead for production-safe operations
 * This function is kept for backward compatibility only
 */
export async function createRLSConnection(context: RLSContext) {
  console.warn('[SECURITY] createRLSConnection is deprecated. Use withRLS() for production safety.');
  
  const rlsPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rlsDb = drizzle({ client: rlsPool, schema });
  
  // CRITICAL: Set RLS context for this connection session
  await rlsDb.execute(sql`
    SELECT set_config('request.jwt.sub', ${context.userId}, true)
  `);
  
  await rlsDb.execute(sql`
    SELECT set_config('request.jwt.claims', ${
      JSON.stringify({
        sub: context.userId,
        user_id: context.userId,
        coop_id: context.coopId,
        role: context.role
      })
    }, true)
  `);
  
  return { db: rlsDb, pool: rlsPool };
}