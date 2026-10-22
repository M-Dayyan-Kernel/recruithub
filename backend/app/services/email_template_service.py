"""
Email template management — defaults, validation, rendering, and persistence.
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import SystemSettings

logger = logging.getLogger(__name__)

DEFAULT_COMPANY_NAME = "Webknot Technologies"

TEMPLATE_IDS = (
    "failed_screening_attempt",
    "interview_invitation",
    "interview_scheduled",
    "interview_reschedule",
    "interview_cancelled",
    "rejection",
)

# The details each email has data for, in the order the editor offers them. Nothing here is
# enforced: an administrator may use any of them, all of them, or none. A message that leaves
# out the interview link simply has no link, because that is what they wrote.
TEMPLATE_PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    "failed_screening_attempt": ("{{candidate_name}}", "{{job_title}}", "{{phone_number}}"),
    "interview_invitation": ("{{candidate_name}}", "{{job_title}}", "{{interview_url}}"),
    "interview_scheduled": (
        "{{candidate_name}}",
        "{{job_title}}",
        "{{interview_url}}",
        "{{scheduled_at}}",
    ),
    "interview_reschedule": ("{{candidate_name}}", "{{job_title}}", "{{interview_url}}"),
    "interview_cancelled": ("{{candidate_name}}", "{{job_title}}"),
    "rejection": ("{{candidate_name}}", "{{job_title}}"),
}

# Shown in the editor for every template; filled from Settings → company name.
COMMON_PLACEHOLDERS: tuple[str, ...] = ("{{company_name}}",)

_DEFAULT_TEMPLATES: dict[str, dict[str, Any]] = {
    "failed_screening_attempt": {
        "subject": "We tried reaching you — {{job_title}} at {{company_name}}",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    This is <strong>{{company_name}}</strong>. We recently tried to reach you by phone
    regarding the <strong>{{job_title}}</strong> opportunity.
  </p>
  <p>
    We called <strong>{{phone_number}}</strong> but were unable to connect. Please keep this
    number available — our team will try again soon.
  </p>
  <p>Thank you for your interest in {{company_name}}.</p>
</body>
</html>""",
        "version": 1,
    },
    "interview_invitation": {
        "subject": "[Interview Invitation] {{job_title}}",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    Congratulations — you have been shortlisted for the <strong>{{job_title}}</strong> role at
    {{company_name}}. Please complete your AI interview using the link below:
  </p>
  <p><a href="{{interview_url}}">{{interview_url}}</a></p>
  <p>Good luck!</p>
</body>
</html>""",
        "version": 1,
    },
    "interview_scheduled": {
        "subject": "[Interview Scheduled] {{job_title}} — {{scheduled_at}}",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview Scheduled</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px;
                  padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 22px; color: #1a1a2e; margin-bottom: 8px; }
    p { font-size: 15px; color: #444; line-height: 1.6; }
    .slot { background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 4px;
             margin: 20px 0; font-size: 15px; color: #4c1d95; }
    .btn { display: inline-block; margin: 24px 0; padding: 14px 32px;
            background-color: #4f46e5; color: #ffffff; text-decoration: none;
            border-radius: 6px; font-size: 15px; font-weight: bold; }
    .footer { font-size: 12px; color: #999; margin-top: 32px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Your interview is scheduled</h1>
    <p>Hi <strong>{{candidate_name}}</strong>,</p>
    <p>
      You have been scheduled for an AI-powered video interview for the
      <strong>{{job_title}}</strong> role.
    </p>
    <div class="slot">
      <strong>Please attend at:</strong><br />
      {{scheduled_at}}
    </div>
    <p>
      Use the link below to join the interview at the scheduled time. We recommend
      opening it a few minutes early to check your camera and microphone.
    </p>
    <a href="{{interview_url}}" class="btn">Open interview link</a>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 13px; color: #666;">{{interview_url}}</p>
    <div class="footer">
      <p>If you have any questions, please reply to this email.</p>
      <p>Good luck!</p>
    </div>
  </div>
</body>
</html>""",
        "version": 1,
    },
    "interview_reschedule": {
        "subject": "[Interview Rescheduled] {{job_title}} — new link",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    Your interview for the <strong>{{job_title}}</strong> role at {{company_name}} has been
    rescheduled. Your previous link is no longer valid.
  </p>
  <p>Please use this new link to join:</p>
  <p><a href="{{interview_url}}">{{interview_url}}</a></p>
  <p>We look forward to speaking with you.</p>
</body>
</html>""",
        "version": 1,
    },
    "interview_cancelled": {
        "subject": "[Interview Cancelled] {{job_title}} at {{company_name}}",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    Your interview for the <strong>{{job_title}}</strong> role at {{company_name}} has been
    cancelled, and the interview link we sent you no longer works.
  </p>
  <p>
    If we arrange a new time we will send you a fresh link. Thank you for your patience.
  </p>
</body>
</html>""",
        "version": 1,
    },
    "rejection": {
        "subject": "Update on your application — {{job_title}}",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    Thank you for your interest in the <strong>{{job_title}}</strong> position at
    {{company_name}}.
  </p>
  <p>
    After careful review, we will not be moving forward with your application at this time.
    We encourage you to apply for future openings that match your experience.
  </p>
  <p>We wish you the best in your job search.</p>
</body>
</html>""",
        "version": 1,
    },
}

_PREVIEW_SAMPLES: dict[str, dict[str, str]] = {
    "failed_screening_attempt": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
        "phone_number": "+91 98765 43210",
    },
    "interview_invitation": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
        "interview_url": "https://interview.example.com/abc-123",
    },
    "interview_scheduled": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
        "interview_url": "https://interview.example.com/abc-123",
        "scheduled_at": "Tuesday, 28 October 2026 at 11:00 AM",
    },
    "interview_reschedule": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
        "interview_url": "https://interview.example.com/xyz-789",
    },
    "interview_cancelled": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
    },
    "rejection": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
    },
}


def default_templates() -> dict[str, dict[str, Any]]:
    return copy.deepcopy(_DEFAULT_TEMPLATES)


def merge_templates(stored: dict | None) -> dict[str, dict[str, Any]]:
    merged = default_templates()
    if not stored:
        return merged
    for template_id in TEMPLATE_IDS:
        custom = stored.get(template_id)
        if not isinstance(custom, dict):
            continue
        if custom.get("subject"):
            merged[template_id]["subject"] = custom["subject"]
        if custom.get("body_html"):
            merged[template_id]["body_html"] = custom["body_html"]
        if custom.get("version"):
            merged[template_id]["version"] = custom["version"]
    return merged


def validate_template(template_id: str, subject: str, body_html: str) -> list[str]:
    errors: list[str] = []
    if template_id not in TEMPLATE_IDS:
        errors.append(f"Unknown template: {template_id}")
        return errors
    if not subject.strip():
        errors.append("Subject is required")
    if not body_html.strip():
        errors.append("Body is required")
    # Deliberately no check that particular placeholders are present: what an email says,
    # and which candidate details it includes, is the organisation's decision.
    return errors


def render_template(
    template_id: str,
    templates: dict[str, dict[str, Any]],
    variables: dict[str, str],
) -> tuple[str, str]:
    """Render subject and HTML body. Falls back to the default only if the stored one is empty."""
    merged = merge_templates(templates)
    entry = merged.get(template_id) or _DEFAULT_TEMPLATES[template_id]
    subject = entry["subject"]
    body = entry["body_html"]
    errors = validate_template(template_id, subject, body)
    if errors:
        logger.warning(
            "Invalid custom template %s (%s) — using defaults",
            template_id,
            "; ".join(errors),
        )
        entry = _DEFAULT_TEMPLATES[template_id]
        subject = entry["subject"]
        body = entry["body_html"]

    vars_with_company = dict(variables)
    vars_with_company.setdefault(
        "company_name",
        variables.get("company_name") or DEFAULT_COMPANY_NAME,
    )

    for key, value in vars_with_company.items():
        token = "{{" + key + "}}"
        import html

        safe = html.escape(str(value), quote=True)
        subject = subject.replace(token, safe)
        body = body.replace(token, safe)
    return subject, body


def preview_template(
    template_id: str,
    subject: str,
    body_html: str,
    *,
    company_name: str | None = None,
) -> dict[str, str]:
    errors = validate_template(template_id, subject, body_html)
    if errors:
        raise ValueError("; ".join(errors))
    samples = dict(_PREVIEW_SAMPLES.get(template_id, {}))
    samples["company_name"] = (company_name or DEFAULT_COMPANY_NAME).strip() or DEFAULT_COMPANY_NAME
    rendered_subject = subject
    rendered_body = body_html
    for key, value in samples.items():
        token = "{{" + key + "}}"
        rendered_subject = rendered_subject.replace(token, value)
        rendered_body = rendered_body.replace(token, value)
    return {"subject": rendered_subject, "body_html": rendered_body}


async def get_company_name(db: AsyncSession, tenant_id) -> str:
    from sqlalchemy import select

    if tenant_id is None:
        return DEFAULT_COMPANY_NAME

    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    name = (row.company_name if row else None) or DEFAULT_COMPANY_NAME
    return name.strip() or DEFAULT_COMPANY_NAME


async def get_merged_templates(db: AsyncSession, tenant_id) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    if tenant_id is None:
        return default_templates()

    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    stored = row.email_templates if row else None
    return merge_templates(stored)


async def save_template(
    db: AsyncSession,
    tenant_id,
    template_id: str,
    subject: str,
    body_html: str,
) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    errors = validate_template(template_id, subject, body_html)
    if errors:
        raise ValueError("; ".join(errors))

    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        row = SystemSettings(
            tenant_id=tenant_id,
            allowed_phone_regions=["IN"],
            enforce_phone_geography=True,
            company_name=DEFAULT_COMPANY_NAME,
        )
        db.add(row)

    stored = dict(row.email_templates or {})
    prev_version = (stored.get(template_id) or {}).get("version", 1)
    stored[template_id] = {
        "subject": subject,
        "body_html": body_html,
        "version": prev_version + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    row.email_templates = stored
    await db.commit()
    await db.refresh(row)
    return merge_templates(row.email_templates)


async def restore_template(
    db: AsyncSession, tenant_id, template_id: str
) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    if template_id not in TEMPLATE_IDS:
        raise ValueError(f"Unknown template: {template_id}")

    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if row and row.email_templates:
        stored = dict(row.email_templates)
        stored.pop(template_id, None)
        row.email_templates = stored or None
        await db.commit()
        await db.refresh(row)
        return merge_templates(row.email_templates)
    return default_templates()
