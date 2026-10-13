"""Shared HTML shell for transactional emails.

Mail clients are hostile to modern CSS: Gmail ignores class selectors on links
and recolours them blue, Outlook ignores padding on ``<a>``, and dark modes
rewrite colours. So this layout is table-based and every style that matters is
inlined, and the call-to-action is a "bulletproof button": the colour sits on a
table cell *and* on the link, and the label carries its own inline colour, so
it stays legible whichever of those a client honours.

Callers pass HTML fragments for ``paragraphs``; anything user-supplied must go
through :func:`strong` / ``html.escape`` first.
"""

from __future__ import annotations

from html import escape
from typing import Sequence

BRAND_NAME = "Recruitment Hub"
ACCENT = "#4f46e5"

_FONT = "Arial, Helvetica, sans-serif"
_INK = "#111827"
_BODY = "#374151"
_MUTED = "#6b7280"
_LINE = "#e5e7eb"
_PAGE = "#f4f4f7"


def strong(text: str) -> str:
    """Escaped, bold inline text for use inside a paragraph."""
    return f'<strong style="color:{_INK};">{escape(text)}</strong>'


def button(label: str, url: str, *, accent: str = ACCENT) -> str:
    """A call-to-action button that stays readable in Gmail, Outlook and dark mode."""
    safe_url = escape(url, quote=True)
    safe_label = escape(label)
    return f"""<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin:28px 0 8px 0;">
  <tr>
    <td align="center" bgcolor="{accent}" style="border-radius:8px; background-color:{accent};">
      <a href="{safe_url}" target="_blank"
         style="display:inline-block; padding:14px 32px; font-family:{_FONT}; font-size:16px; font-weight:bold; line-height:20px; color:#ffffff; text-decoration:none; border-radius:8px; background-color:{accent}; border:1px solid {accent};">
        <span style="color:#ffffff; text-decoration:none;">{safe_label}</span>
      </a>
    </td>
  </tr>
</table>
<div style="clear:both; height:1px; line-height:1px; font-size:1px;">&nbsp;</div>"""


def _fallback_link(url: str, *, accent: str) -> str:
    safe_url = escape(url, quote=True)
    return f"""<p style="margin:24px 0 0 0; font-family:{_FONT}; font-size:13px; line-height:20px; color:{_MUTED};">
  Button not working? Copy and paste this link into your browser:<br />
  <a href="{safe_url}" target="_blank" style="color:{accent}; word-break:break-all;">{safe_url}</a>
</p>"""


def render_email(
    *,
    heading: str,
    paragraphs: Sequence[str],
    greeting_name: str | None = None,
    cta: tuple[str, str] | None = None,
    footer_lines: Sequence[str] = (),
    preheader: str = "",
    accent: str = ACCENT,
) -> str:
    """Render a complete email document.

    ``heading`` and ``greeting_name`` are escaped here. ``paragraphs`` and
    ``footer_lines`` are trusted HTML fragments (escape user text with
    :func:`strong`). ``cta`` is ``(label, url)``.
    """
    greeting = (
        f'<p style="margin:0 0 16px 0; font-family:{_FONT}; font-size:16px; line-height:24px; color:{_BODY};">'
        f"Hi {strong(greeting_name)},</p>"
        if greeting_name
        else ""
    )
    body = "".join(
        f'<p style="margin:0 0 16px 0; font-family:{_FONT}; font-size:16px; line-height:24px; color:{_BODY};">{p}</p>'
        for p in paragraphs
    )
    action = ""
    if cta:
        label, url = cta
        action = button(label, url, accent=accent) + _fallback_link(url, accent=accent)
    footer = "".join(
        f'<p style="margin:0 0 6px 0; font-family:{_FONT}; font-size:12px; line-height:18px; color:{_MUTED};">{line}</p>'
        for line in footer_lines
    )
    hidden_preheader = (
        f'<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:{_PAGE}; font-size:1px; line-height:1px;">'
        f"{escape(preheader)}</div>"
        if preheader
        else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{escape(heading)}</title>
</head>
<body style="margin:0; padding:0; background-color:{_PAGE};">
  {hidden_preheader}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{_PAGE}" style="background-color:{_PAGE};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%; max-width:600px; background-color:#ffffff; border:1px solid {_LINE}; border-radius:12px;">
          <tr>
            <td style="padding:24px 32px; border-bottom:1px solid {_LINE}; font-family:{_FONT}; font-size:18px; font-weight:bold; color:{accent};">
              {escape(BRAND_NAME)}
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 20px 0; font-family:{_FONT}; font-size:24px; line-height:32px; font-weight:bold; color:{_INK};">{escape(heading)}</h1>
              {greeting}
              {body}
              {action}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; border-top:1px solid {_LINE};">
              {footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
