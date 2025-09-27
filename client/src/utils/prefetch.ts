/**
 * Prefetch Utility for Next-View Chunks
 * 
 * Optimized for Vietnamese agricultural platform to preload route chunks
 * on hover/idle for faster navigation, especially important for slower
 * rural internet connections.
 * 
 * Features:
 * - Hover-based prefetching for navigation links
 * - Idle-time prefetching for likely next routes
 * - Network-aware prefetching (respects slow connections)
 * - Cache management to prevent excessive preloading
 */

// Network condition detection for Vietnamese agricultural cooperatives
const isSlowOrExpensiveConnection = (): boolean => {
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const connection = (navigator as any).connection;
    if (connection) {
      // Consider slow if: 2G network, save-data enabled, or very slow connection
      return (
        connection.effectiveType === '2g' || 
        connection.effectiveType === 'slow-2g' ||
        connection.saveData === true ||
        (connection.downlink && connection.downlink < 1.0)
      );
    }
  }
  return false;
};

// Track prefetched components to avoid duplicate requests
const prefetchCache = new Set<string>();

// Track active prefetch requests to prevent duplicates
const activePrefetches = new Map<string, Promise<any>>();

/**
 * Prefetch a route chunk for faster navigation
 * Optimized for agricultural cooperatives with slower internet
 */
export const prefetchRoute = async (routeLoader: () => Promise<any>, routeKey: string): Promise<void> => {
  // Skip prefetching on slow or expensive connections
  if (isSlowOrExpensiveConnection()) {
    return;
  }

  // Skip if already prefetched
  if (prefetchCache.has(routeKey)) {
    return;
  }

  // Skip if already prefetching
  if (activePrefetches.has(routeKey)) {
    return;
  }

  try {
    // Track the prefetch request
    const prefetchPromise = routeLoader();
    activePrefetches.set(routeKey, prefetchPromise);

    await prefetchPromise;
    
    // Mark as prefetched
    prefetchCache.add(routeKey);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Prefetch] Successfully prefetched route: ${routeKey}`);
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[Prefetch] Failed to prefetch route: ${routeKey}`, error);
    }
  } finally {
    // Remove from active prefetches
    activePrefetches.delete(routeKey);
  }
};

/**
 * Create hover handlers for prefetching route chunks
 * Use with Link components to preload on hover
 */
export const createPrefetchHandlers = (
  routeLoader: () => Promise<any>, 
  routeKey: string
) => ({
  onMouseEnter: () => prefetchRoute(routeLoader, routeKey),
  onFocus: () => prefetchRoute(routeLoader, routeKey),
});

/**
 * Prefetch multiple routes during idle time
 * Optimized for Vietnamese agricultural platform usage patterns
 */
export const prefetchIdleRoutes = (routes: Array<{ loader: () => Promise<any>; key: string; priority?: number }>) => {
  // Only prefetch during idle if network conditions are good
  if (isSlowOrExpensiveConnection()) {
    return;
  }

  // Use requestIdleCallback if available, otherwise setTimeout
  const scheduleIdle = (callback: () => void) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 5000 });
    } else {
      setTimeout(callback, 100);
    }
  };

  // Sort routes by priority (higher priority first)
  const sortedRoutes = routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  sortedRoutes.forEach(({ loader, key }, index) => {
    // Stagger prefetch requests to avoid overwhelming slower connections
    scheduleIdle(() => {
      setTimeout(() => prefetchRoute(loader, key), index * 500);
    });
  });
};

/**
 * Prefetch utility specifically for Vietnamese agricultural platform routes
 * Pre-configured with likely navigation patterns for agricultural users
 */
export const prefetchAgriculturalRoutes = {
  // High priority routes (likely to be accessed next)
  fromMarketExplorer: () => prefetchIdleRoutes([
    { loader: () => import('../pages/alerts'), key: 'alerts', priority: 3 },
    { loader: () => import('../pages/watchlist'), key: 'watchlist', priority: 2 },
    { loader: () => import('../pages/daily-brief'), key: 'daily-brief', priority: 1 },
  ]),

  // Admin workflow prefetching
  fromAdminAnalytics: () => prefetchIdleRoutes([
    { loader: () => import('../pages/admin/data-sources'), key: 'admin-data-sources', priority: 3 },
    { loader: () => import('../pages/admin/review-queue'), key: 'admin-review-queue', priority: 2 },
  ]),

  // General navigation prefetching
  fromHomepage: () => prefetchIdleRoutes([
    { loader: () => import('../pages/market-explorer'), key: 'market-explorer', priority: 3 },
    { loader: () => import('../pages/alerts'), key: 'alerts', priority: 2 },
    { loader: () => import('../pages/daily-brief'), key: 'daily-brief', priority: 1 },
  ]),
};

/**
 * Clear prefetch cache (useful for testing or memory management)
 */
export const clearPrefetchCache = () => {
  prefetchCache.clear();
  activePrefetches.clear();
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[Prefetch] Cache cleared');
  }
};

/**
 * Get prefetch statistics (useful for monitoring)
 */
export const getPrefetchStats = () => ({
  cachedRoutes: prefetchCache.size,
  activePrefetches: activePrefetches.size,
  isSlowConnection: isSlowOrExpensiveConnection(),
});