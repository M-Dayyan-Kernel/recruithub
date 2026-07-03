"""Extract plain text from uploaded PDF/DOCX documents."""

import io
from pathlib import Path

import docx
import fitz  # pymupdf

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}


def extract_text_from_bytes(content: bytes, filename: str) -> str:
    """Return plain text extracted from PDF or DOCX bytes."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix!r}")

    if suffix == ".pdf":
        doc = fitz.open(stream=content, filetype="pdf")
        try:
            text = "\n".join(page.get_text() for page in doc)
        finally:
            doc.close()
    else:
        document = docx.Document(io.BytesIO(content))
        text = "\n".join(p.text for p in document.paragraphs if p.text.strip())

    return text.strip()
