"""TASK-012 §12 (1단계 구현 보고 답): 2 운영에서 API 문서 길 끔 · 5 제품 코드에 테스트 전용 길(own_days) 없음 ·
6 공개 키(JWKS)를 못 받으면 503 AUTH_UNAVAILABLE, 모르는 kid면 60초에 한 번 다시 받기.
근거: TASK-012 §12 2·5·6, ADR-017 §2(공개 서버에 API 지도를 내놓지 않음), API-001 인증·저장소 오류 줄(AUTH_UNAVAILABLE), §10 Q2.

계약 (이 테스트가 정한 것, 승인 대기):
    api.auth.JwksCache(supabase_url, clock=<초를 돌려주는 함수, 기본 time.monotonic>) · .verify(token) -> user_id, 틀리면 AuthError
        처음 쓸 때 한 번 받는다. 모르는 kid면 마지막으로 받은 때부터 60초가 지났을 때만(경계: 정각 60초는 다시 받음) 다시 받는다
        다시 받은 목록에 그 kid가 있으면 통과. JWT 모양이 아니면 다시 받지 않는다
    공개 키를 처음부터 못 받으면 요청은 503 AUTH_UNAVAILABLE 공통 형식 (401 아님)
"""

import importlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.auth
from api.auth import AuthError, JwksCache
from auth_helpers import FAKE_JWKS, FAKE_KEY, FAKE_SUPABASE_URL, JWKS_URL, TESTER, FakeKey, bearer, install_fake_jwks, make_token, user_id
from storage_helpers import server_env

SERVER = Path(__file__).resolve().parents[1]
DOCS = ["/docs", "/redoc", "/openapi.json"]


# ---------- §12 5: 제품 코드에 own_days 없음 ----------


def test_T12_S12_5_제품_코드에_테스트_전용_own_days가_없다():
    skip = {"tests", "mutants", ".venv", "__pycache__", ".cache"}
    found = [
        str(path.relative_to(SERVER))
        for path in SERVER.rglob("*.py")
        if not skip.intersection(path.relative_to(SERVER).parts) and "own_days" in path.read_text(encoding="utf-8")
    ]
    assert found == []


# ---------- §12 2: 운영에서 /docs·/redoc·/openapi.json 끔 ----------


@pytest.fixture
def production(monkeypatch):
    import api.main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    install_fake_jwks(monkeypatch)
    try:
        yield importlib.reload(api.main).app
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)


@pytest.mark.parametrize("path", DOCS)
def test_T12_S12_2_운영이면_API_문서_길은_404(production, path):
    with TestClient(production) as client:
        assert client.get(path).status_code == 404
        assert client.get(path, headers=bearer(TESTER)).status_code == 404  # 토큰이 있어도


@pytest.mark.parametrize("path", DOCS)
def test_T12_S12_2_개발이면_API_문서_길은_열려_있다(monkeypatch, path):
    from api.main import app

    server_env(monkeypatch, "memory")
    monkeypatch.delenv("APP_ENV", raising=False)
    with TestClient(app) as client:
        assert client.get(path).status_code == 200


def test_T12_S11_S12_운영에서_토큰_없이_열린_길은_health·catalog뿐(production):
    from test_task012_auth import opened_without_token

    with TestClient(production, raise_server_exceptions=False) as client:
        assert opened_without_token(production, client) == []
        assert client.get("/health").status_code == 200
        assert client.get("/catalog").status_code == 200


# ---------- §12 6: JWKS를 못 받으면 503 AUTH_UNAVAILABLE ----------


def test_T12_S12_6_공개_키를_못_받으면_503_AUTH_UNAVAILABLE(monkeypatch):
    from api.main import app
    from test_task010_trips import Osaka

    server_env(monkeypatch, "memory")

    def down(url):
        raise OSError("Supabase에 못 붙음 (테스트)")

    monkeypatch.setattr(api.auth, "fetch_jwks", down)
    with TestClient(app, raise_server_exceptions=False) as client:
        osaka = Osaka(client, app)
        response = osaka.anon.get("/trips/current", headers=bearer(TESTER))
        assert response.status_code == 503, response.text
        error = response.json()["error"]
        assert error["code"] == "AUTH_UNAVAILABLE" and error["message"]
        assert FAKE_SUPABASE_URL not in response.text  # 원인 주소는 응답에 없다


def test_T12_S12_6_공개_키를_못_받아도_토큰이_없으면_401(monkeypatch):
    from api.main import app
    from test_task010_trips import Osaka

    server_env(monkeypatch, "memory")
    monkeypatch.setattr(api.auth, "fetch_jwks", lambda url: (_ for _ in ()).throw(OSError("down")))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = Osaka(client, app).anon.get("/trips/current")
        assert response.status_code == 401


# ---------- §12 6: 모르는 kid면 60초에 한 번 다시 받기 (시계 주입) ----------

NEW_KEY = FakeKey("fake-kid-rotated")  # 키 교체 뒤 새 키


class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def fetched(monkeypatch):
    """fetch_jwks를 부른 주소 목록. 돌려주는 JWKS는 lists[0]를 바꿔 끼워 정한다."""
    calls: list[str] = []
    current = [json.loads(json.dumps(FAKE_JWKS))]

    def fetch(url):
        calls.append(url)
        return json.loads(json.dumps(current[0]))

    monkeypatch.setattr(api.auth, "fetch_jwks", fetch)
    return calls, current


def rotated() -> dict:
    return {"keys": [FAKE_KEY.jwk(), NEW_KEY.jwk()]}


def test_T12_S12_6_처음_한_번만_받고_아는_kid는_다시_받지_않는다(fetched):
    calls, _ = fetched
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    for step in range(3):
        clock.now += 1000 * step
        assert cache.verify(make_token(user_id("a"))) == user_id("a")
    assert calls == [JWKS_URL]


@pytest.mark.parametrize(("later", "refetch"), [(59.999, False), (60.0, True), (60.001, True)], ids=["59.999초", "정각_60초", "60.001초"])
def test_T12_S12_6_모르는_kid는_마지막으로_받은_뒤_60초가_지났을_때만_다시_받는다(fetched, later, refetch):
    calls, current = fetched
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))  # 처음 받기
    current[0] = rotated()  # Supabase 쪽에서 키가 바뀌었다
    clock.now += later
    token = make_token(user_id("a"), key=NEW_KEY)
    if refetch:
        assert cache.verify(token) == user_id("a")  # 다시 받은 목록에 kid가 있으면 통과
        assert len(calls) == 2
    else:
        with pytest.raises(AuthError):
            cache.verify(token)
        assert len(calls) == 1


def test_T12_S12_6_다시_받은_뒤_60초_안의_두_번째_모르는_kid는_다시_받지_않고_60초_뒤엔_받는다(fetched):
    calls, current = fetched
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    stranger = make_token(user_id("a"), key=FakeKey("fake-kid-never"))
    clock.now += 60
    with pytest.raises(AuthError):
        cache.verify(stranger)  # 다시 받았지만 그 kid가 없다
    assert len(calls) == 2
    clock.now += 59.999
    with pytest.raises(AuthError):
        cache.verify(stranger)  # 60초 안: 다시 받지 않는다
    assert len(calls) == 2
    current[0] = rotated()
    clock.now += 0.001  # 다시 받은 때부터 정각 60초
    assert cache.verify(make_token(user_id("a"), key=NEW_KEY)) == user_id("a")
    assert len(calls) == 3
    assert cache.verify(make_token(user_id("b"), key=NEW_KEY)) == user_id("b")  # 이제 아는 kid
    assert len(calls) == 3


def test_T12_S12_6_아는_kid의_틀린_서명은_시간이_지나도_다시_받지_않는다(fetched):
    calls, _ = fetched
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    clock.now += 600
    with pytest.raises(AuthError):
        cache.verify(make_token(user_id("a"), key=FakeKey(FAKE_KEY.kid)))
    assert len(calls) == 1


@pytest.mark.parametrize("token", ["not-a-jwt", "", "a.b.c"])
def test_T12_S12_6_JWT_모양이_아니면_다시_받지_않는다(fetched, token):
    calls, _ = fetched
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    clock.now += 600
    with pytest.raises(AuthError):
        cache.verify(token)
    assert len(calls) == 1


def test_T12_S12_6_주소는_SUPABASE_URL_끝_빗금과_상관없이_JWKS_경로(fetched):
    calls, _ = fetched
    JwksCache(FAKE_SUPABASE_URL + "/", clock=Clock()).verify(make_token(user_id("a")))
    assert calls == [JWKS_URL]
