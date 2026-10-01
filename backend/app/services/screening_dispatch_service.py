"""
Shared helpers for enqueueing screening call Celery tasks with call-window awareness.
"""

from __future__ import annotations

import logging
import uuid

from app.models.models import Job
from app.services.call_window_service import effective_dispatch_delay

logger = logging.getLogger(__name__)


def enqueue_screening_call(screening_call_id: uuid.UUID, job: Job, *, force: bool = False) -> bool:
    """
    Enqueue initiate_screening_call for a ScreeningCall record.

    Returns True if the call will dial immediately (or after min delay),
    False if queued for a future window.
    """
    from app.tasks.screening_tasks import initiate_screening_call

    countdown, immediate = effective_dispatch_delay(job, force=force)
    initiate_screening_call.apply_async(args=[str(screening_call_id)], countdown=countdown)
    logger.info(
        "Enqueued screening_call=%s job=%s countdown=%ss immediate=%s",
        screening_call_id,
        job.id,
        countdown,
        immediate,
    )
    return immediate
