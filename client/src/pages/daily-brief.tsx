import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Forecast, Alert, Commodity } from "@/types/forecast";

export default function DailyBrief() {
  const { data: forecasts = [] } = useQuery<Forecast[]>({
    queryKey: ["/api/forecasts", "all"],
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const { data: commodities = [] } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
  });

  const activeForecasts = forecasts.filter(f => f.isActive);
  const criticalAlerts = alerts.filter(a => !a.acknowledged && a.severity === "high");
  const priceAlerts = alerts.filter(a => a.type === "price_anomaly" && !a.acknowledged);

  // Calculate trending commodities based on forecast changes
  const trendingCommodities = activeForecasts
    .map(forecast => {
      const predictions = forecast.predictions || [];
      if (predictions.length < 2) return null;
      
      const startPrice = predictions[0]?.median || 0;
      const endPrice = predictions[predictions.length - 1]?.median || 0;
      const priceChange = ((endPrice - startPrice) / startPrice) * 100;
      
      const commodity = commodities.find(c => c.id === forecast.commodityId);
      
      return {
        name: commodity?.name || "Unknown",
        change: priceChange,
        confidence: forecast.metrics?.fqs || 0,
        forecast
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Daily Brief
        </h2>
        <p className="text-muted-foreground">
          {new Date().toLocaleDateString("en-US", { 
            weekday: "long", 
            year: "numeric", 
            month: "long", 
            day: "numeric" 
          })} • Market insights and key developments
        </p>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        {/* 30-Day Price Trend */}
        <Card data-testid="card-price-trend">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              30-Day Price Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-chart-line text-blue-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {activeForecasts.length}
                </div>
                <div className="text-xs text-green-600">Active Forecasts</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Anomaly Events */}
        <Card data-testid="card-anomaly-events">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Anomaly Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-exclamation-triangle text-red-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {priceAlerts.length}
                </div>
                <div className="text-xs text-red-600">Price Alerts</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Spread Alerts */}
        <Card data-testid="card-spread-alerts">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Spread Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-wave-square text-amber-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">2</div>
                <div className="text-xs text-amber-600">Z-score {'>'} 3</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ENSO Weather */}
        <Card data-testid="card-enso-weather">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              ENSO Weather
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-cloud-rain text-blue-500 text-xl"></i>
              <div>
                <div className="text-lg font-bold text-foreground">Neutral</div>
                <div className="text-xs text-blue-600">Normal Conditions</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Actions */}
        <Card data-testid="card-top-actions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-tasks text-green-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {criticalAlerts.length + 3}
                </div>
                <div className="text-xs text-green-600">Recommendations</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Market Highlights */}
        <Card data-testid="card-market-highlights">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-star text-amber-500"></i>
              <span>Market Highlights</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {trendingCommodities.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${
                      item.change > 0 ? "bg-green-500" : "bg-red-500"
                    }`}></div>
                    <div>
                      <div className="font-medium text-foreground">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        30-day outlook • FQS: {item.confidence.toFixed(1)}
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-medium ${
                    item.change > 0 ? "text-green-600" : "text-red-600"
                  }`}>
                    {item.change > 0 ? "+" : ""}{item.change.toFixed(1)}%
                  </div>
                </div>
              ))}
              
              {trendingCommodities.length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  No trending commodities available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Critical Alerts */}
        <Card data-testid="card-critical-alerts">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-bell text-red-500"></i>
              <span>Critical Alerts</span>
              {criticalAlerts.length > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                  {criticalAlerts.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {criticalAlerts.map((alert) => (
                <div key={alert.id} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <i className="fas fa-exclamation-triangle text-red-500 mt-1"></i>
                    <div className="flex-1">
                      <h4 className="font-medium text-red-800">{alert.title}</h4>
                      <p className="text-sm text-red-700 mt-1">{alert.message}</p>
                      <span className="text-xs text-red-600">
                        {new Date(alert.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              
              {criticalAlerts.length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <i className="fas fa-shield-check text-green-500 text-2xl mb-2"></i>
                  <p>No critical alerts</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Weather Impact */}
        <Card data-testid="card-weather-impact">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-cloud-sun text-blue-500"></i>
              <span>Weather Impact</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-blue-800">Mekong Delta</h4>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    Favorable
                  </span>
                </div>
                <p className="text-sm text-blue-700">
                  Optimal rainfall conditions supporting rice cultivation. Expected yield increase of 5-8%.
                </p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-amber-800">Central Highlands</h4>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">
                    Moderate Risk
                  </span>
                </div>
                <p className="text-sm text-amber-700">
                  Irregular precipitation patterns may affect coffee harvest quality.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quality Metrics */}
        <Card data-testid="card-quality-metrics">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-chart-bar text-green-500"></i>
              <span>Model Performance</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Average PICP</span>
                <span className="font-medium text-green-600">94.7%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: "94.7%" }}></div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Average MASE</span>
                <span className="font-medium text-blue-600">0.84</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: "84%" }}></div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Verification Rate</span>
                <span className="font-medium text-green-600">98.2%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: "98.2%" }}></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
