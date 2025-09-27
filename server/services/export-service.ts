/**
 * Export Service for Vietnamese Agricultural Market Data
 * Handles CSV/Excel generation with chunked processing for large datasets
 */

import * as xlsx from 'xlsx';
import createCsvWriter from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { storage } from '../storage';
import VietnameseDataFormatter from './data-formatter';
import type { 
  Commodity, Region, PriceData, Forecast, LlmVerification, 
  TradingRecommendation, PricesVerified, Forecast30d 
} from '@shared/schema';

export interface ExportFilters {
  commodityIds?: string[];
  regionIds?: string[];
  startDate?: Date;
  endDate?: Date;
  minPrice?: number;
  maxPrice?: number;
  minConfidence?: number;
  qualityThreshold?: number;
  includeVerifications?: boolean;
  includeRecommendations?: boolean;
  format: 'csv' | 'xlsx';
  chunkSize?: number;
}

export interface ExportJob {
  id: string;
  type: 'market-data' | 'forecasts' | 'price-history' | 'forecast-results';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalRecords: number;
  processedRecords: number;
  filters: ExportFilters;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  startTime: Date;
  completedTime?: Date;
  estimatedCompletion?: Date;
  metadata: {
    exportedBy: string;
    requestId: string;
    chunks: number;
    format: 'csv' | 'xlsx';
  };
}

export interface MarketDataExportRow {
  date: string;
  commodity: string;
  commodityVietnamese: string;
  region: string;
  regionVietnamese: string;
  priceUsd: string;
  priceVnd: string;
  volume?: string;
  quality: string;
  source: string;
  unit: string;
  metadata?: any;
}

export interface ForecastExportRow {
  forecastDate: string;
  targetDate: string;
  commodity: string;
  commodityVietnamese: string;
  region: string;
  regionVietnamese: string;
  medianPrice: string;
  lowPrice: string;
  highPrice: string;
  confidence: string;
  method: string;
  horizon: number;
  mase?: string;
  smape?: string;
  picp?: string;
  coverage?: string;
  fqs?: string;
  openaiConfidence?: string;
  geminiConfidence?: string;
  agreementScore?: string;
  verificationStatus?: string;
  tradingAction?: string;
  tradingActionVietnamese?: string;
  riskLevel?: string;
  riskLevelVietnamese?: string;
  reasoning?: string;
}

class ExportService {
  private static instance: ExportService;
  private activeJobs = new Map<string, ExportJob>();
  private readonly CHUNK_SIZE = 5000;
  private readonly MAX_MEMORY_RECORDS = 50000;
  private readonly EXPORTS_DIR = path.join(process.cwd(), 'exports');

  constructor() {
    // Ensure exports directory exists
    if (!fs.existsSync(this.EXPORTS_DIR)) {
      fs.mkdirSync(this.EXPORTS_DIR, { recursive: true });
    }
  }

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  /**
   * Export market data with Vietnamese formatting
   */
  async exportMarketData(
    filters: ExportFilters, 
    requestId: string,
    exportedBy: string = 'system'
  ): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: ExportJob = {
      id: jobId,
      type: 'market-data',
      status: 'pending',
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      filters,
      startTime: new Date(),
      metadata: {
        exportedBy,
        requestId,
        chunks: 0,
        format: filters.format
      }
    };

    this.activeJobs.set(jobId, job);

    try {
      // Start async processing
      this.processMarketDataExport(job);
      return jobId;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      throw error;
    }
  }

  /**
   * Export forecast results with LLM verifications and recommendations
   */
  async exportForecastResults(
    filters: ExportFilters,
    requestId: string, 
    exportedBy: string = 'system'
  ): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: ExportJob = {
      id: jobId,
      type: 'forecast-results',
      status: 'pending',
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      filters,
      startTime: new Date(),
      metadata: {
        exportedBy,
        requestId,
        chunks: 0,
        format: filters.format
      }
    };

    this.activeJobs.set(jobId, job);

    try {
      // Start async processing
      this.processForecastResultsExport(job);
      return jobId;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      throw error;
    }
  }

  /**
   * Export price history data
   */
  async exportPriceHistory(
    filters: ExportFilters,
    requestId: string,
    exportedBy: string = 'system'
  ): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: ExportJob = {
      id: jobId,
      type: 'price-history',
      status: 'pending',
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      filters,
      startTime: new Date(),
      metadata: {
        exportedBy,
        requestId,
        chunks: 0,
        format: filters.format
      }
    };

    this.activeJobs.set(jobId, job);

    try {
      // Start async processing
      this.processPriceHistoryExport(job);
      return jobId;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      throw error;
    }
  }

  /**
   * Get export job status
   */
  getExportStatus(jobId: string): ExportJob | null {
    return this.activeJobs.get(jobId) || null;
  }

  /**
   * Get all active export jobs
   */
  getActiveJobs(): ExportJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Cancel export job
   */
  cancelExport(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === 'processing') {
      job.status = 'failed';
      job.error = 'Export cancelled by user';
      return true;
    }
    return false;
  }

  /**
   * Process market data export (async)
   */
  private async processMarketDataExport(job: ExportJob): Promise<void> {
    try {
      job.status = 'processing';
      
      // Get commodities and regions for translation
      const [commodities, regions] = await Promise.all([
        storage.getCommodities(),
        storage.getRegions()
      ]);

      const commodityMap = new Map(commodities.map(c => [c.id, c]));
      const regionMap = new Map(regions.map(r => [r.id, r]));

      // Count total records first
      const totalRecords = await this.countMarketDataRecords(job.filters);
      job.totalRecords = totalRecords;

      // Generate filename
      const fileName = VietnameseDataFormatter.generateExportFilename(
        'market-data',
        job.filters.commodityIds?.[0],
        job.filters.regionIds?.[0],
        job.filters.format
      );
      
      const filePath = path.join(this.EXPORTS_DIR, fileName);
      job.fileName = fileName;
      job.filePath = filePath;

      if (job.filters.format === 'csv') {
        await this.generateMarketDataCSV(job, commodityMap, regionMap);
      } else {
        await this.generateMarketDataExcel(job, commodityMap, regionMap);
      }

      // Update job completion
      job.status = 'completed';
      job.progress = 100;
      job.completedTime = new Date();
      job.fileSize = fs.statSync(filePath).size;

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      console.error(`Market data export failed for job ${job.id}:`, error);
    }
  }

  /**
   * Process forecast results export (async)
   */
  private async processForecastResultsExport(job: ExportJob): Promise<void> {
    try {
      job.status = 'processing';
      
      // Get commodities and regions for translation
      const [commodities, regions] = await Promise.all([
        storage.getCommodities(),
        storage.getRegions()
      ]);

      const commodityMap = new Map(commodities.map(c => [c.id, c]));
      const regionMap = new Map(regions.map(r => [r.id, r]));

      // Count total forecast records
      const totalRecords = await this.countForecastRecords(job.filters);
      job.totalRecords = totalRecords;

      // Generate filename
      const fileName = VietnameseDataFormatter.generateExportFilename(
        'forecasts',
        job.filters.commodityIds?.[0],
        job.filters.regionIds?.[0],
        job.filters.format
      );
      
      const filePath = path.join(this.EXPORTS_DIR, fileName);
      job.fileName = fileName;
      job.filePath = filePath;

      if (job.filters.format === 'csv') {
        await this.generateForecastResultsCSV(job, commodityMap, regionMap);
      } else {
        await this.generateForecastResultsExcel(job, commodityMap, regionMap);
      }

      // Update job completion
      job.status = 'completed';
      job.progress = 100;
      job.completedTime = new Date();
      job.fileSize = fs.statSync(filePath).size;

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      console.error(`Forecast results export failed for job ${job.id}:`, error);
    }
  }

  /**
   * Process price history export (async)
   */
  private async processPriceHistoryExport(job: ExportJob): Promise<void> {
    try {
      job.status = 'processing';
      
      // Get commodities and regions for translation
      const [commodities, regions] = await Promise.all([
        storage.getCommodities(),
        storage.getRegions()
      ]);

      const commodityMap = new Map(commodities.map(c => [c.id, c]));
      const regionMap = new Map(regions.map(r => [r.id, r]));

      // Count total price records
      const totalRecords = await this.countPriceHistoryRecords(job.filters);
      job.totalRecords = totalRecords;

      // Generate filename
      const fileName = VietnameseDataFormatter.generateExportFilename(
        'price-history',
        job.filters.commodityIds?.[0],
        job.filters.regionIds?.[0],
        job.filters.format
      );
      
      const filePath = path.join(this.EXPORTS_DIR, fileName);
      job.fileName = fileName;
      job.filePath = filePath;

      if (job.filters.format === 'csv') {
        await this.generatePriceHistoryCSV(job, commodityMap, regionMap);
      } else {
        await this.generatePriceHistoryExcel(job, commodityMap, regionMap);
      }

      // Update job completion
      job.status = 'completed';
      job.progress = 100;
      job.completedTime = new Date();
      job.fileSize = fs.statSync(filePath).size;

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      console.error(`Price history export failed for job ${job.id}:`, error);
    }
  }

  /**
   * Generate market data CSV with streaming for large datasets
   */
  private async generateMarketDataCSV(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    const headers = [
      { id: 'date', title: VietnameseDataFormatter.getVietnameseHeader('date') },
      { id: 'commodity', title: VietnameseDataFormatter.getVietnameseHeader('commodity') },
      { id: 'commodityVietnamese', title: 'Tên Tiếng Việt' },
      { id: 'region', title: VietnameseDataFormatter.getVietnameseHeader('region') },
      { id: 'regionVietnamese', title: 'Khu Vực (Tiếng Việt)' },
      { id: 'priceUsd', title: VietnameseDataFormatter.getVietnameseHeader('priceUsd') },
      { id: 'priceVnd', title: VietnameseDataFormatter.getVietnameseHeader('priceVnd') },
      { id: 'volume', title: VietnameseDataFormatter.getVietnameseHeader('volume') },
      { id: 'quality', title: VietnameseDataFormatter.getVietnameseHeader('quality') },
      { id: 'source', title: VietnameseDataFormatter.getVietnameseHeader('source') },
      { id: 'unit', title: VietnameseDataFormatter.getVietnameseHeader('unit') }
    ];

    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: job.filePath!,
      header: headers,
      encoding: 'utf8'
    });

    // Process in chunks to avoid memory issues
    const chunkSize = job.filters.chunkSize || this.CHUNK_SIZE;
    let offset = 0;
    let processedRecords = 0;

    while (processedRecords < job.totalRecords) {
      // Get chunk of price data
      const priceDataChunk = await this.getMarketDataChunk(job.filters, offset, chunkSize);
      
      if (priceDataChunk.length === 0) break;

      // Transform to export format
      const exportRows: MarketDataExportRow[] = priceDataChunk.map(price => {
        const commodity = commodityMap.get(price.commodityId);
        const region = regionMap.get(price.regionId);
        
        return {
          date: VietnameseDataFormatter.formatDate(price.date),
          commodity: commodity?.name || price.commodityId,
          commodityVietnamese: VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
          region: region?.name || price.regionId,
          regionVietnamese: VietnameseDataFormatter.translateRegion(region?.name || ''),
          priceUsd: VietnameseDataFormatter.formatCurrency(Number(price.price), 'USD'),
          priceVnd: VietnameseDataFormatter.formatCurrency(Number(price.price) * 24180, 'VND'), // Convert to VND
          volume: price.volume ? VietnameseDataFormatter.formatVolume(Number(price.volume), commodity?.unit || 'ton') : '',
          quality: VietnameseDataFormatter.formatQualityScore(Number(price.quality)),
          source: price.source,
          unit: commodity?.unit || 'USD/ton'
        };
      });

      // Write chunk to CSV
      if (offset === 0) {
        await csvWriter.writeRecords(exportRows);
      } else {
        // Append without headers for subsequent chunks
        const appendWriter = createCsvWriter.createObjectCsvWriter({
          path: job.filePath!,
          header: headers,
          append: true,
          encoding: 'utf8'
        });
        await appendWriter.writeRecords(exportRows);
      }

      processedRecords += exportRows.length;
      offset += chunkSize;
      
      // Update progress
      job.processedRecords = processedRecords;
      job.progress = Math.min(Math.round((processedRecords / job.totalRecords) * 100), 99);
      
      // Estimate completion time
      const elapsedTime = Date.now() - job.startTime.getTime();
      const recordsPerMs = processedRecords / elapsedTime;
      const remainingRecords = job.totalRecords - processedRecords;
      const estimatedRemainingMs = remainingRecords / recordsPerMs;
      job.estimatedCompletion = new Date(Date.now() + estimatedRemainingMs);
    }
  }

  /**
   * Generate forecast results CSV
   */
  private async generateForecastResultsCSV(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    const headers = [
      { id: 'forecastDate', title: VietnameseDataFormatter.getVietnameseHeader('forecastDate') },
      { id: 'targetDate', title: VietnameseDataFormatter.getVietnameseHeader('targetDate') },
      { id: 'commodity', title: VietnameseDataFormatter.getVietnameseHeader('commodity') },
      { id: 'commodityVietnamese', title: 'Nông Sản (Tiếng Việt)' },
      { id: 'region', title: VietnameseDataFormatter.getVietnameseHeader('region') },
      { id: 'regionVietnamese', title: 'Khu Vực (Tiếng Việt)' },
      { id: 'medianPrice', title: VietnameseDataFormatter.getVietnameseHeader('medianPrice') },
      { id: 'lowPrice', title: VietnameseDataFormatter.getVietnameseHeader('lowPrice') },
      { id: 'highPrice', title: VietnameseDataFormatter.getVietnameseHeader('highPrice') },
      { id: 'confidence', title: VietnameseDataFormatter.getVietnameseHeader('confidence') },
      { id: 'method', title: VietnameseDataFormatter.getVietnameseHeader('method') },
      { id: 'horizon', title: VietnameseDataFormatter.getVietnameseHeader('horizon') },
      { id: 'mase', title: VietnameseDataFormatter.getVietnameseHeader('mase') },
      { id: 'smape', title: VietnameseDataFormatter.getVietnameseHeader('smape') },
      { id: 'picp', title: VietnameseDataFormatter.getVietnameseHeader('picp') },
      { id: 'openaiConfidence', title: VietnameseDataFormatter.getVietnameseHeader('openaiConfidence') },
      { id: 'geminiConfidence', title: VietnameseDataFormatter.getVietnameseHeader('geminiConfidence') },
      { id: 'agreementScore', title: VietnameseDataFormatter.getVietnameseHeader('agreementScore') },
      { id: 'tradingAction', title: VietnameseDataFormatter.getVietnameseHeader('action') },
      { id: 'tradingActionVietnamese', title: 'Hành Động (Tiếng Việt)' },
      { id: 'riskLevel', title: VietnameseDataFormatter.getVietnameseHeader('riskLevel') },
      { id: 'riskLevelVietnamese', title: 'Mức Rủi Ro (Tiếng Việt)' },
      { id: 'reasoning', title: VietnameseDataFormatter.getVietnameseHeader('reasoning') }
    ];

    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: job.filePath!,
      header: headers,
      encoding: 'utf8'
    });

    // Process in chunks
    const chunkSize = job.filters.chunkSize || this.CHUNK_SIZE;
    let offset = 0;
    let processedRecords = 0;

    while (processedRecords < job.totalRecords) {
      const forecastChunk = await this.getForecastResultsChunk(job.filters, offset, chunkSize);
      
      if (forecastChunk.length === 0) break;

      // Get related data in batch
      const forecastIds = forecastChunk.map(f => f.id);
      const [verifications, recommendations] = await Promise.all([
        this.getVerificationsBatch(forecastIds),
        this.getRecommendationsBatch(forecastIds)
      ]);

      const verificationMap = new Map(verifications.map(v => [v.forecastId, v]));
      const recommendationMap = new Map(recommendations.map(r => [r.forecastId, r]));

      // Transform to export format
      const exportRows: ForecastExportRow[] = [];
      
      for (const forecast of forecastChunk) {
        const commodity = commodityMap.get(forecast.commodityId);
        const region = regionMap.get(forecast.regionId);
        const forecastVerifications = verifications.filter(v => v.forecastId === forecast.id);
        const forecastRecommendations = recommendations.filter(r => r.forecastId === forecast.id);
        
        // Process each prediction in forecast
        if (forecast.predictions) {
          for (const prediction of forecast.predictions) {
            const openaiVerification = forecastVerifications.find(v => v.provider === 'openai');
            const geminiVerification = forecastVerifications.find(v => v.provider === 'gemini');
            const recommendation = forecastRecommendations[0]; // Take first recommendation
            
            exportRows.push({
              forecastDate: VietnameseDataFormatter.formatDate(forecast.forecastDate),
              targetDate: VietnameseDataFormatter.formatDate(prediction.date),
              commodity: commodity?.name || forecast.commodityId,
              commodityVietnamese: VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
              region: region?.name || forecast.regionId,
              regionVietnamese: VietnameseDataFormatter.translateRegion(region?.name || ''),
              medianPrice: VietnameseDataFormatter.formatCurrency(prediction.median, 'USD'),
              lowPrice: VietnameseDataFormatter.formatCurrency(prediction.q10, 'USD'),
              highPrice: VietnameseDataFormatter.formatCurrency(prediction.q90, 'USD'),
              confidence: VietnameseDataFormatter.formatConfidence(prediction.confidence),
              method: forecast.method,
              horizon: forecast.horizon,
              mase: forecast.metrics?.mase ? forecast.metrics.mase.toFixed(4) : '',
              smape: forecast.metrics?.smape ? VietnameseDataFormatter.formatPercentage(forecast.metrics.smape) : '',
              picp: forecast.metrics?.picp ? VietnameseDataFormatter.formatPercentage(forecast.metrics.picp) : '',
              openaiConfidence: openaiVerification ? VietnameseDataFormatter.formatConfidence(Number(openaiVerification.confidence)) : '',
              geminiConfidence: geminiVerification ? VietnameseDataFormatter.formatConfidence(Number(geminiVerification.confidence)) : '',
              agreementScore: this.calculateAgreementScore(openaiVerification, geminiVerification),
              tradingAction: recommendation?.action || '',
              tradingActionVietnamese: recommendation?.action ? VietnameseDataFormatter.translateTradingAction(recommendation.action) : '',
              riskLevel: recommendation?.riskLevel || '',
              riskLevelVietnamese: recommendation?.riskLevel ? VietnameseDataFormatter.translateRiskLevel(recommendation.riskLevel) : '',
              reasoning: recommendation?.reasoning || ''
            });
          }
        }
      }

      // Write chunk to CSV
      if (offset === 0) {
        await csvWriter.writeRecords(exportRows);
      } else {
        const appendWriter = createCsvWriter.createObjectCsvWriter({
          path: job.filePath!,
          header: headers,
          append: true,
          encoding: 'utf8'
        });
        await appendWriter.writeRecords(exportRows);
      }

      processedRecords += forecastChunk.length;
      offset += chunkSize;
      
      // Update progress
      job.processedRecords = processedRecords;
      job.progress = Math.min(Math.round((processedRecords / job.totalRecords) * 100), 99);
    }
  }

  /**
   * Generate market data Excel with charts and formatting
   */
  private async generateMarketDataExcel(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    const workbook = xlsx.utils.book_new();
    
    // Get all data (for Excel, we'll process everything at once for simplicity)
    const allData = await this.getAllMarketData(job.filters);
    
    // Transform data
    const excelData = allData.map(price => {
      const commodity = commodityMap.get(price.commodityId);
      const region = regionMap.get(price.regionId);
      
      return {
        [VietnameseDataFormatter.getVietnameseHeader('date')]: VietnameseDataFormatter.formatDate(price.date),
        [VietnameseDataFormatter.getVietnameseHeader('commodity')]: commodity?.name || price.commodityId,
        'Tên Tiếng Việt': VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
        [VietnameseDataFormatter.getVietnameseHeader('region')]: region?.name || price.regionId,
        'Khu Vực (Tiếng Việt)': VietnameseDataFormatter.translateRegion(region?.name || ''),
        [VietnameseDataFormatter.getVietnameseHeader('priceUsd')]: Number(price.price),
        [VietnameseDataFormatter.getVietnameseHeader('priceVnd')]: Number(price.price) * 24180,
        [VietnameseDataFormatter.getVietnameseHeader('volume')]: price.volume ? Number(price.volume) : null,
        [VietnameseDataFormatter.getVietnameseHeader('quality')]: Number(price.quality),
        [VietnameseDataFormatter.getVietnameseHeader('source')]: price.source,
        [VietnameseDataFormatter.getVietnameseHeader('unit')]: commodity?.unit || 'USD/ton'
      };
    });

    // Create worksheet
    const worksheet = xlsx.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Market Data');
    
    // Add metadata worksheet
    const metadata = {
      'Thông Tin Xuất Dữ Liệu': [
        { 'Thuộc Tính': 'Ngày Xuất', 'Giá Trị': VietnameseDataFormatter.formatDateTime(job.startTime) },
        { 'Thuộc Tính': 'Người Xuất', 'Giá Trị': job.metadata.exportedBy },
        { 'Thuộc Tính': 'Số Bản Ghi', 'Giá Trị': job.totalRecords },
        { 'Thuộc Tính': 'Định Dạng', 'Giá Trị': job.filters.format.toUpperCase() },
        { 'Thuộc Tính': 'Bộ Lọc Ngày', 'Giá Trị': job.filters.startDate ? `${VietnameseDataFormatter.formatDate(job.filters.startDate)} - ${VietnameseDataFormatter.formatDate(job.filters.endDate)}` : 'Tất cả' }
      ]
    };
    
    const metadataWorksheet = xlsx.utils.json_to_sheet(metadata['Thông Tin Xuất Dữ Liệu']);
    xlsx.utils.book_append_sheet(workbook, metadataWorksheet, 'Metadata');
    
    // Write file
    xlsx.writeFile(workbook, job.filePath!);
    
    // Update progress
    job.processedRecords = job.totalRecords;
    job.progress = 99;
  }

  /**
   * Generate forecast results Excel
   */
  private async generateForecastResultsExcel(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    const workbook = xlsx.utils.book_new();
    
    // Get all forecast data
    const allForecasts = await this.getAllForecastResults(job.filters);
    
    // Get related data
    const forecastIds = allForecasts.map(f => f.id);
    const [verifications, recommendations] = await Promise.all([
      this.getVerificationsBatch(forecastIds),
      this.getRecommendationsBatch(forecastIds)
    ]);

    // Transform data
    const excelData = [];
    for (const forecast of allForecasts) {
      const commodity = commodityMap.get(forecast.commodityId);
      const region = regionMap.get(forecast.regionId);
      const forecastVerifications = verifications.filter(v => v.forecastId === forecast.id);
      const forecastRecommendations = recommendations.filter(r => r.forecastId === forecast.id);
      
      if (forecast.predictions) {
        for (const prediction of forecast.predictions) {
          const openaiVerification = forecastVerifications.find(v => v.provider === 'openai');
          const geminiVerification = forecastVerifications.find(v => v.provider === 'gemini');
          const recommendation = forecastRecommendations[0];
          
          excelData.push({
            [VietnameseDataFormatter.getVietnameseHeader('forecastDate')]: VietnameseDataFormatter.formatDate(forecast.forecastDate),
            [VietnameseDataFormatter.getVietnameseHeader('targetDate')]: VietnameseDataFormatter.formatDate(prediction.date),
            [VietnameseDataFormatter.getVietnameseHeader('commodity')]: commodity?.name || forecast.commodityId,
            'Nông Sản (Tiếng Việt)': VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
            [VietnameseDataFormatter.getVietnameseHeader('region')]: region?.name || forecast.regionId,
            'Khu Vực (Tiếng Việt)': VietnameseDataFormatter.translateRegion(region?.name || ''),
            [VietnameseDataFormatter.getVietnameseHeader('medianPrice')]: prediction.median,
            [VietnameseDataFormatter.getVietnameseHeader('lowPrice')]: prediction.q10,
            [VietnameseDataFormatter.getVietnameseHeader('highPrice')]: prediction.q90,
            [VietnameseDataFormatter.getVietnameseHeader('confidence')]: prediction.confidence,
            [VietnameseDataFormatter.getVietnameseHeader('method')]: forecast.method,
            [VietnameseDataFormatter.getVietnameseHeader('horizon')]: forecast.horizon,
            [VietnameseDataFormatter.getVietnameseHeader('mase')]: forecast.metrics?.mase || null,
            [VietnameseDataFormatter.getVietnameseHeader('smape')]: forecast.metrics?.smape || null,
            [VietnameseDataFormatter.getVietnameseHeader('picp')]: forecast.metrics?.picp || null,
            [VietnameseDataFormatter.getVietnameseHeader('openaiConfidence')]: openaiVerification ? Number(openaiVerification.confidence) : null,
            [VietnameseDataFormatter.getVietnameseHeader('geminiConfidence')]: geminiVerification ? Number(geminiVerification.confidence) : null,
            [VietnameseDataFormatter.getVietnameseHeader('action')]: recommendation?.action || '',
            'Hành Động (Tiếng Việt)': recommendation?.action ? VietnameseDataFormatter.translateTradingAction(recommendation.action) : '',
            [VietnameseDataFormatter.getVietnameseHeader('riskLevel')]: recommendation?.riskLevel || '',
            'Mức Rủi Ro (Tiếng Việt)': recommendation?.riskLevel ? VietnameseDataFormatter.translateRiskLevel(recommendation.riskLevel) : '',
            [VietnameseDataFormatter.getVietnameseHeader('reasoning')]: recommendation?.reasoning || ''
          });
        }
      }
    }

    // Create main worksheet
    const worksheet = xlsx.utils.json_to_sheet(excelData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Forecast Results');
    
    // Add summary worksheet
    const summary = this.generateForecastSummary(allForecasts, verifications, recommendations);
    const summaryWorksheet = xlsx.utils.json_to_sheet(summary);
    xlsx.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
    
    // Write file
    xlsx.writeFile(workbook, job.filePath!);
    
    job.processedRecords = job.totalRecords;
    job.progress = 99;
  }

  /**
   * Generate price history CSV
   */
  private async generatePriceHistoryCSV(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    // Similar implementation to market data but using PricesVerified table
    const headers = [
      { id: 'date', title: VietnameseDataFormatter.getVietnameseHeader('date') },
      { id: 'commodity', title: VietnameseDataFormatter.getVietnameseHeader('commodity') },
      { id: 'commodityVietnamese', title: 'Tên Tiếng Việt' },
      { id: 'region', title: VietnameseDataFormatter.getVietnameseHeader('region') },
      { id: 'regionVietnamese', title: 'Khu Vực (Tiếng Việt)' },
      { id: 'priceUsd', title: VietnameseDataFormatter.getVietnameseHeader('priceUsd') },
      { id: 'priceVnd', title: VietnameseDataFormatter.getVietnameseHeader('priceVnd') },
      { id: 'quality', title: VietnameseDataFormatter.getVietnameseHeader('quality') },
      { id: 'verified', title: 'Đã Xác Minh' },
      { id: 'confidence', title: VietnameseDataFormatter.getVietnameseHeader('confidence') }
    ];

    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: job.filePath!,
      header: headers,
      encoding: 'utf8'
    });

    // Process in chunks
    const chunkSize = job.filters.chunkSize || this.CHUNK_SIZE;
    let offset = 0;
    let processedRecords = 0;

    while (processedRecords < job.totalRecords) {
      const priceHistoryChunk = await this.getPriceHistoryChunk(job.filters, offset, chunkSize);
      
      if (priceHistoryChunk.length === 0) break;

      const exportRows = priceHistoryChunk.map(price => {
        const commodity = commodityMap.get(price.commodityId);
        const region = regionMap.get(price.regionId);
        
        return {
          date: VietnameseDataFormatter.formatDate(price.date),
          commodity: commodity?.name || price.commodityId,
          commodityVietnamese: VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
          region: region?.name || price.regionId,
          regionVietnamese: VietnameseDataFormatter.translateRegion(region?.name || ''),
          priceUsd: VietnameseDataFormatter.formatCurrency(Number(price.price), 'USD'),
          priceVnd: VietnameseDataFormatter.formatCurrency(Number(price.price) * 24180, 'VND'),
          quality: VietnameseDataFormatter.formatQualityScore(Number(price.qualityScore)),
          verified: price.isVerified ? 'Đã xác minh' : 'Chưa xác minh',
          confidence: price.confidence ? VietnameseDataFormatter.formatConfidence(Number(price.confidence)) : ''
        };
      });

      // Write chunk
      if (offset === 0) {
        await csvWriter.writeRecords(exportRows);
      } else {
        const appendWriter = createCsvWriter.createObjectCsvWriter({
          path: job.filePath!,
          header: headers,
          append: true,
          encoding: 'utf8'
        });
        await appendWriter.writeRecords(exportRows);
      }

      processedRecords += exportRows.length;
      offset += chunkSize;
      
      job.processedRecords = processedRecords;
      job.progress = Math.min(Math.round((processedRecords / job.totalRecords) * 100), 99);
    }
  }

  /**
   * Generate price history Excel
   */
  private async generatePriceHistoryExcel(
    job: ExportJob,
    commodityMap: Map<string, Commodity>,
    regionMap: Map<string, Region>
  ): Promise<void> {
    // Similar to market data Excel but using price history data
    const workbook = xlsx.utils.book_new();
    const allData = await this.getAllPriceHistory(job.filters);
    
    const excelData = allData.map(price => {
      const commodity = commodityMap.get(price.commodityId);
      const region = regionMap.get(price.regionId);
      
      return {
        [VietnameseDataFormatter.getVietnameseHeader('date')]: VietnameseDataFormatter.formatDate(price.date),
        [VietnameseDataFormatter.getVietnameseHeader('commodity')]: commodity?.name || price.commodityId,
        'Tên Tiếng Việt': VietnameseDataFormatter.translateCommodity(commodity?.name || ''),
        [VietnameseDataFormatter.getVietnameseHeader('region')]: region?.name || price.regionId,
        'Khu Vực (Tiếng Việt)': VietnameseDataFormatter.translateRegion(region?.name || ''),
        [VietnameseDataFormatter.getVietnameseHeader('priceUsd')]: Number(price.price),
        [VietnameseDataFormatter.getVietnameseHeader('priceVnd')]: Number(price.price) * 24180,
        [VietnameseDataFormatter.getVietnameseHeader('quality')]: Number(price.qualityScore),
        'Đã Xác Minh': price.isVerified ? 'Có' : 'Không',
        [VietnameseDataFormatter.getVietnameseHeader('confidence')]: price.confidence ? Number(price.confidence) : null
      };
    });

    const worksheet = xlsx.utils.json_to_sheet(excelData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Price History');
    
    // Add metadata
    const metadata = {
      'Thông Tin Xuất Dữ Liệu': [
        { 'Thuộc Tính': 'Ngày Xuất', 'Giá Trị': VietnameseDataFormatter.formatDateTime(job.startTime) },
        { 'Thuộc Tính': 'Người Xuất', 'Giá Trị': job.metadata.exportedBy },
        { 'Thuộc Tính': 'Số Bản Ghi', 'Giá Trị': job.totalRecords },
        { 'Thuộc Tính': 'Loại Dữ Liệu', 'Giá Trị': 'Lịch Sử Giá Cả' }
      ]
    };
    
    const metadataWorksheet = xlsx.utils.json_to_sheet(metadata['Thông Tin Xuất Dữ Liệu']);
    xlsx.utils.book_append_sheet(workbook, metadataWorksheet, 'Metadata');
    
    xlsx.writeFile(workbook, job.filePath!);
    job.processedRecords = job.totalRecords;
    job.progress = 99;
  }

  // Helper methods for data retrieval

  private async countMarketDataRecords(filters: ExportFilters): Promise<number> {
    // Implementation would use storage to count records based on filters
    // This is a simplified version
    const allData = await storage.getPriceData(
      filters.commodityIds?.[0] || '',
      filters.regionIds?.[0] || '',
      filters.startDate,
      filters.endDate
    );
    return allData.length;
  }

  private async countForecastRecords(filters: ExportFilters): Promise<number> {
    const allForecasts = await storage.getAllActiveForecasts();
    return allForecasts.length;
  }

  private async countPriceHistoryRecords(filters: ExportFilters): Promise<number> {
    // Would implement proper counting from PricesVerified table
    return 1000; // Placeholder
  }

  private async getMarketDataChunk(filters: ExportFilters, offset: number, limit: number): Promise<any[]> {
    // Implementation would use offset/limit with storage
    const allData = await storage.getPriceData(
      filters.commodityIds?.[0] || '',
      filters.regionIds?.[0] || '',
      filters.startDate,
      filters.endDate
    );
    return allData.slice(offset, offset + limit);
  }

  private async getForecastResultsChunk(filters: ExportFilters, offset: number, limit: number): Promise<Forecast[]> {
    const allForecasts = await storage.getAllActiveForecasts();
    return allForecasts.slice(offset, offset + limit);
  }

  private async getPriceHistoryChunk(filters: ExportFilters, offset: number, limit: number): Promise<any[]> {
    // Would implement proper chunk retrieval from PricesVerified
    return []; // Placeholder
  }

  private async getAllMarketData(filters: ExportFilters): Promise<any[]> {
    return await storage.getPriceData(
      filters.commodityIds?.[0] || '',
      filters.regionIds?.[0] || '',
      filters.startDate,
      filters.endDate
    );
  }

  private async getAllForecastResults(filters: ExportFilters): Promise<Forecast[]> {
    return await storage.getAllActiveForecasts();
  }

  private async getAllPriceHistory(filters: ExportFilters): Promise<any[]> {
    return []; // Placeholder - would implement proper retrieval
  }

  private async getVerificationsBatch(forecastIds: string[]): Promise<LlmVerification[]> {
    const verifications = [];
    for (const forecastId of forecastIds) {
      const verification = await storage.getVerifications(forecastId);
      verifications.push(...verification);
    }
    return verifications;
  }

  private async getRecommendationsBatch(forecastIds: string[]): Promise<TradingRecommendation[]> {
    const recommendations = [];
    for (const forecastId of forecastIds) {
      const recommendation = await storage.getRecommendations(forecastId);
      recommendations.push(...recommendation);
    }
    return recommendations;
  }

  private calculateAgreementScore(openaiVerification: LlmVerification | undefined, geminiVerification: LlmVerification | undefined): string {
    if (!openaiVerification || !geminiVerification) return '';
    
    const openaiConf = Number(openaiVerification.confidence);
    const geminiConf = Number(geminiVerification.confidence);
    const agreement = 1 - Math.abs(openaiConf - geminiConf);
    
    return VietnameseDataFormatter.formatPercentage(agreement * 100);
  }

  private generateForecastSummary(forecasts: Forecast[], verifications: LlmVerification[], recommendations: TradingRecommendation[]): any[] {
    return [
      { 'Thông Số': 'Tổng Số Dự Báo', 'Giá Trị': forecasts.length },
      { 'Thông Số': 'Dự Báo Đã Xác Minh', 'Giá Trị': verifications.length / 2 }, // Divide by 2 for dual verification
      { 'Thông Số': 'Khuyến Nghị Giao Dịch', 'Giá Trị': recommendations.length },
      { 'Thông Số': 'Độ Tin Cậy Trung Bình', 'Giá Trị': this.calculateAverageConfidence(forecasts) }
    ];
  }

  private calculateAverageConfidence(forecasts: Forecast[]): string {
    if (forecasts.length === 0) return '0%';
    
    let totalConfidence = 0;
    let predictionCount = 0;
    
    for (const forecast of forecasts) {
      if (forecast.predictions) {
        for (const prediction of forecast.predictions) {
          totalConfidence += prediction.confidence;
          predictionCount++;
        }
      }
    }
    
    const avgConfidence = predictionCount > 0 ? totalConfidence / predictionCount : 0;
    return VietnameseDataFormatter.formatPercentage(avgConfidence * 100);
  }

  private generateJobId(): string {
    return `export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up old export files
   */
  cleanupOldExports(maxAgeHours: number = 24): void {
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    
    try {
      const files = fs.readdirSync(this.EXPORTS_DIR);
      
      for (const file of files) {
        const filePath = path.join(this.EXPORTS_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up old export file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up old exports:', error);
    }
  }

  /**
   * Get export file for download
   */
  getExportFile(jobId: string): { filePath: string; fileName: string } | null {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === 'completed' && job.filePath && job.fileName) {
      return { filePath: job.filePath, fileName: job.fileName };
    }
    return null;
  }
}

export default ExportService.getInstance();