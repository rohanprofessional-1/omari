import uuid
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Clinic(Base, TimestampMixin):
    __tablename__ = "clinics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    knowledge_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    group: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The tree currently used for patient intake and routing decisions.
    # Nullable so clinics can exist before any tree is built.
    active_tree_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("trees.id", use_alter=True, name="fk_clinic_active_tree"), nullable=True
    )

    # Relationships
    trees: Mapped[list["Tree"]] = relationship(back_populates="clinic", lazy="selectin", foreign_keys="[Tree.clinic_id]")
    specialists: Mapped[list["Specialist"]] = relationship(back_populates="clinic", lazy="selectin")
    patients: Mapped[list["Patient"]] = relationship(back_populates="clinic", lazy="selectin")
    active_tree: Mapped["Tree | None"] = relationship(foreign_keys="[Clinic.active_tree_id]", lazy="selectin")
