/**
 * Export Context Provider for shared export state management
 * Fixes the issue where multiple useExport() instances don't share state
 */

import { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';

// Types
interface ExportJob {
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

interface ExportState {
  activeJobs: Map<string, ExportJob>;
  completedJobs: Map<string, ExportJob>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number;
}

// Action types
type ExportAction = 
  | { type: 'ADD_JOB'; payload: ExportJob }
  | { type: 'UPDATE_JOB'; payload: { jobId: string; updates: Partial<ExportJob> } }
  | { type: 'REMOVE_JOB'; payload: string }
  | { type: 'COMPLETE_JOB'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'SYNC_JOBS'; payload: ExportJob[] };

// Context interface
interface ExportContextType {
  state: ExportState;
  
  // Job management
  addJob: (job: ExportJob) => void;
  updateJob: (jobId: string, updates: Partial<ExportJob>) => void;
  removeJob: (jobId: string) => void;
  completeJob: (jobId: string) => void;
  
  // Status
  getJob: (jobId: string) => ExportJob | undefined;
  getActiveJobs: () => ExportJob[];
  getCompletedJobs: () => ExportJob[];
  hasActiveJobs: boolean;
  activeJobsCount: number;
  totalJobsCount: number;
  
  // Actions
  startPolling: (jobId: string) => void;
  stopPolling: (jobId: string) => void;
  clearCompleted: () => void;
  refreshAllJobs: () => Promise<void>;
  
  // Error handling
  setError: (error: string | null) => void;
  clearError: () => void;
}

// Initial state
const initialState: ExportState = {
  activeJobs: new Map(),
  completedJobs: new Map(),
  isLoading: false,
  error: null,
  lastUpdated: Date.now()
};

// Reducer
const exportReducer = (state: ExportState, action: ExportAction): ExportState => {
  switch (action.type) {
    case 'ADD_JOB':
      return {
        ...state,
        activeJobs: new Map(state.activeJobs).set(action.payload.jobId, action.payload),
        lastUpdated: Date.now()
      };
      
    case 'UPDATE_JOB': {
      const { jobId, updates } = action.payload;
      const job = state.activeJobs.get(jobId);
      if (!job) return state;
      
      const updatedJob = { ...job, ...updates };
      return {
        ...state,
        activeJobs: new Map(state.activeJobs).set(jobId, updatedJob),
        lastUpdated: Date.now()
      };
    }
    
    case 'REMOVE_JOB': {
      const newActiveJobs = new Map(state.activeJobs);
      newActiveJobs.delete(action.payload);
      return {
        ...state,
        activeJobs: newActiveJobs,
        lastUpdated: Date.now()
      };
    }
    
    case 'COMPLETE_JOB': {
      const job = state.activeJobs.get(action.payload);
      if (!job) return state;
      
      const newActiveJobs = new Map(state.activeJobs);
      newActiveJobs.delete(action.payload);
      
      const newCompletedJobs = new Map(state.completedJobs);
      newCompletedJobs.set(action.payload, job);
      
      return {
        ...state,
        activeJobs: newActiveJobs,
        completedJobs: newCompletedJobs,
        lastUpdated: Date.now()
      };
    }
    
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload
      };
      
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload
      };
      
    case 'CLEAR_COMPLETED':
      return {
        ...state,
        completedJobs: new Map(),
        lastUpdated: Date.now()
      };
      
    case 'SYNC_JOBS': {
      const newActiveJobs = new Map<string, ExportJob>();
      const newCompletedJobs = new Map(state.completedJobs);
      
      action.payload.forEach(job => {
        if (job.status === 'completed' || job.status === 'failed') {
          newCompletedJobs.set(job.jobId, job);
        } else {
          newActiveJobs.set(job.jobId, job);
        }
      });
      
      return {
        ...state,
        activeJobs: newActiveJobs,
        completedJobs: newCompletedJobs,
        lastUpdated: Date.now()
      };
    }
    
    default:
      return state;
  }
};

// Create context
const ExportContext = createContext<ExportContextType | undefined>(undefined);

// Polling management
const pollingIntervals = new Map<string, NodeJS.Timeout>();

// Provider component
export const ExportContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(exportReducer, initialState);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Job management functions
  const addJob = useCallback((job: ExportJob) => {
    dispatch({ type: 'ADD_JOB', payload: job });
    
    // Start polling for this job
    startPolling(job.jobId);
    
    toast({
      title: 'Bắt đầu xuất dữ liệu',
      description: `Đã bắt đầu xuất ${job.typeVietnamese}`,
      variant: 'default',
    });
  }, []);
  
  const updateJob = useCallback((jobId: string, updates: Partial<ExportJob>) => {
    dispatch({ type: 'UPDATE_JOB', payload: { jobId, updates } });
    
    // Check if job is completed or failed
    if (updates.status === 'completed' || updates.status === 'failed') {
      stopPolling(jobId);
      completeJob(jobId);
      
      if (updates.status === 'completed') {
        toast({
          title: 'Xuất dữ liệu hoàn thành',
          description: `Tệp ${updates.fileName || 'export'} đã sẵn sàng để tải xuống`,
          variant: 'default',
        });
      } else if (updates.status === 'failed') {
        toast({
          title: 'Xuất dữ liệu thất bại',
          description: updates.error || 'Đã xảy ra lỗi trong quá trình xuất dữ liệu',
          variant: 'destructive',
        });
      }
    }
  }, []);
  
  const removeJob = useCallback((jobId: string) => {
    stopPolling(jobId);
    dispatch({ type: 'REMOVE_JOB', payload: jobId });
  }, []);
  
  const completeJob = useCallback((jobId: string) => {
    stopPolling(jobId);
    dispatch({ type: 'COMPLETE_JOB', payload: jobId });
  }, []);
  
  // Polling functions
  const startPolling = useCallback((jobId: string) => {
    // Clear existing polling for this job
    if (pollingIntervals.has(jobId)) {
      clearInterval(pollingIntervals.get(jobId)!);
    }
    
    const pollJobStatus = async () => {
      try {
        const response = await apiRequest<{ data: ExportJob }>(`/api/export/status/${jobId}`);
        const job = response.data;
        
        updateJob(jobId, job);
        
        // Stop polling if job is completed or failed
        if (job.status === 'completed' || job.status === 'failed') {
          stopPolling(jobId);
        }
        
      } catch (error: any) {
        console.error('Failed to poll job status:', error);
        
        // If job not found, remove it
        if (error.status === 404) {
          removeJob(jobId);
        } else {
          updateJob(jobId, {
            status: 'failed',
            error: error.message || 'Failed to get job status'
          });
        }
      }
    };
    
    // Poll every 2 seconds
    const interval = setInterval(pollJobStatus, 2000);
    pollingIntervals.set(jobId, interval);
    
    // Initial poll
    pollJobStatus();
  }, [updateJob, removeJob]);
  
  const stopPolling = useCallback((jobId: string) => {
    if (pollingIntervals.has(jobId)) {
      clearInterval(pollingIntervals.get(jobId)!);
      pollingIntervals.delete(jobId);
    }
  }, []);
  
  // Utility functions
  const getJob = useCallback((jobId: string): ExportJob | undefined => {
    return state.activeJobs.get(jobId) || state.completedJobs.get(jobId);
  }, [state.activeJobs, state.completedJobs]);
  
  const getActiveJobs = useCallback((): ExportJob[] => {
    return Array.from(state.activeJobs.values());
  }, [state.activeJobs]);
  
  const getCompletedJobs = useCallback((): ExportJob[] => {
    return Array.from(state.completedJobs.values());
  }, [state.completedJobs]);
  
  const clearCompleted = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);
  
  const refreshAllJobs = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const response = await apiRequest<{ data: { jobs: ExportJob[] } }>('/api/export/jobs');
      const jobs = response.data.jobs;
      
      dispatch({ type: 'SYNC_JOBS', payload: jobs });
      
      // Start polling for active jobs
      jobs.forEach(job => {
        if (job.status === 'pending' || job.status === 'processing') {
          startPolling(job.jobId);
        }
      });
      
    } catch (error: any) {
      console.error('Failed to refresh jobs:', error);
      dispatch({ type: 'SET_ERROR', payload: error.message || 'Failed to refresh jobs' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [startPolling]);
  
  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);
  
  const clearError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: null });
  }, []);
  
  // Computed values
  const hasActiveJobs = state.activeJobs.size > 0;
  const activeJobsCount = state.activeJobs.size;
  const totalJobsCount = state.activeJobs.size + state.completedJobs.size;
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all polling intervals
      pollingIntervals.forEach(interval => clearInterval(interval));
      pollingIntervals.clear();
    };
  }, []);
  
  // Auto-refresh jobs on mount
  useEffect(() => {
    refreshAllJobs();
  }, []);
  
  const contextValue: ExportContextType = {
    state,
    
    // Job management
    addJob,
    updateJob,
    removeJob,
    completeJob,
    
    // Status
    getJob,
    getActiveJobs,
    getCompletedJobs,
    hasActiveJobs,
    activeJobsCount,
    totalJobsCount,
    
    // Actions
    startPolling,
    stopPolling,
    clearCompleted,
    refreshAllJobs,
    
    // Error handling
    setError,
    clearError
  };
  
  return (
    <ExportContext.Provider value={contextValue}>
      {children}
    </ExportContext.Provider>
  );
};

// Hook to use export context
export const useExportContext = (): ExportContextType => {
  const context = useContext(ExportContext);
  if (!context) {
    throw new Error('useExportContext must be used within an ExportContextProvider');
  }
  return context;
};

export default ExportContext;