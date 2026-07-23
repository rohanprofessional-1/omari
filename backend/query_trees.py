import asyncio
from app.db.session import SessionLocal
from sqlalchemy import text

async def main():
    async with SessionLocal() as db:
        result = await db.execute(text("SELECT id, name, root_node_id FROM trees ORDER BY created_at DESC LIMIT 3;"))
        for row in result:
            print(row)
        
        # Let's also check the nodes for the most recent tree
        result = await db.execute(text("SELECT id, name FROM trees ORDER BY created_at DESC LIMIT 1;"))
        tree = result.fetchone()
        if tree:
            print(f"Nodes for tree {tree.id}:")
            nodes = await db.execute(text(f"SELECT count(*) FROM nodes WHERE tree_id = '{tree.id}';"))
            print(nodes.fetchone())

if __name__ == "__main__":
    asyncio.run(main())
