import asyncio
from app.services.anthropic import anthropic_service
from app.core.config import settings

async def test_extraction():
    text = """# **Appropriate Use Criteria (Sample)** Non-Traumatic Knee Pain: Primary Care to Orthopedic Referral — Synthetic example, RAND/UCLA appropriateness format 

## **Scope** 
Adult patients (ages 18-75) presenting with non-traumatic knee pain in a primary care setting. This criteria set evaluates the appropriateness of referral to orthopedic surgery versus continued conservative management. 

## **Indication Variables** 
- Duration of symptoms: <6 weeks / 6 weeks-6 months / >6 months 
- Radiographic findings: Normal / Mild-Moderate OA / Severe OA 
- Mechanical symptoms (catching/locking): Absent / Present 
- Response to conservative therapy (NSAIDs, PT, injections): None / Partial / Complete

## **Appropriateness Ratings** (1-9 Scale)
- 1-3: Rarely Appropriate (Referral not recommended)
- 4-6: May Be Appropriate (Consider referral if specific concerns)
- 7-9: Appropriate (Referral recommended)

## **Scenarios**
1. Duration > 6 months, Severe OA, Conservative therapy failed -> Appropriate (8)
2. Duration < 6 weeks, Normal X-ray, No mechanical symptoms -> Rarely Appropriate (2)
3. Duration 6 weeks - 6 months, Mild OA, Mechanical symptoms present -> Appropriate (7)
4. Any duration, Normal X-ray, Severe catching/locking -> May Be Appropriate (6)
"""

    print(f"Using model: {settings.ANTHROPIC_MODEL}")
    
    try:
        nodes = await anthropic_service.cpg_extract_section(
            section_text=text,
            section_name="Sample Knee Pain CPG",
            subspecialty="Orthopedics",
            existing_variable_keys=[]
        )
        print("Nodes extracted:", len(nodes))
        import json
        print(json.dumps(nodes, indent=2))
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_extraction())
