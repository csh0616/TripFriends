"""TASK-012 A2 계약 테스트 공용: 메모리·Postgres 두 구현을 같은 방식으로 만든다. 판단 로직은 없다.

Postgres 쪽은 로컬 DB 주소 TEST_DATABASE_URL(§T)을 쓴다. 표(마이그레이션)는 이미 적용돼 있다고 본다 (`supabase start`·`supabase db reset`).
DB를 비우지 않는다: 테스트마다 새 uuid를 써서 서로 겹치지 않게 한다.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from auth_helpers import FAKE_JWT_SECRET, JWT_SECRET_ENV
from conftest import TEST_DB_ENV
from planning.repo import MemoryPlanningRepo, PlanningRepo
from trip.repo import MemoryTripRepo, TripRepo

KINDS = ["memory", pytest.param("postgres", marks=pytest.mark.db)]


def new_id() -> str:
    return str(uuid.uuid4())


def db_url() -> str:
    url = os.environ.get(TEST_DB_ENV)
    assert url, f"{TEST_DB_ENV}가 없다 (db 표시 테스트는 conftest가 건너뛴다)"
    return url


def planning_repo(kind: str) -> PlanningRepo:
    if kind == "memory":
        return MemoryPlanningRepo()
    from store.postgres import PostgresPlanningRepo

    return PostgresPlanningRepo(db_url())


def trip_repo(kind: str) -> TripRepo:
    if kind == "memory":
        return MemoryTripRepo()
    from store.postgres import PostgresTripRepo

    return PostgresTripRepo(db_url())


def server_env(monkeypatch, kind: str) -> None:
    """서버를 켜기 전 환경: 가짜 오사카, 바깥 키 없음, 가짜 JWT 비밀값. postgres면 DATABASE_URL = 로컬 테스트 DB."""
    for name in ("AI_GATEWAY_API_KEY", "APP_ENV", "GOOGLE_PLACES_API_KEY", "SERPER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    monkeypatch.setenv(JWT_SECRET_ENV, FAKE_JWT_SECRET)
    if kind == "postgres":
        monkeypatch.setenv("DATABASE_URL", db_url())
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)


def start(app, raise_errors: bool = True):
    """서버 한 번 켜기 (with 블록 = lifespan). Osaka 도우미를 돌려준다."""
    from test_task010_trips import Osaka

    client = TestClient(app, raise_server_exceptions=raise_errors)
    client.__enter__()
    return client, Osaka(client, app)
