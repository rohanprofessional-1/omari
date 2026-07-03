"""generator tables, workup_spec, tree versioning

Schema v2 (tree-generator build):
- nodes.workup_spec           path-conditioned WorkupSpec JSON (v2)
- trees.status/subspecialty/current_version_id  lifecycle metadata
- tree_versions               IMMUTABLE published snapshots (engine-native JSON)
- conversations.tree_version_id/mode            runtime pins a version
- 9 generator tables          the 3-layer elicitation pipeline's working data

Revision ID: 003_generator
Revises: 775fa6e95917
Create Date: 2026-07-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003_generator'
down_revision: Union[str, None] = '775fa6e95917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps():
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    # --- schema v2: path-conditioned workup on nodes -----------------------
    op.add_column('nodes', sa.Column('workup_spec', sa.JSON(), nullable=True))

    # Backfill: fold existing flat workup_items rows into workup_spec.always.
    op.execute("""
        UPDATE nodes n
        SET workup_spec = sub.spec
        FROM (
            SELECT node_id, tree_id,
                   json_build_object(
                       'always', json_agg(
                           json_build_object(
                               'name', name,
                               'protocol', COALESCE(protocol, ''),
                               'rationale', COALESCE(rationale, '')
                           ) ORDER BY item_order
                       ),
                       'conditional', '[]'::json,
                       'doNotOrderUnless', '[]'::json
                   ) AS spec
            FROM workup_items
            GROUP BY node_id, tree_id
        ) sub
        WHERE n.id = sub.node_id AND n.tree_id = sub.tree_id
    """)

    # --- tree lifecycle + versioning ---------------------------------------
    op.add_column('trees', sa.Column('status', sa.String(length=20), server_default='draft', nullable=False))
    op.add_column('trees', sa.Column('subspecialty', sa.String(length=255), nullable=True))
    op.add_column('trees', sa.Column('current_version_id', sa.String(length=36), nullable=True))

    op.create_table('tree_versions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tree_id', sa.String(length=36), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('tree_json', sa.JSON(), nullable=False),
        sa.Column('validation_summary_json', sa.JSON(), nullable=True),
        sa.Column('signed_by', sa.String(length=255), nullable=True),
        sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('conversations', sa.Column('tree_version_id', sa.String(length=36), nullable=True))
    op.add_column('conversations', sa.Column('mode', sa.String(length=10), nullable=True))
    op.create_foreign_key('fk_conversations_tree_version', 'conversations', 'tree_versions', ['tree_version_id'], ['id'])

    # --- generator working data (3-layer pipeline) --------------------------
    op.create_table('generation_sessions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('clinic_id', sa.String(length=36), nullable=True),
        sa.Column('tree_id', sa.String(length=36), nullable=True),
        sa.Column('subspecialty', sa.String(length=255), nullable=False),
        sa.Column('surgeon_name', sa.String(length=255), nullable=True),
        sa.Column('stage', sa.String(length=20), server_default='setup', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='active', nullable=False),
        sa.Column('roster_json', sa.JSON(), nullable=True),
        sa.Column('draft_tree_json', sa.JSON(), nullable=True),
        sa.Column('validation_summary_json', sa.JSON(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id']),
        sa.ForeignKeyConstraint(['tree_id'], ['trees.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('synthetic_cases',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('clinic_id', sa.String(length=36), nullable=True),
        sa.Column('subspecialty', sa.String(length=255), nullable=False),
        sa.Column('narrative', sa.Text(), nullable=False),
        sa.Column('ground_truth_json', sa.JSON(), nullable=True),
        sa.Column('source', sa.String(length=30), server_default='generated', nullable=False),
        sa.Column('quality_reviewed', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('minimal_pair_of', sa.String(length=36), nullable=True),
        sa.Column('varied_variable', sa.String(length=100), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('case_highlights',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('case_id', sa.String(length=36), nullable=False),
        sa.Column('span_text', sa.Text(), nullable=False),
        sa.Column('span_start', sa.Integer(), nullable=True),
        sa.Column('span_end', sa.Integer(), nullable=True),
        sa.Column('axis', sa.String(length=10), nullable=False),
        sa.Column('mapped_variable_key', sa.String(length=100), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['case_id'], ['synthetic_cases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('candidate_variables',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('axis', sa.String(length=10), nullable=False),
        sa.Column('value_samples_json', sa.JSON(), nullable=True),
        sa.Column('frequency', sa.Integer(), server_default='0', nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('case_decisions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('case_id', sa.String(length=36), nullable=False),
        sa.Column('routed_specialist_name', sa.String(length=255), nullable=True),
        sa.Column('escalated', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('urgency', sa.String(length=20), nullable=True),
        sa.Column('workup_json', sa.JSON(), nullable=True),
        sa.Column('workup_counterfactual', sa.Text(), nullable=True),
        sa.Column('would_not_order_json', sa.JSON(), nullable=True),
        sa.Column('case_variables_json', sa.JSON(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['case_id'], ['synthetic_cases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('induced_rules',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('condition_json', sa.JSON(), nullable=True),
        sa.Column('target_json', sa.JSON(), nullable=True),
        sa.Column('support_case_ids_json', sa.JSON(), nullable=True),
        sa.Column('confidence', sa.Float(), server_default='0', nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('gaps',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=40), nullable=False),
        sa.Column('detail_json', sa.JSON(), nullable=True),
        sa.Column('question', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='open', nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('validation_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=False),
        sa.Column('tree_json', sa.JSON(), nullable=False),
        sa.Column('summary_json', sa.JSON(), nullable=True),
        sa.Column('ran_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['session_id'], ['generation_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table('validation_results',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('run_id', sa.String(length=36), nullable=False),
        sa.Column('case_id', sa.String(length=36), nullable=False),
        sa.Column('expected_json', sa.JSON(), nullable=True),
        sa.Column('engine_json', sa.JSON(), nullable=True),
        sa.Column('routing_match', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('workup_under_order', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('workup_over_order', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['validation_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['case_id'], ['synthetic_cases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('validation_results')
    op.drop_table('validation_runs')
    op.drop_table('gaps')
    op.drop_table('induced_rules')
    op.drop_table('case_decisions')
    op.drop_table('candidate_variables')
    op.drop_table('case_highlights')
    op.drop_table('synthetic_cases')
    op.drop_table('generation_sessions')
    op.drop_constraint('fk_conversations_tree_version', 'conversations', type_='foreignkey')
    op.drop_column('conversations', 'mode')
    op.drop_column('conversations', 'tree_version_id')
    op.drop_table('tree_versions')
    op.drop_column('trees', 'current_version_id')
    op.drop_column('trees', 'subspecialty')
    op.drop_column('trees', 'status')
    op.drop_column('nodes', 'workup_spec')
