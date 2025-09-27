import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useSimpleVirtualList } from "@/hooks/useVirtualList";
import type { Commodity, Region } from "@/types/forecast";

interface DataSource {
  id: string;
  name: string;
  type: string;
  status: "active" | "inactive" | "error";
  trustScore: number;
  lastUpdate: string;
  apiEndpoint: string;
  region: string;
  commodities: string[];
  qualityMetrics: {
    accuracy: number;
    completeness: number;
    consistency: number;
    timeliness: number;
  };
  monthlyUpdates: number;
  totalRecords: number;
}

export default function DataSources() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: commodities = [] } = useQuery<Commodity[]>({
    queryKey: ["/api/commodities"],
  });

  const { data: regions = [] } = useQuery<Region[]>({
    queryKey: ["/api/regions"],
  });

  // Mock data sources - in production this would come from backend
  const dataSources: DataSource[] = [
    {
      id: "vce-main",
      name: "Vietnam Commodity Exchange",
      type: "exchange",
      status: "active",
      trustScore: 98.2,
      lastUpdate: "2025-09-22T10:30:00Z",
      apiEndpoint: "https://api.vce.vn/v2/prices",
      region: "Vietnam National",
      commodities: ["Rice", "Coffee", "Pepper", "Rubber"],
      qualityMetrics: {
        accuracy: 97.8,
        completeness: 99.1,
        consistency: 96.5,
        timeliness: 99.8
      },
      monthlyUpdates: 1240,
      totalRecords: 45230
    },
    {
      id: "agridata-mekong",
      name: "Mekong AgriData Platform",
      type: "aggregator",
      status: "active",
      trustScore: 92.7,
      lastUpdate: "2025-09-22T09:45:00Z",
      apiEndpoint: "https://mekongagri.com/api/data",
      region: "Mekong Delta",
      commodities: ["Rice", "Fish", "Coconut"],
      qualityMetrics: {
        accuracy: 94.2,
        completeness: 91.8,
        consistency: 92.1,
        timeliness: 93.0
      },
      monthlyUpdates: 890,
      totalRecords: 28450
    },
    {
      id: "weather-gov",
      name: "Vietnam Meteorological Service",
      type: "weather",
      status: "active",
      trustScore: 96.1,
      lastUpdate: "2025-09-22T11:00:00Z",
      apiEndpoint: "https://nchmf.gov.vn/api/weather",
      region: "Vietnam National",
      commodities: ["All Agricultural"],
      qualityMetrics: {
        accuracy: 95.8,
        completeness: 97.2,
        consistency: 95.4,
        timeliness: 96.1
      },
      monthlyUpdates: 2160,
      totalRecords: 125600
    },
    {
      id: "fertilizer-assoc",
      name: "Vietnam Fertilizer Association",
      type: "industry",
      status: "error",
      trustScore: 85.4,
      lastUpdate: "2025-09-21T16:20:00Z",
      apiEndpoint: "https://vfa.org.vn/api/prices",
      region: "Vietnam National", 
      commodities: ["Urea", "NPK", "Phosphate"],
      qualityMetrics: {
        accuracy: 88.9,
        completeness: 82.1,
        consistency: 84.7,
        timeliness: 75.8
      },
      monthlyUpdates: 450,
      totalRecords: 12300
    },
    {
      id: "highland-coffee",
      name: "Central Highlands Coffee Board",
      type: "regional",
      status: "inactive",
      trustScore: 78.3,
      lastUpdate: "2025-09-20T14:30:00Z",
      apiEndpoint: "https://chcb.gov.vn/api/coffee",
      region: "Central Highlands",
      commodities: ["Robusta Coffee", "Arabica Coffee"],
      qualityMetrics: {
        accuracy: 82.1,
        completeness: 76.8,
        consistency: 78.9,
        timeliness: 65.4
      },
      monthlyUpdates: 180,
      totalRecords: 8450
    }
  ];

  // Memoize filtered sources for performance
  const filteredSources = useMemo(() => 
    dataSources.filter(source => {
      if (statusFilter !== "all" && source.status !== statusFilter) return false;
      if (typeFilter !== "all" && source.type !== typeFilter) return false;
      return true;
    }), 
    [statusFilter, typeFilter]
  );

  // Virtual scrolling for data sources list
  const sourcesVirtual = useSimpleVirtualList(
    filteredSources,
    Math.min(600, filteredSources.length * 180), // Dynamic height, max 600px
    180, // Data source card height with quality metrics
    5 // Conservative overscan for agricultural data
  );

  const activeSourcesCount = dataSources.filter(s => s.status === "active").length;
  const errorSourcesCount = dataSources.filter(s => s.status === "error").length;
  const avgTrustScore = dataSources.reduce((sum, s) => sum + s.trustScore, 0) / dataSources.length;
  const totalRecords = dataSources.reduce((sum, s) => sum + s.totalRecords, 0);

  // Memoize helper functions for performance optimization
  const getStatusColor = useMemo(() => (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "inactive": return "bg-gray-500";
      case "error": return "bg-red-500";
      default: return "bg-gray-500";
    }
  }, []);

  const getStatusBadgeColor = useMemo(() => (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100";
      case "inactive": return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";
      case "error": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";
    }
  }, []);

  const getTrustScoreColor = useMemo(() => (score: number) => {
    if (score >= 95) return "text-green-600 dark:text-green-400";
    if (score >= 85) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  }, []);

  const formatLastUpdate = useMemo(() => (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Data Sources
        </h2>
        <p className="text-muted-foreground">
          Monitor and manage agricultural data sources, quality metrics, and trust rankings
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card data-testid="card-active-sources">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-database text-green-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">{activeSourcesCount}</div>
                <div className="text-xs text-green-600">Online & Operational</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-error-sources">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Error Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-exclamation-triangle text-red-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">{errorSourcesCount}</div>
                <div className="text-xs text-red-600">Requires Attention</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-trust-score">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Trust Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-shield-check text-blue-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">{avgTrustScore.toFixed(1)}%</div>
                <div className="text-xs text-blue-600">Quality Rating</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-records">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Records
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <i className="fas fa-chart-bar text-purple-500 text-xl"></i>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {(totalRecords / 1000).toFixed(0)}K
                </div>
                <div className="text-xs text-purple-600">Data Points</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-foreground">Status:</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-foreground">Type:</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-32" data-testid="select-type-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="exchange">Exchange</SelectItem>
              <SelectItem value="aggregator">Aggregator</SelectItem>
              <SelectItem value="weather">Weather</SelectItem>
              <SelectItem value="industry">Industry</SelectItem>
              <SelectItem value="regional">Regional</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Data Sources Table */}
      <Card data-testid="card-data-sources-table">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <i className="fas fa-table text-blue-500"></i>
            <span>Data Sources ({filteredSources.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredSources.length === 0 ? (
            <div className="text-center py-8">
              <i className="fas fa-inbox text-gray-400 text-4xl mb-3"></i>
              <p className="text-muted-foreground">No data sources match the current filters</p>
            </div>
          ) : (
            <div className="relative">
              {filteredSources.length > 3 ? (
                /* Virtual scrolling for large data source lists */
                <div className="text-sm text-muted-foreground mb-3">
                  {filteredSources.length} data sources • Virtual scrolling optimized for agricultural cooperatives
                </div>
              ) : null}
              
              {filteredSources.length > 3 ? (
                <div 
                  {...sourcesVirtual.containerProps}
                  className="overflow-auto border border-border rounded-lg"
                >
                  <div {...sourcesVirtual.innerProps}>
                    {sourcesVirtual.virtualItems.map((virtualItem) => {
                      const source = filteredSources[virtualItem.index];
                      if (!source) return null;
                      
                      return (
                        <div
                          key={virtualItem.key}
                          data-testid={`source-${source.id}`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: virtualItem.size,
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                          className="p-4 border-b border-border last:border-b-0 bg-background hover:bg-muted/30 transition-colors duration-150"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start space-x-3 flex-1">
                              <div className={`w-3 h-3 rounded-full ${getStatusColor(source.status)} mt-2`}></div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2 mb-1">
                                  <h4 className="font-medium text-foreground">{source.name}</h4>
                                  <Badge className={getStatusBadgeColor(source.status)}>
                                    {source.status}
                                  </Badge>
                                  <Badge variant="outline">
                                    {source.type}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground mb-2">
                                  {source.region} • Last updated: {formatLastUpdate(source.lastUpdate)}
                                </p>
                                <div className="flex items-center space-x-4 text-sm">
                                  <span className="text-muted-foreground">
                                    {source.totalRecords.toLocaleString('vi-VN')} records
                                  </span>
                                  <span className="text-muted-foreground">
                                    {source.monthlyUpdates} updates/month
                                  </span>
                                  <span className="text-muted-foreground">
                                    {source.commodities.length} commodities
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-4">
                              <div className="text-right">
                                <div className={`text-lg font-bold ${getTrustScoreColor(source.trustScore)}`}>
                                  {source.trustScore.toFixed(1)}%
                                </div>
                                <div className="text-xs text-muted-foreground">Trust Score</div>
                              </div>
                              <Button 
                                variant="outline" 
                                size="sm"
                                data-testid={`button-configure-${source.id}`}
                              >
                                Configure
                              </Button>
                            </div>
                          </div>

                          {/* Quality Metrics */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-muted-foreground">Accuracy</span>
                                <span className="text-xs font-medium">{source.qualityMetrics.accuracy}%</span>
                              </div>
                              <Progress value={source.qualityMetrics.accuracy} className="h-2" />
                            </div>
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-muted-foreground">Completeness</span>
                                <span className="text-xs font-medium">{source.qualityMetrics.completeness}%</span>
                              </div>
                              <Progress value={source.qualityMetrics.completeness} className="h-2" />
                            </div>
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-muted-foreground">Consistency</span>
                                <span className="text-xs font-medium">{source.qualityMetrics.consistency}%</span>
                              </div>
                              <Progress value={source.qualityMetrics.consistency} className="h-2" />
                            </div>
                            <div>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs text-muted-foreground">Timeliness</span>
                                <span className="text-xs font-medium">{source.qualityMetrics.timeliness}%</span>
                              </div>
                              <Progress value={source.qualityMetrics.timeliness} className="h-2" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Performance indicator for development */}
                  {process.env.NODE_ENV === 'development' && (
                    <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                      Virtual: {sourcesVirtual.virtualItems.length} / {filteredSources.length} sources
                    </div>
                  )}
                </div>
              ) : (
                /* Regular rendering for small lists */
                <div className="space-y-4">
                  {filteredSources.map((source) => (
                    <div 
                      key={source.id}
                      className="p-4 border border-border rounded-lg hover:bg-muted/30 transition-colors duration-150"
                      data-testid={`source-${source.id}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(source.status)} mt-2`}></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              <h4 className="font-medium text-foreground">{source.name}</h4>
                              <Badge className={getStatusBadgeColor(source.status)}>
                                {source.status}
                              </Badge>
                              <Badge variant="outline">
                                {source.type}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {source.region} • Last updated: {formatLastUpdate(source.lastUpdate)}
                            </p>
                            <div className="flex items-center space-x-4 text-sm">
                              <span className="text-muted-foreground">
                                {source.totalRecords.toLocaleString('vi-VN')} records
                              </span>
                              <span className="text-muted-foreground">
                                {source.monthlyUpdates} updates/month
                              </span>
                              <span className="text-muted-foreground">
                                {source.commodities.length} commodities
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-4">
                          <div className="text-right">
                            <div className={`text-lg font-bold ${getTrustScoreColor(source.trustScore)}`}>
                              {source.trustScore.toFixed(1)}%
                            </div>
                            <div className="text-xs text-muted-foreground">Trust Score</div>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            data-testid={`button-configure-${source.id}`}
                          >
                            Configure
                          </Button>
                        </div>
                      </div>

                      {/* Quality Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs text-muted-foreground">Accuracy</span>
                            <span className="text-xs font-medium">{source.qualityMetrics.accuracy}%</span>
                          </div>
                          <Progress value={source.qualityMetrics.accuracy} className="h-2" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs text-muted-foreground">Completeness</span>
                            <span className="text-xs font-medium">{source.qualityMetrics.completeness}%</span>
                          </div>
                          <Progress value={source.qualityMetrics.completeness} className="h-2" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs text-muted-foreground">Consistency</span>
                            <span className="text-xs font-medium">{source.qualityMetrics.consistency}%</span>
                          </div>
                          <Progress value={source.qualityMetrics.consistency} className="h-2" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs text-muted-foreground">Timeliness</span>
                            <span className="text-xs font-medium">{source.qualityMetrics.timeliness}%</span>
                          </div>
                          <Progress value={source.qualityMetrics.timeliness} className="h-2" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quality Summary */}
      <Card className="mt-6" data-testid="card-quality-summary">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <i className="fas fa-chart-line text-green-500"></i>
            <span>Data Quality Overview</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 mb-1">94.7%</div>
              <div className="text-sm text-muted-foreground mb-2">Overall Accuracy</div>
              <Progress value={94.7} className="h-2" />
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 mb-1">91.8%</div>
              <div className="text-sm text-muted-foreground mb-2">Data Completeness</div>
              <Progress value={91.8} className="h-2" />
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 mb-1">89.5%</div>
              <div className="text-sm text-muted-foreground mb-2">Consistency Score</div>
              <Progress value={89.5} className="h-2" />
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600 mb-1">86.2%</div>
              <div className="text-sm text-muted-foreground mb-2">Timeliness Rating</div>
              <Progress value={86.2} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}