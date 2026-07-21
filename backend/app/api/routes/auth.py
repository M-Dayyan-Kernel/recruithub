from pathlib import Path
from uuid import uuid4
import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config_loader import config
from app.core.database import get_db
from app.core.deps import PLATFORM_TENANT_SLUG, RequireSuperAdmin, get_current_user
from app.core.rate_limit import (
    check_login_lockout,
    clear_login_failures,
    enforce_rate_limit,
    record_login_failure,
)
from app.core.security import create_access_token, verify_password
from app.schemas.schemas import validate_password_strength
from app.models.models import Tenant, User
from app.schemas.schemas import (
    AcceptInviteRequest,
    InvitePublicResponse,
    LoginRequest,
    MfaSetupResponse,
    MfaVerifyRequest,
    RefreshTokenRequest,
    SignupPendingResponse,
    SwitchTenantRequest,
    TokenResponse,
    UserResponse,
)
from app.services.tenant_service import create_tenant_with_admin, get_valid_invite
from app.services.refresh_token_service import issue_refresh_token, revoke_refresh_token, rotate_refresh_token
from app.services.mfa_service import generate_mfa_secret, provisioning_uri, verify_mfa_code

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_GST_DOC_SIZE = config.uploads.org_doc_max_bytes
_EMAIL_ADAPTER = TypeAdapter(EmailStr)


def _parse_email_or_400(raw: str) -> str:
    """Normalize and validate email before any signup side effects."""
    try:
        return str(_EMAIL_ADAPTER.validate_python((raw or "").strip().lower()))
    except ValidationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a valid email address (for example, you@company.com)",
        ) from None


def _user_response(user: User, tenant_name: str | None = None) -> UserResponse:
    data = UserResponse.model_validate(user)
    data.tenant_name = tenant_name or getattr(user, "active_tenant_name", None) or (
        user.tenant.name if getattr(user, "tenant", None) else None
    )
    data.home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
    data.active_tenant_id = getattr(user, "active_tenant_id", None) or user.tenant_id
    data.active_tenant_name = getattr(user, "active_tenant_name", None) or data.tenant_name
    return data


def _issue_token(
    user: User,
    *,
    tenant_name: str | None = None,
    active_tenant_id: str | None = None,
    active_tenant_name: str | None = None,
    refresh_token: str | None = None,
) -> TokenResponse:
    home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
    claims = {
        "role": user.role,
        "email": user.email,
        "tenant_id": str(home_tenant_id),
    }
    if active_tenant_id and user.role == "superadmin":
        claims["active_tenant_id"] = active_tenant_id

    if active_tenant_id and user.role == "superadmin":
        from uuid import UUID

        user.tenant_id = UUID(active_tenant_id)
        user.active_tenant_id = UUID(active_tenant_id)  # type: ignore[attr-defined]
        user.active_tenant_name = active_tenant_name  # type: ignore[attr-defined]
        user.home_tenant_id = home_tenant_id  # type: ignore[attr-defined]

    token = create_access_token(subject=str(user.id), extra_claims=claims)
    return TokenResponse(
        access_token=token,
        refresh_token=refresh_token,
        user=_user_response(user, tenant_name=active_tenant_name or tenant_name),
    )


def _assert_tenant_can_access(tenant: Tenant | None) -> None:
    if tenant is None:
        return
    status_value = getattr(tenant, "verification_status", "approved") or "approved"
    if status_value == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Organization is pending platform approval. "
                "You will get access once approved."
            ),
        )
    if status_value == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization registration was rejected. Contact support if you need help.",
        )
    if not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization is inactive",
        )


async def _read_and_validate_gst_pdf(upload: UploadFile) -> tuple[bytes, str]:
    filename = (upload.filename or "gst.pdf").strip()
    suffix = Path(filename).suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GST document must be a PDF file",
        )

    data = await upload.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GST document is empty",
        )
    if len(data) > MAX_GST_DOC_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"GST document must be under {MAX_GST_DOC_SIZE // (1024 * 1024)} MB",
        )
    if not data.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GST document must be a valid PDF",
        )
    return data, filename[:255]


def _persist_gst_document(tenant_id, data: bytes) -> str:
    from app.services.s3_service import gst_object_key, s3_configured, upload_bytes

    filename = f"gst-{uuid4().hex}.pdf"
    if s3_configured():
        try:
            return upload_bytes(
                gst_object_key(tenant_id, filename),
                data,
                content_type="application/pdf",
            )
        except Exception as exc:
            logger.error("Failed to upload GST document for tenant %s: %s", tenant_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not store the uploaded document in object storage.",
            ) from exc

    dest_dir = Path(config.ORG_DOCS_DIR) / str(tenant_id)
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / filename
        dest_path.write_bytes(data)
    except OSError as exc:
        logger.error("Failed to persist GST document for tenant %s: %s", tenant_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not store the uploaded document. Check server file permissions.",
        ) from exc
    return str(dest_path)


@router.post(
    "/signup",
    response_model=SignupPendingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def signup(
    request: Request,
    organization_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    full_name: str = Form(...),
    company_registration_number: str | None = Form(None),
    gst_document: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    enforce_rate_limit(
        request,
        scope="auth:signup",
        limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
    )
    org = organization_name.strip()
    if not org:
        raise HTTPException(status_code=400, detail="Organization name is required")
    full = full_name.strip()
    if not full:
        raise HTTPException(status_code=400, detail="Full name is required")
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    email_norm = _parse_email_or_400(email)
    existing = await db.execute(select(User).where(User.email == email_norm))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    pdf_bytes, original_name = await _read_and_validate_gst_pdf(gst_document)

    tenant, admin = await create_tenant_with_admin(
        db,
        organization_name=org,
        email=email_norm,
        password=password,
        full_name=full,
        verification_status="pending",
        is_active=False,
        company_registration_number=company_registration_number,
    )
    tenant.gst_document_path = _persist_gst_document(tenant.id, pdf_bytes)
    tenant.gst_document_filename = original_name
    await db.commit()

    return SignupPendingResponse(
        message=(
            "Organization submitted for verification. "
            "You can sign in after a platform admin approves your GST document."
        ),
        organization_name=tenant.name,
        email=admin.email,
        verification_status="pending",
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    enforce_rate_limit(
        request,
        scope="auth:login",
        limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
    )
    email = body.email.strip().lower()
    check_login_lockout(request, email)
    result = await db.execute(
        select(User).options(selectinload(User.tenant)).where(User.email == email)
    )
    user = result.scalars().first()
    password_ok = False
    if user is not None:
        password_ok = await asyncio.to_thread(
            verify_password, body.password, user.hashed_password
        )
    if user is None or not password_ok:
        record_login_failure(request, email)
        logger.warning("Sign-in failed because the email or password was wrong")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        logger.warning("Sign-in blocked because the account is inactive")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    if user.role != "superadmin":
        _assert_tenant_can_access(user.tenant)

    clear_login_failures(request, email)
    refresh_raw = await issue_refresh_token(db, user)
    await db.commit()
    logger.info(
        "%s signed in successfully as %s",
        user.full_name or "A user",
        user.role.replace("_", " "),
    )
    return _issue_token(
        user,
        tenant_name=user.tenant.name if user.tenant else None,
        refresh_token=refresh_raw,
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)


@router.post("/switch-tenant", response_model=TokenResponse)
async def switch_tenant(
    body: SwitchTenantRequest,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, body.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot switch into the platform tenant")
    status_value = getattr(tenant, "verification_status", "approved") or "approved"
    if status_value != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization is not approved yet",
        )
    if not tenant.is_active:
        raise HTTPException(status_code=400, detail="Organization is inactive")

    home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
    admin.home_tenant_id = home_id  # type: ignore[attr-defined]
    return _issue_token(
        admin,
        tenant_name=tenant.name,
        active_tenant_id=str(tenant.id),
        active_tenant_name=tenant.name,
    )


@router.post("/clear-tenant-switch", response_model=TokenResponse)
async def clear_tenant_switch(
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
    tenant = await db.get(Tenant, home_id)
    admin.home_tenant_id = home_id  # type: ignore[attr-defined]
    admin.tenant_id = home_id
    return _issue_token(
        admin,
        tenant_name=tenant.name if tenant else "Platform",
    )


@router.get("/invites/{token}", response_model=InvitePublicResponse)
async def get_invite(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    enforce_rate_limit(request, scope="auth:invite_lookup", limit=60)
    invite = await get_valid_invite(db, token)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    tenant = await db.get(Tenant, invite.tenant_id)
    return InvitePublicResponse(
        email=invite.email,
        role=invite.role,  # type: ignore[arg-type]
        organization_name=tenant.name if tenant else "Organization",
        expires_at=invite.expires_at,
    )


@router.post("/accept-invite", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def accept_invite(
    body: AcceptInviteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    enforce_rate_limit(
        request,
        scope="auth:accept_invite",
        limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
    )
    invite = await get_valid_invite(db, body.token.strip())
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")

    tenant = await db.get(Tenant, invite.tenant_id)
    _assert_tenant_can_access(tenant)

    email = invite.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    from datetime import datetime, timezone

    from app.core.security import hash_password

    user = User(
        tenant_id=invite.tenant_id,
        email=email,
        full_name=body.full_name.strip(),
        hashed_password=await asyncio.to_thread(hash_password, body.password),
        role=invite.role,
        is_active=True,
    )
    invite.accepted_at = datetime.now(timezone.utc)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    refresh_raw = await issue_refresh_token(db, user)
    await db.commit()
    return _issue_token(user, tenant_name=tenant.name if tenant else None, refresh_token=refresh_raw)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    rotated = await rotate_refresh_token(db, body.refresh_token)
    if rotated is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user, new_refresh = rotated
    return _issue_token(user, tenant_name=user.tenant.name if user.tenant else None, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    await revoke_refresh_token(db, body.refresh_token)


@router.post("/mfa/setup", response_model=MfaSetupResponse)
async def mfa_setup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="MFA setup is limited to admin users")
    secret = generate_mfa_secret()
    current_user.mfa_secret = secret
    current_user.mfa_enabled = False
    await db.commit()
    return MfaSetupResponse(
        secret=secret,
        provisioning_uri=provisioning_uri(secret=secret, email=current_user.email),
    )


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(
    body: MfaVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA is not configured for this user")
    if not verify_mfa_code(secret=current_user.mfa_secret, code=body.code):
        raise HTTPException(status_code=401, detail="Invalid MFA code")
    current_user.mfa_enabled = True
    refresh_raw = await issue_refresh_token(db, current_user)
    await db.commit()
    return _issue_token(current_user, refresh_token=refresh_raw)
