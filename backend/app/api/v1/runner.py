from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging

from app.services.anthropic import anthropic_service

logger = logging.getLogger(__name__)

router = APIRouter()

class ExtractRequest(BaseModel):
    patientText: str
    tool: dict

class PhraseRequest(BaseModel):
    question: str
    lastPatientTurn: Optional[str] = None

class TriageRequest(BaseModel):
    patientText: str
    situation: Optional[str] = None
    currentQuestion: Optional[str] = None

class VoiceRequest(BaseModel):
    question: str
    lastPatientMessage: Optional[str] = None
    options: Optional[List[str]] = None
    progressHint: Optional[bool] = False


@router.post("/extract")
async def extract(body: ExtractRequest) -> Any:
    if not anthropic_service.is_available:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.")
    
    if not body.patientText or not body.tool or not body.tool.get("name") or not body.tool.get("input_schema"):
        raise HTTPException(status_code=400, detail="Expected body { patientText: string, tool: { name, description, input_schema } }.")

    try:
        variables = await anthropic_service.extract(patient_text=body.patientText, tool=body.tool)
        return {"variables": variables, "model": "anthropic-backend"}
    except Exception as e:
        logger.exception("Extraction request failed")
        raise HTTPException(status_code=502, detail=str(e) or "Extraction request failed.")

@router.post("/phrase")
async def phrase(body: PhraseRequest) -> Any:
    if not anthropic_service.is_available:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.")
    
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Expected body { question: string, lastPatientTurn?: string }.")

    try:
        phrased = await anthropic_service.phrase(question=body.question, last_patient_turn=body.lastPatientTurn)
        return {"question": phrased}
    except Exception as e:
        logger.exception("Phrase request failed")
        raise HTTPException(status_code=502, detail=str(e) or "Phrase request failed.")

@router.post("/triage")
async def triage(body: TriageRequest) -> Any:
    if not anthropic_service.is_available:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.")
    
    if not body.patientText.strip():
        raise HTTPException(status_code=400, detail="Expected body { patientText: string, situation?, currentQuestion? }.")

    try:
        result = await anthropic_service.triage(
            patient_text=body.patientText,
            situation=body.situation,
            current_question=body.currentQuestion
        )
        return result
    except Exception as e:
        logger.exception("Triage request failed")
        raise HTTPException(status_code=502, detail=str(e) or "Triage request failed.")

@router.post("/voice")
async def voice(body: VoiceRequest) -> Any:
    if not anthropic_service.is_available:
        raise HTTPException(status_code=500, detail="Server is missing ANTHROPIC_API_KEY. Add it to .env and restart the backend.")
    
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Expected body { question: string, lastPatientMessage?, options?, progressHint? }.")

    try:
        message = await anthropic_service.voice(
            question=body.question,
            last_patient_message=body.lastPatientMessage,
            options=body.options,
            progress_hint=body.progressHint
        )
        return {"message": message}
    except Exception as e:
        logger.exception("Voice request failed")
        raise HTTPException(status_code=502, detail=str(e) or "Voice request failed.")
