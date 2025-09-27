import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { Forecast, Alert } from "@/types/forecast";

// Optimized lucide-react imports - tree-shakeable for Vietnamese agricultural platform
import {
  TrendingUp,
  Target,
  Heart,
  Bell,
  Gauge,
  Bot,
  Server,
  Sprout,
  MapPin,
  BarChart3,
  Download
} from "lucide-react";

// Pure helper functions moved outside component for better performance
const getAccuracyColor = (accuracy: number): string => {
  if (accuracy >= 95) return "text-green-600";
  if (accuracy >= 90) return "text-blue-600";
  if (accuracy >= 85) return "text-amber-600";
  return "text-red-600";
};

const formatNumber = (num: number, decimals: number = 1): string => {
  return num.toFixed(decimals);
};

// Mock data moved outside component to prevent recreation on every render
const performanceMetrics = {
  modelAccuracy: {
    ensemble: 94.2,
    lgb: 91.7,
    arima: 88.3,
    ets: 86.9
  },
  forecastQuality: {
    picp: 94.7,
    mase: 0.84,
    smape: 8.7,
    fqs: 92.3
  },
  systemPerformance: {
    apiResponseTime: 245,
    forecastGenerationTime: 12.4,
    verificationTime: 3.2,
    databaseQueryTime: 0.8
  },
  usageStats: {
    dailyForecasts: 48,
    monthlyUsers: 127,
    apiCalls: 2840,
    dataProcessed: 15.6 // GB
  }
};

const commodityPerformance = [
  { name: "Jasmine Rice", forecasts: 24, accuracy: 96.2, alerts: 3 },
  { name: "Robusta Coffee", forecasts: 18, accuracy: 93.8, alerts: 2 },
  { name: "Black Pepper", forecasts: 15, accuracy: 91.5, alerts: 5 },
  { name: "Natural Rubber", forecasts: 12, accuracy: 89.7, alerts: 1 },
  { name: "Cashew Nuts", forecasts: 8, accuracy: 87.3, alerts: 4 }
];

const regionalPerformance = [
  { name: "Ho Chi Minh City", forecasts: 32, accuracy: 95.1, coverage: 98.2 },
  { name: "Hanoi", forecasts: 28, accuracy: 93.7, coverage: 96.8 },
  { name: "Mekong Delta", forecasts: 25, accuracy: 94.3, coverage: 97.5 },
  { name: "Central Highlands", forecasts: 18, accuracy: 91.2, coverage: 94.6 },
  { name: "Red River Delta", forecasts: 15, accuracy: 92.8, coverage: 95.3 }
];

const Analytics = memo(function Analytics() {
  const [timeRange, setTimeRange] = useState<string>("30d");
  const [metricType, setMetricType] = useState<string>("forecasts");

  const { data: forecasts = [] } = useQuery<Forecast[]>({
    queryKey: ["/api/forecasts", "all"],
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  // Memoized analytics calculations for Vietnamese agricultural data
  const analyticsData = useMemo(() => {
    const totalForecasts = forecasts.length;
    const activeForecasts = forecasts.filter(f => f.isActive).length;
    const avgAccuracy = forecasts.length > 0 
      ? forecasts.reduce((sum, f) => sum + (f.metrics?.picp || 0), 0) / forecasts.length 
      : 0;
    
    const totalAlerts = alerts.length;
    const acknowledgedAlerts = alerts.filter(a => a.acknowledged).length;
    const highPriorityAlerts = alerts.filter(a => a.severity === "high").length;
    
    return {
      totalForecasts,
      activeForecasts, 
      avgAccuracy,
      totalAlerts,
      acknowledgedAlerts,
      highPriorityAlerts
    };
  }, [forecasts, alerts]);
  
  // Destructure memoized values for cleaner usage
  const {
    totalForecasts,
    activeForecasts,
    avgAccuracy,
    totalAlerts,
    acknowledgedAlerts, 
    highPriorityAlerts
  } = analyticsData;

  // Memoized derived data for performance optimization
  const memoizedModelAccuracy = useMemo(() => 
    Object.entries(performanceMetrics.modelAccuracy), []
  );
  
  const memoizedCommodityPerformance = useMemo(() => 
    commodityPerformance.map((commodity, index) => ({
      ...commodity,
      key: `commodity-${commodity.name}-${index}`,
      testId: `commodity-${index}`
    })), []
  );
  
  const memoizedRegionalPerformance = useMemo(() => 
    regionalPerformance.map((region, index) => ({
      ...region,
      key: `region-${region.name}-${index}`,
      testId: `region-${index}`
    })), []
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Analytics Dashboard
        </h2>
        <p className="text-muted-foreground">
          Comprehensive performance analytics and system insights for AgriIntel platform
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-foreground">Time Range:</label>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32" data-testid="select-time-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-foreground">Focus:</label>
          <Select value={metricType} onValueChange={setMetricType}>
            <SelectTrigger className="w-32" data-testid="select-metric-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forecasts">Forecasts</SelectItem>
              <SelectItem value="accuracy">Accuracy</SelectItem>
              <SelectItem value="performance">Performance</SelectItem>
              <SelectItem value="usage">Usage</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" size="sm" data-testid="button-export">
          <Download className="w-4 h-4 mr-2" />
          Export Report
        </Button>
      </div>

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <Card data-testid="card-total-forecasts">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Forecasts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-6 h-6 text-blue-500" />
              <div>
                <div className="text-2xl font-bold text-foreground">{totalForecasts}</div>
                <div className="text-xs text-blue-600">{activeForecasts} Active</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-accuracy">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Target className="w-6 h-6 text-green-500" />
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(avgAccuracy)}%
                </div>
                <div className="text-xs text-green-600">PICP Coverage</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-system-health">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Heart className="w-6 h-6 text-red-500" />
              <div>
                <div className="text-2xl font-bold text-foreground">98.7%</div>
                <div className="text-xs text-red-600">Uptime</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-alert-status">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Alert Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Bell className="w-6 h-6 text-amber-500" />
              <div>
                <div className="text-2xl font-bold text-foreground">{totalAlerts}</div>
                <div className="text-xs text-amber-600">{highPriorityAlerts} High Priority</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-api-performance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              API Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Gauge className="w-6 h-6 text-purple-500" />
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {performanceMetrics.systemPerformance.apiResponseTime}ms
                </div>
                <div className="text-xs text-purple-600">Avg Response</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Model Performance */}
        <Card data-testid="card-model-performance">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bot className="w-5 h-5 text-blue-500" />
              <span>Model Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {memoizedModelAccuracy.map(([model, accuracy]) => (
                <div key={model} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="text-sm font-medium text-foreground capitalize">
                      {model === 'lgb' ? 'LightGBM' : model.toUpperCase()}
                    </div>
                    <Progress value={accuracy} className="w-32 h-2" />
                  </div>
                  <div className={`text-sm font-bold ${getAccuracyColor(accuracy)}`}>
                    {formatNumber(accuracy)}%
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System Performance Metrics */}
        <Card data-testid="card-system-metrics">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-green-500" />
              <span>System Metrics</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Forecast Generation</span>
                <span className="font-medium">{performanceMetrics.systemPerformance.forecastGenerationTime}s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">LLM Verification</span>
                <span className="font-medium">{performanceMetrics.systemPerformance.verificationTime}s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Database Query</span>
                <span className="font-medium">{performanceMetrics.systemPerformance.databaseQueryTime}s</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Data Processed (30d)</span>
                <span className="font-medium">{performanceMetrics.usageStats.dataProcessed} GB</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Commodity Performance */}
        <Card data-testid="card-commodity-performance">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Sprout className="w-5 h-5 text-green-500" />
              <span>Commodity Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {memoizedCommodityPerformance.map((commodity) => (
                <div 
                  key={commodity.key}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  data-testid={commodity.testId}
                >
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{commodity.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {commodity.forecasts} forecasts • {commodity.alerts} alerts
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${getAccuracyColor(commodity.accuracy)}`}>
                      {formatNumber(commodity.accuracy)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Accuracy</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Regional Performance */}
        <Card data-testid="card-regional-performance">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <MapPin className="w-5 h-5 text-purple-500" />
              <span>Regional Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {memoizedRegionalPerformance.map((region) => (
                <div 
                  key={region.key}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  data-testid={region.testId}
                >
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{region.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {region.forecasts} forecasts • {formatNumber(region.coverage)}% coverage
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${getAccuracyColor(region.accuracy)}`}>
                      {formatNumber(region.accuracy)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Accuracy</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forecast Quality Metrics */}
      <Card className="mt-6" data-testid="card-forecast-quality">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-orange-500" />
            <span>Forecast Quality Metrics</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600 mb-2">
                {formatNumber(performanceMetrics.forecastQuality.picp)}%
              </div>
              <div className="text-sm text-muted-foreground mb-2">PICP Coverage</div>
              <Progress value={performanceMetrics.forecastQuality.picp} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">Target: ≥95%</div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">
                {formatNumber(performanceMetrics.forecastQuality.mase)}
              </div>
              <div className="text-sm text-muted-foreground mb-2">MASE Score</div>
              <Progress value={84} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">Target: ≤1.0</div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 mb-2">
                {formatNumber(performanceMetrics.forecastQuality.smape)}%
              </div>
              <div className="text-sm text-muted-foreground mb-2">SMAPE Error</div>
              <Progress value={91.3} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">Target: ≤10%</div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-orange-600 mb-2">
                {formatNumber(performanceMetrics.forecastQuality.fqs)}
              </div>
              <div className="text-sm text-muted-foreground mb-2">FQS Score</div>
              <Progress value={performanceMetrics.forecastQuality.fqs} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">Target: ≥90</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export default Analytics;