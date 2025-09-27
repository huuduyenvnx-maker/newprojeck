/**
 * Export Button Component with Vietnamese Agricultural Market Context
 * Provides dropdown for CSV/Excel format selection and export options
 */

import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import useExport from '@/hooks/use-export';

interface ExportButtonProps {
  onExport: (format: 'csv' | 'xlsx', type: 'market-data' | 'forecasts' | 'price-history') => void;
  onConfigure: () => void;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  showActiveCount?: boolean;
  className?: string;
}

export default function ExportButton({
  onExport,
  onConfigure,
  disabled = false,
  size = 'default',
  variant = 'outline',
  showActiveCount = true,
  className = ''
}: ExportButtonProps) {
  const { t } = useTranslation();
  const { hasActiveExports, activeJobs, activeJobsCount } = useExport();

  const handleExportClick = (format: 'csv' | 'xlsx', type: 'market-data' | 'forecasts' | 'price-history') => {
    onExport(format, type);
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled}
            className={`${className} relative`}
            data-testid="button-export-dropdown"
          >
            <Download className="w-4 h-4 mr-2" />
            Xuất Dữ Liệu
            {showActiveCount && hasActiveExports && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {activeJobsCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          <DropdownMenuLabel className="font-semibold text-sm">
            Xuất Dữ Liệu Nông Nghiệp
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {/* Market Data Export */}
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Dữ Liệu Thị Trường
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => handleExportClick('csv', 'market-data')}
            className="flex items-center gap-3"
            data-testid="export-market-data-csv"
          >
            <FileText className="w-4 h-4 text-green-600" />
            <div className="flex flex-col">
              <span className="font-medium">CSV - Dữ liệu thị trường</span>
              <span className="text-xs text-muted-foreground">
                Giá, khối lượng, chất lượng theo thời gian
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleExportClick('xlsx', 'market-data')}
            className="flex items-center gap-3"
            data-testid="export-market-data-xlsx"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            <div className="flex flex-col">
              <span className="font-medium">Excel - Dữ liệu thị trường</span>
              <span className="text-xs text-muted-foreground">
                Với biểu đồ và phân tích cho hợp tác xã
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Forecast Results Export */}
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Kết Quả Dự Báo
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => handleExportClick('csv', 'forecasts')}
            className="flex items-center gap-3"
            data-testid="export-forecasts-csv"
          >
            <FileText className="w-4 h-4 text-purple-600" />
            <div className="flex flex-col">
              <span className="font-medium">CSV - Dự báo 30 ngày</span>
              <span className="text-xs text-muted-foreground">
                Với xác minh AI và khuyến nghị giao dịch
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleExportClick('xlsx', 'forecasts')}
            className="flex items-center gap-3"
            data-testid="export-forecasts-xlsx"
          >
            <FileSpreadsheet className="w-4 h-4 text-purple-600" />
            <div className="flex flex-col">
              <span className="font-medium">Excel - Báo cáo dự báo</span>
              <span className="text-xs text-muted-foreground">
                Phân tích chất lượng và độ tin cậy
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Price History Export */}
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Lịch Sử Giá Cả
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => handleExportClick('csv', 'price-history')}
            className="flex items-center gap-3"
            data-testid="export-price-history-csv"
          >
            <FileText className="w-4 h-4 text-orange-600" />
            <div className="flex flex-col">
              <span className="font-medium">CSV - Lịch sử giá</span>
              <span className="text-xs text-muted-foreground">
                Dữ liệu đã xác minh với xu hướng
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleExportClick('xlsx', 'price-history')}
            className="flex items-center gap-3"
            data-testid="export-price-history-xlsx"
          >
            <FileSpreadsheet className="w-4 h-4 text-orange-600" />
            <div className="flex flex-col">
              <span className="font-medium">Excel - Phân tích xu hướng</span>
              <span className="text-xs text-muted-foreground">
                Với biểu đồ giá theo mùa vụ
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Configure Export */}
          <DropdownMenuItem
            onClick={onConfigure}
            className="flex items-center gap-3"
            data-testid="export-configure"
          >
            <Settings className="w-4 h-4 text-gray-600" />
            <div className="flex flex-col">
              <span className="font-medium">Cấu hình xuất dữ liệu</span>
              <span className="text-xs text-muted-foreground">
                Thiết lập bộ lọc và tùy chọn
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      
      {/* Active Export Indicator */}
      {hasActiveExports && (
        <div className="flex items-center text-sm text-muted-foreground">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2"></div>
          Đang xuất {activeJobsCount} tệp
        </div>
      )}
    </div>
  );
}