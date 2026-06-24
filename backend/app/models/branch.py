import uuid
from sqlalchemy import String, Text, Integer, ForeignKey, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id: Mapped[str] = mapped_column(String(36), nullable=False)
    tree_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[str] = mapped_column(String(500), nullable=False)
    patient_label: Mapped[str | None] = mapped_column(String(500), nullable=True)
    next_node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    branch_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["node_id", "tree_id"],
            ["nodes.id", "nodes.tree_id"],
            ondelete="CASCADE",
        ),
    )

    # Relationships
    node: Mapped["Node"] = relationship(back_populates="branches", foreign_keys=[node_id, tree_id])
    condition: Mapped["Condition | None"] = relationship(
        back_populates="branch",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
