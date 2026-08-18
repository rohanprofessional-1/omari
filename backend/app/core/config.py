from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://blume:blume_dev@localhost:5432/blume"

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"
    ANTHROPIC_EXTRACT_MODEL: str = "claude-sonnet-4-6"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # App
    PROJECT_NAME: str = "Blume API"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True
    # Auth
    SECRET_KEY: str = "change_me_in_production"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
