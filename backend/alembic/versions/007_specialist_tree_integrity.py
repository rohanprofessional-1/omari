"""007 specialist tree integrity

Revision ID: 007_specialist_tree_integrity
Revises: 80dd520bd170
Create Date: 2026-08-10

Adds three schema changes to tighten specialist–tree data integrity:

  1. clinics.active_tree_id — FK to trees.id (deferred to avoid circular dependency).
  2. nodes.specialist_id   — nullable FK to specialists.id. Populated at tree-save time
                             by matching specialist_name against the specialists table.
  3. tree_specialists      — join table (tree_id, specialist_id). Rebuilt every time a
                             tree is saved so the directory always knows which specialists
                             belong to which tree without scanning all nodes.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "007_specialist_tree_integrity"
down_revision = "250688403409"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add active_tree_id to clinics (deferred FK to break the circular reference
    #    clinics → trees → clinics).
    op.add_column(
        "clinics",
        sa.Column("active_tree_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_clinic_active_tree",
        "clinics",
        "trees",
        ["active_tree_id"],
        ["id"],
        ondelete="SET NULL",
        deferrable=True,
        initially="DEFERRED",
    )

    # 2. Add specialist_id to nodes (nullable, SET NULL on specialist delete so old
    #    trees keep running with the string fallback).
    op.add_column(
        "nodes",
        sa.Column("specialist_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_node_specialist",
        "nodes",
        "specialists",
        ["specialist_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3. Create the tree_specialists join table.
    op.create_table(
        "tree_specialists",
        sa.Column("tree_id", sa.String(36), sa.ForeignKey("trees.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("specialist_id", sa.String(36), sa.ForeignKey("specialists.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("tree_specialists")
    op.drop_constraint("fk_node_specialist", "nodes", type_="foreignkey")
    op.drop_column("nodes", "specialist_id")
    op.drop_constraint("fk_clinic_active_tree", "clinics", type_="foreignkey")
    op.drop_column("clinics", "active_tree_id")
