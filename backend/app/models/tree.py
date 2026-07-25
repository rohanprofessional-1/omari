import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Boolean, ForeignKey, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Tree(Base, TimestampMixin):
    __tablename__ = "trees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # Set after nodes created
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    authored_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Lifecycle: draft (relational rows are live-editable) | published | archived.
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    subspecialty: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Points at the immutable snapshot the runtime should pin (tree_versions.id).
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Delta layer: the last CPG-generated scaffold this tree was compiled from
    # (frontend camelCase Tree shape), and its anchoring metadata
    # ({docId, documentName, subspecialty, sections}). The relational node rows
    # are the COMPILED output = compile(base_tree_json, tree_deltas).
    base_tree_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    base_meta_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    clinic: Mapped["Clinic | None"] = relationship(back_populates="trees")
    nodes: Mapped[list["Node"]] = relationship(back_populates="tree", cascade="all, delete-orphan", lazy="selectin")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="tree", lazy="noload")
    versions: Mapped[list["TreeVersion"]] = relationship(
        back_populates="tree", cascade="all, delete-orphan", lazy="noload",
        order_by="TreeVersion.version_no",
    )
    deltas: Mapped[list["TreeDelta"]] = relationship(
        back_populates="tree", cascade="all, delete-orphan", lazy="noload",
        order_by="TreeDelta.seq",
    )


class TreeVersion(Base, TimestampMixin):
    """IMMUTABLE published snapshot of a tree.

    `tree_json` is the complete tree in the FRONTEND camelCase shape — exactly
    what TreeSchema.parse accepts and the deterministic engine consumes. Never
    updated after creation; runtime and validation pin these rows, which is
    what makes every historical routing decision reproducible and auditable.
    """
    __tablename__ = "tree_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tree_id: Mapped[str] = mapped_column(String(36), ForeignKey("trees.id", ondelete="CASCADE"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    tree_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    validation_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    signed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tree: Mapped["Tree"] = relationship(back_populates="versions")
