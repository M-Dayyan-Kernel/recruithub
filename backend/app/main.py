from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import (
    auth,
    audit,
    jobs,
    candidates,
    shortlist,
    screening,
    interviews,
    settings,
    users,
)
from app.core.database import AsyncSessionLocal
from app.services.mock_external import active_mock_services
from app.services.user_seed_service import seed_admin_user
from app.services.tenant_integrations_service import seed_default_tenant_integrations_from_env

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with AsyncSessionLocal() as session:
        try:
            await seed_admin_user(session)
        except Exception:
            logger.exception("Failed to seed admin user")
        try:
            await seed_default_tenant_integrations_from_env(session)
        except Exception:
            logger.exception("Failed to seed default tenant integrations")
    yield


app = FastAPI(title="AI Recruitment POC", version="1.0.0", lifespan=lifespan)

_mock_services = active_mock_services()
if _mock_services:
    logger.warning(
        "MOCK MODE ACTIVE — external APIs mocked: %s",
        ", ".join(_mock_services),
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": type(exc).__name__, "detail": str(exc)},
    )


@app.get("/health", tags=["health"])
async def health():
    mocks = active_mock_services()
    return {
        "status": "ok",
        "version": "1.0.0",
        "mock_mode": bool(mocks),
        "mocked_services": mocks,
    }


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(audit.router, prefix="/api/audit-logs", tags=["audit"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(candidates.router, prefix="/api", tags=["candidates"])
app.include_router(shortlist.router, prefix="/api", tags=["shortlist"])
app.include_router(screening.router, prefix="/api", tags=["screening"])
app.include_router(interviews.router, prefix="/api", tags=["interviews"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
