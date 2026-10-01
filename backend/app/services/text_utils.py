"""Text helpers for AI prompt preparation."""

_TRUNCATION_MARKER = "\n\n[...truncated...]\n\n"


def head_tail_truncate(text: str, max_chars: int, *, head_ratio: float = 0.7) -> str:
    """Truncate long text keeping head and tail portions.

    Contact/skills often appear at the top of resumes; education often at the bottom.
    """
    if max_chars <= 0 or len(text) <= max_chars:
        return text

    marker_len = len(_TRUNCATION_MARKER)
    if max_chars <= marker_len + 2:
        return text[:max_chars]

    budget = max_chars - marker_len
    head_len = max(1, int(budget * head_ratio))
    tail_len = max(1, budget - head_len)
    if head_len + tail_len > budget:
        tail_len = budget - head_len

    return text[:head_len] + _TRUNCATION_MARKER + text[-tail_len:]
