import { storage } from '../storage';
import { currencyConverter } from './currency-converter';
import { DataValidator, ValidationConfigFactory, ValidationResult } from './validation';
import DataFetcherFactory from './fetchers';
import { Source, InsertPricesRaw, InsertPricesVerified, Commodity, Region } from '@shared/schema';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Types for ingestion pipeline
export interface IngestionResult {
  success: boolean;
  sourceId: string;
  sourceName: string;
  fetchedRecords: number;
  validRecords: number;
  rawInserted: number;
  verifiedInserted: number;
  errors: string[];
  warnings: string[];
  duration: number;
  validationResults?: ValidationResult;
  metrics: IngestionMetrics;
}

export interface IngestionMetrics {
  startTime: Date;
  endTime: Date;
  duration: number;
  recordsProcessed: number;
  recordsValid: number;
  recordsFailed: number;
  duplicatesSkipped: number;
  currencyConversions: number;
  validationScore: number;
}

export interface IngestionConfig {
  sourceId?: string;
  dryRun?: boolean;
  forceRefresh?: boolean;
  skipValidation?: boolean;
  maxRecords?: number;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ProcessedRecord {
  raw: InsertPricesRaw;
  verified?: InsertPricesVerified;
  errors: string[];
  warnings: string[];
  hash: string;
}

// Main Data Ingestion Pipeline Service
export class DataIngestionPipeline {
  private sourcesConfig: any;
  private commodityCache = new Map<string, Commodity>();
  private regionCache = new Map<string, Region>();

  constructor() {
    this.loadSourcesConfig();
  }

  // Load sources configuration from YAML
  private loadSourcesConfig(): void {
    try {
      const configPath = path.join(process.cwd(), 'config', 'sources.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      this.sourcesConfig = yaml.load(configContent);
      console.log(`Loaded sources configuration with ${Object.keys(this.sourcesConfig.sources || {}).length} sources`);
    } catch (error: any) {
      console.error('Failed to load sources configuration:', error.message);
      this.sourcesConfig = { sources: {}, fx_sources: {} };
    }
  }

  // Run ingestion for all active sources
  async runIngestionForAllSources(config: IngestionConfig = {}): Promise<IngestionResult[]> {
    console.log('Starting ingestion pipeline for all active sources');
    
    const results: IngestionResult[] = [];
    
    try {
      // Get all active sources from database
      const sources = await storage.getActiveSources();
      console.log(`Found ${sources.length} active sources`);

      // Process sources in chunks to properly limit concurrency
      const batchSize = 3; // Process 3 sources concurrently
      
      for (let i = 0; i < sources.length; i += batchSize) {
        const batch = sources.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(sources.length/batchSize)} with ${batch.length} sources`);
        
        // Create promises only for current batch
        const batchPromises = batch.map(source => this.runIngestionForSource(source.id, config));
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            console.error('Source ingestion failed:', result.reason);
          }
        }
        
        // Add a small delay between batches to prevent overwhelming external APIs
        if (i + batchSize < sources.length) {
          console.log('Waiting 2 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Log overall summary
      const totalFetched = results.reduce((sum, r) => sum + r.fetchedRecords, 0);
      const totalValid = results.reduce((sum, r) => sum + r.validRecords, 0);
      const successfulSources = results.filter(r => r.success).length;
      
      console.log(`Ingestion completed: ${successfulSources}/${results.length} sources successful, ${totalFetched} records fetched, ${totalValid} valid`);

    } catch (error: any) {
      console.error('Ingestion pipeline failed:', error.message);
    }

    return results;
  }

  // Run ingestion for a specific source
  async runIngestionForSource(sourceId: string, config: IngestionConfig = {}): Promise<IngestionResult> {
    const startTime = Date.now();
    const result: IngestionResult = {
      success: false,
      sourceId,
      sourceName: '',
      fetchedRecords: 0,
      validRecords: 0,
      rawInserted: 0,
      verifiedInserted: 0,
      errors: [],
      warnings: [],
      duration: 0,
      metrics: {
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        recordsProcessed: 0,
        recordsValid: 0,
        recordsFailed: 0,
        duplicatesSkipped: 0,
        currencyConversions: 0,
        validationScore: 0
      }
    };

    try {
      console.log(`Starting ingestion for source: ${sourceId}`);

      // 1. Get source configuration
      const source = await storage.getSource(sourceId);
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      
      if (!source.isActive) {
        throw new Error(`Source is inactive: ${source.name}`);
      }

      result.sourceName = source.name;

      // 2. Check if source needs update based on frequency
      if (!config.forceRefresh && await this.shouldSkipSource(source)) {
        result.success = true;
        result.warnings.push('Source skipped - too recent');
        return result;
      }

      // 3. Fetch data from source
      console.log(`Fetching data from ${source.name}...`);
      const fetchResult = await this.fetchDataFromSource(source);
      
      if (fetchResult.metadata.status !== 'success') {
        throw new Error(`Data fetch failed: ${fetchResult.metadata.errors?.join(', ') || 'Unknown error'}`);
      }

      result.fetchedRecords = fetchResult.data.length;
      console.log(`Fetched ${result.fetchedRecords} records from ${source.name}`);

      if (result.fetchedRecords === 0) {
        result.success = true;
        result.warnings.push('No data returned from source');
        return result;
      }

      // 4. Transform and map data
      const mappedData = await this.mapSourceData(fetchResult.data, source);
      result.metrics.recordsProcessed = mappedData.length;

      // 5. Validate data (optional)
      let validationResults: ValidationResult | undefined;
      if (!config.skipValidation) {
        console.log(`Validating ${mappedData.length} records...`);
        validationResults = await this.validateData(mappedData, source);
        result.validationResults = validationResults;
        result.validRecords = Math.floor(mappedData.length * validationResults.score);
        
        if (!validationResults.isValid) {
          result.errors.push(`Validation failed: ${validationResults.errors.map(e => e.message).join(', ')}`);
          if (!config.dryRun) {
            // Continue with partial data if validation partially failed
            console.warn('Proceeding with partial data after validation warnings');
          }
        }
      } else {
        result.validRecords = mappedData.length;
      }

      if (config.dryRun) {
        result.success = true;
        result.warnings.push('Dry run - no data persisted');
        return result;
      }

      // 6. Process and store data
      const processedRecords = await this.processRecords(mappedData, source);
      
      // 7. Insert raw data
      console.log(`Inserting ${processedRecords.length} raw records...`);
      const rawRecords = processedRecords.map(r => r.raw);
      const insertedRaw = await storage.bulkUpsertPricesRaw(rawRecords);
      result.rawInserted = insertedRaw.length;

      // 8. Process verified data
      const verifiedRecords = processedRecords
        .filter(r => r.verified && r.errors.length === 0)
        .map(r => r.verified!);
      
      if (verifiedRecords.length > 0) {
        console.log(`Inserting ${verifiedRecords.length} verified records...`);
        const insertedVerified = await storage.bulkUpsertPricesVerified(verifiedRecords);
        result.verifiedInserted = insertedVerified.length;
      }

      // 9. Update source sync timestamp
      await storage.updateSourceLastSync(sourceId, new Date());

      // 10. Calculate metrics
      result.metrics = {
        startTime: new Date(startTime),
        endTime: new Date(),
        duration: Date.now() - startTime,
        recordsProcessed: processedRecords.length,
        recordsValid: verifiedRecords.length,
        recordsFailed: processedRecords.filter(r => r.errors.length > 0).length,
        duplicatesSkipped: result.fetchedRecords - result.rawInserted,
        currencyConversions: processedRecords.filter(r => r.verified?.currency !== r.verified?.priceUsd).length,
        validationScore: validationResults?.score || 1.0
      };

      result.success = true;
      result.duration = Date.now() - startTime;
      
      console.log(`Ingestion completed for ${source.name}: ${result.verifiedInserted} records processed in ${result.duration}ms`);

    } catch (error: any) {
      console.error(`Ingestion failed for source ${sourceId}:`, error.message);
      result.errors.push(error.message);
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  // Check if source should be skipped based on frequency and last sync
  private async shouldSkipSource(source: Source): Promise<boolean> {
    if (!source.lastSync) return false;

    const now = new Date();
    const lastSync = new Date(source.lastSync);
    const hoursSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60);

    const frequencyHours = this.getFrequencyInHours(source.frequency);
    
    return hoursSinceSync < frequencyHours;
  }

  // Convert frequency string to hours
  private getFrequencyInHours(frequency: string): number {
    switch (frequency.toLowerCase()) {
      case 'realtime': return 0.25; // 15 minutes
      case 'hourly': return 1;
      case 'daily': return 24;
      case 'weekly': return 168;
      default: return 24;
    }
  }

  // Fetch data from source using appropriate fetcher
  private async fetchDataFromSource(source: Source) {
    const sourceConfig = {
      name: source.name,
      type: source.type as 'api' | 'csv' | 'file',
      url: source.url || '',
      authentication: (source.metadata as any)?.authentication,
      metadata: source.metadata as any,
      timeout: 30000
    };

    return await DataFetcherFactory.fetchFromSource(sourceConfig, {
      attempts: 3,
      delay: 2000,
      backoffFactor: 2,
      maxDelay: 30000
    });
  }

  // Map source data to internal format with improved validation
  private async mapSourceData(data: any[], source: Source): Promise<any[]> {
    console.log(`Mapping ${data.length} records from ${source.name}`);

    // Ensure commodity and region caches are populated
    await this.ensureCachePopulated();

    const sourceConfigKey = Object.keys(this.sourcesConfig.sources || {})
      .find(key => this.sourcesConfig.sources[key].name === source.name);

    if (!sourceConfigKey) {
      console.warn(`No mapping configuration found for source: ${source.name}`);
      return data; // Return as-is if no mapping config
    }

    const sourceConfig = this.sourcesConfig.sources[sourceConfigKey];
    const commodityMappings = sourceConfig.commodity_mappings || [];
    const regionMappings = sourceConfig.region_mappings || [];

    // Pre-validate all commodity and region mappings exist in database
    const mappingErrors = await this.validateMappings(commodityMappings, regionMappings, source.name);
    if (mappingErrors.length > 0) {
      throw new Error(`Mapping validation failed for ${source.name}: ${mappingErrors.join(', ')}`);
    }

    const mappedData: any[] = [];
    const unmappedCommodities = new Set<string>();
    const unmappedRegions = new Set<string>();

    for (const record of data) {
      try {
        const commodityField = sourceConfig.commodity_field || 'commodity_code';
        const regionField = sourceConfig.region_field || 'region';
        const commodityCode = record[commodityField];
        const regionCode = record[regionField];

        // Map commodity
        const commodityMapping = commodityMappings.find((m: any) => 
          commodityCode === m.source_code
        );

        if (!commodityMapping) {
          unmappedCommodities.add(commodityCode);
          continue;
        }

        // Map region
        const regionMapping = regionMappings.find((m: any) =>
          regionCode === m.source_region
        );

        if (!regionMapping) {
          unmappedRegions.add(regionCode);
          continue;
        }

        // Verify commodity exists in database cache
        const commodityExists = this.commodityCache.has(commodityMapping.commodity_id);
        if (!commodityExists) {
          throw new Error(`Commodity ID '${commodityMapping.commodity_id}' mapped from '${commodityCode}' does not exist in database`);
        }

        // Verify region exists in database cache
        const regionExists = this.regionCache.has(regionMapping.region_id);
        if (!regionExists) {
          throw new Error(`Region ID '${regionMapping.region_id}' mapped from '${regionCode}' does not exist in database`);
        }

        // Create mapped record with proper validation
        const mappedRecord = {
          date: new Date(record.date || record.timestamp),
          price: parseFloat(record.price),
          commodity_id: commodityMapping.commodity_id,
          region_id: regionMapping.region_id,
          unit: commodityMapping.unit || record.unit || 'kg',
          currency: record.currency || 'USD',
          volume: record.volume ? parseFloat(record.volume) : null,
          source_data: record
        };

        // Validate required fields
        if (!mappedRecord.date || isNaN(mappedRecord.date.getTime())) {
          throw new Error(`Invalid date in record: ${record.date || record.timestamp}`);
        }
        if (isNaN(mappedRecord.price) || mappedRecord.price <= 0) {
          throw new Error(`Invalid price in record: ${record.price}`);
        }

        mappedData.push(mappedRecord);

      } catch (error: any) {
        console.warn(`Failed to map record from ${source.name}:`, error.message, record);
      }
    }

    // Report unmapped codes with actionable errors
    if (unmappedCommodities.size > 0) {
      const commodityList = Array.from(unmappedCommodities).join(', ');
      const availableCommodities = Array.from(this.commodityCache.keys()).join(', ');
      console.error(`Unmapped commodity codes in ${source.name}: ${commodityList}`);
      console.error(`Available commodity IDs: ${availableCommodities}`);
      throw new Error(`Unmapped commodity codes: ${commodityList}. Update commodity_mappings in sources.yaml or add commodities to database.`);
    }

    if (unmappedRegions.size > 0) {
      const regionList = Array.from(unmappedRegions).join(', ');
      const availableRegions = Array.from(this.regionCache.keys()).join(', ');
      console.error(`Unmapped region codes in ${source.name}: ${regionList}`);
      console.error(`Available region IDs: ${availableRegions}`);
      throw new Error(`Unmapped region codes: ${regionList}. Update region_mappings in sources.yaml or add regions to database.`);
    }

    console.log(`Successfully mapped ${mappedData.length}/${data.length} records`);
    return mappedData;
  }

  // Validate that all mappings reference existing database entities
  private async validateMappings(
    commodityMappings: any[], 
    regionMappings: any[], 
    sourceName: string
  ): Promise<string[]> {
    const errors: string[] = [];

    // Validate commodity mappings
    for (const mapping of commodityMappings) {
      if (!mapping.commodity_id) {
        errors.push(`Missing commodity_id for mapping ${mapping.source_code}`);
        continue;
      }
      if (!this.commodityCache.has(mapping.commodity_id)) {
        errors.push(`Commodity '${mapping.commodity_id}' not found in database for source ${sourceName}`);
      }
    }

    // Validate region mappings  
    for (const mapping of regionMappings) {
      if (!mapping.region_id) {
        errors.push(`Missing region_id for mapping ${mapping.source_region}`);
        continue;
      }
      if (!this.regionCache.has(mapping.region_id)) {
        errors.push(`Region '${mapping.region_id}' not found in database for source ${sourceName}`);
      }
    }

    return errors;
  }

  // Validate data using validation service
  private async validateData(data: any[], source: Source): Promise<ValidationResult> {
    // Get validation config for source
    const validationConfig = ValidationConfigFactory.createConfigForSource(source.name, 'price_data');
    
    // Create validator and run validation
    const validator = new DataValidator(validationConfig);
    return await validator.validateDataset(data);
  }

  // Process records for storage
  private async processRecords(data: any[], source: Source): Promise<ProcessedRecord[]> {
    console.log(`Processing ${data.length} records for storage...`);

    const processed: ProcessedRecord[] = [];
    const conversionPromises: Promise<any>[] = [];

    // Prepare currency conversions
    const conversionsNeeded = data
      .filter(record => record.currency !== 'USD')
      .map(record => ({
        amount: record.price,
        fromCurrency: record.currency,
        toCurrency: 'USD',
        date: record.date
      }));

    let conversions: any[] = [];
    if (conversionsNeeded.length > 0) {
      console.log(`Converting ${conversionsNeeded.length} prices to USD...`);
      conversions = await currencyConverter.convertBulk(conversionsNeeded);
    }

    let conversionIndex = 0;

    for (const record of data) {
      const errors: string[] = [];
      const warnings: string[] = [];

      try {
        // Create raw record
        const rawRecord: InsertPricesRaw = {
          sourceId: source.id,
          commodityId: record.commodity_id,
          regionId: record.region_id,
          date: record.date,
          price: record.price.toString(),
          currency: record.currency,
          volume: record.volume?.toString(),
          unit: record.unit,
          rawData: record.source_data,
          isProcessed: false
        };

        // Calculate record hash for deduplication
        const hashData = `${source.id}|${record.commodity_id}|${record.region_id}|${record.date.toISOString()}|${record.unit}`;
        const hash = crypto.createHash('sha256').update(hashData).digest('hex');

        // Prepare verified record
        let verifiedRecord: InsertPricesVerified | undefined;

        try {
          let priceUsd = record.price;
          
          // Apply currency conversion if needed
          if (record.currency !== 'USD' && conversions.length > 0) {
            const conversion = conversions[conversionIndex];
            priceUsd = conversion.convertedAmount;
            conversionIndex++;
            
            if (conversion.source === 'conversion_failed') {
              warnings.push('Currency conversion failed, using original price');
            }
          }

          verifiedRecord = {
            pricesRawId: '', // Will be set after raw insertion
            sourceId: source.id,
            commodityId: record.commodity_id,
            regionId: record.region_id,
            date: record.date,
            price: record.price.toString(),
            priceUsd: priceUsd.toString(),
            currency: record.currency,
            volume: record.volume?.toString(),
            qualityScore: this.calculateQualityScore(record, source).toString(),
            verificationMethod: 'automatic',
            outlierFlag: false,
            adjustments: null,
            verifiedBy: 'system'
          };

        } catch (error: any) {
          errors.push(`Failed to create verified record: ${error.message}`);
        }

        processed.push({
          raw: rawRecord,
          verified: verifiedRecord,
          errors,
          warnings,
          hash
        });

      } catch (error: any) {
        console.error('Failed to process record:', error.message, record);
        errors.push(`Processing failed: ${error.message}`);
        
        processed.push({
          raw: {} as InsertPricesRaw, // Placeholder
          errors,
          warnings,
          hash: ''
        });
      }
    }

    console.log(`Processed ${processed.length} records (${processed.filter(p => p.verified).length} verified)`);
    return processed;
  }

  // Calculate quality score for a record
  private calculateQualityScore(record: any, source: Source): number {
    let score = 1.0;

    // Adjust based on source reliability
    score *= source.reliability ? parseFloat(source.reliability) : 1.0;

    // Adjust based on data completeness
    const requiredFields = ['date', 'price', 'commodity_id', 'region_id'];
    const presentFields = requiredFields.filter(field => record[field] != null);
    score *= presentFields.length / requiredFields.length;

    // Adjust based on data recency (newer is better)
    const dataAge = Date.now() - new Date(record.date).getTime();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const recencyScore = Math.max(0, 1 - (dataAge / maxAge));
    score *= 0.8 + (0.2 * recencyScore); // Weight recency at 20%

    // Ensure score stays in [0, 1] range
    return Math.max(0, Math.min(1, score));
  }

  // Get ingestion status for all sources
  async getIngestionStatus(): Promise<Array<{
    sourceId: string;
    sourceName: string;
    isActive: boolean;
    lastSync?: Date;
    nextSync?: Date;
    status: 'healthy' | 'warning' | 'error';
  }>> {
    const sources = await storage.getSources();
    const status: any[] = [];

    for (const source of sources) {
      const nextSync = source.lastSync ? 
        new Date(source.lastSync.getTime() + (this.getFrequencyInHours(source.frequency) * 60 * 60 * 1000)) :
        new Date();

      let healthStatus: 'healthy' | 'warning' | 'error' = 'healthy';
      
      if (!source.isActive) {
        healthStatus = 'warning';
      } else if (source.lastSync) {
        const hoursSinceSync = (Date.now() - source.lastSync.getTime()) / (1000 * 60 * 60);
        const expectedFrequency = this.getFrequencyInHours(source.frequency);
        
        if (hoursSinceSync > expectedFrequency * 2) {
          healthStatus = 'error';
        } else if (hoursSinceSync > expectedFrequency * 1.5) {
          healthStatus = 'warning';
        }
      }

      status.push({
        sourceId: source.id,
        sourceName: source.name,
        isActive: source.isActive,
        lastSync: source.lastSync,
        nextSync,
        status: healthStatus
      });
    }

    return status;
  }

  // Ensure cache is populated
  private async ensureCachePopulated(): Promise<void> {
    if (this.commodityCache.size === 0) {
      const commodities = await storage.getCommodities();
      commodities.forEach(c => this.commodityCache.set(c.id, c));
    }

    if (this.regionCache.size === 0) {
      const regions = await storage.getRegions();
      regions.forEach(r => this.regionCache.set(r.id, r));
    }
  }

  // Initialize sources from configuration
  async initializeSourcesFromConfig(): Promise<void> {
    console.log('Initializing sources from configuration...');

    await this.ensureCachePopulated();

    if (!this.sourcesConfig.sources) {
      console.warn('No sources found in configuration');
      return;
    }

    for (const [sourceKey, sourceConfig] of Object.entries(this.sourcesConfig.sources) as [string, any][]) {
      try {
        // Check if source already exists
        const existingSource = await storage.getSourceByName(sourceConfig.name);
        
        if (existingSource) {
          console.log(`Source already exists: ${sourceConfig.name}`);
          continue;
        }

        // Create new source
        const newSource = {
          name: sourceConfig.name,
          type: sourceConfig.type,
          url: sourceConfig.url,
          frequency: sourceConfig.frequency,
          reliability: sourceConfig.reliability?.toString() || '1.0',
          apiKeyRef: sourceConfig.authentication?.key_ref,
          isActive: sourceConfig.is_active ?? true,
          metadata: {
            headers: sourceConfig.metadata?.headers,
            authentication: sourceConfig.authentication,
            rate_limits: sourceConfig.metadata?.rate_limits,
            format: sourceConfig.metadata?.format
          }
        };

        await storage.createSource(newSource);
        console.log(`Created source: ${sourceConfig.name}`);

      } catch (error: any) {
        console.error(`Failed to initialize source ${sourceKey}:`, error.message);
      }
    }
  }
}

// Singleton instance
export const dataIngestionPipeline = new DataIngestionPipeline();

export default dataIngestionPipeline;