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


# TASK-010 AC-1: 테스트는 실제 Google·Serper(그리고 어떤 바깥 주소도)를 부르지 않는다. 네트워크를 막고 통과해야 한다.
# 인터넷 주소(AF_INET·AF_INET6)로 나가는 연결을 모두 막는다. 실제 Jev를 부르는 `live` 테스트만 예외.
@pytest.fixture(autouse=True)
def _block_network(request, monkeypatch):
    if request.node.get_closest_marker("live"):
        yield
        return
    import socket

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def guard(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise RuntimeError(f"테스트에서 네트워크 연결 금지 (TASK-010 AC-1): {address!r}")

    def connect(sock, address):
        guard(sock, address)
        return real_connect(sock, address)

    def connect_ex(sock, address):
        guard(sock, address)
        return real_connect_ex(sock, address)

    real_getaddrinfo = socket.getaddrinfo

    def getaddrinfo(host, *args, **kwargs):
        if host not in (None, "localhost", "127.0.0.1", "::1"):
            raise RuntimeError(f"테스트에서 주소 찾기 금지 (TASK-010 AC-1): {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    yield
