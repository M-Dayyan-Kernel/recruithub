"""Tenant access verification for auth flows."""

from __future__ import annotations

from app.exceptions import AuthorizationError, BadRequestError
from app.models.models import Tenant


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
            )
        if status_value == "rejected":
            raise AuthorizationError(
                public_message=(
                    "Organization registration was rejected. Contact support if you need help."
                ),
            )
        if not tenant.is_active:
            raise AuthorizationError(public_message="Organization is inactive")

    def assert_can_switch_to(self, tenant: Tenant) -> None:
        status_value = getattr(tenant, "verification_status", "approved") or "approved"
        if status_value != "approved":
            raise AuthorizationError(public_message="Organization is not approved yet")
        if not tenant.is_active:
            raise BadRequestError(public_message="Organization is inactive")
