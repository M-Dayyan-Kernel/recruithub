"""Tenant access verification for auth flows."""

from __future__ import annotations

from app.exceptions import AuthorizationError, BadRequestError
from app.models.models import Tenant

#: Error codes clients branch on. `ORG_INACTIVE` in particular tells the UI to
#: end the session rather than show a generic "request failed" error.
ORG_PENDING_CODE = "organization_pending"
ORG_REJECTED_CODE = "organization_rejected"
ORG_INACTIVE_CODE = "organization_inactive"

ORG_INACTIVE_MESSAGE = (
    "Your organization has been deactivated by the platform administrator. "
    "Contact support to restore access."
)

#: Codes that mean the organization can no longer be used at all, so any live
#: session must be terminated.
ORG_ACCESS_REVOKED_CODES = frozenset(
    {ORG_PENDING_CODE, ORG_REJECTED_CODE, ORG_INACTIVE_CODE}
)


class TenantAccessPolicy:
    def assert_can_access(self, tenant: Tenant | None) -> None:
        if tenant is None:
            return
        status_value = getattr(tenant, "verification_status", "approved") or "approved"
        if status_value == "pending":
            raise AuthorizationError(
                public_message=(
                    "Organization is pending platform approval. "
                    "You will get access once approved."
                ),
                error_code=ORG_PENDING_CODE,
            )
        if status_value == "rejected":
            raise AuthorizationError(
                public_message=(
                    "Organization registration was rejected. Contact support if you need help."
                ),
                error_code=ORG_REJECTED_CODE,
            )
        if not tenant.is_active:
            raise AuthorizationError(
                public_message=ORG_INACTIVE_MESSAGE,
                error_code=ORG_INACTIVE_CODE,
            )

    def assert_can_switch_to(self, tenant: Tenant) -> None:
        status_value = getattr(tenant, "verification_status", "approved") or "approved"
        if status_value != "approved":
            raise AuthorizationError(public_message="Organization is not approved yet")
        if not tenant.is_active:
            raise BadRequestError(public_message="Organization is inactive")
