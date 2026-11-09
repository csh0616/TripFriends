"""TASK-010 §E 넘어온 것 (서버 몫). 근거: TASK-010 §E2·§E5, TASK-008 §14~§16(retime), API-001 §2-3·§4(위치는 저장 안 함), TASK-007 B-4.

E2: trip/retime.py에서 살아남은 돌연변이 2개 = `_rules().open_all_day`의 10**6 -> 11**6 / 10**7.
    "영업시간 모름 = 하루 종일 열림"의 끝을 엔진(`_Day.intervals`)과 같은 값으로 고정한다: 끝에 딱 맞으면 들어가고 1분 넘으면 못 들어간다.
E5: 서버 요청 로그(서버 쪽 로거 전부, 테스트 클라이언트 httpx 로그는 뺌)에 위치 값이 찍히지 않는다.
    §9 Q19: uvicorn 요청 줄(로거 "uvicorn.access")은 남기고, 쿼리로 위치가 와도 위치 값만 가린다.
"""

from auth_helpers import TESTER, bearer  # TASK-012 §10 Q4: 계획·여행 중 API도 Bearer
import logging
from datetime import date

import pytest
from fastapi.testclient import TestClient

from engine.models import DayPlan, Place, StayRange
from engine.planning import _Day, distance_km, travel_min
from trip.retime import Slot, retime

BASE = (35.0, 135.0)
DAY = date(2026, 12, 2)


def unknown_hours_place() -> Place:
    return Place(
        id="U1", name="영업시간 모르는 곳", category="cafe", lat=BASE[0] + 0.01, lng=BASE[1], crowd_level=2, price_level=2,
        mood_tags=[], hours=None, hours_status="unknown", stay=StayRange(min=30, typical=60, max=90),
    )


def engine_all_day_end(place: Place) -> int:
    """엔진이 정한 '영업시간 모름'의 하루 끝 (분). retime 규칙은 엔진과 같다 (retime.py 머리말)."""
    plan = DayPlan(date=DAY, start="10:00", end="20:00", lodging=BASE, fixed=[], must_visit=[], stay_overrides={})
    [(low, high)] = _Day(plan, {place.id: place}).intervals(place)
    assert low == 0
    return high


def run(stay: int):
    place = unknown_hours_place()
    tt = travel_min(distance_km(BASE, (place.lat, place.lng)))
    slot = Slot(place_id=place.id, stay_min=stay, stay_source="auto", is_fixed=False, start="00:00", end="00:00", coord=None)
    # 하루 끝·숙소 복귀가 막지 않게 아주 크게 둔다. 출발 0분, 숙소 = 출발점
    return retime([slot], {place.id: place}, DAY.weekday(), BASE, 0, 0, 10**9, (place.lat, place.lng), 1), tt


def test_T10_E2_영업시간_모름의_하루_끝에_딱_맞으면_들어간다():
    end = engine_all_day_end(unknown_hours_place())
    tt = travel_min(distance_km(BASE, (unknown_hours_place().lat, unknown_hours_place().lng)))
    result, _ = run(end - tt)  # 도착(tt) + 머무는 시간 = 끝
    assert result is not None
    items, _ = result
    assert items[0].wait_min == 0 and items[0].hours_status == "unknown"


def test_T10_E2_영업시간_모름의_하루_끝을_1분_넘으면_못_들어간다():
    end = engine_all_day_end(unknown_hours_place())
    tt = travel_min(distance_km(BASE, (unknown_hours_place().lat, unknown_hours_place().lng)))
    result, _ = run(end - tt + 1)
    assert result is None


# ---------- E5 요청 로그에 위치 값이 없다 ----------

LAT, LNG = "35.123457", "135.987654"  # 다른 어디에도 없는 수
MARKS = (LAT, LNG, LAT[:7], LNG[:8])


def server_messages(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore"))]


def assert_no_position(caplog) -> None:
    for message in server_messages(caplog):
        for mark in MARKS:
            assert mark not in message, message


@pytest.fixture
def chosen_day(env):
    response = env.client.post("/debug/seed-demo", json={"chosen": True})
    assert response.status_code == 201, response.text
    return response.json()["day"]["day_id"]


def test_T10_E5_check_본문의_위치가_로그에_없다(env, chosen_day, caplog):
    caplog.set_level(logging.DEBUG)
    response = env.client.post(f"/days/{chosen_day}/check", json={"at": "2026-12-02T12:00", "lat": float(LAT), "lng": float(LNG)})
    assert response.status_code == 200, response.text
    assert_no_position(caplog)


def test_T10_E5_틀린_위치로_400이어도_로그에_없다(env, chosen_day, caplog):
    caplog.set_level(logging.DEBUG)
    response = env.client.post(f"/days/{chosen_day}/check", json={"at": "2026-12-02T12:00", "lat": 95.123457, "lng": float(LNG)})
    assert response.status_code == 400, response.text
    assert_no_position(caplog)


def test_T10_E5_처리_중_500이어도_로그에_위치가_없다(env, chosen_day, caplog, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("테스트용 실패")

    monkeypatch.setattr(env.app.state.trip_service, "check", boom)
    caplog.set_level(logging.DEBUG)
    client = TestClient(env.app, headers=bearer(TESTER), raise_server_exceptions=False)  # 서버 시작은 env가 이미 했다. 500 응답을 그대로 받는다
    response = client.post(f"/days/{chosen_day}/check", json={"at": "2026-12-02T12:00", "lat": float(LAT), "lng": float(LNG)})
    assert response.status_code == 500
    assert server_messages(caplog), "500은 로그를 남긴다 (원인은 로그에만, TASK-003 R11)"
    assert_no_position(caplog)


def test_T10_E5_now_쿼리에_위치가_와도_로그에_없다(env, chosen_day, caplog):
    caplog.set_level(logging.DEBUG)
    env.client.get(f"/days/{chosen_day}/now", params={"at": "2026-12-02T12:00", "lat": LAT, "lng": LNG})
    assert_no_position(caplog)


def test_T10_E5_요청_줄_로그에_쿼리_위치가_남지_않는다(env, caplog):
    """uvicorn이 남기는 요청 줄 모양 그대로 (클라이언트, 메서드, 경로+쿼리, HTTP 판, 상태). 서버가 켜진 뒤의 로거 설정으로 거른다."""
    caplog.set_level(logging.DEBUG)
    path = f"/days/d1/now?at=2026-12-02T12:00&lat={LAT}&lng={LNG}"
    logging.getLogger("uvicorn.access").info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:50000", "GET", path, "1.1", 200)
    assert [r for r in caplog.records if r.name == "uvicorn.access"], "요청 줄 자체는 남는다"
    assert_no_position(caplog)
