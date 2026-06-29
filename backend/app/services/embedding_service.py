import logging
from openai import AsyncOpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)


async def generate_embedding(text: str) -> list[float]:
    """Generate text-embedding-3-small embedding vector (1536 dimensions)."""
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    # Truncate to ~6000 chars to stay well within 8191 token limit
    truncated = text[:6000] if len(text) > 6000 else text

    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=truncated,
    )

    embedding = response.data[0].embedding
    logger.info(f"Generated embedding vector of length {len(embedding)}")
    return embedding
