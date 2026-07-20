"""Blume — generator working data (the 3 elicitation layers).

The generator is a pipeline over these tables: Layer 1 (highlights →
candidate variables), Layer 2 (case decisions → induced rules), Layer 3
(assembly → gaps → validation). Each stage reads the previous stage's rows
and writes its own; the pipeline culminates in a draft tree_json plus a
two-axis validation summary. All heavy JSON blobs use the frontend camelCase
shapes — the Zod schemas in frontend/src/types + src/lib/generator are the
canonical validators; these tables are the system of record.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Boolean, Float, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, utcnow


class GenerationSession(Base, TimestampMixin):
    __tablename__ = "generation_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id"), nullable=True)
    tree_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("trees.id"), nullable=True)
    subspecialty: Mapped[str] = mapped_column(String(255), nullable=False)
    surgeon_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # stage: setup | highlight | decide | induce | assemble | gaps | validate | done
    stage: Mapped[str] = mapped_column(String(20), default="setup", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)  # active | completed | abandoned
    # The specialist roster the surgeon routes to in Layer 2 (leaf candidates):
    # [{ name, specialty, focus }] — captured at session start.
    roster_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # The assembled draft tree (frontend camelCase Tree shape), updated by /assemble.
    draft_tree_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Latest two-axis validation summary, updated by /validate.
    validation_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    highlights: Mapped[list["CaseHighlight"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")
    candidate_variables: Mapped[list["CandidateVariable"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")
    decisions: Mapped[list["CaseDecision"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")
    induced_rules: Mapped[list["InducedRule"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")
    gaps: Mapped[list["Gap"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")
    validation_runs: Mapped[list["ValidationRun"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="noload")


class SyntheticCase(Base, TimestampMixin):
    """Layer 1 input: a rich, messy, clinically-realistic patient narrative
    with ground-truth variables baked in. clinic_id NULL = shared library
    (template cases usable by any clinic)."""
    __tablename__ = "synthetic_cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    clinic_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clinics.id"), nullable=True)
    subspecialty: Mapped[str] = mapped_column(String(255), nullable=False)
    narrative: Mapped[str] = mapped_column(Text, nullable=False)
    # { variableKey: value } — what the case author planted in the narrative.
    ground_truth_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(30), default="generated", nullable=False)  # generated | hand_authored | real_deidentified
    quality_reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Minimal-pair bookkeeping: the case this one was derived from, and which
    # variable was flipped (drives Layer 2's discriminator detection).
    minimal_pair_of: Mapped[str | None] = mapped_column(String(36), nullable=True)
    varied_variable: Mapped[str | None] = mapped_column(String(100), nullable=True)


class CaseHighlight(Base, TimestampMixin):
    """Layer 1 output: one highlighted span, tagged along the two axes."""
    __tablename__ = "case_highlights"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("synthetic_cases.id", ondelete="CASCADE"), nullable=False)
    span_text: Mapped[str] = mapped_column(Text, nullable=False)
    span_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    span_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    axis: Mapped[str] = mapped_column(String(10), nullable=False)  # routing | workup | both
    # LEGACY (pre-decomposition): the first mapped variable. Kept in sync with
    # observations_json[0].key for backward compatibility.
    mapped_variable_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # The atomic unit: one highlight owns MANY variable observations —
    # [{ key, label?, value, spanText, spanStart?, spanEnd?, axis, source, confidence? }].
    # source: ground_truth | llm | fallback. The surgeon curates these (chips);
    # nothing enters the tally without being visible and removable.
    observations_json: Mapped[list | None] = mapped_column(JSON, nullable=True)

    session: Mapped["GenerationSession"] = relationship(back_populates="highlights")


class CandidateVariable(Base, TimestampMixin):
    """Layer 1 accumulator output: a frequency-ranked candidate variable."""
    __tablename__ = "candidate_variables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    axis: Mapped[str] = mapped_column(String(10), nullable=False)  # routing | workup | both
    value_samples_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    frequency: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    session: Mapped["GenerationSession"] = relationship(back_populates="candidate_variables")


class CaseDecision(Base, TimestampMixin):
    """Layer 2 output: the surgeon's TWO coupled decisions on one case —
    where the patient goes AND what must be done before they arrive."""
    __tablename__ = "case_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("synthetic_cases.id", ondelete="CASCADE"), nullable=False)
    # Routing axis: a roster specialist name, or NULL + escalated=True.
    routed_specialist_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Skip-with-reason: the case was handled but NOT clinically decided.
    # Skipped rows are excluded from induction/validation (joinDecidedCases).
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    skip_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    urgency: Mapped[str | None] = mapped_column(String(20), nullable=True)  # routine | expedited | urgent
    # Workup axis: [{ name, protocol?, rationale? }].
    workup_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # "And if they showed up without it?" — the value logic behind the workup.
    workup_counterfactual: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Tests the surgeon deliberately would NOT order here (over-ordering guards).
    would_not_order_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # The variables the surgeon says drove this decision (their own read of the case).
    case_variables_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    session: Mapped["GenerationSession"] = relationship(back_populates="decisions")


class InducedRule(Base, TimestampMixin):
    """Layer 2 induction output: one routing branch or workup rule, with the
    supporting cases and a confidence proportional to its evidence."""
    __tablename__ = "induced_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # routing_branch | workup_rule | workup_guard
    condition_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    target_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    support_case_ids_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    session: Mapped["GenerationSession"] = relationship(back_populates="induced_rules")


class Gap(Base, TimestampMixin):
    """Layer 3 gap-detection output. kinds: routing_coverage | workup_coverage
    | undifferentiated_specialists | over_ordering | thin_evidence | dead_end."""
    __tablename__ = "gaps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    detail_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # The plain-language question shown to the surgeon (LLM-phrased or template).
    question: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)  # open | resolved | dismissed

    session: Mapped["GenerationSession"] = relationship(back_populates="gaps")


class ValidationRun(Base, TimestampMixin):
    """Layer 3 validation: one scoring pass of a draft tree against the
    surgeon's recorded case decisions, using the REAL engine."""
    __tablename__ = "validation_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("generation_sessions.id", ondelete="CASCADE"), nullable=False)
    tree_json: Mapped[dict] = mapped_column(JSON, nullable=False)  # the exact draft that was scored
    # Two-axis metric: routing accuracy + under/over-order rates, NEVER collapsed.
    summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    session: Mapped["GenerationSession"] = relationship(back_populates="validation_runs")
    results: Mapped[list["ValidationResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin")


class ValidationResult(Base):
    """Per-case agree/disagree detail for one validation run."""
    __tablename__ = "validation_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("synthetic_cases.id", ondelete="CASCADE"), nullable=False)
    expected_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # the surgeon's decision
    engine_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # what the engine did
    routing_match: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    workup_under_order: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    workup_over_order: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    run: Mapped["ValidationRun"] = relationship(back_populates="results")
