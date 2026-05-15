import asyncio
import uuid
import logging
from typing import Callable, Any, Dict
from enum import Enum

logger = logging.getLogger(__name__)

class JobStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class AsyncTaskQueue:
    """
    V1 Task Queue — uses asyncio.create_task with a bounded semaphore.
    Simple in-memory queue for the prototype.
    """
    def __init__(self, max_concurrent: int = 5):
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._jobs: Dict[str, Dict[str, Any]] = {}

    async def enqueue(self, job_func: Callable, *args, **kwargs) -> str:
        job_id = str(uuid.uuid4())
        self._jobs[job_id] = {
            "status": JobStatus.PENDING,
            "error": None,
            "result": None
        }

        # Fire and forget
        asyncio.create_task(self._run_job(job_id, job_func, *args, **kwargs))
        
        return job_id

    async def _run_job(self, job_id: str, job_func: Callable, *args, **kwargs):
        async with self._semaphore:
            self._jobs[job_id]["status"] = JobStatus.RUNNING
            try:
                result = await job_func(*args, **kwargs)
                self._jobs[job_id]["status"] = JobStatus.COMPLETED
                self._jobs[job_id]["result"] = result
            except Exception as e:
                logger.error(f"Job {job_id} failed: {str(e)}")
                self._jobs[job_id]["status"] = JobStatus.FAILED
                self._jobs[job_id]["error"] = str(e)

    def get_status(self, job_id: str) -> Dict[str, Any]:
        return self._jobs.get(job_id, {"status": "not_found"})

# Singleton instance
task_queue = AsyncTaskQueue()
