"""
Email Service — interview invitations and rejection notices via Gmail API.

Functions return True on success, False on failure (never raise).
"""

import logging

from app.services import gmail_service

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


def send_interview_link(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    interview_url: str,
) -> bool:
    """Send an interview invitation email via Gmail."""
    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=f"[Interview Invitation] {job_title}",
        html_body=_build_interview_email_html(candidate_name, job_title, interview_url),
    )
    if sent:
        logger.info(
            "Interview invitation sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent


def send_rejection_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
) -> bool:
    """Send a polite application rejection email via Gmail."""
    sent = gmail_service.send_html_email(
        to_email=candidate_email,
        subject=f"Update on your application — {job_title}",
        html_body=_build_rejection_email_html(candidate_name, job_title),
    )
    if sent:
        logger.info(
            "Rejection email sent to %s (job=%s)",
            candidate_email,
            job_title,
        )
    return sent
