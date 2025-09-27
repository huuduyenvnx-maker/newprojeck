/**
 * Export Configuration Modal for Vietnamese Agricultural Market Data
 * Allows users to configure export filters and options
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Filter, FileText, Settings2 } from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useCommodities, useRegions } from '@/hooks/use-forecasts';
import type { ExportFilters } from '@/hooks/use-export';

const exportConfigSchema = z.object({
  exportType: z.enum(['market-data', 'forecasts', 'price-history']),
  format: z.enum(['csv', 'xlsx']),
  commodityIds: z.array(z.string()).optional(),
  regionIds: z.array(z.string()).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
  includeVerifications: z.boolean().default(true),
  includeRecommendations: z.boolean().default(true),
  chunkSize: z.number().min(100).max(10000).default(5000),
  
  // Market Data specific options
  includePriceHistory: z.boolean().default(true),
  includeSeasonalData: z.boolean().default(false),
  includeWeatherImpact: z.boolean().default(false),
  groupByRegion: z.boolean().default(false),
  groupByCommodity: z.boolean().default(false),
  
  // Forecast specific options
  includeMetrics: z.boolean().default(true),
  includePredictionIntervals: z.boolean().default(true),
  includeLlmAnalysis: z.boolean().default(true),
  forecastHorizon: z.number().min(1).max(365).default(30),
  
  // Price History specific options
  includeRawData: z.boolean().default(false),
  includeVerifiedOnly: z.boolean().default(true),
  aggregationPeriod: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  includeTrends: z.boolean().default(false)
});

type ExportConfigForm = z.infer<typeof exportConfigSchema>;

interface ExportConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: ExportConfigForm) => void;
  initialType?: 'market-data' | 'forecasts' | 'price-history';
  initialFormat?: 'csv' | 'xlsx';
  defaultCommodityId?: string;
  defaultRegionId?: string;
}

export default function ExportConfigModal({
  isOpen,
  onClose,
  onExport,
  initialType = 'market-data',
  initialFormat = 'csv',
  defaultCommodityId,
  defaultRegionId
}: ExportConfigModalProps) {
  const { data: commodities = [] } = useCommodities();
  const { data: regions = [] } = useRegions();
  const [selectedCommodities, setSelectedCommodities] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);

  const form = useForm<ExportConfigForm>({
    resolver: zodResolver(exportConfigSchema),
    defaultValues: {
      exportType: initialType,
      format: initialFormat,
      commodityIds: defaultCommodityId ? [defaultCommodityId] : [],
      regionIds: defaultRegionId ? [defaultRegionId] : [],
      includeVerifications: true,
      includeRecommendations: true,
      chunkSize: 5000,
      includePriceHistory: true,
      includeSeasonalData: false,
      includeWeatherImpact: false,
      groupByRegion: false,
      groupByCommodity: false,
      includeMetrics: true,
      includePredictionIntervals: true,
      includeLlmAnalysis: true,
      forecastHorizon: 30,
      includeRawData: false,
      includeVerifiedOnly: true,
      aggregationPeriod: 'daily',
      includeTrends: false
    }
  });

  const exportType = form.watch('exportType');
  const format = form.watch('format');

  // Initialize selected items from default values
  useEffect(() => {
    if (defaultCommodityId) {
      setSelectedCommodities([defaultCommodityId]);
      form.setValue('commodityIds', [defaultCommodityId]);
    }
    if (defaultRegionId) {
      setSelectedRegions([defaultRegionId]);
      form.setValue('regionIds', [defaultRegionId]);
    }
  }, [defaultCommodityId, defaultRegionId, form]);

  const handleCommodityToggle = (commodityId: string) => {
    const newSelection = selectedCommodities.includes(commodityId)
      ? selectedCommodities.filter(id => id !== commodityId)
      : [...selectedCommodities, commodityId];
    
    setSelectedCommodities(newSelection);
    form.setValue('commodityIds', newSelection);
  };

  const handleRegionToggle = (regionId: string) => {
    const newSelection = selectedRegions.includes(regionId)
      ? selectedRegions.filter(id => id !== regionId)
      : [...selectedRegions, regionId];
    
    setSelectedRegions(newSelection);
    form.setValue('regionIds', newSelection);
  };

  const onSubmit = (data: ExportConfigForm) => {
    onExport(data);
    onClose();
  };

  const getExportTypeDescription = (type: string) => {
    switch (type) {
      case 'market-data':
        return 'Xuất dữ liệu giá cả, khối lượng và chất lượng thị trường';
      case 'forecasts':
        return 'Xuất kết quả dự báo 30 ngày với xác minh AI';
      case 'price-history':
        return 'Xuất lịch sử giá đã xác minh với xu hướng';
      default:
        return '';
    }
  };

  const getFormatDescription = (format: string) => {
    switch (format) {
      case 'csv':
        return 'Tệp CSV tương thích với Excel và công cụ phân tích';
      case 'xlsx':
        return 'Tệp Excel với biểu đồ và định dạng cho hợp tác xã';
      default:
        return '';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" data-testid="modal-export-config">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Settings2 className="w-5 h-5" />
            Cấu Hình Xuất Dữ Liệu Nông Nghiệp
          </DialogTitle>
          <DialogDescription>
            Thiết lập các tùy chọn và bộ lọc cho việc xuất dữ liệu thị trường nông sản Việt Nam
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Export Type & Format */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="exportType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loại Xuất Dữ Liệu</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-export-type">
                          <SelectValue placeholder="Chọn loại dữ liệu" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="market-data">Dữ liệu thị trường</SelectItem>
                        <SelectItem value="forecasts">Kết quả dự báo</SelectItem>
                        <SelectItem value="price-history">Lịch sử giá cả</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      {getExportTypeDescription(exportType)}
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="format"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Định Dạng Tệp</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-export-format">
                          <SelectValue placeholder="Chọn định dạng" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="csv">CSV</SelectItem>
                        <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      {getFormatDescription(format)}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Commodity Selection */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                <FormLabel>Nông Sản ({selectedCommodities.length} đã chọn)</FormLabel>
              </div>
              <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto border rounded-md p-3">
                {commodities.map((commodity) => (
                  <div key={commodity.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`commodity-${commodity.id}`}
                      checked={selectedCommodities.includes(commodity.id)}
                      onCheckedChange={() => handleCommodityToggle(commodity.id)}
                      data-testid={`checkbox-commodity-${commodity.id}`}
                    />
                    <label
                      htmlFor={`commodity-${commodity.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {commodity.name}
                    </label>
                  </div>
                ))}
              </div>
              {selectedCommodities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedCommodities.map((id) => {
                    const commodity = commodities.find(c => c.id === id);
                    return commodity ? (
                      <Badge key={id} variant="secondary" className="text-xs">
                        {commodity.name}
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {/* Region Selection */}
            <div className="space-y-3">
              <FormLabel>Khu Vực ({selectedRegions.length} đã chọn)</FormLabel>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto border rounded-md p-3">
                {regions.map((region) => (
                  <div key={region.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`region-${region.id}`}
                      checked={selectedRegions.includes(region.id)}
                      onCheckedChange={() => handleRegionToggle(region.id)}
                      data-testid={`checkbox-region-${region.id}`}
                    />
                    <label
                      htmlFor={`region-${region.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {region.name}
                    </label>
                  </div>
                ))}
              </div>
              {selectedRegions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedRegions.map((id) => {
                    const region = regions.find(r => r.id === id);
                    return region ? (
                      <Badge key={id} variant="secondary" className="text-xs">
                        {region.name}
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Ngày Bắt Đầu</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                            data-testid="date-picker-start"
                          >
                            {field.value ? (
                              format(field.value, 'dd/MM/yyyy', { locale: vi })
                            ) : (
                              <span>Chọn ngày bắt đầu</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date('1900-01-01')
                          }
                          initialFocus
                          locale={vi}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription className="text-xs">
                      Để trống để xuất tất cả dữ liệu lịch sử
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Ngày Kết Thúc</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                            data-testid="date-picker-end"
                          >
                            {field.value ? (
                              format(field.value, 'dd/MM/yyyy', { locale: vi })
                            ) : (
                              <span>Chọn ngày kết thúc</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date('1900-01-01')
                          }
                          initialFocus
                          locale={vi}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription className="text-xs">
                      Để trống để xuất đến ngày hiện tại
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Price Range */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="minPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Giá Tối Thiểu (USD)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0"
                        min="0"
                        step="0.01"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        data-testid="input-min-price"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Để trống để không giới hạn giá thấp
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Giá Tối Đa (USD)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Không giới hạn"
                        min="0"
                        step="0.01"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        data-testid="input-max-price"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Để trống để không giới hạn giá cao
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Type-specific Options */}
            {exportType === 'market-data' && (
              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Tùy Chọn Dữ Liệu Thị Trường</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includePriceHistory"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Bao gồm lịch sử giá</FormLabel>
                          <FormDescription className="text-xs">
                            Xuất dữ liệu giá lịch sử chi tiết
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeSeasonalData"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Dữ liệu theo mùa vụ</FormLabel>
                          <FormDescription className="text-xs">
                            Phân tích tác động mùa vụ
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeWeatherImpact"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Tác động thời tiết</FormLabel>
                          <FormDescription className="text-xs">
                            Phân tích ảnh hưởng của thời tiết
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="groupByRegion"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Nhóm theo khu vực</FormLabel>
                          <FormDescription className="text-xs">
                            Tách dữ liệu theo từng khu vực
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            {exportType === 'forecasts' && (
              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Tùy Chọn Dự Báo</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeMetrics"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Chỉ số chất lượng</FormLabel>
                          <FormDescription className="text-xs">
                            MASE, SMAPE, PICP, FQS scores
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeLlmAnalysis"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Phân tích AI</FormLabel>
                          <FormDescription className="text-xs">
                            Kết quả xác minh OpenAI + Gemini
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeRecommendations"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Khuyến nghị giao dịch</FormLabel>
                          <FormDescription className="text-xs">
                            Hành động mua/bán và phân tích rủi ro
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="forecastHorizon"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Thời hạn dự báo (ngày)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            max="365"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                            data-testid="input-forecast-horizon"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Số ngày dự báo từ 1-365 ngày
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            <Separator />

            {/* Performance Options */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold">Tùy Chọn Hiệu Suất</h4>
              <FormField
                control={form.control}
                name="chunkSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kích Thước Chunk</FormLabel>
                    <FormControl>
                      <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString()}>
                        <SelectTrigger data-testid="select-chunk-size">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1000">1,000 bản ghi (Nhanh)</SelectItem>
                          <SelectItem value="5000">5,000 bản ghi (Cân bằng)</SelectItem>
                          <SelectItem value="10000">10,000 bản ghi (Tối ưu bộ nhớ)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription className="text-xs">
                      Kích thước chunk ảnh hưởng đến tốc độ và sử dụng bộ nhớ
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-config">
                Hủy
              </Button>
              <Button type="submit" data-testid="button-start-export">
                <FileText className="w-4 h-4 mr-2" />
                Bắt Đầu Xuất Dữ Liệu
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}