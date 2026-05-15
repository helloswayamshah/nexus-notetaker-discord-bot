import httpx
import json
import logging
from typing import Optional, List, Dict, Any
from app.config import settings

logger = logging.getLogger(__name__)

class SummarizerService:
    """
    SummarizerService — handles LLM interactions for generating summaries and action items.
    """
    def __init__(self):
        self.timeout = httpx.Timeout(60.0)

    async def summarize(
        self, 
        prompt: str, 
        system_prompt: str,
        provider: str = "ollama",
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> str:
        if provider == "ollama":
            return await self._summarize_ollama(prompt, system_prompt, base_url, model)
        elif provider == "openai":
            return await self._summarize_openai(prompt, system_prompt, api_key, model)
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")

    async def _summarize_ollama(
        self, 
        prompt: str, 
        system_prompt: str, 
        base_url: Optional[str], 
        model: Optional[str]
    ) -> str:
        url = (base_url or settings.OLLAMA_BASE_URL).rstrip("/") + "/api/chat"
        model = model or "llama3.1"

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            "stream": False
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]

    async def _summarize_openai(
        self, 
        prompt: str, 
        system_prompt: str, 
        api_key: Optional[str], 
        model: Optional[str]
    ) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        model = model or "gpt-4o-mini"
        key = api_key or settings.OPENAI_API_KEY

        if not key:
            raise ValueError("OpenAI API key missing")

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ]
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

# Singleton instance
summarizer_service = SummarizerService()
