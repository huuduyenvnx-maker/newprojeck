#!/usr/bin/env python3
"""
AgriIntel Data Collection API Endpoints
FastAPI endpoints for managing agricultural data collection
"""

import asyncio
import uuid
from typing import Dict, List, Optional, Any
from datetime import date, datetime, timedelta
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Internal imports
from services.data_collector import LLMDataCollector
from services.logging_service import (
    comprehensive_logger, log_batch_processing, log_error, get_performance_summary
)
from services.deduplication_service import (
    deduplication_service, get_deduplication_stats
)
from models.data_collection_schemas import (
    BatchCollectionRequest, BatchCollectionResult, SourceType,
    DataCollectionResult, LLMResponse, ValidationResult
)

# Create router
router = APIRouter(prefix="/api/data-collection", tags=["data-collection"])

# Global collector instance
collector = LLMDataCollector()

# Active collection jobs tracking
active_jobs: Dict[str, Dict[str, Any]] = {}

# =====================================
# REQUEST/RESPONSE MODELS
# =====================================

class CollectionJobRequest(BaseModel):
    """Request model for starting a data collection job"""
    collection_date: Optional[date] = Field(default_factory=lambda: date.today())
    target_commodities: List[str] = Field(default_factory=list)
    target_regions: List[str] = Field(default_factory=list)
    provider: SourceType = SourceType.LLM_GEMINI
    n_completions: int = Field(3, ge=1, le=5)
    consensus_threshold: float = Field(0.6, ge=0.5, le=1.0)
    enable_near_duplicate_detection: bool = True
    priority: str = Field("normal", pattern="^(low|normal|high)$")

class CollectionJobResponse(BaseModel):
    """Response model for collection job status"""
    job_id: str
    status: str  # "pending", "running", "completed", "failed"
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    progress: Dict[str, Any] = Field(default_factory=dict)
    result_summary: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

class CollectionStatsResponse(BaseModel):
    """Response model for collection statistics"""
    total_jobs: int
    active_jobs: int
    completed_jobs: int
    failed_jobs: int
    deduplication_stats: Dict[str, Any]
    performance_summary: Dict[str, Any]
    last_collection: Optional[datetime] = None

# =====================================
# COLLECTION JOB ENDPOINTS
# =====================================

@router.post("/jobs", response_model=CollectionJobResponse)
async def start_collection_job(
    request: CollectionJobRequest,
    background_tasks: BackgroundTasks
) -> CollectionJobResponse:
    """
    Start a new data collection job
    """
    job_id = f"job_{uuid.uuid4().hex[:8]}_{int(datetime.utcnow().timestamp())}"
    
    # Create job tracking entry
    job_info = {
        "job_id": job_id,
        "status": "pending",
        "request": request,
        "created_at": datetime.utcnow(),
        "started_at": None,
        "completed_at": None,
        "progress": {"stage": "queued", "completion": 0.0},
        "result_summary": None,
        "error_message": None
    }
    
    active_jobs[job_id] = job_info
    
    # Start collection in background
    background_tasks.add_task(
        _execute_collection_job,
        job_id,
        request
    )
    
    # Log job creation
    comprehensive_logger.log_performance(
        operation="job_created",
        duration_ms=0,
        additional_metrics={
            "job_id": job_id,
            "provider": request.provider.value,
            "target_commodities": len(request.target_commodities),
            "n_completions": request.n_completions
        },
        trace_id=job_id
    )
    
    return CollectionJobResponse(
        job_id=job_id,
        status="pending",
        created_at=job_info["created_at"],
        progress=job_info["progress"]
    )

@router.get("/jobs/{job_id}", response_model=CollectionJobResponse)
async def get_collection_job(job_id: str) -> CollectionJobResponse:
    """
    Get status of a specific collection job
    """
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_info = active_jobs[job_id]
    
    return CollectionJobResponse(
        job_id=job_id,
        status=job_info["status"],
        created_at=job_info["created_at"],
        started_at=job_info.get("started_at"),
        completed_at=job_info.get("completed_at"),
        progress=job_info["progress"],
        result_summary=job_info.get("result_summary"),
        error_message=job_info.get("error_message")
    )

@router.get("/jobs", response_model=List[CollectionJobResponse])
async def list_collection_jobs(
    status: Optional[str] = Query(None, regex="^(pending|running|completed|failed)$"),
    limit: int = Query(50, ge=1, le=100)
) -> List[CollectionJobResponse]:
    """
    List collection jobs with optional status filter
    """
    jobs = []
    
    for job_info in list(active_jobs.values()):
        if status is None or job_info["status"] == status:
            jobs.append(CollectionJobResponse(
                job_id=job_info["job_id"],
                status=job_info["status"],
                created_at=job_info["created_at"],
                started_at=job_info.get("started_at"),
                completed_at=job_info.get("completed_at"),
                progress=job_info["progress"],
                result_summary=job_info.get("result_summary"),
                error_message=job_info.get("error_message")
            ))
    
    # Sort by created_at descending and limit
    jobs.sort(key=lambda x: x.created_at, reverse=True)
    return jobs[:limit]

@router.delete("/jobs/{job_id}")
async def cancel_collection_job(job_id: str) -> Dict[str, str]:
    """
    Cancel a running collection job
    """
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_info = active_jobs[job_id]
    
    if job_info["status"] in ["completed", "failed"]:
        raise HTTPException(status_code=400, detail="Job already finished")
    
    # Mark as cancelled (actual cancellation implementation would be more complex)
    job_info["status"] = "cancelled"
    job_info["completed_at"] = datetime.utcnow()
    job_info["error_message"] = "Job cancelled by user"
    
    comprehensive_logger.log_performance(
        operation="job_cancelled",
        duration_ms=0,
        additional_metrics={"job_id": job_id},
        trace_id=job_id
    )
    
    return {"message": f"Job {job_id} cancelled"}

# =====================================
# IMMEDIATE COLLECTION ENDPOINTS
# =====================================

@router.post("/collect/daily", response_model=BatchCollectionResult)
async def collect_daily_data(
    collection_date: Optional[date] = Query(None, description="Date to collect data for"),
    provider: SourceType = Query(SourceType.LLM_GEMINI, description="LLM provider to use"),
    commodities: Optional[List[str]] = Query(None, description="Specific commodities to collect"),
    regions: Optional[List[str]] = Query(None, description="Specific regions to collect")
) -> BatchCollectionResult:
    """
    Immediately collect daily agricultural price data
    """
    try:
        target_date = collection_date or date.today()
        
        # Execute collection
        result = await collector.collect_daily_prices(
            target_date=target_date,
            commodities=commodities,
            regions=regions,
            provider=provider
        )
        
        # Log the collection
        log_batch_processing(result, trace_id=f"immediate_{int(datetime.utcnow().timestamp())}")
        
        return result
        
    except Exception as e:
        log_error("immediate_collection", e)
        raise HTTPException(status_code=500, detail=f"Collection failed: {str(e)}")

@router.post("/collect/test")
async def test_collection(
    provider: SourceType = Query(SourceType.LLM_GEMINI, description="Provider to test"),
    n_samples: int = Query(1, ge=1, le=3, description="Number of test samples")
) -> Dict[str, Any]:
    """
    Test collection with minimal data for validation
    """
    try:
        # Use minimal test request
        test_commodities = ["Gạo ST25", "Cà phê Robusta"]
        test_regions = ["Mekong Delta"]
        
        result = await collector.collect_daily_prices(
            target_date=date.today(),
            commodities=test_commodities,
            regions=test_regions,
            provider=provider
        )
        
        return {
            "success": True,
            "provider": provider.value,
            "samples_requested": n_samples,
            "results_collected": result.total_collected,
            "results_valid": result.total_valid,
            "quality_score": result.average_quality_score,
            "confidence": result.average_confidence,
            "duration_seconds": result.duration_seconds
        }
        
    except Exception as e:
        log_error("test_collection", e)
        return {
            "success": False,
            "error": str(e),
            "provider": provider.value
        }

# =====================================
# STATISTICS AND MONITORING ENDPOINTS
# =====================================

@router.get("/stats", response_model=CollectionStatsResponse)
async def get_collection_statistics() -> CollectionStatsResponse:
    """
    Get comprehensive collection statistics
    """
    # Count jobs by status
    total_jobs = len(active_jobs)
    active_count = sum(1 for job in active_jobs.values() if job["status"] in ["pending", "running"])
    completed_count = sum(1 for job in active_jobs.values() if job["status"] == "completed")
    failed_count = sum(1 for job in active_jobs.values() if job["status"] in ["failed", "cancelled"])
    
    # Get last collection time
    last_collection = None
    for job in active_jobs.values():
        if job["status"] == "completed" and job.get("completed_at"):
            if last_collection is None or job["completed_at"] > last_collection:
                last_collection = job["completed_at"]
    
    return CollectionStatsResponse(
        total_jobs=total_jobs,
        active_jobs=active_count,
        completed_jobs=completed_count,
        failed_jobs=failed_count,
        deduplication_stats=get_deduplication_stats(),
        performance_summary=get_performance_summary(),
        last_collection=last_collection
    )

@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    Health check endpoint for the data collection service
    """
    try:
        # Test basic functionality
        test_start = datetime.utcnow()
        
        # Check if we can create a sample request
        sample_request = BatchCollectionRequest(
            collection_date=date.today(),
            target_commodities=["Test"],
            target_regions=["Test"],
            collection_method=SourceType.LLM_GEMINI
        )
        
        health_duration = (datetime.utcnow() - test_start).total_seconds() * 1000
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "data-collection",
            "version": "1.0.0",
            "checks": {
                "api_response": "ok",
                "schema_validation": "ok",
                "performance": f"{health_duration:.2f}ms"
            },
            "active_jobs": len([j for j in active_jobs.values() if j["status"] in ["pending", "running"]]),
            "cache_status": deduplication_service.get_statistics()
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

@router.post("/cache/reset")
async def reset_deduplication_cache() -> Dict[str, str]:
    """
    Reset deduplication cache (admin function)
    """
    try:
        deduplication_service.reset_cache()
        comprehensive_logger.log_performance(
            operation="cache_reset",
            duration_ms=0,
            additional_metrics={"admin_action": True}
        )
        return {"message": "Deduplication cache reset successfully"}
    except Exception as e:
        log_error("cache_reset", e)
        raise HTTPException(status_code=500, detail=f"Cache reset failed: {str(e)}")

# =====================================
# BACKGROUND JOB EXECUTION
# =====================================

async def _execute_collection_job(job_id: str, request: CollectionJobRequest) -> None:
    """
    Execute a collection job in the background
    """
    job_info = active_jobs[job_id]
    
    try:
        # Update job status
        job_info["status"] = "running"
        job_info["started_at"] = datetime.utcnow()
        job_info["progress"] = {"stage": "initializing", "completion": 0.1}
        
        # Create batch request
        batch_request = BatchCollectionRequest(
            collection_date=request.collection_date,
            target_commodities=request.target_commodities or collector._get_default_commodities(),
            target_regions=request.target_regions or collector._get_default_regions(),
            collection_method=request.provider,
            n_completions=request.n_completions,
            consensus_threshold=request.consensus_threshold,
            min_confidence=0.7,
            enable_hitl_sampling=True,
            hitl_sample_rate=0.08
        )
        
        # Update progress
        job_info["progress"] = {"stage": "collecting", "completion": 0.3}
        
        # Execute collection
        result = await collector.collect_daily_prices(
            target_date=request.collection_date,
            commodities=request.target_commodities,
            regions=request.target_regions,
            provider=request.provider
        )
        
        # Update progress
        job_info["progress"] = {"stage": "processing", "completion": 0.8}
        
        # Create result summary
        result_summary = {
            "batch_id": result.batch_id,
            "total_collected": result.total_collected,
            "total_valid": result.total_valid,
            "total_duplicates": result.total_duplicates,
            "success_rate": result.total_valid / max(result.total_collected, 1),
            "average_quality_score": result.average_quality_score,
            "average_confidence": result.average_confidence,
            "duration_seconds": result.duration_seconds,
            "partial_success": result.partial_success,
            "error_count": len(result.errors)
        }
        
        # Complete job
        job_info["status"] = "completed"
        job_info["completed_at"] = datetime.utcnow()
        job_info["progress"] = {"stage": "completed", "completion": 1.0}
        job_info["result_summary"] = result_summary
        
        # Log completion
        log_batch_processing(result, trace_id=job_id)
        
    except Exception as e:
        # Handle job failure
        job_info["status"] = "failed"
        job_info["completed_at"] = datetime.utcnow()
        job_info["error_message"] = str(e)
        job_info["progress"] = {"stage": "failed", "completion": 0.0}
        
        # Log error
        log_error("background_collection_job", e, context={"job_id": job_id}, trace_id=job_id)

# =====================================
# CLEANUP TASK
# =====================================

@router.post("/maintenance/cleanup")
async def cleanup_old_jobs() -> Dict[str, Any]:
    """
    Clean up old completed/failed jobs from memory
    """
    cleanup_before = datetime.utcnow() - timedelta(hours=24)
    cleaned_count = 0
    
    jobs_to_remove = []
    for job_id, job_info in active_jobs.items():
        if (job_info["status"] in ["completed", "failed", "cancelled"] and 
            job_info.get("completed_at") and 
            job_info["completed_at"] < cleanup_before):
            jobs_to_remove.append(job_id)
    
    for job_id in jobs_to_remove:
        del active_jobs[job_id]
        cleaned_count += 1
    
    comprehensive_logger.log_performance(
        operation="job_cleanup",
        duration_ms=0,
        additional_metrics={"cleaned_jobs": cleaned_count}
    )
    
    return {
        "cleaned_jobs": cleaned_count,
        "remaining_jobs": len(active_jobs),
        "cleanup_time": datetime.utcnow().isoformat()
    }

# Export router
__all__ = ["router"]