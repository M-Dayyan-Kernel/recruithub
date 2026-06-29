"""
Email Service — Sprint 6

Sends interview invitation emails via the Resend API.

Functions:
  - send_interview_link: Sends a formatted HTML email with the interview link.
    Returns True on success, False on any failure (never raises — caller handles fallback).
"""

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

SENDER_EMAIL = "onboarding@resend.dev"


def _build_email_html(candidate_name: str, job_title: str, interview_url: str) -> str:
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
    <h1>You've been invited to interview! 🎉</h1>
    <p>Hi <strong>{candidate_name}</strong>,</p>
    <p>
      Congratulations — you've been shortlisted for the <strong>{job_title}</strong> role.
      We'd like to invite you to complete an AI-powered video interview at your convenience.
    </p>

    <a href="{interview_url}" class="btn">Start My Interview →</a>

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
      <p>Good luck! 🚀</p>
    </div>
  </div>
</body>
</html>"""


def send_interview_link(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    interview_url: str,
) -> bool:
    """
    Send an interview invitation email via Resend.

    Returns True on success, False on any error.
    Never raises — the caller decides what to do on failure.
    """
    import resend

    resend.api_key = settings.RESEND_API_KEY

    try:
        params: resend.Emails.SendParams = {
            "from": SENDER_EMAIL,
            "to": [candidate_email],
            "subject": f"[Interview Invitation] {job_title}",
            "html": _build_email_html(candidate_name, job_title, interview_url),
        }
        response = resend.Emails.send(params)
        logger.info(
            "Interview invitation sent to %s (job=%s, resend_id=%s)",
            candidate_email,
            job_title,
            response.get("id"),
        )
        return True

    except Exception as exc:
        logger.error(
            "Failed to send interview invitation to %s for job %s: %s",
            candidate_email,
            job_title,
            exc,
        )
        return False
