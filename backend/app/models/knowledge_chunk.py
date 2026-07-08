"""KnowledgeChunk model — stores vector-embedded document chunks for RAG retrieval."""
import uuid
from sqlalchemy import String, Text, Integer, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.models.base import Base, TimestampMixin


# Voyage-3 produces 1024-dimensional embeddings
EMBEDDING_DIMENSIONS = 1024


class KnowledgeChunk(Base, TimestampMixin):
    """A chunk of text from an uploaded knowledge base document, stored with
    its vector embedding for semantic retrieval at chat time."""
    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tree_id: Mapped[str] = mapped_column(String(36), ForeignKey("trees.id", ondelete="CASCADE"), nullable=False)
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=False)
    matched_terms: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    tree: Mapped["Tree"] = relationship()
    clinic: Mapped["Clinic | None"] = relationship()
