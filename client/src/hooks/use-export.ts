/**
 * Export functionality hook for Vietnamese agricultural market data
 * Now uses shared ExportContext for state management to avoid multiple independent instances
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useTranslation } from 'react-i18next';
import { useExportContext } from '@/contexts/export-context';

// Helper function to get session token (in production, this would be from proper auth)
const getSessionToken = (): string => {
  // For development, return a test session token
  // In production, this would get the token from localStorage, cookies, or auth context
  let token = localStorage.getItem('sessionToken');
  if (!token) {
    // Create a test session for development
    token = 'test-session-' + Date.now();
    localStorage.setItem('sessionToken', token);
  }
  return token;
};

export interface ExportFilters {
  commodityIds?: string[];
  regionIds?: string[];
  startDate?: string;
  endDate?: string;
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
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  statusVietnamese: string;
  type: string;
  typeVietnamese: string;
  progress: number;
  totalRecords: number;
  processedRecords: number;
  startTime: string;
  completedTime?: string;
  estimatedCompletion?: string;
  timeRemaining?: string;
  timeRemainingVietnamese?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  downloadAvailable: boolean;
  downloadUrl?: string;
}

export interface ExportResponse {
  success: boolean;
  message: string;
  messageVietnamese: string;
  data: {
    jobId: string;
    requestId: string;
    estimatedCompletionTime: string;
    estimatedCompletionTimeVietnamese: string;
    statusEndpoint: string;
    downloadEndpoint: string;
  };
  meta: any;
}

const useExport = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const reactQueryClient = useQueryClient();
  
  // Local state for active jobs (fallback when context not available)
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  
  // Try to use export context, fallback to local state if not available
  let exportContext;
  try {
    exportContext = useExportContext();
  } catch (error) {
    // Context not available, use fallback for now
    console.warn('ExportContext not available, using fallback:', error);
    exportContext = null;
  }

  // Export market data
  const exportMarketData = useMutation({
    mutationFn: async (params: {
      filters: ExportFilters;
      includePriceHistory?: boolean;
      includeSeasonalData?: boolean;
      includeWeatherImpact?: boolean;
      groupByRegion?: boolean;
      groupByCommodity?: boolean;
    }) => {
      const response = await apiRequest<ExportResponse>('/api/export/market-data', {
        method: 'POST',
        body: params,
        headers: {
          'X-Request-ID': `req-market-${Date.now()}`,
          'Authorization': `Bearer ${getSessionToken()}` // Use proper auth token
        }
      });
      return response;
    },
    onSuccess: (data) => {
      // Add job to shared context (will handle polling automatically)
      if (exportContext) {
        exportContext.addJob({
          jobId: data.data.jobId,
          status: 'pending',
          statusVietnamese: 'Đang chờ xử lý',
          type: 'market-data',
          typeVietnamese: 'Dữ liệu thị trường',
          progress: 0,
          totalRecords: 0,
          processedRecords: 0,
          startTime: new Date().toISOString(),
          downloadAvailable: false
        });
      } else {
        // Fallback to local state
        setActiveJobs(prev => new Set([...prev, data.data.jobId]));
      }
      // Invalidate export-related queries
      reactQueryClient.invalidateQueries({ queryKey: ['/api/export'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.messageVietnamese || error.message || 'Không thể bắt đầu xuất dữ liệu thị trường',
        variant: 'destructive',
      });
    }
  });

  // Export forecast results
  const exportForecastResults = useMutation({
    mutationFn: async (params: {
      filters: ExportFilters;
      includeMetrics?: boolean;
      includePredictionIntervals?: boolean;
      includeLlmAnalysis?: boolean;
      forecastHorizon?: number;
    }) => {
      const response = await apiRequest<ExportResponse>('/api/export/forecasts', {
        method: 'POST',
        body: params,
        headers: {
          'X-Request-ID': `req-forecast-${Date.now()}`,
          'Authorization': `Bearer ${getSessionToken()}` // Use proper auth token
        }
      });
      return response;
    },
    onSuccess: (data) => {
      // Add job to shared context
      if (exportContext) {
        exportContext.addJob({
          jobId: data.data.jobId,
          status: 'pending',
          statusVietnamese: 'Đang chờ xử lý',
          type: 'forecasts',
          typeVietnamese: 'Dự báo',
          progress: 0,
          totalRecords: 0,
          processedRecords: 0,
          startTime: new Date().toISOString(),
          downloadAvailable: false
        });
      } else {
        // Fallback to local state
        setActiveJobs(prev => new Set([...prev, data.data.jobId]));
      }
      // Invalidate export-related queries
      reactQueryClient.invalidateQueries({ queryKey: ['/api/export'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.messageVietnamese || error.message || 'Không thể bắt đầu xuất dự báo',
        variant: 'destructive',
      });
    }
  });

  // Export price history
  const exportPriceHistory = useMutation({
    mutationFn: async (params: {
      filters: ExportFilters;
      includeRawData?: boolean;
      includeVerifiedOnly?: boolean;
      aggregationPeriod?: 'daily' | 'weekly' | 'monthly';
      includeTrends?: boolean;
    }) => {
      const response = await apiRequest<ExportResponse>('/api/export/price-history', {
        method: 'POST',
        body: params,
        headers: {
          'X-Request-ID': `req-history-${Date.now()}`,
          'Authorization': `Bearer ${getSessionToken()}`
        }
      });
      return response;
    },
    onSuccess: (data) => {
      const jobId = data.data.jobId;
      setActiveJobs(prev => new Set([...prev, jobId]));
      
      toast({
        title: t('common.success'),
        description: data.messageVietnamese || data.message,
        variant: 'default',
      });

      startJobPolling(jobId);
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.messageVietnamese || error.message || 'Không thể bắt đầu xuất lịch sử giá',
        variant: 'destructive',
      });
    }
  });

  // Get export job status
  const useExportStatus = (jobId: string | null) => {
    return useQuery({
      queryKey: ['export-status', jobId],
      queryFn: async () => {
        if (!jobId) return null;
        
        const response = await apiRequest<{ data: ExportJob }>(`/api/export/status/${jobId}`);
        return response.data;
      },
      enabled: !!jobId && activeJobs.has(jobId),
      refetchInterval: (data) => {
        // Poll every 2 seconds while processing, stop when completed/failed
        if (!data || data.status === 'completed' || data.status === 'failed') {
          return false;
        }
        return 2000;
      },
      onSuccess: (data) => {
        if (data && (data.status === 'completed' || data.status === 'failed')) {
          // Remove from active jobs when completed/failed
          setActiveJobs(prev => {
            const updated = new Set(prev);
            updated.delete(jobId!);
            return updated;
          });

          if (data.status === 'completed') {
            toast({
              title: 'Xuất dữ liệu hoàn thành',
              description: `Tệp ${data.fileName} đã sẵn sàng để tải xuống`,
              variant: 'default',
            });
          } else if (data.status === 'failed') {
            toast({
              title: 'Xuất dữ liệu thất bại',
              description: data.error || 'Đã xảy ra lỗi trong quá trình xuất dữ liệu',
              variant: 'destructive',
            });
          }
        }
      }
    });
  };

  // Cancel export job
  const cancelExport = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest(`/api/export/${jobId}`, {
        method: 'DELETE'
      });
      return response;
    },
    onSuccess: (data, jobId) => {
      setActiveJobs(prev => {
        const updated = new Set(prev);
        updated.delete(jobId);
        return updated;
      });
      
      toast({
        title: 'Đã hủy xuất dữ liệu',
        description: 'Công việc xuất dữ liệu đã được hủy thành công',
        variant: 'default',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Không thể hủy',
        description: error.message || 'Không thể hủy công việc xuất dữ liệu',
        variant: 'destructive',
      });
    }
  });

  // Get all active export jobs
  const useActiveExports = () => {
    return useQuery({
      queryKey: ['export-jobs'],
      queryFn: async () => {
        const response = await apiRequest<{ data: { jobs: ExportJob[] } }>('/api/export/jobs');
        return response.data.jobs;
      },
      refetchInterval: 5000, // Refresh every 5 seconds
    });
  };

  // Helper function to start job polling
  const startJobPolling = useCallback((jobId: string) => {
    // Enable polling by adding to active jobs
    setActiveJobs(prev => new Set([...prev, jobId]));
    
    // Invalidate and refetch the status query
    reactQueryClient.invalidateQueries({ queryKey: ['export-status', jobId] });
  }, [reactQueryClient]);

  // Download export file
  const downloadExport = useCallback(async (jobId: string, fileName?: string) => {
    try {
      const response = await fetch(`/api/export/download/${jobId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/octet-stream'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.messageVietnamese || errorData.message || 'Không thể tải xuống tệp');
      }

      // Get filename from response headers or use provided filename
      const contentDisposition = response.headers.get('Content-Disposition');
      const defaultFileName = fileName || `export-${jobId}.csv`;
      
      let downloadFileName = defaultFileName;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          downloadFileName = filenameMatch[1];
        }
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Tải xuống thành công',
        description: `Đã tải xuống tệp ${downloadFileName}`,
        variant: 'default',
      });

    } catch (error: any) {
      toast({
        title: 'Lỗi tải xuống',
        description: error.message || 'Không thể tải xuống tệp xuất',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Format file size for display
  const formatFileSize = useCallback((bytes: number): string => {
    if (!bytes) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }, []);

  // Format time remaining
  const formatTimeRemaining = useCallback((seconds: number): string => {
    if (seconds < 60) {
      return `${Math.ceil(seconds)} giây`;
    } else if (seconds < 3600) {
      const minutes = Math.ceil(seconds / 60);
      return `${minutes} phút`;
    } else {
      const hours = Math.ceil(seconds / 3600);
      return `${hours} giờ`;
    }
  }, []);

  // Get export type display name in Vietnamese
  const getExportTypeVietnamese = useCallback((type: string): string => {
    const typeMap = {
      'market-data': 'Dữ liệu thị trường',
      'forecasts': 'Dự báo',
      'forecast-results': 'Kết quả dự báo',
      'price-history': 'Lịch sử giá'
    };
    return typeMap[type] || type;
  }, []);

  // Get status color for UI
  const getStatusColor = useCallback((status: string): string => {
    const colorMap = {
      'pending': 'text-yellow-600',
      'processing': 'text-blue-600',
      'completed': 'text-green-600',
      'failed': 'text-red-600'
    };
    return colorMap[status] || 'text-gray-600';
  }, []);

  // Check if any exports are active (use context if available, otherwise local state)
  const currentActiveJobs = exportContext ? exportContext.getActiveJobs() : Array.from(activeJobs);
  const hasActiveExports = currentActiveJobs.length > 0;
  const activeJobsCount = currentActiveJobs.length;

  return {
    // Export functions
    exportMarketData,
    exportForecastResults,
    exportPriceHistory,
    cancelExport,
    downloadExport,
    
    // Status queries
    useExportStatus,
    useActiveExports,
    
    // State
    activeJobs: currentActiveJobs.map(job => typeof job === 'string' ? job : job.jobId),
    activeJobsCount,
    hasActiveExports,
    
    // Helper functions
    formatFileSize,
    formatTimeRemaining,
    getExportTypeVietnamese,
    getStatusColor,
    startJobPolling,
    
    // Loading states
    isExportingMarketData: exportMarketData.isPending,
    isExportingForecasts: exportForecastResults.isPending,
    isExportingPriceHistory: exportPriceHistory.isPending,
    isCancelling: cancelExport.isPending
  };
};

export default useExport;