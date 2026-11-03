import os
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

import httpx
from pydantic import BaseModel

from deciders.base import Decider, Decision

_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
_MODEL = "typesafe-ai/jev"
_QID = "q"
_DEFAULT_INSTRUCTIONS = "보기 중 가장 알맞은 하나를 고른다."

# httpx의 timeout은 단계별(연결·읽기)이라 전체 시간을 못 막는다. 전체 0.8초는 스레드 기다림으로 끊는다.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="jev")


class _ChoiceAnswer(BaseModel):
    """Jev choice 응답 한 개 (POC-001 §5~8). 모듈 밖으로 내보내지 않는다."""

    type: str
    choice: str | None = None
    confidence: float | None = None
    probabilities: dict[str, float] = {}


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
        key = api_key or os.environ.get("AI_GATEWAY_API_KEY")
        if not key:
            raise RuntimeError("AI_GATEWAY_API_KEY가 없습니다. apps/server/.env에 넣어 주세요")
        self._fallback = fallback
        self._timeout_s = timeout_s
        self._min_confidence = min_confidence
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout_s,
            headers={"Authorization": f"Bearer {key}"},
        )

    def decide(
        self,
        question: str,
        options: Mapping[str, str],
        context: Mapping[str, Any] | None = None,
    ) -> Decision:
        started = time.perf_counter()
        body = {
            "model": _MODEL,
            "state": question,
            "questions": {
                _QID: {
                    "type": "choice",
                    "instructions": (context or {}).get("instructions", _DEFAULT_INSTRUCTIONS),
                    "criteria": dict(options),
                }
            },
        }
        future = _pool.submit(self._post, body)
        try:
            answer, cost = future.result(timeout=self._timeout_s)
        except FutureTimeout:
            return self._use_fallback(question, options, context, started, "Jev 시간 초과")
        except (httpx.HTTPError, ValueError) as error:
            return self._use_fallback(question, options, context, started, f"Jev 오류: {type(error).__name__}")

        latency_ms = (time.perf_counter() - started) * 1000
        confidence = answer.confidence
        if confidence is None and answer.probabilities:
            confidence = max(answer.probabilities.values())
        sure = confidence is not None and confidence >= self._min_confidence and answer.choice in options
        return Decision(
            pick=answer.choice if sure else None,
            confidence=confidence,
            source="jev",
            latency_ms=latency_ms,
            cost_usd=cost,
            reason="Jev 고름" if sure else "Jev 확신 낮음, 되묻기",
        )

    def _post(self, body: dict) -> tuple[_ChoiceAnswer, float]:
        response = self._client.post(_URL, json=body)
        response.raise_for_status()
        data = response.json()
        # 실제 응답은 {"answers": {qid: {...}}}, 답 한 개만 오는 모양도 받는다
        raw = data.get("answers", {}).get(_QID, data)
        cost = float(data.get("provider_metadata", {}).get("gateway", {}).get("cost", 0) or 0)
        return _ChoiceAnswer.model_validate(raw), cost

    def _use_fallback(self, question, options, context, started, why: str) -> Decision:
        result = self._fallback.decide(question, options, context)
        return result.model_copy(
            update={
                "source": "fallback",
                "latency_ms": (time.perf_counter() - started) * 1000,
                "reason": f"{why} → {result.reason}",
            }
        )
