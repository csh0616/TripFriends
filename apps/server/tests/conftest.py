import pytest


def pytest_configure(config):
    # TASK-002 §7 Q18: 실행 시간 측정 테스트 표시
    config.addinivalue_line("markers", "slow: 실행 시간을 재는 테스트 (AC-16)")


@pytest.fixture
def env(monkeypatch):
    """TASK-003 API 테스트 환경. with 블록이 서버 시작(lifespan)을 실행한다. Jev 키는 지운다."""
    from fastapi.testclient import TestClient

    from api.main import app
    from planning_api_helpers import PlanningEnv

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    with TestClient(app) as client:
        yield PlanningEnv(client, app)
