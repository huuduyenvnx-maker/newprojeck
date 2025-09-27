import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Alert } from "@/types/forecast";

export default function Sidebar() {
  const [location] = useLocation();
  const { t } = useTranslation();
  
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const unacknowledgedAlerts = alerts.filter(alert => !alert.acknowledged);
  const highPriorityAlerts = unacknowledgedAlerts.filter(alert => alert.severity === "high");

  const navItems = [
    {
      path: "/market-explorer",
      icon: "fas fa-chart-line",
      label: t('nav.marketExplorer'),
      testId: "nav-market-explorer"
    },
    {
      path: "/watchlist",
      icon: "fas fa-star",
      label: t('nav.watchlist'),
      testId: "nav-watchlist"
    },
    {
      path: "/reliability",
      icon: "fas fa-shield-check",
      label: t('nav.reliability'),
      testId: "nav-reliability"
    },
    {
      path: "/alerts",
      icon: "fas fa-bell",
      label: t('nav.alerts'),
      badge: unacknowledgedAlerts.length,
      testId: "nav-alerts"
    },
    {
      path: "/daily-brief",
      icon: "fas fa-newspaper",
      label: t('nav.dailyBrief'),
      testId: "nav-daily-brief"
    },
  ];

  const adminItems = [
    {
      path: "/admin/review-queue",
      icon: "fas fa-tasks",
      label: t('nav.reviewQueue'),
      badge: highPriorityAlerts.length,
      testId: "nav-review-queue"
    },
    {
      path: "/admin/data-sources",
      icon: "fas fa-database",
      label: t('nav.dataSources'),
      testId: "nav-data-sources"
    },
    {
      path: "/admin/analytics",
      icon: "fas fa-chart-bar",
      label: t('nav.analytics'),
      testId: "nav-analytics"
    },
  ];

  return (
    <aside 
      className="w-64 bg-card border-r border-border"
      role="navigation"
      aria-label={t('accessibility.sidebarNavigation', 'Sidebar navigation')}
    >
      <nav className="p-4 space-y-1" aria-label={t('accessibility.mainNavigation', 'Main navigation')}>
        {navItems.map((item) => (
          <Link 
            key={item.path} 
            href={item.path}
            className={`nav-item ${location === item.path || (item.path === "/market-explorer" && location === "/") ? "active" : ""}`}
            data-testid={item.testId}
          >
            <i className={item.icon}></i>
            <span>{item.label}</span>
            {item.badge && item.badge > 0 && (
              <span className="ml-auto bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded-full">
                {item.badge}
              </span>
            )}
          </Link>
        ))}
        
        <div className="pt-4 mt-4 border-t border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {t('nav.admin', 'Admin')}
          </h3>
          {adminItems.map((item) => (
            <Link 
              key={item.path} 
              href={item.path}
              className={`nav-item ${location === item.path ? "active" : ""}`}
              data-testid={item.testId}
            >
              <i className={item.icon}></i>
              <span>{item.label}</span>
              {item.badge && item.badge > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-xs px-2 py-1 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </aside>
  );
}
