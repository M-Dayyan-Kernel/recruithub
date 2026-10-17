"""Email layout: the call-to-action must stay readable in hostile mail clients."""

import re
import unittest
from html.parser import HTMLParser

from app.services.email_layout import button, render_email, strong
from app.services.email_service import _build_org_invite_email_html

URL = "https://hr.example.com/reset-password?token=abc&x=1"


class _Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors: list[dict[str, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.anchors.append(dict(attrs))


def _anchors(html: str) -> list[dict[str, str]]:
    parser = _Anchors()
    parser.feed(html)
    return parser.anchors


class ButtonTests(unittest.TestCase):
    def test_button_colours_are_inline_not_class_based(self):
        html = button("Set my password", URL)
        anchor = _anchors(html)[0]
        style = anchor["style"]
        # Gmail drops class rules on links and recolours them blue: the white
        # label and the background must be on the element itself.
        self.assertIn("color:#ffffff", style)
        self.assertIn("background-color:#4f46e5", style)
        self.assertNotIn("class", anchor)
        self.assertIn('bgcolor="#4f46e5"', html)  # cell fallback if the link style is stripped

    def test_label_has_its_own_inline_colour(self):
        html = button("Sign in", URL)
        self.assertRegex(html, r'<span style="color:#ffffff;[^"]*">Sign in</span>')

    def test_url_is_escaped_in_the_attribute(self):
        html = button("Go", 'https://x.test/?a=1&b="2"')
        self.assertIn("a=1&amp;b=&quot;2&quot;", html)

    def test_label_is_escaped(self):
        self.assertIn("&lt;b&gt;", button("<b>", URL))


class RenderEmailTests(unittest.TestCase):
    def _render(self, **kw):
        base = dict(
            heading="Your organization is ready",
            paragraphs=[f"An account for {strong('Acme')} is set up."],
            greeting_name="Ada",
            cta=("Set my password", URL),
            footer_lines=["This link can be used once."],
            preheader="Set your password to start.",
        )
        base.update(kw)
        return render_email(**base)

    def test_is_a_complete_table_layout_with_no_class_dependency(self):
        html = self._render()
        self.assertTrue(html.startswith("<!DOCTYPE html>"))
        self.assertIn('role="presentation"', html)
        self.assertNotRegex(html, r'class="')
        self.assertNotIn("<style", html)

    def test_has_a_visible_fallback_link_with_the_full_url(self):
        html = self._render()
        urls = [a["href"] for a in _anchors(html)]
        self.assertEqual(urls.count(URL), 2)  # button + plain-text fallback
        self.assertIn("Button not working?", html)

    def test_hostile_text_is_escaped_everywhere_it_is_user_supplied(self):
        evil = '<script>alert(1)</script>"&'
        html = self._render(heading=evil, greeting_name=evil, preheader=evil,
                            paragraphs=[strong(evil)])
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_no_cta_means_no_links_or_button(self):
        html = self._render(cta=None)
        self.assertEqual(_anchors(html), [])
        self.assertNotIn("bgcolor=\"#4f46e5\"", html.split("</h1>")[1])

    def test_accent_colour_flows_to_button_and_brand(self):
        html = self._render(accent="#0d9488")
        self.assertIn("background-color:#0d9488", _anchors(html)[0]["style"])
        self.assertNotIn("#4f46e5", html)

    def test_preheader_is_hidden(self):
        html = self._render()
        self.assertRegex(html, r'display:none[^>]*>Set your password to start\.')


class OrgInviteTemplateTests(unittest.TestCase):
    def test_invite_uses_the_readable_button_and_escapes_names(self):
        html = _build_org_invite_email_html(
            organization_name='<i>Ink</i>',
            role="hr",
            invite_url="https://hr.example.com/accept-invite?token=t",
            invited_by_name="Super <b>Admin</b>",
        )
        anchor = next(a for a in _anchors(html) if "accept-invite" in a["href"])
        self.assertIn("color:#ffffff", anchor["style"])
        self.assertIn("background-color:#0d9488", anchor["style"])
        self.assertNotIn("<i>Ink</i>", html)
        self.assertNotIn("<b>Admin</b>", html)
        self.assertIn("Accept invitation", html)


if __name__ == "__main__":
    unittest.main()
