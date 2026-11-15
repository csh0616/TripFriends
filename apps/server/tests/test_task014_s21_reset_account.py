"""TASK-014 §21: Maestro account-link가 시작할 때 로컬 개발 환경에서만 고정 테스트 계정(link-new@example.test)을 지운다.

근거: TASK-014 §21 "로컬 개발 환경에서만 … 개발 전용, 클라우드엔 닿지 않게", §8(클라우드 Supabase에 테스트 데이터 금지),
API-001 `/debug/*`(개발 전용, 운영 404), TASK-012 §T(로컬 주소 = 127.0.0.1 · ::1 · localhost, conftest._LOOPBACK).

계약 (이 테스트가 정한 것, 승인 대기 — 질문 4):
    POST /debug/reset-test-account  (본문 없음). Bearer 필요 — 토큰 없이 열린 길은 health·catalog뿐(TASK-012 §11 Q1)이라 다른 /debug/*와 같다.
      부르는 쪽 = 앱의 개발용 가짜 로그인 'new'(src/lib/dev-login.ts)가 updateUser 직전에 자기 익명 토큰으로 (앱 테스트 task-014-s21-dev-reset)
      - 토큰 없으면 401 (기존 Gate 규칙 그대로)
      - APP_ENV=production이면 길 자체가 없다 -> 404 NOT_FOUND detail.resource = "route" (다른 /debug/*와 같다)
      - DATABASE_URL이 없거나(메모리) 그 호스트가 로컬(127.0.0.1 · ::1 · localhost)이 아니면 -> 404 route. DB에 연결하지 않는다
      - 로컬이면 auth.users에서 email = 'link-new@example.test' 행만 지우고 204 (없어도 204). 본문으로 다른 이메일을 줘도 무시
"""

import importlib

import psycopg
import pytest
from fastapi.testclient import TestClient

from auth_helpers import TESTER, bearer, install_fake_jwks
from storage_helpers import db_url

PATH = "/debug/reset-test-account"
NEW_EMAIL = "link-new@example.test"
EXISTING_EMAIL = "link-existing@example.test"
LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
AUTH = bearer(TESTER)


def _env(monkeypatch, database_url: str | None) -> None:
    for name in ("AI_GATEWAY_API_KEY", "APP_ENV", "GOOGLE_PLACES_API_KEY", "SERPER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    install_fake_jwks(monkeypatch)
    if database_url is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", database_url)


def _record_connects(monkeypatch) -> list[str]:
    """psycopg.connect를 부른 주소를 쌓고, 실제로는 붙지 않는다 (OperationalError)."""
    urls: list[str] = []

    def fake_connect(conninfo="", *args, **kwargs):
        urls.append(str(conninfo))
        raise psycopg.OperationalError("시험: 연결하지 않음")

    monkeypatch.setattr(psycopg, "connect", fake_connect)
    return urls


def _is_route_404(response) -> bool:
    if response.status_code != 404:
        return False
    error = response.json()["error"]
    return error["code"] == "NOT_FOUND" and (error.get("detail") or {}).get("resource") == "route"


# ---------- 로컬이 아니면 거부 ----------


def test_T14_S21_4_메모리_저장소면_404_route(monkeypatch):
    from api.main import app

    _env(monkeypatch, None)
    with TestClient(app) as client:
        response = client.post(PATH, headers=AUTH)
        assert _is_route_404(response), response.text


def test_T14_S21_4_토큰이_없으면_401(monkeypatch):
    from api.main import app

    _env(monkeypatch, LOCAL_URL)
    urls = _record_connects(monkeypatch)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(PATH)
    assert response.status_code == 401, response.text
    assert urls == []


@pytest.mark.parametrize(
    "host",
    [
        "db.abcdefghijkl.supabase.co",
        "aws-0-ap-northeast-1.pooler.supabase.com",
        "10.0.0.5",
        "192.168.0.10",
        "localhost.example.test",
        "127.0.0.1.nip.io",
    ],
)
def test_T14_S21_4_경계_DB_주소가_로컬이_아니면_404_route이고_연결하지_않는다(monkeypatch, host):
    from api.main import app

    _env(monkeypatch, f"postgresql://postgres@{host}:5432/postgres")
    urls = _record_connects(monkeypatch)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(PATH, headers=AUTH)
        assert _is_route_404(response), response.text
        assert _is_route_404(client.post(PATH, json={"email": NEW_EMAIL}, headers=AUTH))
    assert [url for url in urls if host in url] == []


def test_T14_S21_4_운영이면_로컬_DB여도_404_route이고_연결하지_않는다(monkeypatch):
    import api.main

    _env(monkeypatch, LOCAL_URL)
    monkeypatch.setenv("APP_ENV", "production")
    urls = _record_connects(monkeypatch)
    try:
        with TestClient(importlib.reload(api.main).app, raise_server_exceptions=False) as client:
            assert _is_route_404(client.post(PATH, headers=AUTH))
        assert urls == []
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)


# ---------- 로컬이면 그 로컬 DB에만 붙는다 (CI에서도 도는 것: 연결은 가짜) ----------


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "[::1]"])
def test_T14_S21_4_로컬_DB면_길이_있고_그_로컬_주소에만_붙으려_한다(monkeypatch, host):
    from api.main import app

    _env(monkeypatch, f"postgresql://postgres@{host}:54322/postgres")
    urls = _record_connects(monkeypatch)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(PATH, headers=AUTH)
    assert response.status_code == 503, response.text  # 가짜 연결이 실패 -> 기존 STORAGE_UNAVAILABLE (길이 있고 DB에 붙으려 했다)
    assert response.json()["error"]["code"] == "STORAGE_UNAVAILABLE"
    assert urls, "로컬 DB에 붙으려 하지 않았다"
    assert all(host in url for url in urls)


# ---------- 실제 로컬 DB (db 표시, auth 스키마가 있는 로컬 Supabase에서만) ----------


def _auth_users_exists(conn) -> bool:
    return conn.execute("select to_regclass('auth.users') is not null").fetchone()[0]


def _count(conn, email: str) -> int:
    return conn.execute("select count(*) from auth.users where email = %s", (email,)).fetchone()[0]


@pytest.mark.db
def test_T14_S21_4_로컬_DB에서_link_new만_지우고_204_다른_계정은_그대로(monkeypatch):
    from api.main import app

    url = db_url()
    with psycopg.connect(url, autocommit=True) as conn:
        if not _auth_users_exists(conn):
            pytest.skip("auth.users가 없는 로컬 Postgres (로컬 Supabase에서만 확인)")
        if _count(conn, NEW_EMAIL) == 0:
            conn.execute(
                "insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) "
                "values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', %s, now(), now())",
                (NEW_EMAIL,),
            )
        existing_before = _count(conn, EXISTING_EMAIL)

    _env(monkeypatch, url)
    with TestClient(app, headers=AUTH) as client:
        first = client.post(PATH, json={"email": EXISTING_EMAIL})  # 본문 이메일은 무시
        assert first.status_code == 204, first.text
        again = client.post(PATH)  # 이미 없어도 204
        assert again.status_code == 204, again.text

    with psycopg.connect(url, autocommit=True) as conn:
        assert _count(conn, NEW_EMAIL) == 0
        assert _count(conn, EXISTING_EMAIL) == existing_before


# ---------- §22 Q4: 지우는 건 고정 테스트 이메일 하나뿐, 다른 값은 받지 않는다 ----------
# 문서는 "무시"인지 "거부"인지 정하지 않았다 -> 응답은 기존 계약(204) 그대로, 다른 계정이 지워지지 않고 고정 이메일만 지워짐을 본다

_EMAIL = __import__("re").compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")


def _server_sources():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    skip = {"tests", ".venv", "mutants", "__pycache__"}
    for path in root.rglob("*.py"):  # .py만 읽는다 (.env는 읽지 않는다)
        if not skip.intersection(path.relative_to(root).parts):
            yield path


def test_T14_S22_Q4_서버_코드의_이메일_값은_link_new_하나_한_번뿐():
    found = [(str(path.name), email) for path in _server_sources() for email in _EMAIL.findall(path.read_text(encoding="utf-8"))]
    assert [email for _, email in found] == [NEW_EMAIL], found


def _insert_user(conn, email: str) -> str:
    return str(
        conn.execute(
            "insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) "
            "values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', %s, now(), now()) returning id",
            (email,),
        ).fetchone()[0]
    )


@pytest.mark.db
@pytest.mark.parametrize(
    "how",
    ["본문_email", "본문_user_id", "쿼리_email", "쿼리_user_id", "본문·쿼리_모두"],
)
def test_T14_S22_Q4_다른_이메일·user_id를_보내도_그_계정은_그대로_고정_이메일만_지운다(monkeypatch, how):
    import uuid

    from api.main import app

    url = db_url()
    other_email = f"reset-other-{uuid.uuid4().hex[:8]}@example.test"
    with psycopg.connect(url, autocommit=True) as conn:
        if not _auth_users_exists(conn):
            pytest.skip("auth.users가 없는 로컬 Postgres (로컬 Supabase에서만 확인)")
        other_id = _insert_user(conn, other_email)
        if _count(conn, NEW_EMAIL) == 0:
            _insert_user(conn, NEW_EMAIL)
        existing_before = _count(conn, EXISTING_EMAIL)

    body = {"email": other_email} if how == "본문_email" else {"user_id": other_id} if how == "본문_user_id" else None
    query = {"email": other_email} if how == "쿼리_email" else {"user_id": other_id} if how == "쿼리_user_id" else None
    if how == "본문·쿼리_모두":
        body = {"email": other_email, "user_id": other_id, "emails": [other_email, EXISTING_EMAIL]}
        query = {"email": EXISTING_EMAIL, "user_id": other_id}

    _env(monkeypatch, url)
    try:
        with TestClient(app, headers=AUTH) as client:
            response = client.post(PATH, json=body, params=query)
        assert response.status_code == 204, response.text
        with psycopg.connect(url, autocommit=True) as conn:
            assert _count(conn, other_email) == 1  # 보낸 값의 계정은 그대로
            assert _count(conn, EXISTING_EMAIL) == existing_before
            assert _count(conn, NEW_EMAIL) == 0  # 고정 이메일만 지운다
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("delete from auth.users where email = %s", (other_email,))  # 이 테스트가 넣은 것만 치운다
