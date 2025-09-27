import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, List, Any, Optional, Tuple
import os
import logging
from datetime import datetime
import json
from pathlib import Path

# Try to import MLflow and its components with fallback handling
MLFLOW_AVAILABLE = False
MLFLOW_SKLEARN_AVAILABLE = False
MLFLOW_LIGHTGBM_AVAILABLE = False
MLFLOW_STATSMODELS_AVAILABLE = False
PLOTLY_AVAILABLE = False
CLOUDPICKLE_AVAILABLE = False

try:
    import mlflow
    MLFLOW_AVAILABLE = True
    print("✅ MLflow core imported successfully")
except ImportError as e:
    print(f"⚠️ MLflow not available: {e}")
    
try:
    import mlflow.sklearn
    MLFLOW_SKLEARN_AVAILABLE = True
    print("✅ MLflow sklearn imported successfully")
except ImportError as e:
    print(f"⚠️ MLflow sklearn not available: {e}")

try:
    import mlflow.lightgbm
    MLFLOW_LIGHTGBM_AVAILABLE = True
    print("✅ MLflow LightGBM imported successfully")
except ImportError as e:
    print(f"⚠️ MLflow LightGBM not available: {e}")

try:
    import mlflow.statsmodels
    MLFLOW_STATSMODELS_AVAILABLE = True
    print("✅ MLflow statsmodels imported successfully")
except ImportError as e:
    print(f"⚠️ MLflow statsmodels not available: {e}")

try:
    import plotly.graph_objs as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    PLOTLY_AVAILABLE = True
    print("✅ Plotly imported successfully")
except ImportError as e:
    print(f"⚠️ Plotly not available: {e}")

try:
    import cloudpickle
    CLOUDPICKLE_AVAILABLE = True
    print("✅ CloudPickle imported successfully")
except ImportError as e:
    print(f"⚠️ CloudPickle not available: {e}")
    # Fallback to standard pickle
    import pickle as cloudpickle

logger = logging.getLogger(__name__)

class MLflowService:
    """MLflow integration service for experiment tracking and model versioning"""
    
    def __init__(self, tracking_uri: Optional[str] = None, experiment_name: str = "AgriIntel_HPO"):
        self.tracking_uri = tracking_uri or "file:./mlruns"  # Default to local storage
        self.experiment_name = experiment_name
        self.mlflow_enabled = MLFLOW_AVAILABLE
        
        if self.mlflow_enabled:
            self.setup_mlflow()
        else:
            logger.warning("MLflow not available - running without experiment tracking")
            self.experiment_id = None
        
    def setup_mlflow(self):
        """Initialize MLflow configuration"""
        try:
            mlflow.set_tracking_uri(self.tracking_uri)
            
            # Create or get experiment
            try:
                experiment = mlflow.get_experiment_by_name(self.experiment_name)
                if experiment is None:
                    experiment_id = mlflow.create_experiment(
                        self.experiment_name,
                        tags={
                            "purpose": "Vietnamese Agricultural Commodities HPO",
                            "framework": "Optuna + MLflow",
                            "version": "1.0.0"
                        }
                    )
                    logger.info(f"Created new experiment: {self.experiment_name}")
                else:
                    experiment_id = experiment.experiment_id
                    logger.info(f"Using existing experiment: {self.experiment_name}")
                    
                self.experiment_id = experiment_id
                mlflow.set_experiment(self.experiment_name)
                
            except Exception as e:
                logger.error(f"Failed to setup experiment: {e}")
                raise
                
        except Exception as e:
            logger.error(f"Failed to setup MLflow: {e}")
            raise
            
    def start_run(self, run_name: Optional[str] = None, tags: Optional[Dict[str, str]] = None):
        """Start a new MLflow run (if MLflow available)"""
        if not self.mlflow_enabled:
            logger.debug("MLflow not available - skipping run start")
            return None
            
        default_tags = {
            "mlflow.runName": run_name or f"optuna_trial_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "framework": "AgriIntel_HPO",
            "timestamp": datetime.now().isoformat()
        }
        
        if tags:
            default_tags.update(tags)
            
        return mlflow.start_run(tags=default_tags)
        
    def log_parameters(self, params: Dict[str, Any]):
        """Log parameters to MLflow (if available)"""
        if not self.mlflow_enabled:
            logger.debug("MLflow not available - skipping parameter logging")
            return
            
        try:
            # Handle complex parameter types
            for key, value in params.items():
                if isinstance(value, (dict, list)):
                    mlflow.log_param(key, json.dumps(value))
                elif isinstance(value, (int, float, str, bool)):
                    mlflow.log_param(key, value)
                else:
                    mlflow.log_param(key, str(value))
        except Exception as e:
            logger.error(f"Failed to log parameters: {e}")
            
    def log_metrics(self, metrics: Dict[str, float], step: Optional[int] = None):
        """Log metrics to MLflow (if available)"""
        if not self.mlflow_enabled:
            logger.debug("MLflow not available - skipping metrics logging")
            return
            
        try:
            for key, value in metrics.items():
                if isinstance(value, (int, float)) and not np.isnan(value):
                    mlflow.log_metric(key, value, step=step)
        except Exception as e:
            logger.error(f"Failed to log metrics: {e}")
            
    def log_model(self, model, model_name: str, signature=None, input_example=None, **kwargs):
        """Log model to MLflow with proper serialization (if available)"""
        if not self.mlflow_enabled:
            logger.debug("MLflow not available - skipping model logging")
            return
            
        try:
            # Handle different model types based on availability
            if hasattr(model, '__class__'):
                model_type = model.__class__.__name__
                logged_successfully = False
                
                # Try LightGBM logging if available
                if 'lightgbm' in model_type.lower() and MLFLOW_LIGHTGBM_AVAILABLE:
                    try:
                        mlflow.lightgbm.log_model(
                            lgb_model=model,
                            artifact_path=model_name,
                            signature=signature,
                            input_example=input_example,
                            **kwargs
                        )
                        logged_successfully = True
                        logger.info(f"Model {model_name} logged using MLflow LightGBM")
                    except Exception as e:
                        logger.warning(f"LightGBM model logging failed: {e}")
                
                # Try statsmodels logging if available
                elif ('arima' in model_type.lower() or 'ets' in model_type.lower()) and MLFLOW_STATSMODELS_AVAILABLE:
                    try:
                        mlflow.statsmodels.log_model(
                            statsmodels_model=model,
                            artifact_path=model_name,
                            signature=signature,
                            **kwargs
                        )
                        logged_successfully = True
                        logger.info(f"Model {model_name} logged using MLflow statsmodels")
                    except Exception as e:
                        logger.warning(f"Statsmodels model logging failed: {e}")
                
                # Try sklearn logging if available
                elif MLFLOW_SKLEARN_AVAILABLE:
                    try:
                        mlflow.sklearn.log_model(
                            sk_model=model,
                            artifact_path=model_name,
                            signature=signature,
                            input_example=input_example,
                            **kwargs
                        )
                        logged_successfully = True
                        logger.info(f"Model {model_name} logged using MLflow sklearn")
                    except Exception as e:
                        logger.warning(f"Sklearn model logging failed: {e}")
                
                # Fallback to pickle serialization if specific logging failed
                if not logged_successfully:
                    logger.info(f"Using fallback pickle serialization for {model_name}")
                    try:
                        with open(f"{model_name}.pkl", "wb") as f:
                            cloudpickle.dump(model, f)
                        mlflow.log_artifact(f"{model_name}.pkl")
                        os.remove(f"{model_name}.pkl")  # Cleanup
                        logger.info(f"Model {model_name} logged using pickle fallback")
                    except Exception as e2:
                        logger.error(f"Failed to log model with pickle fallback: {e2}")
                    
        except Exception as e:
            logger.error(f"Failed to log model {model_name}: {e}")
                
    def log_forecast_plot(self, 
                         historical_data: pd.DataFrame,
                         predictions: List[Dict],
                         commodity_name: str = "Commodity",
                         region_name: str = "Region") -> str:
        """Create and log forecast visualization"""
        try:
            # Create interactive plot with Plotly
            fig = make_subplots(
                rows=2, cols=1,
                subplot_titles=('Price Forecast', 'Prediction Intervals'),
                vertical_spacing=0.1
            )
            
            # Historical data
            fig.add_trace(
                go.Scatter(
                    x=historical_data['date'],
                    y=historical_data['price'],
                    mode='lines+markers',
                    name='Historical',
                    line=dict(color='blue')
                ),
                row=1, col=1
            )
            
            # Predictions
            pred_dates = [pred['date'] for pred in predictions]
            medians = [pred['median'] for pred in predictions]
            q10s = [pred['q10'] for pred in predictions]
            q90s = [pred['q90'] for pred in predictions]
            
            # Median forecast
            fig.add_trace(
                go.Scatter(
                    x=pred_dates,
                    y=medians,
                    mode='lines+markers',
                    name='Forecast (Median)',
                    line=dict(color='red')
                ),
                row=1, col=1
            )
            
            # Confidence interval
            fig.add_trace(
                go.Scatter(
                    x=pred_dates + pred_dates[::-1],
                    y=q90s + q10s[::-1],
                    fill='toself',
                    fillcolor='rgba(0,100,80,0.2)',
                    line=dict(color='rgba(255,255,255,0)'),
                    name='80% Confidence Interval',
                    showlegend=True
                ),
                row=1, col=1
            )
            
            # Second subplot: Prediction intervals
            confidence_values = [pred.get('confidence', 0.5) for pred in predictions]
            fig.add_trace(
                go.Scatter(
                    x=pred_dates,
                    y=confidence_values,
                    mode='lines+markers',
                    name='Confidence Level',
                    line=dict(color='green')
                ),
                row=2, col=1
            )
            
            # Update layout
            fig.update_layout(
                title=f'{commodity_name} Price Forecast - {region_name}',
                height=800,
                showlegend=True
            )
            
            fig.update_xaxes(title_text="Date", row=2, col=1)
            fig.update_yaxes(title_text="Price (USD)", row=1, col=1)
            fig.update_yaxes(title_text="Confidence", row=2, col=1)
            
            # Save and log plot
            plot_path = f"forecast_plot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
            fig.write_html(plot_path)
            mlflow.log_artifact(plot_path)
            os.remove(plot_path)  # Cleanup
            
            return "forecast_plot_logged"
            
        except Exception as e:
            logger.error(f"Failed to create forecast plot: {e}")
            return "plot_failed"
            
    def log_optimization_progress(self, study, trial_number: int):
        """Log optimization progress and intermediate results"""
        try:
            # Log optimization history
            trials_df = study.trials_dataframe()
            if len(trials_df) > 0:
                # Create optimization progress plot
                fig = px.line(
                    trials_df, 
                    x='number', 
                    y='value',
                    title='Optimization Progress',
                    labels={'value': 'Objective Value (MASE)', 'number': 'Trial Number'}
                )
                
                plot_path = f"optimization_progress_{trial_number}.html"
                fig.write_html(plot_path)
                mlflow.log_artifact(plot_path)
                os.remove(plot_path)
                
                # Log best value so far
                mlflow.log_metric("best_value", study.best_value, step=trial_number)
                
        except Exception as e:
            logger.error(f"Failed to log optimization progress: {e}")
            
    def log_parameter_importance(self, study):
        """Log parameter importance analysis"""
        try:
            import optuna
            
            # Calculate parameter importance
            importance = optuna.importance.get_param_importances(study)
            
            # Log as metrics
            for param, imp in importance.items():
                mlflow.log_metric(f"param_importance_{param}", imp)
                
            # Create importance plot
            fig = px.bar(
                x=list(importance.values()),
                y=list(importance.keys()),
                orientation='h',
                title='Parameter Importance',
                labels={'x': 'Importance', 'y': 'Parameter'}
            )
            
            plot_path = "parameter_importance.html"
            fig.write_html(plot_path)
            mlflow.log_artifact(plot_path)
            os.remove(plot_path)
            
        except Exception as e:
            logger.error(f"Failed to log parameter importance: {e}")
            
    def log_ensemble_weights(self, weights: Dict[str, float]):
        """Log ensemble model weights"""
        try:
            # Log weights as parameters
            for model_name, weight in weights.items():
                mlflow.log_param(f"ensemble_weight_{model_name}", weight)
                
            # Create weights visualization
            fig = px.pie(
                values=list(weights.values()),
                names=list(weights.keys()),
                title='Ensemble Model Weights'
            )
            
            plot_path = "ensemble_weights.html"
            fig.write_html(plot_path)
            mlflow.log_artifact(plot_path)
            os.remove(plot_path)
            
        except Exception as e:
            logger.error(f"Failed to log ensemble weights: {e}")
            
    def register_best_model(self, 
                           model, 
                           model_name: str,
                           stage: str = "Staging",
                           description: Optional[str] = None) -> str:
        """Register the best model to MLflow Model Registry"""
        try:
            # Log the model first
            self.log_model(model, model_name)
            
            # Get the model URI from current run
            run_id = mlflow.active_run().info.run_id
            model_uri = f"runs:/{run_id}/{model_name}"
            
            # Register the model
            model_version = mlflow.register_model(
                model_uri=model_uri,
                name=f"AgriIntel_{model_name}",
                description=description or f"Best {model_name} model from HPO"
            )
            
            # Transition to specified stage
            client = mlflow.tracking.MlflowClient()
            client.transition_model_version_stage(
                name=f"AgriIntel_{model_name}",
                version=model_version.version,
                stage=stage
            )
            
            logger.info(f"Model {model_name} registered with version {model_version.version}")
            return model_version.version
            
        except Exception as e:
            logger.error(f"Failed to register model: {e}")
            return "registration_failed"
            
    def get_best_models(self, limit: int = 10) -> List[Dict]:
        """Retrieve best performing models from experiments"""
        try:
            client = mlflow.tracking.MlflowClient()
            
            # Get runs from experiment
            runs = client.search_runs(
                experiment_ids=[self.experiment_id],
                order_by=["metrics.mase ASC"],  # Best MASE first
                max_results=limit
            )
            
            best_models = []
            for run in runs:
                model_info = {
                    'run_id': run.info.run_id,
                    'mase': run.data.metrics.get('mase', float('inf')),
                    'smape': run.data.metrics.get('smape', float('inf')),
                    'picp': run.data.metrics.get('picp', 0.0),
                    'parameters': run.data.params,
                    'start_time': run.info.start_time,
                    'status': run.info.status
                }
                best_models.append(model_info)
                
            return best_models
            
        except Exception as e:
            logger.error(f"Failed to retrieve best models: {e}")
            return []
            
    def cleanup_old_runs(self, max_runs: int = 1000):
        """Cleanup old runs to save storage space"""
        try:
            client = mlflow.tracking.MlflowClient()
            
            # Get all runs
            runs = client.search_runs(
                experiment_ids=[self.experiment_id],
                order_by=["attribute.start_time DESC"],
                max_results=max_runs + 100  # Get a few extra to identify old ones
            )
            
            # Delete runs beyond the limit
            if len(runs) > max_runs:
                old_runs = runs[max_runs:]
                for run in old_runs:
                    client.delete_run(run.info.run_id)
                    
                logger.info(f"Cleaned up {len(old_runs)} old runs")
                
        except Exception as e:
            logger.error(f"Failed to cleanup old runs: {e}")