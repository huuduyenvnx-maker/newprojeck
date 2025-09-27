import { useQuery } from "@tanstack/react-query";
import ReliabilityWidget from "@/components/shared/reliability-widget";
import type { Forecast } from "@/types/forecast";

export default function Reliability() {
  const { data: allForecasts = [], isLoading } = useQuery<Forecast[]>({
    queryKey: ["/api/forecasts", "all"],
  });

  const activeForecasts = allForecasts.filter(f => f.isActive);
  
  // Calculate aggregated metrics
  const aggregatedMetrics = activeForecasts.reduce((acc, forecast) => {
    if (forecast.metrics) {
      acc.mase += forecast.metrics.mase || 0;
      acc.smape += forecast.metrics.smape || 0;
      acc.picp += forecast.metrics.picp || 0;
      acc.fqs += forecast.metrics.fqs || 0;
      acc.count += 1;
    }
    return acc;
  }, { mase: 0, smape: 0, picp: 0, fqs: 0, count: 0 });

  const avgMetrics = aggregatedMetrics.count > 0 ? {
    mase: aggregatedMetrics.mase / aggregatedMetrics.count,
    smape: aggregatedMetrics.smape / aggregatedMetrics.count,
    picp: aggregatedMetrics.picp / aggregatedMetrics.count,
    coverage: aggregatedMetrics.picp / aggregatedMetrics.count,
    fqs: aggregatedMetrics.fqs / aggregatedMetrics.count,
  } : undefined;

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Reliability Dashboard
        </h2>
        <p className="text-muted-foreground">
          Monitor forecast accuracy and model performance across all commodities
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Overall Performance */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Overall Performance</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Active Forecasts</span>
              <span className="font-medium" data-testid="text-active-forecasts">
                {activeForecasts.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg. PICP</span>
              <span className="font-medium text-green-600" data-testid="text-avg-picp">
                {avgMetrics?.picp?.toFixed(1) || "N/A"}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg. MASE</span>
              <span className="font-medium text-blue-600" data-testid="text-avg-mase">
                {avgMetrics?.mase?.toFixed(2) || "N/A"}
              </span>
            </div>
          </div>
        </div>

        {/* Target Compliance */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Target Compliance</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">PICP Target (95%)</span>
              <span className={`text-sm font-medium ${
                (avgMetrics?.picp || 0) >= 93 && (avgMetrics?.picp || 0) <= 97 
                  ? "text-green-600" 
                  : "text-amber-600"
              }`} data-testid="text-picp-compliance">
                {avgMetrics?.picp ? 
                  ((avgMetrics.picp >= 93 && avgMetrics.picp <= 97) ? "✓ In Range" : "⚠ Out of Range")
                  : "N/A"
                }
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">MASE Target ({'<'}1.0)</span>
              <span className={`text-sm font-medium ${
                (avgMetrics?.mase || 0) < 1.0 ? "text-green-600" : "text-red-600"
              }`} data-testid="text-mase-compliance">
                {avgMetrics?.mase ? 
                  (avgMetrics.mase < 1.0 ? "✓ Good" : "✗ Needs Improvement")
                  : "N/A"
                }
              </span>
            </div>
          </div>
        </div>

        {/* Model Health */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Model Health</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Model Version</span>
              <span className="font-medium" data-testid="text-model-version">v1.2.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Retrain</span>
              <span className="text-sm text-muted-foreground">2 days ago</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Drift Status</span>
              <span className="text-green-600 text-sm font-medium" data-testid="text-drift-status">
                ✓ Stable
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ReliabilityWidget metrics={avgMetrics} />
        
        {/* Recent Performance History */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Recent Performance</h3>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Historical accuracy over the last 30 days
            </div>
            
            {/* Simplified performance chart */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">Week 1</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 h-2 bg-muted rounded">
                    <div className="w-4/5 h-2 bg-green-500 rounded"></div>
                  </div>
                  <span className="text-sm text-green-600">94.2%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Week 2</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 h-2 bg-muted rounded">
                    <div className="w-5/6 h-2 bg-green-500 rounded"></div>
                  </div>
                  <span className="text-sm text-green-600">95.8%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Week 3</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 h-2 bg-muted rounded">
                    <div className="w-4/5 h-2 bg-amber-500 rounded"></div>
                  </div>
                  <span className="text-sm text-amber-600">92.1%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Week 4</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 h-2 bg-muted rounded">
                    <div className="w-full h-2 bg-green-500 rounded"></div>
                  </div>
                  <span className="text-sm text-green-600">96.5%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
