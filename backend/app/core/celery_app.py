from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "ai_recruitment",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.tasks.resume_tasks",
        "app.tasks.shortlist_tasks",
        "app.tasks.screening_tasks",
        "app.tasks.interview_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    beat_schedule={
        "dispatch-pending-screening-calls": {
            "task": "tasks.dispatch_pending_screening_calls",
            "schedule": 60.0,  # every minute — dispatch queued calls when window opens
        },
        "recover-stuck-resume-parses": {
            "task": "tasks.recover_stuck_resume_parses",
            "schedule": 120.0,  # every 2 minutes — re-enqueue crashed mid-parse resumes
        },
    },
)
