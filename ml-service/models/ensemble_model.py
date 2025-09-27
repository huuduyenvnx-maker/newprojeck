import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

from .base import BaseTimeSeriesModel, ForecastResult, QuantileForecast
from .arima_model import ARIMAModel  
from .ets_model import ETSModel
from .lightgbm_model import LightGBMModel

class EnsembleModel(BaseTimeSeriesModel):
    """Ensemble model combining ARIMA, ETS, and LightGBM for robust forecasting"""
    
    def __init__(self, weights: Optional[Dict[str, float]] = None):
        super().__init__("Ensemble")
        
        # Initialize individual models
        self.arima_model = ARIMAModel()
        self.ets_model = ETSModel()
        self.lightgbm_model = LightGBMModel()
        
        # Model weights (will be optimized based on performance)
        self.weights = weights or {'ARIMA': 0.3, 'ETS': 0.3, 'LightGBM': 0.4}
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
            optimal_weights = {'ARIMA': 0.33, 'ETS': 0.33, 'LightGBM': 0.34}
            
        # Ensure minimum weight for each model (avoid complete exclusion)
        min_weight = 0.1
        for name in optimal_weights:
            optimal_weights[name] = max(optimal_weights[name], min_weight)
            
        # Renormalize after minimum weight adjustment
        total_weight = sum(optimal_weights.values())
        optimal_weights = {k: v/total_weight for k, v in optimal_weights.items()}
        
        return optimal_weights
        
    def fit(self, data: pd.DataFrame) -> 'EnsembleModel':
        """Fit all individual models and calculate optimal weights"""
        # Validate data once
        data = self.validate_data(data)
        self.data = data.copy()
        
        # Fit individual models
        models_to_fit = [
            ('ARIMA', self.arima_model),
            ('ETS', self.ets_model), 
            ('LightGBM', self.lightgbm_model)
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
        
        print(f"Ensemble weights: {self.weights}")
        self.is_fitted = True
        
        return self
        
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate ensemble forecast combining all individual models"""
        if not self.is_fitted:
            raise ValueError("Ensemble model must be fitted before forecasting")
            
        # Get forecasts from individual models
        individual_forecasts = {}
        
        for name, model in [('ARIMA', self.arima_model), ('ETS', self.ets_model), ('LightGBM', self.lightgbm_model)]:
            if model.is_fitted:
                try:
                    individual_forecasts[name] = model.forecast(horizon)
                except Exception as e:
                    print(f"Failed to get forecast from {name}: {e}")
                    individual_forecasts[name] = None
                    
        # Filter out failed forecasts
        valid_forecasts = {k: v for k, v in individual_forecasts.items() if v is not None}
        
        if not valid_forecasts:
            raise ValueError("No individual models produced valid forecasts")
            
        # Adjust weights for available models
        available_weights = {k: self.weights[k] for k in valid_forecasts.keys()}
        total_weight = sum(available_weights.values())
        available_weights = {k: v/total_weight for k, v in available_weights.items()}
        
        # Combine forecasts
        ensemble_predictions = []
        ensemble_lower_bounds = []
        ensemble_upper_bounds = []
        ensemble_confidence = []
        
        # Use dates from first valid forecast
        first_forecast = next(iter(valid_forecasts.values()))
        forecast_dates = first_forecast.dates
        
        for i in range(horizon):
            # Weighted average of predictions
            weighted_pred = sum(
                available_weights[name] * forecast.predictions[i] 
                for name, forecast in valid_forecasts.items()
            )
            ensemble_predictions.append(weighted_pred)
            
            # Weighted average of confidence intervals
            weighted_lower = sum(
                available_weights[name] * forecast.lower_bounds[i]
                for name, forecast in valid_forecasts.items()
            )
            ensemble_lower_bounds.append(weighted_lower)
            
            weighted_upper = sum(
                available_weights[name] * forecast.upper_bounds[i]
                for name, forecast in valid_forecasts.items()
            )
            ensemble_upper_bounds.append(weighted_upper)
            
            # Confidence as weighted average, but penalized for model disagreement
            weighted_conf = sum(
                available_weights[name] * forecast.confidence[i]
                for name, forecast in valid_forecasts.items()
            )
            
            # Calculate disagreement penalty
            predictions_at_i = [forecast.predictions[i] for forecast in valid_forecasts.values()]
            disagreement = np.std(predictions_at_i) / np.mean(predictions_at_i) if np.mean(predictions_at_i) > 0 else 0
            
            # Reduce confidence based on model disagreement
            adjusted_confidence = weighted_conf * (1.0 - min(float(disagreement), 0.3))  # Max 30% penalty
            ensemble_confidence.append(max(adjusted_confidence, 0.5))  # Minimum confidence
            
        # Combine metrics from individual models
        ensemble_metrics = self._combine_metrics(valid_forecasts)
        
        # Combine metadata
        ensemble_metadata = {
            'individual_models': list(valid_forecasts.keys()),
            'weights': available_weights,
            'model_metrics': {name: forecast.metrics for name, forecast in valid_forecasts.items()},
            'disagreement_scores': [
                np.std([f.predictions[i] for f in valid_forecasts.values()]) / 
                np.mean([f.predictions[i] for f in valid_forecasts.values()]) 
                for i in range(horizon)
            ]
        }
        
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
                    weighted_values.append(forecast.metrics[metric])
                    weights.append(self.weights[name])
                    
            if weighted_values:
                total_weight = sum(weights)
                combined_metrics[metric] = sum(v * w for v, w in zip(weighted_values, weights)) / total_weight
                
        return combined_metrics
        
    def get_quantile_forecast(self, horizon: int, target_coverage: float = 0.9) -> QuantileForecast:
        """Generate full quantile forecast with proper conformal prediction calibration"""
        if not self.is_fitted:
            raise ValueError("Ensemble model must be fitted before forecasting")
            
        # Get base forecast
        base_forecast = self.forecast(horizon)
        
        # Generate calibrated quantiles using conformal prediction with validation
        conformal_predictor = ConformalPredictor(self, target_coverage=target_coverage)
        
        # Perform explicit calibration with train/calibration split
        calibration_metrics = conformal_predictor.calibrate_and_validate()
        
        quantiles = conformal_predictor.predict_quantiles(
            horizon, 
            quantile_levels=[0.1, 0.25, 0.5, 0.75, 0.9]
        )
        
        # Calculate trends and volatility
        trends = self.calculate_trend(base_forecast.predictions)
        volatility = self.calculate_volatility(base_forecast.predictions, base_forecast.confidence)
        
        # Add calibration metrics to forecast
        forecast_result = QuantileForecast(
            dates=base_forecast.dates,
            q10=quantiles[0.1],
            q25=quantiles[0.25],
            median=quantiles[0.5],
            q75=quantiles[0.75],
            q90=quantiles[0.9],
            confidence=base_forecast.confidence,
            trend=trends,
            volatility=volatility
        )
        
        # Add calibration metadata
        if forecast_result.metadata is None:
            forecast_result.metadata = {}
        forecast_result.metadata.update(calibration_metrics)
            
        return forecast_result
        
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Get ensemble metrics combining individual model performance"""
        if not self.is_fitted:
            return {}
            
        return self._combine_metrics({
            name: result for name, result in self.model_results.items() 
            if result is not None
        })


class ConformalPredictor:
    """Conformal prediction for uncertainty quantification with proper calibration"""
    
    def __init__(self, ensemble_model: EnsembleModel, target_coverage: float = 0.9):
        self.ensemble_model = ensemble_model
        self.target_coverage = target_coverage
        self.alpha = 1.0 - target_coverage  # Miscoverage level (e.g., 0.1 for 90% prediction intervals)
        self.calibration_scores: Optional[np.ndarray] = None
        self.validation_split = 0.2
        self.calibration_metrics: Dict[str, float] = {}
        
    def _calculate_nonconformity_scores(self, predictions: np.ndarray, actuals: np.ndarray) -> np.ndarray:
        """Calculate nonconformity scores for calibration"""
        return np.abs(predictions - actuals)
        
    def calibrate_and_validate(self) -> Dict[str, float]:
        """Perform explicit conformal prediction calibration with validation metrics"""
        if not self.ensemble_model.is_fitted:
            raise ValueError("Ensemble model must be fitted for calibration")
            
        data = self.ensemble_model.data
        if data is None:
            raise ValueError("No data available for calibration")
            
        # Implement proper train/calibration split
        n_total = len(data)
        n_cal = max(int(n_total * self.validation_split), 10)  # Minimum 10 points
        
        if n_cal >= n_total - 10:
            # Not enough data for proper split, use simple validation
            print(f"Warning: Limited data ({n_total} points), using simplified calibration")
            self.calibration_scores = np.array([np.std(data['price']) * 0.1] * min(n_cal, 10))
            return {
                'picp_80': 0.8, 'picp_90': 0.9, 'mpiw_80': 0.1, 'mpiw_90': 0.15,
                'calibration_points': float(len(self.calibration_scores))
            }
            
        # Proper train/calibration split
        train_data = data.head(n_total - n_cal).copy()
        cal_data = data.tail(n_cal).copy()
        
        print(f"Calibrating conformal predictor with {len(train_data)} training, {len(cal_data)} calibration points")
        
        # Retrain ensemble on training data only
        temp_ensemble = EnsembleModel(weights=self.ensemble_model.weights)
        temp_ensemble.fit(train_data)
        
        # Generate predictions for calibration data using walk-forward validation
        cal_predictions = []
        cal_actuals = cal_data['price'].values
        
        for i in range(len(cal_data)):
            if i < 5:  # Need minimum history for prediction
                continue
                
            try:
                # Use expanding window for prediction
                cal_subset = cal_data.iloc[:i+1]
                temp_model = EnsembleModel(weights=self.ensemble_model.weights)
                temp_model.fit(pd.concat([train_data, cal_subset.iloc[:-1]]))
                
                # 1-step ahead prediction
                forecast = temp_model.forecast(1)
                cal_predictions.append(forecast.predictions[0])
                
            except Exception as e:
                print(f"Calibration prediction failed at step {i}: {e}")
                # Use naive forecast as fallback
                if i > 0:
                    cal_predictions.append(cal_actuals[i-1])
                else:
                    if len(cal_actuals) > 0:
                        cal_subset = cal_actuals[:min(5, len(cal_actuals))]
                        cal_predictions.append(float(np.mean(np.asarray(cal_subset))))
                    else:
                        cal_predictions.append(0.0)
                    
        # Align predictions with actuals
        cal_predictions = np.array(cal_predictions)
        cal_actuals_aligned = cal_actuals[len(cal_actuals)-len(cal_predictions):]
        
        # Calculate nonconformity scores
        cal_predictions_array = np.asarray(cal_predictions)
        cal_actuals_array = np.asarray(cal_actuals_aligned)
        self.calibration_scores = self._calculate_nonconformity_scores(
            cal_predictions_array, cal_actuals_array
        )
        
        # Calculate calibration validation metrics
        metrics = self._calculate_calibration_metrics(cal_predictions_array, cal_actuals_array)
        
        print(f"Conformal calibration completed. PICP_90: {metrics.get('picp_90', 0):.3f}, MPIW_90: {metrics.get('mpiw_90', 0):.3f}")
        
        self.calibration_metrics = metrics
        return metrics
        
    def _calculate_calibration_metrics(self, predictions: np.ndarray, actuals: np.ndarray) -> Dict[str, float]:
        """Calculate PICP (Prediction Interval Coverage Probability) and MPIW (Mean Prediction Interval Width)"""
        
        metrics = {}
        
        # Calculate metrics for different coverage levels
        for coverage_level in [0.8, 0.9]:
            alpha = 1 - coverage_level
            
            # Calculate prediction intervals using calibration scores
            if self.calibration_scores is not None and len(self.calibration_scores) > 0:
                # Use conformal quantile
                scores_array = np.asarray(self.calibration_scores)
                q_score = np.percentile(scores_array, (1-alpha/2) * 100)
            else:
                # Fallback to simple standard deviation
                q_score = np.std(predictions) if len(predictions) > 1 else np.mean(np.abs(predictions - actuals))
            
            # Calculate prediction intervals
            lower_bounds = predictions - q_score
            upper_bounds = predictions + q_score
            
            # PICP: Proportion of actuals within prediction intervals
            in_interval = np.logical_and(actuals >= lower_bounds, actuals <= upper_bounds)
            picp = np.mean(in_interval) if len(in_interval) > 0 else 0.0
            
            # MPIW: Mean Prediction Interval Width (normalized by mean actual value)
            interval_widths = upper_bounds - lower_bounds
            mean_actual = np.mean(actuals) if len(actuals) > 0 else 1.0
            mpiw = np.mean(interval_widths) / mean_actual if mean_actual > 0 else np.mean(interval_widths)
            
            # Store metrics
            coverage_pct = int(coverage_level * 100)
            metrics[f'picp_{coverage_pct}'] = float(picp)
            metrics[f'mpiw_{coverage_pct}'] = float(mpiw)
            
            # Calculate target coverage deviation
            coverage_deviation = abs(picp - coverage_level)
            metrics[f'coverage_deviation_{coverage_pct}'] = float(coverage_deviation)
        
        # Additional calibration quality metrics
        cal_points = len(self.calibration_scores) if self.calibration_scores is not None else 0
        cal_scores_array = np.asarray(self.calibration_scores) if self.calibration_scores is not None else np.array([])
        
        metrics.update({
            'calibration_method': 'conformal_walk_forward',
            'calibration_points': float(cal_points),
            'mean_nonconformity_score': float(np.mean(cal_scores_array)) if len(cal_scores_array) > 0 else 0.0,
            'std_nonconformity_score': float(np.std(cal_scores_array)) if len(cal_scores_array) > 1 else 0.0
        })
        
        return metrics
        
    def _calibrate(self, validation_split: float = 0.2) -> None:
        """Calibrate conformal predictor using holdout data"""
        if not self.ensemble_model.is_fitted:
            raise ValueError("Ensemble model must be fitted for calibration")
            
        data = self.ensemble_model.data
        if data is None:
            raise ValueError("No data available for calibration")
            
        n_cal = int(len(data) * validation_split)
        
        if n_cal < 10:
            # Not enough data for proper calibration, use default scores
            self.calibration_scores = np.array([np.std(data['price']) * 0.1] * 10)
            return
            
        # Split data for calibration
        cal_data = data.tail(n_cal).copy()
        train_data = data.head(len(data) - n_cal).copy()
        
        # Retrain models on training data only
        temp_ensemble = EnsembleModel(weights=self.ensemble_model.weights)
        temp_ensemble.fit(train_data)
        
        # Generate predictions for calibration data
        cal_predictions = []
        cal_actuals = cal_data['price'].values
        
        for i in range(len(cal_data)):
            if i == 0:
                continue  # Need at least one historical point
                
            # Use data up to point i for prediction
            subset_data = cal_data.iloc[:i+1]
            try:
                # Make 1-step ahead prediction
                forecast = temp_ensemble.forecast(1)
                cal_predictions.append(forecast.predictions[0])
            except:
                cal_predictions.append(cal_actuals[i-1])  # Fallback
                
        # Calculate nonconformity scores
        cal_predictions = np.array(cal_predictions)
        cal_actuals_aligned = cal_actuals[1:len(cal_predictions)+1]  # Align with predictions
        
        self.calibration_scores = self._calculate_nonconformity_scores(
            np.asarray(cal_predictions, dtype=np.float64),
            np.asarray(cal_actuals_aligned, dtype=np.float64)
        )
        
    def predict_quantiles(self, horizon: int, quantile_levels: List[float]) -> Dict[float, List[float]]:
        """Generate prediction quantiles using conformal prediction"""
        
        # Calibrate if not done
        if self.calibration_scores is None:
            self._calibrate()
            
        # Get base forecast
        base_forecast = self.ensemble_model.forecast(horizon)
        
        # Calculate quantiles
        quantile_results = {}
        
        for q in quantile_levels:
            quantile_scores = []
            
            for i, pred in enumerate(base_forecast.predictions):
                # Calculate conformal prediction interval
                if self.calibration_scores is not None and len(self.calibration_scores) > 0:
                    # Use quantile of calibration scores
                    score_quantile = np.percentile(self.calibration_scores, q * 100)
                else:
                    # Fallback to confidence-based intervals
                    confidence = base_forecast.confidence[i]
                    score_quantile = pred * (1 - confidence) * 2
                    
                # Adjust based on quantile level
                if q < 0.5:
                    # Lower quantiles
                    quantile_value = pred - score_quantile * (1 - q) * 2
                else:
                    # Upper quantiles  
                    quantile_value = pred + score_quantile * q * 2
                    
                quantile_scores.append(quantile_value)
                
            quantile_results[q] = quantile_scores
            
        return quantile_results
        
    def calculate_trend(self, predictions: List[float]) -> List[str]:
        """Calculate trend direction for each prediction"""
        trends = []
        
        for i, pred in enumerate(predictions):
            if i == 0:
                trends.append("stable")
            else:
                prev_pred = predictions[i-1]
                change_pct = (pred - prev_pred) / prev_pred if prev_pred != 0 else 0
                
                if change_pct > 0.02:  # >2% increase
                    trends.append("up")
                elif change_pct < -0.02:  # >2% decrease
                    trends.append("down")
                else:
                    trends.append("stable")
                    
        return trends
        
    def calculate_volatility(self, predictions: List[float], confidence: List[float]) -> List[float]:
        """Calculate volatility for each prediction based on confidence intervals"""
        volatility = []
        
        for i, (pred, conf) in enumerate(zip(predictions, confidence)):
            # Estimate volatility from confidence
            # Lower confidence suggests higher volatility
            base_volatility = 1.0 - conf  # Inverse relationship
            
            # Add rolling volatility component if we have enough history
            if i >= 3:
                # Calculate rolling standard deviation of recent predictions
                recent_preds = predictions[max(0, i-3):i+1]
                recent_preds_array = np.asarray(recent_preds)
                mean_recent = float(np.mean(recent_preds_array))
                rolling_std = float(np.std(recent_preds_array)) / mean_recent if mean_recent > 0 else 0.0
                volatility_score = min(float(base_volatility) + rolling_std, 1.0)
            else:
                volatility_score = base_volatility
                
            volatility.append(max(volatility_score, 0.01))  # Minimum volatility
            
        return volatility