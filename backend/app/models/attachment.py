import uuid
from sqlalchemy import String, Integer, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin

class Attachment(Base, TimestampMixin):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    referral_id: Mapped[str] = mapped_column(String(36), ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False) # emg, note, imaging, labs
    date: Mapped[str | None] = mapped_column(String(20), nullable=True) # ISO date string
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Relationships
    referral: Mapped["Referral"] = relationship(back_populates="attachments")
