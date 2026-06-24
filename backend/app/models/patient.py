import uuid
from datetime import date
from sqlalchemy import String, Text, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Patient(Base, TimestampMixin):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id"), nullable=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=False)
    last_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mrn: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    referring_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    referral_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    referral_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    clinic: Mapped["Clinic | None"] = relationship(back_populates="patients")
    clinic_associations: Mapped[list["PatientClinic"]] = relationship(back_populates="patient", cascade="all, delete-orphan", lazy="selectin")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="patient", lazy="noload")


class PatientClinic(Base):
    """Junction table for many-to-many Patient <-> Clinic relationship."""
    __tablename__ = "patient_clinics"

    patient_id: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id", ondelete="CASCADE"), primary_key=True)
    clinic_id: Mapped[str] = mapped_column(String(36), ForeignKey("clinics.id", ondelete="CASCADE"), primary_key=True)

    # Relationships
    patient: Mapped["Patient"] = relationship(back_populates="clinic_associations")
    clinic: Mapped["Clinic"] = relationship()
