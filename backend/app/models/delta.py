import uuid
from sqlalchemy import String, Integer, ForeignKey, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class TreeDelta(Base, TimestampMixin):
    """A clinic's durable customization of a CPG-generated base tree.

    Deltas persist SEPARATELY from the compiled tree rows: the deployed tree
    is always compile(base_tree_json, ordered deltas). When the CPG is
    re-uploaded and the base regenerated, deltas replay on top — ones whose
    semantic anchors no longer resolve are marked stale for re-review, never
    silently dropped. `payload_json` is the frontend DeltaOp verbatim
    (anchors included); the frontend Zod schema is the canonical validator.
    """
    __tablename__ = "tree_deltas"
    __table_args__ = (Index("ix_tree_deltas_tree_seq", "tree_id", "seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), nullable=False
    )
    # Application order — the compiler applies strictly ascending.
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    # payload_json["op"], denormalized for filtering/grouping in review lists.
    op: Mapped[str] = mapped_column(String(40), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Snapshot of the anchored fragment at authoring time (precondition check).
    expected_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    provenance_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Roster reference when this is a bind_terminal to a specialists row.
    specialist_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("specialists.id"), nullable=True
    )
    # active | stale_unresolved | stale_ambiguous | stale_conflict |
    # superseded | dismissed  (mirrors the frontend DeltaStatusSchema)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    stale_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Hash of the base this delta was authored against.
    base_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    tree: Mapped["Tree"] = relationship(back_populates="deltas")
