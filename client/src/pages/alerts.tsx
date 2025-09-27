import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useSimpleVirtualList } from "@/hooks/useVirtualList";
import type { Alert } from "@/types/forecast";

export default function Alerts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: alerts = [], isLoading } = useQuery<Alert[]>({
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
        title: "Alert Acknowledged",
        description: "Alert has been marked as acknowledged",
      });
    },
  });

  // Memoize helper functions for performance optimization
  const getAlertIcon = useMemo(() => (type: string) => {
    switch (type) {
      case "price_anomaly": return "fas fa-exclamation-triangle text-red-500";
      case "quality_warning": return "fas fa-chart-line text-amber-500";
      case "model_update": return "fas fa-info-circle text-blue-500";
      default: return "fas fa-bell text-gray-500";
    }
  }, []);

  const getAlertColor = useMemo(() => (severity: string) => {
    switch (severity) {
      case "high": return "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800";
      case "medium": return "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800";
      case "low": return "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800";
      default: return "bg-gray-50 border-gray-200 dark:bg-gray-950 dark:border-gray-800";
    }
  }, []);

  const getSeverityColor = useMemo(() => (severity: string) => {
    switch (severity) {
      case "high": return "text-red-800 dark:text-red-200";
      case "medium": return "text-amber-800 dark:text-amber-200";
      case "low": return "text-blue-800 dark:text-blue-200";
      default: return "text-gray-800 dark:text-gray-200";
    }
  }, []);

  const getTimeAgo = useMemo(() => (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Less than 1 hour ago";
    if (diffInHours === 1) return "1 hour ago";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  const unacknowledgedAlerts = useMemo(() => 
    alerts.filter(alert => !alert.acknowledged), 
    [alerts]
  );
  const acknowledgedAlerts = useMemo(() => 
    alerts.filter(alert => alert.acknowledged), 
    [alerts]
  );

  // Virtual scrolling for active alerts
  const activeAlertsVirtual = useSimpleVirtualList(
    unacknowledgedAlerts,
    Math.min(400, unacknowledgedAlerts.length * 120), // Dynamic height based on content
    120, // Alert card height
    5 // Conservative overscan for rural internet
  );

  // Virtual scrolling for acknowledged alerts (limited to recent ones)
  const recentAcknowledgedAlerts = useMemo(() => 
    acknowledgedAlerts.slice(0, 20), // Show more acknowledged alerts with virtual scrolling
    [acknowledgedAlerts]
  );
  const acknowledgedAlertsVirtual = useSimpleVirtualList(
    recentAcknowledgedAlerts,
    Math.min(300, recentAcknowledgedAlerts.length * 100),
    100,
    3
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
          Alerts Management
        </h2>
        <p className="text-muted-foreground">
          Monitor and manage system alerts for price anomalies, forecast quality, and model updates
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Active Alerts</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-active-alerts">
                {unacknowledgedAlerts.length}
              </p>
            </div>
            <i className="fas fa-bell text-red-500 text-2xl"></i>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">High Priority</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-high-priority-alerts">
                {unacknowledgedAlerts.filter(a => a.severity === "high").length}
              </p>
            </div>
            <i className="fas fa-exclamation-triangle text-red-500 text-2xl"></i>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Acknowledged</p>
              <p className="text-2xl font-bold text-foreground" data-testid="text-acknowledged-alerts">
                {acknowledgedAlerts.length}
              </p>
            </div>
            <i className="fas fa-check-circle text-green-500 text-2xl"></i>
          </div>
        </div>
      </div>

      {/* Active Alerts with Virtual Scrolling */}
      {unacknowledgedAlerts.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-foreground">Active Alerts</h3>
            <div className="text-sm text-muted-foreground">
              {unacknowledgedAlerts.length} alerts • Virtual scrolling enabled
            </div>
          </div>
          
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {unacknowledgedAlerts.length > 5 ? (
              /* Virtual scrolling for large alert lists */
              <div 
                {...activeAlertsVirtual.containerProps}
                className="overflow-auto"
              >
                <div {...activeAlertsVirtual.innerProps}>
                  {activeAlertsVirtual.virtualItems.map((virtualItem) => {
                    const alert = unacknowledgedAlerts[virtualItem.index];
                    if (!alert) return null;
                    
                    return (
                      <div
                        key={virtualItem.key}
                        data-testid={`alert-${alert.type}-${alert.id}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtualItem.size,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className={`p-4 border-b border-border ${getAlertColor(alert.severity)} hover:bg-opacity-80 transition-colors duration-150`}
                      >
                        <div className="flex items-start justify-between h-full">
                          <div className="flex items-start space-x-3 flex-1">
                            <i className={getAlertIcon(alert.type)}></i>
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                <h4 className={`font-medium ${getSeverityColor(alert.severity)}`}>
                                  {alert.title}
                                </h4>
                                <span className={`text-xs px-2 py-1 rounded-full ${
                                  alert.severity === "high" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100" :
                                  alert.severity === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100" :
                                  "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                                }`}>
                                  {alert.severity.toUpperCase()}
                                </span>
                              </div>
                              <p className={`text-sm ${getSeverityColor(alert.severity)} mb-2 line-clamp-2`}>
                                {alert.message}
                              </p>
                              <span className="text-xs text-muted-foreground">
                                {getTimeAgo(alert.createdAt)}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => acknowledgeAlert.mutate(alert.id)}
                            disabled={acknowledgeAlert.isPending}
                            data-testid={`button-acknowledge-${alert.id}`}
                          >
                            {acknowledgeAlert.isPending ? "..." : "Acknowledge"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Performance indicator for development */}
                {process.env.NODE_ENV === 'development' && (
                  <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                    Virtual: {activeAlertsVirtual.virtualItems.length} / {unacknowledgedAlerts.length} alerts
                  </div>
                )}
              </div>
            ) : (
              /* Regular rendering for small lists */
              <div className="space-y-0">
                {unacknowledgedAlerts.map((alert) => (
                  <div 
                    key={alert.id}
                    className={`p-4 border-b border-border last:border-b-0 ${getAlertColor(alert.severity)} hover:bg-opacity-80 transition-colors duration-150`}
                    data-testid={`alert-${alert.type}-${alert.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <i className={getAlertIcon(alert.type)}></i>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className={`font-medium ${getSeverityColor(alert.severity)}`}>
                              {alert.title}
                            </h4>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              alert.severity === "high" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100" :
                              alert.severity === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100" :
                              "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                            }`}>
                              {alert.severity.toUpperCase()}
                            </span>
                          </div>
                          <p className={`text-sm ${getSeverityColor(alert.severity)} mb-2`}>
                            {alert.message}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {getTimeAgo(alert.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => acknowledgeAlert.mutate(alert.id)}
                        disabled={acknowledgeAlert.isPending}
                        data-testid={`button-acknowledge-${alert.id}`}
                      >
                        {acknowledgeAlert.isPending ? "..." : "Acknowledge"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No Active Alerts */}
      {unacknowledgedAlerts.length === 0 && (
        <div className="text-center py-12">
          <i className="fas fa-check-circle text-green-500 text-6xl mb-4"></i>
          <h3 className="text-xl font-semibold text-foreground mb-2">No Active Alerts</h3>
          <p className="text-muted-foreground">All alerts have been acknowledged or resolved.</p>
        </div>
      )}

      {/* Recently Acknowledged with Virtual Scrolling */}
      {acknowledgedAlerts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-foreground">Recently Acknowledged</h3>
            <div className="text-sm text-muted-foreground">
              Showing {recentAcknowledgedAlerts.length} of {acknowledgedAlerts.length} acknowledged
            </div>
          </div>
          
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {recentAcknowledgedAlerts.length > 8 ? (
              /* Virtual scrolling for large acknowledged lists */
              <div 
                {...acknowledgedAlertsVirtual.containerProps}
                className="overflow-auto"
              >
                <div {...acknowledgedAlertsVirtual.innerProps}>
                  {acknowledgedAlertsVirtual.virtualItems.map((virtualItem) => {
                    const alert = recentAcknowledgedAlerts[virtualItem.index];
                    if (!alert) return null;
                    
                    return (
                      <div
                        key={virtualItem.key}
                        data-testid={`acknowledged-alert-${alert.id}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtualItem.size,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className="p-4 border-b border-border last:border-b-0 bg-muted/30 opacity-70 hover:opacity-80 transition-opacity duration-150"
                      >
                        <div className="flex items-start space-x-3">
                          <i className={`${getAlertIcon(alert.type)} opacity-60`}></i>
                          <div className="flex-1">
                            <h4 className="font-medium text-muted-foreground">{alert.title}</h4>
                            <p className="text-sm text-muted-foreground mb-1 line-clamp-2">{alert.message}</p>
                            <span className="text-xs text-muted-foreground/70">
                              Acknowledged • {getTimeAgo(alert.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Regular rendering for small acknowledged lists */
              <div className="space-y-0">
                {recentAcknowledgedAlerts.map((alert) => (
                  <div 
                    key={alert.id}
                    className="p-4 border-b border-border last:border-b-0 bg-muted/30 opacity-70 hover:opacity-80 transition-opacity duration-150"
                    data-testid={`acknowledged-alert-${alert.id}`}
                  >
                    <div className="flex items-start space-x-3">
                      <i className={`${getAlertIcon(alert.type)} opacity-60`}></i>
                      <div className="flex-1">
                        <h4 className="font-medium text-muted-foreground">{alert.title}</h4>
                        <p className="text-sm text-muted-foreground mb-1">{alert.message}</p>
                        <span className="text-xs text-muted-foreground/70">
                          Acknowledged • {getTimeAgo(alert.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
