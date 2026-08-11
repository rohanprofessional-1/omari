import uuid
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin

class ReferringProvider(Base, TimestampMixin):
    __tablename__ = "referring_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    npi: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
    provider_name: Mapped[str] = mapped_column(String(255), nullable=False)
    practice_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fax: Mapped[str | None] = mapped_column(String(50), nullable=True)
