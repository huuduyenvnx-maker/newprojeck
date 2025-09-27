"""
Darts-compatible ARIMA model implementation using statsmodels
This provides the same interface as Darts for backward compatibility
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller
from statsmodels.stats.diagnostic import acorr_ljungbox

from .base import BaseTimeSeriesModel, ForecastResult

class DartsCompatARIMAModel(BaseTimeSeriesModel):
    """Darts-compatible ARIMA model using statsmodels backend"""
    
    def __init__(self, p: Optional[int] = None, d: Optional[int] = None, q: Optional[int] = None):
        super().__init__("DartsCompat_ARIMA")
        self.p = p  # Autoregressive order
        self.d = d  # Differencing order  
        self.q = q  # Moving average order
        self.model = None
        self.fitted_model = None
        self.auto_select_order = (p is None or d is None or q is None)
        
    def _check_stationarity(self, series: pd.Series) -> Tuple[bool, int]:
        """Check stationarity and determine differencing order"""
        max_d = 2
        d = 0
        
        for diff_order in range(max_d + 1):
            if diff_order == 0:
                test_series = series
            else:
                test_series = series.diff(diff_order).dropna()
                
            if len(test_series) < 10:  # Need minimum data
                continue
                
            # Augmented Dickey-Fuller test
            try:
                adf_result = adfuller(test_series, autolag='AIC')
                p_value = adf_result[1]
                
                if p_value < 0.05:  # Stationary
                    d = diff_order
                    break
            except:
                continue
                
        return d < max_d, d
    
    def _auto_select_parameters(self, series: pd.Series) -> Tuple[int, int, int]:
        """Automatically select ARIMA(p,d,q) parameters using AIC"""
        
        # Check stationarity and get differencing order
        is_stationary, d_auto = self._check_stationarity(series)
        
        if not is_stationary:
            d_auto = 1  # Force one level of differencing
            
        # Use provided parameters or auto-selected ones
        d_final = self.d if self.d is not None else d_auto
        
        # Grid search for p and q if not provided
        if self.p is None or self.q is None:
            max_p = min(3, len(series) // 10)
            max_q = min(3, len(series) // 10)
            
            best_aic = float('inf')
            best_p, best_q = 1, 1
            
            for p_test in range(max_p + 1):
                for q_test in range(max_q + 1):
                    if p_test == 0 and q_test == 0:
                        continue
                        
                    try:
                        model_test = ARIMA(series, order=(p_test, d_final, q_test))
                        fitted_test = model_test.fit(method_kwargs={"warn_convergence": False})
                        
                        if fitted_test.aic < best_aic:
                            best_aic = fitted_test.aic
                            best_p, best_q = p_test, q_test
                            
                    except:
                        continue
                        
            p_final = self.p if self.p is not None else best_p
            q_final = self.q if self.q is not None else best_q
        else:
            p_final, q_final = self.p, self.q
            
        return p_final, d_final, q_final
    
    def fit(self, data: pd.DataFrame) -> 'DartsCompatARIMAModel':
        """Fit ARIMA model to time series data"""
        data = self.validate_data(data)
        
        # Extract price series
        price_series = pd.Series(data['price'].values, index=data['date'])
        
        if len(price_series) < 10:
            raise ValueError("Need at least 10 data points for ARIMA fitting")
            
        # Auto-select parameters if not provided
        if self.auto_select_order:
            p, d, q = self._auto_select_parameters(price_series)
            print(f"Auto-selected ARIMA({p}, {d}, {q}) parameters")
        else:
            p, d, q = self.p, self.d, self.q
            
        try:
            # Fit ARIMA model
            self.model = ARIMA(price_series, order=(p, d, q))
            self.fitted_model = self.model.fit(method_kwargs={"warn_convergence": False})
            
            print(f"ARIMA({p}, {d}, {q}) fitted successfully. AIC: {self.fitted_model.aic:.2f}")
            
            # Store final parameters
            self.p, self.d, self.q = p, d, q
            self.is_fitted = True
            
            # Validate model
            self._validate_model()
            
        except Exception as e:
            print(f"ARIMA fitting failed: {e}")
            # Try simpler model as fallback
            try:
                self.model = ARIMA(price_series, order=(1, 1, 1))
                self.fitted_model = self.model.fit(method_kwargs={"warn_convergence": False})
                self.p, self.d, self.q = 1, 1, 1
                self.is_fitted = True
                print("Fitted fallback ARIMA(1,1,1) model")
            except Exception as e2:
                raise ValueError(f"ARIMA fitting completely failed: {e2}")
                
        return self
        
    def _validate_model(self) -> None:
        """Validate fitted model using diagnostic tests"""
        if not self.fitted_model:
            return
            
        try:
            # Ljung-Box test for residual autocorrelation
            residuals = self.fitted_model.resid
            lb_test = acorr_ljungbox(residuals, lags=min(10, len(residuals)//4), return_df=True)
            
            # Check if residuals are not autocorrelated (p > 0.05 is good)
            ljung_box_pvalue = lb_test['lb_pvalue'].iloc[-1] if len(lb_test) > 0 else 0.5
            
            if ljung_box_pvalue < 0.05:
                print(f"Warning: Model residuals may be autocorrelated (p={ljung_box_pvalue:.3f})")
                
        except Exception as e:
            print(f"Model validation failed: {e}")
    
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate forecast using fitted ARIMA model"""
        if not self.is_fitted or not self.fitted_model:
            raise ValueError("Model must be fitted before forecasting")
            
        try:
            # Generate forecast
            forecast_result = self.fitted_model.forecast(steps=horizon, alpha=0.05)  # 95% confidence
            
            if hasattr(forecast_result, 'predicted_mean'):
                # Newer statsmodels version
                predictions = forecast_result.predicted_mean.values
                conf_int = forecast_result.conf_int()
                lower_bounds = conf_int.iloc[:, 0].values
                upper_bounds = conf_int.iloc[:, 1].values
            else:
                # Older statsmodels version
                predictions = forecast_result
                # Approximate confidence intervals using prediction standard errors
                forecast_errors = self.fitted_model.forecast(steps=horizon)[1]
                lower_bounds = predictions - 1.96 * forecast_errors
                upper_bounds = predictions + 1.96 * forecast_errors
            
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
            
            # Calculate confidence based on model fit
            base_confidence = max(0.5, 1.0 - (self.fitted_model.aic / 1000))  # Normalize AIC
            confidence_decay = 0.95  # Decay factor for longer horizons
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
                    'arima_order': (self.p, self.d, self.q),
                    'aic': self.fitted_model.aic,
                    'bic': self.fitted_model.bic,
                    'log_likelihood': self.fitted_model.llf,
                    'darts_compatible': True
                }
            )
            
        except Exception as e:
            print(f"ARIMA forecasting failed: {e}")
            raise ValueError(f"Forecasting failed: {e}")
    
    def _calculate_metrics(self) -> Dict[str, float]:
        """Calculate model performance metrics"""
        if not self.fitted_model:
            return {}
            
        try:
            # Get in-sample metrics
            metrics = {
                'aic': float(self.fitted_model.aic),
                'bic': float(self.fitted_model.bic), 
                'log_likelihood': float(self.fitted_model.llf),
                'sigma2': float(self.fitted_model.sigma2)  # Residual variance
            }
            
            # Calculate in-sample fit metrics
            fitted_values = self.fitted_model.fittedvalues
            actual_values = self.fitted_model.data.endog
            
            if len(fitted_values) > 0 and len(actual_values) > 0:
                residuals = actual_values - fitted_values
                
                # MAE and RMSE
                metrics['mae'] = float(np.mean(np.abs(residuals)))
                metrics['rmse'] = float(np.sqrt(np.mean(residuals**2)))
                
                # MAPE (handling division by zero)
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