"""Seed a demo clinic and trees for local development."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import date
from pathlib import Path

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
from app.models.user import User, UserRole
from app.models.patient import Patient
from app.models.referring_provider import ReferringProvider
from app.models.referral import Referral, ReferralChannel, ReferralPriority, ReferralStatus
from app.models.attachment import Attachment

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

        # -----------------------------------------------------------------
        # 1. Clinic — use a STABLE ID that matches the frontend's clinicId.
        # -----------------------------------------------------------------
        CLINIC_ID = "duke-nerve-center"

        clinic = (await db.execute(select(Clinic).where(Clinic.id == CLINIC_ID))).scalars().first()
        if not clinic:
            # Also check for any legacy clinic and remove the random-ID one
            legacy = (await db.execute(select(Clinic).limit(1))).scalars().first()
            if legacy and legacy.id != CLINIC_ID:
                # A prior seed created a random-UUID clinic; reuse it by just
                # proceeding — we won't delete it to avoid FK issues.
                clinic = legacy
            else:
                clinic = Clinic(
                    id=CLINIC_ID,
                    name="Duke Nerve Center",
                    type="Neurology",
                )
                db.add(clinic)
                await db.commit()

        # -----------------------------------------------------------------
        # 2. Import trees + variables from backend/app/data/*.json
        # -----------------------------------------------------------------
        vars_path = DATA_DIR / "variables.json"

        for file_path in DATA_DIR.glob("*.json"):
            if file_path.name == "variables.json":
                continue
            try:
                await import_tree_from_json(db, clinic.id, file_path, vars_path)
                print(f"  Imported tree from {file_path.name}")
            except Exception as e:
                print(f"  Skipping {file_path.name}: {e}")

        # -----------------------------------------------------------------
        # 3. Demo users (mirrors frontend/src/auth/demoUsers.ts)
        # -----------------------------------------------------------------
        demo_users = [
            {"email": "gkancharla@gmail.com", "name": "M. Okafor", "role": UserRole.admin},
            {"email": "n.li@dukenerve.org", "name": "Dr. Neill Li", "role": UserRole.surgeon, "spec_name": "Dr. Neill Li"},
            {"email": "e.saltzman@dukenerve.org", "name": "Dr. Eliana Saltzman", "role": UserRole.surgeon, "spec_name": "Dr. Eliana Saltzman"},
            {"email": "d.bhowmick@dukenerve.org", "name": "Dr. Deb Bhowmick", "role": UserRole.surgeon, "spec_name": "Dr. Deb Bhowmick"},
            {"email": "marla.testfield@example.com", "name": "Marla Testfield", "role": UserRole.patient},
            {"email": "surgeon@omari.com", "name": "Dr. Omari Surgeon", "role": UserRole.surgeon},
        ]

        for u in demo_users:
            existing_user = (await db.execute(select(User).where(User.email == u["email"]))).scalars().first()
            if not existing_user:
                spec_id = None
                if "spec_name" in u:
                    spec = (await db.execute(select(Specialist).where(Specialist.name == u["spec_name"]))).scalars().first()
                    if spec:
                        spec_id = spec.id

                db.add(User(
                    id=str(uuid.uuid4()),
                    email=u["email"],
                    hashed_password="omari",
                    role=u["role"],
                    name=u["name"],
                    specialist_id=spec_id,
                ))
        await db.commit()

        # -----------------------------------------------------------------
        # 4. Seed demo referrals (patient + provider + referral rows)
        #    These showcase the PCP → Omari → Specialist → Patient flow.
        # -----------------------------------------------------------------
        await _seed_demo_referrals(db, clinic.id)

        print("Seed complete.")


async def _seed_demo_referrals(db, clinic_id: str) -> None:
    """Seed 5 demo referrals with proper patient/provider/specialist linkage.

    1. Marla Testfield — clean CTS → Dr. Saltzman (matches demo patient)
    2. Robert Nulligan — ulnar, missing EMG → incomplete (needs more info)
    3. James Whitford — brachial plexus → Dr. Neill Li (surgeon queue)
    4. Angela Vasquez — acute trauma → escalated (red flag path)
    5. Diane Chowdhury — cubital tunnel → Dr. Saltzman (second in queue)
    """
    existing = (await db.execute(select(Referral).limit(1))).scalars().first()
    if existing:
        print("  Referrals already seeded, skipping.")
        return

    # Resolve specialists and tree once
    saltzman = (await db.execute(select(Specialist).where(Specialist.name == "Dr. Eliana Saltzman"))).scalars().first()
    saltzman_id = saltzman.id if saltzman else None
    li = (await db.execute(select(Specialist).where(Specialist.name == "Dr. Neill Li"))).scalars().first()
    li_id = li.id if li else None
    neuromuscular = (await db.execute(select(Specialist).where(Specialist.name.like("%Hobson%")))).scalars().first()
    neuromuscular_id = neuromuscular.id if neuromuscular else None
    tree = (await db.execute(select(Tree).where(Tree.id == "duke-nerve-center-v1"))).scalars().first()
    tree_id = tree.id if tree else None

    # Helper to create patient + provider pairs
    async def get_or_create_patient(mrn, **kwargs):
        p = (await db.execute(select(Patient).where(Patient.mrn == mrn))).scalars().first()
        if not p:
            p = Patient(id=str(uuid.uuid4()), clinic_id=clinic_id, mrn=mrn, **kwargs)
            db.add(p)
        return p

    async def get_or_create_provider(npi, **kwargs):
        p = (await db.execute(select(ReferringProvider).where(ReferringProvider.npi == npi))).scalars().first()
        if not p:
            p = ReferringProvider(id=str(uuid.uuid4()), npi=npi, **kwargs)
            db.add(p)
        return p

    # ==== Referral 1: Marla Testfield — CTS → Dr. Saltzman ====
    patient1 = await get_or_create_patient("MRN-4839201", first_name="Marla", last_name="Testfield", dob=date(1974, 3, 12), sex="F", phone="(919) 555-0182")
    provider1 = await get_or_create_provider("1740283915", provider_name="Dr. Alan Pemberly", practice_name="Cary Family Medicine", phone="(919) 555-0114", fax="(919) 555-0115")
    await db.flush()

    ref1_id = str(uuid.uuid4())
    db.add(Referral(
        id=ref1_id, display_id="REF-2026-0142", patient_id=patient1.id, referred_by_id=provider1.id,
        routed_specialist_id=saltzman_id, tree_id=tree_id,
        channel=ReferralChannel.epic, priority=ReferralPriority.routine, status=ReferralStatus.needs_review,
        reason_for_referral="EMG-confirmed right carpal tunnel syndrome; failed splinting; surgical evaluation.",
        clinical_note="Thanks for seeing this pleasant 52-year-old right-hand-dominant administrative assistant with about four months of numbness and tingling in the right thumb, index, and long fingers, worse at night and while driving. Phalen and Tinel are positive at the right wrist with no thenar wasting. EMG/NCS on 6/30/2026 showed moderate right median neuropathy at the wrist. She has faithfully worn a night splint for eight weeks without relief and would like to discuss surgical options.",
        extraction={"variables": {"urgentRedFlag": {"value": "none", "confidence": 0.97}, "presentationCategory": {"value": "compression", "confidence": 0.95}, "laterality": {"value": "one_side", "confidence": 0.94}, "primarySymptom": {"value": "numbness_tingling", "confidence": 0.92}, "symptomRegion": {"value": "wrist", "confidence": 0.93}, "nerveStudyStatus": {"value": "done_abnormal", "confidence": 0.9}}, "sources": {"urgentRedFlag": "note", "presentationCategory": "note", "laterality": "note", "primarySymptom": "note", "symptomRegion": "note", "nerveStudyStatus": "attachment"}},
        annotations={"routing": {"outcome": "routed", "specialist_name": "Dr. Eliana Saltzman", "urgency": "routine", "path_taken": ["node_redflag", "node_presentation", "node_distribution", "node_comp_symptom", "node_comp_region", "node_comp_emg_upper", "spec_saltzman"]}, "visitDate": "2026-09-22"},
        structured_data={"vitals": {"bp": "122/78", "hr": "72", "bmi": "27.4"}, "meds": ["lisinopril 10 mg daily", "ibuprofen 400 mg PRN"], "problems": ["Hypertension", "Carpal tunnel syndrome, right"], "diagnoses": [{"icd10": "G56.01", "description": "Carpal tunnel syndrome, right upper limb"}]},
    ))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref1_id, title="EMG/NCS report — right upper extremity", type="emg", date="2026-06-30", pages=3))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref1_id, title="Office visit note", type="note", date="2026-07-15", pages=2))

    # ==== Referral 2: Robert Nulligan — ulnar, incomplete ====
    patient2 = await get_or_create_patient("MRN-2217743", first_name="Robert", last_name="Nulligan", dob=date(1961, 8, 30), sex="M", phone="(910) 555-0147")
    provider2 = await get_or_create_provider("1568374920", provider_name="Dr. Priya Vaswani", practice_name="Harnett Primary Care Associates", phone="(910) 555-0121", fax="(910) 555-0122")
    await db.flush()

    ref2_id = str(uuid.uuid4())
    db.add(Referral(
        id=ref2_id, display_id="REF-2026-0147", patient_id=patient2.id, referred_by_id=provider2.id,
        routed_specialist_id=neuromuscular_id, tree_id=tree_id,
        channel=ReferralChannel.fax, priority=ReferralPriority.routine, status=ReferralStatus.needs_review,
        reason_for_referral="Left hand numbness, please evaluate.",
        clinical_note="Please evaluate this 64-year-old gentleman with several months of numbness and tingling in the left hand, mostly the ring and small fingers. He occasionally drops small objects. Exam in our office was otherwise unremarkable.",
        extraction={"variables": {"urgentRedFlag": {"value": "none", "confidence": 0.86}, "presentationCategory": {"value": "compression", "confidence": 0.82}, "laterality": {"value": "one_side", "confidence": 0.81}, "primarySymptom": {"value": "numbness_tingling", "confidence": 0.84}, "symptomRegion": {"value": "hand_fingers", "confidence": 0.83}}, "sources": {"urgentRedFlag": "note", "presentationCategory": "note", "laterality": "note", "primarySymptom": "note", "symptomRegion": "note"}},
        annotations={"routing": {"outcome": "incomplete", "missing_variables": ["nerveStudyStatus"], "path_taken": ["node_redflag", "node_presentation", "node_distribution", "node_comp_symptom", "node_comp_region", "node_comp_emg_upper"]}},
        structured_data={"diagnoses": [{"icd10": "G56.21", "description": "Lesion of ulnar nerve, right upper limb"}]},
    ))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref2_id, title="Faxed referral letter", type="note", date="2026-07-17", pages=1))

    # ==== Referral 3: James Whitford — brachial plexus → Dr. Li ====
    patient3 = await get_or_create_patient("MRN-3391045", first_name="James", last_name="Whitford", dob=date(1985, 6, 22), sex="M", phone="(919) 555-0244")
    provider3 = await get_or_create_provider("1234567890", provider_name="Dr. Samuel Kearns", practice_name="Durham Orthopedics", phone="(919) 555-0301", fax="(919) 555-0302")
    await db.flush()

    ref3_id = str(uuid.uuid4())
    db.add(Referral(
        id=ref3_id, display_id="REF-2026-0163", patient_id=patient3.id, referred_by_id=provider3.id,
        routed_specialist_id=li_id, tree_id=tree_id,
        channel=ReferralChannel.epic, priority=ReferralPriority.routine, status=ReferralStatus.needs_review,
        reason_for_referral="Right shoulder weakness and neck pain after motorcycle accident 8 months ago; suspect brachial plexus injury.",
        clinical_note="39-year-old right-hand-dominant construction worker involved in a motorcycle accident 8 months ago. Sustained a clavicle fracture (healed, hardware in place). Progressive right shoulder weakness, difficulty lifting the arm above shoulder level. MRI shows possible brachial plexus traction injury at C5-C6. EMG shows denervation of supraspinatus and infraspinatus. Appreciate your evaluation for possible nerve transfer.",
        extraction={"variables": {"urgentRedFlag": {"value": "none", "confidence": 0.95}, "presentationCategory": {"value": "traumatic_chronic", "confidence": 0.91}, "symptomRegion": {"value": "shoulder_upper_arm", "confidence": 0.93}}, "sources": {"urgentRedFlag": "note", "presentationCategory": "note", "symptomRegion": "note"}},
        annotations={"routing": {"outcome": "routed", "specialist_name": "Dr. Neill Li", "urgency": "expedited", "path_taken": ["node_redflag", "node_presentation", "node_trauma_region", "spec_li"]}, "visitDate": "2026-08-28"},
        structured_data={"meds": ["gabapentin 300 mg TID", "ibuprofen 600 mg PRN"], "problems": ["Brachial plexus injury, right", "S/P clavicle ORIF"], "diagnoses": [{"icd10": "S14.3XXA", "description": "Injury of brachial plexus, initial encounter"}]},
    ))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref3_id, title="MRI brachial plexus report", type="imaging", date="2026-07-05", pages=4))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref3_id, title="EMG/NCS — right upper extremity", type="emg", date="2026-07-10", pages=3))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref3_id, title="Operative note — clavicle ORIF", type="note", date="2025-11-18", pages=2))

    # ==== Referral 4: Angela Vasquez — acute trauma → ESCALATED ====
    patient4 = await get_or_create_patient("MRN-5582017", first_name="Angela", last_name="Vasquez", dob=date(1992, 1, 15), sex="F", phone="(984) 555-0199")
    provider4 = await get_or_create_provider("1987654321", provider_name="Dr. Kevin Ostrowski", practice_name="WakeMed Emergency Department", phone="(919) 555-0400", fax="(919) 555-0401")
    await db.flush()

    ref4_id = str(uuid.uuid4())
    db.add(Referral(
        id=ref4_id, display_id="REF-2026-0158", patient_id=patient4.id, referred_by_id=provider4.id,
        routed_specialist_id=None, tree_id=tree_id,
        channel=ReferralChannel.phone, priority=ReferralPriority.urgent, status=ReferralStatus.needs_review,
        reason_for_referral="Acute laceration to left forearm with inability to flex wrist — possible median nerve injury.",
        clinical_note="32-year-old woman presents to the ED after a glass laceration to the left volar forearm sustained 4 hours ago. Unable to flex the wrist or fingers. Thenar eminence is flat, no thumb opposition. Sensation absent over palmar thumb, index, and long fingers. Wound was irrigated and closed primarily; no tendon repair attempted. Needs urgent peripheral nerve surgery evaluation within 72 hours.",
        extraction={"variables": {"urgentRedFlag": {"value": "acute_trauma", "confidence": 0.98}}, "sources": {"urgentRedFlag": "note"}},
        annotations={"routing": {"outcome": "escalated", "escalation_reason": "URGENT FAST-TRACK (<72h): acute traumatic nerve injury — laceration with motor/sensory loss. Route immediately to peripheral-nerve surgery.", "path_taken": ["node_redflag", "esc_urgent_trauma"]}},
        structured_data={"diagnoses": [{"icd10": "S54.11XA", "description": "Injury of median nerve at forearm level, left arm"}, {"icd10": "S61.412A", "description": "Laceration without foreign body of left hand"}]},
    ))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref4_id, title="ED visit note", type="note", date="2026-07-24", pages=3))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref4_id, title="Wound photograph", type="imaging", date="2026-07-24", pages=1))

    # ==== Referral 5: Diane Chowdhury — cubital tunnel → Dr. Saltzman ====
    patient5 = await get_or_create_patient("MRN-6643928", first_name="Diane", last_name="Chowdhury", dob=date(1969, 9, 3), sex="F", phone="(336) 555-0277")
    provider5 = await get_or_create_provider("1122334455", provider_name="Dr. Rachel Benning", practice_name="Greensboro Internal Medicine", phone="(336) 555-0210", fax="(336) 555-0211")
    await db.flush()

    ref5_id = str(uuid.uuid4())
    db.add(Referral(
        id=ref5_id, display_id="REF-2026-0171", patient_id=patient5.id, referred_by_id=provider5.id,
        routed_specialist_id=saltzman_id, tree_id=tree_id,
        channel=ReferralChannel.epic, priority=ReferralPriority.routine, status=ReferralStatus.needs_review,
        reason_for_referral="Right cubital tunnel syndrome, EMG-confirmed; progressive grip weakness.",
        clinical_note="57-year-old right-hand-dominant teacher with 5 months of numbness in the right ring and small fingers, worse when leaning on the elbow. Grip strength has declined; she drops her coffee mug most mornings. Exam shows positive Tinel's at the cubital tunnel, mild intrinsic weakness, no visible atrophy yet. EMG/NCS last month shows moderate ulnar neuropathy at the elbow with slowing across the cubital tunnel. Night splint and activity modification for 6 weeks with no improvement.",
        extraction={"variables": {"urgentRedFlag": {"value": "none", "confidence": 0.96}, "presentationCategory": {"value": "compression", "confidence": 0.94}, "laterality": {"value": "one_side", "confidence": 0.95}, "primarySymptom": {"value": "numbness_tingling", "confidence": 0.88}, "symptomRegion": {"value": "elbow", "confidence": 0.91}, "nerveStudyStatus": {"value": "done_abnormal", "confidence": 0.93}}, "sources": {"urgentRedFlag": "note", "presentationCategory": "note", "laterality": "note", "primarySymptom": "note", "symptomRegion": "note", "nerveStudyStatus": "attachment"}},
        annotations={"routing": {"outcome": "routed", "specialist_name": "Dr. Eliana Saltzman", "urgency": "routine", "path_taken": ["node_redflag", "node_presentation", "node_distribution", "node_comp_symptom", "node_comp_region", "node_comp_emg_upper", "spec_saltzman"]}, "visitDate": "2026-09-15"},
        structured_data={"meds": ["metformin 1000 mg BID", "vitamin B12 1000 mcg daily"], "problems": ["Type 2 diabetes mellitus", "Cubital tunnel syndrome, right"], "diagnoses": [{"icd10": "G56.22", "description": "Lesion of ulnar nerve, left upper limb"}]},
    ))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref5_id, title="EMG/NCS — right upper extremity", type="emg", date="2026-06-20", pages=3))
    db.add(Attachment(id=str(uuid.uuid4()), referral_id=ref5_id, title="Referral letter", type="note", date="2026-07-18", pages=1))

    await db.commit()
    print("  Seeded 5 demo referrals with attachments.")

if __name__ == "__main__":
    asyncio.run(seed())
