import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { calculateCCS, getConfidenceLevel } from "@/hooks/use-llm-verification";
import type { Forecast, Alert } from "@/types/forecast";
import { useState } from "react";

export default function ReviewQueue() {
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: forecasts = [], isLoading: forecastsLoading } = useQuery<Forecast[]>({
    queryKey: ["/api/forecasts", "all"],
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const response = await apiRequest("PATCH", `/api/alerts/${alertId}/acknowledge`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({
        title: "Alert Reviewed",
        description: "Alert has been acknowledged and marked as reviewed",
      });
    },
  });

  // Filter forecasts that need review (low CCS or missing verifications)
  const forecastsNeedingReview = forecasts.filter(forecast => {
    const ccs = forecast.verifications ? calculateCCS(forecast.verifications) : 0;
    return ccs < 0.7 || !forecast.verifications || forecast.verifications.length === 0;
  });

  // Filter alerts based on selected criteria
  const filteredAlerts = alerts.filter(alert => {
    if (filterStatus !== "all") {
      if (filterStatus === "unacknowledged" && alert.acknowledged) return false;
      if (filterStatus === "acknowledged" && !alert.acknowledged) return false;
    }
    if (filterSeverity !== "all" && alert.severity !== filterSeverity) return false;
    return true;
  });

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "price_anomaly": return "fas fa-exclamation-triangle text-red-500";
      case "quality_warning": return "fas fa-chart-line text-amber-500";
      case "model_update": return "fas fa-info-circle text-blue-500";
      default: return "fas fa-bell text-gray-500";
    }
  };

  const getAlertColor = (severity: string) => {
    switch (severity) {
      case "high": return "bg-red-50 border-red-200";
      case "medium": return "bg-amber-50 border-amber-200";
      case "low": return "bg-blue-50 border-blue-200";
      default: return "bg-gray-50 border-gray-200";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "text-red-800";
      case "medium": return "text-amber-800";
      case "low": return "text-blue-800";
      default: return "text-gray-800";
    }
  };

  if (forecastsLoading || alertsLoading) {
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
          Review Queue
        </h2>
        <p className="text-muted-foreground">
          Review and manage forecasts requiring attention and system alerts
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Forecasts to Review</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-forecasts-review">
                {forecastsNeedingReview.length}
              </p>
            </div>
            <i className="fas fa-chart-line text-amber-500 text-2xl"></i>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pending Alerts</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-pending-alerts">
                {alerts.filter(a => !a.acknowledged).length}
              </p>
            </div>
            <i className="fas fa-bell text-red-500 text-2xl"></i>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">High Priority</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-high-priority">
                {alerts.filter(a => a.severity === "high" && !a.acknowledged).length}
              </p>
            </div>
            <i className="fas fa-exclamation-triangle text-red-500 text-2xl"></i>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Models Updated</p>
              <p className="text-2xl font-bold text-foreground">2</p>
            </div>
            <i className="fas fa-sync text-green-500 text-2xl"></i>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Forecasts Requiring Review */}
        <div className="bg-card border border-border rounded-lg">
          <div className="p-6 border-b border-border">
            <h3 className="text-lg font-semibold text-foreground">
              Forecasts Requiring Review
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Low confidence scores or missing evidence
            </p>
          </div>
          <div className="p-6">
            {forecastsNeedingReview.length === 0 ? (
              <div className="text-center py-8">
                <i className="fas fa-check-circle text-green-500 text-4xl mb-3"></i>
                <p className="text-muted-foreground">All forecasts meet quality standards</p>
              </div>
            ) : (
              <div className="space-y-4">
                {forecastsNeedingReview.slice(0, 5).map((forecast) => {
                  const ccs = forecast.verifications ? calculateCCS(forecast.verifications) : 0;
                  const confidenceLevel = getConfidenceLevel(ccs);
                  
                  return (
                    <div 
                      key={forecast.id}
                      className="p-4 border border-border rounded-lg"
                      data-testid={`forecast-review-${forecast.id}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-medium text-foreground">
                            Forecast #{forecast.id.slice(-6)}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {forecast.method} • {forecast.horizon} days
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            ccs >= 0.8 ? "bg-green-100 text-green-800" :
                            ccs >= 0.6 ? "bg-amber-100 text-amber-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            CCS: {ccs.toFixed(2)} ({confidenceLevel})
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                          Verifications: {forecast.verifications?.length || 0}/2
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid={`button-review-${forecast.id}`}
                        >
                          Review
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Alert Management */}
        <div className="bg-card border border-border rounded-lg">
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Alert Management</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  System alerts requiring attention
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-32" data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="unacknowledged">Pending</SelectItem>
                    <SelectItem value="acknowledged">Reviewed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger className="w-28" data-testid="select-filter-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="p-6">
            {filteredAlerts.length === 0 ? (
              <div className="text-center py-8">
                <i className="fas fa-inbox text-gray-400 text-4xl mb-3"></i>
                <p className="text-muted-foreground">No alerts match the current filters</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredAlerts.map((alert) => (
                  <div 
                    key={alert.id}
                    className={`p-3 border rounded-lg ${getAlertColor(alert.severity)} ${
                      alert.acknowledged ? "opacity-60" : ""
                    }`}
                    data-testid={`alert-review-${alert.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <i className={getAlertIcon(alert.type)}></i>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className={`font-medium ${getSeverityColor(alert.severity)} truncate`}>
                              {alert.title}
                            </h4>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              alert.severity === "high" ? "bg-red-100 text-red-700" :
                              alert.severity === "medium" ? "bg-amber-100 text-amber-700" :
                              "bg-blue-100 text-blue-700"
                            }`}>
                              {alert.severity.toUpperCase()}
                            </span>
                          </div>
                          <p className={`text-xs ${getSeverityColor(alert.severity)} mb-1`}>
                            {alert.message}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {new Date(alert.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {!alert.acknowledged && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => acknowledgeAlert.mutate(alert.id)}
                          disabled={acknowledgeAlert.isPending}
                          data-testid={`button-acknowledge-alert-${alert.id}`}
                        >
                          {acknowledgeAlert.isPending ? "..." : "Review"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mt-6 bg-card border border-border rounded-lg">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Recent Activity</h3>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            <div className="flex items-center space-x-3 text-sm">
              <i className="fas fa-check-circle text-green-500"></i>
              <span className="text-muted-foreground">10:30 AM</span>
              <span className="text-foreground">Forecast #abc123 reviewed and approved</span>
            </div>
            <div className="flex items-center space-x-3 text-sm">
              <i className="fas fa-exclamation-triangle text-amber-500"></i>
              <span className="text-muted-foreground">09:45 AM</span>
              <span className="text-foreground">Price anomaly detected for Rice (Jasmine)</span>
            </div>
            <div className="flex items-center space-x-3 text-sm">
              <i className="fas fa-sync text-blue-500"></i>
              <span className="text-muted-foreground">09:00 AM</span>
              <span className="text-foreground">Model ensemble weights updated</span>
            </div>
            <div className="flex items-center space-x-3 text-sm">
              <i className="fas fa-shield-check text-green-500"></i>
              <span className="text-muted-foreground">08:30 AM</span>
              <span className="text-foreground">Dual-LLM verification completed successfully</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
