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

TEMPLATE_IDS = (
    "failed_screening_attempt",
    "interview_invitation",
    "interview_reschedule",
    "rejection",
)

REQUIRED_PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    "failed_screening_attempt": ("{{candidate_name}}", "{{job_title}}", "{{phone_number}}"),
    "interview_invitation": ("{{candidate_name}}", "{{job_title}}", "{{interview_url}}"),
    "interview_reschedule": ("{{candidate_name}}", "{{job_title}}", "{{interview_url}}"),
    "rejection": ("{{candidate_name}}", "{{job_title}}"),
}

_DEFAULT_TEMPLATES: dict[str, dict[str, Any]] = {
    "failed_screening_attempt": {
        "subject": "We tried reaching you — {{job_title}} at Webknot Technologies",
        "body_html": """<!DOCTYPE html>
<html lang="en">
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{{candidate_name}}</strong>,</p>
  <p>
    This is <strong>Webknot Technologies</strong>. We recently tried to reach you by phone
    regarding the <strong>{{job_title}}</strong> opportunity.
  </p>
  <p>
    We called <strong>{{phone_number}}</strong> but were unable to connect. Please keep this
    number available — our team will try again soon.
  </p>
  <p>Thank you for your interest in Webknot Technologies.</p>
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
    Webknot Technologies. Please complete your AI interview using the link below:
  </p>
  <p><a href="{{interview_url}}">{{interview_url}}</a></p>
  <p>Good luck!</p>
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
    Your interview for the <strong>{{job_title}}</strong> role at Webknot Technologies has been
    rescheduled. Your previous link is no longer valid.
  </p>
  <p>Please use this new link to join:</p>
  <p><a href="{{interview_url}}">{{interview_url}}</a></p>
  <p>We look forward to speaking with you.</p>
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
    Webknot Technologies.
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
    "interview_reschedule": {
        "candidate_name": "Jane Doe",
        "job_title": "Senior Software Engineer",
        "interview_url": "https://interview.example.com/xyz-789",
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
    for placeholder in REQUIRED_PLACEHOLDERS.get(template_id, ()):
        if placeholder not in subject and placeholder not in body_html:
            errors.append(f"Missing required placeholder: {placeholder}")
    return errors


def render_template(
    template_id: str,
    templates: dict[str, dict[str, Any]],
    variables: dict[str, str],
) -> tuple[str, str]:
    """Render subject and HTML body. Falls back to defaults if stored template is invalid."""
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

    for key, value in variables.items():
        token = "{{" + key + "}}"
        subject = subject.replace(token, value)
        body = body.replace(token, value)
    return subject, body


def preview_template(
    template_id: str,
    subject: str,
    body_html: str,
) -> dict[str, str]:
    errors = validate_template(template_id, subject, body_html)
    if errors:
        raise ValueError("; ".join(errors))
    samples = _PREVIEW_SAMPLES.get(template_id, {})
    rendered_subject = subject
    rendered_body = body_html
    for key, value in samples.items():
        token = "{{" + key + "}}"
        rendered_subject = rendered_subject.replace(token, value)
        rendered_body = rendered_body.replace(token, value)
    return {"subject": rendered_subject, "body_html": rendered_body}


async def get_merged_templates(db: AsyncSession) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    stored = row.email_templates if row else None
    return merge_templates(stored)


async def save_template(
    db: AsyncSession,
    template_id: str,
    subject: str,
    body_html: str,
) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    errors = validate_template(template_id, subject, body_html)
    if errors:
        raise ValueError("; ".join(errors))

    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if not row:
        row = SystemSettings(id=1, allowed_phone_regions=["IN"], enforce_phone_geography=True)
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


async def restore_template(db: AsyncSession, template_id: str) -> dict[str, dict[str, Any]]:
    from sqlalchemy import select

    if template_id not in TEMPLATE_IDS:
        raise ValueError(f"Unknown template: {template_id}")

    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if row and row.email_templates:
        stored = dict(row.email_templates)
        stored.pop(template_id, None)
        row.email_templates = stored or None
        await db.commit()
        await db.refresh(row)
        return merge_templates(row.email_templates)
    return default_templates()
