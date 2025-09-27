import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import warnings
warnings.filterwarnings('ignore')

from .base import BaseTimeSeriesModel, ForecastResult

class ETSModel(BaseTimeSeriesModel):
    """Exponential Smoothing (ETS) model for time series forecasting"""
    
    def __init__(self, trend: str = 'add', seasonal: str = 'add', seasonal_periods: int = 7):
        super().__init__("ETS")
        self.trend = trend  # 'add', 'mul', or None
        self.seasonal = seasonal  # 'add', 'mul', or None  
        self.seasonal_periods = seasonal_periods  # Weekly seasonality
        self.model: Optional[ExponentialSmoothing] = None
        self.fitted_model: Optional[Any] = None
        self.data: Optional[pd.DataFrame] = None
        
    def _auto_select_model(self, series: pd.Series) -> Dict[str, Any]:
        """Automatically select best ETS model configuration"""
        configurations = [
            {'trend': None, 'seasonal': None},
            {'trend': 'add', 'seasonal': None},
            {'trend': 'add', 'seasonal': 'add'},
            {'trend': 'mul', 'seasonal': None},
            {'trend': 'mul', 'seasonal': 'add'},
            {'trend': 'add', 'seasonal': 'mul'},
        ]
        
        best_aic = float('inf')
        best_config = configurations[0]
        
        for config in configurations:
            try:
                # Skip multiplicative models if series has zeros or negatives
                if config.get('trend') == 'mul' or config.get('seasonal') == 'mul':
                    if (series <= 0).any():
                        continue
                        
                temp_model = ExponentialSmoothing(
                    series,
                    trend=config['trend'],
                    seasonal=config['seasonal'],
                    seasonal_periods=self.seasonal_periods if config['seasonal'] else None
                )
                temp_fitted = temp_model.fit(optimized=True)
                
                if temp_fitted.aic < best_aic:
                    best_aic = temp_fitted.aic
                    best_config = config
                    
            except Exception as e:
                continue
                
        return best_config
        
    def fit(self, data: pd.DataFrame) -> 'ETSModel':
        """Fit ETS model to historical price data"""
        # Validate and preprocess data
        data = self.validate_data(data)
        self.data = data.copy()
        
        # Extract price series
        price_series = data.set_index('date')['price']
        
        # Ensure we have a Series, not DataFrame
        if isinstance(price_series, pd.DataFrame):
            price_series = price_series.iloc[:, 0]  # Take first column if DataFrame
        
        # Ensure positive values for multiplicative models
        if (price_series <= 0).any():
            # Shift series to be positive if needed
            min_val = price_series.min()
            if min_val <= 0:
                price_series = price_series - min_val + 1
                
        # Auto-select best model configuration
        best_config = self._auto_select_model(price_series)
        self.trend = best_config['trend']
        self.seasonal = best_config['seasonal']
        
        # Fit ETS model
        try:
            self.model = ExponentialSmoothing(
                price_series,
                trend=self.trend,
                seasonal=self.seasonal,
                seasonal_periods=self.seasonal_periods if self.seasonal else None
            )
            self.fitted_model = self.model.fit(optimized=True, use_boxcox=False)
            self.is_fitted = True
            
        except Exception as e:
            # Fallback to simple exponential smoothing
            print(f"ETS fitting failed with config {best_config}, using simple exponential smoothing: {e}")
            self.trend = None
            self.seasonal = None
            self.model = ExponentialSmoothing(price_series, trend=None, seasonal=None)
            self.fitted_model = self.model.fit(optimized=True)
            self.is_fitted = True
            
        return self
        
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate ETS forecast with confidence intervals"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before forecasting")
            
        # Generate forecast
        if self.fitted_model is None:
            raise ValueError("Model must be fitted before forecasting")
        if self.data is None:
            raise ValueError("No training data available")
            
        forecast_result = self.fitted_model.forecast(steps=horizon)
        
        # Ensure predictions is always a properly shaped array
        if isinstance(forecast_result, np.ndarray):
            predictions = forecast_result.flatten()  # Ensure 1D array
        elif np.isscalar(forecast_result):
            predictions = np.array([forecast_result] * horizon)  # Repeat scalar for horizon
        else:
            # Try to convert to array
            try:
                predictions = np.array(forecast_result).flatten()
            except:
                # Fallback - create array of the single value
                predictions = np.array([float(forecast_result)] * horizon)
                
        # Ensure we have the right length
        if len(predictions) != horizon:
            if len(predictions) == 1:
                # Repeat single prediction
                predictions = np.array([predictions[0]] * horizon)
            else:
                # Truncate or pad to horizon
                if len(predictions) > horizon:
                    predictions = predictions[:horizon]
                else:
                    # Pad with last value
                    last_val = predictions[-1] if len(predictions) > 0 else 1.0
                    predictions = np.pad(predictions, (0, horizon - len(predictions)), 
                                        mode='constant', constant_values=last_val)
        
        # Convert to list for consistency
        predictions = predictions.tolist()
        
        # Create forecast dates
        last_date = self.data['date'].max()
        forecast_dates = [(last_date + pd.Timedelta(days=i+1)).strftime('%Y-%m-%d') 
                         for i in range(horizon)]
        
        # Generate prediction intervals (ETS doesn't have built-in prediction intervals)
        # Use historical residual standard deviation to approximate
        try:
            if self.data is not None and self.fitted_model is not None and hasattr(self.fitted_model, 'fittedvalues'):
                residuals = self.data.set_index('date')['price'] - self.fitted_model.fittedvalues
                residual_std = np.std(residuals.dropna())
            else:
                raise ValueError("No fitted values available")
        except:
            residual_std = np.std(self.data['price']) * 0.1 if self.data is not None else 0.1
            
        # Calculate confidence intervals using residual standard deviation
        lower_bounds = []
        upper_bounds = []
        confidence_scores = []
        
        for i, pred in enumerate(predictions):
            # Confidence interval widens with forecast horizon
            interval_multiplier = 1.96 * (1 + i * 0.1)  # 95% CI that widens over time
            
            lower = pred - interval_multiplier * residual_std
            upper = pred + interval_multiplier * residual_std
            
            lower_bounds.append(lower)
            upper_bounds.append(upper)
            
            # Confidence decreases with forecast horizon
            confidence = max(0.5, 0.9 - (i / horizon) * 0.3)
            confidence_scores.append(confidence)
        
        return ForecastResult(
            dates=forecast_dates,
            predictions=predictions.tolist() if isinstance(predictions, np.ndarray) else list(predictions),
            lower_bounds=lower_bounds,
            upper_bounds=upper_bounds,
            confidence=confidence_scores,
            model_name=self.name,
            metrics=self.get_metrics(),
            metadata={
                'trend': self.trend,
                'seasonal': self.seasonal,
                'seasonal_periods': self.seasonal_periods,
                'aic': getattr(self.fitted_model, 'aic', None),
                'smoothing_level': getattr(self.fitted_model.params, 'smoothing_level', None) if self.fitted_model is not None and hasattr(self.fitted_model, 'params') else None,
                'smoothing_trend': getattr(self.fitted_model.params, 'smoothing_trend', None) if self.fitted_model is not None and hasattr(self.fitted_model, 'params') else None,
                'smoothing_seasonal': getattr(self.fitted_model.params, 'smoothing_seasonal', None) if self.fitted_model is not None and hasattr(self.fitted_model, 'params') else None
            }
        )
        
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Calculate ETS model performance metrics"""
        if not self.is_fitted:
            return {}
            
        try:
            if self.fitted_model is None or self.data is None:
                return {}
                
            # Get fitted values and calculate residuals
            fitted_values = self.fitted_model.fittedvalues
            if fitted_values is None:
                return {}
                
            actual_values = self.data.set_index('date')['price']
            
            # Align data (fitted values might be shorter)
            aligned_actual = actual_values.loc[fitted_values.index]
            residuals = aligned_actual - fitted_values
            
            # Calculate metrics
            mae = np.mean(np.abs(residuals))
            rmse = np.sqrt(np.mean(residuals**2))
            mape = np.mean(np.abs(residuals / aligned_actual)) * 100
            
            # Mean Absolute Scaled Error (MASE)
            naive_mae = np.mean(np.abs(aligned_actual.diff().dropna()))
            mase = mae / naive_mae if naive_mae > 0 else 1.0
            
            return {
                'mae': float(mae),
                'rmse': float(rmse),
                'mape': float(mape),
                'mase': float(mase),
                'aic': float(getattr(self.fitted_model, 'aic', 0.0)),
                'smoothing_level': float(getattr(self.fitted_model.params, 'smoothing_level', 0.0)) if self.fitted_model is not None and hasattr(self.fitted_model, 'params') else 0.0
            }
            
        except Exception as e:
            print(f"Error calculating ETS metrics: {e}")
            return {
                'mae': 0.0,
                'rmse': 0.0,
                'mape': 0.0,
                'mase': 1.0,
                'aic': float(getattr(self.fitted_model, 'aic', 0.0))
            }