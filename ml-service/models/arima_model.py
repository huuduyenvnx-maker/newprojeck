import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.stattools import adfuller
import warnings
warnings.filterwarnings('ignore')

from .base import BaseTimeSeriesModel, ForecastResult

class ARIMAModel(BaseTimeSeriesModel):
    """ARIMA (AutoRegressive Integrated Moving Average) model for time series forecasting"""
    
    def __init__(self, order: Optional[tuple] = None, seasonal_order: Optional[tuple] = None):
        super().__init__("ARIMA")
        self.order = order or (1, 1, 1)  # Default ARIMA(1,1,1)
        self.seasonal_order = seasonal_order or (1, 1, 1, 7)  # Weekly seasonality
        self.model: Optional[ARIMA] = None
        self.fitted_model: Optional[Any] = None
        self.data: Optional[pd.DataFrame] = None
        
    def _auto_arima_order(self, series: pd.Series) -> tuple:
        """Automatically determine optimal ARIMA parameters"""
        # Simple grid search for optimal parameters
        best_aic = float('inf')
        best_order = (1, 1, 1)
        
        # Test different parameter combinations
        p_values = [0, 1, 2]
        d_values = [0, 1, 2]
        q_values = [0, 1, 2]
        
        for p in p_values:
            for d in d_values:
                for q in q_values:
                    try:
                        temp_model = ARIMA(series, order=(p, d, q))
                        temp_fitted = temp_model.fit()
                        if temp_fitted.aic < best_aic:
                            best_aic = temp_fitted.aic
                            best_order = (p, d, q)
                    except:
                        continue
                        
        return best_order
        
    def _check_stationarity(self, series: pd.Series) -> Dict[str, Any]:
        """Check if series is stationary using Augmented Dickey-Fuller test"""
        result = adfuller(series.dropna())
        
        # Avoid complex type issues with critical values, use simplified return
        return {
            'adf_statistic': float(result[0]),
            'p_value': float(result[1]),
            'is_stationary': bool(result[1] < 0.05),
            'critical_values': {}  # Simplified to avoid complex type issues
        }
        
    def fit(self, data: pd.DataFrame) -> 'ARIMAModel':
        """Fit ARIMA model to historical price data"""
        # Validate and preprocess data
        data = self.validate_data(data)
        self.data = data.copy()
        
        # Extract price series
        price_series = data.set_index('date')['price']
        
        # Ensure we have a Series, not DataFrame
        if isinstance(price_series, pd.DataFrame):
            price_series = price_series.iloc[:, 0]  # Take first column if DataFrame
        
        # Check stationarity
        stationarity = self._check_stationarity(price_series)
        
        # Auto-determine optimal order if not specified
        if self.order == (1, 1, 1):  # Default order
            self.order = self._auto_arima_order(price_series)
            
        # Fit ARIMA model
        try:
            self.model = ARIMA(price_series, order=self.order, seasonal_order=self.seasonal_order)
            self.fitted_model = self.model.fit()
            self.is_fitted = True
            
        except Exception as e:
            # Fallback to simpler model if complex model fails
            print(f"ARIMA fitting failed with order {self.order}, trying simpler model: {e}")
            self.order = (1, 1, 0)
            self.seasonal_order = None
            self.model = ARIMA(price_series, order=self.order)
            self.fitted_model = self.model.fit()
            self.is_fitted = True
            
        return self
        
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate ARIMA forecast with confidence intervals"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before forecasting")
            
        # Generate forecast
        if self.fitted_model is None:
            raise ValueError("Model must be fitted before forecasting")
        if self.data is None:
            raise ValueError("No training data available")
            
        forecast_result = self.fitted_model.get_forecast(steps=horizon)
        predictions = forecast_result.predicted_mean.values
        conf_int = forecast_result.conf_int()
        
        # Create forecast dates
        last_date = self.data['date'].max()
        forecast_dates = [(last_date + pd.Timedelta(days=i+1)).strftime('%Y-%m-%d') 
                         for i in range(horizon)]
        
        # Extract confidence intervals
        lower_bounds = conf_int.iloc[:, 0].values
        upper_bounds = conf_int.iloc[:, 1].values
        
        # Calculate confidence scores (based on interval width)
        confidence_scores = []
        for i in range(horizon):
            # Safely calculate interval width to prevent division by zero
            if predictions[i] != 0 and not np.isnan(predictions[i]) and not np.isinf(predictions[i]):
                interval_width = abs(upper_bounds[i] - lower_bounds[i]) / abs(predictions[i])
                if np.isnan(interval_width) or np.isinf(interval_width):
                    interval_width = 0.5  # Fallback value
            else:
                interval_width = 0.5  # Fallback for zero or invalid predictions
                
            confidence = max(0.5, 1.0 - min(interval_width, 0.5))
            
            # Ensure confidence is valid
            if np.isnan(confidence) or np.isinf(confidence):
                confidence = 0.7  # Fallback confidence
                
            confidence_scores.append(float(confidence))
        
        return ForecastResult(
            dates=forecast_dates,
            predictions=predictions.tolist(),
            lower_bounds=lower_bounds.tolist(),
            upper_bounds=upper_bounds.tolist(),
            confidence=confidence_scores,
            model_name=self.name,
            metrics=self.get_metrics(),
            metadata={
                'arima_order': self.order,
                'seasonal_order': self.seasonal_order,
                'aic': self.fitted_model.aic if self.fitted_model is not None else None,
                'bic': self.fitted_model.bic if self.fitted_model is not None else None
            }
        )
        
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Calculate ARIMA model performance metrics"""
        if not self.is_fitted:
            return {}
            
        try:
            if self.fitted_model is None:
                return {}
                
            # In-sample metrics
            residuals = self.fitted_model.resid
            
            # Calculate metrics
            mae = np.mean(np.abs(residuals))
            rmse = np.sqrt(np.mean(residuals**2))
            
            fitted_values = self.fitted_model.fittedvalues
            if fitted_values is not None and len(fitted_values) > 0:
                mape = np.mean(np.abs(residuals / fitted_values)) * 100
            else:
                mape = float('inf')
            
            # Ljung-Box test for residual autocorrelation
            ljung_box = acorr_ljungbox(residuals, lags=10, return_df=True)
            ljung_box_pvalue = ljung_box['lb_pvalue'].iloc[-1]
            
            return {
                'mae': float(mae),
                'rmse': float(rmse),
                'mape': float(mape),
                'aic': float(self.fitted_model.aic) if self.fitted_model is not None else float('inf'),
                'bic': float(self.fitted_model.bic) if self.fitted_model is not None else float('inf'),
                'ljung_box_pvalue': float(ljung_box_pvalue),
                'residual_autocorr': float(ljung_box_pvalue > 0.05)  # Good if > 0.05
            }
            
        except Exception as e:
            print(f"Error calculating ARIMA metrics: {e}")
            return {
                'mae': 0.0,
                'rmse': 0.0,
                'mape': 0.0,
                'aic': float(self.fitted_model.aic) if self.fitted_model is not None else 0.0,
                'bic': float(self.fitted_model.bic) if self.fitted_model is not None else 0.0
            }