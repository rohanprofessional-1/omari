import uuid
import enum
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Text, Integer, Boolean, JSON, Numeric, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, utcnow


class ConversationStatus(str, enum.Enum):
    in_progress = "in_progress"
    routed = "routed"
    escalated = "escalated"
    abandoned = "abandoned"


class OutcomeUrgency(str, enum.Enum):
    routine = "routine"
    expedited = "expedited"
    urgent = "urgent"


class TurnRole(str, enum.Enum):
    patient = "patient"
    assistant = "assistant"


class VariableVia(str, enum.Enum):
    extraction = "extraction"
    answer = "answer"
    confirmation = "confirmation"


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("patients.id"), nullable=True)
    tree_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("trees.id"), nullable=True)
    status: Mapped[ConversationStatus] = mapped_column(
        Enum(ConversationStatus, name="conversation_status_enum"),
        default=ConversationStatus.in_progress,
        nullable=False,
    )
    outcome_specialist_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("specialists.id"), nullable=True)
    outcome_urgency: Mapped[OutcomeUrgency | None] = mapped_column(
        Enum(OutcomeUrgency, name="outcome_urgency_enum"), nullable=True
    )
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    path_taken: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # Array of node IDs
    iterations: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    questions_asked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    confirmations: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    patient: Mapped["Patient | None"] = relationship(back_populates="conversations")
    tree: Mapped["Tree | None"] = relationship(back_populates="conversations")
    outcome_specialist: Mapped["Specialist | None"] = relationship()
    turns: Mapped[list["ConversationTurn"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", lazy="selectin",
        order_by="ConversationTurn.turn_number",
    )
    patient_variables: Mapped[list["PatientVariable"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", lazy="selectin",
    )
    actions: Mapped[list["Action"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", lazy="noload",
    )


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    turn_number: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[TurnRole] = mapped_column(Enum(TurnRole, name="turn_role_enum"), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    variable_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_confirmation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(back_populates="turns")


class PatientVariable(Base):
    __tablename__ = "patient_variables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    variable_key: Mapped[str] = mapped_column(String(100), ForeignKey("variables.key"), nullable=False)
    value_string: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_number: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    value_boolean: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("0.0"), nullable=False)
    via: Mapped[VariableVia] = mapped_column(Enum(VariableVia, name="variable_via_enum"), nullable=False)
    reason_for_clarification: Mapped[str | None] = mapped_column(String(500), nullable=True)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    conversation: Mapped["Conversation"] = relationship(back_populates="patient_variables")
    variable: Mapped["Variable"] = relationship()


class Action(Base):
    __tablename__ = "actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    # Relationships
    conversation: Mapped["Conversation"] = relationship(back_populates="actions")
