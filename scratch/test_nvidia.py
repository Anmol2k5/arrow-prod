
import sys
print("STARTING TEST...")
sys.stdout.flush()

import asyncio
import os
from openai import AsyncOpenAI
from dotenv import load_dotenv
from pathlib import Path

# Load .env
load_dotenv(Path(__file__).parent.parent / ".env")

async def test_nvidia():
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        print("NVIDIA_API_KEY not found in .env")
        return

    print(f"Testing NVIDIA NIM with key: {api_key[:10]}...")
    sys.stdout.flush()
    client = AsyncOpenAI(
        api_key=api_key,
        base_url="https://integrate.api.nvidia.com/v1"
    )

    try:
        response = await client.chat.completions.create(
            model="meta/llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": "Hello, are you working?"}],
            max_tokens=50
        )
        print("Response:", response.choices[0].message.content)
    except Exception as e:
        print("Error:", e)
    sys.stdout.flush()

if __name__ == "__main__":
    asyncio.run(test_nvidia())
