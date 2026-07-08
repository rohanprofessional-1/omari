"""Embedding service — thin wrapper around the Voyage AI API.

Provides batch and single-query embedding for knowledge base documents
and chat-time retrieval queries.
"""
import logging
from typing import Optional

import voyageai

from app.core.config import settings

logger = logging.getLogger(__name__)

# Voyage-3 model — 1024 dimensions, strong on domain-specific text
VOYAGE_MODEL = "voyage-3"


class EmbeddingService:
    """Wraps the Voyage AI client for text embedding."""

    def __init__(self) -> None:
        self._client: Optional[voyageai.Client] = None
        if settings.VOYAGE_API_KEY:
            self._client = voyageai.Client(api_key=settings.VOYAGE_API_KEY)

    @property
    def is_available(self) -> bool:
        return self._client is not None

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Batch-embed texts for document ingestion.

        Args:
            texts: List of text chunks to embed.

        Returns:
            List of embedding vectors (each 1024-dimensional for voyage-3).

        Raises:
            RuntimeError: If the Voyage API key is not configured.
        """
        if not self._client:
            raise RuntimeError("Voyage API key not configured.")

        if not texts:
            return []

        # Voyage supports batches of up to 128 texts per call
        all_embeddings: list[list[float]] = []
        batch_size = 128
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            logger.info(f"[embedding] Embedding batch {i // batch_size + 1} ({len(batch)} texts)")
            result = self._client.embed(
                batch,
                model=VOYAGE_MODEL,
                input_type="document",
            )
            all_embeddings.extend(result.embeddings)

        return all_embeddings

    async def embed_query(self, query: str) -> list[float]:
        """Embed a single query for retrieval.

        Uses input_type="query" which optimizes the embedding for retrieval.

        Args:
            query: The search query text.

        Returns:
            A single embedding vector (1024-dimensional for voyage-3).

        Raises:
            RuntimeError: If the Voyage API key is not configured.
        """
        if not self._client:
            raise RuntimeError("Voyage API key not configured.")

        result = self._client.embed(
            [query],
            model=VOYAGE_MODEL,
            input_type="query",
        )
        return result.embeddings[0]


# Singleton instance
embedding_service = EmbeddingService()
