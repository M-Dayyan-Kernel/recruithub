"""Boot-time admin and superadmin seeding."""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.security import hash_password
from app.models.models import User
from app.repositories.user_repository import UserRepository
from app.services.tenant_service import TenantService

logger = logging.getLogger(__name__)


class UserSeedService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        user_repo: UserRepository | None = None,
        tenant_service: TenantService | None = None,
    ) -> None:
        self._session = session
        self._users = user_repo or UserRepository(session)
        self._tenant_service = tenant_service or TenantService(session)

    async def seed_admin_user(self) -> None:
        email = (config.SEED_ADMIN_EMAIL or "").strip().lower()
        password = config.SEED_ADMIN_PASSWORD or ""
        if not email or not password:
            return

        if await self._users.has_admin():
            return

        existing = await self._users.get_by_email(email)
        if existing is not None:
            logger.warning("SEED_ADMIN_EMAIL already exists with a non-admin role; skipping seed")
            return

        tenant = await self._tenant_service.get_or_create_default_tenant()
        admin = User(
            tenant_id=tenant.id,
            email=email,
            full_name=(config.SEED_ADMIN_NAME or "Admin").strip() or "Admin",
            hashed_password=hash_password(password),
            role="admin",
            is_active=True,
        )
        self._users.add(admin)
        await self._session.commit()
        logger.info("Seeded admin user: %s (tenant=%s)", email, tenant.slug)

    async def seed_superadmin_user(self) -> None:
        email = (config.SEED_SUPERADMIN_EMAIL or "").strip().lower()
        password = config.SEED_SUPERADMIN_PASSWORD or ""
        if not email or not password:
            return

        if await self._users.has_superadmin():
            return

        existing = await self._users.get_by_email(email)
        if existing is not None:
            if existing.role != "superadmin":
                existing.role = "superadmin"
                platform = await self._tenant_service.ensure_platform_tenant()
                existing.tenant_id = platform.id
                await self._session.commit()
                logger.info("Promoted existing user to superadmin: %s", email)
            return

        platform = await self._tenant_service.ensure_platform_tenant()
        user = User(
            tenant_id=platform.id,
            email=email,
            full_name=(config.SEED_SUPERADMIN_NAME or "Super Admin").strip() or "Super Admin",
            hashed_password=hash_password(password),
            role="superadmin",
            is_active=True,
        )
        self._users.add(user)
        await self._session.commit()
        logger.info("Seeded superadmin user: %s", email)


async def seed_admin_user(db: AsyncSession) -> None:
    await UserSeedService(db).seed_admin_user()


async def seed_superadmin_user(db: AsyncSession) -> None:
    await UserSeedService(db).seed_superadmin_user()
