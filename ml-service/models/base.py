from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple, Optional
import pandas as pd
import numpy as np
from dataclasses import dataclass
from datetime import datetime, timedelta

@dataclass
class ForecastResult:
    """Forecast result with predictions and metadata"""
    dates: List[str]
    predictions: List[float]  # median predictions
    lower_bounds: List[float]  # q10
    upper_bounds: List[float]  # q90
    confidence: List[float]
    model_name: str
    metrics: Dict[str, float]
    metadata: Dict[str, Any]

@dataclass
class QuantileForecast:
    """Full quantile forecast with all percentiles"""
    dates: List[str]
    q10: List[float]
    q25: List[float]
    median: List[float]
    q75: List[float]
    q90: List[float]
    confidence: List[float]
    trend: List[str]  # "up", "down", "stable"
    volatility: List[float]
    metadata: Optional[Dict[str, Any]] = None

class BaseTimeSeriesModel(ABC):
    """Base class for all time series forecasting models"""
    
    def __init__(self, name: str):
        self.name = name
        self.is_fitted = False
        self.feature_importance = None
        
    @abstractmethod
    def fit(self, data: pd.DataFrame) -> 'BaseTimeSeriesModel':
        """Fit the model to historical data"""
        pass
        
    @abstractmethod
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate forecast for the specified horizon"""
        pass
        
    @abstractmethod
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Calculate performance metrics"""
        pass
        
    def validate_data(self, data: pd.DataFrame) -> pd.DataFrame:
        """Validate and preprocess input data"""
        required_columns = ['date', 'price']
        if not all(col in data.columns for col in required_columns):
            raise ValueError(f"Data must contain columns: {required_columns}")
            
        # Sort by date and handle missing values
        data = data.sort_values('date').copy()
        data['date'] = pd.to_datetime(data['date'])
        data = data.dropna(subset=['price'])
        
        if len(data) < 30:
            raise ValueError("Insufficient data: need at least 30 observations")
            
        return data
        
    def create_features(self, data: pd.DataFrame) -> pd.DataFrame:
        """Create additional features for ML models"""
        df = data.copy()
        df = df.sort_values('date')
        
        # Price-based features
        df['price_lag1'] = df['price'].shift(1)
        df['price_lag7'] = df['price'].shift(7)
        df['price_lag30'] = df['price'].shift(30)
        
        # Moving averages
        df['ma_7'] = df['price'].rolling(window=7).mean()
        df['ma_30'] = df['price'].rolling(window=30).mean()
        
        # Volatility features
        df['volatility_7'] = df['price'].rolling(window=7).std()
        df['volatility_30'] = df['price'].rolling(window=30).std()
        
        # Trend features
        df['price_change'] = df['price'].pct_change()
        df['price_change_7'] = df['price'].pct_change(periods=7)
        
        # Seasonal features
        df['day_of_week'] = df['date'].dt.dayofweek
        df['day_of_month'] = df['date'].dt.day
        df['month'] = df['date'].dt.month
        df['quarter'] = df['date'].dt.quarter
        
        # Vietnamese agricultural seasonality
        # Rice harvest seasons: Feb-Mar (Winter), Jun-Jul (Summer), Oct-Nov (Autumn)
        df['rice_harvest_season'] = df['month'].apply(lambda x: 1 if x in [2, 3, 6, 7, 10, 11] else 0)
        
        # Coffee harvest season: Oct-Mar
        df['coffee_harvest_season'] = df['month'].apply(lambda x: 1 if x in [10, 11, 12, 1, 2, 3] else 0)
        
        return df
        
    def calculate_trend(self, predictions: List[float]) -> List[str]:
        """Determine trend direction for predictions"""
        trends = []
        for i in range(len(predictions)):
            if i == 0:
                trends.append("stable")
            else:
                change = (predictions[i] - predictions[i-1]) / predictions[i-1]
                if change > 0.02:  # >2% increase
                    trends.append("up")
                elif change < -0.02:  # >2% decrease
                    trends.append("down")
                else:
                    trends.append("stable")
        return trends
        
    def calculate_volatility(self, predictions: List[float], confidence: List[float]) -> List[float]:
        """Calculate volatility measure for each prediction"""
        volatility = []
        for i, conf in enumerate(confidence):
            # Volatility inversely related to confidence
            base_vol = (1.0 - conf) * 0.2  # Base volatility up to 20%
            
            # Add historical volatility component
            if i > 0:
                price_vol = abs(predictions[i] - predictions[i-1]) / predictions[i-1]
                base_vol = max(base_vol, price_vol)
                
            volatility.append(min(base_vol, 0.5))  # Cap at 50%
            
        return volatility