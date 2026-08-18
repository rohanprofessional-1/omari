"""Audit logging service — explicit, request-scoped audit trail recording.

Called directly from API handlers (not ORM event listeners) so we have full
access to the authenticated user and client IP address.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditAction, AuditLog
from app.models.user import User


async def record_audit(
    db: AsyncSession,
    *,
    patient_id: str,
    actor: User | None,
    action: AuditAction,
    resource_type: str,
    resource_id: str,
    detail: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Append a single immutable audit event.

    Parameters
    ----------
    db : AsyncSession
        The current database session (the caller's transaction).
    patient_id : str
        The patient this event relates to.
    actor : User | None
        The authenticated user, or ``None`` for system-initiated events.
    action : AuditAction
        The type of event being recorded.
    resource_type : str
        The kind of resource affected (``"patient"``, ``"referral"``, etc.).
    resource_id : str
        The primary key of the affected resource.
    detail : dict | None
        Optional structured payload — field-level diffs for updates, context
        for other actions.
    ip_address : str | None
        The client's IP address from the HTTP request.

    Returns
    -------
    AuditLog
        The newly created (but not yet committed) audit row.  The caller is
        responsible for committing the session.
    """
    entry = AuditLog(
        patient_id=patient_id,
        actor_id=actor.id if actor else None,
        actor_label=actor.name if actor else "system",
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        ip_address=ip_address,
    )
    db.add(entry)
    return entry


def compute_patient_diff(
    existing: dict,
    updates: dict,
) -> dict:
    """Compare two dicts and return a ``{"changes": {...}}`` payload.

    Only keys present in *updates* that differ from *existing* are included.
    """
    changes: dict = {}
    for key, new_val in updates.items():
        old_val = existing.get(key)
        # Normalize None vs. missing
        if old_val != new_val:
            changes[key] = {
                "old": _serialize(old_val),
                "new": _serialize(new_val),
            }
    if not changes:
        return {}
    return {"changes": changes}


def _serialize(val: object) -> object:
    """Make a value JSON-safe (dates → ISO strings, etc.)."""
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return val
