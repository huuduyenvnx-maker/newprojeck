import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
import lightgbm as lgb
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
import warnings
warnings.filterwarnings('ignore')

from .base import BaseTimeSeriesModel, ForecastResult

class LightGBMModel(BaseTimeSeriesModel):
    """LightGBM model for time series forecasting with feature engineering"""
    
    def __init__(self, **lgb_params):
        super().__init__("LightGBM")
        
        # Default LightGBM parameters optimized for time series
        default_params = {
            'objective': 'regression',
            'metric': 'mae',
            'boosting_type': 'gbdt',
            'num_leaves': 31,
            'learning_rate': 0.05,
            'feature_fraction': 0.8,
            'bagging_fraction': 0.8,
            'bagging_freq': 5,
            'verbose': -1,
            'random_state': 42,
            'n_estimators': 100
        }
        
        # Update with user-provided parameters
        self.lgb_params = {**default_params, **lgb_params}
        self.model: Optional[Any] = None
        self.feature_columns: Optional[List[str]] = None
        self.data: Optional[pd.DataFrame] = None
        self.scaler_mean: Optional[np.ndarray] = None
        self.scaler_std: Optional[np.ndarray] = None
        self.feature_importance: Dict[str, float] = {}
        
    def _create_lag_features(self, df: pd.DataFrame, lags: List[int]) -> pd.DataFrame:
        """Create lagged features for the price column"""
        result_df = df.copy()
        
        for lag in lags:
            result_df[f'price_lag_{lag}'] = df['price'].shift(lag)
            
        return result_df
        
    def _create_rolling_features(self, df: pd.DataFrame, windows: List[int]) -> pd.DataFrame:
        """Create rolling window features"""
        result_df = df.copy()
        
        for window in windows:
            result_df[f'price_mean_{window}'] = df['price'].rolling(window).mean()
            result_df[f'price_std_{window}'] = df['price'].rolling(window).std()
            result_df[f'price_min_{window}'] = df['price'].rolling(window).min()
            result_df[f'price_max_{window}'] = df['price'].rolling(window).max()
            
        return result_df
        
    def _prepare_features(self, data: pd.DataFrame) -> pd.DataFrame:
        """Create comprehensive feature set for LightGBM"""
        df = self.create_features(data)  # Base features from parent class
        
        # Additional LightGBM-specific features
        lags = [1, 2, 3, 7, 14, 30]  # Various lag periods
        windows = [7, 14, 30]  # Rolling window sizes
        
        # Create lag features
        df = self._create_lag_features(df, lags)
        
        # Create rolling features
        df = self._create_rolling_features(df, windows)
        
        # Price ratio features
        df['price_to_ma7'] = df['price'] / df['ma_7']
        df['price_to_ma30'] = df['price'] / df['ma_30']
        
        # Momentum features
        df['momentum_3'] = df['price'] / df['price_lag3'] - 1
        df['momentum_7'] = df['price'] / df['price_lag7'] - 1
        df['momentum_30'] = df['price'] / df['price_lag30'] - 1
        
        # Vietnamese market-specific features
        df['is_holiday'] = df['month'].apply(lambda x: 1 if x in [1, 4, 9] else 0)  # Tet, Reunification Day, National Day
        df['monsoon_season'] = df['month'].apply(lambda x: 1 if x in [5, 6, 7, 8, 9, 10] else 0)
        
        return df
        
    def _prepare_training_data(self, df: pd.DataFrame) -> tuple:
        """Prepare training data with proper time series splits"""
        # Drop rows with NaN values (caused by lag/rolling features)
        df_clean = df.dropna()
        
        if len(df_clean) < 60:  # Need sufficient data for training
            raise ValueError("Insufficient data after feature engineering. Need at least 60 observations.")
            
        # Define feature columns (exclude target and date)
        exclude_cols = ['date', 'price']
        self.feature_columns = [col for col in df_clean.columns if col not in exclude_cols]
        
        # Prepare features and target
        X = df_clean[self.feature_columns].values
        y = df_clean['price'].values
        
        # Normalize features
        X_array = np.asarray(X, dtype=np.float64)
        self.scaler_mean = np.mean(X_array, axis=0)
        self.scaler_std = np.std(X_array, axis=0) + 1e-8  # Avoid division by zero
        X_scaled = (X_array - self.scaler_mean) / self.scaler_std
        
        return X_scaled, y, df_clean
        
    def fit(self, data: pd.DataFrame) -> 'LightGBMModel':
        """Fit LightGBM model to historical price data"""
        # Validate and preprocess data
        data = self.validate_data(data)
        self.data = data.copy()
        
        # Prepare features
        df_features = self._prepare_features(data)
        
        # Prepare training data
        X, y, df_clean = self._prepare_training_data(df_features)
        
        # Train LightGBM model
        try:
            # Use time series cross-validation for model selection
            tscv = TimeSeriesSplit(n_splits=3)
            train_scores = []
            
            for train_idx, val_idx in tscv.split(X):
                X_train, X_val = X[train_idx], X[val_idx]
                y_train, y_val = y[train_idx], y[val_idx]
                
                # Create LightGBM datasets
                train_data = lgb.Dataset(X_train, label=y_train)
                val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)
                
                # Train model
                temp_model = lgb.train(
                    self.lgb_params,
                    train_data,
                    valid_sets=[val_data],
                    callbacks=[lgb.early_stopping(50), lgb.log_evaluation(0)]
                )
                
                # Evaluate
                val_pred = temp_model.predict(X_val)
                score = mean_absolute_error(y_val, val_pred)
                train_scores.append(score)
            
            # Train final model on all data
            train_data = lgb.Dataset(X, label=y)
            self.model = lgb.train(
                self.lgb_params,
                train_data,
                callbacks=[lgb.log_evaluation(0)]
            )
            
            # Store feature importance
            if self.feature_columns is not None and self.model is not None:
                self.feature_importance = dict(zip(self.feature_columns, self.model.feature_importance()))
            else:
                self.feature_importance = {}
            
            self.is_fitted = True
            
        except Exception as e:
            print(f"LightGBM training failed: {e}")
            # Fallback to simpler model
            self.lgb_params['n_estimators'] = 50
            self.lgb_params['num_leaves'] = 15
            train_data = lgb.Dataset(X, label=y)
            self.model = lgb.train(self.lgb_params, train_data, callbacks=[lgb.log_evaluation(0)])
            self.is_fitted = True
            
        return self
        
    def forecast(self, horizon: int) -> ForecastResult:
        """Generate LightGBM forecast using recursive prediction"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before forecasting")
            
        # Prepare data for forecasting
        if self.data is None:
            raise ValueError("No training data available")
            
        df_features = self._prepare_features(self.data)
        df_clean = df_features.dropna()
        
        # Start with the last known values
        last_row = df_clean.iloc[-1:].copy()
        predictions = []
        forecast_dates = []
        
        last_date = self.data['date'].max()
        
        for i in range(horizon):
            # Create date for this prediction
            forecast_date = last_date + pd.Timedelta(days=i+1)
            forecast_dates.append(forecast_date.strftime('%Y-%m-%d'))
            
            # Update time-based features
            last_row['day_of_week'] = forecast_date.dayofweek
            last_row['day_of_month'] = forecast_date.day
            last_row['month'] = forecast_date.month
            last_row['quarter'] = forecast_date.quarter
            
            # Update seasonal features
            last_row['rice_harvest_season'] = 1 if forecast_date.month in [2, 3, 6, 7, 10, 11] else 0
            last_row['coffee_harvest_season'] = 1 if forecast_date.month in [10, 11, 12, 1, 2, 3] else 0
            last_row['is_holiday'] = 1 if forecast_date.month in [1, 4, 9] else 0
            last_row['monsoon_season'] = 1 if forecast_date.month in [5, 6, 7, 8, 9, 10] else 0
            
            # Prepare features for prediction
            if self.feature_columns is None or self.scaler_mean is None or self.scaler_std is None:
                raise ValueError("Model not properly fitted")
            if self.model is None:
                raise ValueError("Model not trained")
                
            X_pred = last_row[self.feature_columns].values
            X_pred_array = np.asarray(X_pred, dtype=np.float64)
            X_pred_scaled = (X_pred_array - self.scaler_mean) / self.scaler_std
            
            # Make prediction
            pred_result = self.model.predict(X_pred_scaled)
            pred = float(pred_result[0]) if isinstance(pred_result, np.ndarray) else float(pred_result)
            predictions.append(pred)
            
            # Update lag features for next iteration
            last_row['price'] = pred
            last_row['price_lag1'] = last_row['price_lag1'].iloc[0] if len(predictions) == 1 else predictions[-2]
            
            # Update other lag features by shifting
            for lag in [2, 3, 7, 14, 30]:
                if lag <= len(predictions):
                    last_row[f'price_lag_{lag}'] = predictions[-lag] if len(predictions) >= lag else last_row[f'price_lag_{lag}'].iloc[0]
                    
        # Calculate confidence intervals based on historical performance
        historical_errors = self._calculate_historical_errors()
        confidence_scores = []
        lower_bounds = []
        upper_bounds = []
        
        for i, pred in enumerate(predictions):
            # Confidence decreases with forecast horizon
            confidence = max(0.6, 0.9 - (i / horizon) * 0.25)
            confidence_scores.append(confidence)
            
            # Error bounds based on historical performance
            error_multiplier = 1.96 * (1 + i * 0.05)  # Increasing uncertainty
            error = historical_errors * error_multiplier
            
            lower_bounds.append(pred - error)
            upper_bounds.append(pred + error)
            
        return ForecastResult(
            dates=forecast_dates,
            predictions=predictions,
            lower_bounds=lower_bounds,
            upper_bounds=upper_bounds,
            confidence=confidence_scores,
            model_name=self.name,
            metrics=self.get_metrics(),
            metadata={
                'feature_importance': dict(list(sorted(self.feature_importance.items(), key=lambda x: float(x[1]), reverse=True))[:10]) if self.feature_importance else {},
                'n_features': len(self.feature_columns) if self.feature_columns is not None else 0,
                'lgb_params': self.lgb_params
            }
        )
        
    def _calculate_historical_errors(self) -> float:
        """Calculate historical prediction errors for confidence intervals"""
        try:
            if self.data is None or self.model is None:
                return 0.1  # Fallback default error
                
            # Use the trained model to predict on training data
            df_features = self._prepare_features(self.data)
            X, y, _ = self._prepare_training_data(df_features)
            
            # Make predictions
            predictions = self.model.predict(X)
            
            # Calculate error metrics
            mae = mean_absolute_error(y, predictions)
            
            return float(mae)
            
        except Exception as e:
            print(f"Error calculating historical errors: {e}")
            return float(np.std(self.data['price']) * 0.1) if self.data is not None else 0.1  # Fallback
            
    def get_metrics(self, test_data: Optional[pd.DataFrame] = None) -> Dict[str, float]:
        """Calculate LightGBM model performance metrics"""
        if not self.is_fitted:
            return {}
            
        try:
            if self.data is None or self.model is None:
                return {}
                
            # Use training data for in-sample metrics
            df_features = self._prepare_features(self.data)
            X, y, _ = self._prepare_training_data(df_features)
            
            # Make predictions
            predictions = self.model.predict(X)
            
            # Calculate metrics
            mae = mean_absolute_error(y, predictions)
            rmse = np.sqrt(mean_squared_error(y, predictions))
            
            # Avoid division by zero in MAPE calculation
            y_nonzero = np.where(y != 0, y, 1e-8)  # Replace zeros with small value
            mape = np.mean(np.abs((y - predictions) / y_nonzero)) * 100
            
            # Mean Absolute Scaled Error (MASE)
            naive_errors = np.abs(np.diff(y))
            naive_mae = np.mean(naive_errors)
            mase = float(mae) / float(naive_mae) if naive_mae > 0 else 1.0
            
            # Get top feature safely
            top_feature_name = 'unknown'
            if self.feature_importance:
                try:
                    top_feature_name = max(self.feature_importance.items(), key=lambda item: float(item[1]))[0]
                except (ValueError, TypeError):
                    top_feature_name = 'unknown'
                    
            return {
                'mae': float(mae),
                'rmse': float(rmse),
                'mape': float(mape),
                'mase': float(mase),
                'n_features': float(len(self.feature_columns)) if self.feature_columns is not None else 0.0,
                'top_feature_score': float(max(self.feature_importance.values())) if self.feature_importance else 0.0
            }
            
        except Exception as e:
            print(f"Error calculating LightGBM metrics: {e}")
            return {
                'mae': 0.0,
                'rmse': 0.0,
                'mape': 0.0,
                'mase': 1.0
            }