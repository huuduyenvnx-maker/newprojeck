import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

from .base import BaseTimeSeriesModel, ForecastResult, QuantileForecast
from .arima_model import ARIMAModel  
from .ets_model import ETSModel

class SimpleEnsembleModel(BaseTimeSeriesModel):
    """Simplified ensemble model using ARIMA and ETS (without LightGBM for compatibility)"""
    
    def __init__(self, weights: Optional[Dict[str, float]] = None):
        super().__init__("SimpleEnsemble")
        
        # Initialize individual models (excluding LightGBM)
        self.arima_model = ARIMAModel()
        self.ets_model = ETSModel()
        
        # Model weights (will be optimized based on performance)
        self.weights = weights or {'ARIMA': 0.5, 'ETS': 0.5}
        self.model_results = {}
        self.data = None
        
    def _validate_weights(self) -> None:
        """Ensure weights sum to 1.0"""
        total_weight = sum(self.weights.values())
        if abs(total_weight - 1.0) > 1e-6:
            # Normalize weights
            self.weights = {k: v/total_weight for k, v in self.weights.items()}
            
    def _calculate_optimal_weights(self) -> Dict[str, float]:
        """Calculate optimal weights based on individual model performance"""
        if not self.model_results:
            return self.weights
            
        # Get performance metrics (lower is better for MAE/RMSE)
        performances = {}
        
        for model_name, result in self.model_results.items():
            if result and 'metrics' in result.metadata:
                # Use MAE as primary metric, with MASE as secondary
                mae = result.metadata['metrics'].get('mae', float('inf'))
                mase = result.metadata['metrics'].get('mase', 2.0)
                
                # Combined score (lower is better)
                score = mae + mase * 10
                performances[model_name] = score
            else:
                performances[model_name] = float('inf')
                
        # Convert to inverse scores (higher is better)
        inverse_scores = {}
        for name, score in performances.items():
            if score == float('inf'):
                inverse_scores[name] = 0.1  # Minimal weight for failed models
            else:
                inverse_scores[name] = 1.0 / (1.0 + score)
                
        # Normalize to get weights
        total_score = sum(inverse_scores.values())
        if total_score > 0:
            optimal_weights = {name: score/total_score for name, score in inverse_scores.items()}
        else:
            optimal_weights = {'ARIMA': 0.5, 'ETS': 0.5}
            
        # Ensure minimum weight for each model (avoid complete exclusion)
        min_weight = 0.2
        for name in optimal_weights:
            optimal_weights[name] = max(optimal_weights[name], min_weight)
            
        # Renormalize after minimum weight adjustment
        total_weight = sum(optimal_weights.values())
        optimal_weights = {k: v/total_weight for k, v in optimal_weights.items()}
        
        return optimal_weights
        
    def fit(self, data: pd.DataFrame) -> 'SimpleEnsembleModel':
        """Fit ARIMA and ETS models and calculate optimal weights"""
        # Validate data once
        data = self.validate_data(data)
        self.data = data.copy()
        
        # Fit individual models
        models_to_fit = [
            ('ARIMA', self.arima_model),
            ('ETS', self.ets_model)
        ]
        
        successful_fits = 0
        
        for name, model in models_to_fit:
            try:
                print(f"Fitting {name} model...")
                model.fit(data)
                
                # Test forecast to validate model
                test_forecast = model.forecast(5)  # Short test forecast
                self.model_results[name] = test_forecast
                successful_fits += 1
                
                print(f"{name} model fitted successfully")
                
            except Exception as e:
                print(f"Failed to fit {name} model: {e}")
                self.model_results[name] = None
                
        if successful_fits == 0:
            raise ValueError("All individual models failed to fit")
            
        # Calculate optimal weights based on performance
        self.weights = self._calculate_optimal_weights()
        self._validate_weights()
        
        print(f"Simple Ensemble weights: {self.weights}")
        self.is_fitted = True
        
        return self
        
    def _sanitize_float_array(self, arr: List[float], name: str = "array") -> List[float]:
        """Sanitize array to remove NaN/infinity values and ensure valid floats"""
        sanitized = []
        for i, val in enumerate(arr):
            if np.isnan(val) or np.isinf(val):
                print(f"Warning: Invalid value {val} found in {name} at index {i}, replacing with 0.0")
                sanitized.append(0.0)
            else:
                sanitized.append(float(val))
        return sanitized
        
    def _validate_forecast_consistency(self, forecasts: Dict[str, ForecastResult], horizon: int) -> None:
        """Validate that all forecasts have consistent structure"""
        for name, forecast in forecasts.items():
            if len(forecast.predictions) != horizon:
                raise ValueError(f"{name} forecast has {len(forecast.predictions)} predictions, expected {horizon}")
            if len(forecast.lower_bounds) != horizon:
                raise ValueError(f"{name} forecast has {len(forecast.lower_bounds)} lower bounds, expected {horizon}")
            if len(forecast.upper_bounds) != horizon:
                raise ValueError(f"{name} forecast has {len(forecast.upper_bounds)} upper bounds, expected {horizon}")
            if len(forecast.confidence) != horizon:
                raise ValueError(f"{name} forecast has {len(forecast.confidence)} confidence values, expected {horizon}")
            
            # Ensure all values are numeric
            forecast.predictions = self._sanitize_float_array(forecast.predictions, f"{name}_predictions")
            forecast.lower_bounds = self._sanitize_float_array(forecast.lower_bounds, f"{name}_lower_bounds")
            forecast.upper_bounds = self._sanitize_float_array(forecast.upper_bounds, f"{name}_upper_bounds")
            forecast.confidence = self._sanitize_float_array(forecast.confidence, f"{name}_confidence")
    
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate ensemble forecast combining ARIMA and ETS models"""
        if not self.is_fitted:
            raise ValueError("Ensemble model must be fitted before forecasting")
            
        print(f"Generating ensemble forecast for {horizon} days...")
        
        # Get forecasts from individual models
        individual_forecasts = {}
        
        for name, model in [('ARIMA', self.arima_model), ('ETS', self.ets_model)]:
            if model.is_fitted:
                try:
                    print(f"Getting forecast from {name} model...")
                    forecast = model.forecast(horizon)
                    print(f"{name} forecast shape - predictions: {len(forecast.predictions)}, bounds: {len(forecast.lower_bounds)}/{len(forecast.upper_bounds)}")
                    individual_forecasts[name] = forecast
                except Exception as e:
                    print(f"Failed to get forecast from {name}: {e}")
                    import traceback
                    traceback.print_exc()
                    individual_forecasts[name] = None
            else:
                print(f"{name} model is not fitted, skipping")
                    
        # Filter out failed forecasts
        valid_forecasts = {k: v for k, v in individual_forecasts.items() if v is not None}
        
        if not valid_forecasts:
            raise ValueError("No individual models produced valid forecasts")
            
        print(f"Valid forecasts from: {list(valid_forecasts.keys())}")
        
        # Validate forecast consistency
        self._validate_forecast_consistency(valid_forecasts, horizon)
        
        # Adjust weights for available models
        available_weights = {k: self.weights[k] for k in valid_forecasts.keys()}
        total_weight = sum(available_weights.values())
        if total_weight > 0:
            available_weights = {k: v/total_weight for k, v in available_weights.items()}
        else:
            # Fallback to equal weights
            num_models = len(valid_forecasts)
            available_weights = {k: 1.0/num_models for k in valid_forecasts.keys()}
        
        print(f"Adjusted weights: {available_weights}")
        
        # Combine forecasts
        ensemble_predictions = []
        ensemble_lower_bounds = []
        ensemble_upper_bounds = []
        ensemble_confidence = []
        
        # Use dates from first valid forecast
        first_forecast = next(iter(valid_forecasts.values()))
        forecast_dates = first_forecast.dates
        
        print("Combining forecasts...")
        for i in range(horizon):
            # Weighted average of predictions
            pred_values = []
            for name, forecast in valid_forecasts.items():
                weight = available_weights[name]
                pred_val = forecast.predictions[i]
                weighted_val = weight * pred_val
                pred_values.append(weighted_val)
            
            weighted_pred = sum(pred_values)
            if np.isnan(weighted_pred) or np.isinf(weighted_pred):
                print(f"Warning: Invalid prediction at index {i}, using fallback")
                weighted_pred = np.mean([f.predictions[i] for f in valid_forecasts.values()])
            
            ensemble_predictions.append(float(weighted_pred))
            
            # Weighted average of confidence intervals
            lower_values = [available_weights[name] * forecast.lower_bounds[i] for name, forecast in valid_forecasts.items()]
            weighted_lower = sum(lower_values)
            if np.isnan(weighted_lower) or np.isinf(weighted_lower):
                weighted_lower = np.mean([f.lower_bounds[i] for f in valid_forecasts.values()])
            ensemble_lower_bounds.append(float(weighted_lower))
            
            upper_values = [available_weights[name] * forecast.upper_bounds[i] for name, forecast in valid_forecasts.items()]
            weighted_upper = sum(upper_values)
            if np.isnan(weighted_upper) or np.isinf(weighted_upper):
                weighted_upper = np.mean([f.upper_bounds[i] for f in valid_forecasts.values()])
            ensemble_upper_bounds.append(float(weighted_upper))
            
            # Confidence as weighted average, but penalized for model disagreement
            conf_values = [available_weights[name] * forecast.confidence[i] for name, forecast in valid_forecasts.items()]
            weighted_conf = sum(conf_values)
            if np.isnan(weighted_conf) or np.isinf(weighted_conf):
                weighted_conf = np.mean([f.confidence[i] for f in valid_forecasts.values()])
            
            # Calculate disagreement penalty safely
            predictions_at_i = [forecast.predictions[i] for forecast in valid_forecasts.values()]
            try:
                pred_mean = np.mean(predictions_at_i)
                pred_std = np.std(predictions_at_i)
                
                if pred_mean > 0 and not np.isnan(pred_mean) and not np.isnan(pred_std):
                    disagreement = pred_std / pred_mean
                    if np.isnan(disagreement) or np.isinf(disagreement):
                        disagreement = 0.0
                else:
                    disagreement = 0.0
            except:
                disagreement = 0.0
            
            # Reduce confidence based on model disagreement
            adjusted_confidence = weighted_conf * (1.0 - min(float(disagreement), 0.3))  # Max 30% penalty
            adjusted_confidence = max(adjusted_confidence, 0.5)  # Minimum confidence
            
            if np.isnan(adjusted_confidence) or np.isinf(adjusted_confidence):
                adjusted_confidence = 0.7  # Fallback confidence
            
            ensemble_confidence.append(float(adjusted_confidence))
            
        print(f"Ensemble forecast completed - {len(ensemble_predictions)} predictions generated")
        
        # Combine metrics from individual models
        ensemble_metrics = self._combine_metrics(valid_forecasts)
        
        # Safely calculate disagreement scores for metadata
        safe_disagreement_scores = []
        for i in range(horizon):
            try:
                preds_at_i = [f.predictions[i] for f in valid_forecasts.values()]
                pred_mean = np.mean(preds_at_i)
                pred_std = np.std(preds_at_i)
                
                if pred_mean > 0 and not np.isnan(pred_mean) and not np.isnan(pred_std):
                    disagreement = pred_std / pred_mean
                    if np.isnan(disagreement) or np.isinf(disagreement):
                        disagreement = 0.0
                else:
                    disagreement = 0.0
                    
                safe_disagreement_scores.append(float(disagreement))
            except:
                safe_disagreement_scores.append(0.0)
        
        # Combine metadata
        ensemble_metadata = {
            'individual_models': list(valid_forecasts.keys()),
            'weights': available_weights,
            'model_metrics': {name: forecast.metrics for name, forecast in valid_forecasts.items()},
            'disagreement_scores': safe_disagreement_scores
        }
        
        # Final sanitization of all arrays
        ensemble_predictions = self._sanitize_float_array(ensemble_predictions, "ensemble_predictions")
        ensemble_lower_bounds = self._sanitize_float_array(ensemble_lower_bounds, "ensemble_lower_bounds")
        ensemble_upper_bounds = self._sanitize_float_array(ensemble_upper_bounds, "ensemble_upper_bounds")
        ensemble_confidence = self._sanitize_float_array(ensemble_confidence, "ensemble_confidence")
        
        return ForecastResult(
            dates=forecast_dates,
            predictions=ensemble_predictions,
            lower_bounds=ensemble_lower_bounds,
            upper_bounds=ensemble_upper_bounds,
            confidence=ensemble_confidence,
            model_name=self.name,
            metrics=ensemble_metrics,
            metadata=ensemble_metadata
        )
        
    def _combine_metrics(self, valid_forecasts: Dict[str, ForecastResult]) -> Dict[str, float]:
        """Combine metrics from individual models using weighted average"""
        combined_metrics = {}
        
        # Get all metric names
        all_metrics = set()
        for forecast in valid_forecasts.values():
            all_metrics.update(forecast.metrics.keys())
            
        # Calculate weighted average for each metric
        for metric in all_metrics:
            weighted_values = []
            weights = []
            
            for name, forecast in valid_forecasts.items():
                if metric in forecast.metrics:
                    metric_value = forecast.metrics[metric]
                    # Skip NaN/inf values
                    if not np.isnan(metric_value) and not np.isinf(metric_value):
                        weighted_values.append(metric_value)
                        weights.append(self.weights[name])
                    
            if weighted_values and len(weights) > 0:
                total_weight = sum(weights)
                if total_weight > 0:
                    combined_value = sum(v * w for v, w in zip(weighted_values, weights)) / total_weight
                    # Ensure the result is valid
                    if not np.isnan(combined_value) and not np.isinf(combined_value):
                        combined_metrics[metric] = float(combined_value)
                    else:
                        combined_metrics[metric] = 0.0
                else:
                    combined_metrics[metric] = 0.0
                
        return combined_metrics
        
    def get_quantile_forecast(self, horizon: int) -> QuantileForecast:
        """Generate full quantile forecast with q10, q25, median, q75, q90"""
        if not self.is_fitted:
            raise ValueError("Ensemble model must be fitted before forecasting")
            
        # Get base forecast
        base_forecast = self.forecast(horizon)
        
        # Generate additional quantiles using simple method
        # (Without conformal prediction for simplicity)
        q10_list = base_forecast.lower_bounds
        q90_list = base_forecast.upper_bounds
        median_list = base_forecast.predictions
        
        # Approximate q25 and q75
        q25_list = [median + (q10 - median) * 0.5 for median, q10 in zip(median_list, q10_list)]
        q75_list = [median + (q90 - median) * 0.5 for median, q90 in zip(median_list, q90_list)]
        
        # Calculate trends and volatility
        trends = self.calculate_trend(base_forecast.predictions)
        volatility = self.calculate_volatility(base_forecast.predictions, base_forecast.confidence)
        
        return QuantileForecast(
            dates=base_forecast.dates,
            q10=q10_list,
            q25=q25_list,
            median=median_list,
            q75=q75_list,
            q90=q90_list,
            confidence=base_forecast.confidence,
            trend=trends,
            volatility=volatility
        )
        
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Get ensemble metrics combining individual model performance"""
        if not self.is_fitted:
            return {}
            
        return self._combine_metrics({
            name: result for name, result in self.model_results.items() 
            if result is not None
        })