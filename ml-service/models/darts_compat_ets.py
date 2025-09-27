"""
Darts-compatible ETS model implementation using statsmodels
This provides the same interface as Darts for backward compatibility
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

from statsmodels.tsa.holtwinters import ExponentialSmoothing

from .base import BaseTimeSeriesModel, ForecastResult

class DartsCompatETSModel(BaseTimeSeriesModel):
    """Darts-compatible ETS (Exponential Smoothing) model using statsmodels backend"""
    
    def __init__(self, 
                 trend: Optional[str] = None, 
                 seasonal: Optional[str] = None, 
                 seasonal_periods: Optional[int] = None,
                 damped_trend: bool = False):
        super().__init__("DartsCompat_ETS")
        
        # ETS parameters
        self.trend = trend  # None, 'add', 'mul'
        self.seasonal = seasonal  # None, 'add', 'mul'  
        self.seasonal_periods = seasonal_periods
        self.damped_trend = damped_trend
        
        self.model = None
        self.fitted_model = None
        self.auto_select = (trend is None and seasonal is None)
        
    def _detect_seasonality(self, series: pd.Series, max_period: int = 12) -> Tuple[Optional[str], Optional[int]]:
        """Auto-detect seasonality pattern and period"""
        
        if len(series) < max_period * 2:  # Need at least 2 full cycles
            return None, None
            
        # Test different seasonal periods
        best_period = None
        best_seasonal_type = None
        min_aic = float('inf')
        
        # Test common seasonal periods (weekly=7, monthly=30, etc.)
        test_periods = [7, 12, 30] if max_period >= 30 else [7, 12] if max_period >= 12 else [7]
        test_periods = [p for p in test_periods if p <= max_period and len(series) >= p * 2]
        
        for period in test_periods:
            for seasonal_type in ['add', 'mul']:
                try:
                    # Quick fit to test seasonality
                    model_test = ExponentialSmoothing(
                        series, 
                        trend='add',
                        seasonal=seasonal_type, 
                        seasonal_periods=period
                    )
                    fitted_test = model_test.fit(optimized=True, remove_bias=True)
                    
                    if fitted_test.aic < min_aic:
                        min_aic = fitted_test.aic
                        best_period = period
                        best_seasonal_type = seasonal_type
                        
                except:
                    continue
                    
        # If seasonal model isn't much better than non-seasonal, don't use seasonality
        try:
            # Test non-seasonal model
            model_noseas = ExponentialSmoothing(series, trend='add')
            fitted_noseas = model_noseas.fit(optimized=True)
            
            # If seasonal improvement is less than 10%, use non-seasonal
            if min_aic == float('inf') or (fitted_noseas.aic - min_aic) < 10:
                return None, None
                
        except:
            pass
            
        return best_seasonal_type, best_period
    
    def _auto_select_parameters(self, series: pd.Series) -> Tuple[Optional[str], Optional[str], Optional[int], bool]:
        """Automatically select ETS parameters"""
        
        # Initialize variables to ensure they're always defined
        damped = False
        trend_type = None
        
        # Detect trend
        if len(series) < 3:
            trend_type = None
        else:
            # Simple trend detection using linear regression slope
            x = np.arange(len(series))
            series_values = np.asarray(series.values)
            slope = np.polyfit(x, series_values, 1)[0]
            series_std = np.std(series_values)
            trend_strength = abs(slope) / series_std if series_std > 0 else 0
            
            if trend_strength > 0.1:  # Significant trend
                # Test additive vs multiplicative
                try:
                    model_add = ExponentialSmoothing(series, trend='add')
                    fitted_add = model_add.fit(optimized=True)
                    aic_add = fitted_add.aic
                except:
                    aic_add = float('inf')
                    
                try:
                    model_mul = ExponentialSmoothing(series, trend='mul')  
                    fitted_mul = model_mul.fit(optimized=True)
                    aic_mul = fitted_mul.aic
                except:
                    aic_mul = float('inf')
                    
                trend_type = 'add' if aic_add <= aic_mul else 'mul'
                
                # Test damped trend
                try:
                    model_damped = ExponentialSmoothing(series, trend=trend_type, damped_trend=True)
                    fitted_damped = model_damped.fit(optimized=True)
                    damped = fitted_damped.aic < min(aic_add, aic_mul)
                except:
                    damped = False
            else:
                trend_type = None
                damped = False
        
        # Detect seasonality
        seasonal_type, seasonal_periods = self._detect_seasonality(series)
        
        return trend_type, seasonal_type, seasonal_periods, damped
    
    def fit(self, data: pd.DataFrame) -> 'DartsCompatETSModel':
        """Fit ETS model to time series data"""
        data = self.validate_data(data)
        
        # Extract price series
        price_series = pd.Series(data['price'].values, index=data['date'])
        
        if len(price_series) < 3:
            raise ValueError("Need at least 3 data points for ETS fitting")
        
        # Handle negative values (ETS multiplicative components need positive values)
        if np.any(price_series <= 0):
            print("Warning: Non-positive values detected, adjusting for ETS compatibility")
            price_series = price_series + abs(price_series.min()) + 1
        
        # Auto-select parameters if not provided
        if self.auto_select:
            trend, seasonal, seasonal_periods, damped = self._auto_select_parameters(price_series)
            print(f"Auto-selected ETS parameters: trend={trend}, seasonal={seasonal}, periods={seasonal_periods}, damped={damped}")
        else:
            trend = self.trend
            seasonal = self.seasonal  
            seasonal_periods = self.seasonal_periods
            damped = self.damped_trend
            
        try:
            # Create and fit model
            self.model = ExponentialSmoothing(
                price_series,
                trend=trend,
                seasonal=seasonal,
                seasonal_periods=seasonal_periods,
                damped_trend=damped
            )
            
            # Fit with optimization
            self.fitted_model = self.model.fit(
                optimized=True,
                remove_bias=True,
                use_brute=False  # Disable brute force for speed
            )
            
            # Store final parameters
            self.trend = trend
            self.seasonal = seasonal
            self.seasonal_periods = seasonal_periods
            self.damped_trend = damped
            
            self.is_fitted = True
            
            print(f"ETS model fitted successfully. AIC: {self.fitted_model.aic:.2f}")
            
        except Exception as e:
            print(f"ETS fitting failed: {e}")
            # Try simple exponential smoothing as fallback
            try:
                self.model = ExponentialSmoothing(price_series, trend=None, seasonal=None)
                self.fitted_model = self.model.fit(optimized=True)
                self.trend = None
                self.seasonal = None  
                self.seasonal_periods = None
                self.damped_trend = False
                self.is_fitted = True
                print("Fitted fallback simple exponential smoothing model")
            except Exception as e2:
                raise ValueError(f"ETS fitting completely failed: {e2}")
                
        return self
    
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate forecast using fitted ETS model"""
        if not self.is_fitted or not self.fitted_model:
            raise ValueError("Model must be fitted before forecasting")
            
        try:
            # Generate forecast
            forecast_result = self.fitted_model.forecast(steps=horizon)
            predictions = forecast_result.values if hasattr(forecast_result, 'values') else forecast_result
            
            # Generate prediction intervals (approximate)
            # ETS doesn't provide direct confidence intervals, so we estimate them
            residuals = self.fitted_model.resid
            if len(residuals) > 0:
                residual_std = np.std(residuals)
                
                # Prediction intervals grow with horizon for ETS
                prediction_errors = [residual_std * np.sqrt(i + 1) for i in range(horizon)]
                lower_bounds = predictions - 1.96 * np.array(prediction_errors)
                upper_bounds = predictions + 1.96 * np.array(prediction_errors)
            else:
                # Fallback to simple percentage intervals
                lower_bounds = predictions * 0.95
                upper_bounds = predictions * 1.05
                
            # Generate forecast dates
            if hasattr(self.fitted_model.data, 'dates') and len(self.fitted_model.data.dates) > 0:
                last_date = self.fitted_model.data.dates[-1]
                # Handle NaTType case
                if pd.isna(last_date):
                    last_date = pd.Timestamp.now()
            else:
                last_date = pd.Timestamp.now()
                
            # Generate dates safely handling potential NaT
            try:
                if pd.isna(last_date):
                    base_date = pd.Timestamp.now()
                else:
                    base_date = pd.Timestamp(last_date)
            except (TypeError, ValueError):
                base_date = pd.Timestamp.now()
            
            # Ensure base_date is a concrete timestamp, not NaT
            try:
                # Type-safe check for valid timestamp
                if str(base_date) == 'NaT' or base_date is None:
                    base_date = pd.Timestamp.now()
                else:
                    # Verify it's a valid timestamp by accessing a property
                    _ = base_date.year  # This will fail if NaT/invalid
            except (ValueError, TypeError, AttributeError):
                base_date = pd.Timestamp.now()
                
            # Generate forecast dates with safe timestamp handling
            forecast_dates = []
            for i in range(horizon):
                try:
                    date_obj = base_date + pd.Timedelta(days=i+1)
                    # Test if the date is valid by accessing year property  
                    _ = date_obj.year
                    # Additional safeguard against NaT before strftime
                    if str(date_obj) != 'NaT' and hasattr(date_obj, 'strftime'):
                        forecast_dates.append(date_obj.strftime('%Y-%m-%d'))
                    else:
                        raise ValueError("Invalid date object")
                except (ValueError, TypeError, AttributeError):
                    # Fallback to current date plus offset with additional safety
                    try:
                        fallback_date = pd.Timestamp.now() + pd.Timedelta(days=i+1)
                        # Explicit type guard to ensure we have a valid timestamp
                        if isinstance(fallback_date, pd.Timestamp) and not pd.isna(fallback_date):
                            date_str: str = fallback_date.strftime('%Y-%m-%d')
                            forecast_dates.append(date_str)
                        else:
                            raise AttributeError("Invalid timestamp")
                    except (ValueError, TypeError, AttributeError):
                        # Final fallback - use string formatting with guaranteed valid timestamp
                        now_ts: pd.Timestamp = pd.Timestamp.now()
                        date_str: str = f"{now_ts.year}-{now_ts.month:02d}-{now_ts.day + i + 1:02d}"
                        forecast_dates.append(date_str)
            
            # Calculate confidence (decreases with horizon for ETS)
            base_confidence = max(0.6, 1.0 - (self.fitted_model.aic / 2000))
            confidence_decay = 0.98  # Slower decay than ARIMA
            confidence = [
                min(base_confidence * (confidence_decay ** i), 0.95) 
                for i in range(horizon)
            ]
            
            # Calculate performance metrics
            metrics = self._calculate_metrics()
            
            return ForecastResult(
                dates=forecast_dates,
                predictions=predictions.tolist(),
                lower_bounds=lower_bounds.tolist(),
                upper_bounds=upper_bounds.tolist(),
                confidence=confidence,
                model_name=self.name,
                metrics=metrics,
                metadata={
                    'ets_components': {
                        'trend': self.trend,
                        'seasonal': self.seasonal,
                        'seasonal_periods': self.seasonal_periods,
                        'damped_trend': self.damped_trend
                    },
                    'aic': self.fitted_model.aic,
                    'smoothing_params': self._get_smoothing_parameters(),
                    'darts_compatible': True
                }
            )
            
        except Exception as e:
            print(f"ETS forecasting failed: {e}")
            raise ValueError(f"Forecasting failed: {e}")
    
    def _get_smoothing_parameters(self) -> Dict[str, float]:
        """Extract smoothing parameters from fitted model"""
        if not self.fitted_model:
            return {}
            
        try:
            params = {
                'alpha': float(self.fitted_model.params.get('smoothing_level', 0)),
            }
            
            if self.trend:
                params['beta'] = float(self.fitted_model.params.get('smoothing_trend', 0))
                
            if self.seasonal:
                params['gamma'] = float(self.fitted_model.params.get('smoothing_seasonal', 0))
                
            if self.damped_trend:
                params['phi'] = float(self.fitted_model.params.get('damping_trend', 0))
                
            return params
            
        except Exception as e:
            print(f"Parameter extraction failed: {e}")
            return {}
    
    def _calculate_metrics(self) -> Dict[str, float]:
        """Calculate model performance metrics"""
        if not self.fitted_model:
            return {}
            
        try:
            metrics = {
                'aic': float(self.fitted_model.aic),
                'bic': float(self.fitted_model.bic),
                'sse': float(self.fitted_model.sse)  # Sum of squared errors
            }
            
            # In-sample fit metrics
            fitted_values = self.fitted_model.fittedvalues
            actual_values = self.fitted_model.data.endog
            
            if len(fitted_values) > 0 and len(actual_values) > 0:
                residuals = actual_values - fitted_values
                
                # MAE and RMSE
                metrics['mae'] = float(np.mean(np.abs(residuals)))
                metrics['rmse'] = float(np.sqrt(np.mean(residuals**2)))
                
                # MAPE
                non_zero_actual = actual_values[actual_values != 0]
                if len(non_zero_actual) > 0:
                    mape_errors = np.abs(residuals[actual_values != 0] / non_zero_actual)
                    metrics['mape'] = float(np.mean(mape_errors) * 100)
                    
            return metrics
            
        except Exception as e:
            print(f"Metrics calculation failed: {e}")
            return {'aic': float('inf'), 'mae': float('inf')}
    
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Get model performance metrics"""
        return self._calculate_metrics()