"""Tests for head/tail resume truncation."""

from __future__ import annotations

import unittest

from app.services.text_utils import head_tail_truncate


class HeadTailTruncateTests(unittest.TestCase):
    def test_short_text_unchanged(self) -> None:
        text = "hello world"
        self.assertEqual(head_tail_truncate(text, 100), text)

    def test_keeps_head_and_tail(self) -> None:
        text = "A" * 70 + "B" * 30
        out = head_tail_truncate(text, 50, head_ratio=0.7)
        self.assertIn("[...truncated...]", out)
        self.assertTrue(out.startswith("A"))
        self.assertTrue(out.endswith("B"))
        self.assertLessEqual(len(out), 50)

    def test_empty_max_returns_original(self) -> None:
        text = "abcdef"
        self.assertEqual(head_tail_truncate(text, 0), text)


if __name__ == "__main__":
    unittest.main()
