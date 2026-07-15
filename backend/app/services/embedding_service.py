import logging
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


async def generate_embedding(text: str, api_key: str) -> list[float]:
    """Generate text-embedding-3-small embedding vector (1536 dimensions)."""
    from app.services.mock_external import mock_embedding, mock_openai_enabled

    if mock_openai_enabled():
        truncated = text[:6000] if len(text) > 6000 else text
        return mock_embedding(truncated)

    client = AsyncOpenAI(api_key=api_key)

    # Truncate to ~6000 chars to stay well within 8191 token limit
    truncated = text[:6000] if len(text) > 6000 else text

    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=truncated,
    )

    embedding = response.data[0].embedding
    logger.info(f"Generated embedding vector of length {len(embedding)}")
    return embedding
