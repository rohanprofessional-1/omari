import asyncio
import json
from app.services.anthropic import AnthropicService

async def main():
    service = AnthropicService()
    text = "I have a really bad sore throat and a fever."
    
    tool = {
        "name": "record_clinical_variables",
        "description": "Extract variables",
        "input_schema": {
            "type": "object",
            "properties": {
                "urgentRedFlag": {
                    "type": "object",
                    "description": 'Map to "acute_trauma" for an acute injury: laceration/knife/blast, avulsion, stretch or crush (e.g. a motor-vehicle accident), an open wound with new numbness/weakness, a suspected nerve cut with a surgical wound, or an acute (recent) brachial plexus injury (adult trauma or birth injury). Map to "mass_lump" ONLY for a mass/lump that is rapidly growing or sounds suspicious for tumour. Map to "acute" for rapidly progressive weakness, acute foot drop, or acute wrist drop, or cauda-equina-type signals (sudden bowel/bladder change with leg weakness/numbness). Map to "none" when there is NO such red flag — ongoing/chronic symptoms without acute injury, fast-growing mass, or rapidly progressive weakness. When unsure between a generic old injury and an acute one, prefer "none" and let intake clarify. Use "out_of_scope" when the patient describes a completely unrelated medical issue (e.g. sore throat, chest pain, stomach ache).',
                    "properties": {
                        "value": {"type": "string", "enum": ["acute_trauma", "mass_lump", "acute", "none", "out_of_scope"]},
                        "confidence": {"type": "number"}
                    },
                    "required": ["value", "confidence"]
                },
                "presentationCategory": {
                    "type": "object",
                    "description": 'Map to "mass_lump" for any mention of a lump, bump, swelling, knot, or growth they can feel. Map to "acute_trauma" for a recent injury, cut, accident, fall, fracture, or "it happened suddenly after X". Map to "typical_nerve_symptoms" for ongoing pins-and-needles, numbness, shooting pain, or weakness without a lump or recent injury. Use "unsure" only when the text is too vague to place. Use "out_of_scope" when the patient describes a completely unrelated medical issue (e.g. sore throat, chest pain, stomach ache).',
                    "properties": {
                        "value": {"type": "string", "enum": ["mass_lump", "acute_trauma", "typical_nerve_symptoms", "unsure", "out_of_scope"]},
                        "confidence": {"type": "number"}
                    },
                    "required": ["value", "confidence"]
                }
            }
        }
    }

    res = await service.extract(text, tool=tool)
    print(res)

if __name__ == "__main__":
    asyncio.run(main())
