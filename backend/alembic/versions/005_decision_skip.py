"""skip-with-reason on case decisions

A skipped case is handled (counts toward session progress) but is NOT a
clinical decision: induction and validation exclude it via the shared
decided-and-not-skipped filter (joinDecidedCases). The reason is signal —
"not my subspecialty" ≠ "too ambiguous".

Revision ID: 005_decision_skip
Revises: 004_highlight_obs
Create Date: 2026-07-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '005_decision_skip'
down_revision: Union[str, None] = '004_highlight_obs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('case_decisions', sa.Column('skipped', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('case_decisions', sa.Column('skip_reason', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('case_decisions', 'skip_reason')
    op.drop_column('case_decisions', 'skipped')
