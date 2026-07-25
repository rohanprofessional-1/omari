import uuid
import enum
from sqlalchemy import String, Text, Enum, ForeignKey, ForeignKeyConstraint, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class NodeType(str, enum.Enum):
    variable = "variable"
    specialist = "specialist"
    escalation = "escalation"


class DataSource(str, enum.Enum):
    patient = "patient"
    referral = "referral"
    record = "record"


class Urgency(str, enum.Enum):
    routine = "routine"
    expedited = "expedited"
    urgent = "urgent"


class Node(Base, TimestampMixin):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(100), primary_key=True, default=lambda: str(uuid.uuid4()))
    tree_id: Mapped[str] = mapped_column(String(36), ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True)
    node_type: Mapped[NodeType] = mapped_column(Enum(NodeType, name="node_type_enum"), nullable=False)

    # Variable fields
    variable_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_source: Mapped[DataSource | None] = mapped_column(Enum(DataSource, name="data_source_enum"), nullable=True)

    # Specialist fields
    specialist_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    specialty: Mapped[str | None] = mapped_column(String(255), nullable=True)
    urgency: Mapped[Urgency | None] = mapped_column(Enum(Urgency, name="urgency_enum"), nullable=True)
    reasoning_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    clinical_basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirm_with_dr_li: Mapped[bool | None] = mapped_column(nullable=True)
    # Schema v2: path-conditioned workup (WorkupSpec) as JSON —
    # { always: [...], conditional: [...], doNotOrderUnless: [...], escalateWorkupIf? }.
    # The Zod schema on the frontend is the canonical validator for this shape.
    workup_spec: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Escalation fields
    escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    tree: Mapped["Tree"] = relationship(back_populates="nodes")
    branches: Mapped[list["Branch"]] = relationship(
        back_populates="node",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="[Branch.node_id, Branch.tree_id]",
    )
    workup_items: Mapped[list["WorkupItem"]] = relationship(
        back_populates="node",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="[WorkupItem.node_id, WorkupItem.tree_id]",
    )
