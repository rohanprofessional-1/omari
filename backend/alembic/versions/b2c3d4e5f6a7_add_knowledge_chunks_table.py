"""add_knowledge_chunks_table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-08 03:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable the pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # Create the table without the embedding column first
    op.create_table('knowledge_chunks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('clinic_id', sa.String(length=36), nullable=True),
        sa.Column('filename', sa.String(length=500), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('matched_terms', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Add the embedding column via raw SQL (Alembic doesn't handle pgvector types natively)
    op.execute('ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(1024) NOT NULL')

    # Create an HNSW index for fast cosine similarity search
    op.execute(
        'CREATE INDEX ix_knowledge_chunks_embedding ON knowledge_chunks '
        'USING hnsw (embedding vector_cosine_ops)'
    )

    # Index for filtering by tree_id (common query pattern)
    op.create_index('ix_knowledge_chunks_tree_id', 'knowledge_chunks', ['tree_id'])


def downgrade() -> None:
    op.drop_index('ix_knowledge_chunks_tree_id', table_name='knowledge_chunks')
    op.drop_index('ix_knowledge_chunks_embedding', table_name='knowledge_chunks')
    op.drop_table('knowledge_chunks')
    # Note: we don't drop the vector extension since other things might use it
