/**
 * Migration script to safely add cooperative structure to existing data
 * This handles the data migration before schema changes
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export async function migrateToCooperativeStructure() {
  console.log("🚀 Starting cooperative data migration...");
  
  try {
    // Step 1: Create the new cooperative tables first (without coop_id columns yet)
    console.log("📋 Step 1: Creating cooperative tables...");
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cooperatives (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        active boolean NOT NULL DEFAULT true,
        metadata jsonb,
        created_at timestamp DEFAULT now()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cooperative_members (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        coop_id varchar NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
        user_id varchar NOT NULL,
        role text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        joined_at timestamp DEFAULT now(),
        invited_by varchar
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS profiles (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL UNIQUE,
        default_coop_id varchar REFERENCES cooperatives(id) ON DELETE SET NULL,
        full_name text,
        phone_number text,
        preferred_language text NOT NULL DEFAULT 'vi',
        timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        metadata jsonb,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS export_audit (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        coop_id varchar NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
        user_id varchar NOT NULL,
        export_type text NOT NULL,
        summary text NOT NULL,
        record_counts jsonb NOT NULL,
        filters jsonb NOT NULL,
        file_format text NOT NULL,
        file_size integer,
        ip_address text,
        user_agent text,
        created_at timestamp DEFAULT now()
      );
    `);

    // Step 2: Create default cooperative for existing data
    console.log("🏢 Step 2: Creating default cooperative...");
    
    const [defaultCoop] = await db.execute(sql`
      INSERT INTO cooperatives (name, slug, active, metadata)
      VALUES (
        'Hợp tác xã Mặc định',
        'default-coop',
        true,
        '{"description": "Hợp tác xã mặc định cho dữ liệu hiện có", "migration": true}'
      )
      RETURNING id;
    `);

    const defaultCoopId = defaultCoop.rows[0]?.id;
    if (!defaultCoopId) {
      throw new Error("Failed to create default cooperative");
    }

    console.log(`✅ Created default cooperative with ID: ${defaultCoopId}`);

    // Step 3: Add coop_id columns as nullable first
    console.log("📊 Step 3: Adding coop_id columns as nullable...");
    
    const tables = [
      'price_data', 'forecasts', 'llm_verifications', 'alerts', 
      'trading_recommendations', 'sources', 'prices_raw', 'prices_verified',
      'fx_rates', 'forecast_runs', 'forecasts_30d', 'evidence',
      'composite_confidence_scores', 'quality_gates', 'agreement_analysis'
    ];

    for (const table of tables) {
      try {
        await db.execute(sql.raw(`
          ALTER TABLE ${table} 
          ADD COLUMN IF NOT EXISTS coop_id varchar REFERENCES cooperatives(id) ON DELETE CASCADE;
        `));
        console.log(`  ✓ Added coop_id to ${table}`);
      } catch (error) {
        console.log(`  ⚠️ ${table} coop_id column may already exist: ${error.message}`);
      }
    }

    // Step 4: Update all existing records with default coop_id
    console.log("🔄 Step 4: Updating existing records with default cooperative...");
    
    for (const table of tables) {
      try {
        const result = await db.execute(sql.raw(`
          UPDATE ${table} 
          SET coop_id = '${defaultCoopId}' 
          WHERE coop_id IS NULL;
        `));
        console.log(`  ✓ Updated ${result.rowCount || 0} records in ${table}`);
      } catch (error) {
        console.log(`  ⚠️ Error updating ${table}: ${error.message}`);
      }
    }

    // Step 5: Make coop_id columns NOT NULL
    console.log("🔒 Step 5: Making coop_id columns NOT NULL...");
    
    for (const table of tables) {
      try {
        await db.execute(sql.raw(`
          ALTER TABLE ${table} 
          ALTER COLUMN coop_id SET NOT NULL;
        `));
        console.log(`  ✓ Made coop_id NOT NULL in ${table}`);
      } catch (error) {
        console.log(`  ⚠️ Error setting NOT NULL on ${table}: ${error.message}`);
      }
    }

    // Step 6: Create indexes for performance
    console.log("🔍 Step 6: Creating cooperative indexes...");
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_price_data_coop ON price_data(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_forecasts_coop ON forecasts(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_llm_verifications_coop ON llm_verifications(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_alerts_coop ON alerts(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_trading_recommendations_coop ON trading_recommendations(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_sources_coop ON sources(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_prices_raw_coop ON prices_raw(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_prices_verified_coop ON prices_verified(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_fx_rates_coop ON fx_rates(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_forecast_runs_coop ON forecast_runs(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_forecasts_30d_coop ON forecasts_30d(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_evidence_coop ON evidence(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_ccs_coop ON composite_confidence_scores(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_quality_gates_coop ON quality_gates(coop_id);',
      'CREATE INDEX IF NOT EXISTS idx_agreement_analysis_coop ON agreement_analysis(coop_id);',
    ];

    for (const indexSql of indexes) {
      try {
        await db.execute(sql.raw(indexSql));
      } catch (error) {
        console.log(`  ⚠️ Index creation warning: ${error.message}`);
      }
    }

    // Step 7: Create a default admin user in the cooperative
    console.log("👤 Step 7: Creating default cooperative membership...");
    
    await db.execute(sql`
      INSERT INTO cooperative_members (coop_id, user_id, role, active)
      VALUES (${defaultCoopId}, 'system-admin', 'admin', true)
      ON CONFLICT DO NOTHING;
    `);

    console.log("✅ Cooperative data migration completed successfully!");
    console.log(`📊 Default cooperative ID: ${defaultCoopId}`);
    console.log("🔗 All existing data has been linked to the default cooperative");
    console.log("👥 Ready for Supabase Auth integration");

    return { success: true, defaultCoopId };

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToCooperativeStructure()
    .then(() => {
      console.log("🎉 Migration completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Migration failed:", error);
      process.exit(1);
    });
}