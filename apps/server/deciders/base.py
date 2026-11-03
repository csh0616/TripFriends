from collections.abc import Mapping
from typing import Any, Literal, Protocol

from pydantic import BaseModel


class Decision(BaseModel):
    pick: str | None  # None이면 되묻기
    confidence: float | None = None
    source: Literal["rule", "jev", "fallback"]
    latency_ms: float = 0.0
    cost_usd: float = 0.0
    reason: str = ""


class Decider(Protocol):
    def decide(
        self,
        question: str,
        options: Mapping[str, str],  # 보기 키 → "이 보기가 뜻하는 것" 한 줄
        context: Mapping[str, Any] | None = None,
    ) -> Decision: ...
