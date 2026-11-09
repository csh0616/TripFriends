"""TASK-012 A2 계약 테스트 공용: 메모리·Postgres 두 구현을 같은 방식으로 만든다. 판단 로직은 없다.

Postgres 쪽은 로컬 DB 주소 TEST_DATABASE_URL(§T)을 쓴다. 표(마이그레이션)는 이미 적용돼 있다고 본다 (`supabase start`·`supabase db reset`).
DB를 비우지 않는다: 테스트마다 새 uuid를 써서 서로 겹치지 않게 한다.
"""

import os
import uuid

import pytest

from auth_helpers import install_fake_jwks
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


def planning_repo(kind: str, city=None, clock=None) -> PlanningRepo:
    """§10 Q1: Postgres 쪽은 장소·좌표를 도시 데이터(city)에서 clock() 시각으로 되살린다. 메모리는 받은 값을 그대로 둔다."""
    if kind == "memory":
        return MemoryPlanningRepo()
    from store.postgres import PostgresPlanningRepo

    assert city is not None and clock is not None
    return PostgresPlanningRepo(db_url(), city, clock)


def trip_repo(kind: str) -> TripRepo:
    if kind == "memory":
        return MemoryTripRepo()
    from store.postgres import PostgresTripRepo

    return PostgresTripRepo(db_url())


def server_env(monkeypatch, kind: str) -> None:
    """서버를 켜기 전 환경: 가짜 오사카, 바깥 키 없음, 가짜 JWKS(§10 Q2). postgres면 DATABASE_URL = 로컬 테스트 DB."""
    for name in ("AI_GATEWAY_API_KEY", "APP_ENV", "GOOGLE_PLACES_API_KEY", "SERPER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    install_fake_jwks(monkeypatch)
    if kind == "postgres":
        monkeypatch.setenv("DATABASE_URL", db_url())
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
