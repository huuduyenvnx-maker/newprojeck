#!/usr/bin/env python3
"""
AgriIntel Data Collection Scheduler
Automated scheduling for daily agricultural data collection
"""

import asyncio
import schedule
import time
import threading
import aiohttp
import json
from typing import Dict, List, Optional, Any
from datetime import datetime, date, timedelta
from dataclasses import dataclass
from enum import Enum

from services.data_collector import LLMDataCollector
from services.logging_service import (
    comprehensive_logger, log_batch_processing, log_error, log_performance
)
from models.data_collection_schemas import SourceType, BatchCollectionResult

class ScheduleFrequency(str, Enum):
    DAILY = "daily"
    TWICE_DAILY = "twice_daily"
    HOURLY = "hourly"
    WEEKLY = "weekly"

@dataclass
class ScheduledJob:
    """Configuration for a scheduled collection job"""
    job_id: str
    name: str
    frequency: ScheduleFrequency
    time_slots: List[str]  # HH:MM format
    provider: SourceType
    commodities: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    enabled: bool = True
    retry_on_failure: bool = True
    max_retries: int = 3
    last_run: Optional[datetime] = None
    last_success: Optional[datetime] = None
    failure_count: int = 0

class DataCollectionScheduler:
    """
    Automated scheduler for agricultural data collection
    """
    
    def __init__(self):
        self.collector = LLMDataCollector()
        self.scheduled_jobs: Dict[str, ScheduledJob] = {}
        self.running = False
        self.scheduler_thread: Optional[threading.Thread] = None
        
        # Default job configurations
        self._setup_default_jobs()
        
        # Schedule all jobs
        self._schedule_all_jobs()
        
    def _setup_default_jobs(self) -> None:
        """Setup default scheduled collection jobs"""
        
        # Morning collection with Gemini (03:00 ICT)
        morning_job = ScheduledJob(
            job_id="daily_morning_gemini",
            name="Daily Morning Collection (Gemini)",
            frequency=ScheduleFrequency.DAILY,
            time_slots=["03:00"],  # 3 AM ICT
            provider=SourceType.LLM_GEMINI,
            commodities=None,  # Use defaults
            regions=None,  # Use defaults
            enabled=True,
            retry_on_failure=True,
            max_retries=3
        )
        
        # Evening collection with OpenAI (21:00 ICT)
        evening_job = ScheduledJob(
            job_id="daily_evening_openai",
            name="Daily Evening Collection (OpenAI)",
            frequency=ScheduleFrequency.DAILY,
            time_slots=["21:00"],  # 9 PM ICT
            provider=SourceType.LLM_OPENAI,
            commodities=None,  # Use defaults
            regions=None,  # Use defaults
            enabled=True,
            retry_on_failure=True,
            max_retries=2
        )
        
        # Hourly quick checks during market hours (09:00-17:00 ICT)
        hourly_job = ScheduledJob(
            job_id="hourly_market_check",
            name="Hourly Market Check",
            frequency=ScheduleFrequency.HOURLY,
            time_slots=[f"{hour:02d}:00" for hour in range(9, 18)],  # 9 AM to 5 PM
            provider=SourceType.LLM_GEMINI,
            commodities=["Gạo ST25", "Cà phê Robusta", "Tiêu đen"],  # Key commodities only
            regions=["Mekong Delta", "Ho Chi Minh City"],  # Key regions only
            enabled=False,  # Disabled by default
            retry_on_failure=False,
            max_retries=1
        )
        
        # Weekly comprehensive collection (Sunday 01:00)
        weekly_job = ScheduledJob(
            job_id="weekly_comprehensive",
            name="Weekly Comprehensive Collection",
            frequency=ScheduleFrequency.WEEKLY,
            time_slots=["01:00"],  # 1 AM on Sunday
            provider=SourceType.LLM_GEMINI,
            commodities=None,  # All commodities
            regions=None,  # All regions
            enabled=True,
            retry_on_failure=True,
            max_retries=5
        )
        
        # Add jobs to scheduler
        self.scheduled_jobs = {
            morning_job.job_id: morning_job,
            evening_job.job_id: evening_job,
            hourly_job.job_id: hourly_job,
            weekly_job.job_id: weekly_job
        }

    def _schedule_all_jobs(self) -> None:
        """Schedule all configured jobs"""
        for job in self.scheduled_jobs.values():
            if job.enabled:
                self._schedule_job(job)

    def _schedule_job(self, job: ScheduledJob) -> None:
        """Schedule a single job based on its configuration"""
        
        for time_slot in job.time_slots:
            if job.frequency == ScheduleFrequency.DAILY:
                schedule.every().day.at(time_slot).do(
                    self._execute_scheduled_job, job.job_id
                ).tag(job.job_id)
                
            elif job.frequency == ScheduleFrequency.TWICE_DAILY:
                schedule.every().day.at(time_slot).do(
                    self._execute_scheduled_job, job.job_id
                ).tag(job.job_id)
                
            elif job.frequency == ScheduleFrequency.HOURLY:
                # For hourly jobs, schedule at specific times
                schedule.every().day.at(time_slot).do(
                    self._execute_scheduled_job, job.job_id
                ).tag(job.job_id)
                
            elif job.frequency == ScheduleFrequency.WEEKLY:
                schedule.every().sunday.at(time_slot).do(
                    self._execute_scheduled_job, job.job_id
                ).tag(job.job_id)
        
        comprehensive_logger.log_performance(
            operation="job_scheduled",
            duration_ms=0,
            additional_metrics={
                "job_id": job.job_id,
                "frequency": job.frequency.value,
                "time_slots": job.time_slots,
                "provider": job.provider.value
            }
        )

    def _execute_scheduled_job(self, job_id: str) -> None:
        """Execute a scheduled job"""
        if job_id not in self.scheduled_jobs:
            comprehensive_logger.log_error(
                operation="scheduled_job_execution",
                error=Exception(f"Job {job_id} not found"),
                context={"job_id": job_id}
            )
            return
        
        job = self.scheduled_jobs[job_id]
        
        # Check if job is still enabled
        if not job.enabled:
            return
            
        # Update last run time
        job.last_run = datetime.utcnow()
        
        # Execute the collection
        asyncio.create_task(self._run_collection_job(job))

    async def _run_collection_job(self, job: ScheduledJob) -> None:
        """Run a collection job with retry logic"""
        start_time = datetime.utcnow()
        attempt = 0
        max_attempts = job.max_retries + 1 if job.retry_on_failure else 1
        
        while attempt < max_attempts:
            attempt += 1
            
            try:
                comprehensive_logger.log_performance(
                    operation="scheduled_job_start",
                    duration_ms=0,
                    additional_metrics={
                        "job_id": job.job_id,
                        "attempt": attempt,
                        "max_attempts": max_attempts
                    },
                    trace_id=job.job_id
                )
                
                # NEW: Call Node.js internet aggregation endpoint instead of local collector
                result = await self._trigger_nodejs_ingestion(job)
                
                # Check if collection was successful
                if result and result.get('success', False):
                    # Success
                    job.last_success = datetime.utcnow()
                    job.failure_count = 0
                    
                    # Log successful collection
                    comprehensive_logger.log_performance(
                        operation="nodejs_ingestion_success",
                        duration_ms=(datetime.utcnow() - start_time).total_seconds() * 1000,
                        additional_metrics={
                            "job_id": job.job_id,
                            "commodities_collected": result.get('data', {}).get('aggregation_result', {}).get('commodities_collected', 0),
                            "validation_score": result.get('data', {}).get('validation_score', 0),
                            "attempt": attempt,
                            "nodejs_response": True
                        },
                        trace_id=job.job_id
                    )
                    
                    return  # Success, exit retry loop
                    
                else:
                    # No valid results
                    error_msg = result.get('message', 'Unknown error') if result else 'No response from Node.js service'
                    raise Exception(f"Node.js ingestion failed: {error_msg}")
                    
            except Exception as e:
                # Handle failure
                job.failure_count += 1
                
                comprehensive_logger.log_retry_attempt(
                    operation=f"scheduled_job_{job.job_id}",
                    attempt=attempt,
                    max_attempts=max_attempts,
                    error=str(e),
                    backoff_delay=min(2 ** attempt, 300),  # Exponential backoff, max 5 minutes
                    trace_id=job.job_id
                )
                
                if attempt < max_attempts:
                    # Wait before retry (exponential backoff)
                    backoff_delay = min(2 ** attempt, 300)  # Max 5 minutes
                    await asyncio.sleep(backoff_delay)
                else:
                    # Final failure
                    comprehensive_logger.log_error(
                        operation="scheduled_job_final_failure",
                        error=e,
                        context={
                            "job_id": job.job_id,
                            "total_attempts": attempt,
                            "failure_count": job.failure_count
                        },
                        trace_id=job.job_id
                    )
                    
                    # Disable job if too many consecutive failures
                    if job.failure_count >= 10:
                        job.enabled = False
                        comprehensive_logger.log_error(
                            operation="scheduled_job_disabled",
                            error=Exception(f"Job {job.job_id} disabled due to excessive failures"),
                            context={"job_id": job.job_id, "failure_count": job.failure_count},
                            trace_id=job.job_id
                        )

    async def _trigger_nodejs_ingestion(self, job: ScheduledJob) -> Optional[Dict[str, Any]]:
        """Trigger Node.js internet aggregation service via HTTP"""
        
        # Default Vietnamese agricultural commodities
        default_commodities = [
            "Gạo trắng 5% tấm",
            "Cà phê Robusta FAQ", 
            "Cao su TSR20",
            "Tiêu đen FAQ",
            "Ngô vàng",
            "Đậu tương",
            "Lúa mì",
            "Đường thô 11",
            "Sầu riêng tươi",
            "Sắn lát"
        ]
        
        # Select appropriate commodities based on job configuration
        commodities = job.commodities if job.commodities else default_commodities
        
        # Determine provider based on job configuration
        provider_map = {
            SourceType.LLM_GEMINI: "gemini",
            SourceType.LLM_OPENAI: "openai"
        }
        provider = provider_map.get(job.provider, "gemini")
        
        # Prepare request payload
        payload = {
            "commodities": commodities,
            "region": "Vietnam",
            "force_refresh": True,
            "provider": provider,
            "job_id": job.job_id,
            "scheduled_time": datetime.utcnow().isoformat()
        }
        
        # Node.js service URL
        nodejs_url = "http://localhost:5000/internal/trigger-ingestion"
        
        try:
            comprehensive_logger.log_performance(
                operation="nodejs_http_request_start",
                duration_ms=0,
                additional_metrics={
                    "job_id": job.job_id,
                    "provider": provider,
                    "commodities_count": len(commodities),
                    "url": nodejs_url
                },
                trace_id=job.job_id
            )
            
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300)) as session:
                async with session.post(
                    nodejs_url,
                    json=payload,
                    headers={'Content-Type': 'application/json'}
                ) as response:
                    
                    response_text = await response.text()
                    
                    if response.status == 200:
                        result = json.loads(response_text)
                        
                        comprehensive_logger.log_performance(
                            operation="nodejs_http_request_success",
                            duration_ms=0,
                            additional_metrics={
                                "job_id": job.job_id,
                                "response_status": response.status,
                                "success": result.get('success', False),
                                "commodities_collected": result.get('data', {}).get('aggregation_result', {}).get('commodities_collected', 0)
                            },
                            trace_id=job.job_id
                        )
                        
                        return result
                    else:
                        comprehensive_logger.log_error(
                            operation="nodejs_http_request_failed",
                            error=Exception(f"HTTP {response.status}: {response_text}"),
                            context={
                                "job_id": job.job_id,
                                "status_code": response.status,
                                "response": response_text[:500]  # Truncate long responses
                            },
                            trace_id=job.job_id
                        )
                        
                        return {
                            "success": False,
                            "message": f"HTTP {response.status}: {response_text}",
                            "error": "HTTP_REQUEST_FAILED"
                        }
                        
        except asyncio.TimeoutError:
            comprehensive_logger.log_error(
                operation="nodejs_http_request_timeout",
                error=Exception("HTTP request to Node.js service timed out"),
                context={"job_id": job.job_id, "url": nodejs_url, "timeout": 300},
                trace_id=job.job_id
            )
            return {
                "success": False,
                "message": "HTTP request timed out",
                "error": "HTTP_TIMEOUT"
            }
            
        except Exception as e:
            comprehensive_logger.log_error(
                operation="nodejs_http_request_error",
                error=e,
                context={"job_id": job.job_id, "url": nodejs_url},
                trace_id=job.job_id
            )
            return {
                "success": False,
                "message": f"HTTP request failed: {str(e)}",
                "error": "HTTP_REQUEST_ERROR"
            }

    def start(self) -> None:
        """Start the scheduler"""
        if self.running:
            return
            
        self.running = True
        
        def run_scheduler():
            while self.running:
                schedule.run_pending()
                time.sleep(30)  # Check every 30 seconds
                
        self.scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
        self.scheduler_thread.start()
        
        comprehensive_logger.log_performance(
            operation="scheduler_started",
            duration_ms=0,
            additional_metrics={
                "total_jobs": len(self.scheduled_jobs),
                "enabled_jobs": sum(1 for job in self.scheduled_jobs.values() if job.enabled)
            }
        )

    def stop(self) -> None:
        """Stop the scheduler"""
        self.running = False
        
        comprehensive_logger.log_performance(
            operation="scheduler_stopped",
            duration_ms=0
        )

    def add_job(self, job: ScheduledJob) -> None:
        """Add a new scheduled job"""
        self.scheduled_jobs[job.job_id] = job
        
        if job.enabled:
            self._schedule_job(job)

    def remove_job(self, job_id: str) -> bool:
        """Remove a scheduled job"""
        if job_id not in self.scheduled_jobs:
            return False
            
        # Clear existing schedule
        schedule.clear(job_id)
        
        # Remove from jobs
        del self.scheduled_jobs[job_id]
        
        comprehensive_logger.log_performance(
            operation="job_removed",
            duration_ms=0,
            additional_metrics={"job_id": job_id}
        )
        
        return True

    def enable_job(self, job_id: str) -> bool:
        """Enable a scheduled job"""
        if job_id not in self.scheduled_jobs:
            return False
            
        job = self.scheduled_jobs[job_id]
        if not job.enabled:
            job.enabled = True
            self._schedule_job(job)
            
        return True

    def disable_job(self, job_id: str) -> bool:
        """Disable a scheduled job"""
        if job_id not in self.scheduled_jobs:
            return False
            
        job = self.scheduled_jobs[job_id]
        if job.enabled:
            job.enabled = False
            schedule.clear(job_id)
            
        return True

    def get_job_status(self) -> Dict[str, Any]:
        """Get status of all scheduled jobs"""
        status = {
            "scheduler_running": self.running,
            "total_jobs": len(self.scheduled_jobs),
            "enabled_jobs": sum(1 for job in self.scheduled_jobs.values() if job.enabled),
            "jobs": []
        }
        
        for job in self.scheduled_jobs.values():
            job_status = {
                "job_id": job.job_id,
                "name": job.name,
                "frequency": job.frequency.value,
                "provider": job.provider.value,
                "enabled": job.enabled,
                "last_run": job.last_run.isoformat() if job.last_run else None,
                "last_success": job.last_success.isoformat() if job.last_success else None,
                "failure_count": job.failure_count,
                "next_run": self._get_next_run_time(job)
            }
            status["jobs"].append(job_status)
            
        return status

    def _get_next_run_time(self, job: ScheduledJob) -> Optional[str]:
        """Get next scheduled run time for a job"""
        if not job.enabled:
            return None
            
        # This is a simplified version - in practice you'd calculate based on schedule
        try:
            jobs = schedule.get_jobs(job.job_id)
            if jobs:
                return jobs[0].next_run.isoformat()
        except:
            pass
            
        return None

    def force_run_job(self, job_id: str) -> bool:
        """Manually trigger a job execution"""
        if job_id not in self.scheduled_jobs:
            return False
            
        job = self.scheduled_jobs[job_id]
        asyncio.create_task(self._run_collection_job(job))
        
        comprehensive_logger.log_performance(
            operation="job_forced_run",
            duration_ms=0,
            additional_metrics={"job_id": job_id}
        )
        
        return True

# Global scheduler instance
data_collection_scheduler = DataCollectionScheduler()

# Convenience functions
def start_scheduler():
    """Start the global scheduler"""
    data_collection_scheduler.start()

def stop_scheduler():
    """Stop the global scheduler"""
    data_collection_scheduler.stop()

def get_scheduler_status():
    """Get scheduler status"""
    return data_collection_scheduler.get_job_status()

def force_run_job(job_id: str):
    """Force run a scheduled job"""
    return data_collection_scheduler.force_run_job(job_id)

if __name__ == "__main__":
    # Test scheduler
    scheduler = DataCollectionScheduler()
    
    print("Starting test scheduler...")
    scheduler.start()
    
    # Let it run for a bit
    time.sleep(5)
    
    print("Scheduler status:")
    status = scheduler.get_job_status()
    for job in status["jobs"]:
        print(f"- {job['name']}: enabled={job['enabled']}, last_run={job['last_run']}")
    
    print("Stopping scheduler...")
    scheduler.stop()
    print("Scheduler test completed")