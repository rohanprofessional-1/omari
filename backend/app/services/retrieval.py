"""Retrieval service — semantic search over knowledge base chunks at chat time.

Uses pgvector cosine distance to find the most relevant knowledge chunks
for a patient's message, scoped to the conversation's tree.
"""
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_chunk import KnowledgeChunk
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)


async def retrieve_relevant_chunks(
    db: AsyncSession,
    tree_id: str,
    query: str,
    top_k: int = 3,
    clinic_id: Optional[str] = None,
) -> list[KnowledgeChunk]:
    """Retrieve the most relevant knowledge chunks for a patient message.

    1. Embeds the query via Voyage (query-optimized embedding)
    2. Runs a pgvector cosine similarity search against knowledge_chunks
       scoped to the given tree

    Args:
        db: Async database session.
        tree_id: ID of the tree to scope the search to.
        query: The patient's message text.
        top_k: Number of top results to return (default: 3).
        clinic_id: Optional clinic ID for additional filtering.

    Returns:
        List of the top-k most relevant KnowledgeChunk objects.
    """
    if not embedding_service.is_available:
        logger.debug("Embedding service not available, skipping retrieval")
        return []

    try:
        query_embedding = await embedding_service.embed_query(query)
    except Exception as e:
        logger.warning(f"Failed to embed query for retrieval: {e}")
        return []

    # Build the query with pgvector cosine distance operator
    stmt = (
        select(KnowledgeChunk)
        .where(KnowledgeChunk.tree_id == tree_id)
        .order_by(KnowledgeChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )

    if clinic_id:
        stmt = stmt.where(KnowledgeChunk.clinic_id == clinic_id)

    try:
        result = await db.execute(stmt)
        chunks = result.scalars().all()
        logger.info(
            f"[retrieval] Found {len(chunks)} relevant chunks for tree={tree_id}"
        )
        return list(chunks)
    except Exception as e:
        logger.warning(f"Knowledge retrieval query failed: {e}")
        return []


def format_knowledge_context(chunks: list[KnowledgeChunk]) -> str:
    """Format retrieved chunks into a context string for the extraction prompt.

    Args:
        chunks: List of KnowledgeChunk objects.

    Returns:
        A formatted string with the relevant knowledge context.
    """
    if not chunks:
        return ""

    parts = ["Relevant clinical knowledge from the clinic's knowledge base:"]
    for i, chunk in enumerate(chunks, 1):
        parts.append(f"[{i}] {chunk.content}")

    return "\n\n".join(parts)
