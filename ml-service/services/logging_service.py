#!/usr/bin/env python3
"""
AgriIntel Comprehensive Logging Service
Detailed metadata logging for LLM interactions, quality control, and monitoring
"""

import json
import logging
import time
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass, asdict
from enum import Enum
import os

from models.data_collection_schemas import (
    LLMMetadata, DataCollectionResult, ValidationResult, 
    DeduplicationInfo, BatchCollectionResult
)

class LogLevel(str, Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"

class LogCategory(str, Enum):
    LLM_INTERACTION = "llm_interaction"
    DATA_QUALITY = "data_quality"
    DEDUPLICATION = "deduplication"
    VALIDATION = "validation"
    BATCH_PROCESSING = "batch_processing"
    PERFORMANCE = "performance"
    ERROR_HANDLING = "error_handling"
    RETRY_ATTEMPT = "retry_attempt"

@dataclass
class LogEntry:
    """Comprehensive log entry structure"""
    timestamp: str
    level: LogLevel
    category: LogCategory
    message: str
    metadata: Dict[str, Any]
    trace_id: Optional[str] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    correlation_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str, ensure_ascii=False)

class ComprehensiveLogger:
    """
    Advanced logging service for AgriIntel data collection pipeline
    """
    
    def __init__(self, 
                 log_dir: str = "logs",
                 max_file_size_mb: int = 50,
                 max_files: int = 10,
                 enable_console: bool = True,
                 enable_structured: bool = True):
        
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)
        
        self.max_file_size = max_file_size_mb * 1024 * 1024
        self.max_files = max_files
        self.enable_console = enable_console
        self.enable_structured = enable_structured
        
        # Set up Python logging
        self.logger = logging.getLogger("agriintel.data_collection")
        self.logger.setLevel(logging.DEBUG)
        
        # Structured log file handler
        if self.enable_structured:
            structured_handler = logging.FileHandler(
                self.log_dir / "structured.jsonl", encoding="utf-8"
            )
            structured_formatter = logging.Formatter('%(message)s')
            structured_handler.setFormatter(structured_formatter)
            self.logger.addHandler(structured_handler)
        
        # Console handler
        if self.enable_console:
            console_handler = logging.StreamHandler()
            console_formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            console_handler.setFormatter(console_formatter)
            self.logger.addHandler(console_handler)
            
        # Performance tracking
        self.performance_metrics: Dict[str, List[float]] = {}
        self.error_counts: Dict[str, int] = {}
        
    def log_llm_interaction(self,
                           provider: str,
                           metadata: LLMMetadata,
                           prompt: str,
                           response: str,
                           success: bool,
                           error: Optional[str] = None,
                           trace_id: Optional[str] = None) -> None:
        """Log detailed LLM interaction with full metadata"""
        
        llm_metadata = {
            "provider": provider,
            "model": metadata.model,
            "version": metadata.version,
            "prompt_version": metadata.prompt_version,
            "schema_version": metadata.schema_version,
            
            # Request parameters
            "temperature": metadata.temperature,
            "top_p": metadata.top_p,
            "max_tokens": metadata.max_tokens,
            "seed": metadata.seed,
            "n_completions": metadata.n_completions,
            
            # Token usage
            "prompt_tokens": metadata.prompt_tokens,
            "completion_tokens": metadata.completion_tokens,
            "total_tokens": metadata.total_tokens,
            
            # Timing
            "request_timestamp": metadata.request_timestamp.isoformat() if metadata.request_timestamp else None,
            "response_timestamp": metadata.response_timestamp.isoformat() if metadata.response_timestamp else None,
            "duration_ms": metadata.duration_ms,
            
            # Quality control
            "retry_count": metadata.retry_count,
            "finish_reason": metadata.finish_reason,
            "tool_calls": len(metadata.tool_calls),
            
            # Content lengths for analysis
            "prompt_length": len(prompt),
            "response_length": len(response),
            
            # Success metrics
            "success": success,
            "error": error
        }
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=LogLevel.ERROR if error else LogLevel.INFO,
            category=LogCategory.LLM_INTERACTION,
            message=f"LLM interaction with {provider}",
            metadata=llm_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        
        # Track performance metrics
        if metadata.duration_ms:
            self._track_performance(f"{provider}_response_time", metadata.duration_ms)
            
        # Track error rates
        if error:
            self._track_error(f"{provider}_error")

    def log_data_quality(self,
                        result: ValidationResult,
                        data_points_count: int,
                        raw_response_length: int,
                        trace_id: Optional[str] = None) -> None:
        """Log comprehensive data quality metrics"""
        
        quality_metadata = {
            "is_valid": result.is_valid,
            "quality_score": result.quality_score,
            "data_points_count": data_points_count,
            "raw_response_length": raw_response_length,
            
            # Validation checks
            "length_check": result.length_check,
            "language_check": result.language_check,
            "pii_check": result.pii_check,
            "repetition_ratio": result.repetition_ratio,
            
            # Issues
            "validation_errors": result.validation_errors,
            "quality_flags": result.quality_flags,
            "blacklist_violations": result.blacklist_violations,
            
            # Derived metrics
            "error_count": len(result.validation_errors),
            "flag_count": len(result.quality_flags),
            "avg_response_length_per_point": raw_response_length / max(data_points_count, 1)
        }
        
        level = LogLevel.ERROR if not result.is_valid else LogLevel.WARNING if result.quality_flags else LogLevel.INFO
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            category=LogCategory.DATA_QUALITY,
            message=f"Data quality assessment: {result.quality_score:.2f} score",
            metadata=quality_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        
        # Track quality metrics
        self._track_performance("quality_score", result.quality_score)
        if not result.is_valid:
            self._track_error("validation_failure")

    def log_deduplication(self,
                         dedup_info: DeduplicationInfo,
                         method: str = "sha256",
                         trace_id: Optional[str] = None) -> None:
        """Log deduplication analysis results"""
        
        dedup_metadata = {
            "method": method,
            "content_hash": dedup_info.content_hash,
            "is_duplicate": dedup_info.is_duplicate,
            "duplicate_of": dedup_info.duplicate_of,
            "similarity_score": dedup_info.similarity_score,
            "has_minhash": dedup_info.minhash_signature is not None,
            "normalized_json_length": len(dedup_info.normalized_json),
            
            # Hash analysis
            "hash_length": len(dedup_info.content_hash),
            "hash_prefix": dedup_info.content_hash[:8] if dedup_info.content_hash else None
        }
        
        level = LogLevel.WARNING if dedup_info.is_duplicate else LogLevel.DEBUG
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            category=LogCategory.DEDUPLICATION,
            message=f"Deduplication check: {'duplicate' if dedup_info.is_duplicate else 'unique'}",
            metadata=dedup_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        
        # Track deduplication metrics
        if dedup_info.is_duplicate:
            self._track_error("duplicate_detected")

    def log_batch_processing(self,
                           result: BatchCollectionResult,
                           trace_id: Optional[str] = None) -> None:
        """Log comprehensive batch processing results"""
        
        batch_metadata = {
            "batch_id": result.batch_id,
            "collection_method": result.request.collection_method.value,
            "collection_date": result.request.collection_date.isoformat(),
            
            # Request details
            "target_commodities_count": len(result.request.target_commodities),
            "target_regions_count": len(result.request.target_regions),
            "n_completions": result.request.n_completions,
            "consensus_threshold": result.request.consensus_threshold,
            
            # Results summary
            "total_collected": result.total_collected,
            "total_valid": result.total_valid,
            "total_duplicates": result.total_duplicates,
            "success_rate": result.total_valid / max(result.total_collected, 1),
            "duplicate_rate": result.total_duplicates / max(result.total_collected, 1),
            
            # Quality metrics
            "average_quality_score": result.average_quality_score,
            "average_confidence": result.average_confidence,
            
            # Timing
            "started_at": result.started_at.isoformat(),
            "completed_at": result.completed_at.isoformat() if result.completed_at else None,
            "duration_seconds": result.duration_seconds,
            
            # Error handling
            "partial_success": result.partial_success,
            "error_count": len(result.errors),
            "errors": result.errors[:5] if result.errors else []  # Limit error list
        }
        
        level = LogLevel.ERROR if result.errors else LogLevel.WARNING if result.partial_success else LogLevel.INFO
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            category=LogCategory.BATCH_PROCESSING,
            message=f"Batch processing completed: {result.total_valid}/{result.total_collected} valid",
            metadata=batch_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        
        # Track batch metrics
        self._track_performance("batch_duration", result.duration_seconds or 0)
        self._track_performance("batch_success_rate", result.total_valid / max(result.total_collected, 1))

    def log_performance(self,
                       operation: str,
                       duration_ms: float,
                       additional_metrics: Optional[Dict[str, Any]] = None,
                       trace_id: Optional[str] = None) -> None:
        """Log performance metrics for operations"""
        
        perf_metadata = {
            "operation": operation,
            "duration_ms": duration_ms,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        if additional_metrics:
            perf_metadata.update(additional_metrics)
            
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=LogLevel.DEBUG,
            category=LogCategory.PERFORMANCE,
            message=f"Performance: {operation} took {duration_ms:.2f}ms",
            metadata=perf_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        self._track_performance(operation, duration_ms)

    def log_retry_attempt(self,
                         operation: str,
                         attempt: int,
                         max_attempts: int,
                         error: str,
                         backoff_delay: float,
                         trace_id: Optional[str] = None) -> None:
        """Log retry attempts with backoff information"""
        
        retry_metadata = {
            "operation": operation,
            "attempt": attempt,
            "max_attempts": max_attempts,
            "error": error,
            "backoff_delay_seconds": backoff_delay,
            "remaining_attempts": max_attempts - attempt
        }
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=LogLevel.WARNING,
            category=LogCategory.RETRY_ATTEMPT,
            message=f"Retry attempt {attempt}/{max_attempts} for {operation}",
            metadata=retry_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        self._track_error(f"{operation}_retry")

    def log_error(self,
                 operation: str,
                 error: Exception,
                 context: Optional[Dict[str, Any]] = None,
                 trace_id: Optional[str] = None) -> None:
        """Log detailed error information"""
        
        error_metadata = {
            "operation": operation,
            "error_type": type(error).__name__,
            "error_message": str(error),
            "error_args": error.args if hasattr(error, 'args') else None,
            "context": context or {}
        }
        
        # Add stack trace for debugging
        import traceback
        error_metadata["stack_trace"] = traceback.format_exc()
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=LogLevel.ERROR,
            category=LogCategory.ERROR_HANDLING,
            message=f"Error in {operation}: {str(error)}",
            metadata=error_metadata,
            trace_id=trace_id
        )
        
        self._write_log(entry)
        self._track_error(operation)

    def get_performance_summary(self) -> Dict[str, Any]:
        """Get performance metrics summary"""
        summary = {}
        
        for metric, values in self.performance_metrics.items():
            if values:
                summary[metric] = {
                    "count": len(values),
                    "avg": sum(values) / len(values),
                    "min": min(values),
                    "max": max(values),
                    "recent_avg": sum(values[-10:]) / min(len(values), 10)  # Last 10 values
                }
                
        summary["error_counts"] = dict(self.error_counts)
        summary["generated_at"] = datetime.now(timezone.utc).isoformat()
        
        return summary

    def _write_log(self, entry: LogEntry) -> None:
        """Write log entry to structured file"""
        if self.enable_structured:
            self.logger.log(
                getattr(logging, entry.level.value),
                entry.to_json()
            )
        else:
            # Fallback to simple message
            self.logger.log(
                getattr(logging, entry.level.value),
                f"[{entry.category.value}] {entry.message}"
            )

    def _track_performance(self, metric: str, value: float) -> None:
        """Track performance metrics"""
        if metric not in self.performance_metrics:
            self.performance_metrics[metric] = []
        
        self.performance_metrics[metric].append(value)
        
        # Keep only recent values to prevent memory issues
        if len(self.performance_metrics[metric]) > 1000:
            self.performance_metrics[metric] = self.performance_metrics[metric][-500:]

    def _track_error(self, error_type: str) -> None:
        """Track error counts"""
        self.error_counts[error_type] = self.error_counts.get(error_type, 0) + 1

# Global logger instance
comprehensive_logger = ComprehensiveLogger()

# Convenience functions
def log_llm_interaction(*args, **kwargs):
    return comprehensive_logger.log_llm_interaction(*args, **kwargs)

def log_data_quality(*args, **kwargs):
    return comprehensive_logger.log_data_quality(*args, **kwargs)

def log_deduplication(*args, **kwargs):
    return comprehensive_logger.log_deduplication(*args, **kwargs)

def log_batch_processing(*args, **kwargs):
    return comprehensive_logger.log_batch_processing(*args, **kwargs)

def log_performance(*args, **kwargs):
    return comprehensive_logger.log_performance(*args, **kwargs)

def log_retry_attempt(*args, **kwargs):
    return comprehensive_logger.log_retry_attempt(*args, **kwargs)

def log_error(*args, **kwargs):
    return comprehensive_logger.log_error(*args, **kwargs)

def get_performance_summary():
    return comprehensive_logger.get_performance_summary()

if __name__ == "__main__":
    # Test logging
    logger = ComprehensiveLogger()
    
    # Sample metadata
    from models.data_collection_schemas import LLMMetadata
    metadata = LLMMetadata(
        provider="gemini",
        model="gemini-2.5-pro",
        version="2.5",
        temperature=0.2,
        top_p=0.95,
        max_tokens=8192,
        n_completions=1,
        prompt_tokens=150,
        completion_tokens=300,
        total_tokens=450,
        duration_ms=1250.5,
        retry_count=0
    )
    
    logger.log_llm_interaction(
        provider="gemini",
        metadata=metadata,
        prompt="Test prompt",
        response="Test response",
        success=True,
        trace_id="test_trace_123"
    )
    
    print("Logging test completed. Check logs/ directory.")
    print("Performance summary:", logger.get_performance_summary())