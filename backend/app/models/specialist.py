import uuid
from sqlalchemy import String, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Specialist(Base, TimestampMixin):
    __tablename__ = "specialists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id"), nullable=True)
    specialty: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    clinic: Mapped["Clinic | None"] = relationship(back_populates="specialists")
    tree_specialists: Mapped[list["TreeSpecialist"]] = relationship(
        back_populates="specialist", cascade="all, delete-orphan", lazy="noload"
    )
