"""API 테스트. 근거: TASK-001 §2 api, AC-2."""

from fastapi.testclient import TestClient

from api.main import app


def test_AC02_health는_카드_23개():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "cards": 23}
