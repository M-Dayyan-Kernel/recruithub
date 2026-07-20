"""Named Celery queues and central task routing."""

from __future__ import annotations

RESUME_QUEUE = "resume"
SHORTLIST_QUEUE = "shortlist"
SCREENING_QUEUE = "screening"
INTERVIEWS_QUEUE = "interviews"

CELERY_QUEUE_NAMES: tuple[str, ...] = (
    RESUME_QUEUE,
    SHORTLIST_QUEUE,
    SCREENING_QUEUE,
    INTERVIEWS_QUEUE,
)

# Dev / all-in-one worker listens to every queue.
ALL_QUEUES_CSV = ",".join(CELERY_QUEUE_NAMES)

TASK_ROUTES: dict[str, dict[str, str]] = {
    "tasks.process_resume_shortlist": {"queue": RESUME_QUEUE},
    "tasks.recover_stuck_resume_processing": {"queue": RESUME_QUEUE},
    "tasks.run_shortlist": {"queue": SHORTLIST_QUEUE},
    "tasks.initiate_screening_call": {"queue": SCREENING_QUEUE},
    "tasks.sync_screening_call_status": {"queue": SCREENING_QUEUE},
    "tasks.enrich_screening_transcript": {"queue": SCREENING_QUEUE},
    "tasks.send_failed_screening_email_deferred": {"queue": SCREENING_QUEUE},
    "tasks.process_screening_webhook": {"queue": SCREENING_QUEUE},
    "tasks.dispatch_pending_screening_calls": {"queue": SCREENING_QUEUE},
    "tasks.schedule_interview_assessment": {"queue": INTERVIEWS_QUEUE},
    "tasks.generate_interview_report": {"queue": INTERVIEWS_QUEUE},
    "tasks.dispatch_scheduled_interview_emails": {"queue": INTERVIEWS_QUEUE},
}

ROUTED_TASK_NAMES: frozenset[str] = frozenset(TASK_ROUTES)
