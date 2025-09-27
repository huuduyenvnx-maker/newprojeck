import { storage } from "./storage";
import { type InsertPricesRaw, type InsertPricesVerified } from "@shared/schema";
import { v4 as uuidv4 } from 'uuid';

/**
 * Seed historical price data for testing ML forecasting
 * Creates 60+ verified price points for Jasmine Rice in Mekong Delta
 */
export async function seedHistoricalPriceData(): Promise<void> {
  console.log("🌱 Starting historical price data seeding...");
  
  // Target commodity and region
  const commodityId = "d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a"; // Jasmine Rice
  const regionId = "947d75c0-1766-4270-a81b-512c29599e00"; // Mekong Delta
  
  // Create a synthetic source for seed data
  const sourceId = "seed-source-001";
  
  try {
    // Create a simple source for our seed data (work around column issue)
    const sourceData = {
      id: sourceId,
      name: "Historical Data Seeder",
      type: "manual" as const,
      frequency: "daily" as const,
      reliability: "1.0",
      isActive: true,
      metadata: { purpose: "seed_data", created_by: "system" }
    };
    
    // Skip source creation due to schema issues - use existing source or dummy ID
    console.log("⚠️ Skipping source creation due to schema constraints, using dummy sourceId");
    
    // Generate historical price data for the last 90 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 90);
    
    const rawPricesData: InsertPricesRaw[] = [];
    const verifiedPricesData: InsertPricesVerified[] = [];
    
    // Base price for Jasmine Rice in USD/ton
    let basePrice = 580; // Starting price around $580/ton
    const volatility = 0.05; // 5% daily volatility
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const currentDate = new Date(d);
      
      // Simulate realistic price movement with trend and noise
      const trend = 0.0003; // Slight upward trend
      const dailyChange = (Math.random() - 0.5) * volatility * 2; // Random walk
      basePrice = basePrice * (1 + trend + dailyChange);
      
      // Add some seasonal variation
      const dayOfYear = Math.floor((currentDate.getTime() - new Date(currentDate.getFullYear(), 0, 0).getTime()) / 86400000);
      const seasonalFactor = 1 + 0.03 * Math.sin((dayOfYear / 365) * 2 * Math.PI); // ±3% seasonal variation
      const finalPrice = Math.round(basePrice * seasonalFactor * 100) / 100;
      
      const rawId = uuidv4();
      
      // Create raw price data
      const rawPrice: InsertPricesRaw = {
        id: rawId,
        sourceId,
        commodityId,
        regionId,
        date: currentDate,
        price: finalPrice.toString(),
        currency: "USD",
        volume: (Math.random() * 1000 + 500).toString(), // Random volume 500-1500 tons
        unit: "USD/ton",
        rawData: {
          source: "seed_generator",
          quality: "synthetic",
          generated_at: new Date().toISOString()
        },
        isProcessed: true
      };
      
      // Create verified price data
      const verifiedPrice: InsertPricesVerified = {
        pricesRawId: rawId,
        sourceId,
        commodityId,
        regionId,
        date: currentDate,
        price: finalPrice.toString(),
        priceUsd: finalPrice.toString(),
        currency: "USD",
        volume: rawPrice.volume,
        qualityScore: "0.95", // High quality score for seed data
        verificationMethod: "automatic",
        outlierFlag: false,
        adjustments: null,
        verifiedBy: "system"
      };
      
      rawPricesData.push(rawPrice);
      verifiedPricesData.push(verifiedPrice);
    }
    
    console.log(`📊 Generated ${rawPricesData.length} price points from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Skip raw prices and insert verified prices directly
    console.log("💾 Inserting verified price data directly...");
    
    // Use individual inserts to avoid constraint issues
    let insertedCount = 0;
    for (const verifiedPrice of verifiedPricesData) {
      try {
        // Check if this price already exists
        const existing = await storage.getPricesVerified(commodityId, regionId, verifiedPrice.date, verifiedPrice.date);
        if (existing.length === 0) {
          await storage.createPricesVerified(verifiedPrice);
          insertedCount++;
        }
      } catch (error) {
        // Skip duplicates or constraint violations
        console.log(`⚠️ Skipped price for ${verifiedPrice.date}: ${error.message}`);
      }
    }
    console.log(`✅ Inserted ${insertedCount} verified price records`);
    
    // Verify the data was inserted correctly
    const verificationCheck = await storage.getPricesVerified(commodityId, regionId);
    console.log(`🔍 Verification: Found ${verificationCheck.length} verified prices in database`);
    
    if (verificationCheck.length >= 60) {
      console.log("🎉 SUCCESS: Historical data seeding completed! Ready for ML forecasting.");
      console.log(`   - Commodity: Jasmine Rice (${commodityId})`);
      console.log(`   - Region: Mekong Delta (${regionId})`);
      console.log(`   - Price range: $${Math.min(...verifiedPricesData.map(p => parseFloat(p.price))).toFixed(2)} - $${Math.max(...verifiedPricesData.map(p => parseFloat(p.price))).toFixed(2)}/ton`);
      console.log(`   - Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    } else {
      throw new Error(`Insufficient data created: only ${verificationCheck.length} points, need at least 60`);
    }
    
  } catch (error) {
    console.error("❌ Failed to seed historical data:", error);
    throw error;
  }
}

// Export for use as module
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Only run if this file is executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedHistoricalPriceData()
    .then(() => {
      console.log("✅ Seeding completed successfully");
      process.exit(0);
    })
    .catch(error => {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    });
}