from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
from uuid import uuid4

from app.services.tree.state_manager import TreeStateManager
from app.services.tree.sample_trees import knee_pain_tree
from app.services.orchestrator import IntakeOrchestrator

app = FastAPI(title="Clinical Decision Engine API")

# Configure CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store for testing purposes
sessions: Dict[str, TreeStateManager] = {}

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: Optional[str] = None

@app.post("/chat")
def chat_endpoint(request: ChatRequest):
    # 1. Retrieve or create session
    session_id = request.session_id
    if not session_id or session_id not in sessions:
        session_id = str(uuid4())
        sessions[session_id] = TreeStateManager(knee_pain_tree)
    
    manager = sessions[session_id]
    
    # 2. Run the orchestrator
    orchestrator = IntakeOrchestrator(manager)
    try:
        result = orchestrator.process_turn(request.message)
    except Exception as e:
        return {"error": str(e), "session_id": session_id}
        
    # 3. Append the session ID to the response so the client can keep the state
    result["session_id"] = session_id
    return result

@app.get("/health")
def health_check():
    return {"status": "healthy"}
