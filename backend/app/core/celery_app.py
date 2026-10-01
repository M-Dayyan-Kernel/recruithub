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
)
