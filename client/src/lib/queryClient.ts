import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Network detection utilities for Vietnamese agricultural cooperatives
const isSlowNetwork = (): boolean => {
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const connection = (navigator as any).connection;
    if (connection) {
      // Detect 2G, slow-2g, or effective type indicating slow connection
      return connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g' ||
             connection.downlink < 1.5; // Less than 1.5 Mbps considered slow for agricultural data
    }
  }
  return false; // Default to false if API not available
};

// Enhanced error handling for agricultural data API requests
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Provide context-aware error messages for agricultural users
    let enhancedError = `${res.status}: ${text}`;
    if (res.status === 503) {
      enhancedError += " - Agricultural data service temporarily unavailable. Please try again.";
    } else if (res.status === 408 || res.status === 504) {
      enhancedError += " - Request timeout. This may be due to slow network conditions.";
    }
    
    throw new Error(enhancedError);
  }
}

// Retry configuration optimized for rural Vietnamese networks
const getRetryConfig = () => {
  const slow = isSlowNetwork();
  return {
    retry: (failureCount: number, error: any) => {
      // More retries for slow networks, less for fast networks
      const maxRetries = slow ? 4 : 2;
      
      // Don't retry 4xx errors (client errors) except 408/429
      if (error?.message?.includes('40') && !error?.message?.includes('408') && !error?.message?.includes('429')) {
        return false;
      }
      
      return failureCount < maxRetries;
    },
    retryDelay: (attemptIndex: number) => {
      // Exponential backoff with jitter for Vietnamese agricultural networks
      const baseDelay = isSlowNetwork() ? 2000 : 1000; // Start with 2s for slow networks, 1s for fast
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attemptIndex), 30000); // Cap at 30s
      const jitter = Math.random() * 1000; // Add up to 1s jitter to prevent thundering herd
      return exponentialDelay + jitter;
    }
  };
};

// Enhanced API request with timeout and retry logic for agricultural data
export async function apiRequest<T = any>(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
  }
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = isSlowNetwork() ? 15000 : 8000 } = options || {};
  
  // Create AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json", ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    await throwIfResNotOk(res);
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Enhanced error handling for agricultural users
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms. This may be due to slow network conditions in your area.`);
      }
      
      // Network connectivity issues common in rural areas
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Unable to connect to agricultural data service. Please check your internet connection and try again.');
      }
    }
    
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Optimized stale times for different types of agricultural data
const STALE_TIMES = {
  STATIC_DATA: 15 * 60 * 1000,      // 15 minutes for commodities, regions (rarely change)
  FORECAST_DATA: 5 * 60 * 1000,     // 5 minutes for forecasts (updated regularly)
  ALERT_DATA: 2 * 60 * 1000,        // 2 minutes for alerts (time-sensitive)
  ANALYTICS_DATA: 10 * 60 * 1000,   // 10 minutes for analytics aggregates
  USER_DATA: 30 * 60 * 1000,        // 30 minutes for user profiles
} as const;

// Cache times optimized for rural internet connections
const GC_TIMES = {
  STATIC_DATA: 60 * 60 * 1000,      // 1 hour - keep static data longer
  DYNAMIC_DATA: 30 * 60 * 1000,     // 30 minutes - shorter for dynamic data
  TEMPORARY_DATA: 10 * 60 * 1000,   // 10 minutes - shortest for temporary data
} as const;

// Helper function to determine stale time based on query key
const getStaleTime = (queryKey: unknown[]): number => {
  const key = queryKey.join('/');
  
  if (key.includes('/api/commodities') || key.includes('/api/regions')) {
    return STALE_TIMES.STATIC_DATA;
  }
  if (key.includes('/api/forecasts')) {
    return STALE_TIMES.FORECAST_DATA;
  }
  if (key.includes('/api/alerts')) {
    return STALE_TIMES.ALERT_DATA;
  }
  if (key.includes('/api/analytics')) {
    return STALE_TIMES.ANALYTICS_DATA;
  }
  if (key.includes('/api/users') || key.includes('/api/auth')) {
    return STALE_TIMES.USER_DATA;
  }
  
  // Default for unknown endpoints
  return STALE_TIMES.FORECAST_DATA;
};

// Helper function to determine cache time based on query key  
const getGcTime = (queryKey: unknown[]): number => {
  const key = queryKey.join('/');
  
  if (key.includes('/api/commodities') || key.includes('/api/regions')) {
    return GC_TIMES.STATIC_DATA;
  }
  if (key.includes('/api/export/jobs')) {
    return GC_TIMES.TEMPORARY_DATA;
  }
  
  return GC_TIMES.DYNAMIC_DATA;
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      
      // Network optimization for Vietnamese agricultural cooperatives
      staleTime: ({ queryKey }) => getStaleTime(queryKey),
      gcTime: ({ queryKey }) => getGcTime(queryKey),
      
      // Retry configuration for unreliable rural networks
      ...getRetryConfig(),
      
      // Reduce unnecessary refetches for slow networks
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always', // Always refetch when reconnecting after poor connectivity
      refetchInterval: false,
      
      // Background updates optimized for slow connections
      refetchIntervalInBackground: false,
      
      // Placeholders and loading states optimization
      placeholderData: (previousData) => previousData, // Keep previous data during refetch for better UX
      
      // Structure data for Vietnamese agricultural needs
      select: undefined, // Will be overridden per query as needed
      
      // Extended timeout for slow networks
      networkMode: 'online', // Only fetch when online
    },
    mutations: {
      // Retry mutations for network issues but not client errors
      ...getRetryConfig(),
      
      // Network mode for mutations
      networkMode: 'online',
    },
  },
});

// Enhanced query utilities for agricultural data
export const createOptimizedQuery = ({
  queryKey,
  keepPreviousData = false,
  select,
  enabled = true,
}: {
  queryKey: unknown[];
  keepPreviousData?: boolean;
  select?: (data: any) => any;
  enabled?: boolean;
}) => ({
  queryKey,
  enabled,
  // Use placeholderData instead of deprecated keepPreviousData
  placeholderData: keepPreviousData ? (previousData: any) => previousData : undefined,
  select,
  staleTime: getStaleTime(queryKey),
  gcTime: getGcTime(queryKey),
});

// Specialized query configurations for different agricultural data types
export const queryConfigs = {
  // Static agricultural reference data (commodities, regions)
  staticData: (queryKey: unknown[]) => createOptimizedQuery({
    queryKey,
    keepPreviousData: true,
    select: (data) => data, // No transformation needed for static data
  }),
  
  // Dynamic forecast data with pagination support
  forecastData: (queryKey: unknown[], select?: (data: any) => any) => createOptimizedQuery({
    queryKey,
    keepPreviousData: true, // Smooth pagination experience
    select,
  }),
  
  // Time-sensitive alert data
  alertData: (queryKey: unknown[]) => createOptimizedQuery({
    queryKey,
    keepPreviousData: false, // Always show fresh alerts
    select: (data) => data?.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ), // Sort alerts by recency
  }),
  
  // Analytics data with heavy aggregation
  analyticsData: (queryKey: unknown[], select?: (data: any) => any) => createOptimizedQuery({
    queryKey,
    keepPreviousData: true,
    select: select || ((data) => {
      // Default select function to reduce payload size
      if (Array.isArray(data)) {
        return data.map(item => ({
          id: item.id,
          name: item.name,
          value: item.value,
          timestamp: item.timestamp,
        }));
      }
      return data;
    }),
  }),
};
