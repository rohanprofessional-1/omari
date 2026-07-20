"""Merge shivank and main migrations

Revision ID: 80dd520bd170
Revises: 005_decision_skip, b2c3d4e5f6a7
Create Date: 2026-07-16 23:13:33.758993

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '80dd520bd170'
down_revision: Union[str, None] = ('005_decision_skip', 'b2c3d4e5f6a7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
