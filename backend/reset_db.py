import asyncio
from sqlalchemy import delete
from app.core.database import async_session_factory
from app.models.referral import Referral, ReferralReview, ReferralAuditEvent

async def reset():
    async with async_session_factory() as db:
        await db.execute(delete(ReferralAuditEvent))
        await db.execute(delete(ReferralReview))
        await db.execute(delete(Referral))
        await db.commit()
        print("Cleared referral tables.")

if __name__ == "__main__":
    asyncio.run(reset())
