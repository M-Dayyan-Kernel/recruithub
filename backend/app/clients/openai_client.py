"""OpenAI chat-completions client — workload config from config.yaml."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from openai import AsyncOpenAI, OpenAI

from app.core.config_loader import config

if TYPE_CHECKING:
    from app.core.config_loader import ModelWorkloadConfig

logger = logging.getLogger(__name__)

MODEL_WORKLOADS = frozenset({
    "jd_parse",
    "combined_shortlist",
    "expected_answer",
    "screening_extraction",
    "interview_assessment",
})


class OpenAIClient:
    """Configured OpenAI SDK wrapper for JSON chat completions."""

    def __init__(self, *, timeout_seconds: float | None = None) -> None:
        self._timeout = timeout_seconds

    def _resolve_timeout(self) -> float:
        if self._timeout is not None:
            return self._timeout
        return float(getattr(config, "OPENAI_TIMEOUT_SECONDS", 60.0))

    def _model_config(self, workload: str) -> ModelWorkloadConfig:
        if workload not in MODEL_WORKLOADS:
            raise ValueError(f"Unknown OpenAI workload: {workload}")
        return getattr(config.models, workload)

    def _completion_kwargs(
        self, model_cfg: ModelWorkloadConfig, messages: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return {
            "model": model_cfg.name,
            "messages": messages,
            "temperature": model_cfg.temperature,
            "max_tokens": model_cfg.max_tokens,
            "response_format": model_cfg.openai_response_format(),
        }

    async def chat_completion_json(
        self,
        workload: str,
        messages: list[dict[str, Any]],
        *,
        api_key: str,
    ) -> str:
        """Run an async chat completion and return the message content string."""
        model_cfg = self._model_config(workload)
        client = AsyncOpenAI(api_key=api_key, timeout=self._resolve_timeout())
        response = await client.chat.completions.create(
            **self._completion_kwargs(model_cfg, messages)
        )
        content = response.choices[0].message.content
        if content is None:
            raise ValueError(f"OpenAI returned empty content for workload={workload}")
        return content

    def chat_completion_json_sync(
        self,
        workload: str,
        messages: list[dict[str, Any]],
        *,
        api_key: str,
    ) -> str:
        """Run a sync chat completion and return the message content string."""
        model_cfg = self._model_config(workload)
        client = OpenAI(api_key=api_key, timeout=self._resolve_timeout())
        response = client.chat.completions.create(
            **self._completion_kwargs(model_cfg, messages)
        )
        content = response.choices[0].message.content
        if content is None:
            raise ValueError(f"OpenAI returned empty content for workload={workload}")
        return content
