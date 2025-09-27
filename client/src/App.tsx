import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ExportContextProvider } from "@/contexts/export-context";
import "./lib/i18n"; // Initialize i18n
import { useTranslation } from "react-i18next";
import { useEffect, lazy, useRef } from "react";
import AppHeader from "@/components/layout/app-header";
import Sidebar from "@/components/layout/sidebar";
import { Suspense } from "react";
import { prefetchAgriculturalRoutes } from "@/utils/prefetch";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
// Lazy-loaded page components for code splitting (Performance optimization)
const MarketExplorer = lazy(() => import("@/pages/market-explorer"));
const Reliability = lazy(() => import("@/pages/reliability"));
const Alerts = lazy(() => import("@/pages/alerts"));
const DailyBrief = lazy(() => import("@/pages/daily-brief"));
const Watchlist = lazy(() => import("@/pages/watchlist"));
const ReviewQueue = lazy(() => import("@/pages/admin/review-queue"));
const DataSources = lazy(() => import("@/pages/admin/data-sources"));
const Analytics = lazy(() => import("@/pages/admin/analytics"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const NotFound = lazy(() => import("@/pages/not-found"));

function Router() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const mainContentRef = useRef<HTMLElement>(null);

  // Focus management for route changes (WCAG 2.4.3)
  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.focus();
      // Set page title based on route
      const pageTitles: Record<string, string> = {
        '/': t('marketExplorer.title', 'Market Explorer'),
        '/market-explorer': t('marketExplorer.title', 'Market Explorer'),
        '/watchlist': t('watchlist.title', 'Watchlist'),
        '/reliability': t('nav.reliability', 'Reliability'),
        '/alerts': t('alerts.title', 'Alerts & Notifications'),
        '/daily-brief': t('dailyBrief.title', 'Daily Market Brief'),
        '/admin/review-queue': t('reviewQueue.title', 'Forecast Review Queue'),
        '/admin/data-sources': t('dataSources.title', 'Data Sources'),
        '/admin/analytics': t('analytics.title', 'Analytics Dashboard')
      };
      const pageTitle = pageTitles[location] || 'AgriIntel';
      document.title = `${pageTitle} - AgriIntel`;
    }
  }, [location, t]);

  // Intelligent prefetching based on current route for Vietnamese agricultural users
  useEffect(() => {
    const currentPath = location;
    
    // Prefetch likely next routes based on user navigation patterns
    if (currentPath === '/' || currentPath === '/market-explorer') {
      prefetchAgriculturalRoutes.fromMarketExplorer();
    } else if (currentPath === '/admin/analytics') {
      prefetchAgriculturalRoutes.fromAdminAnalytics();
    } else if (currentPath === '/daily-brief') {
      // From daily brief, users often check alerts or market explorer
      prefetchAgriculturalRoutes.fromHomepage();
    }
  }, [location]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main 
        id="main"
        ref={mainContentRef}
        className="flex-1 overflow-auto"
        tabIndex={-1}
        aria-label={t('accessibility.mainContent', 'Main content')}
      >
        <Switch>
          <ProtectedRoute path="/" component={MarketExplorer} />
          <ProtectedRoute path="/market-explorer" component={MarketExplorer} />
          <ProtectedRoute path="/watchlist" component={Watchlist} />
          <ProtectedRoute path="/reliability" component={Reliability} />
          <ProtectedRoute path="/alerts" component={Alerts} />
          <ProtectedRoute path="/daily-brief" component={DailyBrief} />
          <ProtectedRoute path="/admin/review-queue" component={ReviewQueue} />
          <ProtectedRoute path="/admin/data-sources" component={DataSources} />
          <ProtectedRoute path="/admin/analytics" component={Analytics} />
          <Route path="/auth" component={AuthPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function LoadingFallback() {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div 
          className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
          role="status"
          aria-live="polite"
          aria-label={t('accessibility.loading', 'Loading, please wait')}
        ></div>
        <p className="text-muted-foreground">{t('header.loading', 'Loading AgriIntel...')}</p>
      </div>
    </div>
  );
}

function SkipLink() {
  const { t } = useTranslation();
  
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[999] bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      data-testid="skip-link"
    >
      {t('accessibility.skipToMain', 'Skip to main content')}
    </a>
  );
}

function App() {
  const { i18n, t } = useTranslation();
  
  useEffect(() => {
    // Set document language on mount and language change (WCAG 3.1.1)
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <ExportContextProvider>
            <SkipLink />
            <Suspense fallback={<LoadingFallback />}>
              <div className="min-h-screen bg-background">
                <header role="banner" aria-label={t('accessibility.siteHeader', 'Site header')}>
                  <AppHeader />
                </header>
                <Router />
              </div>
            </Suspense>
            <Toaster />
          </ExportContextProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
