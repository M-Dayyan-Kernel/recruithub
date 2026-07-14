import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.models import User

logger = logging.getLogger(__name__)


async def seed_admin_user(db: AsyncSession) -> None:
    """Create the seeded admin if SEED_ADMIN_* env vars are set and no admin exists."""
    email = (settings.SEED_ADMIN_EMAIL or "").strip().lower()
    password = settings.SEED_ADMIN_PASSWORD or ""
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

    admin = User(
        email=email,
        full_name=(settings.SEED_ADMIN_NAME or "Admin").strip() or "Admin",
        hashed_password=hash_password(password),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    logger.info("Seeded admin user: %s", email)
