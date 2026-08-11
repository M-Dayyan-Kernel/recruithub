# Example log lines

One NDJSON object per line in real files; pretty-printed here for reading.

## events.log (API)

```json
{
  "ts": "2026-08-04T10:35:08.517+05:30",
  "level": "INFO",
  "msg": "Admin (Admin) uploaded one resume for job \"Generative AI Engineer\"",
  "request_id": "0b101c0b-b14f-4114-b4e9-26689ecf60ef",
  "service": "ai-recruitment-api",
  "fields": {
    "logger": "app.services.resume_upload_service",
    "env": "development",
    "version": "1.0.0",
    "tenant_id": "a4fc1f14-a841-45b0-8910-65a852f44e5c",
    "user_id": "2816c4c5-9f3d-4fbe-ab30-3ab1f2117ebc"
  }
}
```

## events.log (Celery worker — same request context)

```json
{
  "ts": "2026-08-04T10:35:14.393+05:30",
  "level": "INFO",
  "msg": "AI review completed for candidate e7849e1d-3d09-4040-9b80-aade3d37e3e8 (Rahul A Gowda)",
  "request_id": "0b101c0b-b14f-4114-b4e9-26689ecf60ef",
  "service": "ai-recruitment-worker",
  "fields": {
    "logger": "app.services.resume_processing_service",
    "env": "development",
    "version": "1.0.0",
    "tenant_id": "a4fc1f14-a841-45b0-8910-65a852f44e5c",
    "user_id": "2816c4c5-9f3d-4fbe-ab30-3ab1f2117ebc",
    "task_id": "f82a31e3-c5e6-465e-b969-da6d10f7a979"
  }
}
```

## http.log

```json
{
  "ts": "2026-08-04T10:35:08.600+05:30",
  "level": "INFO",
  "msg": "request completed",
  "request_id": "0b101c0b-b14f-4114-b4e9-26689ecf60ef",
  "service": "ai-recruitment-api",
  "fields": {
    "logger": "http.access",
    "env": "development",
    "version": "1.0.0",
    "http": {
      "method": "POST",
      "path": "/api/jobs/.../resumes",
      "status": 201,
      "duration_ms": 142
    },
    "client_ip": "127.0.0.1",
    "user_agent": "Mozilla/5.0",
    "tenant_id": "a4fc1f14-a841-45b0-8910-65a852f44e5c",
    "user_id": "2816c4c5-9f3d-4fbe-ab30-3ab1f2117ebc"
  }
}
```

## errors.log

```json
{
  "ts": "2026-08-04T10:40:01.100+05:30",
  "level": "ERROR",
  "msg": "Failed to enqueue screening",
  "request_id": "f0e1d2c3-aaaa-bbbb-cccc-ddddeeeeffff",
  "service": "ai-recruitment-api",
  "fields": {
    "logger": "app.services.screening_queue_service",
    "env": "development",
    "version": "1.0.0",
    "tenant_id": "a4fc1f14-a841-45b0-8910-65a852f44e5c",
    "user_id": "2816c4c5-9f3d-4fbe-ab30-3ab1f2117ebc",
    "error": {
      "type": "RedisError",
      "message": "Connection refused to Redis",
      "stack": "Traceback (most recent call last):\n  ..."
    }
  }
}
```
