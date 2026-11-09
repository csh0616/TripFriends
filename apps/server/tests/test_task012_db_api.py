"""TASK-012 §A 저장소를 API로 확인: 여행 계약(메모리·Postgres) · A3 트랜잭션 · A4 체크포인터 · AC-2 다시 켜도 그대로 · A5 데모.
근거: TASK-012 §A A2~A5·§6 "저장 중 예외"·§7 AC-1·AC-2·AC-3·AC-7, TASK-003 §10-11 R11·R12(알려진 한계 -> 여기서 해결),
TASK-010 §B2(여행 하나, 이전 여행은 archived), API-001 §1 오류 형식, ADR-016 §3-3(Bearer).

계약 (이 테스트가 정한 이름, 승인 대기):
    서버는 환경 변수 DATABASE_URL이 있으면 Postgres 저장소·Postgres 체크포인터로, 없으면 지금처럼 메모리로 켠다
    서버를 다시 켜는 것 = 같은 app으로 TestClient를 한 번 닫고 다시 연다 (lifespan을 다시 돈다)
    A3: 저장소 메서드(app.state.planning_repo의 클래스)가 저장 중간에 예외 -> 500 INTERNAL_ERROR 공통 형식,
        app.state의 snapshot() 가진 저장소 전부와 GET 결과가 요청 전과 같다
"""

import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import KINDS, server_env
from test_task010_trips import NOON, Osaka
from trip_helpers import stores

ME, YOU = "user-A", "user-B"


def open_server(app, raise_errors: bool = True):
    return TestClient(app, raise_server_exceptions=raise_errors)


def assert_common(response, status: int, code: str | None = None) -> dict:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert isinstance(error["code"], str) and error["message"]
    if code is not None:
        assert error["code"] == code
    return error


# ---------- A2 여행 저장(TripBook)의 계약: 메모리·Postgres 같은 결과 ----------


@pytest.mark.parametrize("kind", KINDS)
def test_T12_A2_여행_만들기·읽기·고정_일정·보관이_두_구현에서_같다(monkeypatch, kind):
    from api.main import app

    server_env(monkeypatch, kind)
    with open_server(app) as client:
        osaka = Osaka(client, app)
        first = osaka.make_trip(days=2, device=ME)
        assert osaka.current(ME).json()["trip_id"] == first["trip_id"]
        assert osaka.trip(first["trip_id"], ME).json() == first

        made = osaka.add_fixed(first, 0, "12:00", "13:00")
        assert made.status_code == 201, made.text
        day = osaka.trip(first["trip_id"], ME).json()["trip_days"][0]
        assert [e["fixed_event_id"] for e in day["fixed_events"]] == [made.json()["fixed_event_id"]]
        assert client.delete(f"/fixed-events/{made.json()['fixed_event_id']}", headers=bearer(ME)).status_code == 204
        assert osaka.trip(first["trip_id"], ME).json()["trip_days"][0]["fixed_events"] == []

        second = osaka.make_trip(days=1, offset=20, device=ME)
        assert osaka.current(ME).json()["trip_id"] == second["trip_id"]
        assert osaka.trip(first["trip_id"], ME).json()["status"] == "archived"  # 지우지 않고 보관 (§8)

        assert osaka.current(YOU).status_code == 404
        assert osaka.trip(second["trip_id"], YOU).status_code == 404


# ---------- A3 저장 중간 실패 -> DB가 요청 전과 같다 (AC-3) ----------


def boom(*_args, **_kwargs):
    raise RuntimeError("저장 중간 실패 (테스트가 일부러 낸 예외)")


@pytest.mark.db
def test_T12_A3_AC3_여행_만들기_저장_중간에_예외면_500이고_DB는_요청_전과_같다(monkeypatch):
    # TripBook.create는 날 저장(save_day) -> 여행 저장(save_trip) -> 이전 여행 보관 순서. 가운데서 실패시킨다
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        old = osaka.make_trip(days=2, device=ME)
        before = stores(osaka)
        with monkeypatch.context() as patch:
            patch.setattr(type(app.state.planning_repo), "save_trip", boom)
            assert_common(osaka.post_trip(_body(offset=30), ME), 500, "INTERNAL_ERROR")
        assert stores(osaka) == before
        current = osaka.current(ME).json()
        assert current["trip_id"] == old["trip_id"] and current["status"] == "active"  # 이전 여행이 보관되지 않았다


@pytest.mark.db
def test_T12_A3_AC3_고정_일정_저장_중간에_예외면_500이고_고정_일정이_남지_않는다(monkeypatch):
    # add_fixed는 고정 일정 저장 -> 그날 계획 다시 저장(save_day) 순서. 뒤쪽에서 실패시킨다
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        trip = osaka.make_trip(days=2, device=ME)
        before = stores(osaka)
        with monkeypatch.context() as patch:
            patch.setattr(type(app.state.planning_repo), "save_day", boom)
            assert_common(osaka.add_fixed(trip, 0, "12:00", "13:00"), 500, "INTERNAL_ERROR")
        assert stores(osaka) == before
        assert osaka.trip(trip["trip_id"], ME).json() == trip


def _body(offset: int) -> dict:
    from test_task010_trips import trip_body

    return trip_body(days=2, offset=offset)


# ---------- A4·AC-2·AC-7 서버를 다시 켜도 그대로 ----------


@pytest.mark.db
def test_T12_A4_계획_대화는_서버를_다시_켜도_그_자리에서_이어진다(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app) as client:
        osaka = Osaka(client, app)
        trip = osaka.make_trip(days=2, device=ME)
        day_id = trip["trip_days"][0]["day_id"]
        started = client.post(f"/days/{day_id}/planning", json={"mode": "conversation"}, headers=bearer(ME))
        assert started.status_code == 201, started.text
        session = started.json()
        sid = session["session_id"]
        first_choice = session["question"]["choices"][0]["id"]
        answered = client.post(f"/planning/{sid}/answer", json={"choice_ids": [first_choice]}, headers=bearer(ME))
        assert answered.status_code == 200, answered.text
        candidate = answered.json()["candidates"][0]["place"]["id"]
        liked = client.post(f"/planning/{sid}/reactions", json={"place_id": candidate, "action": "like"}, headers=bearer(ME))
        assert liked.status_code == 200, liked.text
        before = client.get(f"/planning/{sid}", headers=bearer(ME)).json()

    with open_server(app) as client:  # 서버를 다시 켠다
        app.state.clock = lambda: NOON
        again = client.get(f"/planning/{sid}", headers=bearer(ME))
        assert again.status_code == 200, again.text
        assert again.json() == before
        assert again.json()["picks_count"] == 1
        more = client.post(f"/planning/{sid}/next", json={}, headers=bearer(ME))  # 멈춘 자리에서 다음 묶음
        assert more.status_code == 200, more.text


@pytest.mark.db
def test_T12_AC2_AC7_여행·날짜_목록·고른_코스는_서버를_다시_켜도_그대로(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app) as client:
        osaka = Osaka(client, app)
        trip = osaka.make_trip(days=2, device=ME)
        day_id = trip["trip_days"][0]["day_id"]
        osaka.plan_and_select(day_id)
        listed = osaka.current(ME).json()
        chosen = client.get(f"/days/{day_id}/course", headers=bearer(ME)).json()

    with open_server(app) as client:
        osaka = Osaka(client, app)
        assert osaka.current(ME).json() == listed
        assert client.get(f"/days/{day_id}/course", headers=bearer(ME)).json() == chosen


@pytest.mark.db
def test_T12_A5_데모_시드도_DB에_저장되고_다시_켜도_그_사용자의_지금_여행(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app) as client:
        seeded = client.post("/debug/seed-demo", json={"chosen": True}, headers=bearer(ME))
        assert seeded.status_code == 201, seeded.text
        trip_id = seeded.json()["trip_id"]
    with open_server(app) as client:
        osaka = Osaka(client, app)
        assert osaka.current(ME).json()["trip_id"] == trip_id


@pytest.mark.db
def test_T12_A5_데모는_로그인_없이도_만들어진다_DB_모드(monkeypatch):
    # §6: 데모는 로그인 없이
    from api.main import app

    server_env(monkeypatch, "postgres")
    with open_server(app) as client:
        seeded = client.post("/debug/seed-demo")
        assert seeded.status_code == 201, seeded.text
        assert set(seeded.json()) == {"trip_id", "day_ids"}
