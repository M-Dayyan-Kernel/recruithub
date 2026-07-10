"""
Email Service — interview invitations, rejection, and screening notifications via Gmail API.

Functions return True on success, False on failure (never raise).
"""

import logging
from typing import Any

from app.services import gmail_service
from app.services.email_template_service import render_template

logger = logging.getLogger(__name__)


def _build_interview_email_html(candidate_name: str, job_title: str, interview_url: str) -> str:
    """Build a clean HTML email body for the interview invitation."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview Invitation</title>
  <style>
    body {{ font-family: Arial, sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }}
    .container {{ max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px;
                  padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
    h1 {{ font-size: 22px; color: #1a1a2e; margin-bottom: 8px; }}
    p {{ font-size: 15px; color: #444; line-height: 1.6; }}
    .btn {{ display: inline-block; margin: 24px 0; padding: 14px 32px;
            background-color: #4f46e5; color: #ffffff; text-decoration: none;
            border-radius: 6px; font-size: 15px; font-weight: bold; }}
    .instructions {{ background: #f0f0fa; border-left: 4px solid #4f46e5;
                     padding: 16px; border-radius: 4px; margin-top: 24px; }}
    .instructions ul {{ margin: 8px 0; padding-left: 20px; }}
    .instructions li {{ font-size: 14px; color: #555; margin-bottom: 6px; }}
    .footer {{ font-size: 12px; color: #999; margin-top: 32px; text-align: center; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>You've been invited to interview!</h1>
    <p>Hi <strong>{candidate_name}</strong>,</p>
    <p>
      Congratulations — you've been shortlisted for the <strong>{job_title}</strong> role.
      We'd like to invite you to complete an AI-powered video interview at your convenience.
    </p>

    <a href="{interview_url}" class="btn">Start My Interview</a>

    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 13px; color: #666;">{interview_url}</p>

    <div class="instructions">
      <strong>Before you begin:</strong>
      <ul>
        <li>Find a quiet place with good lighting</li>
        <li>Use a desktop or laptop with a webcam and microphone</li>
        <li>Make sure you're using Chrome, Firefox, or Edge (latest version)</li>
        <li>The interview typically takes 20–30 minutes</li>
        <li>Your link is unique — please don't share it</li>
      </ul>
    </div>

    <div class="footer">
      <p>If you have any questions, please reply to this email.</p>
      <p>Good luck!</p>
    </div>
  </div>
</body>
</html>"""


def _build_rejection_email_html(candidate_name: str, job_title: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Application Update</title>
</head>
<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Hi <strong>{candidate_name}</strong>,</p>
  <p>
    Thank you for your interest in the <strong>{job_title}</strong> position and for taking
    the time to apply.
  </p>
  <p>
    After careful review, we will not be moving forward with your application at this time.
    We encourage you to apply for future openings that match your experience.
  </p>
  <p>We wish you the best in your job search.</p>
</body>
</html>"""


async def send_interview_link(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    interview_url: str,
    *,
    templates: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Send an immediate interview invitation (join at your convenience)."""
    if templates:
        subject, html_body = render_template(
            "interview_invitation",
            templates,
            {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "interview_url": interview_url,
            },
        )
    else:
        subject = f"[Interview Invitation] {job_title}"
        html_body = _build_interview_email_html(candidate_name, job_title, interview_url)

    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=subject,
        html_body=html_body,
    )
    if sent:
        logger.info(
            "Interview invitation sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent


def _build_scheduled_interview_email_html(
    candidate_name: str,
    job_title: str,
    interview_url: str,
    scheduled_at_label: str,
) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview Scheduled</title>
  <style>
    body {{ font-family: Arial, sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }}
    .container {{ max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px;
                  padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
    h1 {{ font-size: 22px; color: #1a1a2e; margin-bottom: 8px; }}
    p {{ font-size: 15px; color: #444; line-height: 1.6; }}
    .slot {{ background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 4px;
             margin: 20px 0; font-size: 15px; color: #4c1d95; }}
    .btn {{ display: inline-block; margin: 24px 0; padding: 14px 32px;
            background-color: #4f46e5; color: #ffffff; text-decoration: none;
            border-radius: 6px; font-size: 15px; font-weight: bold; }}
    .footer {{ font-size: 12px; color: #999; margin-top: 32px; text-align: center; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>Your interview is scheduled</h1>
    <p>Hi <strong>{candidate_name}</strong>,</p>
    <p>
      You have been scheduled for an AI-powered video interview for the
      <strong>{job_title}</strong> role.
    </p>
    <div class="slot">
      <strong>Please attend at:</strong><br />
      {scheduled_at_label}
    </div>
    <p>
      Use the link below to join the interview at the scheduled time. We recommend
      opening it a few minutes early to check your camera and microphone.
    </p>
    <a href="{interview_url}" class="btn">Open interview link</a>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; font-size: 13px; color: #666;">{interview_url}</p>
    <div class="footer">
      <p>If you have any questions, please reply to this email.</p>
      <p>Good luck!</p>
    </div>
  </div>
</body>
</html>"""


async def send_scheduled_interview_notification(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    interview_url: str,
    scheduled_at_label: str,
    *,
    templates: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Notify candidate of a future interview slot with the join link."""
    subject = f"[Interview Scheduled] {job_title} — {scheduled_at_label}"
    html_body = _build_scheduled_interview_email_html(
        candidate_name,
        job_title,
        interview_url,
        scheduled_at_label,
    )
    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=subject,
        html_body=html_body,
    )
    if sent:
        logger.info(
            "Scheduled interview notification sent to %s (job=%s, slot=%s)",
            candidate_email,
            job_title,
            scheduled_at_label,
        )
    return sent


async def send_reschedule_notification(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    interview_url: str,
    *,
    templates: dict[str, dict[str, Any]],
) -> bool:
    subject, html_body = render_template(
        "interview_reschedule",
        templates,
        {
            "candidate_name": candidate_name,
            "job_title": job_title,
            "interview_url": interview_url,
        },
    )
    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=subject,
        html_body=html_body,
    )
    if sent:
        logger.info(
            "Reschedule notification sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent


async def send_failed_screening_attempt_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    phone_number: str,
    *,
    templates: dict[str, dict[str, Any]],
) -> bool:
    subject, html_body = render_template(
        "failed_screening_attempt",
        templates,
        {
            "candidate_name": candidate_name,
            "job_title": job_title,
            "phone_number": phone_number,
        },
    )
    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=subject,
        html_body=html_body,
    )
    if sent:
        logger.info(
            "Failed screening attempt email sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent


async def send_rejection_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    *,
    templates: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Send a polite application rejection email via Gmail."""
    if templates:
        subject, html_body = render_template(
            "rejection",
            templates,
            {"candidate_name": candidate_name, "job_title": job_title},
        )
    else:
        subject = f"Update on your application — {job_title}"
        html_body = _build_rejection_email_html(candidate_name, job_title)

    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=subject,
        html_body=html_body,
    )
    if sent:
        logger.info(
            "Rejection email sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent
