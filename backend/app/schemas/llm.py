from pydantic import BaseModel, Field

class OpeningResponse(BaseModel):
    message: str = Field(..., description="The conversational opening question for the patient.")

class ExtractionValue(BaseModel):
    variable: str = Field(..., description="The name of the variable being extracted.")
    value: str = Field(..., description="The extracted value corresponding to the variable definitions.")
    confidence: float = Field(..., description="Confidence score from 0.0 to 1.0.", ge=0.0, le=1.0)
    needs_clarification: bool = Field(..., description="True if the patient's response was ambiguous and requires clarification.")
    raw_patient_language: str = Field(..., description="The exact wording the patient used that led to this extraction.")

class ExtractionResponse(BaseModel):
    patient_message: str = Field(..., description="The original message from the patient.")
    extraction: ExtractionValue = Field(..., description="The structured extraction data.")

class GuardrailsResponse(BaseModel):
    is_safe: bool = Field(..., description="True if the message is clinically safe to send to the patient.")
    reason: str = Field(..., description="Explanation of why the message is safe or unsafe.")
