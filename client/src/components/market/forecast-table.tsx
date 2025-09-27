import { useMemo, useState } from "react";
import type { Forecast } from "@/types/forecast";
import { useForecastVirtualList } from "@/hooks/useVirtualList";
import { useTranslation } from "react-i18next";
import { formatVietnameseCurrency, formatVietnameseDate } from "@/lib/vietnamese-formatting";
import { Button } from "@/components/ui/button";

interface ForecastTableProps {
  forecast?: Forecast;
  maxHeight?: number; // Allow customizable height
}

export default function ForecastTable({ 
  forecast, 
  maxHeight = 600 // Default height optimized for agricultural data tables
}: ForecastTableProps) {
  const { t, i18n } = useTranslation();
  const [sortColumn, setSortColumn] = useState<'date' | 'median' | 'confidence'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [screenReaderMode, setScreenReaderMode] = useState(false);
  // Memoize helper functions for performance optimization
  const getConfidenceColor = useMemo(() => (confidence: number) => {
    if (confidence >= 0.8) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100";
    if (confidence >= 0.6) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100";
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100";
  }, []);

  const getConfidenceLabel = useMemo(() => (confidence: number) => {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.6) return "Medium";
    return "Low";
  }, []);

  // Memoize virtualized predictions for performance
  const virtualizedPredictions = useMemo(() => {
    if (!forecast?.predictions) return [];
    return forecast.predictions.map((prediction, index) => ({
      id: `prediction-${index}`,
      data: prediction,
      index
    }));
  }, [forecast?.predictions]);

  // Initialize virtual scrolling for agricultural data
  const virtualList = useForecastVirtualList(
    virtualizedPredictions,
    maxHeight - 120, // Account for header and padding
    {
      debug: process.env.NODE_ENV === 'development'
    }
  );

  // Memoized render function for table rows
  const renderRow = useMemo(() => (item: any, virtualItem: any) => {
    const prediction = item.data;
    return (
      <div
        key={virtualItem.key}
        data-testid={`row-forecast-${item.index}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: virtualItem.size,
          transform: `translateY(${virtualItem.start}px)`,
        }}
        className="border-b border-border bg-background hover:bg-muted/50 transition-colors duration-150"
      >
        <div className="grid grid-cols-6 gap-4 px-6 py-4 items-center text-sm">
          <div className="text-foreground font-medium">
            {i18n.language === 'vi' 
              ? formatVietnameseDate(prediction.date, { day: 'numeric', month: 'short', year: 'numeric' })
              : new Date(prediction.date).toLocaleDateString('vi-VN')
            }
          </div>
          <div className="text-foreground font-bold">
            {i18n.language === 'vi' 
              ? formatVietnameseCurrency(prediction.median, 'USD')
              : `$${prediction.median.toFixed(2)}`
            }
          </div>
          <div className="text-muted-foreground">
            {i18n.language === 'vi' 
              ? formatVietnameseCurrency(prediction.q10, 'USD')
              : `$${prediction.q10.toFixed(2)}`
            }
          </div>
          <div className="text-muted-foreground">
            {i18n.language === 'vi' 
              ? formatVietnameseCurrency(prediction.q90, 'USD')
              : `$${prediction.q90.toFixed(2)}`
            }
          </div>
          <div>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(prediction.confidence)}`}>
              {getConfidenceLabel(prediction.confidence)} ({prediction.confidence.toFixed(2)})
            </span>
          </div>
          <div className="text-muted-foreground">
            24,180
          </div>
        </div>
      </div>
    );
  }, [getConfidenceColor, getConfidenceLabel]);

  if (!forecast || !forecast.predictions || forecast.predictions.length === 0) {
    return (
      <div className="mt-6 bg-card border border-border rounded-lg">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Detailed Forecast Data</h3>
        </div>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">No forecast data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 bg-card border border-border rounded-lg" data-testid="forecast-table">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Detailed Forecast Data</h3>
          <div className="text-sm text-muted-foreground">
            {forecast.predictions.length} predictions • Optimized for large datasets
          </div>
        </div>
      </div>

      {/* Virtualized Table */}
      <div className="relative">
        {/* Sticky Header */}
        <div 
          className="sticky top-0 z-10 bg-muted border-b border-border"
          style={virtualList.stickyHeaderProps?.style}
        >
          <div className="grid grid-cols-6 gap-4 px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div>Date</div>
            <div>Median</div>
            <div>Q10 (Low)</div>
            <div>Q90 (High)</div>
            <div>Confidence</div>
            <div>FX Rate</div>
          </div>
        </div>

        {/* Virtual Container */}
        <div 
          {...virtualList.containerProps}
          className="overflow-auto"
          style={{ 
            ...virtualList.containerProps.style,
            maxHeight: maxHeight - 120 
          }}
        >
          <div 
            {...virtualList.innerProps}
            className="relative"
          >
            {virtualList.virtualItems.map((virtualItem) => {
              const item = virtualizedPredictions[virtualItem.index];
              if (!item) return null;
              
              return renderRow(item, virtualItem);
            })}
          </div>
        </div>

        {/* Performance indicator for development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
            Virtual: {virtualList.virtualItems.length} / {virtualizedPredictions.length} rows
          </div>
        )}
      </div>

      {/* Footer with summary */}
      <div className="px-6 py-3 bg-muted/30 text-xs text-muted-foreground border-t border-border">
        <div className="flex justify-between items-center">
          <span>Agricultural forecast data optimized for rural internet connections</span>
          <span>Total predictions: {forecast.predictions.length}</span>
        </div>
      </div>
    </div>
  );
}
