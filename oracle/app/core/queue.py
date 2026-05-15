"""
Async task queue — interface + in-process asyncio implementation.

The interface is designed so a real queue (Celery, BullMQ, Redis)
can be swapped in without changing the pipeline logic.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Awaitable, Dict


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    id: str
    job_type: str
    payload: dict
    status: JobStatus = JobStatus.PENDING
    result: Any = None
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class AsyncTaskQueue:
    """
    In-process async task queue (v1).
    Uses asyncio.create_task with a bounded semaphore to limit concurrency.
    Drop-in replacement for Celery/Redis in v2.
    """

    def __init__(self, max_concurrency: int = 4):
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._jobs: Dict[str, Job] = {}
        self._handlers: Dict[str, Callable[[dict], Awaitable[Any]]] = {}

    def register_handler(
        self,
        job_type: str,
        handler: Callable[[dict], Awaitable[Any]],
    ) -> None:
        """Register a coroutine handler for a job type."""
        self._handlers[job_type] = handler

    async def enqueue(self, job_type: str, payload: dict) -> str:
        """Enqueue a job and return the job ID."""
        if job_type not in self._handlers:
            raise ValueError(f"No handler registered for job type: {job_type}")

        job = Job(
            id=str(uuid.uuid4()),
            job_type=job_type,
            payload=payload,
        )
        self._jobs[job.id] = job

        # Fire and forget — bounded by semaphore
        asyncio.create_task(self._run(job))
        return job.id

    async def _run(self, job: Job) -> None:
        async with self._semaphore:
            job.status = JobStatus.RUNNING
            try:
                handler = self._handlers[job.job_type]
                job.result = await handler(job.payload)
                job.status = JobStatus.COMPLETED
            except Exception as exc:
                job.status = JobStatus.FAILED
                job.error = str(exc)

    def get_status(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)
