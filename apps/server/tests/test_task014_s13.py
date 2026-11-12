"""TASK-014 §13 reviewer 점검 답: 5 거짓 늦어짐(실제 모드 재현) · 3 접근 로그의 쿼리 통째로 지움·인코딩 키 · §12 순서 돌연변이 보강 (서버, 메모리).

근거: TASK-014 §13 5("위치 없는 고정 일정은 이동 시간으로 늦어짐을 판단하지 않고 시각으로만(T-07)", 하루 끝 T-08)·3("접근 로그에서 쿼리 문자열을
통째로 지운다", `%6Cat`·이중 인코딩·대문자 LAT -> 400, 로그에 값 0), TASK-007 §A(늦어짐 감지 A1~A5)·B-4, TASK-006 §12 R1(하루 끝 T-08)·§11 Q15,
TASK-010 §B2(고정 일정, 장소 없음 가능), §11·§12(연습 기록 적용 = 실제 적용).
"""

import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import server_env
from test_task010_trips import Osaka

_RUN = uuid.uuid4().hex[:8]
ME = f"user-T14-s13-{_RUN}"
D_LAT, D_LNG = 0.000213, 0.000341  # 장소에서 약 37m (감지 반경 150m 안)


@pytest.fixture
def osaka(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "memory")
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def minutes_of(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:5])


def dinner_day(osaka: Osaka) -> tuple[str, str]:
    """reviewer가 본 날: [+ 일정]으로 넣은 위치 없는 고정 일정 "Dinner 18:30–19:30" + 자동 계획 -> 첫 안 고르기."""
    trip = osaka.make_trip(days=2, offset=7, device=ME)
    made = osaka.add_fixed(trip, 0, "18:30", "19:30", title="Dinner", device=ME)
    assert made.status_code == 201, made.text
    day = trip["trip_days"][0]
    started = osaka.client.post(f"/days/{day['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    chosen = osaka.client.post(f"/course-options/{started.json()['options'][0]['option_id']}/select")
    assert chosen.status_code == 200, chosen.text
    return day["day_id"], day["date"]


def now(osaka: Osaka, day_id: str, date: str, clock: str) -> dict:
    response = osaka.client.get(f"/days/{day_id}/now", params={"at": f"{date}T{clock}:00"})
    assert response.status_code == 200, response.text
    return response.json()


def check(osaka: Osaka, day_id: str, date: str, clock: str, position) -> dict:
    body = {"at": f"{date}T{clock}:00", "lat": position[0], "lng": position[1]}
    response = osaka.client.post(f"/days/{day_id}/check", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def last_place_before(osaka: Osaka, day_id: str, date: str, clock: str) -> dict:
    """그 시각 전에 끝나는 마지막 장소 핀 (위치 없는 고정 일정은 핀이 없다)."""
    pins = [p for p in now(osaka, day_id, date, "12:00")["pins"] if minutes_of(p["end"]) <= minutes_of(clock)]
    assert pins, "시험 자체 확인: 저녁 전에 장소가 있다"
    return pins[-1]


def near(pin: dict) -> tuple[float, float]:
    return (round(pin["lat"] + D_LAT, 6), round(pin["lng"] + D_LNG, 6))


def cards(view: dict) -> list[dict]:
    return [view["main"], *view["subs"]]


# =====================================================================
# §13 5 거짓 늦어짐 — 실제 모드(rehearsal 없음)
# =====================================================================


def test_T14_S13_5_시험_자체_확인_저녁은_코스에_있고_장소_핀은_없다(osaka):
    day_id, date = dinner_day(osaka)
    view = now(osaka, day_id, date, "12:00")
    assert all(p["start"] != "18:30" for p in view["pins"])  # 위치 없는 고정 일정은 지도 핀이 아니다
    assert view["day"]["fixed"] and view["day"]["fixed"][0]["start"] == "18:30"


@pytest.mark.parametrize("clock", ["18:31", "18:45", "19:00", "19:29"])
def test_T14_S13_5_실제_저녁_중_마지막_장소_근처에_있어도_늦어짐이_아니다(osaka, clock):
    # 위치 없는 고정 일정(저녁)은 이동 시간으로 늦어짐을 판단하지 않는다 (§13 5). 저녁 가게가 마지막 장소 근처일 수 있다
    day_id, date = dinner_day(osaka)
    pin = last_place_before(osaka, day_id, date, "18:30")
    view = check(osaka, day_id, date, clock, near(pin))
    assert view["event"] is None, view["event"]
    assert view["status"] != "delayed", view["status_text"]
    assert "T-04" not in [c["type"] for c in cards(view)]


@pytest.mark.parametrize("clock", ["19:31", "19:50", "20:30"])
def test_T14_S13_5_실제_저녁이_끝난_뒤에는_늦어짐이_아니고_하루_끝_T_08(osaka, clock):
    # 마지막 일정(저녁 19:30) 뒤 = 하루 끝 (TASK-006 §12 R1). 마지막 장소 근처에 그대로 있어도 "80분 늦어지는 중"이 아니다
    day_id, date = dinner_day(osaka)
    pin = last_place_before(osaka, day_id, date, "18:30")
    view = check(osaka, day_id, date, clock, near(pin))
    assert view["event"] is None, view["event"]
    assert view["status"] != "delayed", view["status_text"]
    assert view["main"]["type"] == "T-08", [c["type"] for c in cards(view)]


def test_T14_S13_5_실제_저녁_전_15분에_마지막_장소에_있으면_시각으로만_T_07(osaka):
    # 원칙: 위치 없는 고정 일정은 시각으로만(T-07, 고정 일정 임박). 늦어짐 사건(T-04)은 만들지 않는다
    day_id, date = dinner_day(osaka)
    pin = last_place_before(osaka, day_id, date, "18:30")
    view = check(osaka, day_id, date, "18:15", near(pin))
    assert view["event"] is None, view["event"]
    assert "T-04" not in [c["type"] for c in cards(view)]


def test_T14_S13_5_경계_위치_있는_다음_장소로는_지금처럼_늦어짐을_감지한다(osaka):
    # 고친 뒤에도 장소 사이 늦어짐(TASK-007 A1~A4)은 그대로: 저녁 전 장소들 사이에서 20분 늦으면 사건
    day_id, date = dinner_day(osaka)
    pins = now(osaka, day_id, date, "12:00")["pins"]
    here, following = pins[0], pins[1]
    leave = minutes_of(following["start"]) - following["travel_min"]
    view = check(osaka, day_id, date, hhmm(leave + 20), near(here))
    assert view["event"] is not None and view["event"]["delay_min"] == 20
