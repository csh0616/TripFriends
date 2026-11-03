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
