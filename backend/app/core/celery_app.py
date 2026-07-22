from celery import Celery
from celery.signals import after_setup_logger, after_setup_task_logger, task_postrun, task_prerun
from kombu import Queue
import logging

from app.core.celery_queues import CELERY_QUEUE_NAMES, TASK_ROUTES
from app.core.config_loader import config
from app.core.logging import clear_task_id, set_task_id, setup_logging

celery_app = Celery(
    "ai_recruitment",
    broker=config.REDIS_URL,
    backend=config.REDIS_URL,
    include=[
        "app.tasks.resume_tasks",
        "app.tasks.shortlist_tasks",
        "app.tasks.screening_tasks",
        "app.tasks.interview_tasks",
        "app.tasks.retention_tasks",
    ],
)

_celery_cfg = config.celery

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_queues=tuple(Queue(name) for name in CELERY_QUEUE_NAMES),
    task_routes=TASK_ROUTES,
    task_acks_late=_celery_cfg.task_acks_late,
    task_reject_on_worker_lost=_celery_cfg.task_reject_on_worker_lost,
    task_track_started=_celery_cfg.task_track_started,
    worker_prefetch_multiplier=_celery_cfg.worker_prefetch_multiplier,
    worker_hijack_root_logger=False,
    beat_schedule={
        "dispatch-pending-screening-calls": {
            "task": "tasks.dispatch_pending_screening_calls",
            "schedule": config.scheduler.dispatch_pending_screening_seconds,
        },
        "recover-stuck-resume-processing": {
            "task": "tasks.recover_stuck_resume_processing",
            "schedule": config.scheduler.recover_stuck_parses_seconds,
        },
        "apply-data-retention": {
            "task": "tasks.apply_data_retention",
            "schedule": 86400.0,
        },
    },
)


@after_setup_logger.connect
def _on_celery_setup_logger(**_kwargs):
    setup_logging(config.LOG_LEVEL)


@after_setup_task_logger.connect
def _on_celery_setup_task_logger(**_kwargs):
    setup_logging(config.LOG_LEVEL)


@task_prerun.connect
def _on_task_prerun(task_id=None, task=None, **_kwargs):
    set_task_id(task_id)
    name = getattr(task, "name", None) or "celery.task"
    logging.getLogger(name).debug("Task starting id=%s", task_id)


@task_postrun.connect
def _on_task_postrun(**_kwargs):
    clear_task_id()
