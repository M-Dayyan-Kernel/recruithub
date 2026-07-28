"""Redis-backed shortlist batch progress and concurrency lock."""

from __future__ import annotations

import json
import logging
import uuid

import redis as redis_lib

from app.core.config_loader import config

logger = logging.getLogger(__name__)


class ShortlistBatchStore:
    def __init__(self, *, ttl_seconds: int | None = None) -> None:
        self._ttl = ttl_seconds or config.concurrency.shortlist_batch_ttl_seconds

    def _client(self):
        return redis_lib.from_url(config.REDIS_URL or "redis://localhost:6379/0")

    @staticmethod
    def _lock_key(job_id: uuid.UUID | str) -> str:
        return f"shortlist_lock:{job_id}"

    @staticmethod
    def _batch_key(job_id: uuid.UUID | str) -> str:
        return f"shortlist_batch:{job_id}"

    @staticmethod
    def _failed_key(job_id: uuid.UUID | str) -> str:
        return f"shortlist_failed:{job_id}"

    def acquire_lock(self, job_id: uuid.UUID) -> bool:
        return bool(
            self._client().set(self._lock_key(job_id), "1", nx=True, ex=300)
        )

    def release_lock(self, job_id: uuid.UUID | str) -> None:
        self._client().delete(self._lock_key(job_id))

    def prepare_batch(self, job_id: uuid.UUID, id_strings: list[str]) -> None:
        client = self._client()
        client.set(self._batch_key(job_id), json.dumps(id_strings), ex=self._ttl)
        client.set(self._failed_key(job_id), "0", ex=self._ttl)

    def clear_keys(self, job_id: uuid.UUID) -> None:
        self._client().delete(
            self._lock_key(job_id),
            self._batch_key(job_id),
            self._failed_key(job_id),
        )

    def read_status(
        self, job_id: uuid.UUID
    ) -> tuple[bool, list[str], int]:
        client = self._client()
        in_progress = bool(client.exists(self._lock_key(job_id)))

        candidate_ids: list[str] = []
        batch_raw = client.get(self._batch_key(job_id))
        if batch_raw:
            if isinstance(batch_raw, bytes):
                batch_raw = batch_raw.decode("utf-8")
            try:
                parsed = json.loads(batch_raw)
                if isinstance(parsed, list):
                    candidate_ids = [str(cid) for cid in parsed]
            except (json.JSONDecodeError, TypeError, ValueError):
                candidate_ids = []

        failed = 0
        failed_raw = client.get(self._failed_key(job_id))
        if failed_raw is not None:
            if isinstance(failed_raw, bytes):
                failed_raw = failed_raw.decode("utf-8")
            try:
                failed = int(failed_raw)
            except (TypeError, ValueError):
                failed = 0

        return in_progress, candidate_ids, failed

    def store_failed_count(self, job_id: str, failed_count: int) -> None:
        try:
            self._client().set(
                self._failed_key(job_id), str(failed_count), ex=self._ttl
            )
        except Exception as exc:
            logger.warning(
                "run_shortlist: failed to store failed count for job %s: %s",
                job_id,
                exc,
            )

    def load_batch_ids(
        self, job_id: str, fallback_ids: list[str] | None
    ) -> list[uuid.UUID]:
        if fallback_ids:
            return [uuid.UUID(cid) for cid in fallback_ids]
        try:
            batch_raw = self._client().get(self._batch_key(job_id))
            if batch_raw:
                if isinstance(batch_raw, bytes):
                    batch_raw = batch_raw.decode("utf-8")
                return [uuid.UUID(cid) for cid in json.loads(batch_raw)]
        except Exception as exc:
            logger.warning(
                "run_shortlist: failed to read batch from Redis for job %s: %s",
                job_id,
                exc,
            )
        return []
