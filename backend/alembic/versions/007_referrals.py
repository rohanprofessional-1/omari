"""add referral tables

Revision ID: 007_referrals
Revises: b2c3d4e5f6a7
Create Date: 2026-08-24
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "007_referrals"
down_revision = "006_tree_deltas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "referrals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("clinic_id", sa.String(36), sa.ForeignKey("clinics.id"), nullable=True),
        sa.Column("referral_id", sa.String(100), unique=True, nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("priority", sa.String(20), nullable=False, server_default="routine"),
        sa.Column("patient_name", sa.String(255), nullable=False),
        sa.Column("patient_mrn", sa.String(100), nullable=False),
        sa.Column("patient_dob", sa.String(20), nullable=False),
        sa.Column("patient_sex", sa.String(5), nullable=False),
        sa.Column("patient_phone", sa.String(50), nullable=True),
        sa.Column("referred_by_provider", sa.String(255), nullable=False),
        sa.Column("referred_by_npi", sa.String(20), nullable=True),
        sa.Column("referred_by_practice", sa.String(255), nullable=True),
        sa.Column("referred_by_phone", sa.String(50), nullable=True),
        sa.Column("referred_by_fax", sa.String(50), nullable=True),
        sa.Column("referred_to_department", sa.String(255), nullable=True),
        sa.Column("reason_for_referral", sa.Text, nullable=False),
        sa.Column("clinical_note", sa.Text, nullable=True),
        sa.Column("diagnoses", sa.JSON, nullable=True),
        sa.Column("attachments", sa.JSON, nullable=True),
        sa.Column("structured", sa.JSON, nullable=True),
        sa.Column("extraction_variables", sa.JSON, nullable=True),
        sa.Column("extraction_sources", sa.JSON, nullable=True),
        sa.Column("annotations", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "referral_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("referral_id", sa.String(36), sa.ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("reviewer", sa.String(255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("surgeon_seen", sa.Boolean, server_default="false", nullable=False),
        sa.Column("correction", sa.JSON, nullable=True),
        sa.Column("workup_overrides", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "referral_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("referral_id", sa.String(36), sa.ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(255), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("correction", sa.JSON, nullable=True),
        sa.Column("note", sa.Text, nullable=True),
    )

    # Indexes for common query patterns
    op.create_index("ix_referrals_patient_mrn", "referrals", ["patient_mrn"])
    op.create_index("ix_referrals_clinic_id", "referrals", ["clinic_id"])
    op.create_index("ix_referrals_received_at", "referrals", ["received_at"])
    op.create_index("ix_referral_reviews_referral_id", "referral_reviews", ["referral_id"])
    op.create_index("ix_referral_audit_referral_id", "referral_audit_events", ["referral_id"])


def downgrade() -> None:
    op.drop_table("referral_audit_events")
    op.drop_table("referral_reviews")
    op.drop_table("referrals")
