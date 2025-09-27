import { calculateCCS, getConfidenceLevel } from "@/hooks/use-llm-verification";
import type { Forecast } from "@/types/forecast";

interface KPICardsProps {
  forecast?: Forecast;
}

export default function KPICards({ forecast }: KPICardsProps) {
  const ccs = forecast?.verifications ? calculateCCS(forecast.verifications) : 0;
  const metrics = forecast?.metrics;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="metric-card" data-testid="card-ccs-score">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">CCS Score</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className="ccs-score text-lg" data-testid="text-ccs-value">
                {ccs.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">
                {getConfidenceLevel(ccs)} Confidence
              </span>
            </div>
          </div>
          <i className="fas fa-shield-check text-green-500 text-2xl"></i>
        </div>
      </div>

      <div className="metric-card" data-testid="card-fqs-score">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">FQS Score</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-2xl font-bold text-foreground" data-testid="text-fqs-value">
                {metrics?.fqs?.toFixed(1) || "N/A"}
              </span>
              <span className="text-xs text-green-600">+2.1%</span>
            </div>
          </div>
          <i className="fas fa-chart-line text-blue-500 text-2xl"></i>
        </div>
      </div>

      <div className="metric-card" data-testid="card-spread-zscore">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Spread Z-score</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-2xl font-bold text-foreground" data-testid="text-zscore-value">
                1.24
              </span>
              <span className="text-xs text-muted-foreground">p=0.087</span>
            </div>
          </div>
          <i className="fas fa-wave-square text-amber-500 text-2xl"></i>
        </div>
      </div>

      <div className="metric-card" data-testid="card-picp-coverage">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">PICP Coverage</p>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-2xl font-bold text-foreground" data-testid="text-picp-value">
                {metrics?.picp?.toFixed(1) || "N/A"}%
              </span>
              <span className="text-xs text-green-600">Target: 95%</span>
            </div>
          </div>
          <i className="fas fa-bullseye text-green-500 text-2xl"></i>
        </div>
      </div>
    </div>
  );
}
