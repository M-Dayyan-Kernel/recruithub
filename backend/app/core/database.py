from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

from app.core.config_loader import config

# ── FastAPI engine (persistent pool — fine for async web server) ──────────────
engine = create_async_engine(
    config.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# ── Celery task session factory (NullPool — no cross-loop reuse) ──────────────
# Each Celery task calls asyncio.run() which creates+closes a new event loop.
# Using NullPool ensures no connections are shared across event loop boundaries.
@asynccontextmanager
async def get_celery_db():
    """Async DB session for use inside Celery tasks (NullPool, no connection reuse)."""
    task_engine = create_async_engine(
        config.DATABASE_URL,
        echo=False,
        poolclass=NullPool,
    )
    session_factory = async_sessionmaker(
        bind=task_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    async with session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
    await task_engine.dispose()
