import type { ForecastMetrics } from "@/types/forecast";

interface ReliabilityWidgetProps {
  metrics?: ForecastMetrics;
}

export default function ReliabilityWidget({ metrics }: ReliabilityWidgetProps) {
  const getProgressColor = (value: number, threshold: number = 80) => {
    return value >= threshold ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  };

  const maseScore = metrics?.mase ? (1 - Math.min(metrics.mase, 1)) * 100 : 0;
  const smapeScore = metrics?.smape ? Math.max(0, 100 - metrics.smape) : 0;
  const coverageScore = metrics?.picp || 0;

  return (
    <div className="bg-card border border-border rounded-lg p-6" data-testid="reliability-widget">
      <h3 className="text-lg font-semibold text-foreground mb-4">Forecast Quality</h3>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">MASE Score</span>
          <span className="text-sm font-medium text-green-600" data-testid="text-mase-score">
            {metrics?.mase?.toFixed(2) || "N/A"}
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(maseScore)}`}
            style={{ width: `${Math.min(maseScore, 100)}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">SMAPE</span>
          <span className="text-sm font-medium text-green-600" data-testid="text-smape-score">
            {metrics?.smape?.toFixed(1) || "N/A"}%
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(smapeScore)}`}
            style={{ width: `${Math.min(smapeScore, 100)}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Coverage</span>
          <span className="text-sm font-medium text-green-600" data-testid="text-coverage-score">
            {metrics?.picp?.toFixed(1) || "N/A"}%
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(coverageScore, 90)}`}
            style={{ width: `${Math.min(coverageScore, 100)}%` }}
          ></div>
        </div>

        <div className="pt-3 border-t border-border">
          <div className="flex items-center space-x-2">
            <i className="fas fa-history text-blue-500"></i>
            <span className="text-xs text-muted-foreground">Last updated: 09:00 ICT</span>
          </div>
        </div>
      </div>
    </div>
  );
}
