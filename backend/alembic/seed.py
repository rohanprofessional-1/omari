"""
Seed script to import the demo data into the Postgres database.
Reads the frontend hardcoded variables, sample trees, and specialists.
"""
import asyncio
import json
import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import async_session_factory
from app.models.clinic import Clinic
from app.models.variable import Variable, AnswerType
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.models.node import Node, NodeType, DataSource, Urgency
from app.models.branch import Branch
from app.models.condition import Condition, ConditionType
from app.models.workup_item import WorkupItem

# A stub to import frontend data without TypeScript parser
# For this seed script, since we can't easily parse TS, we'll create the 
# basic Clinic and variables for the boilerplate. In a real scenario, we'd
# parse the JSON or run a script to export the frontend TS files to JSON and load them here.

async def seed():
    async with async_session_factory() as db:
        print("Starting seed...")
        
        # 1. Create a default clinic
        clinic = Clinic(
            id=str(uuid.uuid4()),
            name="Demo Clinic",
            type="Neurology",
        )
        db.add(clinic)
        
        # 2. Add some variables
        vars_data = [
            Variable(
                key="presentationType",
                clinical_prompt="Is the presentation characterized by pain, numbness, weakness, or a combination?",
                patient_question="Which of these best describes the main issue you're having right now?",
                answer_type=AnswerType.single_choice,
                options_json=["Pain", "Numbness / Tingling", "Weakness", "A mix of these"],
                extraction_hints="Extract exactly as stated."
            )
        ]
        db.add_all(vars_data)
        
        await db.commit()
        print("Seed complete.")

if __name__ == "__main__":
    asyncio.run(seed())
