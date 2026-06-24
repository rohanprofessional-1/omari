import uuid
from sqlalchemy import String, Text, Integer, Boolean, ForeignKey
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

    # Relationships
    clinic: Mapped["Clinic | None"] = relationship(back_populates="trees")
    nodes: Mapped[list["Node"]] = relationship(back_populates="tree", cascade="all, delete-orphan", lazy="selectin")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="tree", lazy="noload")
