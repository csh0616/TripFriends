from collections.abc import Mapping
from typing import Any

import httpx

from deciders.base import Decider, Decision


class JevDecider:
    def __init__(
        self,
        fallback: Decider,
        *,
        api_key: str | None = None,  # None이면 환경 변수 AI_GATEWAY_API_KEY
        timeout_s: float = 0.8,
        min_confidence: float = 0.6,
        transport: httpx.BaseTransport | None = None,  # 테스트에서 가짜 HTTP를 끼우는 자리
    ) -> None:
        raise NotImplementedError

    def decide(
        self,
        question: str,
        options: Mapping[str, str],
        context: Mapping[str, Any] | None = None,
    ) -> Decision:
        raise NotImplementedError
