
import asyncio
import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
from pathlib import Path

# Load .env
load_dotenv(Path(__file__).parent.parent / ".env")

async def list_models():
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        print("NVIDIA_API_KEY not found in .env")
        return

    client = AsyncOpenAI(
        api_key=api_key,
        base_url="https://integrate.api.nvidia.com/v1"
    )

    try:
        models = await client.models.list()
        print("Available models:")
        for m in models.data:
            print(f"- {m.id}")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(list_models())
