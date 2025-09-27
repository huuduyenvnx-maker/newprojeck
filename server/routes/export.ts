/**
 * Export API Routes for Vietnamese Agricultural Market Data
 * Handles CSV/Excel export with progress tracking and Vietnamese formatting
 * Enhanced with authentication and rate limiting for security
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import ExportService from '../services/export-service';
import type { ExportFilters } from '../services/export-service';
import { 
  authenticateExportUser, 
  authorizeExportOperation,
  type AuthenticatedRequest
} from '../middleware/export-auth';
import { 
  exportRateLimit,
  addConcurrentJob,
  removeConcurrentJob,
  trackDataExported
} from '../middleware/export-rate-limit';

const router = Router();

// Apply authentication and rate limiting to all export routes
router.use(authenticateExportUser);
router.use(exportRateLimit);
router.use(authorizeExportOperation(['admin', 'user', 'analyst']));

// Request validation schemas
const ExportRequestSchema = z.object({
  commodityIds: z.array(z.string()).optional(),
  regionIds: z.array(z.string()).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
  includeVerifications: z.boolean().default(true),
  includeRecommendations: z.boolean().default(true),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  chunkSize: z.number().min(100).max(10000).optional()
});

const MarketDataExportSchema = ExportRequestSchema.extend({
  includePriceHistory: z.boolean().default(true),
  includeSeasonalData: z.boolean().default(false),
  includeWeatherImpact: z.boolean().default(false),
  groupByRegion: z.boolean().default(false),
  groupByCommodity: z.boolean().default(false)
});

const ForecastExportSchema = ExportRequestSchema.extend({
  includeMetrics: z.boolean().default(true),
  includePredictionIntervals: z.boolean().default(true),
  includeLlmAnalysis: z.boolean().default(true),
  forecastHorizon: z.number().min(1).max(365).default(30)
});

const PriceHistoryExportSchema = ExportRequestSchema.extend({
  includeRawData: z.boolean().default(false),
  includeVerifiedOnly: z.boolean().default(true),
  aggregationPeriod: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  includeTrends: z.boolean().default(false)
});

/**
 * POST /api/export/market-data
 * Export comprehensive market data with Vietnamese formatting
 */
router.post('/market-data', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const validatedData = MarketDataExportSchema.parse(req.body);
    const requestId = authReq.requestId;
    const exportedBy = authReq.userId;

    // Convert to ExportFilters format
    const filters: ExportFilters = {
      commodityIds: validatedData.commodityIds,
      regionIds: validatedData.regionIds,
      startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined,
      minPrice: validatedData.minPrice,
      maxPrice: validatedData.maxPrice,
      minConfidence: validatedData.minConfidence,
      qualityThreshold: validatedData.qualityThreshold,
      includeVerifications: validatedData.includeVerifications,
      includeRecommendations: validatedData.includeRecommendations,
      format: validatedData.format,
      chunkSize: validatedData.chunkSize
    };

    // Start export job
    const jobId = await ExportService.exportMarketData(filters, requestId, exportedBy);
    
    // Track concurrent job for rate limiting
    addConcurrentJob(authReq.userId, jobId);

    res.status(202).json({
      success: true,
      message: 'Export job started successfully',
      messageVietnamese: 'Công việc xuất dữ liệu đã bắt đầu thành công',
      data: {
        jobId,
        requestId,
        estimatedCompletionTime: '2-5 minutes',
        estimatedCompletionTimeVietnamese: '2-5 phút',
        statusEndpoint: `/api/export/status/${jobId}`,
        downloadEndpoint: `/api/export/download/${jobId}`
      },
      meta: {
        exportType: 'market-data',
        format: validatedData.format,
        filters: {
          commodities: validatedData.commodityIds?.length || 0,
          regions: validatedData.regionIds?.length || 0,
          dateRange: validatedData.startDate && validatedData.endDate ? 
            `${validatedData.startDate} to ${validatedData.endDate}` : 'all',
          priceRange: validatedData.minPrice || validatedData.maxPrice ? 
            `${validatedData.minPrice || 0} - ${validatedData.maxPrice || 'unlimited'}` : 'all'
        }
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request parameters',
        messageVietnamese: 'Tham số yêu cầu không hợp lệ',
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      });
    }

    console.error('Market data export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start market data export',
      messageVietnamese: 'Không thể bắt đầu xuất dữ liệu thị trường',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/export/forecasts
 * Export forecast results with LLM verification and trading recommendations
 */
router.post('/forecasts', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const validatedData = ForecastExportSchema.parse(req.body);
    const requestId = authReq.requestId;
    const exportedBy = authReq.userId;

    const filters: ExportFilters = {
      commodityIds: validatedData.commodityIds,
      regionIds: validatedData.regionIds,
      startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined,
      minPrice: validatedData.minPrice,
      maxPrice: validatedData.maxPrice,
      minConfidence: validatedData.minConfidence,
      qualityThreshold: validatedData.qualityThreshold,
      includeVerifications: validatedData.includeVerifications,
      includeRecommendations: validatedData.includeRecommendations,
      format: validatedData.format,
      chunkSize: validatedData.chunkSize
    };

    const jobId = await ExportService.exportForecastResults(filters, requestId, exportedBy);
    
    // Track concurrent job for rate limiting
    addConcurrentJob(authReq.userId, jobId);

    res.status(202).json({
      success: true,
      message: 'Forecast export job started successfully',
      messageVietnamese: 'Công việc xuất dự báo đã bắt đầu thành công',
      data: {
        jobId,
        requestId,
        estimatedCompletionTime: '3-7 minutes',
        estimatedCompletionTimeVietnamese: '3-7 phút',
        statusEndpoint: `/api/export/status/${jobId}`,
        downloadEndpoint: `/api/export/download/${jobId}`
      },
      meta: {
        exportType: 'forecasts',
        format: validatedData.format,
        includedFeatures: {
          metrics: validatedData.includeMetrics,
          predictionIntervals: validatedData.includePredictionIntervals,
          llmAnalysis: validatedData.includeLlmAnalysis,
          verifications: validatedData.includeVerifications,
          recommendations: validatedData.includeRecommendations
        },
        forecastHorizon: `${validatedData.forecastHorizon} days`
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid forecast export parameters',
        messageVietnamese: 'Tham số xuất dự báo không hợp lệ',
        errors: error.errors
      });
    }

    console.error('Forecast export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start forecast export',
      messageVietnamese: 'Không thể bắt đầu xuất dự báo',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/export/price-history
 * Export historical price data with quality metrics
 */
router.post('/price-history', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const validatedData = PriceHistoryExportSchema.parse(req.body);
    const requestId = authReq.requestId;
    const exportedBy = authReq.userId;

    const filters: ExportFilters = {
      commodityIds: validatedData.commodityIds,
      regionIds: validatedData.regionIds,
      startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined,
      minPrice: validatedData.minPrice,
      maxPrice: validatedData.maxPrice,
      minConfidence: validatedData.minConfidence,
      qualityThreshold: validatedData.qualityThreshold,
      includeVerifications: validatedData.includeVerifications,
      includeRecommendations: false, // Not applicable for price history
      format: validatedData.format,
      chunkSize: validatedData.chunkSize
    };

    const jobId = await ExportService.exportPriceHistory(filters, requestId, exportedBy);
    
    // Track concurrent job for rate limiting
    addConcurrentJob(authReq.userId, jobId);

    res.status(202).json({
      success: true,
      message: 'Price history export job started successfully',
      messageVietnamese: 'Công việc xuất lịch sử giá đã bắt đầu thành công',
      data: {
        jobId,
        requestId,
        estimatedCompletionTime: '1-3 minutes',
        estimatedCompletionTimeVietnamese: '1-3 phút',
        statusEndpoint: `/api/export/status/${jobId}`,
        downloadEndpoint: `/api/export/download/${jobId}`
      },
      meta: {
        exportType: 'price-history',
        format: validatedData.format,
        settings: {
          includeRawData: validatedData.includeRawData,
          verifiedOnly: validatedData.includeVerifiedOnly,
          aggregationPeriod: validatedData.aggregationPeriod,
          includeTrends: validatedData.includeTrends
        }
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price history export parameters',
        messageVietnamese: 'Tham số xuất lịch sử giá không hợp lệ',
        errors: error.errors
      });
    }

    console.error('Price history export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start price history export',
      messageVietnamese: 'Không thể bắt đầu xuất lịch sử giá',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/export/status/:exportId
 * Get export job status and progress
 */
router.get('/status/:exportId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { exportId } = req.params;
    
    if (!exportId) {
      return res.status(400).json({
        success: false,
        message: 'Export ID is required',
        messageVietnamese: 'ID xuất dữ liệu là bắt buộc'
      });
    }

    const job = ExportService.getExportStatus(exportId);
    
    if (!job) {
      // Clean up any dangling concurrent job tracking
      removeConcurrentJob(authReq.userId, exportId);
      
      return res.status(404).json({
        success: false,
        message: 'Export job not found',
        messageVietnamese: 'Không tìm thấy công việc xuất dữ liệu',
        error: `Job with ID ${exportId} does not exist or has expired`
      });
    }

    // Clean up concurrent job tracking when job is completed or failed
    if (job.status === 'completed' || job.status === 'failed') {
      removeConcurrentJob(authReq.userId, exportId);
      
      // Track data exported for rate limiting (if completed)
      if (job.status === 'completed' && job.fileSize) {
        const sizeInMB = job.fileSize / (1024 * 1024);
        trackDataExported(authReq.userId, sizeInMB);
      }
    }

    // Calculate Vietnamese status messages
    const statusMessages = {
      pending: 'Đang chờ xử lý',
      processing: 'Đang xử lý',
      completed: 'Hoàn thành',
      failed: 'Thất bại'
    };

    const typeMessages = {
      'market-data': 'Dữ liệu thị trường',
      'forecasts': 'Dự báo',
      'forecast-results': 'Kết quả dự báo',
      'price-history': 'Lịch sử giá'
    };

    // Calculate time remaining
    let timeRemaining = null;
    let timeRemainingVietnamese = null;
    
    if (job.status === 'processing' && job.estimatedCompletion) {
      const remaining = job.estimatedCompletion.getTime() - Date.now();
      if (remaining > 0) {
        const minutes = Math.ceil(remaining / (1000 * 60));
        timeRemaining = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        timeRemainingVietnamese = `${minutes} phút`;
      }
    }

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        statusVietnamese: statusMessages[job.status],
        type: job.type,
        typeVietnamese: typeMessages[job.type],
        progress: job.progress,
        totalRecords: job.totalRecords,
        processedRecords: job.processedRecords,
        startTime: job.startTime.toISOString(),
        completedTime: job.completedTime?.toISOString(),
        estimatedCompletion: job.estimatedCompletion?.toISOString(),
        timeRemaining,
        timeRemainingVietnamese,
        fileName: job.fileName,
        fileSize: job.fileSize,
        error: job.error,
        metadata: job.metadata,
        downloadAvailable: job.status === 'completed' && job.filePath,
        downloadUrl: job.status === 'completed' ? `/api/export/download/${job.id}` : null
      },
      meta: {
        requestTime: new Date().toISOString(),
        format: job.filters.format,
        filters: job.filters
      }
    });

  } catch (error) {
    console.error('Export status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get export status',
      messageVietnamese: 'Không thể lấy trạng thái xuất dữ liệu',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/export/download/:exportId
 * Download completed export file
 */
router.get('/download/:exportId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { exportId } = req.params;
    
    if (!exportId) {
      return res.status(400).json({
        success: false,
        message: 'Export ID is required',
        messageVietnamese: 'ID xuất dữ liệu là bắt buộc'
      });
    }

    const exportFile = ExportService.getExportFile(exportId);
    
    if (!exportFile) {
      return res.status(404).json({
        success: false,
        message: 'Export file not found or not ready',
        messageVietnamese: 'Không tìm thấy tệp xuất hoặc chưa sẵn sàng',
        error: 'File may not exist, export may still be processing, or export may have failed'
      });
    }

    const { filePath, fileName } = exportFile;

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Export file has been removed or corrupted',
        messageVietnamese: 'Tệp xuất đã bị xóa hoặc hỏng'
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Set appropriate headers for download
    const mimeType = fileName.endsWith('.xlsx') ? 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
      'text/csv';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Export-ID', exportId);
    res.setHeader('X-File-Size', fileSize.toString());
    res.setHeader('X-Generated-Time', stats.mtime.toISOString());

    // Stream file to response
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error reading export file',
          messageVietnamese: 'Lỗi đọc tệp xuất',
          error: 'File read error'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('Export download error:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download export file',
        messageVietnamese: 'Không thể tải xuống tệp xuất',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

/**
 * GET /api/export/jobs
 * Get all active export jobs (for admin/monitoring)
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const jobs = ExportService.getActiveJobs();
    
    const jobSummaries = jobs.map(job => ({
      jobId: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      totalRecords: job.totalRecords,
      processedRecords: job.processedRecords,
      startTime: job.startTime.toISOString(),
      completedTime: job.completedTime?.toISOString(),
      exportedBy: job.metadata.exportedBy,
      format: job.metadata.format,
      fileName: job.fileName,
      fileSize: job.fileSize
    }));

    res.json({
      success: true,
      message: 'Active export jobs retrieved successfully',
      messageVietnamese: 'Lấy danh sách công việc xuất hoạt động thành công',
      data: {
        jobs: jobSummaries,
        totalJobs: jobSummaries.length,
        activeJobs: jobSummaries.filter(j => j.status === 'processing').length,
        completedJobs: jobSummaries.filter(j => j.status === 'completed').length,
        failedJobs: jobSummaries.filter(j => j.status === 'failed').length
      },
      meta: {
        requestTime: new Date().toISOString(),
        serverUptime: process.uptime()
      }
    });

  } catch (error) {
    console.error('Export jobs list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get export jobs',
      messageVietnamese: 'Không thể lấy danh sách công việc xuất',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * DELETE /api/export/:exportId
 * Cancel export job or delete export file
 */
router.delete('/:exportId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { exportId } = req.params;
    
    if (!exportId) {
      return res.status(400).json({
        success: false,
        message: 'Export ID is required',
        messageVietnamese: 'ID xuất dữ liệu là bắt buộc'
      });
    }

    const cancelled = ExportService.cancelExport(exportId);
    
    if (cancelled) {
      // Clean up concurrent job tracking
      removeConcurrentJob(authReq.userId, exportId);
      
      res.json({
        success: true,
        message: 'Export job cancelled successfully',
        messageVietnamese: 'Hủy công việc xuất thành công',
        data: { jobId: exportId, cancelled: true }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Export job not found or cannot be cancelled',
        messageVietnamese: 'Không tìm thấy công việc xuất hoặc không thể hủy',
        error: 'Job may not exist, already completed, or already failed'
      });
    }

  } catch (error) {
    console.error('Export cancel error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel export job',
      messageVietnamese: 'Không thể hủy công việc xuất',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/export/cleanup
 * Clean up old export files (admin endpoint)
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const { maxAgeHours = 24 } = req.body;
    
    ExportService.cleanupOldExports(maxAgeHours);
    
    res.json({
      success: true,
      message: 'Export cleanup completed successfully',
      messageVietnamese: 'Dọn dẹp tệp xuất hoàn thành thành công',
      data: {
        maxAgeHours,
        cleanupTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Export cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup export files',
      messageVietnamese: 'Không thể dọn dẹp tệp xuất',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;