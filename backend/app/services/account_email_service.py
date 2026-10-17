"""Account and organization lifecycle emails.

Organization onboarding, approval, rejection, and password reset. Templates are
hard-coded for now (see the ticket); everything user-supplied is HTML-escaped
because organization and person names come from public signup.

Like the other email helpers, every function returns True on success and False
on failure and never raises, so a mail outage cannot undo the action that
triggered it.
"""

from __future__ import annotations

import logging
from app.services.email_layout import render_email, strong
from app.services.email_service import _send_html_email_async

logger = logging.getLogger(__name__)


async def _send(to_email: str, subject: str, html_body: str, *, kind: str) -> bool:
    try:
        sent = await _send_html_email_async(
            to_email=to_email, subject=subject, html_body=html_body
        )
    except Exception:
        logger.exception("Failed to send %s email to %s", kind, to_email)
        return False
    if sent:
        logger.info("Sent %s email to %s", kind, to_email)
    else:
        logger.warning("%s email to %s was not sent", kind.capitalize(), to_email)
    return bool(sent)


async def send_org_onboarding_email(
    to_email: str,
    *,
    full_name: str,
    organization_name: str,
    set_password_url: str,
    expires_days: int,
) -> bool:
    html = render_email(
        heading="Your organization is ready",
        greeting_name=full_name,
        preheader=f"Set your password to start using {organization_name} on Recruitment Hub.",
        paragraphs=[
            f"An account for {strong(organization_name)} has been set up for you on "
            "Recruitment Hub, with you as its administrator.",
            "Choose your password to get started.",
        ],
        cta=("Set my password", set_password_url),
        footer_lines=[
            f"This link can be used once and expires in {expires_days} days.",
            "If you did not expect this email, you can safely ignore it.",
        ],
    )
    return await _send(
        to_email, f"Set up your {organization_name} account", html, kind="org onboarding"
    )


async def send_org_approved_email(
    to_email: str,
    *,
    full_name: str,
    organization_name: str,
    login_url: str,
) -> bool:
    html = render_email(
        heading="Your organization has been approved",
        greeting_name=full_name,
        preheader=f"{organization_name} is approved. Sign in to Recruitment Hub.",
        paragraphs=[
            f"Good news: {strong(organization_name)} has been approved on Recruitment Hub.",
            "You can now sign in with the password you chose when you registered.",
        ],
        cta=("Sign in", login_url),
        footer_lines=[
            "Forgot your password? Use “Forgot password” on the sign-in page.",
        ],
    )
    return await _send(
        to_email, f"{organization_name} has been approved", html, kind="org approval"
    )


async def send_org_rejected_email(
    to_email: str,
    *,
    full_name: str,
    organization_name: str,
) -> bool:
    html = render_email(
        heading="Update on your organization registration",
        greeting_name=full_name,
        preheader=f"An update on the registration of {organization_name}.",
        paragraphs=[
            f"Thank you for registering {strong(organization_name)} on Recruitment Hub.",
            "After reviewing the submitted details, we were unable to approve the "
            "registration at this time.",
            "If you believe this is a mistake, please reply to this email or "
            "contact support.",
        ],
    )
    return await _send(
        to_email,
        f"Update on your {organization_name} registration",
        html,
        kind="org rejection",
    )


async def send_password_reset_email(
    to_email: str,
    *,
    full_name: str,
    reset_url: str,
    expires_minutes: int,
) -> bool:
    html = render_email(
        heading="Reset your password",
        greeting_name=full_name,
        preheader="Use this link to choose a new Recruitment Hub password.",
        paragraphs=[
            "We received a request to reset the password for your Recruitment Hub account.",
        ],
        cta=("Reset password", reset_url),
        footer_lines=[
            f"This link can be used once and expires in {expires_minutes} minutes.",
            "If you did not request this, you can safely ignore this email; "
            "your password will not change.",
        ],
    )
    return await _send(to_email, "Reset your password", html, kind="password reset")
