"""008 audit log

Revision ID: 008_audit_log
Revises: 007_specialist_tree_integrity
Create Date: 2026-08-11

Creates the append-only audit_logs table for HIPAA-oriented patient event
tracking. Rows are never updated or deleted — the table is an immutable ledger.

Indexes:
  - ix_audit_logs_patient_id        — primary query pattern (per-patient history)
  - ix_audit_logs_timestamp          — time-range queries
  - ix_audit_logs_patient_action     — filtered queries (e.g. all updates for a patient)
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "008_audit_log"
down_revision = "007_specialist_tree_integrity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "patient_id",
            sa.String(36),
            sa.ForeignKey("patients.id"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_label", sa.String(255), nullable=False, server_default="system"),
        sa.Column(
            "action",
            sa.Enum(
                "patient.created",
                "patient.updated",
                "patient.viewed",
                "patient.deleted",
                "referral.created",
                "referral.status_changed",
                "conversation.started",
                "conversation.routed",
                "conversation.escalated",
                name="audit_action_enum",
            ),
            nullable=False,
        ),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("detail", sa.JSON, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_index("ix_audit_logs_patient_id", "audit_logs", ["patient_id"])
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])
    op.create_index(
        "ix_audit_logs_patient_action", "audit_logs", ["patient_id", "action"]
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_patient_action", table_name="audit_logs")
    op.drop_index("ix_audit_logs_timestamp", table_name="audit_logs")
    op.drop_index("ix_audit_logs_patient_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.execute("DROP TYPE IF EXISTS audit_action_enum")
