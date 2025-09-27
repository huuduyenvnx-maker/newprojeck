import optuna
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple, Callable
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

from .arima_model import ARIMAModel
from .ets_model import ETSModel
from .lightgbm_model import LightGBMModel
from .ensemble_model import EnsembleModel
from .base import BaseTimeSeriesModel, ForecastResult

class OptimizationObjectives:
    """Optimization objectives for Optuna hyperparameter tuning"""
    
    def __init__(self, 
                 data: pd.DataFrame,
                 horizon: int = 30,
                 cv_folds: int = 3,
                 test_size_ratio: float = 0.2,
                 vietnamese_market_focus: bool = True):
        
        self.data = data
        self.horizon = horizon
        self.cv_folds = cv_folds
        self.test_size_ratio = test_size_ratio
        self.vietnamese_market_focus = vietnamese_market_focus
        
        # Prepare data splits for cross-validation
        self._prepare_data_splits()
        
        # Vietnamese market specific settings
        if vietnamese_market_focus:
            self.seasonal_patterns = [7, 30, 365]  # Weekly, monthly, yearly
            self.commodity_seasonality = {
                'rice': [7, 30, 120, 365],  # Include harvest cycles
                'coffee': [7, 30, 180, 365],  # Coffee harvest patterns
                'pepper': [7, 30, 90, 365],   # Pepper seasonality
                'fertilizer': [7, 30, 90, 180]  # Fertilizer demand cycles
            }
        else:
            self.seasonal_patterns = [7, 30]
            
    def _prepare_data_splits(self):
        """Prepare time series cross-validation splits"""
        self.tscv = TimeSeriesSplit(n_splits=self.cv_folds)
        
        # Ensure minimum data for each fold
        min_train_size = max(60, self.horizon * 2)  # At least 60 observations for training
        self.tscv = TimeSeriesSplit(n_splits=self.cv_folds, max_train_size=None)
        
    def _calculate_mase(self, y_true: np.ndarray, y_pred: np.ndarray, y_train: np.ndarray) -> float:
        """Calculate Mean Absolute Scaled Error"""
        try:
            # Calculate naive forecast MAE (seasonal naive with period=1 for simplicity)
            naive_mae = np.mean(np.abs(y_train[1:] - y_train[:-1]))
            if naive_mae == 0:
                naive_mae = 1e-8  # Avoid division by zero
                
            mae = np.mean(np.abs(y_true - y_pred))
            mase = mae / naive_mae
            
            return mase if not np.isnan(mase) else 999.0
        except:
            return 999.0
            
    def _calculate_smape(self, y_true: np.ndarray, y_pred: np.ndarray) -> float:
        """Calculate Symmetric Mean Absolute Percentage Error"""
        try:
            denominator = (np.abs(y_true) + np.abs(y_pred)) / 2
            # Avoid division by zero
            denominator = np.where(denominator == 0, 1e-8, denominator)
            smape = np.mean(np.abs(y_true - y_pred) / denominator) * 100
            return smape if not np.isnan(smape) else 999.0
        except:
            return 999.0
            
    def _calculate_picp(self, y_true: np.ndarray, lower_bound: np.ndarray, upper_bound: np.ndarray) -> float:
        """Calculate Prediction Interval Coverage Probability"""
        try:
            coverage = np.mean((y_true >= lower_bound) & (y_true <= upper_bound)) * 100
            return coverage if not np.isnan(coverage) else 0.0
        except:
            return 0.0
            
    def _evaluate_model_cv(self, model: BaseTimeSeriesModel) -> Dict[str, float]:
        """Evaluate model using time series cross-validation"""
        mase_scores = []
        smape_scores = []
        picp_scores = []
        
        for train_idx, test_idx in self.tscv.split(self.data):
            try:
                # Split data
                train_data = self.data.iloc[train_idx].copy()
                test_data = self.data.iloc[test_idx].copy()
                
                # Skip if test set is too small
                if len(test_data) < self.horizon:
                    continue
                    
                # Fit model on training data
                model.fit(train_data)
                
                # Generate forecast
                forecast_horizon = min(self.horizon, len(test_data))
                forecast_result = model.forecast(forecast_horizon)
                
                # Extract actual and predicted values
                y_true = test_data['price'].values[:forecast_horizon]
                y_pred = forecast_result.predictions[:forecast_horizon]
                
                # Extract prediction intervals if available
                lower_bounds = getattr(forecast_result, 'lower_bounds', None)
                upper_bounds = getattr(forecast_result, 'upper_bounds', None)
                
                if lower_bounds is not None and upper_bounds is not None:
                    lower_bounds = lower_bounds[:forecast_horizon]
                    upper_bounds = upper_bounds[:forecast_horizon]
                else:
                    # Use quantile forecasts if available
                    quantile_forecasts = getattr(forecast_result, 'quantile_forecasts', [])
                    if quantile_forecasts:
                        lower_bounds = [qf.q10 for qf in quantile_forecasts[:forecast_horizon]]
                        upper_bounds = [qf.q90 for qf in quantile_forecasts[:forecast_horizon]]
                    else:
                        # Fallback: use prediction +/- 20%
                        lower_bounds = y_pred * 0.8
                        upper_bounds = y_pred * 1.2
                
                # Calculate metrics
                mase = self._calculate_mase(y_true, y_pred, train_data['price'].values)
                smape = self._calculate_smape(y_true, y_pred)
                picp = self._calculate_picp(y_true, lower_bounds, upper_bounds)
                
                # Only include valid scores
                if mase < 999:
                    mase_scores.append(mase)
                if smape < 999:
                    smape_scores.append(smape)
                if picp > 0:
                    picp_scores.append(picp)
                    
            except Exception as e:
                print(f"CV fold failed: {e}")
                continue
                
        # Calculate average metrics
        avg_mase = np.mean(mase_scores) if mase_scores else 999.0
        avg_smape = np.mean(smape_scores) if smape_scores else 999.0
        avg_picp = np.mean(picp_scores) if picp_scores else 0.0
        
        return {
            'mase': avg_mase,
            'smape': avg_smape,
            'picp': avg_picp,
            'cv_folds_completed': len(mase_scores)
        }
        
    def objective_arima(self, trial: optuna.Trial) -> float:
        """Objective function for ARIMA hyperparameter optimization"""
        # Define search space
        p = trial.suggest_int('p', 0, 5)
        d = trial.suggest_int('d', 0, 2)
        q = trial.suggest_int('q', 0, 5)
        
        # Seasonal parameters
        seasonal = trial.suggest_categorical('seasonal', [True, False])
        if seasonal:
            seasonal_periods = trial.suggest_categorical('seasonal_periods', 
                                                       self.seasonal_patterns)
            seasonal_order = (
                trial.suggest_int('seasonal_p', 0, 2),
                trial.suggest_int('seasonal_d', 0, 1),
                trial.suggest_int('seasonal_q', 0, 2),
                seasonal_periods
            )
        else:
            seasonal_order = None
            
        try:
            # Create model with suggested parameters
            model = ARIMAModel(order=(p, d, q), seasonal_order=seasonal_order)
            
            # Evaluate using cross-validation
            metrics = self._evaluate_model_cv(model)
            
            # Multi-objective optimization
            mase = metrics['mase']
            picp = metrics['picp']
            
            # Add constraint for PICP >= 90%
            if picp < 90.0:
                penalty = (90.0 - picp) * 0.1  # Penalty for low coverage
                mase += penalty
                
            # Store intermediate values
            trial.set_user_attr('smape', metrics['smape'])
            trial.set_user_attr('picp', metrics['picp'])
            trial.set_user_attr('cv_folds', metrics['cv_folds_completed'])
            
            return mase
            
        except Exception as e:
            print(f"ARIMA trial failed: {e}")
            return 999.0
            
    def objective_ets(self, trial: optuna.Trial) -> float:
        """Objective function for ETS hyperparameter optimization"""
        # Define search space
        trend = trial.suggest_categorical('trend', ['add', 'mul', None])
        seasonal = trial.suggest_categorical('seasonal', ['add', 'mul', None])
        damped = trial.suggest_categorical('damped', [True, False]) if trend is not None else False
        
        seasonal_periods = 7  # Default weekly
        if seasonal is not None:
            seasonal_periods = trial.suggest_categorical('seasonal_periods',
                                                       self.seasonal_patterns)
            
        try:
            # Create model with suggested parameters
            model = ETSModel(
                trend=trend,
                seasonal=seasonal,
                seasonal_periods=seasonal_periods
            )
            
            # Evaluate using cross-validation
            metrics = self._evaluate_model_cv(model)
            
            # Multi-objective optimization
            mase = metrics['mase']
            picp = metrics['picp']
            
            # Add constraint for PICP >= 90%
            if picp < 90.0:
                penalty = (90.0 - picp) * 0.1
                mase += penalty
                
            # Store intermediate values
            trial.set_user_attr('smape', metrics['smape'])
            trial.set_user_attr('picp', metrics['picp'])
            trial.set_user_attr('cv_folds', metrics['cv_folds_completed'])
            
            return mase
            
        except Exception as e:
            print(f"ETS trial failed: {e}")
            return 999.0
            
    def objective_lightgbm(self, trial: optuna.Trial) -> float:
        """Objective function for LightGBM hyperparameter optimization"""
        # Define search space
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 500),
            'max_depth': trial.suggest_int('max_depth', 3, 15),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'num_leaves': trial.suggest_int('num_leaves', 10, 100),
            'feature_fraction': trial.suggest_float('feature_fraction', 0.4, 1.0),
            'bagging_fraction': trial.suggest_float('bagging_fraction', 0.4, 1.0),
            'min_data_in_leaf': trial.suggest_int('min_data_in_leaf', 5, 100),
            'lambda_l1': trial.suggest_float('lambda_l1', 0, 10, log=True),
            'lambda_l2': trial.suggest_float('lambda_l2', 0, 10, log=True),
        }
        
        try:
            # Create model with suggested parameters
            model = LightGBMModel(**params)
            
            # Evaluate using cross-validation
            metrics = self._evaluate_model_cv(model)
            
            # Multi-objective optimization
            mase = metrics['mase']
            picp = metrics['picp']
            
            # Add constraint for PICP >= 90%
            if picp < 90.0:
                penalty = (90.0 - picp) * 0.1
                mase += penalty
                
            # Store intermediate values
            trial.set_user_attr('smape', metrics['smape'])
            trial.set_user_attr('picp', metrics['picp'])
            trial.set_user_attr('cv_folds', metrics['cv_folds_completed'])
            
            return mase
            
        except Exception as e:
            print(f"LightGBM trial failed: {e}")
            return 999.0
            
    def objective_ensemble_weights(self, trial: optuna.Trial) -> float:
        """Objective function for ensemble weight optimization"""
        # Define weight search space with constraint sum=1, min_weight=0.1
        base_weight = 0.1  # Minimum weight for each model
        remaining_weight = 1.0 - 3 * base_weight  # Remaining weight to distribute
        
        # Sample relative weights
        w1 = trial.suggest_float('weight_arima_rel', 0, 1)
        w2 = trial.suggest_float('weight_ets_rel', 0, 1)
        w3 = trial.suggest_float('weight_lightgbm_rel', 0, 1)
        
        # Normalize and add base weights
        total_rel = w1 + w2 + w3
        if total_rel > 0:
            weights = {
                'ARIMA': base_weight + (w1 / total_rel) * remaining_weight,
                'ETS': base_weight + (w2 / total_rel) * remaining_weight,
                'LightGBM': base_weight + (w3 / total_rel) * remaining_weight
            }
        else:
            weights = {'ARIMA': 1/3, 'ETS': 1/3, 'LightGBM': 1/3}
            
        try:
            # Create ensemble model with suggested weights
            model = EnsembleModel(weights=weights)
            
            # Evaluate using cross-validation
            metrics = self._evaluate_model_cv(model)
            
            # Multi-objective optimization
            mase = metrics['mase']
            picp = metrics['picp']
            
            # Add constraint for PICP >= 90%
            if picp < 90.0:
                penalty = (90.0 - picp) * 0.1
                mase += penalty
                
            # Store intermediate values and weights
            trial.set_user_attr('smape', metrics['smape'])
            trial.set_user_attr('picp', metrics['picp'])
            trial.set_user_attr('cv_folds', metrics['cv_folds_completed'])
            trial.set_user_attr('final_weights', weights)
            
            return mase
            
        except Exception as e:
            print(f"Ensemble trial failed: {e}")
            return 999.0
            
    def multi_objective_combined(self, trial: optuna.Trial) -> Tuple[float, float]:
        """Multi-objective optimization combining accuracy and coverage"""
        # Model selection
        model_type = trial.suggest_categorical('model_type', ['arima', 'ets', 'lightgbm', 'ensemble'])
        
        if model_type == 'arima':
            mase = self.objective_arima(trial)
        elif model_type == 'ets':
            mase = self.objective_ets(trial)
        elif model_type == 'lightgbm':
            mase = self.objective_lightgbm(trial)
        else:  # ensemble
            mase = self.objective_ensemble_weights(trial)
            
        # Get PICP from user attributes
        picp = trial.user_attrs.get('picp', 0.0)
        
        # Return both objectives (minimize MASE, maximize PICP)
        return mase, -picp  # Negative PICP to minimize

def create_study_for_model(model_type: str,
                          study_name: str,
                          storage_url: Optional[str] = None,
                          direction: str = 'minimize') -> optuna.Study:
    """Create Optuna study for specific model type"""
    
    # Configure sampler for Vietnamese agricultural data
    sampler = optuna.samplers.TPESampler(
        n_startup_trials=20,  # More startup trials for complex search space
        n_ei_candidates=48,   # More candidates for better optimization
        seed=42
    )
    
    # Configure pruner for early stopping
    pruner = optuna.pruners.MedianPruner(
        n_startup_trials=10,
        n_warmup_steps=5,
        interval_steps=1
    )
    
    # Create study
    study = optuna.create_study(
        study_name=study_name,
        sampler=sampler,
        pruner=pruner,
        direction=direction,
        storage=storage_url,
        load_if_exists=True
    )
    
    return study

def create_multi_objective_study(study_name: str,
                               storage_url: Optional[str] = None) -> optuna.Study:
    """Create multi-objective optimization study"""
    
    sampler = optuna.samplers.NSGAIISampler(
        population_size=50,
        mutation_prob=None,
        crossover_prob=0.9,
        swapping_prob=0.5,
        seed=42
    )
    
    study = optuna.create_study(
        study_name=study_name,
        sampler=sampler,
        directions=['minimize', 'minimize'],  # Minimize MASE, minimize -PICP
        storage=storage_url,
        load_if_exists=True
    )
    
    return study