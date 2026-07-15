import asyncio
import logging
from openai import OpenAI

logger = logging.getLogger(__name__)


def _generate_embedding_sync(text: str, api_key: str) -> list[float]:
    """Sync OpenAI call — safe under Celery asyncio.run() on Windows."""
    client = OpenAI(api_key=api_key)
    truncated = text[:6000] if len(text) > 6000 else text
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=truncated,
    )
    embedding = response.data[0].embedding
    logger.info("Generated embedding vector of length %d", len(embedding))
    return embedding


async def generate_embedding(text: str, api_key: str) -> list[float]:
    """Generate text-embedding-3-small embedding vector (1536 dimensions)."""
    from app.services.mock_external import mock_embedding, mock_openai_enabled

    if mock_openai_enabled():
        truncated = text[:6000] if len(text) > 6000 else text
        return mock_embedding(truncated)

    return await asyncio.to_thread(_generate_embedding_sync, text, api_key)
