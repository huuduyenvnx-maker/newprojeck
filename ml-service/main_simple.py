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

from models.ensemble_model_simple import SimpleEnsembleModel
from models.arima_model import ARIMAModel
from models.ets_model import ETSModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="AgriIntel ML Forecasting Service (Simple)",
    description="Advanced ML forecasting microservice for Vietnamese agricultural commodities (ARIMA + ETS)",
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
    model_type: str = Field(default="ensemble", description="Model type: ensemble, arima, ets")

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

# Global model cache
model_cache = {}
model_training_status = {}

def get_model_instance(model_type: str):
    """Get or create model instance"""
    if model_type not in model_cache:
        if model_type == "ensemble":
            model_cache[model_type] = SimpleEnsembleModel()  # Use simple ensemble
        elif model_type == "arima":
            model_cache[model_type] = ARIMAModel()
        elif model_type == "ets":
            model_cache[model_type] = ETSModel()
        else:
            raise ValueError(f"Unknown model type: {model_type}")
            
        model_training_status[model_type] = "not_fitted"
        
    return model_cache[model_type]

def prepare_historical_data(historical_prices: List[HistoricalPrice]) -> pd.DataFrame:
    """Convert historical prices to DataFrame with proper preprocessing"""
    data = []
    
    for price_point in historical_prices:
        # Ensure all numeric fields are properly converted to float
        try:
            price_val = float(price_point.price)
            volume_val = float(price_point.volume) if price_point.volume is not None else None
        except (ValueError, TypeError) as e:
            logger.error(f"Data conversion error for price_point: {price_point}")
            raise ValueError(f"Invalid numeric data: {e}")
            
        data.append({
            'date': price_point.date,
            'price': price_val,
            'currency': price_point.currency,
            'volume': volume_val
        })
    
    df = pd.DataFrame(data)
    logger.info(f"Created DataFrame with {len(df)} rows and columns: {df.columns.tolist()}")
    logger.info(f"Data types: {df.dtypes.to_dict()}")
    
    # Convert date column
    df['date'] = pd.to_datetime(df['date'])
    
    # Ensure price column is numeric
    df['price'] = pd.to_numeric(df['price'], errors='coerce')
    df['volume'] = pd.to_numeric(df['volume'], errors='coerce')
    
    # Handle currency conversion (for Vietnamese market)
    df['price_usd'] = df['price']  # Placeholder for currency conversion
    
    # Sort by date and remove duplicates
    df = df.sort_values('date').drop_duplicates(subset=['date'])
    
    # Handle missing values with forward fill
    df['price'] = df['price'].fillna(method='ffill')
    
    # Remove any remaining NaN values
    df = df.dropna(subset=['price'])
    
    logger.info(f"Final DataFrame shape: {df.shape}, price range: {df['price'].min():.2f} - {df['price'].max():.2f}")
    
    return df

def _safe_float(value, fallback: float = 0.0) -> float:
    """Safely convert value to float, handling NaN/inf/numpy types"""
    try:
        if np.isnan(value) or np.isinf(value):
            return fallback
        return float(value)
    except (TypeError, ValueError):
        return fallback

def _safe_round(value, decimals: int, fallback: float = 0.0) -> float:
    """Safely round a value, handling NaN/inf/numpy types"""
    safe_val = _safe_float(value, fallback)
    try:
        return round(safe_val, decimals)
    except:
        return fallback

def format_quantile_forecast(forecast_result, commodity_id: str, region_id: str, model_type: str) -> ForecastResponse:
    """Format model output to API response format"""
    
    if hasattr(forecast_result, 'dates'):
        # Handle ForecastResult from individual models
        predictions = []
        for i in range(len(forecast_result.dates)):
            # For individual models, approximate additional quantiles
            # Convert all values to safe floats first
            pred = _safe_float(forecast_result.predictions[i], 1.0)
            lower = _safe_float(forecast_result.lower_bounds[i], pred * 0.9)
            upper = _safe_float(forecast_result.upper_bounds[i], pred * 1.1)
            conf = _safe_float(forecast_result.confidence[i], 0.7)
            
            # Ensure logical ordering: lower <= pred <= upper
            if lower > pred:
                lower = pred * 0.95
            if upper < pred:
                upper = pred * 1.05
            if lower > upper:
                lower, upper = upper * 0.95, upper
            
            # Approximate quantiles from confidence interval
            q10 = lower
            q25 = pred - (pred - lower) * 0.5 if pred > lower else pred * 0.98
            median = pred
            q75 = pred + (upper - pred) * 0.5 if upper > pred else pred * 1.02
            q90 = upper
            
            # Safe volatility calculation
            if median > 0:
                volatility = abs(upper - lower) / median
                if np.isnan(volatility) or np.isinf(volatility) or volatility > 1.0:
                    volatility = 0.1  # Fallback volatility
            else:
                volatility = 0.1  # Default volatility
            
            predictions.append(QuantilePrediction(
                date=str(forecast_result.dates[i]),
                q10=_safe_round(q10, 2),
                q25=_safe_round(q25, 2),
                median=_safe_round(median, 2),
                q75=_safe_round(q75, 2),
                q90=_safe_round(q90, 2),
                confidence=_safe_round(conf, 3, 0.7),
                trend="stable",  # Simple default
                volatility=_safe_round(volatility, 4, 0.1)
            ))
        
        metadata = forecast_result.metadata if hasattr(forecast_result, 'metadata') else {}
        metrics = forecast_result.metrics if hasattr(forecast_result, 'metrics') else {}
        
        # Ensure all metadata values are JSON serializable
        if isinstance(metadata, dict):
            clean_metadata = {}
            for k, v in metadata.items():
                if isinstance(v, (int, float, str, bool, list, dict)):
                    if isinstance(v, (int, float)) and (np.isnan(v) or np.isinf(v)):
                        clean_metadata[k] = 0.0
                    else:
                        clean_metadata[k] = v
                else:
                    clean_metadata[k] = str(v)
            metadata = clean_metadata
        
        # Ensure all metrics are JSON serializable
        if isinstance(metrics, dict):
            clean_metrics = {}
            for k, v in metrics.items():
                clean_metrics[k] = _safe_float(v)
            metrics = clean_metrics
        
    else:
        # Handle QuantileForecast from ensemble model
        predictions = []
        for i in range(len(forecast_result.dates)):
            predictions.append(QuantilePrediction(
                date=str(forecast_result.dates[i]),
                q10=_safe_round(forecast_result.q10[i], 2),
                q25=_safe_round(forecast_result.q25[i], 2),
                median=_safe_round(forecast_result.median[i], 2),
                q75=_safe_round(forecast_result.q75[i], 2),
                q90=_safe_round(forecast_result.q90[i], 2),
                confidence=_safe_round(forecast_result.confidence[i], 3, 0.7),
                trend=str(forecast_result.trend[i]) if hasattr(forecast_result, 'trend') else "stable",
                volatility=_safe_round(forecast_result.volatility[i], 4, 0.1) if hasattr(forecast_result, 'volatility') else 0.1
            ))
        
        metadata = {"model_type": "ensemble", "quantile_forecast": True}
        metrics = {}
    
    return ForecastResponse(
        commodity_id=commodity_id,
        region_id=region_id,
        forecast_date=datetime.now().strftime('%Y-%m-%d'),
        horizon=len(predictions),
        model_type=model_type,
        model_version="v1.0.0-simple",
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
        
        # Validate model type (no lightgbm in simple version)
        valid_models = ["ensemble", "arima", "ets"]
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
        
    except HTTPException:
        # Re-raise HTTPException as-is (preserves status code)
        raise
        
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
    """Health check endpoint"""
    
    try:
        # Check model statuses
        model_statuses = []
        
        for model_name in ["ensemble", "arima", "ets"]:
            status = model_training_status.get(model_name, "not_fitted")
            
            model_status = ModelStatus(
                name=model_name,
                status="available" if status == "fitted" else status,
                last_trained=datetime.now().isoformat() if status == "fitted" else None,
                performance_metrics={}
            )
            
            # Get performance metrics if model is fitted
            if model_name in model_cache and model_cache[model_name].is_fitted:
                try:
                    model_status.performance_metrics = model_cache[model_name].get_metrics()
                except:
                    pass
                    
            model_statuses.append(model_status)
        
        return HealthResponse(
            status="healthy",
            timestamp=datetime.now().isoformat(),
            service_version="1.0.0-simple",
            models_status=model_statuses
        )
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail="Service unhealthy")

@app.get("/models", response_model=ModelsResponse)
async def get_models():
    """Get available models and their status"""
    
    available_models = ["ensemble", "arima", "ets"]
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

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "AgriIntel ML Forecasting Service (Simple)",
        "version": "1.0.0-simple",
        "description": "Advanced ML forecasting for Vietnamese agricultural commodities (ARIMA + ETS)",
        "models": ["ARIMA", "ETS", "Simple Ensemble"],
        "endpoints": {
            "/forecast": "Generate ML forecast",
            "/health": "Health check",
            "/models": "Available models",
            "/docs": "API documentation"
        }
    }

if __name__ == "__main__":
    # Run the FastAPI server
    uvicorn.run(
        "main_simple:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )