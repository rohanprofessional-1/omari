"""highlight observations: one highlight → many variable observations

Adds case_highlights.observations_json and backfills each existing highlight
with a single observation derived from its legacy mapped_variable_key, so the
old 1-to-1 rows read identically under the new 1-to-N model.

Revision ID: 004_highlight_obs
Revises: 003_generator
Create Date: 2026-07-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '004_highlight_obs'
down_revision: Union[str, None] = '003_generator'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('case_highlights', sa.Column('observations_json', sa.JSON(), nullable=True))
    # Backfill: legacy single mapping → one-element observation array.
    op.execute("""
        UPDATE case_highlights
        SET observations_json = json_build_array(
            json_build_object(
                'key', mapped_variable_key,
                'value', span_text,
                'spanText', span_text,
                'axis', axis,
                'source', 'ground_truth'
            )
        )
        WHERE mapped_variable_key IS NOT NULL AND observations_json IS NULL
    """)


def downgrade() -> None:
    op.drop_column('case_highlights', 'observations_json')
