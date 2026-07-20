"""add_variable_knowledge_fields

Revision ID: a1b2c3d4e5f6
Revises: 775fa6e95917
Create Date: 2026-07-08 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '775fa6e95917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('variables', sa.Column('synonyms', sa.JSON(), nullable=True))
    op.add_column('variables', sa.Column('patient_examples', sa.JSON(), nullable=True))
    op.add_column('variables', sa.Column('clinical_mappings', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('variables', 'clinical_mappings')
    op.drop_column('variables', 'patient_examples')
    op.drop_column('variables', 'synonyms')
