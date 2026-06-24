import uuid
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Clinic(Base, TimestampMixin):
    __tablename__ = "clinics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    knowledge_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    group: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Relationships
    trees: Mapped[list["Tree"]] = relationship(back_populates="clinic", lazy="selectin")
    specialists: Mapped[list["Specialist"]] = relationship(back_populates="clinic", lazy="selectin")
    patients: Mapped[list["Patient"]] = relationship(back_populates="clinic", lazy="selectin")
