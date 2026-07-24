"""SQLAlchemy models — import all models here for Alembic discovery."""
from app.models.base import Base
from app.models.clinic import Clinic
from app.models.tree import Tree, TreeVersion
from app.models.node import Node
from app.models.branch import Branch
from app.models.condition import Condition
from app.models.variable import Variable
from app.models.specialist import Specialist
from app.models.workup_item import WorkupItem
from app.models.patient import Patient, PatientClinic
from app.models.conversation import Conversation, ConversationTurn, PatientVariable, Action
from app.models.referral import Referral
from app.models.generator import (
    GenerationSession,
    SyntheticCase,
    CaseHighlight,
    CandidateVariable,
    CaseDecision,
    InducedRule,
    Gap,
    ValidationRun,
    ValidationResult,
)

__all__ = [
    "Base",
    "Clinic",
    "Tree",
    "TreeVersion",
    "Node",
    "Branch",
    "Condition",
    "Variable",
    "Specialist",
    "WorkupItem",
    "Patient",
    "PatientClinic",
    "Conversation",
    "ConversationTurn",
    "PatientVariable",
    "Action",
    "GenerationSession",
    "SyntheticCase",
    "CaseHighlight",
    "CandidateVariable",
    "CaseDecision",
    "InducedRule",
    "Gap",
    "ValidationRun",
    "ValidationResult",
    "Referral",
]
