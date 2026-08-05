from contextlib import asynccontextmanager
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import health as health_routes
from app.exceptions import DomainError
from app.modules.api_keys.api_key_router import router as api_key_router
from app.modules.talentos_integration.talentos_integration_router import router as talentos_integration_router
from app.routers import (
    audit,
    auth,
    candidates,
    interviews,
    jobs,
    platform,
    screening,
    settings,
    shortlist,
    users,
)
from app.core.config_loader import config as app_settings
from app.core.database import AsyncSessionLocal
from app.core.logging import (
    clear_actor_context,
    clear_request_id,
    get_request_id,
    log_http_access,
    set_request_id,
    setup_logging,
)
from app.clients.mocks import active_mock_services
from app.services.user_seed_service import seed_admin_user, seed_superadmin_user

setup_logging(
    app_settings.logging.level,
    log_format=app_settings.logging.format,
    log_dir=app_settings.logging.dir,
    log_max_bytes=app_settings.logging.max_bytes,
    log_backup_count=app_settings.logging.backup_count,
    service_name="ai-recruitment-api",
    service_env=app_settings.APP_ENV,
    service_version="1.0.0",
)
logger = logging.getLogger(__name__)

if app_settings.SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=app_settings.SENTRY_DSN, environment=app_settings.APP_ENV)
        logger.info("Sentry error tracking enabled")
    except Exception:
        logger.exception("Failed to initialize Sentry")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Assign X-Request-ID and emit a nested JSON HTTP access record per request."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id")
        request_id = set_request_id(incoming)
        request.state.request_id = request_id
        started = time.perf_counter()
        client_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((time.perf_counter() - started) * 1000)
            log_http_access(
                method=request.method,
                path=request.url.path,
                status=500,
                duration_ms=duration_ms,
                client_ip=client_ip,
                user_agent=user_agent,
            )
            clear_request_id()
            clear_actor_context()
            raise

        duration_ms = int((time.perf_counter() - started) * 1000)
        response.headers["X-Request-ID"] = request_id
        content_length = response.headers.get("content-length")
        bytes_out = int(content_length) if content_length and content_length.isdigit() else None
        log_http_access(
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
            user_agent=user_agent,
            route=getattr(request.scope.get("route"), "path", None),
            bytes_out=bytes_out,
        )
        clear_request_id()
        clear_actor_context()
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with AsyncSessionLocal() as session:
        try:
            await seed_admin_user(session)
        except Exception:
            logger.exception("Failed to seed admin user")
        try:
            await seed_superadmin_user(session)
        except Exception:
            logger.exception("Failed to seed superadmin user")
    yield


app = FastAPI(title="AI Recruitment POC", version="1.0.0", lifespan=lifespan)

_mock_services = active_mock_services()
if _mock_services:
    logger.warning(
        "Mock mode is active — external services are being simulated: %s",
        ", ".join(_mock_services),
    )

app.add_middleware(RequestLoggingMiddleware)
if app_settings.trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=app_settings.trusted_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
    expose_headers=["X-Request-ID"],
)


@app.exception_handler(DomainError)
async def domain_exception_handler(request: Request, exc: DomainError):
    request_id = getattr(request.state, "request_id", None) or get_request_id()
    headers = {"X-Request-ID": request_id} if request_id != "-" else {}
    if exc.headers:
        headers.update(exc.headers)
    if getattr(exc, "skipped", None):
        content = {"detail": {"message": exc.public_message, "skipped": exc.skipped}}
    else:
        content = getattr(exc, "response_content", None) or {
            "detail": exc.public_message
        }
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=headers or None,
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", None) or get_request_id()
    if request_id == "-":
        request_id = str(uuid.uuid4())
    logger.exception("An unexpected error interrupted this request")
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


@app.get("/health", tags=["health"])
async def health():
    """Backward-compatible liveness alias."""
    return {"status": "ok", "version": "1.0.0"}


app.include_router(health_routes.router, tags=["health"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(platform.router, prefix="/api/platform", tags=["platform"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(audit.router, prefix="/api/audit-logs", tags=["audit"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(candidates.router, prefix="/api", tags=["candidates"])
app.include_router(shortlist.router, prefix="/api", tags=["shortlist"])
app.include_router(screening.router, prefix="/api", tags=["screening"])
app.include_router(interviews.router, prefix="/api", tags=["interviews"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(api_key_router, prefix="/api/app-keys", tags=["app-keys"])
app.include_router(talentos_integration_router)


@app.get("/metrics", include_in_schema=False)
async def metrics():
    from app.core.metrics import metrics_response

    return metrics_response()

