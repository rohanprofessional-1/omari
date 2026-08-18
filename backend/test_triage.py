import asyncio
from app.services.anthropic import AnthropicService

async def main():
    service = AnthropicService()
    text = "I have a really bad sore throat and a fever."
    res = await service.triage(text, situation="start")
    print(res)

if __name__ == "__main__":
    asyncio.run(main())
