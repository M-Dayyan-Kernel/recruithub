from celery import Celery
from celery.signals import (
    after_setup_logger,
    after_setup_task_logger,
    before_task_publish,
    task_postrun,
    task_prerun,
)
from kombu import Queue
import logging

from app.core.celery_queues import CELERY_QUEUE_NAMES, TASK_ROUTES
from app.core.config_loader import config
from app.core.logging import (
    REQUEST_ID_HEADER,
    TENANT_ID_HEADER,
    USER_ID_HEADER,
    apply_logging_context_headers,
    capture_logging_context_headers,
    clear_logging_context,
    set_task_id,
    setup_logging,
)

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


def _setup_celery_logging() -> None:
    setup_logging(
        config.logging.level,
        log_format=config.logging.format,
        log_dir=config.logging.dir,
        log_max_bytes=config.logging.max_bytes,
        log_backup_count=config.logging.backup_count,
        service_name="ai-recruitment-worker",
        service_env=config.APP_ENV,
        service_version="1.0.0",
    )


@after_setup_logger.connect
def _on_celery_setup_logger(**_kwargs):
    _setup_celery_logging()


@after_setup_task_logger.connect
def _on_celery_setup_task_logger(**_kwargs):
    _setup_celery_logging()


@before_task_publish.connect
def _inject_logging_context_headers(headers=None, **_kwargs):
    """Stamp current request/actor IDs onto every published Celery message."""
    if not isinstance(headers, dict):
        return
    for key, value in capture_logging_context_headers().items():
        headers.setdefault(key, value)


def _headers_from_task(task) -> dict:
    request = getattr(task, "request", None)
    if request is None:
        return {}
    headers: dict = {}
    raw = getattr(request, "headers", None) or {}
    if isinstance(raw, dict):
        headers.update(raw)
    for key in (REQUEST_ID_HEADER, USER_ID_HEADER, TENANT_ID_HEADER):
        if key in headers and headers[key] is not None:
            continue
        value = getattr(request, key, None)
        if value is not None:
            headers[key] = value
    return headers


@task_prerun.connect
def _on_task_prerun(task_id=None, task=None, **_kwargs):
    set_task_id(task_id)
    apply_logging_context_headers(_headers_from_task(task))
    name = getattr(task, "name", None) or "celery.task"
    logging.getLogger(name).debug("Task starting id=%s", task_id)


@task_postrun.connect
def _on_task_postrun(**_kwargs):
    clear_logging_context()
