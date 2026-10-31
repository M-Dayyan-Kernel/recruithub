"""Display labels for an interview report's recommendation, shared by the pipeline and finalists."""

from __future__ import annotations


def map_recommendation_label(rec: str | None) -> str | None:
    if not rec:
        return None
    normalized = rec.lower().replace(" ", "_")
    if normalized in ("strong_hire", "hire"):
        return "Hire"
    if normalized == "no_hire":
        return "No Hire"
    if normalized in ("hold", "needs_review"):
        return "Needs Review"
    return rec.replace("_", " ").title()
