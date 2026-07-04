import uuid
from sqlalchemy import String, Text, Integer, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class WorkupItem(Base, TimestampMixin):
    __tablename__ = "workup_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(String(36), nullable=False)
    tree_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    protocol: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["node_id", "tree_id"],
            ["nodes.id", "nodes.tree_id"],
            ondelete="CASCADE",
        ),
    )

    # Relationships
    node: Mapped["Node"] = relationship(back_populates="workup_items", foreign_keys=[node_id, tree_id])
