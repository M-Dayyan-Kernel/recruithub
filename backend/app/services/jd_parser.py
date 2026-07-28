"""Backward-compatible shim over JdParserService."""

from app.services.jd_parser_service import JdParserService

__all__ = ["parse_job_description"]


async def parse_job_description(raw_text: str, api_key: str) -> dict:
    return await JdParserService().parse(raw_text, api_key)
