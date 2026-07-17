from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger, task_postrun, task_prerun
import logging

from app.core.settings import settings
from app.core.logging import clear_task_id, set_task_id, setup_logging

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


@after_setup_logger.connect
def _on_celery_setup_logger(**_kwargs):
    setup_logging(settings.LOG_LEVEL)


@after_setup_task_logger.connect
def _on_celery_setup_task_logger(**_kwargs):
    setup_logging(settings.LOG_LEVEL)


@task_prerun.connect
def _on_task_prerun(task_id=None, task=None, **_kwargs):
    set_task_id(task_id)
    name = getattr(task, "name", None) or "celery.task"
    logging.getLogger(name).debug("Task starting id=%s", task_id)


@task_postrun.connect
def _on_task_postrun(**_kwargs):
    clear_task_id()
