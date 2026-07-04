import uuid
import enum
from sqlalchemy import String, Text, Numeric, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin
from decimal import Decimal


class ConditionType(str, enum.Enum):
    equals = "equals"
    range = "range"
    in_ = "in"  # 'in' is a reserved word in Python


class Condition(Base, TimestampMixin):
    __tablename__ = "conditions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str] = mapped_column(String(36), ForeignKey("branches.id", ondelete="CASCADE"), unique=True, nullable=False)
    condition_type: Mapped[ConditionType] = mapped_column(
        Enum(ConditionType, name="condition_type_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    value_string: Mapped[str | None] = mapped_column(String(500), nullable=True)
    values_list: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON-encoded list for 'in'
    min_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    max_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Relationships
    branch: Mapped["Branch"] = relationship(back_populates="condition")
