export interface ForecastPrediction {
  date: string;
  median: number;
  q10: number;
  q90: number;
  confidence: number;
}

export interface ForecastMetrics {
  mase: number;
  smape: number;
  picp: number;
  coverage: number;
  fqs: number;
}

export interface Forecast {
  id: string;
  commodityId: string;
  regionId: string;
  forecastDate: string;
  horizon: number;
  method: string;
  predictions: ForecastPrediction[];
  metrics: ForecastMetrics;
  modelVersion: string;
  isActive: boolean;
  createdAt: string;
  verifications?: LlmVerification[];
  recommendations?: TradingRecommendation[];
}

export interface LlmVerification {
  id: string;
  forecastId: string;
  provider: string;
  model: string;
  prompt: string;
  response: string;
  confidence: string;
  metadata: any;
  verified: boolean;
  createdAt: string;
}

export interface TradingRecommendation {
  id: string;
  forecastId: string;
  action: string;
  confidence: string;
  entryPrice?: string;
  targetPrice?: string;
  stopLoss?: string;
  riskLevel: string;
  reasoning: string;
  metadata: any;
  createdAt: string;
}

export interface Commodity {
  id: string;
  name: string;
  category: string;
  unit: string;
  createdAt: string;
}

export interface Region {
  id: string;
  name: string;
  country: string;
  timezone: string;
}

export interface Alert {
  id: string;
  type: string;
  commodityId?: string;
  regionId?: string;
  severity: string;
  title: string;
  message: string;
  data: any;
  acknowledged: boolean;
  createdAt: string;
}
