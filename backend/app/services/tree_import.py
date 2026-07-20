import json
import uuid
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.models.branch import Branch
from app.models.clinic import Clinic
from app.models.condition import Condition, ConditionType
from app.models.node import DataSource, Node, NodeType, Urgency
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.models.variable import AnswerType, Variable
from app.models.workup_item import WorkupItem

async def import_tree_from_json(db: AsyncSession, clinic_id: str, tree_data: Dict[str, Any], vars_data: Optional[Dict[str, Any]] = None) -> Tree:
    """
    Imports a full nested tree structure from JSON, upserting the Tree and completely
    replacing its nested children (Nodes, Branches, Conditions, Workups) to avoid conflicts.
    """
    if vars_data:
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
        await db.flush()

    tree_id = tree_data["treeId"]
    
    # Pre-emptively create specialists found in the tree
    for node_data in tree_data.get("nodes", []):
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
    await db.flush()

    # Handle Tree Upsert
    existing_tree = (await db.execute(
        select(Tree).where(Tree.id == tree_id).options(selectinload(Tree.nodes))
    )).scalars().first()

    if existing_tree:
        # Wipe nested entities. We execute a delete on nodes which cascades to branches and workups.
        await db.execute(delete(Node).where(Node.tree_id == tree_id))
        
        existing_tree.name = tree_data.get("name") or existing_tree.name
        existing_tree.description = tree_data.get("description") or existing_tree.description
        existing_tree.root_node_id = tree_data.get("rootNodeId")
        tree = existing_tree
    else:
        tree = Tree(
            id=tree_id,
            clinic_id=clinic_id,
            name=tree_data.get("name", tree_id.replace('-', ' ').title()),
            description=tree_data.get("description", "Imported routing tree"),
            root_node_id=tree_data.get("rootNodeId"),
            authored_by="Omari import"
        )
        db.add(tree)
    await db.flush()

    # Import Nodes
    node_records = []
    for n in tree_data.get("nodes", []):
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
    
    if node_records:
        db.add_all(node_records)
    await db.flush()

    # Import Branches, Conditions, Workups
    branches_list = []
    conditions_list = []
    workups_list = []
    for n in tree_data.get("nodes", []):
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

    if branches_list: db.add_all(branches_list)
    await db.flush()
    if conditions_list: db.add_all(conditions_list)
    if workups_list: db.add_all(workups_list)

    await db.commit()
    await db.refresh(tree)
    return tree
