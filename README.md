# Omari — AI Care Coordinator

Omari is a clinical intake platform that routes patients to the right specialist using a deterministic decision tree engine backed by an LLM for natural language extraction. Clinicians build trees visually in the **Builder**, and patients interact with **Omari** (the Runner chat interface).

```
┌─────────────────────────────────────────────────────────┐
│  Patient chat  ──►  Anthropic (extract intent only)      │
│                ──►  Tree Engine (all routing decisions)  │
│                ──►  Specialist assignment (PostgreSQL)   │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript + ReactFlow |
| Backend | FastAPI + SQLAlchemy (async) + Alembic |
| Database | PostgreSQL 16 |
| AI | Anthropic Claude (extraction only — never routing) |
| Infra | Docker Compose |

---

## Quick Start

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Clone & configure

```bash
git clone <repo-url>
cd Omari

cp .env.example .env
```

Open `.env` and set your Anthropic key:

```env
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

The rest of the defaults work out of the box for local dev.

### 3. Start everything

```bash
docker compose up --build
```

On first boot Docker will:
1. Start Postgres and apply all migrations (`alembic upgrade head`)
2. Seed the database with the Duke Nerve Center tree and variables (`alembic/seed.py`)
3. Start the FastAPI backend on **http://localhost:8000**
4. Start the Vite frontend on **http://localhost:5173**

Open **http://localhost:5173** in your browser.

---

## Project Structure

```
Omari/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # FastAPI route handlers
│   │   ├── core/            # Config, DB session factory
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── chat.py      # Orchestrates LLM + tree engine per turn
│   │   │   ├── tree_engine.py  # Deterministic routing engine (no LLM)
│   │   │   └── tree_import.py  # Nested tree UPSERT service
│   │   └── data/            # Canonical seed JSON files (version-controlled)
│   ├── alembic/
│   │   ├── seed.py          # Seeds DB from app/data/*.json on startup
│   │   └── versions/        # SQL migration scripts
│   └── scripts/
│       └── export_seeds.py  # Dumps active DB trees back to app/data/*.json
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Builder.tsx  # Visual decision tree editor
│       │   └── Runner.tsx   # Patient-facing chat interface
│       ├── lib/
│       │   ├── api.ts       # All backend API calls
│       │   └── engine.ts    # Client-side tree evaluator (for Builder preview)
│       └── types/
│           └── tree.ts      # Shared Tree schema (Zod-validated)
├── docker-compose.yml
└── .env.example
```

---

## Architecture Notes

### Source of Truth: PostgreSQL
The database is the **only** source of truth for trees. The frontend never reads tree data from static files at runtime — everything is fetched from the API.

### Deterministic Engine
**The LLM never makes routing decisions.** Anthropic Claude is used only to:
- Extract structured variables from free-text patient input
- Phrase follow-up questions naturally

All clinical routing (which node to visit next, which specialist to assign, when to escalate) is handled by the deterministic `tree_engine.py`.

### Builder → Runner Pipeline
1. Clinician opens **Builder**, selects a tree from the left sidebar
2. Makes changes, clicks **Save** → sent to `POST /api/v1/trees/import`
3. Backend upserts tree into PostgreSQL
4. Patient opens **Runner**, selects a tree from the dropdown, starts chatting

---

## Seed Data Workflow

Trees are stored in `backend/app/data/` as JSON. This makes them version-controllable.

### Export current DB state to seed files
After making changes in the Builder, run:

```bash
docker compose exec backend sh -c "cd /app && PYTHONPATH=/app python3 -m scripts.export_seeds"
```

This dumps all active trees + variables to `backend/app/data/`. Commit those files so other developers get your latest trees automatically on first boot.

### Re-seed a running database
If you need to re-import seed files into a live database:

```bash
docker compose exec backend sh -c "cd /app && PYTHONPATH=/app python3 alembic/seed.py"
```

### Wipe and start fresh
```bash
docker compose down -v   # removes the pgdata volume
docker compose up --build
```

---

## API Reference

The FastAPI backend auto-generates interactive docs:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/trees` | List all trees |
| `GET` | `/api/v1/trees/{id}` | Get full tree with nodes |
| `POST` | `/api/v1/trees/import` | Upsert a full nested tree |
| `POST` | `/api/v1/conversations` | Start a new patient conversation |
| `POST` | `/api/v1/conversations/{id}/chat` | Send a message in a conversation |

---

## Development Tips

### Backend hot-reload
The backend uses `--reload`, so any Python file change in `backend/` restarts the server automatically inside Docker.

### Frontend hot-reload
Vite HMR is active. Changes to `frontend/src/` appear in the browser instantly.

### Database admin UI
pgAdmin is available at **http://localhost:5050**

```
Email:    admin@admin.com
Password: admin
```

Connect to `blume-postgres:5432` with user `blume` / password `blume_dev`.

### Adding a new tree
1. Open the Builder at http://localhost:5173
2. Click **New Tree** (or modify an existing one)
3. Click **Save** — it writes directly to the database
4. Run the export script to commit seed files for other developers

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Your Anthropic API key |
| `POSTGRES_USER` | `blume` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `blume_dev` | PostgreSQL password |
| `POSTGRES_DB` | `blume` | PostgreSQL database name |
| `DATABASE_URL` | *(set by compose)* | Full asyncpg connection URL |
| `BACKEND_CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed CORS origins |
| `DEBUG` | `true` | Enables SQLAlchemy query logging |
| `VITE_API_URL` | `http://localhost:8000` | Backend URL used by the frontend |
