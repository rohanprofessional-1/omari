from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class AuditLogRead(BaseModel):
    """Single audit log entry for API responses."""
    id: str
    patient_id: str
    patient_name: Optional[str] = None
    patient_mrn: Optional[str] = None
    actor_id: Optional[str] = None
    actor_label: str
    action: str
    resource_type: str
    resource_id: str
    detail: Optional[dict] = None
    ip_address: Optional[str] = None
    timestamp: datetime

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    """Paginated wrapper for audit log queries."""
    items: list[AuditLogRead]
    total: int
    offset: int
    limit: int
