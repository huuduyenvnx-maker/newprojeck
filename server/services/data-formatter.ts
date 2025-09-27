/**
 * Vietnamese Data Formatting Service
 * Handles Vietnamese-specific formatting for currency, dates, and agricultural terminology
 */

export interface VietnameseFormatterOptions {
  currency?: 'VND' | 'USD';
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  locale?: 'vi-VN' | 'en-US';
  includeSymbols?: boolean;
}

export interface ExportMetadata {
  exportDate: Date;
  exportedBy: string;
  recordCount: number;
  filters: any;
  exportFormat: 'csv' | 'xlsx';
}

export class VietnameseDataFormatter {
  private static readonly CURRENCY_SYMBOLS = {
    VND: '₫',
    USD: '$'
  };

  private static readonly VIETNAMESE_REGIONS = {
    'mekong-delta': 'Đồng Bằng Sông Cửu Long',
    'central-highlands': 'Tây Nguyên', 
    'red-river-delta': 'Đồng Bằng Sông Hồng',
    'southeast': 'Đông Nam Bộ',
    'north-central': 'Bắc Trung Bộ',
    'south-central': 'Nam Trung Bộ',
    'north-mountain': 'Vùng Núi Phía Bắc'
  };

  private static readonly VIETNAMESE_COMMODITIES = {
    'rice': 'Gạo',
    'coffee': 'Cà Phê',
    'pepper': 'Tiêu',
    'black-pepper': 'Tiêu Đen',
    'white-pepper': 'Tiêu Trắng',
    'cassava': 'Sắn',
    'sweet-potato': 'Khoai Lang',
    'maize': 'Ngô',
    'rubber': 'Cao Su',
    'fertilizer': 'Phân Bón',
    'tea': 'Chè',
    'coconut': 'Dừa',
    'sugarcane': 'Mía'
  };

  private static readonly EXPORT_HEADERS_VIETNAMESE = {
    // Market Data Headers
    date: 'Ngày',
    commodity: 'Nông Sản',
    region: 'Khu Vực',
    price: 'Giá',
    priceVnd: 'Giá (VND)',
    priceUsd: 'Giá (USD)',
    volume: 'Khối Lượng',
    quality: 'Chất Lượng',
    source: 'Nguồn',
    unit: 'Đơn Vị',
    
    // Forecast Headers
    forecastDate: 'Ngày Dự Báo',
    targetDate: 'Ngày Mục Tiêu',
    medianPrice: 'Giá Trung Bình',
    lowPrice: 'Giá Thấp (Q10)',
    highPrice: 'Giá Cao (Q90)',
    confidence: 'Độ Tin Cậy',
    method: 'Phương Pháp',
    horizon: 'Thời Hạn (Ngày)',
    
    // Quality Metrics
    mase: 'Điểm MASE',
    smape: 'Lỗi SMAPE (%)',
    picp: 'Độ Bao Phủ PICP (%)',
    coverage: 'Phạm Vi Bao Phủ',
    fqs: 'Điểm Chất Lượng FQS',
    
    // LLM Verification
    openaiConfidence: 'Độ Tin Cậy OpenAI',
    geminiConfidence: 'Độ Tin Cậy Gemini',
    agreementScore: 'Điểm Đồng Thuận',
    verificationStatus: 'Trạng Thái Xác Minh',
    
    // Trading Recommendations
    action: 'Hành Động',
    entryPrice: 'Giá Vào',
    targetPrice: 'Giá Mục Tiêu',
    stopLoss: 'Cắt Lỗ',
    riskLevel: 'Mức Rủi Ro',
    reasoning: 'Lý Do',
    
    // Seasonal & Regional
    season: 'Mùa Vụ',
    harvestPeriod: 'Thời Kỳ Thu Hoạch',
    plantingPeriod: 'Thời Kỳ Gieo Trồng',
    monsoonImpact: 'Tác Động Mùa Mưa',
    weatherCondition: 'Điều Kiện Thời Tiết',
    
    // Export Metadata
    exportDate: 'Ngày Xuất',
    exportedBy: 'Người Xuất',
    recordCount: 'Số Bản Ghi',
    filters: 'Bộ Lọc',
    notes: 'Ghi Chú'
  };

  private static readonly TRADING_ACTIONS_VIETNAMESE = {
    'buy': 'Mua',
    'sell': 'Bán', 
    'hold': 'Giữ',
    'monitor': 'Theo Dõi'
  };

  private static readonly RISK_LEVELS_VIETNAMESE = {
    'low': 'Thấp',
    'medium': 'Trung Bình',
    'high': 'Cao'
  };

  private static readonly SEASONAL_PERIODS = {
    'monsoon': 'Mùa Mưa',
    'dry': 'Mùa Khô',
    'harvest': 'Mùa Thu Hoạch',
    'planting': 'Mùa Gieo Trồng',
    'spring': 'Xuân',
    'summer': 'Hạ', 
    'autumn': 'Thu',
    'winter': 'Đông'
  };

  /**
   * Format currency with Vietnamese locale
   */
  static formatCurrency(
    amount: number, 
    currency: 'VND' | 'USD' = 'VND',
    options: { includeSymbol?: boolean; locale?: string } = {}
  ): string {
    const { includeSymbol = true, locale = 'vi-VN' } = options;
    
    try {
      if (currency === 'VND') {
        // Vietnamese dong formatting: no decimals, comma as thousand separator
        const formatter = new Intl.NumberFormat(locale, {
          style: includeSymbol ? 'currency' : 'decimal',
          currency: 'VND',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        });
        
        if (includeSymbol) {
          return formatter.format(amount);
        } else {
          return formatter.format(amount) + ' đ';
        }
      } else {
        // USD formatting with 2 decimal places
        const formatter = new Intl.NumberFormat(locale, {
          style: includeSymbol ? 'currency' : 'decimal', 
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        
        return formatter.format(amount);
      }
    } catch (error) {
      // Fallback formatting
      if (currency === 'VND') {
        const formatted = amount.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
        return includeSymbol ? `${formatted} ₫` : formatted;
      } else {
        const formatted = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return includeSymbol ? `$${formatted}` : formatted;
      }
    }
  }

  /**
   * Format date in Vietnamese DD/MM/YYYY format
   */
  static formatDate(
    date: Date | string,
    format: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' = 'DD/MM/YYYY'
  ): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return 'Ngày không hợp lệ';
    }

    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const year = dateObj.getFullYear().toString();

    switch (format) {
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`;
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      default:
        return `${day}/${month}/${year}`;
    }
  }

  /**
   * Format date and time in Vietnamese locale
   */
  static formatDateTime(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return 'Thời gian không hợp lệ';
    }

    const formattedDate = this.formatDate(dateObj);
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    
    return `${formattedDate} ${hours}:${minutes}`;
  }

  /**
   * Translate region code to Vietnamese name
   */
  static translateRegion(regionCode: string): string {
    return this.VIETNAMESE_REGIONS[regionCode] || regionCode;
  }

  /**
   * Translate commodity code to Vietnamese name
   */
  static translateCommodity(commodityCode: string): string {
    return this.VIETNAMESE_COMMODITIES[commodityCode] || commodityCode;
  }

  /**
   * Get Vietnamese header for export column
   */
  static getVietnameseHeader(headerKey: string): string {
    return this.EXPORT_HEADERS_VIETNAMESE[headerKey] || headerKey;
  }

  /**
   * Translate trading action to Vietnamese
   */
  static translateTradingAction(action: string): string {
    return this.TRADING_ACTIONS_VIETNAMESE[action] || action;
  }

  /**
   * Translate risk level to Vietnamese
   */
  static translateRiskLevel(riskLevel: string): string {
    return this.RISK_LEVELS_VIETNAMESE[riskLevel] || riskLevel;
  }

  /**
   * Translate seasonal period to Vietnamese
   */
  static translateSeason(season: string): string {
    return this.SEASONAL_PERIODS[season] || season;
  }

  /**
   * Format percentage with Vietnamese locale
   */
  static formatPercentage(value: number, decimals: number = 2): string {
    return `${value.toFixed(decimals)}%`;
  }

  /**
   * Format quality score (0-1) as percentage
   */
  static formatQualityScore(score: number): string {
    return this.formatPercentage(score * 100, 1);
  }

  /**
   * Format confidence score (0-1) as percentage
   */
  static formatConfidence(confidence: number): string {
    return this.formatPercentage(confidence * 100, 1);
  }

  /**
   * Create export metadata in Vietnamese
   */
  static createExportMetadata(
    recordCount: number,
    filters: any,
    exportFormat: 'csv' | 'xlsx',
    exportedBy: string = 'Hệ thống'
  ): ExportMetadata {
    return {
      exportDate: new Date(),
      exportedBy,
      recordCount,
      filters,
      exportFormat
    };
  }

  /**
   * Format agricultural volume/weight with Vietnamese units
   */
  static formatVolume(amount: number, unit: string): string {
    const vietnameseUnits = {
      'ton': 'tấn',
      'kg': 'kg', 
      'tons': 'tấn',
      'kilograms': 'kg',
      'metric_tons': 'tấn',
      'bags': 'bao',
      'sacks': 'bao'
    };

    const translatedUnit = vietnameseUnits[unit.toLowerCase()] || unit;
    return `${amount.toLocaleString('vi-VN')} ${translatedUnit}`;
  }

  /**
   * Generate export filename with timestamp
   */
  static generateExportFilename(
    type: string, 
    commodity?: string, 
    region?: string,
    format: 'csv' | 'xlsx' = 'csv'
  ): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    const translatedType = type === 'market-data' ? 'du-lieu-thi-truong' : 
                          type === 'forecasts' ? 'du-bao' : 
                          type === 'price-history' ? 'lich-su-gia' : type;
    
    let filename = `agriintel-${translatedType}`;
    
    if (commodity) {
      filename += `-${commodity.toLowerCase()}`;
    }
    
    if (region) {
      filename += `-${region.toLowerCase()}`;
    }
    
    filename += `-${timestamp}.${format}`;
    
    return filename;
  }

  /**
   * Get all Vietnamese export headers as an object
   */
  static getAllVietnameseHeaders(): Record<string, string> {
    return { ...this.EXPORT_HEADERS_VIETNAMESE };
  }

  /**
   * Convert UTC timestamp to Vietnamese timezone
   */
  static toVietnameseTime(date: Date | string): Date {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    // Convert to Vietnamese timezone (UTC+7)
    const vietnameseTime = new Date(dateObj.getTime() + (7 * 60 * 60 * 1000));
    return vietnameseTime;
  }

  /**
   * Format seasonal calendar information
   */
  static formatSeasonalInfo(commodity: string, region: string): {
    harvestSeason: string;
    plantingSeason: string;
    monsoonImpact: string;
  } {
    // This could be expanded with a database lookup for detailed seasonal data
    const seasonalData = {
      rice: {
        harvestSeason: 'Tháng 6-7 (vụ hè), Tháng 10-11 (vụ mùa)',
        plantingSeason: 'Tháng 3-4 (vụ hè), Tháng 7-8 (vụ mùa)',
        monsoonImpact: 'Ảnh hưởng mạnh - giảm giá trong mùa mưa'
      },
      coffee: {
        harvestSeason: 'Tháng 10 - Tháng 2',
        plantingSeason: 'Tháng 4 - Tháng 6',
        monsoonImpact: 'Ảnh hưởng trung bình - chất lượng phụ thuộc mưa'
      },
      pepper: {
        harvestSeason: 'Tháng 1 - Tháng 4',
        plantingSeason: 'Tháng 5 - Tháng 7',
        monsoonImpact: 'Ảnh hưởng thấp - giá ổn định'
      }
    };

    return seasonalData[commodity] || {
      harvestSeason: 'Chưa có dữ liệu',
      plantingSeason: 'Chưa có dữ liệu', 
      monsoonImpact: 'Chưa có dữ liệu'
    };
  }
}

export default VietnameseDataFormatter;