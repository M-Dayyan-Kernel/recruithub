"""Tests for nested JSON logging channels and HTTP access / request IDs."""

from __future__ import annotations

import json
import logging
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.logging import (
    HTTP_LOGGER_NAME,
    EventsChannelFilter,
    ErrorsChannelFilter,
    HttpChannelFilter,
    NestedJsonFormatter,
    clear_request_id,
    log_http_access,
    reset_logging_configuration,
    set_actor_context,
    set_request_id,
    setup_logging,
)
from app.main import app


def _make_record(
    name: str,
    level: int,
    msg: str = "test",
    *,
    exc_info=None,
    http=None,
    event=None,
) -> logging.LogRecord:
    record = logging.LogRecord(
        name=name,
        level=level,
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=(),
        exc_info=exc_info,
    )
    if http is not None:
        record.http = http  # type: ignore[attr-defined]
    if event is not None:
        record.event = event  # type: ignore[attr-defined]
    record.request_id = "rid-1"  # type: ignore[attr-defined]
    record.task_id = "-"  # type: ignore[attr-defined]
    record.user_id = "u_1"  # type: ignore[attr-defined]
    record.tenant_id = "t_1"  # type: ignore[attr-defined]
    return record


class NestedJsonFormatterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.formatter = NestedJsonFormatter(
            service_name="ai-recruitment-api",
            service_env="test",
            service_version="1.0.0",
        )

    def test_envelope_is_simple_with_fields(self) -> None:
        record = _make_record("app.services.demo", logging.INFO, "job created")
        payload = json.loads(self.formatter.format(record))
        self.assertEqual(payload["msg"], "job created")
        self.assertEqual(payload["service"], "ai-recruitment-api")
        self.assertEqual(payload["request_id"], "rid-1")
        self.assertEqual(
            set(payload.keys()),
            {"ts", "level", "msg", "request_id", "service", "fields"},
        )
        self.assertEqual(payload["fields"]["logger"], "app.services.demo")
        self.assertEqual(payload["fields"]["env"], "test")
        self.assertEqual(payload["fields"]["version"], "1.0.0")
        self.assertEqual(payload["fields"]["user_id"], "u_1")
        self.assertEqual(payload["fields"]["tenant_id"], "t_1")
        self.assertNotIn("task_id", payload["fields"])
        self.assertIn("ts", payload)
        self.assertTrue(payload["ts"].endswith("+05:30"))

    def test_http_nest_under_fields(self) -> None:
        record = _make_record(
            HTTP_LOGGER_NAME,
            logging.INFO,
            "request completed",
            http={
                "method": "GET",
                "path": "/health",
                "status": 200,
                "duration_ms": 3,
                "client_ip": "127.0.0.1",
                "user_agent": "pytest",
                "bytes": {"in": None, "out": 33},
            },
        )
        payload = json.loads(self.formatter.format(record))
        self.assertEqual(payload["fields"]["http"]["method"], "GET")
        self.assertEqual(payload["fields"]["http"]["status"], 200)
        self.assertEqual(payload["fields"]["http"]["duration_ms"], 3)
        self.assertEqual(payload["fields"]["client_ip"], "127.0.0.1")
        self.assertEqual(payload["fields"]["user_agent"], "pytest")
        self.assertEqual(payload["fields"]["bytes_out"], 33)
        self.assertNotIn("bytes_in", payload["fields"])
        self.assertNotIn("http", payload)

    def test_event_nest_under_fields(self) -> None:
        record = _make_record(
            "app.services.job_service",
            logging.INFO,
            "job created",
            event={"name": "job.created", "outcome": "success"},
        )
        payload = json.loads(self.formatter.format(record))
        self.assertEqual(payload["fields"]["event"]["name"], "job.created")
        self.assertNotIn("event", payload)

    def test_exception_nest_under_fields(self) -> None:
        try:
            raise RuntimeError("boom")
        except RuntimeError:
            import sys

            exc_info = sys.exc_info()
        record = _make_record(
            "app.main",
            logging.ERROR,
            "unhandled exception",
            exc_info=exc_info,
        )
        payload = json.loads(self.formatter.format(record))
        error = payload["fields"]["error"]
        self.assertEqual(error["type"], "RuntimeError")
        self.assertIn("boom", error["message"])
        self.assertIn("Traceback", error["stack"])
        self.assertNotIn("error", payload)


class ChannelFilterTests(unittest.TestCase):
    def test_http_filter(self) -> None:
        filt = HttpChannelFilter()
        self.assertTrue(filt.filter(_make_record(HTTP_LOGGER_NAME, logging.INFO)))
        self.assertFalse(filt.filter(_make_record("app.services.x", logging.INFO)))

    def test_events_filter_info_only_excludes_http(self) -> None:
        filt = EventsChannelFilter()
        self.assertTrue(filt.filter(_make_record("app.services.x", logging.INFO)))
        self.assertFalse(filt.filter(_make_record("app.services.x", logging.WARNING)))
        self.assertFalse(filt.filter(_make_record("app.services.x", logging.ERROR)))
        self.assertFalse(filt.filter(_make_record(HTTP_LOGGER_NAME, logging.INFO)))

    def test_errors_filter_warning_plus_excludes_http(self) -> None:
        filt = ErrorsChannelFilter()
        self.assertFalse(filt.filter(_make_record("app.services.x", logging.INFO)))
        self.assertTrue(filt.filter(_make_record("app.services.x", logging.WARNING)))
        self.assertTrue(filt.filter(_make_record("app.services.x", logging.ERROR)))
        self.assertFalse(filt.filter(_make_record(HTTP_LOGGER_NAME, logging.ERROR)))


class SetupLoggingChannelTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.log_dir = Path(self._tmp.name)
        reset_logging_configuration()
        setup_logging(
            "INFO",
            log_format="json",
            log_dir=str(self.log_dir),
            force=True,
            service_name="ai-recruitment-api",
            service_env="test",
            service_version="1.0.0",
        )

    def tearDown(self) -> None:
        from app.core.config_loader import config as app_settings

        reset_logging_configuration()
        setup_logging(
            app_settings.logging.level,
            log_format=app_settings.logging.format,
            log_dir=app_settings.logging.dir,
            log_max_bytes=app_settings.logging.max_bytes,
            log_backup_count=app_settings.logging.backup_count,
            service_name="ai-recruitment-api",
            service_env=app_settings.APP_ENV,
            service_version="1.0.0",
            force=True,
        )
        self._tmp.cleanup()

    def _flush(self) -> None:
        for handler in logging.getLogger().handlers:
            handler.flush()
        for handler in logging.getLogger(HTTP_LOGGER_NAME).handlers:
            handler.flush()

    def _read_json_lines(self, name: str) -> list[dict]:
        path = self.log_dir / name
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8").strip().splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    def test_info_goes_to_events_not_errors(self) -> None:
        set_request_id("req-events")
        set_actor_context(user_id="u_9", tenant_id="t_9", role="admin", name="Ada")
        logging.getLogger("app.services.demo").info("business happened")
        self._flush()
        events = self._read_json_lines("events.log")
        errors = self._read_json_lines("errors.log")
        http_lines = self._read_json_lines("http.log")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["msg"], "business happened")
        self.assertEqual(events[0]["request_id"], "req-events")
        self.assertEqual(events[0]["fields"]["user_id"], "u_9")
        self.assertEqual(events[0]["service"], "ai-recruitment-api")
        self.assertTrue(events[0]["ts"].endswith("+05:30"))
        self.assertEqual(len(errors), 0)
        self.assertEqual(len(http_lines), 0)
        clear_request_id()

    def test_error_goes_to_errors_not_events(self) -> None:
        logging.getLogger("app.services.demo").error("something broke")
        self._flush()
        events = self._read_json_lines("events.log")
        errors = self._read_json_lines("errors.log")
        self.assertEqual(len(events), 0)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["msg"], "something broke")
        self.assertEqual(errors[0]["level"], "ERROR")

    def test_http_access_goes_only_to_http(self) -> None:
        set_request_id("req-http")
        log_http_access(
            method="POST",
            path="/api/jobs",
            status=201,
            duration_ms=42,
            client_ip="127.0.0.1",
            user_agent="pytest",
        )
        self._flush()
        http_lines = self._read_json_lines("http.log")
        events = self._read_json_lines("events.log")
        errors = self._read_json_lines("errors.log")
        self.assertEqual(len(http_lines), 1)
        self.assertEqual(http_lines[0]["fields"]["http"]["method"], "POST")
        self.assertEqual(http_lines[0]["fields"]["http"]["status"], 201)
        self.assertEqual(http_lines[0]["fields"]["http"]["duration_ms"], 42)
        self.assertEqual(http_lines[0]["fields"]["client_ip"], "127.0.0.1")
        self.assertEqual(http_lines[0]["request_id"], "req-http")
        self.assertEqual(len(events), 0)
        self.assertEqual(len(errors), 0)
        clear_request_id()


class MiddlewareRequestIdTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_response_includes_request_id(self) -> None:
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("X-Request-ID", resp.headers)
        self.assertTrue(resp.headers["X-Request-ID"].strip())

    def test_honors_incoming_request_id(self) -> None:
        rid = "client-provided-request-id"
        resp = self.client.get("/health", headers={"X-Request-ID": rid})
        self.assertEqual(resp.headers["X-Request-ID"], rid)

    def test_http_access_logger_receives_structured_fields(self) -> None:
        captured: list[logging.LogRecord] = []

        class Capture(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured.append(record)

        handler = Capture()
        http_logger = logging.getLogger(HTTP_LOGGER_NAME)
        http_logger.addHandler(handler)
        try:
            resp = self.client.get("/health")
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(captured)
            record = captured[-1]
            self.assertEqual(record.name, HTTP_LOGGER_NAME)
            http_payload = getattr(record, "http", None)
            self.assertIsInstance(http_payload, dict)
            self.assertEqual(http_payload["method"], "GET")
            self.assertEqual(http_payload["path"], "/health")
            self.assertEqual(http_payload["status"], 200)
            self.assertIn("duration_ms", http_payload)
        finally:
            http_logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
