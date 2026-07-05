import asyncio
import json
import uuid

from app.core.database import async_session_factory
from app.models.branch import Branch
from app.models.clinic import Clinic
from app.models.condition import Condition, ConditionType
from app.models.node import DataSource, Node, NodeType, Urgency
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.models.variable import AnswerType, Variable
from app.models.workup_item import WorkupItem
from sqlalchemy import select

async def import_tree():
    with open('duke_vars.json', 'r') as f:
        vars_data = json.load(f)
    with open('duke_tree.json', 'r') as f:
        tree_data = json.load(f)

    async with async_session_factory() as db:
        clinic = (await db.execute(select(Clinic).limit(1))).scalars().first()
        if not clinic:
            print("No clinic found.")
            return

        # 1. Import Variables
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
        print("Imported variables.")

        # 2. Import Specialists
        for node_data in tree_data["nodes"]:
            if node_data["type"] == "specialist":
                spec_name = node_data.get("specialistName")
                if spec_name:
                    existing_spec = (await db.execute(select(Specialist).where(Specialist.name == spec_name))).scalars().first()
                    if not existing_spec:
                        db.add(Specialist(
                            id=str(uuid.uuid4()),
                            name=spec_name,
                            clinic_id=clinic.id,
                            specialty=node_data.get("specialty", ""),
                            department="Unknown",
                            is_active=True
                        ))
        await db.commit()
        print("Imported specialists.")

        # 3. Create Tree
        tree_id = tree_data["treeId"]
        existing_tree = (await db.execute(select(Tree).where(Tree.id == tree_id))).scalars().first()
        if existing_tree:
            print("Tree already exists. Please clear DB or use a different script to update.")
            return

        tree = Tree(
            id=tree_id,
            clinic_id=clinic.id,
            name="Duke Nerve Center",
            description="Deep clinical routing tree",
            root_node_id=tree_data["rootNodeId"],
            authored_by="Import Script"
        )
        db.add(tree)
        await db.flush()

        # 4. Import Nodes
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

        # 5. Import Branches, Conditions, Workups
        branches_list = []
        conditions_list = []
        workups_list = []
        for i, n in enumerate(tree_data["nodes"]):
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
        print("Successfully imported Duke Tree!")

if __name__ == "__main__":
    asyncio.run(import_tree())
