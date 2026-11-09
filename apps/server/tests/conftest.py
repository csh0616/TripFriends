import os
import socket
from urllib.parse import urlsplit

import pytest

# TASK-012 §T: DB 테스트는 로컬 Postgres(Docker 또는 `supabase start`)에만 붙는다. 주소는 이 환경 변수 (값은 저장소에 두지 않는다)
TEST_DB_ENV = "TEST_DATABASE_URL"
_LOOPBACK = ("127.0.0.1", "::1", "localhost")
_db_reason: list[str | None] = []  # 한 번만 계산 (None = DB 있음)


def pytest_configure(config):
    # TASK-002 §7 Q18: 실행 시간 측정 테스트 표시
    config.addinivalue_line("markers", "slow: 실행 시간을 재는 테스트 (AC-16)")
    # TASK-012 §T·AC-1: 로컬 Postgres가 필요한 테스트. 없으면 건너뛰고 이유를 한 줄 출력한다 (`uv run pytest -m db`로 따로)
    config.addinivalue_line("markers", "db: 로컬 Postgres가 필요한 테스트 (TASK-012 §T, TEST_DATABASE_URL)")


def db_skip_reason() -> str | None:
    """DB 테스트를 건너뛸 이유. 로컬 주소가 아니면 붙지 않는다 (결정권자 클라우드에 테스트 데이터 금지, §8)."""
    if _db_reason:
        return _db_reason[0]
    url = os.environ.get(TEST_DB_ENV)
    reason: str | None = None
    if not url:
        reason = f"{TEST_DB_ENV}가 없어 DB 테스트를 건너뜀 (TASK-012 §T)"
    else:
        parts = urlsplit(url)
        host, port = parts.hostname or "", parts.port or 5432
        if host not in _LOOPBACK:
            reason = f"{TEST_DB_ENV}가 로컬 주소가 아니라 DB 테스트를 건너뜀 (실제 Supabase 클라우드 금지, TASK-012 §T·§8)"
        else:
            try:
                socket.create_connection((host, port), timeout=1).close()
            except OSError:
                reason = f"로컬 Postgres({host}:{port})에 붙지 못해 DB 테스트를 건너뜀 (TASK-012 §T)"
    _db_reason.append(reason)
    return reason


def pytest_collection_modifyitems(config, items):
    db_items = [item for item in items if item.get_closest_marker("db")]
    if not db_items:
        return
    reason = db_skip_reason()
    if reason is None:
        return
    for item in db_items:
        item.add_marker(pytest.mark.skip(reason=reason))


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    skipped = [r for r in terminalreporter.stats.get("skipped", []) if "DB 테스트를 건너뜀" in str(getattr(r, "longrepr", ""))]
    if skipped and _db_reason and _db_reason[0]:
        terminalreporter.write_line(f"DB 테스트 {len(skipped)}개 건너뜀: {_db_reason[0]}")


@pytest.fixture
def env(monkeypatch):
    """TASK-003 API 테스트 환경. with 블록이 서버 시작(lifespan)을 실행한다. Jev 키는 지운다."""
    from fastapi.testclient import TestClient

    from api.main import app
    from auth_helpers import FAKE_JWT_SECRET, JWT_SECRET_ENV
    from planning_api_helpers import PlanningEnv

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)  # TASK-012: 기본 테스트는 메모리 저장소
    monkeypatch.setenv(JWT_SECRET_ENV, FAKE_JWT_SECRET)  # TASK-012 B2: 테스트 안에서 만든 가짜 비밀값
    with TestClient(app) as client:
        yield PlanningEnv(client, app)


# TASK-010 AC-1: 테스트는 실제 Google·Serper(그리고 어떤 바깥 주소도)를 부르지 않는다. 네트워크를 막고 통과해야 한다.
# 인터넷 주소(AF_INET·AF_INET6)로 나가는 연결을 모두 막는다. 실제 Jev를 부르는 `live` 테스트만 예외.
# TASK-012 §T: `db` 테스트는 로컬 Postgres(루프백 주소)에만 붙을 수 있다. 바깥 주소는 그대로 막는다.
@pytest.fixture(autouse=True)
def _block_network(request, monkeypatch):
    if request.node.get_closest_marker("live"):
        yield
        return
    allow_loopback = request.node.get_closest_marker("db") is not None

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def guard(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            if allow_loopback and isinstance(address, tuple) and address[0] in _LOOPBACK:
                return
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
