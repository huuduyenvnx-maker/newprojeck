import { useMemo, useCallback, memo, useState, useEffect } from "react";
// Optimized Recharts imports - only import what we use for better tree-shaking
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer, 
  Area, 
  ComposedChart,
  Legend 
} from "recharts";
import type { Forecast } from "@/types/forecast";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatVietnameseCurrency } from "@/lib/vietnamese-formatting";
import { useQuery } from "@tanstack/react-query";

interface ForecastChartProps {
  forecast?: Forecast;
  commodityId?: string;
  regionId?: string;
  commodityName?: string; // Keep for display purposes
  regionName?: string; // Keep for display purposes  
  showComparison?: boolean; // Toggle between forecast-only and actual vs forecast
  currency?: "VND" | "USD";
}

// Pure helper functions moved outside component for better performance
const formatDate = (dateString: string) => 
  new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const ForecastChart = memo(function ForecastChart({ 
  forecast, 
  commodityId,
  regionId,
  commodityName, 
  regionName, 
  showComparison: defaultShowComparison = false,
  currency = "USD" 
}: ForecastChartProps) {
  const { t, i18n } = useTranslation();
  const [showDataTable, setShowDataTable] = useState(false);
  const [showComparison, setShowComparison] = useState(defaultShowComparison);
  
  // Fetch actual market prices for comparison when showComparison is enabled
  const { data: actualPricesData, isLoading: actualPricesLoading, error: actualPricesError } = useQuery({
    queryKey: ['/api/price-data', commodityId, regionId],
    enabled: showComparison && !!commodityId && !!regionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      if (!commodityId || !regionId) return null;
      
      // Calculate date range for the last 30 days to match forecast period
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 30);
      
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      
      const response = await fetch(`/api/price-data/${commodityId}/${regionId}?${params}`, {
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'include', // Include auth cookies
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch price data: ${response.status}`);
      }
      
      const result = await response.json();
      return result || null;
    },
  });
  // Memoized chart data computation for Vietnamese agricultural data
  const chartData = useMemo(() => {
    if (!forecast?.predictions) return [];
    
    // Create map for actual prices if available
    const actualPricesMap = new Map<string, number>();
    if (showComparison && actualPricesData && Array.isArray(actualPricesData)) {
      actualPricesData.forEach((price: any) => {
        const dateKey = formatDate(price.date);
        // Use the price field directly from prices_raw table
        const priceValue = price.price || 0;
        actualPricesMap.set(dateKey, priceValue);
      });
    }
    
    return forecast.predictions.map((prediction, index) => {
      const dateKey = formatDate(prediction.date);
      const forecastValue = prediction.median;
      const actualValue = actualPricesMap.get(dateKey) || null;
      
      return {
        date: dateKey,
        // Forecast data (dashed line)
        forecast: forecastValue,
        forecast_q10: prediction.q10,
        forecast_q90: prediction.q90,
        forecast_confidence: prediction.confidence,
        // Actual data (solid line) - only when available
        actual: actualValue,
        // Legacy fields for backward compatibility
        median: forecastValue,
        q10: prediction.q10,
        q90: prediction.q90,
        confidence: prediction.confidence,
        dayOffset: index + 1
      };
    });
  }, [forecast?.predictions, actualPricesData, showComparison, currency]);
  
  // Memoized axis formatters for performance optimization
  const tickFormatter = useCallback((value: number) => {
    if (currency === "VND") {
      return i18n.language === 'vi' ? formatVietnameseCurrency(value, 'VND') : `₫${value.toLocaleString()}`;
    }
    return `$${value.toFixed(0)}`;
  }, [currency, i18n.language]);
  
  // Early return for missing data
  if (!forecast || !forecast.predictions) {
    return (
      <div className="lg:col-span-2">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">No forecast data available</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lg:col-span-2">
      <div className="bg-card border border-border rounded-lg p-6" data-testid="forecast-chart">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 bg-gradient-to-b from-primary to-primary/50 rounded-full"></div>
              <h3 className="text-xl font-bold text-foreground tracking-tight">
                {showComparison ? 'So sánh Giá thực tế vs Dự báo' : 'Dự báo Giá 30 ngày'}
              </h3>
            </div>
            <Button 
              variant={showComparison ? "default" : "outline"}
              size="sm"
              onClick={() => setShowComparison(!showComparison)}
              disabled={actualPricesLoading}
              data-testid="button-toggle-comparison"
              className="text-xs font-medium px-4 py-2 transition-all duration-200 hover:scale-105"
            >
              {showComparison ? 'Chỉ dự báo' : 'So sánh thực tế'}
            </Button>
          </div>
          <div className="flex items-center space-x-3">
            <div className="px-3 py-1.5 bg-muted/50 rounded-full border border-border/50">
              <span className="text-sm font-medium text-foreground" data-testid="text-commodity-region">
                {commodityName} • {regionName}
              </span>
            </div>
            {actualPricesLoading && showComparison && (
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                <div className="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                Đang tải giá thực tế...
              </div>
            )}
            {actualPricesError && showComparison && (
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md border border-red-200" data-testid="text-price-error">
                Không tải được giá thực tế
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-full">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-semibold text-emerald-700">AI Xác minh</span>
            </div>
          </div>
        </div>

        <div className="h-96 mb-6 p-4 bg-gradient-to-br from-background via-background to-muted/20 rounded-lg border border-border/50">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart 
              data={chartData}
              role="img"
              aria-label={t('accessibility.chartDescription', 'Interactive chart showing agricultural price forecast data')}
              aria-describedby="chart-summary"
              margin={{ top: 20, right: 30, left: 20, bottom: 10 }}
            >
              <CartesianGrid 
                strokeDasharray="2 2" 
                stroke="hsl(var(--border))" 
                strokeOpacity={0.3}
                horizontal={true}
                vertical={false}
              />
              <XAxis 
                dataKey="date" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                fontWeight={500}
                axisLine={false}
                tickLine={false}
                dy={10}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                fontWeight={500}
                tickFormatter={tickFormatter}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              
              {/* Enhanced confidence band with gradient */}
              <defs>
                <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <Area
                dataKey="forecast_q90"
                stroke="none"
                fill="url(#confidenceGradient)"
                type="monotone"
              />
              <Area
                dataKey="forecast_q10"
                stroke="none"
                fill="hsl(var(--background))"
                fillOpacity={1}
                type="monotone"
              />
              
              {/* Actual price line with enhanced styling */}
              {showComparison && (
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Giá thực tế"
                  stroke="#ef4444"
                  strokeWidth={3}
                  strokeDasharray="0"
                  dot={{ 
                    fill: "#ef4444", 
                    strokeWidth: 2, 
                    r: 5,
                    stroke: "#ffffff"
                  }}
                  activeDot={{ 
                    r: 8, 
                    stroke: "#ef4444", 
                    strokeWidth: 3,
                    fill: "#ffffff",
                    filter: "drop-shadow(0 2px 4px rgba(239, 68, 68, 0.3))"
                  }}
                  connectNulls={false}
                />
              )}
              
              {/* Enhanced forecast line */}
              <Line
                type="monotone"
                dataKey="forecast"
                name="Dự báo giá"
                stroke="#3b82f6"
                strokeWidth={3}
                strokeDasharray={showComparison ? "8 4" : "0"}
                dot={{ 
                  fill: "#3b82f6", 
                  strokeWidth: 2, 
                  r: 5,
                  stroke: "#ffffff"
                }}
                activeDot={{ 
                  r: 8, 
                  stroke: "#3b82f6", 
                  strokeWidth: 3,
                  fill: "#ffffff",
                  filter: "drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3))"
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart Summary for Screen Readers */}
        <div id="chart-summary" className="sr-only">
          {showComparison ? 
            t('accessibility.comparisonChartSummary', 
              `Price comparison chart showing ${chartData.length} data points from ${chartData[0]?.date} to ${chartData[chartData.length - 1]?.date}. Shows actual prices (solid red line) compared to forecasted prices (dashed blue line) with confidence bands.`
            ) :
            t('accessibility.chartSummary', 
              `Price forecast chart showing ${chartData.length} data points from ${chartData[0]?.date} to ${chartData[chartData.length - 1]?.date}. Median prices range from ${Math.min(...chartData.map(d => d.forecast || d.median))} to ${Math.max(...chartData.map(d => d.forecast || d.median))} ${currency}.`
            )
          }
        </div>
        
        {/* Accessible Data Table Toggle */}
        <div className="mb-4 flex items-center justify-between">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowDataTable(!showDataTable)}
            aria-pressed={showDataTable}
            aria-describedby="data-table-description"
            data-testid="button-view-data-table"
          >
            {showDataTable ? t('accessibility.chartMode', 'View Chart') : t('accessibility.viewDataTable', 'View Data Table')}
          </Button>
          <span id="data-table-description" className="text-xs text-muted-foreground">
            {t('accessibility.dataTableDescription', 'Toggle between chart and accessible table view')}
          </span>
        </div>
        
        {/* Data Table for Screen Reader Accessibility */}
        {showDataTable && (
          <div className="mb-4 max-h-60 overflow-y-auto border rounded-lg">
            <table className="w-full text-sm" role="table" aria-label={t('accessibility.forecastDataTable', 'Forecast data table')}>
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th scope="col" className="p-2 text-left">{t('common.date', 'Date')}</th>
                  <th scope="col" className="p-2 text-right">{t('marketExplorer.medianPrice', 'Median Price')}</th>
                  <th scope="col" className="p-2 text-right">Q10 {t('common.low', 'Low')}</th>
                  <th scope="col" className="p-2 text-right">Q90 {t('common.high', 'High')}</th>
                  <th scope="col" className="p-2 text-right">{t('common.confidence', 'Confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((item, index) => (
                  <tr key={index} className="border-t">
                    <td className="p-2 font-medium">{item.date}</td>
                    <td className="p-2 text-right font-bold">
                      {i18n.language === 'vi' ? formatVietnameseCurrency(item.median, 'USD') : `$${item.median.toFixed(2)}`}
                    </td>
                    <td className="p-2 text-right">
                      {i18n.language === 'vi' ? formatVietnameseCurrency(item.q10, 'USD') : `$${item.q10.toFixed(2)}`}
                    </td>
                    <td className="p-2 text-right">
                      {i18n.language === 'vi' ? formatVietnameseCurrency(item.q90, 'USD') : `$${item.q90.toFixed(2)}`}
                    </td>
                    <td className="p-2 text-right">
                      <span className={`inline-flex px-2 py-1 rounded text-xs ${
                        item.confidence >= 0.8 ? 'bg-green-100 text-green-800' :
                        item.confidence >= 0.6 ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Enhanced Chart Legend */}
        <div className="flex items-center justify-center gap-8 px-4 py-3 bg-muted/30 rounded-lg border border-border/30" role="list" aria-label={t('accessibility.chartLegend', 'Chart legend')}>
          {showComparison && (
            <div className="flex items-center gap-3" role="listitem">
              <div className="w-6 h-1 bg-red-500 rounded-full shadow-sm" aria-hidden="true"></div>
              <span className="text-sm font-medium text-foreground">Giá thực tế</span>
            </div>
          )}
          <div className="flex items-center gap-3" role="listitem">
            <div 
              className={`w-6 h-1 rounded-full shadow-sm ${
                showComparison 
                  ? 'bg-gradient-to-r from-blue-500 via-transparent to-blue-500 bg-[length:8px_1px] bg-repeat-x' 
                  : 'bg-blue-500'
              }`} 
              aria-hidden="true"
            ></div>
            <span className="text-sm font-medium text-foreground">
              {showComparison ? 'Dự báo giá' : 'Giá dự báo trung vị'}
            </span>
          </div>
          <div className="flex items-center gap-3" role="listitem">
            <div className="w-6 h-1 bg-gradient-to-r from-blue-500/30 to-blue-500/10 rounded-full shadow-sm" aria-hidden="true"></div>
            <span className="text-sm font-medium text-foreground">Khoảng tin cậy 95%</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default ForecastChart;
