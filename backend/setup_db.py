"""Create all tables from SQLAlchemy models and run the seed.

Usage (from backend/):
    $env:PYTHONPATH = $PWD
    ..\.venv\Scripts\python.exe setup_db.py

This bypasses Alembic migrations entirely — it creates the schema directly
from the ORM models. Use this for local dev / demo setup when the migration
chain has issues. For production, fix the migrations.
"""

import asyncio
from app.core.database import engine, async_session_factory
from app.models import Base


async def create_tables():
    """Drop all tables and recreate from models."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("All tables created from models.")


async def main():
    await create_tables()

    # Now run the seed
    from alembic.seed import seed
    await seed()


if __name__ == "__main__":
    asyncio.run(main())
