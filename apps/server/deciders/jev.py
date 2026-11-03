import os
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from deciders.base import Decider, Decision

_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
_MODEL = "typesafe-ai/jev"
_QID = "q"
_DEFAULT_INSTRUCTIONS = "보기 중 가장 알맞은 하나를 고른다."

# httpx의 timeout은 단계별(연결·읽기)이라 전체 시간을 못 막는다. 전체 0.8초는 스레드 기다림으로 끊는다.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="jev")

# 예열은 첫 연결(DNS·TLS)을 여는 것이 목적이라 판단 시간 제한(0.8초)보다 길게 기다린다.
# 첫 호출이 3.24초 걸린 측정(TASK-001 §9-1 AC-24)을 넘기도록 잡은 값
_WARM_UP_TIMEOUT_S = 5.0


class _ShapeError(ValueError):
    """Jev 응답이 기대한 모양이 아님."""


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
        except (FutureTimeout, httpx.TimeoutException):
            return self._use_fallback(question, options, context, started, "Jev 시간 초과")
        except httpx.HTTPError as error:
            return self._use_fallback(question, options, context, started, f"Jev HTTP 오류: {type(error).__name__}")
        except ValueError as error:
            return self._use_fallback(question, options, context, started, f"Jev 응답 모양 오류: {error}")

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

    def warm_up(self) -> None:
        """서버 시작 때 한 번 불러 Jev 쪽 연결을 미리 연다 (TASK-001 §9-1 AC-24).

        판단과 같은 클라이언트로 같은 곳에 연결해, 뒤의 판단이 이 연결을 재사용한다.
        응답 내용은 보지 않는다 (연결이 열리면 목적 달성). 연결 실패는 호출한 쪽으로 올린다.
        """
        self._client.get(_URL, timeout=_WARM_UP_TIMEOUT_S)

    def _post(self, body: dict) -> tuple[_ChoiceAnswer, float]:
        response = self._client.post(_URL, json=body)
        response.raise_for_status()
        data = response.json()
        # 실제 응답 모양 (AC-21): {"answers": {qid: {...}}, "provider_metadata": {"gateway": {"cost": ...}}}
        if not isinstance(data, dict) or not isinstance(data.get("answers"), dict):
            raise _ShapeError("answers 없음")
        raw = data["answers"].get(_QID)
        if not isinstance(raw, dict):
            raise _ShapeError(f"answers에 {_QID} 없음")
        try:
            answer = _ChoiceAnswer.model_validate(raw)
        except ValidationError as error:
            raise _ShapeError(f"답 형식: {error.error_count()}개 항목 틀림") from None
        gateway = (data.get("provider_metadata") or {}).get("gateway") or {}
        cost = float(gateway.get("cost") or 0)
        return answer, cost

    def _use_fallback(self, question, options, context, started, why: str) -> Decision:
        result = self._fallback.decide(question, options, context)
        return result.model_copy(
            update={
                "source": "fallback",
                "latency_ms": (time.perf_counter() - started) * 1000,
                "reason": f"{why} → {result.reason}",
            }
        )
