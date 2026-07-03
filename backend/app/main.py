from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.api.v1 import (
    clinics,
    trees,
    nodes,
    variables,
    specialists,
    patients,
    conversations,
    gen,
    assistant,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Application startup
    yield
    # Application shutdown
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

# CORS Middleware
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Routers
app.include_router(clinics.router, prefix=settings.API_V1_PREFIX, tags=["clinics"])
app.include_router(trees.router, prefix=settings.API_V1_PREFIX, tags=["trees"])
app.include_router(nodes.router, prefix=settings.API_V1_PREFIX, tags=["nodes"])
app.include_router(variables.router, prefix=settings.API_V1_PREFIX, tags=["variables"])
app.include_router(specialists.router, prefix=settings.API_V1_PREFIX, tags=["specialists"])
app.include_router(patients.router, prefix=settings.API_V1_PREFIX, tags=["patients"])
app.include_router(conversations.router, prefix=settings.API_V1_PREFIX, tags=["conversations"])
app.include_router(gen.router, prefix=settings.API_V1_PREFIX, tags=["generator"])
app.include_router(assistant.router, prefix=settings.API_V1_PREFIX, tags=["assistant"])


@app.get(f"{settings.API_V1_PREFIX}/health", tags=["health"])
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "app": settings.PROJECT_NAME}
