"""Seed a demo clinic and a small tree for local development."""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.branch import Branch
from app.models.clinic import Clinic
from app.models.condition import Condition, ConditionType
from app.models.node import DataSource, Node, NodeType, Urgency
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.models.variable import AnswerType, Variable
from app.models.workup_item import WorkupItem


async def seed() -> None:
    async with async_session_factory() as db:
        print("Starting seed...")

        clinic_result = await db.execute(select(Clinic).limit(1))
        clinic = clinic_result.scalars().first()
        if not clinic:
            clinic = Clinic(
                id=str(uuid.uuid4()),
                name="Demo Clinic",
                type="Neurology",
            )
            db.add(clinic)

        tree_result = await db.execute(select(Tree).limit(1))
        tree = tree_result.scalars().first()
        if not tree:
            tree = Tree(
                id="blume-peripheral-nerve-v1",
                clinic_id=clinic.id,
                name="Peripheral Nerve Triage",
                description="Demo routing tree for upper-limb nerve symptoms, masses, and escalation.",
                root_node_id="node_presentation",
                authored_by="Omari demo seed",
            )
            db.add(tree)

            variable = Variable(
                key="presentationType",
                clinical_prompt="Classify the problem as a mass, acute trauma, typical nerve symptoms, or uncertain.",
                patient_question="Which of these best describes the main issue you're having right now?",
                answer_type=AnswerType.single_choice,
                options_json=["mass_lump", "acute_trauma", "typical_nerve_symptoms", "unsure"],
                extraction_hints="Use the patient's own wording when possible.",
            )
            db.add(variable)

            specialist = Specialist(
                id=str(uuid.uuid4()),
                name="Dr. Chen",
                clinic_id=clinic.id,
                specialty="Hand and Peripheral Nerve Surgery",
                department="Hand Surgery",
                notes="Demo specialist for knowledge-base ingestion and routing previews.",
                is_active=True,
            )
            db.add(specialist)

            root = Node(
                id="node_presentation",
                tree_id=tree.id,
                node_type=NodeType.variable,
                variable_key="presentationType",
                prompt="Before nerve triage, screen for red flags: a mass, an acute injury, or typical nerve symptoms.",
                data_source=DataSource.patient,
            )
            specialist_node = Node(
                id="node_spec_chen",
                tree_id=tree.id,
                node_type=NodeType.specialist,
                specialist_name="Dr. Chen",
                specialty="Hand and Peripheral Nerve Surgery",
                urgency=Urgency.routine,
                reasoning_template="Demo routing endpoint for peripheral nerve and hand-related intake.",
                clinical_basis="Upper-limb compression neuropathy patterns and workup.",
            )
            escalation_node = Node(
                id="node_esc_ambiguous",
                tree_id=tree.id,
                node_type=NodeType.escalation,
                escalation_reason="Ambiguous presentation that needs human review.",
            )
            db.add_all([root, specialist_node, escalation_node])

            branch_symptoms = Branch(
                id=str(uuid.uuid4()),
                node_id=root.id,
                tree_id=tree.id,
                label="Typical ongoing nerve symptoms",
                patient_label="Numbness, tingling, or shooting pain",
                next_node_id=specialist_node.id,
                branch_order=0,
            )
            branch_ambiguous = Branch(
                id=str(uuid.uuid4()),
                node_id=root.id,
                tree_id=tree.id,
                label="Unclear / cannot be classified",
                patient_label="I'm not sure",
                next_node_id=escalation_node.id,
                branch_order=1,
            )
            branches = [branch_symptoms, branch_ambiguous]
            db.add_all(branches)

            db.add_all(
                [
                    Condition(
                        branch_id=branch_symptoms.id,
                        condition_type=ConditionType.equals,
                        value_string="typical_nerve_symptoms",
                    ),
                    Condition(
                        branch_id=branch_ambiguous.id,
                        condition_type=ConditionType.equals,
                        value_string="unsure",
                    ),
                    WorkupItem(
                        node_id=specialist_node.id,
                        tree_id=tree.id,
                        name="Nerve conduction studies + needle EMG",
                        protocol="Median and ulnar motor/sensory studies with needle EMG of key hand muscles.",
                        rationale="Helps confirm and localize compression neuropathy.",
                    ),
                ]
            )

        await db.commit()
        print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
