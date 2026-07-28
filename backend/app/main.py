from contextlib import asynccontextmanager
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import (
    candidates,
    health as health_routes,
    shortlist,
    screening,
    interviews,
)
from app.exceptions import DomainError
from app.routers import audit, auth, jobs, platform, settings, users
from app.core.config_loader import config as app_settings
from app.core.database import AsyncSessionLocal
from app.core.logging import (
    clear_actor_context,
    clear_request_id,
    get_request_id,
    is_poll_path,
    set_request_id,
    setup_logging,
)
from app.services.mock_external import active_mock_services
from app.services.user_seed_service import seed_admin_user, seed_superadmin_user

setup_logging(app_settings.LOG_LEVEL, log_format=app_settings.LOG_FORMAT)
logger = logging.getLogger(__name__)

if app_settings.SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=app_settings.SENTRY_DSN, environment=app_settings.APP_ENV)
        logger.info("Sentry error tracking enabled")
    except Exception:
        logger.exception("Failed to initialize Sentry")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Assign X-Request-ID. Successful reads stay quiet; failures are worded plainly."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id")
        request_id = set_request_id(incoming)
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:
            clear_request_id()
            clear_actor_context()
            raise
        response.headers["X-Request-ID"] = request_id
        path = request.url.path
        method = request.method

        # Successful traffic is covered by business-event sentences; keep access quiet.
        if response.status_code < 400:
            if method == "GET" or path == "/health" or is_poll_path(path):
                logger.debug("Request completed successfully")
            else:
                logger.debug("Request completed successfully")
        elif response.status_code >= 500:
            logger.error("A server error occurred while handling this request")
        elif response.status_code == 401:
            logger.warning("Someone tried to access a protected resource without signing in")
        elif response.status_code == 403:
            logger.warning("Someone was denied access to a protected resource")
        elif response.status_code == 404:
            logger.warning("Someone asked for something that was not found")
        elif response.status_code == 409:
            logger.warning("Someone tried an action that conflicts with current state")
        elif response.status_code == 422:
            logger.warning("Someone submitted a request that could not be processed")
        elif response.status_code == 503:
            logger.warning("A required service was temporarily unavailable")
        else:
            logger.warning("Someone's request was rejected")

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
    content = getattr(exc, "response_content", None) or {"detail": exc.public_message}
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


@app.get("/metrics", include_in_schema=False)
async def metrics():
    from app.core.metrics import metrics_response

    return metrics_response()
