import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple, Callable
import logging
import asyncio
import concurrent.futures
from datetime import datetime, timedelta
import json
import os
import threading
import time

# Try to import Optuna with fallback handling
OPTUNA_AVAILABLE = False
try:
    import optuna
    OPTUNA_AVAILABLE = True
    print("✅ Optuna imported successfully")
except ImportError as e:
    print(f"⚠️ Optuna not available: {e}")
    print("📊 HPO service will not be functional without Optuna")

# Try to import optimization objectives with fallback handling
OPTUNA_OBJECTIVES_AVAILABLE = False
try:
    from models.optuna_objectives import (
        OptimizationObjectives, 
        create_study_for_model,
        create_multi_objective_study
    )
    OPTUNA_OBJECTIVES_AVAILABLE = True
    print("✅ Optuna objectives imported successfully")
except ImportError as e:
    print(f"⚠️ Optuna objectives not available: {e}")

# Import models and services
from models.arima_model import ARIMAModel
from models.ets_model import ETSModel

# Try to import LightGBM and ensemble models
try:
    from models.lightgbm_model import LightGBMModel
    from models.ensemble_model import EnsembleModel
    LIGHTGBM_MODELS_AVAILABLE = True
except ImportError as e:
    print(f"⚠️ LightGBM models not available in HPO service: {e}")
    LIGHTGBM_MODELS_AVAILABLE = False

# Import MLflow service
from services.mlflow_service import MLflowService

logger = logging.getLogger(__name__)

class HPOService:
    """Hyperparameter Optimization Service using Optuna and MLflow"""
    
    def __init__(self, 
                 mlflow_tracking_uri: Optional[str] = None,
                 optuna_storage_url: Optional[str] = None,
                 max_workers: int = 4):
        
        self.mlflow_service = MLflowService(tracking_uri=mlflow_tracking_uri)
        self.optuna_storage_url = optuna_storage_url or "sqlite:///optuna_studies.db"
        self.max_workers = max_workers
        
        # Optimization status tracking
        self.active_studies: Dict[str, optuna.Study] = {}
        self.optimization_status: Dict[str, Dict] = {}
        
        # Vietnamese market specific configuration
        self.vietnamese_commodities = {
            'rice': {'seasonal_periods': [7, 30, 120, 365], 'harvest_cycles': [120, 240]},
            'coffee': {'seasonal_periods': [7, 30, 180, 365], 'harvest_cycles': [180, 360]},
            'pepper': {'seasonal_periods': [7, 30, 90, 365], 'harvest_cycles': [90, 180]},
            'fertilizer': {'seasonal_periods': [7, 30, 90, 180], 'harvest_cycles': [90, 180]}
        }
        
        # Threading for concurrent optimization
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        
    def _detect_commodity_type(self, commodity_id: str) -> str:
        """Detect commodity type from ID for Vietnamese market optimization"""
        commodity_lower = commodity_id.lower()
        
        if 'rice' in commodity_lower or 'gạo' in commodity_lower:
            return 'rice'
        elif 'coffee' in commodity_lower or 'cà phê' in commodity_lower:
            return 'coffee'
        elif 'pepper' in commodity_lower or 'tiêu' in commodity_lower:
            return 'pepper'
        elif 'fertilizer' in commodity_lower or 'phân bón' in commodity_lower:
            return 'fertilizer'
        else:
            return 'generic'
            
    def _prepare_optimization_data(self, 
                                  historical_data: List[Dict],
                                  commodity_id: str,
                                  region_id: str) -> pd.DataFrame:
        """Prepare data for optimization with Vietnamese market considerations"""
        
        # Convert to DataFrame
        df = pd.DataFrame(historical_data)
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date').reset_index(drop=True)
        
        # Vietnamese market specific preprocessing
        commodity_type = self._detect_commodity_type(commodity_id)
        
        # Add Vietnamese market features
        df['month'] = df['date'].dt.month
        df['quarter'] = df['date'].dt.quarter
        df['is_tet_season'] = df['month'].isin([1, 2])  # Tet holiday impact
        df['is_harvest_season'] = False
        
        # Commodity-specific harvest seasons
        if commodity_type == 'rice':
            df['is_harvest_season'] = df['month'].isin([6, 7, 11, 12])  # Two rice harvests
        elif commodity_type == 'coffee':
            df['is_harvest_season'] = df['month'].isin([11, 12, 1, 2, 3])  # Coffee harvest
        elif commodity_type == 'pepper':
            df['is_harvest_season'] = df['month'].isin([3, 4, 5])  # Pepper harvest
            
        # Regional considerations (Mekong Delta focus)
        if 'mekong' in region_id.lower() or 'delta' in region_id.lower():
            df['is_mekong_region'] = True
            df['monsoon_impact'] = df['month'].isin([5, 6, 7, 8, 9, 10])
        else:
            df['is_mekong_region'] = False
            df['monsoon_impact'] = False
            
        # Ensure minimum data requirements
        if len(df) < 60:
            raise ValueError(f"Insufficient data: {len(df)} points. Need at least 60 for reliable optimization.")
            
        return df
        
    async def optimize_single_model(self,
                                   model_type: str,
                                   historical_data: List[Dict],
                                   commodity_id: str,
                                   region_id: str,
                                   n_trials: int = 100,
                                   timeout: Optional[int] = 3600) -> Dict[str, Any]:
        """Optimize hyperparameters for a single model type"""
        
        study_name = f"hpo_{model_type}_{commodity_id}_{region_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            # Prepare data
            df = self._prepare_optimization_data(historical_data, commodity_id, region_id)
            
            # Create optimization objectives
            commodity_type = self._detect_commodity_type(commodity_id)
            seasonal_patterns = self.vietnamese_commodities.get(commodity_type, {}).get('seasonal_periods', [7, 30])
            
            objectives = OptimizationObjectives(
                data=df,
                horizon=30,
                cv_folds=3,
                vietnamese_market_focus=True
            )
            
            # Create study
            study = create_study_for_model(
                model_type=model_type,
                study_name=study_name,
                storage_url=self.optuna_storage_url
            )
            
            self.active_studies[study_name] = study
            self.optimization_status[study_name] = {
                'status': 'running',
                'start_time': datetime.now().isoformat(),
                'model_type': model_type,
                'commodity_id': commodity_id,
                'region_id': region_id,
                'progress': 0,
                'best_value': None,
                'current_trial': 0,
                'total_trials': n_trials
            }
            
            # Select objective function
            if model_type == 'arima':
                objective_func = objectives.objective_arima
            elif model_type == 'ets':
                objective_func = objectives.objective_ets
            elif model_type == 'lightgbm':
                objective_func = objectives.objective_lightgbm
            elif model_type == 'ensemble':
                objective_func = objectives.objective_ensemble_weights
            else:
                raise ValueError(f"Unsupported model type: {model_type}")
                
            # Optimize with MLflow tracking
            best_params = None
            best_value = float('inf')
            
            def objective_with_logging(trial):
                try:
                    # Start MLflow run
                    with self.mlflow_service.start_run(
                        run_name=f"{study_name}_trial_{trial.number}",
                        tags={
                            'model_type': model_type,
                            'commodity_id': commodity_id,
                            'region_id': region_id,
                            'trial_number': str(trial.number),
                            'optimization_type': 'single_model'
                        }
                    ):
                        # Run optimization
                        value = objective_func(trial)
                        
                        # Log parameters and metrics
                        self.mlflow_service.log_parameters(trial.params)
                        self.mlflow_service.log_metrics({
                            'objective_value': value,
                            'mase': value,
                            'smape': trial.user_attrs.get('smape', 0),
                            'picp': trial.user_attrs.get('picp', 0),
                            'cv_folds_completed': trial.user_attrs.get('cv_folds', 0)
                        })
                        
                        # Update progress
                        self.optimization_status[study_name]['current_trial'] = trial.number
                        self.optimization_status[study_name]['progress'] = (trial.number / n_trials) * 100
                        if value < self.optimization_status[study_name].get('best_value', float('inf')):
                            self.optimization_status[study_name]['best_value'] = value
                            
                        # Log optimization progress
                        self.mlflow_service.log_optimization_progress(study, trial.number)
                        
                        return value
                        
                except Exception as e:
                    logger.error(f"Trial {trial.number} failed: {e}")
                    return 999.0
                    
            # Run optimization
            study.optimize(
                objective_with_logging,
                n_trials=n_trials,
                timeout=timeout,
                callbacks=[
                    lambda study, trial: self._trial_callback(study_name, study, trial)
                ]
            )
            
            # Get best results
            best_params = study.best_params
            best_value = study.best_value
            
            # Log parameter importance
            try:
                self.mlflow_service.log_parameter_importance(study)
            except Exception as e:
                logger.warning(f"Failed to log parameter importance: {e}")
                
            # Update status
            self.optimization_status[study_name].update({
                'status': 'completed',
                'end_time': datetime.now().isoformat(),
                'best_params': best_params,
                'best_value': best_value,
                'total_trials_completed': len(study.trials)
            })
            
            # Create and register best model
            best_model = self._create_model_with_params(model_type, best_params)
            best_model.fit(df)
            
            # Register best model in MLflow
            with self.mlflow_service.start_run(
                run_name=f"{study_name}_best_model",
                tags={'model_type': model_type, 'best_model': 'true'}
            ):
                self.mlflow_service.log_parameters(best_params)
                self.mlflow_service.log_metrics({
                    'best_mase': best_value,
                    'optimization_trials': len(study.trials)
                })
                
                model_version = self.mlflow_service.register_best_model(
                    best_model, 
                    f"{model_type}_optimized",
                    description=f"Best {model_type} model for {commodity_id} in {region_id}"
                )
                
            return {
                'study_name': study_name,
                'model_type': model_type,
                'best_params': best_params,
                'best_value': best_value,
                'model_version': model_version,
                'trials_completed': len(study.trials),
                'commodity_id': commodity_id,
                'region_id': region_id,
                'optimization_time': self.optimization_status[study_name].get('end_time')
            }
            
        except Exception as e:
            logger.error(f"Optimization failed for {model_type}: {e}")
            self.optimization_status[study_name]['status'] = 'failed'
            self.optimization_status[study_name]['error'] = str(e)
            raise
            
    async def optimize_ensemble_weights(self,
                                      historical_data: List[Dict],
                                      commodity_id: str,
                                      region_id: str,
                                      base_model_params: Optional[Dict[str, Dict]] = None,
                                      n_trials: int = 50) -> Dict[str, Any]:
        """Optimize ensemble model weights with pre-trained base models"""
        
        study_name = f"ensemble_weights_{commodity_id}_{region_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            # Prepare data
            df = self._prepare_optimization_data(historical_data, commodity_id, region_id)
            
            # Create optimization objectives
            objectives = OptimizationObjectives(
                data=df,
                horizon=30,
                cv_folds=3,
                vietnamese_market_focus=True
            )
            
            # Create study
            study = create_study_for_model(
                model_type='ensemble',
                study_name=study_name,
                storage_url=self.optuna_storage_url
            )
            
            self.active_studies[study_name] = study
            self.optimization_status[study_name] = {
                'status': 'running',
                'start_time': datetime.now().isoformat(),
                'model_type': 'ensemble_weights',
                'commodity_id': commodity_id,
                'region_id': region_id,
                'progress': 0,
                'best_value': None,
                'current_trial': 0,
                'total_trials': n_trials
            }
            
            # Optimize with MLflow tracking
            def objective_with_logging(trial):
                try:
                    with self.mlflow_service.start_run(
                        run_name=f"{study_name}_trial_{trial.number}",
                        tags={
                            'model_type': 'ensemble_weights',
                            'commodity_id': commodity_id,
                            'region_id': region_id,
                            'trial_number': str(trial.number)
                        }
                    ):
                        # Run ensemble weight optimization
                        value = objectives.objective_ensemble_weights(trial)
                        
                        # Get optimized weights
                        final_weights = trial.user_attrs.get('final_weights', {})
                        
                        # Log parameters and metrics
                        self.mlflow_service.log_parameters(trial.params)
                        self.mlflow_service.log_ensemble_weights(final_weights)
                        self.mlflow_service.log_metrics({
                            'ensemble_mase': value,
                            'ensemble_smape': trial.user_attrs.get('smape', 0),
                            'ensemble_picp': trial.user_attrs.get('picp', 0)
                        })
                        
                        # Update progress
                        self.optimization_status[study_name]['current_trial'] = trial.number
                        self.optimization_status[study_name]['progress'] = (trial.number / n_trials) * 100
                        
                        return value
                        
                except Exception as e:
                    logger.error(f"Ensemble trial {trial.number} failed: {e}")
                    return 999.0
                    
            # Run optimization
            study.optimize(objective_with_logging, n_trials=n_trials)
            
            # Get best results
            best_trial = study.best_trial
            best_weights = best_trial.user_attrs.get('final_weights', {})
            
            # Create optimized ensemble model
            ensemble_model = EnsembleModel(weights=best_weights)
            ensemble_model.fit(df)
            
            # Register best ensemble model
            with self.mlflow_service.start_run(
                run_name=f"{study_name}_best_ensemble",
                tags={'model_type': 'ensemble', 'best_model': 'true'}
            ):
                self.mlflow_service.log_parameters(best_trial.params)
                self.mlflow_service.log_ensemble_weights(best_weights)
                self.mlflow_service.log_metrics({
                    'best_ensemble_mase': study.best_value,
                    'optimization_trials': len(study.trials)
                })
                
                model_version = self.mlflow_service.register_best_model(
                    ensemble_model,
                    "ensemble_optimized",
                    description=f"Optimized ensemble for {commodity_id} in {region_id}"
                )
                
            # Update status
            self.optimization_status[study_name].update({
                'status': 'completed',
                'end_time': datetime.now().isoformat(),
                'best_weights': best_weights,
                'best_value': study.best_value,
                'total_trials_completed': len(study.trials)
            })
            
            return {
                'study_name': study_name,
                'best_weights': best_weights,
                'best_value': study.best_value,
                'model_version': model_version,
                'trials_completed': len(study.trials),
                'commodity_id': commodity_id,
                'region_id': region_id
            }
            
        except Exception as e:
            logger.error(f"Ensemble optimization failed: {e}")
            self.optimization_status[study_name]['status'] = 'failed'
            self.optimization_status[study_name]['error'] = str(e)
            raise
            
    async def multi_objective_optimization(self,
                                         historical_data: List[Dict],
                                         commodity_id: str,
                                         region_id: str,
                                         n_trials: int = 200) -> Dict[str, Any]:
        """Multi-objective optimization balancing accuracy and coverage"""
        
        study_name = f"multi_objective_{commodity_id}_{region_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            # Prepare data
            df = self._prepare_optimization_data(historical_data, commodity_id, region_id)
            
            # Create optimization objectives
            objectives = OptimizationObjectives(
                data=df,
                horizon=30,
                cv_folds=3,
                vietnamese_market_focus=True
            )
            
            # Create multi-objective study
            study = create_multi_objective_study(
                study_name=study_name,
                storage_url=self.optuna_storage_url
            )
            
            self.active_studies[study_name] = study
            self.optimization_status[study_name] = {
                'status': 'running',
                'start_time': datetime.now().isoformat(),
                'model_type': 'multi_objective',
                'commodity_id': commodity_id,
                'region_id': region_id,
                'progress': 0,
                'current_trial': 0,
                'total_trials': n_trials
            }
            
            # Run multi-objective optimization
            def objective_with_logging(trial):
                try:
                    with self.mlflow_service.start_run(
                        run_name=f"{study_name}_trial_{trial.number}",
                        tags={
                            'optimization_type': 'multi_objective',
                            'commodity_id': commodity_id,
                            'region_id': region_id
                        }
                    ):
                        # Run multi-objective optimization
                        mase, neg_picp = objectives.multi_objective_combined(trial)
                        picp = -neg_picp
                        
                        # Log metrics
                        self.mlflow_service.log_parameters(trial.params)
                        self.mlflow_service.log_metrics({
                            'multi_obj_mase': mase,
                            'multi_obj_picp': picp,
                            'multi_obj_combined_score': mase + (100 - picp) * 0.01
                        })
                        
                        # Update progress
                        self.optimization_status[study_name]['current_trial'] = trial.number
                        self.optimization_status[study_name]['progress'] = (trial.number / n_trials) * 100
                        
                        return mase, neg_picp
                        
                except Exception as e:
                    logger.error(f"Multi-objective trial {trial.number} failed: {e}")
                    return 999.0, 0.0
                    
            study.optimize(objective_with_logging, n_trials=n_trials)
            
            # Analyze Pareto front
            pareto_front = []
            for trial in study.best_trials:
                pareto_front.append({
                    'trial_number': trial.number,
                    'mase': trial.values[0],
                    'picp': -trial.values[1],
                    'parameters': trial.params,
                    'model_type': trial.params.get('model_type', 'unknown')
                })
                
            # Select best balanced solution
            best_balanced = min(pareto_front, key=lambda x: x['mase'] + (100 - x['picp']) * 0.01)
            
            # Update status
            self.optimization_status[study_name].update({
                'status': 'completed',
                'end_time': datetime.now().isoformat(),
                'pareto_front_size': len(pareto_front),
                'best_balanced_solution': best_balanced,
                'total_trials_completed': len(study.trials)
            })
            
            return {
                'study_name': study_name,
                'pareto_front': pareto_front,
                'best_balanced': best_balanced,
                'trials_completed': len(study.trials),
                'commodity_id': commodity_id,
                'region_id': region_id
            }
            
        except Exception as e:
            logger.error(f"Multi-objective optimization failed: {e}")
            self.optimization_status[study_name]['status'] = 'failed'
            self.optimization_status[study_name]['error'] = str(e)
            raise
            
    def _create_model_with_params(self, model_type: str, params: Dict[str, Any]):
        """Create model instance with optimized parameters"""
        if model_type == 'arima':
            order = (params['p'], params['d'], params['q'])
            seasonal_order = None
            if params.get('seasonal', False):
                seasonal_order = (
                    params['seasonal_p'],
                    params['seasonal_d'], 
                    params['seasonal_q'],
                    params['seasonal_periods']
                )
            return ARIMAModel(order=order, seasonal_order=seasonal_order)
            
        elif model_type == 'ets':
            return ETSModel(
                trend=params['trend'],
                seasonal=params['seasonal'],
                seasonal_periods=params.get('seasonal_periods', 7)
            )
            
        elif model_type == 'lightgbm':
            lgb_params = {k: v for k, v in params.items() 
                         if k not in ['model_type']}
            return LightGBMModel(**lgb_params)
            
        elif model_type == 'ensemble':
            weights = params.get('final_weights', {
                'ARIMA': 0.33, 'ETS': 0.33, 'LightGBM': 0.34
            })
            return EnsembleModel(weights=weights)
            
        else:
            raise ValueError(f"Unknown model type: {model_type}")
            
    def _trial_callback(self, study_name: str, study: optuna.Study, trial: optuna.Trial):
        """Callback function for trial completion"""
        try:
            # Update optimization status
            if study_name in self.optimization_status:
                self.optimization_status[study_name]['current_trial'] = trial.number
                
                if not trial.state.is_finished():
                    return
                    
                if trial.value is not None and study.best_value is not None:
                    if trial.value == study.best_value:
                        self.optimization_status[study_name]['best_value'] = trial.value
                        
            # Log intermediate results every 10 trials
            if trial.number % 10 == 0:
                logger.info(f"Study {study_name}: Trial {trial.number}, Best value: {study.best_value}")
                
        except Exception as e:
            logger.error(f"Trial callback failed: {e}")
            
    def get_optimization_status(self, study_name: Optional[str] = None) -> Dict[str, Any]:
        """Get current optimization status"""
        if study_name:
            return self.optimization_status.get(study_name, {})
        else:
            return dict(self.optimization_status)
            
    def stop_optimization(self, study_name: str) -> bool:
        """Stop running optimization"""
        try:
            if study_name in self.active_studies:
                study = self.active_studies[study_name]
                study.stop()
                
                if study_name in self.optimization_status:
                    self.optimization_status[study_name]['status'] = 'stopped'
                    self.optimization_status[study_name]['end_time'] = datetime.now().isoformat()
                    
                return True
            return False
            
        except Exception as e:
            logger.error(f"Failed to stop optimization {study_name}: {e}")
            return False
            
    def get_best_parameters(self, commodity_id: str, region_id: str) -> Dict[str, Any]:
        """Retrieve best parameters for a commodity-region combination"""
        try:
            # Get best models from MLflow
            best_models = self.mlflow_service.get_best_models(limit=10)
            
            # Filter by commodity and region
            relevant_models = []
            for model in best_models:
                params = model.get('parameters', {})
                if (params.get('commodity_id') == commodity_id and 
                    params.get('region_id') == region_id):
                    relevant_models.append(model)
                    
            if not relevant_models:
                return {}
                
            # Return best performing model
            best_model = min(relevant_models, key=lambda x: x.get('mase', float('inf')))
            return {
                'best_parameters': best_model.get('parameters', {}),
                'performance_metrics': {
                    'mase': best_model.get('mase'),
                    'smape': best_model.get('smape'),
                    'picp': best_model.get('picp')
                },
                'run_id': best_model.get('run_id'),
                'model_registered': True
            }
            
        except Exception as e:
            logger.error(f"Failed to retrieve best parameters: {e}")
            return {}
            
    async def cleanup_old_studies(self, max_studies: int = 50):
        """Cleanup old optimization studies"""
        try:
            # This would typically involve cleaning up the Optuna storage
            # For now, we'll clean up in-memory status
            
            if len(self.optimization_status) > max_studies:
                # Keep only the most recent studies
                sorted_studies = sorted(
                    self.optimization_status.items(),
                    key=lambda x: x[1].get('start_time', ''),
                    reverse=True
                )
                
                studies_to_keep = dict(sorted_studies[:max_studies])
                self.optimization_status = studies_to_keep
                
            # Cleanup MLflow runs
            await asyncio.to_thread(self.mlflow_service.cleanup_old_runs, max_studies * 10)
            
            logger.info(f"Cleaned up optimization studies, kept {len(self.optimization_status)} studies")
            
        except Exception as e:
            logger.error(f"Cleanup failed: {e}")