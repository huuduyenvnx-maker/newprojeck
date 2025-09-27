import { storage } from '../storage';
import { InsertFxRate } from '@shared/schema';
import DataFetcherFactory from './fetchers';

export interface ConversionResult {
  originalAmount: number;
  convertedAmount: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: Date;
  source: string;
}

export interface ConversionError {
  code: 'RATE_NOT_FOUND' | 'STALE_RATE' | 'INVALID_CURRENCY' | 'FETCH_ERROR';
  message: string;
  retryable: boolean;
}

// Currency conversion service with VND support for Vietnamese markets
export class CurrencyConverter {
  private static readonly SUPPORTED_CURRENCIES = ['USD', 'VND', 'EUR', 'JPY', 'CNY'];
  private static readonly DEFAULT_BASE_CURRENCY = 'USD';
  private static readonly RATE_STALENESS_HOURS = 48; // Maximum age for exchange rates

  constructor() {}

  // Main conversion method
  async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date?: Date
  ): Promise<ConversionResult> {
    console.log(`Converting ${amount} ${fromCurrency} to ${toCurrency}`);

    // Validate inputs
    this.validateCurrencyCode(fromCurrency);
    this.validateCurrencyCode(toCurrency);
    
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    // Same currency - no conversion needed
    if (fromCurrency === toCurrency) {
      return {
        originalAmount: amount,
        convertedAmount: amount,
        fromCurrency,
        toCurrency,
        rate: 1.0,
        date: date || new Date(),
        source: 'no_conversion_required'
      };
    }

    const conversionDate = date || new Date();

    try {
      // Get exchange rate
      const rateInfo = await this.getExchangeRate(fromCurrency, toCurrency, conversionDate);
      
      if (!rateInfo) {
        throw new Error(`Exchange rate not available for ${fromCurrency} to ${toCurrency}`);
      }

      // Check rate freshness
      const rateAge = Date.now() - rateInfo.date.getTime();
      const maxAge = CurrencyConverter.RATE_STALENESS_HOURS * 60 * 60 * 1000;
      
      if (rateAge > maxAge) {
        console.warn(`Exchange rate is stale (${Math.round(rateAge / (60 * 60 * 1000))} hours old)`);
        // Try to fetch fresh rate
        await this.fetchLatestRates();
      }

      // Perform conversion
      const convertedAmount = amount * rateInfo.rate;

      return {
        originalAmount: amount,
        convertedAmount: Number(convertedAmount.toFixed(2)),
        fromCurrency,
        toCurrency,
        rate: rateInfo.rate,
        date: conversionDate,
        source: rateInfo.source
      };

    } catch (error: any) {
      const errorMessage = this.sanitizeErrorMessage(error);
      console.warn(`Currency conversion failed: ${errorMessage}`);
      
      // Return a meaningful error instead of throwing to prevent cascade failures
      throw new Error(`Currency conversion unavailable: ${errorMessage}`);
    }
  }

  // Bulk convert multiple amounts
  async convertBulk(
    conversions: Array<{
      amount: number;
      fromCurrency: string;
      toCurrency: string;
      date?: Date;
    }>
  ): Promise<ConversionResult[]> {
    console.log(`Processing ${conversions.length} bulk conversions`);

    const results: ConversionResult[] = [];
    const errors: string[] = [];

    // Group conversions by currency pair to minimize database queries
    const conversionGroups = new Map<string, typeof conversions>();
    
    for (const conversion of conversions) {
      const key = `${conversion.fromCurrency}-${conversion.toCurrency}`;
      if (!conversionGroups.has(key)) {
        conversionGroups.set(key, []);
      }
      conversionGroups.get(key)!.push(conversion);
    }

    // Process each currency pair group
    for (const [pairKey, pairConversions] of Array.from(conversionGroups.entries())) {
      const [fromCurrency, toCurrency] = pairKey.split('-');

      try {
        // Get rate for this pair (using most recent date from the group)
        const latestDate = pairConversions.reduce(
          (latest: Date, conv: any) => (conv.date && conv.date > latest) ? conv.date : latest,
          new Date(0)
        );
        
        const rateInfo = await this.getExchangeRate(
          fromCurrency,
          toCurrency,
          latestDate || new Date()
        );

        if (rateInfo) {
          // Apply rate to all conversions in this group
          for (const conversion of pairConversions) {
            const convertedAmount = conversion.amount * rateInfo.rate;
            
            results.push({
              originalAmount: conversion.amount,
              convertedAmount: Number(convertedAmount.toFixed(2)),
              fromCurrency,
              toCurrency,
              rate: rateInfo.rate,
              date: conversion.date || new Date(),
              source: rateInfo.source
            });
          }
        } else {
          errors.push(`No rate available for ${fromCurrency} to ${toCurrency}`);
          // Add failed conversions with original amounts
          for (const conversion of pairConversions) {
            results.push({
              originalAmount: conversion.amount,
              convertedAmount: conversion.amount, // Fallback to original amount
              fromCurrency,
              toCurrency,
              rate: 1.0,
              date: conversion.date || new Date(),
              source: 'conversion_failed'
            });
          }
        }

      } catch (error: any) {
        errors.push(`Conversion failed for ${pairKey}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      console.warn(`Bulk conversion completed with ${errors.length} errors:`, errors);
    }

    return results;
  }

  // Get exchange rate from database or fetch if needed
  private async getExchangeRate(
    fromCurrency: string,
    toCurrency: string,
    date: Date
  ): Promise<{ rate: number; date: Date; source: string } | null> {
    try {
      // Try direct rate first
      const directRate = await storage.getFxRate(fromCurrency, toCurrency, date);
      if (directRate) {
        return {
          rate: parseFloat(directRate.rate),
          date: directRate.date,
          source: directRate.sourceId || 'database'
        };
      }

      // Try inverse rate (e.g., if we need USD/VND but have VND/USD)
      const inverseRate = await storage.getFxRate(toCurrency, fromCurrency, date);
      if (inverseRate) {
        const rate = parseFloat(inverseRate.rate);
        return {
          rate: 1 / rate,
          date: inverseRate.date,
          source: inverseRate.sourceId || 'database_inverse'
        };
      }

      // Try latest rate if specific date not found
      const latestRate = await storage.getLatestFxRate(fromCurrency, toCurrency);
      if (latestRate) {
        const rateAge = Date.now() - latestRate.date.getTime();
        const maxAge = CurrencyConverter.RATE_STALENESS_HOURS * 60 * 60 * 1000;
        
        if (rateAge <= maxAge) {
          return {
            rate: parseFloat(latestRate.rate),
            date: latestRate.date,
            source: latestRate.sourceId || 'database_latest'
          };
        }
      }

      // Try cross-conversion via USD
      if (fromCurrency !== 'USD' && toCurrency !== 'USD') {
        const fromUsdRate = await this.getExchangeRate('USD', fromCurrency, date);
        const toUsdRate = await this.getExchangeRate('USD', toCurrency, date);
        
        if (fromUsdRate && toUsdRate) {
          const crossRate = toUsdRate.rate / fromUsdRate.rate;
          return {
            rate: crossRate,
            date: date,
            source: 'cross_conversion_via_usd'
          };
        }
      }

      // Rate not found - try to fetch fresh rates
      console.log(`Exchange rate not found for ${fromCurrency}/${toCurrency}, attempting to fetch...`);
      await this.fetchLatestRates();
      
      // Try once more after fetching
      const refetchedRate = await storage.getLatestFxRate(fromCurrency, toCurrency);
      if (refetchedRate) {
        return {
          rate: parseFloat(refetchedRate.rate),
          date: refetchedRate.date,
          source: refetchedRate.sourceId || 'database_refetched'
        };
      }

      return null;

    } catch (error: any) {
      // Sanitize error logging to prevent stack trace leakage
      const errorMessage = this.sanitizeErrorMessage(error);
      console.warn(`Exchange rate lookup failed for ${fromCurrency}/${toCurrency}: ${errorMessage}`);
      return null;
    }
  }

  // Fetch latest exchange rates from configured sources with circuit breaker pattern
  async fetchLatestRates(context?: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): Promise<void> {
    console.log('Fetching latest exchange rates...');

    try {
      // Use provided context or create a system context for currency service operations
      const systemContext = context || { coopId: 'system', userId: 'currency-service', role: 'admin' as const };
      
      // Add timeout wrapper for database operations
      const fxSources = await Promise.race([
        storage.getSourcesByType(systemContext, 'fx'),
        this.timeoutPromise(10000, 'Database query timeout')
      ]);
      
      if (!fxSources || fxSources.length === 0) {
        console.warn('No FX rate sources configured or available');
        return;
      }
      
      const fetchPromises = fxSources
        .filter(source => source.isActive)
        .map(source => this.fetchFromSingleSource(source, systemContext));
      
      // Execute all fetches in parallel with overall timeout
      await Promise.allSettled(fetchPromises);
      console.log('Completed fetching rates from all configured sources');

    } catch (error: any) {
      // Sanitize database errors to prevent stack trace leakage
      const errorMessage = this.sanitizeErrorMessage(error);
      console.warn(`Exchange rate fetch operation failed: ${errorMessage}`);
      
      // Don't throw error - this prevents cascading failures
      // Currency conversion will fall back to existing rates or return appropriate errors
    }
  }

  // Fetch rates from a single source with timeout and error handling
  private async fetchFromSingleSource(source: any, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): Promise<void> {
    try {
      console.log(`Fetching rates from: ${source.name}`);
      
      const fetchResult = await Promise.race([
        DataFetcherFactory.fetchFromSource({
          name: source.name,
          type: source.type as 'api' | 'csv' | 'file',
          url: source.url || '',
          authentication: (source.metadata as any)?.authentication,
          metadata: source.metadata as any,
          timeout: 30000
        }),
        this.timeoutPromise(35000, `Fetch timeout for ${source.name}`)
      ]);

      if (fetchResult.metadata.status === 'success' && fetchResult.data.length > 0) {
        const rates = this.parseRatesData(fetchResult.data, source.name, context);
        await this.saveRates(rates, source.id, context);
        
        // Update source last sync time
        await storage.updateSourceLastSync(context, source.id, new Date());
        
        console.log(`Successfully fetched ${rates.length} rates from ${source.name}`);
      } else {
        console.warn(`No data received from ${source.name}:`, fetchResult.metadata.errors);
      }

    } catch (error: any) {
      const errorMessage = this.sanitizeErrorMessage(error);
      console.warn(`Failed to fetch rates from ${source.name}: ${errorMessage}`);
    }
  }

  // Create a timeout promise for race conditions
  private timeoutPromise(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  // Sanitize error messages to prevent stack trace leakage
  private sanitizeErrorMessage(error: any): string {
    // Handle database-specific errors
    if (error.code === '42703') {
      return 'Database schema mismatch - column not found';
    }
    if (error.code && error.code.startsWith('42')) {
      return 'Database schema or syntax error';
    }
    if (error.code && error.code.startsWith('08')) {
      return 'Database connection error';
    }
    if (error.message && error.message.includes('timeout')) {
      return 'Operation timeout';
    }
    if (error.message && error.message.includes('network')) {
      return 'Network connectivity issue';
    }
    
    // Return sanitized generic message for other errors
    return error.message || 'Unknown error occurred';
  }

  // Parse rates data from different sources
  private parseRatesData(data: any[], sourceName: string, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): InsertFxRate[] {
    const rates: InsertFxRate[] = [];

    for (const record of data) {
      try {
        // Handle different data formats based on source
        if (sourceName.includes('sbv') || sourceName.includes('state_bank')) {
          // State Bank of Vietnam format
          rates.push(...this.parseSBVRates(record, context));
        } else if (sourceName.includes('ecb') || sourceName.includes('european')) {
          // European Central Bank format
          rates.push(...this.parseECBRates(record, context));
        } else {
          // Generic format
          rates.push(...this.parseGenericRates(record, context));
        }
      } catch (error: any) {
        console.warn(`Failed to parse rate record from ${sourceName}:`, error.message, record);
      }
    }

    return rates;
  }

  // Parse State Bank of Vietnam rates
  private parseSBVRates(record: any, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): InsertFxRate[] {
    const rates: InsertFxRate[] = [];
    const date = new Date(record.date || record.effective_date);

    // Common VND pairs
    if (record.usd_vnd_rate) {
      rates.push({
        baseCurrency: 'USD',
        targetCurrency: 'VND',
        date,
        rate: record.usd_vnd_rate.toString(),
        isActive: true,
        coopId: context.coopId
      });
    }

    if (record.eur_vnd_rate) {
      rates.push({
        baseCurrency: 'EUR',
        targetCurrency: 'VND',
        date,
        rate: record.eur_vnd_rate.toString(),
        isActive: true,
        coopId: context.coopId
      });
    }

    if (record.jpy_vnd_rate) {
      rates.push({
        baseCurrency: 'JPY',
        targetCurrency: 'VND',
        date,
        rate: record.jpy_vnd_rate.toString(),
        isActive: true,
        coopId: context.coopId
      });
    }

    return rates;
  }

  // Parse European Central Bank rates
  private parseECBRates(record: any, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): InsertFxRate[] {
    const rates: InsertFxRate[] = [];
    const date = new Date(record.date || record.time);

    // EUR-based rates
    Object.keys(record).forEach(key => {
      if (key !== 'date' && key !== 'time' && record[key] && !isNaN(parseFloat(record[key]))) {
        const targetCurrency = key.toUpperCase();
        if (CurrencyConverter.SUPPORTED_CURRENCIES.includes(targetCurrency)) {
          rates.push({
            baseCurrency: 'EUR',
            targetCurrency,
            date,
            rate: record[key].toString(),
            isActive: true,
            coopId: context.coopId
          });
        }
      }
    });

    return rates;
  }

  // Parse generic rate format
  private parseGenericRates(record: any, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): InsertFxRate[] {
    const rates: InsertFxRate[] = [];

    if (record.base_currency && record.target_currency && record.rate) {
      rates.push({
        baseCurrency: record.base_currency.toUpperCase(),
        targetCurrency: record.target_currency.toUpperCase(),
        date: new Date(record.date || record.timestamp),
        rate: record.rate.toString(),
        isActive: true,
        coopId: context.coopId
      });
    }

    return rates;
  }

  // Save rates to database
  private async saveRates(rates: InsertFxRate[], sourceId: string, context: { coopId: string; userId: string; role?: 'admin' | 'analyst' | 'farmer' }): Promise<void> {
    if (rates.length === 0) return;

    try {
      // Add source ID and coopId to rates
      const ratesWithSource = rates.map(rate => ({
        ...rate,
        sourceId,
        coopId: context.coopId
      }));

      // Use bulk upsert to handle duplicates
      await storage.bulkUpsertFxRates(ratesWithSource);
      console.log(`Saved ${rates.length} exchange rates to database`);

    } catch (error: any) {
      console.error('Failed to save exchange rates:', error.message);
      throw error;
    }
  }

  // Get supported currency pairs
  getSupportedCurrencies(): string[] {
    return [...CurrencyConverter.SUPPORTED_CURRENCIES];
  }

  // Check if currency code is supported
  isSupportedCurrency(currencyCode: string): boolean {
    return CurrencyConverter.SUPPORTED_CURRENCIES.includes(currencyCode.toUpperCase());
  }

  // Validate currency code format
  private validateCurrencyCode(currencyCode: string): void {
    if (!currencyCode || typeof currencyCode !== 'string') {
      throw new Error('Currency code must be a non-empty string');
    }

    if (currencyCode.length !== 3) {
      throw new Error('Currency code must be exactly 3 characters');
    }

    if (!/^[A-Z]{3}$/.test(currencyCode.toUpperCase())) {
      throw new Error('Currency code must contain only uppercase letters');
    }

    if (!this.isSupportedCurrency(currencyCode)) {
      throw new Error(`Unsupported currency: ${currencyCode}. Supported currencies: ${CurrencyConverter.SUPPORTED_CURRENCIES.join(', ')}`);
    }
  }

  // Get conversion history for analysis
  async getConversionHistory(
    baseCurrency: string,
    targetCurrency: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ date: Date; rate: number; source?: string }>> {
    try {
      const rates = await storage.getFxRatesByDateRange(baseCurrency, targetCurrency, startDate, endDate);
      
      return rates.map(rate => ({
        date: rate.date,
        rate: parseFloat(rate.rate),
        source: rate.sourceId || undefined
      }));

    } catch (error: any) {
      console.error('Failed to get conversion history:', error.message);
      return [];
    }
  }

  // Calculate average rate over period
  async getAverageRate(
    baseCurrency: string,
    targetCurrency: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ averageRate: number; dataPoints: number } | null> {
    try {
      const history = await this.getConversionHistory(baseCurrency, targetCurrency, startDate, endDate);
      
      if (history.length === 0) {
        return null;
      }

      const sum = history.reduce((acc, point) => acc + point.rate, 0);
      const averageRate = sum / history.length;

      return {
        averageRate: Number(averageRate.toFixed(6)),
        dataPoints: history.length
      };

    } catch (error: any) {
      console.error('Failed to calculate average rate:', error.message);
      return null;
    }
  }
}

// Singleton instance
export const currencyConverter = new CurrencyConverter();

export default currencyConverter;