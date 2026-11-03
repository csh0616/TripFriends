"""판단기 테스트. 근거: TASK-001 §2 deciders, §4 AC-6~9·AC-19, ADR-011 §2. Jev는 가짜 HTTP로."""

import inspect
import os
import time

import httpx
import pytest

import deciders
from deciders import Decision, JevDecider

OPTIONS = {"chat": "그냥 이야기하는 말", "request": "무언가를 찾거나 바꿔 달라는 말"}


class FixedDecider:
    """대체 경로 확인용: 항상 같은 답을 주는 판단기."""

    def decide(self, question, options, context=None):
        return Decision(pick="chat", source="rule", reason="고정")


def jev_answer(choice: str, confidence: float):
    def handler(request: httpx.Request) -> httpx.Response:
        rest = (1 - confidence) / (len(OPTIONS) - 1)
        probs = {k: (confidence if k == choice else rest) for k in OPTIONS}
        return httpx.Response(
            200, json={"type": "choice", "choice": choice, "confidence": confidence, "probabilities": probs}
        )

    return handler


def make(handler) -> JevDecider:
    return JevDecider(FixedDecider(), api_key="test-key", transport=httpx.MockTransport(handler))


def test_Jev_확신_높으면_고른_키를_돌려줌():
    result = make(jev_answer("request", 0.9)).decide("근처 라멘집 지금 열린 곳", OPTIONS)
    assert result.pick == "request"
    assert result.source == "jev"
    assert result.confidence == pytest.approx(0.9)
    assert result.latency_ms > 0
    assert result.cost_usd >= 0


def test_AC06_확신_0_55면_고르지_않고_되묻기():
    result = make(jev_answer("request", 0.55)).decide("라멘", OPTIONS)
    assert result.pick is None
    assert result.source == "jev"


def test_AC06_확신_정확히_0_6이면_고름():
    result = make(jev_answer("request", 0.6)).decide("라멘", OPTIONS)
    assert result.pick == "request"


def test_AC07_1_2초_지연이면_0_8초_근처에서_끊고_대체():
    def slow(request):
        time.sleep(1.2)
        return jev_answer("request", 0.9)(request)

    started = time.perf_counter()
    result = make(slow).decide("라멘", OPTIONS)
    elapsed = time.perf_counter() - started

    assert 0.7 <= elapsed < 1.1
    assert result.source == "fallback"
    assert result.pick == "chat"


@pytest.mark.parametrize(
    "handler",
    [
        lambda request: httpx.Response(500, json={"error": "server"}),
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("연결 실패", request=request)),
    ],
    ids=["서버오류_500", "연결실패"],
)
def test_Jev_오류면_대체_판단기_결과(handler):
    result = make(handler).decide("라멘", OPTIONS)
    assert result.source == "fallback"
    assert result.pick == "chat"


def test_AC08_키가_없으면_알아볼_수_있는_오류(monkeypatch):
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    with pytest.raises(Exception, match="AI_GATEWAY_API_KEY가 없습니다"):
        JevDecider(FixedDecider())


def test_AC09_공개_API는_네개뿐():
    assert set(deciders.__all__) == {"Decider", "Decision", "RuleDecider", "JevDecider"}
    public_classes = {
        name for name, obj in vars(deciders).items() if not name.startswith("_") and inspect.isclass(obj)
    }
    assert public_classes == {"Decider", "Decision", "RuleDecider", "JevDecider"}


@pytest.mark.live
def test_AC19_실제_Jev_한번_연결_확인():
    if not os.environ.get("AI_GATEWAY_API_KEY"):
        pytest.skip("AI_GATEWAY_API_KEY가 없어 실제 연결 확인을 건너뜀")
    result = JevDecider(FixedDecider()).decide("근처 라멘집 지금 열린 곳", OPTIONS)
    assert result.source == "jev"
    assert result.pick == "request"
    assert result.latency_ms > 0
    assert result.cost_usd > 0
