from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import jwt
import datetime
import bcrypt

from app.api.deps import get_db, get_settings
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()
from app.core.config import settings

# In production this comes from secrets manager/env via config
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
        
    return user

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Very simple mock auth for demo purposes
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalars().first()
    
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    # In development mock users might still have plain text passwords for demo
    # We fall back to equality if bcrypt throws an error to not break the demo,
    # but in production ONLY bcrypt should be used.
    try:
        if not bcrypt.checkpw(req.password.encode('utf-8'), user.hashed_password.encode('utf-8')):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    except ValueError:
        # Fallback for plain-text mock users (insecure, just for dev transition)
        if user.hashed_password != req.password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
        
    # Create JWT token
    access_token_expires = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    access_token = jwt.encode(
        {"sub": str(user.id), "exp": access_token_expires},
        SECRET_KEY,
        algorithm=ALGORITHM
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "specialist_id": user.specialist_id
        }
    }

@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "role": current_user.role,
        "specialist_id": current_user.specialist_id
    }
