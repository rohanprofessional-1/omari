import uuid
import enum
from sqlalchemy import String, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin

class UserRole(str, enum.Enum):
    admin = "admin"
    surgeon = "surgeon"
    patient = "patient"

class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role_enum"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # If the user is a surgeon, they can be linked to a specialist record
    specialist_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
