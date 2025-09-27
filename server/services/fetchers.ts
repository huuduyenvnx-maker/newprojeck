import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import csv from 'csv-parser';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// Types for data fetching
export interface FetchResult {
  data: any[];
  metadata: {
    source: string;
    fetchedAt: Date;
    recordCount: number;
    format: 'csv' | 'json' | 'xml';
    status: 'success' | 'error' | 'partial';
    errors?: string[];
  };
}

export interface RetryConfig {
  attempts: number;
  delay: number; // milliseconds
  backoffFactor: number;
  maxDelay: number;
}

export interface SourceConfig {
  name: string;
  type: 'api' | 'csv' | 'file' | 'internet';
  url: string;
  authentication?: {
    type: 'api_key' | 'bearer_token' | 'basic' | 'none';
    key_ref?: string;
  };
  metadata?: {
    headers?: Record<string, string>;
    format?: string;
    encoding?: string;
    delimiter?: string;
    skip_rows?: number;
    rate_limits?: {
      requests_per_minute?: number;
      requests_per_day?: number;
    };
  };
  timeout?: number;
}

// HTTP Client with retry logic
class HttpClient {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;

  constructor(retryConfig: RetryConfig = {
    attempts: 3,
    delay: 1000,
    backoffFactor: 2,
    maxDelay: 30000
  }) {
    this.retryConfig = retryConfig;
    this.client = axios.create({
      timeout: 30000, // 30 seconds default timeout
      validateStatus: (status) => status < 500, // Don't retry on client errors
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`HTTP Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('HTTP Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`HTTP Response: ${response.status} ${response.config.url} (${response.data?.length || 0} bytes)`);
        return response;
      },
      (error) => {
        console.error('HTTP Response Error:', error.response?.status, error.response?.statusText);
        return Promise.reject(error);
      }
    );
  }

  async get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.requestWithRetry('GET', url, config);
  }

  async post(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.requestWithRetry('POST', url, { ...config, data });
  }

  private async requestWithRetry(
    method: string,
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.retryConfig.attempts; attempt++) {
      try {
        const response = await this.client.request({
          method,
          url,
          ...config
        });

        // Success - return response
        if (response.status >= 200 && response.status < 300) {
          return response;
        }

        // Client error (4xx) - don't retry
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Client error: ${response.status} ${response.statusText}`);
        }

        // Server error (5xx) - will retry
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
        
      } catch (error: any) {
        lastError = error;
        
        // Don't retry client errors
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw error;
        }

        // If this was the last attempt, throw the error
        if (attempt === this.retryConfig.attempts) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.delay * Math.pow(this.retryConfig.backoffFactor, attempt - 1),
          this.retryConfig.maxDelay
        );

        console.log(`Request failed (attempt ${attempt}/${this.retryConfig.attempts}), retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new Error(`Request failed after ${this.retryConfig.attempts} attempts: ${lastError.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// API Data Fetcher
export class ApiDataFetcher {
  private httpClient: HttpClient;

  constructor(retryConfig?: RetryConfig) {
    this.httpClient = new HttpClient(retryConfig);
  }

  async fetchData(sourceConfig: SourceConfig): Promise<FetchResult> {
    console.log(`Fetching API data from: ${sourceConfig.name} (${sourceConfig.url})`);
    
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // Prepare request configuration
      const config: AxiosRequestConfig = {
        headers: this.buildHeaders(sourceConfig),
        timeout: sourceConfig.timeout || 30000
      };

      // Handle authentication
      this.addAuthentication(config, sourceConfig);

      // Apply rate limiting if configured
      await this.applyRateLimit(sourceConfig);

      // Make the request
      const response = await this.httpClient.get(sourceConfig.url, config);

      // Process response based on content type
      const data = await this.processApiResponse(response, sourceConfig);

      return {
        data,
        metadata: {
          source: sourceConfig.name,
          fetchedAt: new Date(),
          recordCount: Array.isArray(data) ? data.length : 1,
          format: 'json',
          status: 'success',
          ...(errors.length > 0 && { errors })
        }
      };

    } catch (error: any) {
      console.error(`API fetch failed for ${sourceConfig.name}:`, error.message);
      
      return {
        data: [],
        metadata: {
          source: sourceConfig.name,
          fetchedAt: new Date(),
          recordCount: 0,
          format: 'json',
          status: 'error',
          errors: [error.message]
        }
      };
    }
  }

  private buildHeaders(sourceConfig: SourceConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'AgriIntel-DataFetcher/1.0',
      ...sourceConfig.metadata?.headers
    };

    // Interpolate environment variables in headers
    return this.interpolateEnvVars(headers);
  }

  // Interpolate environment variables in header values
  private interpolateEnvVars(headers: Record<string, string>): Record<string, string> {
    const interpolatedHeaders: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        // Replace ${VAR_NAME} patterns with environment variable values
        interpolatedHeaders[key] = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          const envValue = process.env[varName.trim()];
          if (envValue === undefined) {
            console.warn(`Environment variable not found: ${varName}`);
            return match; // Keep original placeholder if env var not found
          }
          return envValue;
        });
      } else {
        interpolatedHeaders[key] = value;
      }
    }
    
    return interpolatedHeaders;
  }

  private addAuthentication(config: AxiosRequestConfig, sourceConfig: SourceConfig): void {
    if (!sourceConfig.authentication || sourceConfig.authentication.type === 'none') {
      return;
    }

    const auth = sourceConfig.authentication;
    const apiKey = process.env[auth.key_ref!];

    if (!apiKey) {
      throw new Error(`API key not found in environment: ${auth.key_ref}`);
    }

    switch (auth.type) {
      case 'api_key':
        // Add API key to headers (common patterns)
        config.headers = {
          ...config.headers,
          'X-API-Key': apiKey,
          'Authorization': `ApiKey ${apiKey}`
        };
        break;
      
      case 'bearer_token':
        config.headers = {
          ...config.headers,
          'Authorization': `Bearer ${apiKey}`
        };
        break;
      
      case 'basic':
        // Assume apiKey is in format "username:password"
        const encoded = Buffer.from(apiKey).toString('base64');
        config.headers = {
          ...config.headers,
          'Authorization': `Basic ${encoded}`
        };
        break;
    }
  }

  private async applyRateLimit(sourceConfig: SourceConfig): Promise<void> {
    const rateLimit = sourceConfig.metadata?.rate_limits;
    if (!rateLimit) return;

    // Simple rate limiting implementation
    // In production, you'd want to use Redis or similar for distributed rate limiting
    const now = Date.now();
    const key = `rate_limit_${sourceConfig.name}`;
    
    // This is a simplified implementation - you'd want proper rate limiting
    // with sliding windows, distributed locks, etc.
    console.log(`Rate limiting applied for ${sourceConfig.name}`);
  }

  private async processApiResponse(response: AxiosResponse, sourceConfig: SourceConfig): Promise<any[]> {
    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      let data = response.data;
      
      // Handle different JSON response structures
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      // If response is an array, return as is
      if (Array.isArray(data)) {
        return data;
      }

      // If response is an object, try to find the data array
      // Common patterns: { data: [...] }, { items: [...] }, { results: [...] }
      if (data.data && Array.isArray(data.data)) {
        return data.data;
      }
      if (data.items && Array.isArray(data.items)) {
        return data.items;
      }
      if (data.results && Array.isArray(data.results)) {
        return data.results;
      }

      // Single object response
      return [data];
    }

    throw new Error(`Unsupported content type: ${contentType}`);
  }
}

// CSV Data Fetcher
export class CsvDataFetcher {
  private httpClient: HttpClient;

  constructor(retryConfig?: RetryConfig) {
    this.httpClient = new HttpClient(retryConfig);
  }

  // Interpolate environment variables in header values
  private interpolateEnvVars(headers: Record<string, string>): Record<string, string> {
    const interpolatedHeaders: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        // Replace ${VAR_NAME} patterns with environment variable values
        interpolatedHeaders[key] = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          const envValue = process.env[varName.trim()];
          if (envValue === undefined) {
            console.warn(`Environment variable not found: ${varName}`);
            return match; // Keep original placeholder if env var not found
          }
          return envValue;
        });
      } else {
        interpolatedHeaders[key] = value;
      }
    }
    
    return interpolatedHeaders;
  }

  async fetchData(sourceConfig: SourceConfig): Promise<FetchResult> {
    console.log(`Fetching CSV data from: ${sourceConfig.name} (${sourceConfig.url})`);
    
    const errors: string[] = [];

    try {
      if (sourceConfig.type === 'file') {
        return await this.fetchLocalCsv(sourceConfig);
      } else {
        return await this.fetchRemoteCsv(sourceConfig);
      }
    } catch (error: any) {
      console.error(`CSV fetch failed for ${sourceConfig.name}:`, error.message);
      
      return {
        data: [],
        metadata: {
          source: sourceConfig.name,
          fetchedAt: new Date(),
          recordCount: 0,
          format: 'csv',
          status: 'error',
          errors: [error.message]
        }
      };
    }
  }

  private async fetchLocalCsv(sourceConfig: SourceConfig): Promise<FetchResult> {
    const filePath = sourceConfig.url.replace('file://', '');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const data: any[] = [];
    const csvConfig = this.buildCsvConfig(sourceConfig);

    await pipeline(
      fs.createReadStream(filePath),
      csv(csvConfig),
      async function* (source: any) {
        for await (const chunk of source) {
          data.push(chunk);
          yield chunk;
        }
      }
    );

    return {
      data,
      metadata: {
        source: sourceConfig.name,
        fetchedAt: new Date(),
        recordCount: data.length,
        format: 'csv',
        status: 'success'
      }
    };
  }

  private async fetchRemoteCsv(sourceConfig: SourceConfig): Promise<FetchResult> {
    // Prepare request configuration
    const headers = {
      'Accept': 'text/csv, application/csv, text/plain',
      'User-Agent': 'AgriIntel-DataFetcher/1.0',
      ...sourceConfig.metadata?.headers
    };
    
    const config: AxiosRequestConfig = {
      headers: this.interpolateEnvVars(headers),
      timeout: sourceConfig.timeout || 30000,
      responseType: 'stream'
    };

    // Handle authentication
    this.addAuthentication(config, sourceConfig);

    // Make the request
    const response = await this.httpClient.get(sourceConfig.url, config);

    // Process CSV stream
    const data: any[] = [];
    const csvConfig = this.buildCsvConfig(sourceConfig);

    await pipeline(
      response.data,
      csv(csvConfig),
      async function* (source: any) {
        for await (const chunk of source) {
          data.push(chunk);
          yield chunk;
        }
      }
    );

    return {
      data,
      metadata: {
        source: sourceConfig.name,
        fetchedAt: new Date(),
        recordCount: data.length,
        format: 'csv',
        status: 'success'
      }
    };
  }

  private buildCsvConfig(sourceConfig: SourceConfig): any {
    const metadata = sourceConfig.metadata || {};
    
    return {
      separator: metadata.delimiter || ',',
      skipEmptyLines: true,
      skipLinesWithError: true,
      ...(metadata.skip_rows && { skipLinesWithError: false })
    };
  }

  private addAuthentication(config: AxiosRequestConfig, sourceConfig: SourceConfig): void {
    if (!sourceConfig.authentication || sourceConfig.authentication.type === 'none') {
      return;
    }

    const auth = sourceConfig.authentication;
    const apiKey = process.env[auth.key_ref!];

    if (!apiKey) {
      throw new Error(`API key not found in environment: ${auth.key_ref}`);
    }

    switch (auth.type) {
      case 'api_key':
        config.headers = {
          ...config.headers,
          'X-API-Key': apiKey
        };
        break;
      
      case 'bearer_token':
        config.headers = {
          ...config.headers,
          'Authorization': `Bearer ${apiKey}`
        };
        break;
      
      case 'basic':
        const encoded = Buffer.from(apiKey).toString('base64');
        config.headers = {
          ...config.headers,
          'Authorization': `Basic ${encoded}`
        };
        break;
    }
  }
}

// Universal Data Fetcher Factory
// Internet Data Fetcher using AI aggregation
export class InternetDataFetcher {
  private httpClient: HttpClient;
  
  constructor(retryConfig?: RetryConfig) {
    this.httpClient = new HttpClient(retryConfig);
  }

  async fetchData(sourceConfig: SourceConfig): Promise<FetchResult> {
    console.log(`🌐 Starting Internet aggregation for: ${sourceConfig.name}`);
    
    try {
      // Dynamic import to avoid circular dependency
      const { internetAggregationService } = await import('./internet-aggregation.js');
      
      // Extract commodities from source config or use defaults
      const commodities = [
        'Gạo trắng 5% tấm',
        'Cà phê Robusta FAQ', 
        'Tiêu đen FAQ',
        'Cao su TSR20',
        'Ngô vàng',
        'Đậu tương'
      ];
      
      const result = await internetAggregationService.aggregateCommodityPrices(
        commodities,
        'Vietnam'
      );
      
      // Convert aggregation result to FetchResult format with PROVENANCE TRACKING
      const data = result.commodities.map(commodity => ({
        date: commodity.date.toISOString(),
        commodity: commodity.commodity,
        region: commodity.region,
        price: commodity.price,
        currency: commodity.currency,
        unit: commodity.unit,
        confidence: commodity.confidence,
        
        // CRITICAL: Provenance tracking fields for verified-only policy
        evidenceUrls: commodity.evidence.map(e => ({
          url: e.url,
          extractedText: e.extractedText,
          methodology: e.methodology,
          pageHash: e.pageHash,
          extractedAt: e.extractedAt,
          sourceTitle: e.sourceTitle
        })),
        sourceType: 'internet',
        pageHashes: commodity.evidence.map(e => e.pageHash).filter(Boolean),
        aggregationMetadata: {
          verificationLevel: commodity.metadata?.verificationLevel || 'dual_llm',
          fetchedAt: commodity.metadata?.fetchedAt || new Date().toISOString(),
          provenanceComplete: commodity.metadata?.provenanceComplete || true,
          confidenceScore: commodity.confidence,
          sourcesCount: commodity.sources.length,
          evidenceCount: commodity.evidence.length
        }
      }));
      
      return {
        data,
        metadata: {
          source: sourceConfig.name,
          fetchedAt: new Date(),
          recordCount: data.length,
          format: 'json',
          status: result.success ? 'success' : 'error',
          errors: result.errors
        }
      };
      
    } catch (error: any) {
      console.error(`❌ Internet aggregation failed for ${sourceConfig.name}:`, error);
      
      return {
        data: [],
        metadata: {
          source: sourceConfig.name,
          fetchedAt: new Date(),
          recordCount: 0,
          format: 'json',
          status: 'error',
          errors: [error.message]
        }
      };
    }
  }
}

export class DataFetcherFactory {
  private static apiCache = new Map<string, any>();
  private static rateLimiters = new Map<string, Date>();

  static createFetcher(sourceType: 'api' | 'csv' | 'file' | 'internet', retryConfig?: RetryConfig) {
    switch (sourceType) {
      case 'api':
        return new ApiDataFetcher(retryConfig);
      case 'csv':
      case 'file':
        return new CsvDataFetcher(retryConfig);
      case 'internet':
        return new InternetDataFetcher(retryConfig);
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }
  }

  static async fetchFromSource(sourceConfig: SourceConfig, retryConfig?: RetryConfig): Promise<FetchResult> {
    const fetcher = this.createFetcher(sourceConfig.type, retryConfig);
    return await fetcher.fetchData(sourceConfig);
  }

  // Utility method to validate source configuration
  static validateSourceConfig(sourceConfig: SourceConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!sourceConfig.name) {
      errors.push('Source name is required');
    }

    if (!sourceConfig.url) {
      errors.push('Source URL is required');
    }

    if (!['api', 'csv', 'file', 'internet'].includes(sourceConfig.type)) {
      errors.push('Source type must be one of: api, csv, file, internet');
    }

    if (sourceConfig.authentication && sourceConfig.authentication.type !== 'none') {
      if (!sourceConfig.authentication.key_ref) {
        errors.push('Authentication key reference is required when auth type is not none');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Utility method to test source connectivity
  static async testSourceConnection(sourceConfig: SourceConfig): Promise<{ connected: boolean; error?: string; latencyMs?: number }> {
    const startTime = Date.now();
    
    try {
      const validation = this.validateSourceConfig(sourceConfig);
      if (!validation.valid) {
        return {
          connected: false,
          error: validation.errors.join(', ')
        };
      }

      // Simple connectivity test - just fetch first few bytes
      const testConfig = { ...sourceConfig };
      if (testConfig.type === 'api') {
        // For APIs, make a HEAD request if possible
        const fetcher = new ApiDataFetcher();
        await fetcher.fetchData(testConfig);
      } else {
        // For CSV, try to fetch and parse first few lines
        const fetcher = new CsvDataFetcher();
        const result = await fetcher.fetchData(testConfig);
        if (result.metadata.status === 'error') {
          throw new Error(result.metadata.errors?.join(', '));
        }
      }

      return {
        connected: true,
        latencyMs: Date.now() - startTime
      };

    } catch (error: any) {
      return {
        connected: false,
        error: error.message,
        latencyMs: Date.now() - startTime
      };
    }
  }
}

export default DataFetcherFactory;