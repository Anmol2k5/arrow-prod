from typing import AsyncIterator, List

from openai import AsyncOpenAI

from ai.base_provider import BaseLLMProvider, Message
from config import cfg

DEFAULT_MODEL = "deepseek-chat"
MAX_TOKENS = 1024


class DeepSeekProvider(BaseLLMProvider):

    def __init__(self):
        self._client = AsyncOpenAI(
            api_key=cfg.deepseek_api_key,
            base_url="https://api.deepseek.com"
        )

    async def stream_response(
        self,
        user_text: str,
        screenshots_b64: List[str],
        history: List[Message],
        system_prompt: str,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        model = model or DEFAULT_MODEL

        messages = [{"role": "system", "content": system_prompt}]

        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})

        # Note: DeepSeek API doesn't support images directly on their standard endpoint at the moment.
        # If they add vision support, we can enable this. For now, just send text.
        messages.append({"role": "user", "content": user_text})

        stream = await self._client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=MAX_TOKENS,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content

    async def health_check(self) -> bool:
        try:
            await self._client.models.list()
            return True
        except Exception:
            return False
