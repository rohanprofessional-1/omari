import asyncio
import json
import os
from pathlib import Path
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_factory
from app.models.tree import Tree
from app.models.variable import Variable

DATA_DIR = Path(__file__).parent.parent / "app" / "data"

def default_serializer(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, set):
        return list(obj)
    raise TypeError(f"Type {type(obj)} not serializable")

async def export_seeds():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    async with async_session_factory() as db:
        # 1. Export Variables
        vars_result = await db.execute(select(Variable))
        variables = vars_result.scalars().all()
        
        vars_data = {}
        for v in variables:
            vars_data[v.key] = {
                "clinicalPrompt": v.clinical_prompt,
                "patientQuestion": v.patient_question,
                "answerType": v.answer_type.value if v.answer_type else "single_choice",
                "options": v.options_json,
                "extractionHints": v.extraction_hints
            }
            
        with open(DATA_DIR / "variables.json", "w") as f:
            json.dump(vars_data, f, indent=2, default=default_serializer)
        print(f"Exported {len(variables)} variables to variables.json")

        # 2. Export Trees
        # We export all active trees
        trees_result = await db.execute(
            select(Tree)
            .where(Tree.is_active == True)
            .options(
                selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches")).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches").property.mapper.class_.condition),
                selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "workup_items")),
            )
        )
        trees = trees_result.scalars().all()
        
        for tree in trees:
            tree_data = {
                "treeId": tree.id,
                "name": tree.name,
                "description": tree.description,
                "rootNodeId": tree.root_node_id,
                "nodes": []
            }
            
            for node in tree.nodes:
                n = {
                    "id": node.id,
                    "type": node.node_type.value if node.node_type else "variable",
                }
                
                if node.node_type.value == "variable":
                    n["variableKey"] = node.variable_key
                    n["prompt"] = node.prompt
                    if node.data_source: n["dataSource"] = node.data_source.value
                elif node.node_type.value == "specialist":
                    n["specialistName"] = node.specialist_name
                    n["specialty"] = node.specialty
                    if node.urgency: n["urgency"] = node.urgency.value
                    n["reasoningTemplate"] = node.reasoning_template
                    n["clinicalBasis"] = node.clinical_basis
                    n["confirmWithDrLi"] = node.confirm_with_dr_li
                elif node.node_type.value == "escalation":
                    n["reason"] = node.escalation_reason
                    
                if node.branches:
                    n["branches"] = []
                    # sort branches by order
                    sorted_branches = sorted(node.branches, key=lambda x: x.branch_order)
                    for b in sorted_branches:
                        branch_data = {
                            "label": b.label,
                            "patientLabel": b.patient_label,
                            "nextNodeId": b.next_node_id,
                        }
                        if b.condition:
                            c = b.condition
                            c_data = {"op": c.condition_type.value if c.condition_type else "equals"}
                            if c.condition_type.value == "equals":
                                # Try to preserve type if it looks like a number/bool, but mostly it's string
                                if c.value_string == "true": c_data["value"] = True
                                elif c.value_string == "false": c_data["value"] = False
                                else: c_data["value"] = c.value_string
                            elif c.condition_type.value == "in" and c.values_list:
                                c_data["values"] = json.loads(c.values_list)
                            elif c.condition_type.value == "range":
                                if c.min_value is not None: c_data["min"] = float(c.min_value)
                                if c.max_value is not None: c_data["max"] = float(c.max_value)
                            branch_data["condition"] = c_data
                        n["branches"].append(branch_data)
                        
                if node.workup_items:
                    n["workup"] = []
                    sorted_workups = sorted(node.workup_items, key=lambda x: x.item_order)
                    for w in sorted_workups:
                        n["workup"].append({
                            "name": w.name,
                            "protocol": w.protocol,
                            "rationale": w.rationale
                        })
                        
                tree_data["nodes"].append(n)
                
            # Use safe filename
            filename = f"{tree.id}.json".replace("/", "_")
            with open(DATA_DIR / filename, "w") as f:
                json.dump(tree_data, f, indent=2, default=default_serializer)
            print(f"Exported tree {tree.id} to {filename}")
            
if __name__ == "__main__":
    asyncio.run(export_seeds())
