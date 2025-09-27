import { useState, lazy, Suspense } from "react";
import { useForecasts, useCommodities, useRegions, useGenerateForecast } from "@/hooks/use-forecasts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLazyLoad, useModalLazyLoad } from "@/hooks/useLazyLoad";
import KPICards from "@/components/market/kpi-cards";
import EvidencePanel from "@/components/market/evidence-panel";
import ActionPanel from "@/components/market/action-panel";
import ForecastTable from "@/components/market/forecast-table";
import ReliabilityWidget from "@/components/shared/reliability-widget";
import ExportButton from "@/components/export/export-button";
import useExport from "@/hooks/use-export";

// Lazy-loaded heavy components for better performance
const ForecastChart = lazy(() => import("@/components/market/forecast-chart"));
const ExportConfigModal = lazy(() => import("@/components/export/export-config-modal"));
const ExportProgressModal = lazy(() => import("@/components/export/export-progress-modal"));

export default function MarketExplorer() {
  // Default to Vietnamese rice and Vietnam region 
  const [selectedCommodity, setSelectedCommodity] = useState<string>("d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a"); // Rice (Gạo trắng 5% tấm)
  const [selectedRegion, setSelectedRegion] = useState<string>("9a58ba92-aed1-4f7e-9cb3-9cdec573c09a"); // Vietnam
  const [showExportConfig, setShowExportConfig] = useState(false);
  const [showExportProgress, setShowExportProgress] = useState(false);
  const [currentExportJobId, setCurrentExportJobId] = useState<string | null>(null);
  const { toast } = useToast();

  // Lazy loading for heavy components
  const forecastChartLazy = useLazyLoad({
    threshold: 0.1,
    rootMargin: '100px', // Load chart 100px before it comes into view
    triggerOnClick: true,
    debug: process.env.NODE_ENV === 'development'
  });

  // Modal lazy loading - only load when actually opened
  const configModalLazy = useModalLazyLoad(showExportConfig);
  const progressModalLazy = useModalLazyLoad(showExportProgress);

  const { data: commodities = [], isLoading: commoditiesLoading } = useCommodities();
  const { data: regions = [], isLoading: regionsLoading } = useRegions();
  const { data: forecast, isLoading: forecastsLoading } = useForecasts(
    selectedCommodity, 
    selectedRegion
  );
  const generateForecast = useGenerateForecast();
  const {
    exportMarketData,
    exportForecastResults,
    exportPriceHistory
  } = useExport();

  const activeForecast = forecast ?? undefined; // Convert null to undefined for component compatibility
  const selectedCommodityData = commodities.find(c => c.id === selectedCommodity);
  const selectedRegionData = regions.find(r => r.id === selectedRegion);

  const handleGenerateForecast = async () => {
    if (!selectedCommodity || !selectedRegion) {
      toast({
        title: "Selection Required",
        description: "Please select both a commodity and region",
        variant: "destructive",
      });
      return;
    }

    try {
      await generateForecast.mutateAsync({
        commodityId: selectedCommodity,
        regionId: selectedRegion,
        horizon: 30,
      });
      
      toast({
        title: "Forecast Generated",
        description: "New 30-day forecast has been generated successfully",
      });
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Failed to generate forecast. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Export event handlers
  const handleQuickExport = async (format: 'csv' | 'xlsx', type: 'market-data' | 'forecasts' | 'price-history') => {
    const filters = {
      commodityIds: selectedCommodity ? [selectedCommodity] : undefined,
      regionIds: selectedRegion ? [selectedRegion] : undefined,
      format,
      chunkSize: 5000,
      includeVerifications: true,
      includeRecommendations: true
    };

    try {
      let response;
      switch (type) {
        case 'market-data':
          response = await exportMarketData.mutateAsync({
            filters,
            includePriceHistory: true,
            includeSeasonalData: true,
            includeWeatherImpact: false,
            groupByRegion: !!selectedRegion,
            groupByCommodity: !!selectedCommodity
          });
          break;
        case 'forecasts':
          response = await exportForecastResults.mutateAsync({
            filters,
            includeMetrics: true,
            includePredictionIntervals: true,
            includeLlmAnalysis: true,
            forecastHorizon: 30
          });
          break;
        case 'price-history':
          response = await exportPriceHistory.mutateAsync({
            filters,
            includeRawData: false,
            includeVerifiedOnly: true,
            aggregationPeriod: 'daily',
            includeTrends: true
          });
          break;
      }

      if (response?.data?.jobId) {
        setCurrentExportJobId(response.data.jobId);
        setShowExportProgress(true);
      }
    } catch (error: any) {
      toast({
        title: "Lỗi xuất dữ liệu",
        description: error.messageVietnamese || error.message || "Không thể bắt đầu xuất dữ liệu",
        variant: "destructive",
      });
    }
  };

  const handleConfiguredExport = async (config: any) => {
    try {
      let response;
      switch (config.exportType) {
        case 'market-data':
          response = await exportMarketData.mutateAsync({
            filters: {
              commodityIds: config.commodityIds,
              regionIds: config.regionIds,
              startDate: config.startDate?.toISOString(),
              endDate: config.endDate?.toISOString(),
              minPrice: config.minPrice,
              maxPrice: config.maxPrice,
              format: config.format,
              chunkSize: config.chunkSize,
              includeVerifications: config.includeVerifications,
              includeRecommendations: config.includeRecommendations
            },
            includePriceHistory: config.includePriceHistory,
            includeSeasonalData: config.includeSeasonalData,
            includeWeatherImpact: config.includeWeatherImpact,
            groupByRegion: config.groupByRegion,
            groupByCommodity: config.groupByCommodity
          });
          break;
        case 'forecasts':
          response = await exportForecastResults.mutateAsync({
            filters: {
              commodityIds: config.commodityIds,
              regionIds: config.regionIds,
              startDate: config.startDate?.toISOString(),
              endDate: config.endDate?.toISOString(),
              minConfidence: config.minConfidence,
              qualityThreshold: config.qualityThreshold,
              format: config.format,
              chunkSize: config.chunkSize,
              includeVerifications: config.includeVerifications,
              includeRecommendations: config.includeRecommendations
            },
            includeMetrics: config.includeMetrics,
            includePredictionIntervals: config.includePredictionIntervals,
            includeLlmAnalysis: config.includeLlmAnalysis,
            forecastHorizon: config.forecastHorizon
          });
          break;
        case 'price-history':
          response = await exportPriceHistory.mutateAsync({
            filters: {
              commodityIds: config.commodityIds,
              regionIds: config.regionIds,
              startDate: config.startDate?.toISOString(),
              endDate: config.endDate?.toISOString(),
              minPrice: config.minPrice,
              maxPrice: config.maxPrice,
              format: config.format,
              chunkSize: config.chunkSize
            },
            includeRawData: config.includeRawData,
            includeVerifiedOnly: config.includeVerifiedOnly,
            aggregationPeriod: config.aggregationPeriod,
            includeTrends: config.includeTrends
          });
          break;
      }

      if (response?.data?.jobId) {
        setCurrentExportJobId(response.data.jobId);
        setShowExportProgress(true);
      }
    } catch (error: any) {
      toast({
        title: "Lỗi xuất dữ liệu",
        description: error.messageVietnamese || error.message || "Không thể bắt đầu xuất dữ liệu với cấu hình đã chọn",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-3xl font-bold text-foreground" data-testid="text-page-title">
            Market Explorer
          </h2>
          <div className="flex items-center space-x-3">
            <Select value={selectedCommodity} onValueChange={setSelectedCommodity}>
              <SelectTrigger className="w-48" data-testid="select-commodity">
                <SelectValue placeholder="Select commodity" />
              </SelectTrigger>
              <SelectContent>
                {commodities.map((commodity) => (
                  <SelectItem key={commodity.id} value={commodity.id}>
                    {commodity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedRegion} onValueChange={setSelectedRegion}>
              <SelectTrigger className="w-48" data-testid="select-region">
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={handleGenerateForecast}
              disabled={!selectedCommodity || !selectedRegion || generateForecast.isPending}
              data-testid="button-generate-forecast"
            >
              {generateForecast.isPending ? "Generating..." : "Generate Forecast"}
            </Button>
            
            <ExportButton
              onExport={handleQuickExport}
              onConfigure={() => setShowExportConfig(true)}
              disabled={!selectedCommodity && !selectedRegion}
              size="default"
              variant="outline"
              showActiveCount={true}
              data-testid="button-export-data"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICards forecast={activeForecast} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left side - Chart and Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Lazy-loaded Forecast Chart with IntersectionObserver */}
          <div 
            ref={forecastChartLazy.ref} 
            className="min-h-[400px] bg-card border border-border rounded-lg"
            onClick={forecastChartLazy.triggerLoad}
          >
            {forecastChartLazy.shouldLoad ? (
              <Suspense 
                fallback={
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center space-y-3">
                      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto"></div>
                      <div className="text-sm text-muted-foreground">
                        Loading Vietnamese agricultural price chart...
                      </div>
                    </div>
                  </div>
                }
              >
                <ForecastChart 
                  forecast={activeForecast}
                  commodityId={selectedCommodity}
                  regionId={selectedRegion}
                  commodityName={selectedCommodityData?.name}
                  regionName={selectedRegionData?.name}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-[400px] cursor-pointer hover:bg-muted/10 transition-colors">
                <div className="text-center space-y-3">
                  <div className="text-4xl">📊</div>
                  <div className="text-sm text-muted-foreground">
                    {forecastChartLazy.isVisible 
                      ? 'Loading chart...' 
                      : 'Scroll down to load agricultural price chart'
                    }
                  </div>
                  <div className="text-xs text-primary hover:underline">
                    Click to load immediately
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <ForecastTable forecast={activeForecast} />
        </div>

        {/* Right side - Evidence, Actions, Reliability */}
        <div className="space-y-6">
          <EvidencePanel forecast={activeForecast} />
          <ActionPanel forecast={activeForecast} />
          <ReliabilityWidget metrics={activeForecast?.metrics} />
        </div>
      </div>

      {/* Loading state */}
      {(commoditiesLoading || regionsLoading || forecastsLoading) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="text-foreground">Loading data...</span>
            </div>
          </div>
        </div>
      )}

      {/* Lazy-loaded Export Configuration Modal */}
      {configModalLazy.shouldLoadModal ? (
        <Suspense fallback={
          showExportConfig ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-card rounded-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
                  <span className="text-foreground">Loading export configuration...</span>
                </div>
              </div>
            </div>
          ) : null
        }>
          <ExportConfigModal
            isOpen={showExportConfig}
            onClose={() => setShowExportConfig(false)}
            onExport={handleConfiguredExport}
            initialType="market-data"
            initialFormat="csv"
            defaultCommodityId={selectedCommodity}
            defaultRegionId={selectedRegion}
          />
        </Suspense>
      ) : null}

      {/* Lazy-loaded Export Progress Modal */}
      {progressModalLazy.shouldLoadModal ? (
        <Suspense fallback={
          showExportProgress ? (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-card rounded-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
                  <span className="text-foreground">Loading export progress...</span>
                </div>
              </div>
            </div>
          ) : null
        }>
          <ExportProgressModal
            isOpen={showExportProgress}
            onClose={() => {
              setShowExportProgress(false);
              setCurrentExportJobId(null);
            }}
            jobId={currentExportJobId}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
