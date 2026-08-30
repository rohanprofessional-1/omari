from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class TreeSpecialist(Base, TimestampMixin):
    """Join table linking a tree to the specialists that appear in its routing nodes.

    Populated (and fully rebuilt) every time a tree is saved via the full-create or
    full-update endpoints. Can also be managed manually via the API when the tree's
    node names don't exactly match the specialists table.

    The composite PK guarantees a specialist appears at most once per tree.
    """
    __tablename__ = "tree_specialists"

    tree_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True
    )
    specialist_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("specialists.id", ondelete="CASCADE"), primary_key=True
    )

    # Relationships (lazy to avoid N+1 when loading the join table en-masse)
    tree: Mapped["Tree"] = relationship(back_populates="tree_specialists", lazy="noload")
    specialist: Mapped["Specialist"] = relationship(back_populates="tree_specialists", lazy="noload")
