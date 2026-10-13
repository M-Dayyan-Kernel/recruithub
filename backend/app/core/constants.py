"""Shared constants for platform foundation."""

from __future__ import annotations

PLATFORM_TENANT_SLUG = "platform"
DEFAULT_TENANT_SLUG = "default"
INVITE_TTL_DAYS = 7
REFRESH_TOKEN_DAYS = 14
# Password links: a self-service reset is short-lived; the onboarding link a
# Super Admin triggers has to survive until the new admin reads their mail.
PASSWORD_RESET_TTL_MINUTES = 60
PASSWORD_ONBOARDING_TTL_DAYS = 7
# Minimum gap between reset emails to one account (mail-bombing guard).
PASSWORD_RESET_COOLDOWN_SECONDS = 60

DEFAULT_PHONE_REGIONS = ["IN"]
DEFAULT_SCREENING_MAX_RETRIES = 3
DEFAULT_SCREENING_RETRY_DELAY_SECONDS = 1800
DEFAULT_COMPANY_NAME = "Webknot Technologies"
PLATFORM_COMPANY_NAME = "Platform"
