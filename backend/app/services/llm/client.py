import json
from typing import Type, TypeVar
from pydantic import BaseModel, ValidationError
from anthropic import Anthropic

T = TypeVar("T", bound=BaseModel)

class LLMParseError(Exception):
    """Exception raised when the LLM fails to return valid JSON matching the schema after retries."""
    pass

def call_llm(system_prompt: str, user_message: str, model_name: str, response_model: Type[T]) -> T:
    """
    Calls the Anthropic API, enforces structured JSON output via system prompting,
    and returns a parsed Pydantic model. Retries once on failure.
    """
    client = Anthropic()
    
    schema_json = json.dumps(response_model.model_json_schema(), indent=2)
    full_system_prompt = (
        f"{system_prompt}\n\n"
        f"You MUST respond with a valid, raw JSON object matching this exact JSON schema. "
        f"Do not include markdown blocks, just the JSON string.\n"
        f"Schema:\n{schema_json}"
    )
    
    def _make_call() -> str:
        response = client.messages.create(
            model=model_name,
            max_tokens=1024,
            system=full_system_prompt,
            messages=[
                {"role": "user", "content": user_message}
            ]
        )
        return response.content[0].text

    # Attempt 1
    try:
        raw_text = _make_call()
        data = json.loads(raw_text)
        return response_model(**data)
    except (json.JSONDecodeError, ValidationError):
        # Attempt 2 (Retry)
        try:
            retry_text = _make_call()
            data = json.loads(retry_text)
            return response_model(**data)
        except (json.JSONDecodeError, ValidationError) as e2:
            raise LLMParseError(f"Failed to parse LLM response into {response_model.__name__} after 2 attempts. Last error: {str(e2)}")
