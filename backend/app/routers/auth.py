from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Request, UploadFile, status

from app.dependencies import RequireSuperAdmin, get_auth_service, get_current_user
from app.exceptions import DomainError
from app.models.models import User
from app.schemas.schemas import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    InvitePublicResponse,
    LoginRequest,
    MessageResponse,
    MfaSetupResponse,
    MfaVerifyRequest,
    PasswordTokenInfoResponse,
    RefreshTokenRequest,
    ResetPasswordRequest,
    SignupPendingResponse,
    SwitchTenantRequest,
    TokenResponse,
    UserResponse,
)
from app.services.account_email_service import send_password_reset_email
from app.services.auth_service import AuthService

router = APIRouter()


def _raise_domain(exc: DomainError):
    # Re-raised as-is so the app-level DomainError handler renders the body,
    # keeping `error_code` (which HTTPException has no room for) on the wire.
    raise exc


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
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.signup(
            request,
            organization_name=organization_name,
            email=email,
            password=password,
            full_name=full_name,
            company_registration_number=company_registration_number,
            gst_document=gst_document,
        )
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.login(body, request)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/me", response_model=UserResponse)
async def me(
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    return service.me(current_user)


@router.post("/switch-tenant", response_model=TokenResponse)
async def switch_tenant(
    body: SwitchTenantRequest,
    admin: RequireSuperAdmin,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.switch_tenant(body, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/clear-tenant-switch", response_model=TokenResponse)
async def clear_tenant_switch(
    admin: RequireSuperAdmin,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.clear_tenant_switch(admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/invites/{token}", response_model=InvitePublicResponse)
async def get_invite(
    token: str,
    request: Request,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.get_invite_public(token, request)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/accept-invite", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def accept_invite(
    body: AcceptInviteRequest,
    request: Request,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.accept_invite(body, request)
    except DomainError as exc:
        _raise_domain(exc)


# Same words for every address, so the response cannot be used to find out
# which emails have accounts.
_FORGOT_PASSWORD_MESSAGE = (
    "If an account exists for that email, a password reset link is on its way."
)


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    service: AuthService = Depends(get_auth_service),
):
    try:
        pending = await service.forgot_password(body, request)
    except DomainError as exc:
        _raise_domain(exc)
    if pending is not None:
        # Sent after the response so a slow mail provider cannot make a known
        # address measurably slower than an unknown one.
        background_tasks.add_task(
            send_password_reset_email,
            pending.to_email,
            full_name=pending.full_name,
            reset_url=pending.reset_url,
            expires_minutes=pending.expires_minutes,
        )
    return MessageResponse(message=_FORGOT_PASSWORD_MESSAGE)


@router.get("/password-token/{token}", response_model=PasswordTokenInfoResponse)
async def get_password_token(
    token: str,
    request: Request,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.get_password_token(token, request)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    service: AuthService = Depends(get_auth_service),
):
    try:
        await service.reset_password(body, request)
    except DomainError as exc:
        _raise_domain(exc)
    return MessageResponse(message="Your password has been updated. You can now sign in.")


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.change_password(current_user, body, request)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    body: RefreshTokenRequest,
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.refresh(body)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshTokenRequest,
    service: AuthService = Depends(get_auth_service),
):
    await service.logout(body)


@router.post("/mfa/setup", response_model=MfaSetupResponse)
async def mfa_setup(
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.mfa_setup(current_user)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(
    body: MfaVerifyRequest,
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    try:
        return await service.mfa_verify(current_user, body)
    except DomainError as exc:
        _raise_domain(exc)
