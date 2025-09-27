/**
 * Lazy Loading Hook with IntersectionObserver
 * 
 * Optimized for Vietnamese agricultural platform to defer loading
 * of heavy components (charts, modals) until they're needed.
 * 
 * Features:
 * - IntersectionObserver for viewport-based loading
 * - Click/interaction-based loading
 * - Configurable loading states
 * - Memory efficient for rural internet connections
 */

import { useState, useRef, useEffect, useCallback, ReactNode, ComponentType } from 'react';

export interface UseLazyLoadOptions {
  threshold?: number; // IntersectionObserver threshold (0-1)
  rootMargin?: string; // Margin around root for early loading
  triggerOnClick?: boolean; // Also load on click interaction
  fallbackTimeout?: number; // Max time to wait before loading anyway
  debug?: boolean; // Development debugging
}

export interface LazyLoadState {
  shouldLoad: boolean;
  isVisible: boolean;
  hasLoaded: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for lazy loading heavy components based on viewport intersection
 * Optimized for agricultural cooperatives with slower internet connections
 */
export function useLazyLoad(options: UseLazyLoadOptions = {}): {
  ref: React.RefObject<HTMLDivElement>;
  shouldLoad: boolean;
  isVisible: boolean;
  hasLoaded: boolean;
  isLoading: boolean;
  error: Error | null;
  triggerLoad: () => void;
} {
  const {
    threshold = 0.1, // Load when 10% visible
    rootMargin = '50px', // Start loading 50px before entering viewport
    triggerOnClick = true,
    fallbackTimeout = 10000, // 10 seconds fallback for slow networks
    debug = false
  } = options;

  const [state, setState] = useState<LazyLoadState>({
    shouldLoad: false,
    isVisible: false,
    hasLoaded: false,
    isLoading: false,
    error: null
  });

  const ref = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const triggerLoad = useCallback(() => {
    if (!state.shouldLoad && !state.hasLoaded) {
      setState(prev => ({ 
        ...prev, 
        shouldLoad: true, 
        isLoading: true 
      }));
      
      if (debug) {
        console.log('[useLazyLoad] Manually triggered loading');
      }
    }
  }, [state.shouldLoad, state.hasLoaded, debug]);

  // IntersectionObserver for viewport-based loading
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') {
      // Fallback: load immediately if IntersectionObserver not supported
      triggerLoad();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setState(prev => ({
            ...prev,
            isVisible: entry.isIntersecting
          }));

          if (entry.isIntersecting && !state.shouldLoad && !state.hasLoaded) {
            setState(prev => ({ 
              ...prev, 
              shouldLoad: true, 
              isLoading: true 
            }));
            
            if (debug) {
              console.log('[useLazyLoad] Triggered loading via intersection');
            }
          }
        });
      },
      {
        threshold,
        rootMargin
      }
    );

    observer.observe(ref.current);

    // Cleanup
    return () => {
      observer.disconnect();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [threshold, rootMargin, debug, state.shouldLoad, state.hasLoaded]);

  // Fallback timeout for very slow networks
  useEffect(() => {
    if (fallbackTimeout > 0 && !state.shouldLoad && !state.hasLoaded) {
      timeoutRef.current = setTimeout(() => {
        if (!state.shouldLoad && !state.hasLoaded) {
          setState(prev => ({ 
            ...prev, 
            shouldLoad: true, 
            isLoading: true 
          }));
          
          if (debug) {
            console.log('[useLazyLoad] Triggered loading via fallback timeout');
          }
        }
      }, fallbackTimeout);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [fallbackTimeout, debug, state.shouldLoad, state.hasLoaded]);

  // Handle successful loading
  useEffect(() => {
    if (state.shouldLoad && state.isLoading && !state.hasLoaded) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        hasLoaded: true
      }));

      if (debug) {
        console.log('[useLazyLoad] Component loaded successfully');
      }
    }
  }, [state.shouldLoad, state.isLoading, state.hasLoaded, debug]);

  return {
    ref,
    shouldLoad: state.shouldLoad,
    isVisible: state.isVisible,
    hasLoaded: state.hasLoaded,
    isLoading: state.isLoading,
    error: state.error,
    triggerLoad
  };
}

/**
 * Configuration for lazy loading components
 * Returns component loading state and trigger functions
 */
export interface LazyComponentState {
  ref: React.RefObject<HTMLDivElement>;
  shouldLoad: boolean;
  isVisible: boolean;
  hasLoaded: boolean;
  isLoading: boolean;
  triggerLoad: () => void;
}

/**
 * Hook for lazy loading modals and overlays
 * Only loads the modal content when it's actually shown
 */
export function useModalLazyLoad(isOpen: boolean): {
  shouldLoadModal: boolean;
  hasLoadedModal: boolean;
} {
  const [shouldLoadModal, setShouldLoadModal] = useState(false);
  const [hasLoadedModal, setHasLoadedModal] = useState(false);

  useEffect(() => {
    if (isOpen && !shouldLoadModal) {
      setShouldLoadModal(true);
    }
  }, [isOpen, shouldLoadModal]);

  useEffect(() => {
    if (shouldLoadModal && !hasLoadedModal) {
      setHasLoadedModal(true);
    }
  }, [shouldLoadModal, hasLoadedModal]);

  return { shouldLoadModal, hasLoadedModal };
}

/**
 * Utility for pre-loading components on hover/idle
 * Optimized for agricultural cooperatives' user patterns
 */
export function usePrefetch(): {
  prefetchComponent: (loader: () => Promise<any>) => void;
  prefetchOnHover: (loader: () => Promise<any>) => {
    onMouseEnter: () => void;
    onFocus: () => void;
  };
} {
  const prefetchedComponents = useRef(new Set<string>());

  const prefetchComponent = useCallback(async (loader: () => Promise<any>) => {
    const componentKey = loader.toString();
    
    if (prefetchedComponents.current.has(componentKey)) {
      return;
    }

    try {
      await loader();
      prefetchedComponents.current.add(componentKey);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[usePrefetch] Component prefetched successfully');
      }
    } catch (error) {
      console.warn('[usePrefetch] Failed to prefetch component:', error);
    }
  }, []);

  const prefetchOnHover = useCallback((loader: () => Promise<any>) => ({
    onMouseEnter: () => prefetchComponent(loader),
    onFocus: () => prefetchComponent(loader)
  }), [prefetchComponent]);

  return { prefetchComponent, prefetchOnHover };
}