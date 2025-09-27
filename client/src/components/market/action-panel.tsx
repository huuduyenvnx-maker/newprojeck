import { calculateCCS } from "@/hooks/use-llm-verification";
import type { Forecast } from "@/types/forecast";

interface ActionPanelProps {
  forecast?: Forecast;
}

export default function ActionPanel({ forecast }: ActionPanelProps) {
  const ccs = forecast?.verifications ? calculateCCS(forecast.verifications) : 0;
  const recommendations = forecast?.recommendations || [];

  if (recommendations.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6" data-testid="action-panel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Action Recommendations</h3>
          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
            CCS: {ccs.toFixed(2)}
          </span>
        </div>
        <div className="text-center py-8">
          <p className="text-muted-foreground">No recommendations available</p>
        </div>
      </div>
    );
  }

  const primaryRecommendation = recommendations[0];

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case "buy": return "bg-green-50 border-green-200 text-green-800";
      case "sell": return "bg-red-50 border-red-200 text-red-800";
      case "hold": return "bg-blue-50 border-blue-200 text-blue-800";
      default: return "bg-gray-50 border-gray-200 text-gray-800";
    }
  };

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case "buy": return "fas fa-arrow-trend-up text-green-600";
      case "sell": return "fas fa-arrow-trend-down text-red-600";
      case "hold": return "fas fa-hand text-blue-600";
      default: return "fas fa-info-circle text-gray-600";
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6" data-testid="action-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Action Recommendations</h3>
        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
          CCS: {ccs.toFixed(2)}
        </span>
      </div>

      <div className="space-y-4">
        {/* Primary Recommendation */}
        <div 
          className={`p-4 border rounded-lg ${getActionColor(primaryRecommendation.action)}`}
          data-testid={`recommendation-${primaryRecommendation.action}`}
        >
          <div className="flex items-start space-x-3">
            <i className={`${getActionIcon(primaryRecommendation.action)} mt-1`}></i>
            <div className="flex-1">
              <h4 className="font-medium capitalize">
                {primaryRecommendation.action} Signal
              </h4>
              <p className="text-sm mt-1" data-testid="text-reasoning">
                {primaryRecommendation.reasoning}
              </p>
              {primaryRecommendation.entryPrice && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div data-testid="text-entry-price">
                    <span>Entry: ${primaryRecommendation.entryPrice}</span>
                  </div>
                  {primaryRecommendation.targetPrice && (
                    <div data-testid="text-target-price">
                      <span>Target: ${primaryRecommendation.targetPrice}</span>
                    </div>
                  )}
                  {primaryRecommendation.stopLoss && (
                    <div data-testid="text-stop-loss">
                      <span>Stop Loss: ${primaryRecommendation.stopLoss}</span>
                    </div>
                  )}
                  <div data-testid="text-risk-level">
                    <span>Risk: {primaryRecommendation.riskLevel}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Secondary Recommendations */}
        <div className="space-y-3">
          <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg" data-testid="recommendation-monitor">
            <i className="fas fa-clock text-amber-500"></i>
            <div className="flex-1">
              <span className="text-sm font-medium text-foreground">Monitor weather patterns</span>
              <p className="text-xs text-muted-foreground">ENSO indicators suggest potential volatility</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg" data-testid="recommendation-hedge">
            <i className="fas fa-balance-scale text-blue-500"></i>
            <div className="flex-1">
              <span className="text-sm font-medium text-foreground">Hedge exposure</span>
              <p className="text-xs text-muted-foreground">Consider 15-20% position sizing</p>
            </div>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-medium text-foreground mb-2">Risk Assessment</h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm" data-testid="risk-volatility">
              <span className="text-muted-foreground">Volatility</span>
              <span className="text-amber-600">
                {primaryRecommendation.metadata?.volatility 
                  ? `${(primaryRecommendation.metadata.volatility * 100).toFixed(1)}%`
                  : "Medium (12.3%)"
                }
              </span>
            </div>
            <div className="flex justify-between text-sm" data-testid="risk-liquidity">
              <span className="text-muted-foreground">Liquidity</span>
              <span className="text-green-600">High</span>
            </div>
            <div className="flex justify-between text-sm" data-testid="risk-market-depth">
              <span className="text-muted-foreground">Market Depth</span>
              <span className="text-green-600">Good</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
