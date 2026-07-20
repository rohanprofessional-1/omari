import pytest
import json
from unittest.mock import patch, MagicMock
from pydantic import BaseModel
from app.services.llm.client import call_llm, LLMParseError

class DummyResponseModel(BaseModel):
    message: str
    score: int

def test_call_llm_success():
    with patch('app.services.llm.client.Anthropic') as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        
        # Mock successful JSON response
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=json.dumps({"message": "Hello", "score": 100}))]
        mock_client.messages.create.return_value = mock_response
        
        result = call_llm("System prompt", "User message", "claude-3-haiku-20240307", DummyResponseModel)
        
        assert result.message == "Hello"
        assert result.score == 100
        assert mock_client.messages.create.call_count == 1

def test_call_llm_retry_success():
    with patch('app.services.llm.client.Anthropic') as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        
        # First call returns malformed JSON, second call returns valid JSON
        bad_response = MagicMock()
        bad_response.content = [MagicMock(text="Not a json")]
        
        good_response = MagicMock()
        good_response.content = [MagicMock(text=json.dumps({"message": "Recovered", "score": 50}))]
        
        mock_client.messages.create.side_effect = [bad_response, good_response]
        
        result = call_llm("System prompt", "User message", "claude-3-haiku-20240307", DummyResponseModel)
        
        assert result.message == "Recovered"
        assert result.score == 50
        assert mock_client.messages.create.call_count == 2

def test_call_llm_double_failure():
    with patch('app.services.llm.client.Anthropic') as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        
        # Both calls return malformed JSON
        bad_response = MagicMock()
        bad_response.content = [MagicMock(text="Still not a json")]
        
        mock_client.messages.create.side_effect = [bad_response, bad_response]
        
        with pytest.raises(LLMParseError) as exc_info:
            call_llm("System prompt", "User message", "claude-3-haiku-20240307", DummyResponseModel)
            
        assert mock_client.messages.create.call_count == 2
        assert "Failed to parse LLM response" in str(exc_info.value)
