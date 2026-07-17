import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.security import hash_password
from app.models.models import User
from app.services.tenant_service import ensure_platform_tenant, get_or_create_default_tenant

logger = logging.getLogger(__name__)


async def seed_admin_user(db: AsyncSession) -> None:
    """Create the seeded tenant admin if SEED_ADMIN_* env vars are set and no admin exists."""
    email = (config.SEED_ADMIN_EMAIL or "").strip().lower()
    password = config.SEED_ADMIN_PASSWORD or ""
    if not email or not password:
        return

    existing = await db.execute(
        select(User).where(User.role == "admin").limit(1)
    )
    if existing.scalars().first() is not None:
        return

    by_email = await db.execute(select(User).where(User.email == email))
    if by_email.scalars().first() is not None:
        logger.warning("SEED_ADMIN_EMAIL already exists with a non-admin role; skipping seed")
        return

    tenant = await get_or_create_default_tenant(db)
    admin = User(
        tenant_id=tenant.id,
        email=email,
        full_name=(config.SEED_ADMIN_NAME or "Admin").strip() or "Admin",
        hashed_password=hash_password(password),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    logger.info("Seeded admin user: %s (tenant=%s)", email, tenant.slug)


async def seed_superadmin_user(db: AsyncSession) -> None:
    """Create platform superadmin if SEED_SUPERADMIN_* env vars are set."""
    email = (config.SEED_SUPERADMIN_EMAIL or "").strip().lower()
    password = config.SEED_SUPERADMIN_PASSWORD or ""
    if not email or not password:
        return

    existing = await db.execute(select(User).where(User.role == "superadmin").limit(1))
    if existing.scalars().first() is not None:
        return

    by_email = await db.execute(select(User).where(User.email == email))
    existing_user = by_email.scalars().first()
    if existing_user is not None:
        if existing_user.role != "superadmin":
            existing_user.role = "superadmin"
            platform = await ensure_platform_tenant(db)
            existing_user.tenant_id = platform.id
            await db.commit()
            logger.info("Promoted existing user to superadmin: %s", email)
        return

    platform = await ensure_platform_tenant(db)
    user = User(
        tenant_id=platform.id,
        email=email,
        full_name=(config.SEED_SUPERADMIN_NAME or "Super Admin").strip() or "Super Admin",
        hashed_password=hash_password(password),
        role="superadmin",
        is_active=True,
    )
    db.add(user)
    await db.commit()
    logger.info("Seeded superadmin user: %s", email)
