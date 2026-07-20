"""Tests for document extractor allowlist and .doc rejection."""

from __future__ import annotations

import unittest

from app.services.document_extractor import (
    ALLOWED_EXTENSIONS,
    UnsupportedDocumentError,
    extract_text_from_bytes,
)


class DocumentExtractorTests(unittest.TestCase):
    def test_allowed_extensions_exclude_doc(self) -> None:
        self.assertEqual(ALLOWED_EXTENSIONS, {".pdf", ".docx"})
        self.assertNotIn(".doc", ALLOWED_EXTENSIONS)

    def test_legacy_doc_rejected(self) -> None:
        with self.assertRaises(UnsupportedDocumentError) as ctx:
            extract_text_from_bytes(b"fake", "resume.doc")
        self.assertIn("PDF or DOCX", str(ctx.exception))

    def test_unknown_extension_rejected(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            extract_text_from_bytes(b"fake", "notes.txt")
        self.assertIn("Unsupported file type", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
