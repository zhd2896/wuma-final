"""Provider boundary: the service sees only this protocol, never a vendor SDK."""

from typing import Protocol

import httpx

from backend.app.core.config import Settings
from typing import Protocol as TypingProtocol


class TextPrompt(TypingProtocol):
    system: str
    user: str


class LLMProvider(Protocol):
    name: str
    model: str

    async def generate(self, prompt: TextPrompt) -> str: ...


class ConfiguredLLMProvider:
    """OpenAI-compatible chat completions over a configured backend URL."""

    def __init__(self, settings: Settings):
        self.name = settings.llm_provider_name
        self.model = settings.llm_model
        self._url = settings.llm_base_url.rstrip("/") + "/chat/completions"
        self._api_key = settings.llm_api_key
        self._timeout = settings.llm_timeout_seconds
        self._temperature = settings.llm_temperature

    async def generate(self, prompt: TextPrompt) -> str:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self.model, "temperature": self._temperature,
                      "response_format": {"type": "json_object"},
                      "messages": [{"role": "system", "content": prompt.system},
                                   {"role": "user", "content": prompt.user}]})
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("Provider returned non-text content")
            return content
