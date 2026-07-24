"""add_referrals_table_and_variable_via_enum

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-24 03:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = '80dd520bd170'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add 'referral_document' to the variable_via_enum type.
    # Postgres enums need explicit ALTER TYPE to add new values.
    op.execute("ALTER TYPE variable_via_enum ADD VALUE IF NOT EXISTS 'referral_document'")

    # Create the referrals table
    op.create_table(
        'referrals',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('conversation_id', sa.String(length=36), nullable=False),
        sa.Column('patient_id', sa.String(length=36), nullable=True),
        sa.Column('epic_patient_fhir_id', sa.String(length=255), nullable=True),
        sa.Column('document_reference_id', sa.String(length=255), nullable=True),
        sa.Column('document_url', sa.Text(), nullable=True),
        sa.Column('ccda_raw', sa.Text(), nullable=True),
        sa.Column('sections_json', sa.JSON(), nullable=True),
        sa.Column('extraction_json', sa.JSON(), nullable=True),
        sa.Column('extraction_summary', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('conversation_id'),
    )

    # Indexes for common queries
    op.create_index('ix_referrals_patient_id', 'referrals', ['patient_id'])
    op.create_index('ix_referrals_status', 'referrals', ['status'])


def downgrade() -> None:
    op.drop_index('ix_referrals_status', table_name='referrals')
    op.drop_index('ix_referrals_patient_id', table_name='referrals')
    op.drop_table('referrals')

    # Note: Postgres does not support removing individual enum values from a type.
    # The 'referral_document' value will remain in variable_via_enum after downgrade.
    # To fully revert, you'd need to recreate the enum, which risks data loss.
