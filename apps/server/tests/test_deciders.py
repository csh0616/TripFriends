"""판단기 테스트. 근거: TASK-001 §2 deciders, §4 AC-6~9·AC-19, §9-1 AC-21·24, ADR-011 §2. Jev는 가짜 HTTP로."""

import inspect
import json
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


def jev_answer(choice: str, confidence: float, cost: float | str = 0.00004):
    """실제 Jev 응답 모양 (TASK-001 §9-1 AC-21, POC-001 측정): 요청한 질문 id 아래에 답, 비용은 provider_metadata."""

    def handler(request: httpx.Request) -> httpx.Response:
        question_ids = list(json.loads(request.content)["questions"])
        rest = (1 - confidence) / (len(OPTIONS) - 1)
        probs = {k: (confidence if k == choice else rest) for k in OPTIONS}
        answer = {"type": "choice", "choice": choice, "confidence": confidence, "probabilities": probs}
        return httpx.Response(
            200,
            json={
                "answers": {qid: answer for qid in question_ids},
                "provider_metadata": {"gateway": {"cost": cost}},
            },
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


def test_AC21_실제_응답_모양에서_고른_키와_확신과_비용을_읽음():
    result = make(jev_answer("request", 0.83, cost=0.00004)).decide("근처 라멘집 지금 열린 곳", OPTIONS)
    assert result.source == "jev"
    assert result.pick == "request"
    assert result.confidence == pytest.approx(0.83)
    assert result.cost_usd == pytest.approx(0.00004)


def test_AC21_실제_응답_모양에서도_확신_낮으면_되묻기():
    result = make(jev_answer("chat", 0.55, cost=0.00002)).decide("음", OPTIONS)
    assert result.pick is None
    assert result.source == "jev"
    assert result.cost_usd == pytest.approx(0.00002)


def test_AC21_비용이_숫자_문자열이어도_읽음():
    result = make(jev_answer("request", 0.9, cost="0.0000412")).decide("라멘", OPTIONS)
    assert result.source == "jev"
    assert result.cost_usd == pytest.approx(0.0000412)


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


# ---------- §9-1 AC-24 첫 호출 지연 대비 ----------


def test_AC24_HTTP_연결을_호출마다_새로_만들지_않고_예열한_연결을_재사용(monkeypatch):
    created = []
    for cls in (httpx.Client, httpx.AsyncClient):
        original = cls.__init__

        def counting_init(self, *args, _original=original, **kwargs):
            created.append(type(self).__name__)
            _original(self, *args, **kwargs)

        monkeypatch.setattr(cls, "__init__", counting_init)

    hosts = []
    answer = jev_answer("request", 0.9)

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        if request.content and "questions" in json.loads(request.content):
            return answer(request)
        return httpx.Response(200, json={})

    decider = make(handler)
    decider.warm_up()
    for _ in range(3):
        assert decider.decide("라멘", OPTIONS).source == "jev"

    assert len(created) <= 1
    assert len(hosts) >= 4  # 예열 1번 이상 + 판단 3번
    assert len(set(hosts)) == 1  # 예열은 판단과 같은 곳으로 연결을 연다


def test_AC24_시간_초과면_이유에_시간_초과():
    def slow(request):
        time.sleep(1.2)
        return jev_answer("request", 0.9)(request)

    result = make(slow).decide("라멘", OPTIONS)
    assert result.source == "fallback"
    assert "시간 초과" in result.reason


def test_AC24_HTTP_오류면_이유에_HTTP_오류():
    result = make(lambda request: httpx.Response(500, json={"error": "server"})).decide("라멘", OPTIONS)
    assert result.source == "fallback"
    assert "HTTP 오류" in result.reason


@pytest.mark.parametrize(
    "body",
    [{"answers": {}}, {"answers": {"q": {"confidence": 0.9}}}, ["not", "a", "dict"]],
    ids=["답_없음", "type_없음", "객체_아님"],
)
def test_AC24_응답_모양이_다르면_이유에_응답_모양(body):
    result = make(lambda request: httpx.Response(200, json=body)).decide("라멘", OPTIONS)
    assert result.source == "fallback"
    assert result.pick == "chat"
    assert "응답 모양" in result.reason
