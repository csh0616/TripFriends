"""API 테스트. 근거: TASK-001 §2 api, AC-2, §9-1 AC-24."""

import pytest
from fastapi.testclient import TestClient

from api.main import app
from deciders import JevDecider


def test_AC02_health는_카드_23개():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "cards": 23}


def test_AC24_서버_시작할_때_Jev_예열을_한번_함(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-key")
    calls = []
    monkeypatch.setattr(JevDecider, "warm_up", lambda self: calls.append("warm_up"))

    with TestClient(app) as client:  # with 블록이 서버 시작(lifespan)을 실행한다
        assert client.get("/health").status_code == 200

    assert calls == ["warm_up"]


@pytest.mark.parametrize(
    "error",
    [RuntimeError("예열 실패"), TimeoutError("예열 시간 초과")],
    ids=["오류", "시간초과"],
)
def test_AC24_예열이_실패해도_서버는_시작됨(monkeypatch, error):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-key")

    def failing_warm_up(self):
        raise error

    monkeypatch.setattr(JevDecider, "warm_up", failing_warm_up)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "cards": 23}


# ---------- §9-3 예열 백그라운드 (PM 결정 11-03) ----------

WARM_UP_HOLD_S = 3.0  # 가짜 예열이 붙잡고 있는 최대 시간 (풀어 주지 않아도 테스트가 멈추지 않게)


def fake_jev_server(monkeypatch, *, answer_delay_s: float = 0.0):
    """서버가 만드는 JevDecider에 가짜 HTTP를 끼운다.

    예열(GET)은 release가 될 때까지 붙잡고, 판단(POST)은 answer_delay_s 뒤에 답한다.
    """
    import json
    import threading
    import time

    import httpx

    warm_up_started = threading.Event()
    release = threading.Event()
    warm_up_done = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            warm_up_started.set()
            release.wait(WARM_UP_HOLD_S)
            warm_up_done.set()
            return httpx.Response(200, json={})
        time.sleep(answer_delay_s)
        qids = list(json.loads(request.content)["questions"])
        answer = {"type": "choice", "choice": "request", "confidence": 0.9, "probabilities": {}}
        return httpx.Response(200, json={"answers": {q: answer for q in qids}})

    original_init = JevDecider.__init__

    def init_with_fake(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-key")
    monkeypatch.setattr(JevDecider, "__init__", init_with_fake)
    return warm_up_started, release, warm_up_done


def test_AC24_서버_시작은_예열이_끝나기를_기다리지_않음(monkeypatch):
    import time

    warm_up_started, release, warm_up_done = fake_jev_server(monkeypatch)
    started = time.perf_counter()
    try:
        with TestClient(app) as client:
            ready_s = time.perf_counter() - started
            response = client.get("/health")
            finished_before_ready = warm_up_done.is_set()
            assert warm_up_started.wait(1.0)  # 예열은 뒤에서 시작은 됨
            release.set()
    finally:
        release.set()

    assert ready_s < 1.0  # 예열이 붙잡는 3초를 기다리지 않음
    assert not finished_before_ready
    assert response.status_code == 200
    assert response.json() == {"ok": True, "cards": 23}


@pytest.mark.parametrize(
    ("answer_delay_s", "source", "reason_part"),
    [(0.0, "jev", "Jev 고름"), (1.5, "fallback", "시간 초과")],
    ids=["제때_답하면_Jev", "늦으면_규칙_대체"],
)
def test_AC24_예열이_끝나기_전_요청도_0_8초_규칙대로(monkeypatch, answer_delay_s, source, reason_part):
    import time

    warm_up_started, release, warm_up_done = fake_jev_server(monkeypatch, answer_delay_s=answer_delay_s)
    try:
        with TestClient(app) as client:
            assert warm_up_started.wait(1.0)
            began = time.perf_counter()
            result = client.app.state.jev.decide(
                "근처 라멘집 지금 열린 곳",
                {"chat": "그냥 이야기하는 말", "request": "무언가를 찾거나 바꿔 달라는 말"},
            )
            elapsed_s = time.perf_counter() - began
            finished_before_answer = warm_up_done.is_set()
            release.set()
    finally:
        release.set()

    assert not finished_before_answer  # 예열 중에 받은 요청
    assert elapsed_s < 1.2  # 0.8초 제한 + 여유. 예열(최대 3초)을 기다리지 않음
    assert result.source == source
    assert reason_part in result.reason
