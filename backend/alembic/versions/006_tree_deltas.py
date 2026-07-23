"""tree deltas: the clinic customization layer

Adds trees.base_tree_json / trees.base_meta_json (the raw CPG scaffold a
tree compiles from, plus anchoring metadata) and the tree_deltas table.
Deltas persist separately from the compiled node rows so they replay when
the CPG base is regenerated; stale ones surface for re-review instead of
being silently dropped.

Revision ID: 006_tree_deltas
Revises: 1f017c30fb61
Create Date: 2026-07-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '006_tree_deltas'
down_revision: Union[str, None] = '1f017c30fb61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trees', sa.Column('base_tree_json', sa.JSON(), nullable=True))
    op.add_column('trees', sa.Column('base_meta_json', sa.JSON(), nullable=True))

    op.create_table(
        'tree_deltas',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('tree_id', sa.String(36), sa.ForeignKey('trees.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('op', sa.String(40), nullable=False),
        sa.Column('payload_json', sa.JSON(), nullable=False),
        sa.Column('expected_json', sa.JSON(), nullable=True),
        sa.Column('provenance_json', sa.JSON(), nullable=False),
        sa.Column('specialist_id', sa.String(36), sa.ForeignKey('specialists.id'), nullable=True),
        sa.Column('status', sa.String(24), nullable=False, server_default='active'),
        sa.Column('stale_reason', sa.String(500), nullable=True),
        sa.Column('base_hash', sa.String(64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_tree_deltas_tree_seq', 'tree_deltas', ['tree_id', 'seq'])


def downgrade() -> None:
    op.drop_index('ix_tree_deltas_tree_seq', table_name='tree_deltas')
    op.drop_table('tree_deltas')
    op.drop_column('trees', 'base_meta_json')
    op.drop_column('trees', 'base_tree_json')
