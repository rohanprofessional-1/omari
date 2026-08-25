"""Seed a demo clinic and trees for local development."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.branch import Branch
from app.models.clinic import Clinic
from app.models.condition import Condition, ConditionType
from app.models.node import DataSource, Node, NodeType, Urgency
from app.models.referral import Referral
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.models.variable import AnswerType, Variable
from app.models.workup_item import WorkupItem

DATA_DIR = Path(__file__).parent.parent / "app" / "data"

async def import_tree_from_json(db, clinic_id, tree_json_path, vars_json_path=None):
    if vars_json_path and os.path.exists(vars_json_path):
        with open(vars_json_path, 'r') as f:
            vars_data = json.load(f)
        for key, vdata in vars_data.items():
            existing_var = (await db.execute(select(Variable).where(Variable.key == key))).scalars().first()
            if not existing_var:
                new_var = Variable(
                    key=key,
                    clinical_prompt=vdata.get("clinicalPrompt"),
                    patient_question=vdata.get("patientQuestion", "No question specified"),
                    answer_type=AnswerType(vdata.get("answerType", "single_choice")),
                    options_json=vdata.get("options", []),
                    extraction_hints=vdata.get("extractionHints")
                )
                db.add(new_var)
        await db.commit()

    if not os.path.exists(tree_json_path):
        return

    with open(tree_json_path, 'r') as f:
        tree_data = json.load(f)
        
    tree_id = tree_data["treeId"]
    existing_tree = (await db.execute(select(Tree).where(Tree.id == tree_id))).scalars().first()
    if existing_tree:
        return # Already seeded

    # Import Specialists
    for node_data in tree_data["nodes"]:
        if node_data["type"] == "specialist":
            spec_name = node_data.get("specialistName")
            if spec_name:
                existing_spec = (await db.execute(select(Specialist).where(Specialist.name == spec_name))).scalars().first()
                if not existing_spec:
                    db.add(Specialist(
                        id=str(uuid.uuid4()),
                        name=spec_name,
                        clinic_id=clinic_id,
                        specialty=node_data.get("specialty", ""),
                        department="Unknown",
                        is_active=True
                    ))
    await db.commit()

    # Create Tree
    tree = Tree(
        id=tree_id,
        clinic_id=clinic_id,
        name=tree_id.replace('-', ' ').title(),
        description="Demo routing tree",
        root_node_id=tree_data["rootNodeId"],
        authored_by="Omari demo seed"
    )
    db.add(tree)
    await db.flush()

    # Import Nodes
    node_records = []
    for n in tree_data["nodes"]:
        node_type = NodeType.variable
        if n["type"] == "specialist": node_type = NodeType.specialist
        elif n["type"] == "escalation": node_type = NodeType.escalation

        node = Node(
            id=n["id"],
            tree_id=tree.id,
            node_type=node_type,
            variable_key=n.get("variableKey"),
            prompt=n.get("prompt"),
            data_source=DataSource(n.get("dataSource")) if n.get("dataSource") else None,
            specialist_name=n.get("specialistName"),
            specialty=n.get("specialty"),
            urgency=Urgency(n.get("urgency")) if n.get("urgency") else None,
            reasoning_template=n.get("reasoningTemplate"),
            clinical_basis=n.get("clinicalBasis"),
            confirm_with_dr_li=n.get("confirmWithDrLi", False),
            escalation_reason=n.get("reason")
        )
        node_records.append(node)
    db.add_all(node_records)
    await db.flush()

    # Import Branches, Conditions, Workups
    branches_list = []
    conditions_list = []
    workups_list = []
    for n in tree_data["nodes"]:
        if "branches" in n:
            for b_idx, b in enumerate(n["branches"]):
                branch_id = str(uuid.uuid4())
                branch = Branch(
                    id=branch_id,
                    node_id=n["id"],
                    tree_id=tree.id,
                    label=b.get("label", ""),
                    patient_label=b.get("patientLabel"),
                    next_node_id=b.get("nextNodeId"),
                    branch_order=b_idx
                )
                branches_list.append(branch)

                c = b.get("condition")
                if c:
                    c_type = ConditionType.equals
                    if c["op"] == "range": c_type = ConditionType.range
                    elif c["op"] == "in": c_type = ConditionType.in_

                    val_str = None
                    if c.get("value") is not None:
                        val_str = str(c["value"])

                    cond = Condition(
                        branch_id=branch_id,
                        condition_type=c_type,
                        value_string=val_str,
                        values_list=json.dumps(c.get("values", [])) if "values" in c else None,
                        min_value=c.get("min"),
                        max_value=c.get("max")
                    )
                    conditions_list.append(cond)

        if "workup" in n:
            for w_idx, w in enumerate(n["workup"]):
                workups_list.append(WorkupItem(
                    node_id=n["id"],
                    tree_id=tree.id,
                    name=w["name"],
                    protocol=w.get("protocol"),
                    rationale=w.get("rationale"),
                    item_order=w_idx
                ))

    db.add_all(branches_list)
    await db.flush()
    db.add_all(conditions_list)
    db.add_all(workups_list)
    await db.commit()

async def seed() -> None:
    async with async_session_factory() as db:
        print("Starting seed...")
        clinic_result = await db.execute(select(Clinic).limit(1))
        clinic = clinic_result.scalars().first()
        if not clinic:
            clinic = Clinic(
                id="duke-nerve-center",
                name="Demo Clinic",
                type="Neurology",
            )
            db.add(clinic)
            await db.commit()

        # Iterate over all json files in data dir
        vars_path = DATA_DIR / "variables.json"

        for file_path in DATA_DIR.glob("*.json"):
            if file_path.name == "variables.json":
                continue
            # Try to load as a tree
            try:
                await import_tree_from_json(db, clinic.id, file_path, vars_path)
                print(f"Imported tree from {file_path.name}")
            except Exception as e:
                print(f"Skipping {file_path.name}: {e}")
                
        # Seed referrals
        existing_referral = (await db.execute(select(Referral).limit(1))).scalars().first()
        if not existing_referral:
            from datetime import datetime
            r1 = Referral(
                id=str(uuid.uuid4()),
                referral_id="REF-2026-9281",
                clinic_id=clinic.id,
                received_at=datetime.now(),
                channel="epic",
                patient_name="Marla Testfield",
                patient_mrn="MRN-4839201",
                patient_dob="1975-04-12",
                patient_sex="F",
                patient_phone="555-0102",
                referred_by_provider="Self-referred (Omari AI)",
                referred_by_npi="",
                referred_by_practice="Omari Virtual Intake",
                referred_by_phone="",
                referred_to_department="Hand Surgery",
                priority="routine",
                reason_for_referral="Hand pain and numbness",
                clinical_note="",
                diagnoses=[],
                attachments=[],
                structured={},
                extraction_variables={
                    "chiefComplaint": {"value": "carpal_tunnel_symptoms", "confidence": 0.95},
                    "duration": {"value": "months", "confidence": 0.9},
                },
                extraction_sources={
                    "chiefComplaint": "patient-stated",
                    "duration": "patient-stated"
                }
            )
            
            r2 = Referral(
                id=str(uuid.uuid4()),
                referral_id="REF-2026-3392",
                clinic_id=clinic.id,
                received_at=datetime.now(),
                channel="epic",
                patient_name="James Wilson",
                patient_mrn="MRN-8472910",
                patient_dob="1982-11-23",
                patient_sex="M",
                patient_phone="555-0992",
                referred_by_provider="Dr. Gregory House",
                referred_by_npi="1234567890",
                referred_by_practice="Princeton Plainsboro",
                referred_by_phone="555-1234",
                referred_to_department="Hand Surgery",
                priority="urgent",
                reason_for_referral="Traumatic hand injury",
                clinical_note="",
                diagnoses=[],
                attachments=[],
                structured={},
                extraction_variables={
                    "chiefComplaint": {"value": "acute_injury", "confidence": 0.99}
                },
                extraction_sources={
                    "chiefComplaint": "referrer-stated"
                }
            )
            
            db.add_all([r1, r2])
            await db.commit()
            print("Imported seed referrals.")
                
        print("Seed complete.")

if __name__ == "__main__":
    asyncio.run(seed())
