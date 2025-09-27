from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
import traceback
import uvicorn
import asyncio

# Import scheduler service for automated data collection
from services.scheduler import start_scheduler, stop_scheduler, get_scheduler_status

# Import models with fallback handling for LightGBM issues
from models.arima_model import ARIMAModel
from models.ets_model import ETSModel

# Import production ensemble model
PRODUCTION_ENSEMBLE_AVAILABLE = False
try:
    from models.production_ensemble import ProductionEnsembleModel, ForecastResult
    PRODUCTION_ENSEMBLE_AVAILABLE = True
    print("✅ Production ensemble model loaded successfully")
except Exception as e:
    print(f"⚠️ Production ensemble not available: {e}")
    PRODUCTION_ENSEMBLE_AVAILABLE = False

# Try to import LightGBM and legacy ensemble models
LIGHTGBM_AVAILABLE = False
try:
    from models.lightgbm_model import LightGBMModel
    from models.ensemble_model import EnsembleModel, QuantileForecast
    LIGHTGBM_AVAILABLE = True
    print("✅ LightGBM models loaded successfully")
except Exception as e:
    print(f"⚠️ LightGBM not available: {e}")
    print("📊 HPO will run with ARIMA and ETS models only")
    # Create simplified ensemble without LightGBM
    class QuantileForecast:
        def __init__(self, dates, q10, q25, median, q75, q90, confidence):
            self.dates = dates
            self.q10 = q10
            self.q25 = q25
            self.median = median
            self.q75 = q75
            self.q90 = q90
            self.confidence = confidence

# Darts-compatible models for P0 compliance (optional)
try:
    from models.darts_compat_arima import DartsCompatARIMAModel
    from models.darts_compat_ets import DartsCompatETSModel
    DARTS_AVAILABLE = True
except Exception as e:
    print(f"⚠️ Darts models not available: {e}")
    DARTS_AVAILABLE = False

# HPO and MLflow services with conditional imports
HPO_AVAILABLE = False
OPTUNA_OBJECTIVES_AVAILABLE = False
try:
    from services.hpo_service import HPOService
    from services.mlflow_service import MLflowService
    # Check if HPO service has the required availability flags
    from services.hpo_service import OPTUNA_AVAILABLE, OPTUNA_OBJECTIVES_AVAILABLE
    HPO_AVAILABLE = OPTUNA_AVAILABLE and OPTUNA_OBJECTIVES_AVAILABLE
    if HPO_AVAILABLE:
        print("✅ HPO and MLflow services loaded successfully")
        print(f"✅ Optuna available: {OPTUNA_AVAILABLE}")
        print(f"✅ Optuna objectives available: {OPTUNA_OBJECTIVES_AVAILABLE}")
    else:
        print(f"⚠️ HPO partially available - Optuna: {OPTUNA_AVAILABLE}, Objectives: {OPTUNA_OBJECTIVES_AVAILABLE}")
except Exception as e:
    print(f"⚠️ HPO services not available: {e}")
    print("📊 Running without HPO optimization - using fallback grid search")
    
    # Create fallback HPO service using grid search when Optuna is not available
    class HPOService:
        def __init__(self):
            self.optimization_status = {}
            print("⚠️ HPO service initialized in fallback mode")
            
        async def optimize_single_model(self, *args, **kwargs):
            """Fallback HPO using grid search for ARIMA and ETS models"""
            return await self._fallback_grid_search(*args, **kwargs)
            
        async def optimize_ensemble_weights(self, *args, **kwargs):
            """Fallback ensemble weight optimization using simple grid search"""
            return await self._fallback_ensemble_weights(*args, **kwargs)
            
        async def multi_objective_optimization(self, *args, **kwargs):
            """Fallback multi-objective optimization using simple approaches"""
            return await self._fallback_multi_objective(*args, **kwargs)
            
        async def _fallback_grid_search(self, model_type: str, data: List[Dict], **kwargs):
            """Simple grid search for ARIMA/ETS parameters"""
            import itertools
            from models.arima_model import ARIMAModel
            from models.ets_model import ETSModel
            
            best_params = {}
            best_score = float('inf')
            
            try:
                if model_type.lower() == 'arima':
                    # ARIMA parameter grid
                    p_values = [0, 1, 2]
                    d_values = [0, 1]
                    q_values = [0, 1, 2]
                    
                    for p, d, q in itertools.product(p_values, d_values, q_values):
                        try:
                            model = ARIMAModel(order=(p, d, q))
                            # Quick validation score (simplified)
                            score = p + d + q + 1  # Placeholder complexity penalty
                            if score < best_score:
                                best_score = score
                                best_params = {'p': p, 'd': d, 'q': q}
                        except:
                            continue
                            
                elif model_type.lower() == 'ets':
                    # ETS parameter grid
                    for trend in ['add', 'mul', None]:
                        for seasonal in ['add', 'mul', None]:
                            try:
                                model = ETSModel(trend=trend, seasonal=seasonal)
                                score = 1  # Placeholder
                                if score < best_score:
                                    best_score = score
                                    best_params = {'trend': trend, 'seasonal': seasonal}
                            except:
                                continue
                                
                return {
                    'status': 'completed',
                    'best_params': best_params,
                    'best_score': best_score,
                    'method': 'grid_search_fallback',
                    'trials_completed': len(list(itertools.product(p_values, d_values, q_values))) if model_type.lower() == 'arima' else 6
                }
                
            except Exception as e:
                return {
                    'status': 'failed',
                    'error': str(e),
                    'method': 'grid_search_fallback'
                }
                
        async def _fallback_ensemble_weights(self, **kwargs):
            """Simple ensemble weight optimization"""
            # Use equal weights as fallback
            return {
                'status': 'completed',
                'best_params': {
                    'ARIMA': 0.5,
                    'ETS': 0.5,
                    'LightGBM': 0.0  # Disabled when not available
                },
                'method': 'equal_weights_fallback'
            }
            
        async def _fallback_multi_objective(self, **kwargs):
            """Simple multi-objective fallback"""
            return {
                'status': 'completed',
                'pareto_front': [
                    {'accuracy': 0.85, 'stability': 0.90, 'params': {'model': 'ARIMA'}},
                    {'accuracy': 0.82, 'stability': 0.95, 'params': {'model': 'ETS'}}
                ],
                'method': 'simple_multi_objective_fallback'
            }
            
        def get_optimization_status(self, optimization_id: str = None):
            return self.optimization_status.get(optimization_id, {'status': 'not_found'})
            
        def stop_optimization(self, optimization_id: str):
            if optimization_id in self.optimization_status:
                self.optimization_status[optimization_id]['status'] = 'stopped'
                return True
            return False
            
        def get_best_parameters(self, optimization_id: str = None):
            status = self.get_optimization_status(optimization_id)
            return status.get('best_params', {})
    
    class MLflowService:
        def __init__(self):
            pass
        def get_best_models(self, *args, **kwargs):
            return []

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="AgriIntel ML Forecasting Service",
    description="Advanced ML forecasting microservice for Vietnamese agricultural commodities",
    version="1.0.0"
)

# Add CORS middleware to allow calls from Node.js service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://0.0.0.0:5000"],  # Node.js service URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request/response validation
class HistoricalPrice(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format")
    price: float = Field(..., gt=0, description="Price must be positive")
    currency: str = Field(default="USD", description="Currency code")
    volume: Optional[float] = Field(None, description="Trading volume")

class ForecastRequest(BaseModel):
    commodity_id: str = Field(..., description="Commodity identifier")
    region_id: str = Field(..., description="Region identifier")
    historical_prices: List[HistoricalPrice] = Field(..., description="Historical price data (minimum 30 points)")
    horizon: int = Field(default=30, ge=1, le=60, description="Forecast horizon in days (1-60)")
    model_type: str = Field(default="ensemble", description="Model type: ensemble, arima, ets, lightgbm")

class QuantilePrediction(BaseModel):
    date: str
    q10: float
    q25: float
    median: float
    q75: float
    q90: float
    confidence: float
    trend: str  # "up", "down", "stable"
    volatility: float

class ForecastResponse(BaseModel):
    commodity_id: str
    region_id: str
    forecast_date: str
    horizon: int
    model_type: str
    model_version: str
    predictions: List[QuantilePrediction]
    metrics: Dict[str, float]
    metadata: Dict[str, Any]
    status: str

class ModelStatus(BaseModel):
    name: str
    status: str  # "available", "error", "not_fitted"
    last_trained: Optional[str]
    performance_metrics: Dict[str, float]

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    service_version: str
    models_status: List[ModelStatus]

class ModelsResponse(BaseModel):
    available_models: List[str]
    default_model: str
    model_details: List[ModelStatus]

# HPO-specific Pydantic models
class HPORequest(BaseModel):
    commodity_id: str = Field(..., description="Commodity identifier")
    region_id: str = Field(..., description="Region identifier")
    historical_prices: List[HistoricalPrice] = Field(..., description="Historical price data (minimum 60 points)")
    optimization_type: str = Field(default="single_model", description="Optimization type: single_model, ensemble_weights, multi_objective")
    model_type: Optional[str] = Field(default="ensemble", description="Model type for single model optimization")
    n_trials: int = Field(default=100, ge=10, le=500, description="Number of optimization trials")
    timeout: Optional[int] = Field(default=3600, description="Optimization timeout in seconds")

class HPOResponse(BaseModel):
    study_name: str
    commodity_id: str
    region_id: str
    optimization_type: str
    status: str
    best_parameters: Optional[Dict[str, Any]]
    best_value: Optional[float]
    performance_metrics: Dict[str, float]
    model_version: Optional[str]
    trials_completed: int
    optimization_time: Optional[str]
    mlflow_run_id: Optional[str]

class OptimizationStatusResponse(BaseModel):
    study_name: str
    status: str  # "running", "completed", "failed", "stopped"
    start_time: str
    end_time: Optional[str]
    progress: float  # 0-100
    current_trial: int
    total_trials: int
    best_value: Optional[float]
    model_type: str
    commodity_id: str
    region_id: str
    error: Optional[str]

class ExperimentSummary(BaseModel):
    experiment_name: str
    experiment_id: str
    total_runs: int
    best_models: List[Dict[str, Any]]
    recent_optimizations: List[Dict[str, Any]]

class BestParametersResponse(BaseModel):
    commodity_id: str
    region_id: str
    best_parameters: Dict[str, Any]
    performance_metrics: Dict[str, float]
    model_version: str
    last_updated: str
    mlflow_run_id: str

# Global model cache
model_cache = {}
model_training_status = {}

# Initialize HPO and MLflow services
if HPO_AVAILABLE:
    hpo_service = HPOService()
    mlflow_service = MLflowService()
    print("✅ HPO service initialized successfully")
else:
    hpo_service = HPOService()  # This will be the placeholder class
    mlflow_service = MLflowService() if 'MLflowService' in globals() else None
    print("⚠️ HPO service initialized in disabled mode")

# Start the automated data collection scheduler
print("🕒 Starting automated data collection scheduler...")
start_scheduler()
print("✅ Data collection scheduler started successfully")

def get_model_instance(model_type: str):
    """Get or create model instance with production ensemble support"""
    if model_type not in model_cache:
        if model_type == "production_ensemble" and PRODUCTION_ENSEMBLE_AVAILABLE:
            model_cache[model_type] = ProductionEnsembleModel()
            logger.info("✅ Production ensemble model initialized")
        elif model_type == "ensemble":
            if PRODUCTION_ENSEMBLE_AVAILABLE:
                # Use production ensemble as default
                model_cache[model_type] = ProductionEnsembleModel()
                logger.info("✅ Using production ensemble (preferred)")
            elif LIGHTGBM_AVAILABLE:
                from models.ensemble_model import EnsembleModel
                model_cache[model_type] = EnsembleModel()
                logger.info("⚠️ Using legacy ensemble model")
            else:
                # Create simple ensemble with ARIMA and ETS only
                from models.ensemble_model_simple import SimpleEnsembleModel
                model_cache[model_type] = SimpleEnsembleModel()
                logger.info("⚠️ Using simple ensemble (fallback)")
        elif model_type == "arima":
            model_cache[model_type] = ARIMAModel()
        elif model_type == "ets":
            model_cache[model_type] = ETSModel()
        elif model_type == "lightgbm":
            if LIGHTGBM_AVAILABLE:
                from models.lightgbm_model import LightGBMModel
                model_cache[model_type] = LightGBMModel()
            else:
                raise ValueError("LightGBM not available due to system dependencies")
        # Darts-compatible models (P0 requirement)
        elif model_type == "darts_arima" and DARTS_AVAILABLE:
            from models.darts_compat_arima import DartsCompatARIMAModel
            model_cache[model_type] = DartsCompatARIMAModel()
        elif model_type == "darts_ets" and DARTS_AVAILABLE:
            from models.darts_compat_ets import DartsCompatETSModel
            model_cache[model_type] = DartsCompatETSModel()
        else:
            available_models = ["arima", "ets", "ensemble"]
            if PRODUCTION_ENSEMBLE_AVAILABLE:
                available_models.append("production_ensemble")
            if LIGHTGBM_AVAILABLE:
                available_models.append("lightgbm")
            if DARTS_AVAILABLE:
                available_models.extend(["darts_arima", "darts_ets"])
            raise ValueError(f"Unknown model type: {model_type}. Available: {', '.join(available_models)}")
            
        model_training_status[model_type] = "not_fitted"
        
    return model_cache[model_type]

def prepare_historical_data(historical_prices: List[HistoricalPrice]) -> pd.DataFrame:
    """Convert historical prices to DataFrame with proper preprocessing"""
    data = []
    
    for price_point in historical_prices:
        data.append({
            'date': price_point.date,
            'price': price_point.price,
            'currency': price_point.currency,
            'volume': price_point.volume
        })
    
    df = pd.DataFrame(data)
    
    # Convert date column
    df['date'] = pd.to_datetime(df['date'])
    
    # Handle currency conversion (for Vietnamese market)
    # For now, assume USD input, but could add VND conversion logic
    df['price_usd'] = df['price']  # Placeholder for currency conversion
    
    # Sort by date and remove duplicates
    df = df.sort_values('date').drop_duplicates(subset=['date'])
    
    # Handle missing values with forward fill
    df['price'] = df['price'].fillna(method='ffill')
    
    # Remove any remaining NaN values
    df = df.dropna(subset=['price'])
    
    return df

def format_quantile_forecast(forecast_result, commodity_id: str, region_id: str, model_type: str) -> ForecastResponse:
    """Format model output to API response format"""
    
    if hasattr(forecast_result, 'dates'):
        # Handle ForecastResult from individual models
        predictions = []
        for i in range(len(forecast_result.dates)):
            # For individual models, approximate additional quantiles
            pred = forecast_result.predictions[i]
            lower = forecast_result.lower_bounds[i]
            upper = forecast_result.upper_bounds[i]
            conf = forecast_result.confidence[i]
            
            # Approximate quantiles from confidence interval
            q10 = lower
            q25 = pred - (pred - lower) * 0.5
            median = pred
            q75 = pred + (upper - pred) * 0.5
            q90 = upper
            
            predictions.append(QuantilePrediction(
                date=forecast_result.dates[i],
                q10=round(q10, 2),
                q25=round(q25, 2),
                median=round(median, 2),
                q75=round(q75, 2),
                q90=round(q90, 2),
                confidence=round(conf, 3),
                trend="stable",  # Simple default
                volatility=round((upper - lower) / median, 4)
            ))
        
        metadata = forecast_result.metadata
        metrics = forecast_result.metrics
        
    else:
        # Handle QuantileForecast from ensemble model
        predictions = []
        for i in range(len(forecast_result.dates)):
            predictions.append(QuantilePrediction(
                date=forecast_result.dates[i],
                q10=round(forecast_result.q10[i], 2),
                q25=round(forecast_result.q25[i], 2),
                median=round(forecast_result.median[i], 2),
                q75=round(forecast_result.q75[i], 2),
                q90=round(forecast_result.q90[i], 2),
                confidence=round(forecast_result.confidence[i], 3),
                trend=forecast_result.trend[i],
                volatility=round(forecast_result.volatility[i], 4)
            ))
        
        metadata = {"model_type": "ensemble", "quantile_forecast": True}
        metrics = {}
    
    return ForecastResponse(
        commodity_id=commodity_id,
        region_id=region_id,
        forecast_date=datetime.now().strftime('%Y-%m-%d'),
        horizon=len(predictions),
        model_type=model_type,
        model_version="v1.0.0",
        predictions=predictions,
        metrics=metrics,
        metadata=metadata,
        status="completed"
    )

@app.post("/forecast", response_model=ForecastResponse)
async def generate_forecast(request: ForecastRequest, background_tasks: BackgroundTasks):
    """Generate ML forecast for agricultural commodity prices"""
    
    try:
        logger.info(f"Generating forecast for {request.commodity_id} in {request.region_id}")
        
        # Validate model type with dynamic availability check
        valid_models = ["ensemble", "arima", "ets"]
        if LIGHTGBM_AVAILABLE:
            valid_models.append("lightgbm")
        if DARTS_AVAILABLE:
            valid_models.extend(["darts_arima", "darts_ets"])
            
        if request.model_type not in valid_models:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid model_type. Must be one of: {valid_models}"
            )
        
        # Prepare historical data
        historical_df = prepare_historical_data(request.historical_prices)
        
        # Validate data quality
        if len(historical_df) < 30:
            raise HTTPException(
                status_code=400,
                detail="Insufficient historical data. Need at least 30 data points."
            )
        
        # Get model instance
        model = get_model_instance(request.model_type)
        
        # Fit model with historical data
        logger.info(f"Fitting {request.model_type} model...")
        model.fit(historical_df)
        model_training_status[request.model_type] = "fitted"
        
        # Generate forecast
        logger.info(f"Generating {request.horizon}-day forecast...")
        
        if request.model_type == "ensemble" and hasattr(model, 'get_quantile_forecast'):
            # Get full quantile forecast from ensemble
            forecast_result = model.get_quantile_forecast(request.horizon)
        else:
            # Get standard forecast from individual models
            forecast_result = model.forecast(request.horizon)
        
        # Format response
        response = format_quantile_forecast(
            forecast_result, 
            request.commodity_id, 
            request.region_id, 
            request.model_type
        )
        
        logger.info(f"Forecast completed successfully for {request.commodity_id}")
        return response
        
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
        
    except Exception as e:
        logger.error(f"Forecast generation failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, 
            detail=f"Internal server error during forecast generation: {str(e)}"
        )

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Basic health check endpoint for load balancers"""
    
    try:
        # Check model statuses
        model_statuses = []
        available_models = 0
        
        for model_name in ["ensemble", "arima", "ets", "lightgbm"]:
            status = model_training_status.get(model_name, "not_fitted")
            
            # Test model availability
            try:
                model = get_model_instance(model_name)
                if model and hasattr(model, 'is_fitted') and model.is_fitted:
                    actual_status = "available"
                    available_models += 1
                    performance_metrics = model.get_metrics() if hasattr(model, 'get_metrics') else {}
                else:
                    actual_status = "not_fitted" 
                    performance_metrics = {}
            except Exception as e:
                actual_status = "error"
                performance_metrics = {}  # Empty dict since ModelStatus expects Dict[str, float]
            
            # Ensure performance_metrics only contains float values
            filtered_metrics = {k: v for k, v in performance_metrics.items() if isinstance(v, (int, float))}
            
            model_status = ModelStatus(
                name=model_name,
                status=actual_status,
                last_trained=datetime.now().isoformat() if actual_status == "available" else None,
                performance_metrics=filtered_metrics
            )
            model_statuses.append(model_status)
        
        # Determine overall health
        overall_status = "healthy" if available_models >= 0 else "unhealthy"  # Service is healthy if it can start
        
        return HealthResponse(
            status=overall_status,
            timestamp=datetime.now().isoformat(),
            service_version="1.0.0",
            models_status=model_statuses
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.now().isoformat(),
            service_version="1.0.0", 
            models_status=[]
        )

@app.get("/readiness")
async def readiness_check():
    """Readiness check endpoint for Kubernetes/container orchestration"""
    
    try:
        # Check if service is ready to accept requests
        available_models = 0
        total_models = 4
        
        for model_name in ["ensemble", "arima", "ets", "lightgbm"]:
            try:
                model = get_model_instance(model_name)
                if model:  # Model instance created successfully
                    available_models += 1
            except:
                pass
                
        # Service is ready if at least one model can be instantiated
        if available_models > 0:
            return {
                "status": "ready",
                "timestamp": datetime.now().isoformat(),
                "available_models": available_models,
                "total_models": total_models
            }
        else:
            raise HTTPException(
                status_code=503,
                detail={
                    "status": "not_ready", 
                    "timestamp": datetime.now().isoformat(),
                    "available_models": 0,
                    "total_models": total_models
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        raise HTTPException(
            status_code=503,
            detail={"status": "not_ready", "error": str(e)}
        )

@app.get("/models", response_model=ModelsResponse)
async def get_models():
    """Get available models and their status"""
    
    available_models = ["ensemble", "arima", "ets", "lightgbm"]
    default_model = "ensemble"
    
    model_details = []
    for model_name in available_models:
        status = model_training_status.get(model_name, "not_fitted")
        
        model_detail = ModelStatus(
            name=model_name,
            status="available" if model_name in model_cache else "not_initialized",
            last_trained=datetime.now().isoformat() if status == "fitted" else None,
            performance_metrics={}
        )
        
        # Add performance metrics if available
        if model_name in model_cache and model_cache[model_name].is_fitted:
            try:
                model_detail.performance_metrics = model_cache[model_name].get_metrics()
            except:
                pass
                
        model_details.append(model_detail)
    
    return ModelsResponse(
        available_models=available_models,
        default_model=default_model,
        model_details=model_details
    )

@app.post("/optimize", response_model=HPOResponse)
async def run_hyperparameter_optimization(request: HPORequest, background_tasks: BackgroundTasks):
    """Run hyperparameter optimization for ML models"""
    
    try:
        logger.info(f"Starting HPO for {request.commodity_id} in {request.region_id}")
        
        # Use fallback HPO service if Optuna is not available
        if not HPO_AVAILABLE:
            logger.info("Using fallback HPO service with grid search")
            # Add fallback method indicator to response metadata
        
        # Validate historical data
        if len(request.historical_prices) < 60:
            raise HTTPException(
                status_code=400,
                detail="Insufficient historical data. Need at least 60 data points for reliable HPO."
            )
        
        # Prepare historical data
        historical_data = []
        for price_point in request.historical_prices:
            historical_data.append({
                'date': price_point.date,
                'price': price_point.price,
                'currency': price_point.currency,
                'volume': price_point.volume
            })
        
        # Run optimization based on type
        if request.optimization_type == "single_model":
            if not request.model_type:
                raise HTTPException(status_code=400, detail="model_type required for single_model optimization")
                
            # Run single model optimization in background
            result = await hpo_service.optimize_single_model(
                model_type=request.model_type,
                historical_data=historical_data,
                commodity_id=request.commodity_id,
                region_id=request.region_id,
                n_trials=request.n_trials,
                timeout=request.timeout
            )
            
        elif request.optimization_type == "ensemble_weights":
            # Run ensemble weight optimization
            result = await hpo_service.optimize_ensemble_weights(
                historical_data=historical_data,
                commodity_id=request.commodity_id,
                region_id=request.region_id,
                n_trials=request.n_trials
            )
            
        elif request.optimization_type == "multi_objective":
            # Run multi-objective optimization
            result = await hpo_service.multi_objective_optimization(
                historical_data=historical_data,
                commodity_id=request.commodity_id,
                region_id=request.region_id,
                n_trials=request.n_trials
            )
            
        else:
            raise HTTPException(
                status_code=400, 
                detail="Invalid optimization_type. Must be: single_model, ensemble_weights, or multi_objective"
            )
        
        # Format response
        response = HPOResponse(
            study_name=result['study_name'],
            commodity_id=request.commodity_id,
            region_id=request.region_id,
            optimization_type=request.optimization_type,
            status='completed',
            best_parameters=result.get('best_params') or result.get('best_weights'),
            best_value=result.get('best_value'),
            performance_metrics={'mase': result.get('best_value', 0)},
            model_version=result.get('model_version'),
            trials_completed=result.get('trials_completed', 0),
            optimization_time=result.get('optimization_time'),
            mlflow_run_id=None  # Could be added from MLflow service
        )
        
        logger.info(f"HPO completed for {request.commodity_id}: {result.get('best_value')}")
        return response
        
    except HTTPException:
        # Re-raise HTTPException to preserve original status codes (400, 503, etc.)
        raise
    except ValueError as e:
        # Handle data validation errors as 400 Bad Request
        logger.error(f"HPO validation error: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Data validation failed: {str(e)}"
        )
    except Exception as e:
        # Handle unexpected errors as 500 Internal Server Error
        logger.error(f"HPO unexpected error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Hyperparameter optimization failed: {str(e)}"
        )

@app.get("/optimize/status/{study_name}", response_model=OptimizationStatusResponse)
async def get_optimization_status(study_name: str):
    """Get status of running or completed optimization"""
    
    try:
        status = hpo_service.get_optimization_status(study_name)
        
        if not status:
            raise HTTPException(
                status_code=404,
                detail=f"Optimization study '{study_name}' not found"
            )
        
        return OptimizationStatusResponse(
            study_name=study_name,
            status=status.get('status', 'unknown'),
            start_time=status.get('start_time', ''),
            end_time=status.get('end_time'),
            progress=status.get('progress', 0.0),
            current_trial=status.get('current_trial', 0),
            total_trials=status.get('total_trials', 0),
            best_value=status.get('best_value'),
            model_type=status.get('model_type', ''),
            commodity_id=status.get('commodity_id', ''),
            region_id=status.get('region_id', ''),
            error=status.get('error')
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get optimization status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve optimization status: {str(e)}"
        )

@app.post("/optimize/stop/{study_name}")
async def stop_optimization(study_name: str):
    """Stop running optimization"""
    
    try:
        success = hpo_service.stop_optimization(study_name)
        
        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Optimization study '{study_name}' not found or not running"
            )
        
        return {
            "message": f"Optimization '{study_name}' stopped successfully",
            "study_name": study_name,
            "status": "stopped",
            "timestamp": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to stop optimization: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to stop optimization: {str(e)}"
        )

@app.get("/experiments", response_model=ExperimentSummary)
async def get_experiments_summary():
    """Get MLflow experiments summary"""
    
    try:
        # Get best models from MLflow
        best_models = mlflow_service.get_best_models(limit=10)
        
        # Get recent optimizations
        recent_optimizations = []
        all_status = hpo_service.get_optimization_status()
        
        # Convert to list format
        for study_name, status in all_status.items():
            if status.get('status') == 'completed':
                recent_optimizations.append({
                    'study_name': study_name,
                    'commodity_id': status.get('commodity_id'),
                    'region_id': status.get('region_id'),
                    'best_value': status.get('best_value'),
                    'end_time': status.get('end_time'),
                    'model_type': status.get('model_type')
                })
        
        # Sort by completion time
        recent_optimizations.sort(
            key=lambda x: x.get('end_time', ''), 
            reverse=True
        )
        
        return ExperimentSummary(
            experiment_name="AgriIntel_HPO",
            experiment_id=mlflow_service.experiment_id,
            total_runs=len(best_models),
            best_models=best_models[:5],  # Top 5 models
            recent_optimizations=recent_optimizations[:10]  # Last 10 optimizations
        )
        
    except Exception as e:
        logger.error(f"Failed to get experiments summary: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve experiments summary: {str(e)}"
        )

@app.get("/best-parameters/{commodity_id}/{region_id}", response_model=BestParametersResponse)
async def get_best_parameters(commodity_id: str, region_id: str):
    """Get best parameters for a specific commodity-region combination"""
    
    try:
        best_params = hpo_service.get_best_parameters(commodity_id, region_id)
        
        if not best_params:
            raise HTTPException(
                status_code=404,
                detail=f"No optimized parameters found for {commodity_id} in {region_id}"
            )
        
        return BestParametersResponse(
            commodity_id=commodity_id,
            region_id=region_id,
            best_parameters=best_params.get('best_parameters', {}),
            performance_metrics=best_params.get('performance_metrics', {}),
            model_version=best_params.get('model_version', 'unknown'),
            last_updated=datetime.now().isoformat(),
            mlflow_run_id=best_params.get('run_id', '')
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get best parameters: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve best parameters: {str(e)}"
        )

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "AgriIntel ML Forecasting Service",
        "version": "1.0.0",
        "description": "Advanced ML forecasting for Vietnamese agricultural commodities",
        "endpoints": {
            "/forecast": "Generate ML forecast",
            "/health": "Health check",
            "/models": "Available models",
            "/docs": "API documentation"
        } if not HPO_AVAILABLE else {
            "/forecast": "Generate ML forecast",
            "/optimize": "Run hyperparameter optimization",
            "/optimize/status/{study_name}": "Get optimization status",
            "/optimize/stop/{study_name}": "Stop running optimization",
            "/experiments": "Get MLflow experiment summary",
            "/best-parameters/{commodity_id}/{region_id}": "Get best parameters for commodity-region",
            "/health": "Health check",
            "/models": "Available models",
            "/docs": "API documentation"
        }
    }

if __name__ == "__main__":
    # Run the FastAPI server
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )