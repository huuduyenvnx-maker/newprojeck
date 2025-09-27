import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Forecast, Commodity, Region } from "@/types/forecast";

interface WatchlistItem {
  id: string;
  commodityId: string;
  regionId: string;
  alertThreshold: number;
  createdAt: string;
}

export default function Watchlist() {
  const [selectedCommodity, setSelectedCommodity] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("9a58ba92-aed1-4f7e-9cb3-9cdec573c09a"); // Default to Vietnam
  const [alertThreshold, setAlertThreshold] = useState<string>("5");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: commodities = [] } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
  });

  const { data: regions = [] } = useQuery<Region[]>({
    queryKey: ["/api/regions"],
  });

  const { data: forecasts = [] } = useQuery<Forecast[]>({
    queryKey: ["/api/forecasts", "all"],
  });

  // Mock watchlist data - in production this would come from a backend endpoint
  const [watchlistItems] = useState<WatchlistItem[]>([
    {
      id: "watch-1",
      commodityId: "d30d862d-bf4a-4ea9-bee8-05ff2ee0c83a", // Jasmine Rice
      regionId: "9a58ba92-aed1-4f7e-9cb3-9cdec573c09a", // Vietnam
      alertThreshold: 5,
      createdAt: new Date().toISOString(),
    },
    {
      id: "watch-2", 
      commodityId: "b8f5c123-9876-5432-1098-765432109876", // Robusta Coffee
      regionId: "e1a2b3c4-5d6e-7f8g-9h0i-1j2k3l4m5n6o", // Mekong Delta
      alertThreshold: 8,
      createdAt: new Date().toISOString(),
    }
  ]);

  const getWatchlistData = () => {
    return watchlistItems.map(item => {
      const commodity = commodities.find(c => c.id === item.commodityId);
      const region = regions.find(r => r.id === item.regionId);
      const forecast = forecasts.find(f => 
        f.commodityId === item.commodityId && 
        f.regionId === item.regionId && 
        f.isActive
      );
      
      let priceChange = 0;
      let currentPrice = 0;
      
      if (forecast?.predictions && forecast.predictions.length >= 2) {
        const startPrice = forecast.predictions[0]?.median || 0;
        const endPrice = forecast.predictions[forecast.predictions.length - 1]?.median || 0;
        priceChange = ((endPrice - startPrice) / startPrice) * 100;
        currentPrice = startPrice;
      }
      
      return {
        ...item,
        commodityName: commodity?.name || "Unknown",
        regionName: region?.name || "Unknown",
        priceChange,
        currentPrice,
        isTriggered: Math.abs(priceChange) >= item.alertThreshold,
        forecast
      };
    });
  };

  const watchlistData = getWatchlistData();
  const triggeredAlerts = watchlistData.filter(item => item.isTriggered);

  const addToWatchlist = useMutation({
    mutationFn: async () => {
      // Mock API call - in production would POST to /api/watchlist
      return Promise.resolve();
    },
    onSuccess: () => {
      toast({
        title: "Added to Watchlist",
        description: "Commodity has been added to your watchlist",
      });
      setSelectedCommodity("");
      setSelectedRegion("");
      setAlertThreshold("5");
    },
  });

  const removeFromWatchlist = useMutation({
    mutationFn: async (itemId: string) => {
      // Mock API call - in production would DELETE /api/watchlist/:id
      return Promise.resolve();
    },
    onSuccess: () => {
      toast({
        title: "Removed from Watchlist",
        description: "Item has been removed from your watchlist",
      });
    },
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Watchlist
        </h2>
        <p className="text-muted-foreground">
          Monitor your favorite commodities and get alerted when price changes exceed your thresholds
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card data-testid="card-total-watched">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Watched
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-star text-amber-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {watchlistItems.length}
                </div>
                <div className="text-xs text-muted-foreground">Commodities</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-triggered-alerts">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Triggered Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-bell text-red-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {triggeredAlerts.length}
                </div>
                <div className="text-xs text-red-600">Above Threshold</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-performance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-chart-line text-green-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  +2.1%
                </div>
                <div className="text-xs text-green-600">30-day change</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-accuracy-score">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Accuracy Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-bullseye text-blue-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">94.2%</div>
                <div className="text-xs text-blue-600">PICP Coverage</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add to Watchlist */}
        <Card data-testid="card-add-watchlist">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-plus text-green-500"></i>
              <span>Add to Watchlist</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Commodity
              </label>
              <Select value={selectedCommodity} onValueChange={setSelectedCommodity}>
                <SelectTrigger data-testid="select-commodity">
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
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Region
              </label>
              <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                <SelectTrigger data-testid="select-region">
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
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Alert Threshold (%)
              </label>
              <Select value={alertThreshold} onValueChange={setAlertThreshold}>
                <SelectTrigger data-testid="select-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2%</SelectItem>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="8">8%</SelectItem>
                  <SelectItem value="10">10%</SelectItem>
                  <SelectItem value="15">15%</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => addToWatchlist.mutate()}
              disabled={!selectedCommodity || !selectedRegion || addToWatchlist.isPending}
              className="w-full"
              data-testid="button-add-to-watchlist"
            >
              {addToWatchlist.isPending ? "Adding..." : "Add to Watchlist"}
            </Button>
          </CardContent>
        </Card>

        {/* Current Watchlist */}
        <Card className="lg:col-span-2" data-testid="card-current-watchlist">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <i className="fas fa-list text-blue-500"></i>
              <span>Your Watchlist</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {watchlistData.length === 0 ? (
              <div className="text-center py-8">
                <i className="fas fa-star text-gray-400 text-4xl mb-3"></i>
                <p className="text-muted-foreground">No items in your watchlist</p>
                <p className="text-sm text-muted-foreground">Add commodities to start monitoring</p>
              </div>
            ) : (
              <div className="space-y-4">
                {watchlistData.map((item) => (
                  <div 
                    key={item.id}
                    className={`p-4 border rounded-lg ${
                      item.isTriggered 
                        ? "bg-red-50 border-red-200" 
                        : "bg-card border-border"
                    }`}
                    data-testid={`watchlist-item-${item.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="font-medium text-foreground">
                            {item.commodityName}
                          </h4>
                          {item.isTriggered && (
                            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                              Alert
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {item.regionName} • Threshold: ±{item.alertThreshold}%
                        </p>
                        
                        <div className="flex items-center space-x-4 text-sm">
                          <div className="flex items-center space-x-1">
                            <span className="text-muted-foreground">Current:</span>
                            <span className="font-medium">${item.currentPrice.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="text-muted-foreground">30d Change:</span>
                            <span className={`font-medium ${
                              item.priceChange > 0 ? "text-green-600" : "text-red-600"
                            }`}>
                              {item.priceChange > 0 ? "+" : ""}{item.priceChange.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-view-forecast-${item.id}`}
                        >
                          View Forecast
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeFromWatchlist.mutate(item.id)}
                          disabled={removeFromWatchlist.isPending}
                          data-testid={`button-remove-${item.id}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Overview */}
      <Card className="mt-6" data-testid="card-performance-overview">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <i className="fas fa-chart-area text-purple-500"></i>
            <span>Performance Overview</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 mb-1">+12.4%</div>
              <div className="text-sm text-muted-foreground">Best Performer</div>
              <div className="text-xs text-muted-foreground">Robusta Coffee - Mekong</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600 mb-1">-2.8%</div>
              <div className="text-sm text-muted-foreground">Worst Performer</div>
              <div className="text-xs text-muted-foreground">Black Pepper - Central</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 mb-1">96.1%</div>
              <div className="text-sm text-muted-foreground">Forecast Accuracy</div>
              <div className="text-xs text-muted-foreground">Avg PICP Coverage</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}