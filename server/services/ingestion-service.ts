import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { 
  pricesRaw, 
  qualityQueue, 
  commodities, 
  regions, 
  sources,
  type InsertPricesRaw,
  type InsertQualityQueue,
  type Commodity,
  type Region
} from '../../shared/schema';
// import { ValidationPipeline } from './validation-pipeline'; // Will create next

// Temporary ValidationPipeline stub until we create the full implementation
class ValidationPipeline {
  async processQueueEntry(queueId: string): Promise<void> {
    console.log(`[ValidationPipeline] Processing queue entry: ${queueId}`);
    // TODO: Implement full validation pipeline
  }
}
import { createHash } from 'crypto';
import { z } from 'zod';
import { toZonedTime, format, zonedTimeToUtc } from 'date-fns-tz';\nimport { startOfDay } from 'date-fns';

// Raw price data schema for ingestion
const RawPriceInputSchema = z.object({
  sourceId: z.string(),
  commoditySlug: z.string(),
  regionName: z.string(),
  date: z.string().datetime(), // ISO 8601 format
  price: z.number().positive(),
  currency: z.string().length(3), // ISO 4217 currency codes
  unit: z.string(),
  volume: z.number().optional(),
  rawData: z.record(z.any()).optional(), // Original data from source
});

type RawPriceInput = z.infer<typeof RawPriceInputSchema>;

interface NormalizedPrice {
  sourceId: string;
  commodityId: string;
  regionId: string;
  date: Date;
  price: number;
  priceUsd: number;
  currency: string;
  unit: string;
  volume?: number;
  rawData?: Record<string, any>;
}

interface IngestionResult {
  success: boolean;
  processed: number;
  skipped: number;
  errors: Array<{
    input: RawPriceInput;
    error: string;
  }>;
  created: {
    pricesRaw: number;
    qualityQueue: number;
  };
}

// Centralized conversion service with Vietnamese market specifics
class ConversionService {
  // Currency conversion rates (simplified - in production would use real FX service)
  private static readonly CURRENCY_RATES: Record<string, number> = {
    'USD': 1.0,
    'VND': 0.000041, // 1 VND = 0.000041 USD (example rate)
    'EUR': 1.08,
    'CNY': 0.14,
    'THB': 0.028,
    'MYR': 0.22,
    'JPY': 0.0067,
  };

  // Unit conversion to standardized USD/ton
  private static readonly UNIT_CONVERSIONS: Record<string, number> = {
    'USD/ton': 1.0,
    'USD/t': 1.0,
    'USD/kg': 1000.0,
    'VND/kg': 1000.0,
    'EUR/ton': 1.0,
    'CNY/ton': 1.0,
    'cents/lb': 22.046, // Convert cents/lb to USD/ton
    'USD/bushel': 36.74, // Approximate for soybeans
  };

  static convertToUsdPerTon(price: number, currency: string, unit: string): number {
    const currencyRate = this.CURRENCY_RATES[currency];
    if (!currencyRate) {
      throw new Error(`Unsupported currency: ${currency}`);
    }

    const unitConversion = this.UNIT_CONVERSIONS[unit];
    if (!unitConversion) {
      throw new Error(`Unsupported unit: ${unit}`);
    }

    return price * currencyRate * unitConversion;
  }

  static roundToDecimals(value: number, decimals: number): string {
    return value.toFixed(decimals);
  }

  static normalizeTimestamp(timestamp: string, timezone: string): Date {
    // Parse input timestamp and convert to target timezone
    const inputDate = new Date(timestamp);
    if (isNaN(inputDate.getTime())) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }

    // Convert to target timezone (e.g., Asia/Ho_Chi_Minh)
    const zonedDate = toZonedTime(inputDate, timezone);
    
    // Normalize to start of day in target timezone
    const startOfDayZoned = startOfDay(zonedDate);
    
    // Convert back to UTC for consistent database storage
    const utcDate = zonedTimeToUtc(startOfDayZoned, timezone);
    
    return utcDate;
  }
}

export class IngestionService {
  private validationPipeline: ValidationPipeline;
  private commodityCache = new Map<string, Commodity>();
  private regionCache = new Map<string, Region>();
  private cacheInitialized: Promise<void>;

  constructor() {
    this.validationPipeline = new ValidationPipeline();
    this.cacheInitialized = this.preloadCaches();
  }

  /**
   * Preload commodity and region caches for performance
   */
  private async preloadCaches(): Promise<void> {
    try {
      const [commoditiesData, regionsData] = await Promise.all([
        db.select().from(commodities).where(eq(commodities.isActive, true)),
        db.select().from(regions)
      ]);

      this.commodityCache.clear();
      this.regionCache.clear();

      commoditiesData.forEach(commodity => {
        this.commodityCache.set(commodity.slug, commodity);
      });

      regionsData.forEach(region => {
        this.regionCache.set(region.name, region);
      });

      console.log(`[IngestionService] Cached ${commoditiesData.length} commodities and ${regionsData.length} regions`);
    } catch (error) {
      console.error('[IngestionService] Failed to preload caches:', error);
    }
  }

  /**
   * Main ingestion method for batch processing
   */
  async ingestPrices(
    coopId: string,
    inputs: RawPriceInput[],
    options: {
      skipValidation?: boolean;
      forceOverwrite?: boolean;
      batchSize?: number;
    } = {}
  ): Promise<IngestionResult> {
    const { skipValidation = false, forceOverwrite = false, batchSize = 100 } = options;
    
    const result: IngestionResult = {
      success: true,
      processed: 0,
      skipped: 0,
      errors: [],
      created: {
        pricesRaw: 0,
        qualityQueue: 0
      }
    };

    console.log(`[IngestionService] Starting ingestion of ${inputs.length} price records for coop ${coopId}`);

    // Process in batches to avoid memory issues
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchResult = await this.processBatch(coopId, batch, { skipValidation, forceOverwrite });
      
      // Aggregate results
      result.processed += batchResult.processed;
      result.skipped += batchResult.skipped;
      result.errors.push(...batchResult.errors);
      result.created.pricesRaw += batchResult.created.pricesRaw;
      result.created.qualityQueue += batchResult.created.qualityQueue;
      
      if (batchResult.errors.length > batch.length * 0.5) {
        console.warn(`[IngestionService] High error rate in batch ${i / batchSize + 1}: ${batchResult.errors.length}/${batch.length} failed`);
      }
    }

    result.success = result.errors.length < inputs.length * 0.8; // Success if <80% errors
    
    console.log(`[IngestionService] Ingestion completed:`, {
      total: inputs.length,
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors.length,
      created: result.created
    });

    return result;
  }

  /**
   * Process a single batch of raw price inputs
   */
  private async processBatch(
    coopId: string,
    inputs: RawPriceInput[],
    options: { skipValidation: boolean; forceOverwrite: boolean }
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      success: true,
      processed: 0,
      skipped: 0,
      errors: [],
      created: { pricesRaw: 0, qualityQueue: 0 }
    };

    const normalizedPrices: NormalizedPrice[] = [];
    
    // Step 1: Validate and normalize inputs
    for (const input of inputs) {
      try {
        // Validate input schema
        const validated = RawPriceInputSchema.parse(input);
        
        // Normalize the price data
        const normalized = await this.normalizePrice(validated);
        if (normalized) {
          normalizedPrices.push(normalized);
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.errors.push({
          input,
          error: error instanceof Error ? error.message : 'Unknown validation error'
        });
      }
    }

    if (normalizedPrices.length === 0) {
      return result;
    }

    // Step 2: Check for duplicates and insert into prices_raw
    const pricesRawData: InsertPricesRaw[] = [];
    
    for (const normalized of normalizedPrices) {
      // Generate deduplication hash
      const dedupHash = this.generateDedupHash(normalized);
      
      // Check for existing record
      if (!options.forceOverwrite) {
        const existing = await db.select()
          .from(pricesRaw)
          .where(and(
            eq(pricesRaw.coopId, coopId),
            eq(pricesRaw.sourceId, normalized.sourceId),
            eq(pricesRaw.commodityId, normalized.commodityId),
            eq(pricesRaw.regionId, normalized.regionId),
            eq(pricesRaw.date, normalized.date),
            eq(pricesRaw.unit, normalized.unit)
          ))
          .limit(1);

        if (existing.length > 0) {
          result.skipped++;
          continue;
        }
      }

      pricesRawData.push({
        coopId,
        sourceId: normalized.sourceId,
        commodityId: normalized.commodityId,
        regionId: normalized.regionId,
        date: normalized.date,
        price: normalized.price.toString(),
        currency: normalized.currency,
        unit: normalized.unit,
        volume: normalized.volume?.toString(),
        rawData: {
          ...normalized.rawData,
          dedupHash,
          priceUsd: normalized.priceUsd,
          normalizedAt: new Date().toISOString()
        },
        isProcessed: false
      });
    }

    // Step 3 & 4: Insert into prices_raw and quality_queue in transaction
    let insertedRaw: Array<{ id: string }> = [];
    let insertedQueue: Array<{ id: string }> = [];
    
    if (pricesRawData.length > 0) {
      await db.transaction(async (tx) => {
        // Step 3a: Insert into prices_raw with upsert for forceOverwrite
        if (options.forceOverwrite) {
          // Use onConflictDoUpdate for upsert when forceOverwrite is true
          insertedRaw = await tx.insert(pricesRaw)
            .values(pricesRawData)
            .onConflictDoUpdate({
              target: [
                pricesRaw.coopId,
                pricesRaw.sourceId,
                pricesRaw.commodityId,
                pricesRaw.regionId,
                pricesRaw.date,
                pricesRaw.unit
              ],
              set: {
                price: sql`EXCLUDED.price`,
                currency: sql`EXCLUDED.currency`,
                volume: sql`EXCLUDED.volume`,
                rawData: sql`EXCLUDED.raw_data`,
                isProcessed: sql`EXCLUDED.is_processed`
              }
            })
            .returning({ id: pricesRaw.id });
        } else {
          // Regular insert for non-overwrite mode
          insertedRaw = await tx.insert(pricesRaw)
            .values(pricesRawData)
            .returning({ id: pricesRaw.id });
        }
        
        // Step 3b: Create quality queue entries for validation pipeline
        if (!options.skipValidation && insertedRaw.length > 0) {
          const qualityQueueData: InsertQualityQueue[] = [];
          
          for (let i = 0; i < insertedRaw.length; i++) {
            const rawId = insertedRaw[i].id;
            const normalized = normalizedPrices[i];
            
            qualityQueueData.push({
              coopId,
              pricesRawId: rawId,
              sourceId: normalized.sourceId,
              commodityId: normalized.commodityId,
              regionId: normalized.regionId,
              date: normalized.date,
              price: normalized.price.toString(),
              priceUsd: normalized.priceUsd.toString(),
              currency: normalized.currency,
              unit: normalized.unit,
              ingestionStatus: 'processing',
              validationL1L7Status: 'pending',
              llmVerificationStatus: 'pending',
              qualityGateStatus: 'pending',
              processingAttempts: 0
            });
          }

          insertedQueue = await tx.insert(qualityQueue)
            .values(qualityQueueData)
            .returning({ id: qualityQueue.id });
        }
      });
      
      result.created.pricesRaw = insertedRaw.length;
      result.created.qualityQueue = insertedQueue.length;
      result.processed += insertedRaw.length;

      // Step 5: Trigger validation pipeline (async)
      if (insertedQueue.length > 0) {
        this.triggerValidationPipeline(insertedQueue.map(q => q.id));
      }
    }

    return result;
  }

  /**
   * Normalize raw price data to standard format
   */
  private async normalizePrice(input: RawPriceInput): Promise<NormalizedPrice | null> {
    // Find commodity by slug
    const commodity = this.commodityCache.get(input.commoditySlug);
    if (!commodity) {
      throw new Error(`Unknown commodity slug: ${input.commoditySlug}`);
    }

    // Find region by name
    const region = this.regionCache.get(input.regionName);
    if (!region) {
      throw new Error(`Unknown region: ${input.regionName}`);
    }

    // Normalize date to commodity timezone
    const date = ConversionService.normalizeTimestamp(input.date, commodity.timezone);

    // Convert price to USD/ton using centralized service
    const priceUsd = ConversionService.convertToUsdPerTon(input.price, input.currency, input.unit);

    // Validate price sanity
    if (priceUsd <= 0 || priceUsd > 1000000) {
      throw new Error(`Price out of reasonable range: ${priceUsd} USD/ton`);
    }

    // Round prices to commodity decimals
    const roundedPrice = ConversionService.roundToDecimals(input.price, commodity.decimals);
    const roundedPriceUsd = ConversionService.roundToDecimals(priceUsd, commodity.decimals);

    return {
      sourceId: input.sourceId,
      commodityId: commodity.id,
      regionId: region.id,
      date,
      price: parseFloat(roundedPrice),
      priceUsd: parseFloat(roundedPriceUsd),
      currency: input.currency,
      unit: input.unit,
      volume: input.volume,
      rawData: input.rawData
    };
  }

  /**
   * Generate deduplication hash for price record
   */
  private generateDedupHash(normalized: NormalizedPrice): string {
    const content = [
      normalized.sourceId,
      normalized.commodityId,
      normalized.regionId,
      normalized.date.toISOString(),
      normalized.currency,
      normalized.unit,
      normalized.price.toString()
    ].join('|');

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Trigger validation pipeline for quality queue entries
   */
  private async triggerValidationPipeline(queueIds: string[]): Promise<void> {
    // Process validation asynchronously to avoid blocking ingestion
    setImmediate(async () => {
      try {
        for (const queueId of queueIds) {
          await this.validationPipeline.processQueueEntry(queueId);
        }
      } catch (error) {
        console.error('[IngestionService] Validation pipeline error:', error);
      }
    });
  }

  /**
   * Get ingestion statistics
   */
  async getIngestionStats(coopId: string, hours: number = 24): Promise<{
    totalIngested: number;
    totalVerified: number;
    totalInQueue: number;
    successRate: number;
    avgProcessingTime: number;
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [rawCount, queueCount] = await Promise.all([
      db.select().from(pricesRaw)
        .where(and(
          eq(pricesRaw.coopId, coopId),
          // eq(pricesRaw.createdAt, since) // Uncomment when date filtering is needed
        )),
      db.select().from(qualityQueue)
        .where(and(
          eq(qualityQueue.coopId, coopId),
          // eq(qualityQueue.createdAt, since) // Uncomment when date filtering is needed
        ))
    ]);

    const verifiedCount = queueCount.filter(q => q.qualityGateStatus === 'passed').length;
    const pendingCount = queueCount.filter(q => q.qualityGateStatus === 'pending').length;

    return {
      totalIngested: rawCount.length,
      totalVerified: verifiedCount,
      totalInQueue: pendingCount,
      successRate: rawCount.length > 0 ? verifiedCount / rawCount.length : 0,
      avgProcessingTime: 0 // TODO: Calculate from processing logs
    };
  }

  /**
   * Reprocess failed quality queue entries
   */
  async reprocessFailedEntries(coopId: string, maxAttempts: number = 3): Promise<number> {
    const failedEntries = await db.select()
      .from(qualityQueue)
      .where(and(
        eq(qualityQueue.coopId, coopId),
        eq(qualityQueue.qualityGateStatus, 'failed')
      ));

    const eligibleForRetry = failedEntries.filter(entry => 
      entry.processingAttempts < maxAttempts
    );

    console.log(`[IngestionService] Reprocessing ${eligibleForRetry.length} failed entries`);

    for (const entry of eligibleForRetry) {
      await this.validationPipeline.processQueueEntry(entry.id);
    }

    return eligibleForRetry.length;
  }
}