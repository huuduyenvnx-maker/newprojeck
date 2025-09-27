import { storage } from "./storage";
import { type InsertPriceData } from "@shared/schema";

/**
 * Simple seed for the old priceData table that doesn't have foreign key constraints
 * This will allow us to test the forecast generation without complex schema issues
 */
export async function simpleHistoricalSeed(): Promise<void> {
  console.log("🌱 Creating simple historical data seed...");
  
  // Target commodity and region (Jasmine Rice in Mekong Delta)
  const commodityId = "d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a";
  const regionId = "947d75c0-1766-4270-a81b-512c29599e00";
  
  // Generate 75 days of historical price data
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 75);
  
  const priceDataRecords: InsertPriceData[] = [];
  
  // Base price for Jasmine Rice in USD/ton
  let basePrice = 580;
  const volatility = 0.04; // 4% daily volatility
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const currentDate = new Date(d);
    
    // Simulate realistic price movement
    const trend = 0.0002; // Slight upward trend
    const dailyChange = (Math.random() - 0.5) * volatility * 2;
    basePrice = basePrice * (1 + trend + dailyChange);
    
    // Add seasonal variation
    const dayOfYear = Math.floor((currentDate.getTime() - new Date(currentDate.getFullYear(), 0, 0).getTime()) / 86400000);
    const seasonalFactor = 1 + 0.03 * Math.sin((dayOfYear / 365) * 2 * Math.PI);
    const finalPrice = Math.round(basePrice * seasonalFactor * 100) / 100;
    
    const priceRecord: InsertPriceData = {
      commodityId,
      regionId,
      date: currentDate,
      price: finalPrice.toString(),
      currency: "USD",
      source: "historical_seed",
      quality: "0.95",
      metadata: {
        generated: true,
        seed_date: new Date().toISOString(),
        volatility: volatility,
        base_price: 580
      }
    };
    
    priceDataRecords.push(priceRecord);
  }
  
  console.log(`📊 Generated ${priceDataRecords.length} historical price records`);
  console.log(`📅 Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`💰 Price range: $${Math.min(...priceDataRecords.map(p => parseFloat(p.price))).toFixed(2)} - $${Math.max(...priceDataRecords.map(p => parseFloat(p.price))).toFixed(2)}/ton`);
  
  // Insert records one by one to handle any duplicates
  let insertedCount = 0;
  for (const record of priceDataRecords) {
    try {
      await storage.createPriceData(record);
      insertedCount++;
    } catch (error) {
      // Skip duplicates
      if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
        console.log(`⚠️ Error inserting price for ${record.date}: ${error.message}`);
      }
    }
  }
  
  console.log(`✅ Successfully inserted ${insertedCount} price records`);
  
  // Verify the data
  const verificationData = await storage.getPriceData(commodityId, regionId);
  console.log(`🔍 Verification: Found ${verificationData.length} total price records in database`);
  
  if (verificationData.length >= 60) {
    console.log("🎉 SUCCESS: Historical data seeding completed! Ready for forecast testing.");
    console.log(`   - Commodity: Jasmine Rice (${commodityId})`);
    console.log(`   - Region: Mekong Delta (${regionId})`);
    console.log(`   - Records: ${verificationData.length} data points`);
  } else {
    console.log(`⚠️ Warning: Only ${verificationData.length} records found, may need more for reliable forecasting`);
  }
}

// Run the seed function
simpleHistoricalSeed()
  .then(() => {
    console.log("✅ Simple seeding completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Simple seeding failed:", error);
    process.exit(1);
  });