"""TASK-006 §A: GET /days/{day_id}/now. 근거: TASK-006 §14 > §13 > §12 > §11 > A1~A5·§A-1·§A-2·§6·§8 AC-2~4, SCREEN-001 §3-2·§4·§5, GRAPH-001 §6.

"Q숫자"는 §11의 답, "R숫자"는 §12의 답이다.
"""

import logging
import re
from datetime import date, time
from urllib.parse import parse_qs, urlparse

import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from planning_api_helpers import assert_error, week_hours
from planning_helpers import day_plan, fixed_event, hhmm, north_of, place

from catalog import CourseItem as CatalogItem
from catalog import NowProps
from engine.compose import REASONS, OpenEvent, PlanItem, Snapshot, compose_screen
from engine.models import CourseItem, CourseOption, Place, StayRange
from planning.repo import OptionRecord
from planning.schemas import DaySummary

DAY = date(2026, 12, 2)
SUPPORTED = {"T-01", "T-02", "T-03", "T-07", "T-08"}  # A3
NOW_KEYS = {"day", "at", "status", "status_text", "reason", "main", "subs", "chip", "pins", "route", "position"}
ITEM_KEYS = {"seq", "place_id", "name", "start", "end", "lat", "lng", "is_fixed", "facts"}  # §A-1 CourseItemView
FACT_KEYS = {"field", "value", "status", "source_type", "checked_at"}
PIN_KEYS = {"seq", "place_id", "name", "lat", "lng", "start", "end", "travel_min", "state"}  # §11 Q15: start·end, §12 R6: travel_min
CARD_KEYS = {  # §A-1 표, §11 Q8: 평평하게
    "T-01": {"type", "item", "ends_in_min"},
    "T-02": {"type", "next_item", "leave_at", "leave_in_min", "travel_min", "map_url"},
    "T-03": {"type", "items"},
    "T-07": {"type", "fixed", "leave_by", "leave_in_min"},
    "T-08": {"type", "go_home_min", "lodging", "map_url"},  # map_url: §13 E4
}
DAY_OVER = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # §12 R1
ON_TRACK = "동선대로 가는 중"
DELAYED = "늦어지는 중"
FREE = "다음까지 여유 있음"


# ---------- 코스 심기 (저장소에 바로 넣는다) ----------


def plan_item(seq: int, pid: str | None, start: str, end: str, travel: int, fixed: bool = False, wait: int = 0) -> CourseItem:
    h1, m1 = map(int, start.split(":"))
    h2, m2 = map(int, end.split(":"))
    return CourseItem(
        seq=seq,
        place_id=pid,
        start=start,
        end=end,
        stay_min=(h2 * 60 + m2) - (h1 * 60 + m1),
        stay_source="auto",
        travel_min=travel,
        wait_min=wait,
        is_fixed=fixed,
        hours_status="confirmed",
    )


def plant(env, items: list[CourseItem], fixed=(), places: dict[str, Place] | None = None, go_home: int = 25, end: str = "23:00") -> str:
    """고른 코스가 있는 하루. 장소는 항목마다 북쪽으로 1km씩 떨어져 있다."""
    if places is None:
        places = {}
        for number, entry in enumerate(items, start=1):
            places[entry.place_id] = place(entry.place_id, km=float(number), hours=week_hours())
    plan = day_plan(start="10:00", end=end, fixed=tuple(fixed), day=DAY)
    day_id = env.plant_day(places, plan, day_number=2)
    option = CourseOption(label="relaxed", items=items, dropped=[], go_home_min=go_home, total_travel_min=sum(i.travel_min for i in items))
    env.repo.save_options([OptionRecord(f"opt-{day_id}", "planted-session", [], option)])
    env.repo.choose_option(day_id, f"opt-{day_id}")
    return day_id


def plain_items() -> list[CourseItem]:
    """1번 출발 10:00, 2번 출발 12:00, 3번 출발 14:00. 마지막 일정은 19:00(18:00 뒤)에 끝난다."""
    return [
        plan_item(1, "P01", "10:12", "12:00", 12),
        plan_item(2, "P02", "12:20", "14:00", 20),
        plan_item(3, "P03", "14:30", "19:00", 30),
    ]


@pytest.fixture
def plain(env) -> str:
    return plant(env, plain_items())


@pytest.fixture
def with_fixed(env) -> str:
    """2번이 고정 일정: 15:00 시작, 이동 20분 → 늦지 않으려면 14:40 출발."""
    items = [
        plan_item(1, "P01", "10:12", "14:40", 12),
        plan_item(2, "F01", "15:00", "16:00", 20, fixed=True),
        plan_item(3, "P03", "16:30", "19:00", 30),
    ]
    places = {
        "P01": place("P01", km=1.0, hours=week_hours()),
        "F01": place("F01", km=2.0, hours=week_hours()),
        "P03": place("P03", km=3.0, hours=week_hours()),
    }
    return plant(env, items, fixed=[fixed_event("15:00", "16:00", places["F01"])], places=places)


def at_time(clock: str, day: str = "2026-12-02") -> str:
    return f"{day}T{clock}:00" if clock.count(":") == 1 else f"{day}T{clock}"


def get_now(env, day_id: str, clock: str, **params):
    return env.client.get(f"/days/{day_id}/now", params={"at": at_time(clock), **params})


def now(env, day_id: str, clock: str, **params) -> dict:
    response = get_now(env, day_id, clock, **params)
    assert response.status_code == 200, response.text
    return response.json()


def pin_states(view: dict) -> dict[int, str]:
    return {pin["seq"]: pin["state"] for pin in view["pins"]}


def types(cards: list[dict]) -> list[str]:
    return [card["type"] for card in cards]


# ---------- 시험 틈: compose_screen을 부르는 자리 (백엔드 계약: trip/now.py의 모듈 이름 compose_screen) ----------


@pytest.fixture
def seen(monkeypatch) -> list:
    """compose_screen이 받은 Snapshot을 모은다. 결과는 진짜 함수 그대로."""
    calls: list = []

    def spy(snapshot):
        calls.append(snapshot)
        return compose_screen(snapshot)

    monkeypatch.setattr("trip.now.compose_screen", spy)
    return calls


def force(monkeypatch, change) -> None:
    """서버가 만든 Snapshot을 바꿔 진짜 compose_screen에 넣는다 (AC-4 "강제")."""
    monkeypatch.setattr("trip.now.compose_screen", lambda s: compose_screen(s.model_copy(update=change(s))))


# ---------- A1 ----------


def test_AC3_A1_고른_코스가_있으면_200(env, plain):
    assert get_now(env, plain, "13:20").status_code == 200


def test_A1_고른_코스가_없으면_404_resource_course(env):
    day_id = env.plant_day({"P01": place("P01", hours=week_hours())}, day_plan(day=DAY))
    error = assert_error(get_now(env, day_id, "13:20"), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "course"


def test_A1_코스안을_계산만_하고_고르지_않았으면_404_course(env):
    seeded = env.seed()
    day_id = seeded["day_ids"][1]
    env.composing(day_id)
    error = assert_error(get_now(env, day_id, "13:20"), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "course"


def test_A1_TASK004_A7_없는_날은_404_resource_day(env):
    error = assert_error(get_now(env, "없는-날", "13:20"), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "day"


def test_A1_select로_고른_안이_그대로_쓰인다(env):
    day_id = env.seed()["day_ids"][1]
    _, course = env.composing(day_id)
    chosen = course["options"][-1]
    assert env.select(chosen["option_id"]).status_code == 200
    view = env.client.get(f"/days/{day_id}/now", params={"at": "2026-12-02T10:00:00"}).json()
    assert [pin["place_id"] for pin in view["pins"]] == [entry["place_id"] for entry in chosen["items"]]


# ---------- AC-3: §A-1 모양 ----------


def assert_facts(facts: list[dict]) -> None:
    for fact in facts:
        assert set(fact) == FACT_KEYS
        assert fact["status"] in {"confirmed", "unverified", "unknown"}


def assert_hhmm(value: str) -> None:
    assert re.fullmatch(r"[0-9]{2}:[0-9]{2}", value), value  # §11 Q8


def assert_item_view(entry: dict) -> None:
    assert set(entry) == ITEM_KEYS
    assert type(entry["seq"]) is int
    assert type(entry["is_fixed"]) is bool
    if entry["place_id"] is not None:
        assert entry["facts"], "장소가 있는 일정에는 사실 값이 있어야 한다"
    assert_facts(entry["facts"])


def assert_card_shape(card: dict) -> None:
    assert set(card) == CARD_KEYS[card["type"]]
    kind = card["type"]
    if kind == "T-01":
        assert_item_view(card["item"])
    elif kind == "T-02":
        assert_item_view(card["next_item"])
        assert type(card["travel_min"]) is int
        assert_hhmm(card["leave_at"])
        assert type(card["leave_in_min"]) is int
        assert type(card["map_url"]) is str or (card["map_url"] is None and card["next_item"]["place_id"] is None)  # §11 Q6
    elif kind == "T-03":
        for entry in card["items"]:
            assert_item_view(entry)
    elif kind == "T-07":
        assert set(card["fixed"]) == {"name", "title", "start", "end", "facts"}  # §11 Q21, §12 R4
        assert_facts(card["fixed"]["facts"])
        assert_hhmm(card["leave_by"])
        assert type(card["leave_in_min"]) is int
    elif kind == "T-08":
        assert type(card["go_home_min"]) is int
        assert set(card["lodging"]) == {"lat", "lng"}
        assert type(card["map_url"]) is str  # §13 E4: 숙소 좌표는 늘 있다 (DayPlan.lodging 필수)


def assert_now_shape(view: dict) -> None:
    assert set(view) == NOW_KEYS
    DaySummary.model_validate(view["day"])
    assert view["status"] in {"on_track", "delayed", "free"}
    assert type(view["reason"]) is str and view["reason"]
    assert view["chip"] is None  # §11 Q2
    assert_card_shape(view["main"])
    assert len(view["subs"]) <= 3
    for card in view["subs"]:
        assert_card_shape(card)
    for pin in view["pins"]:
        assert set(pin) == PIN_KEYS
        assert pin["state"] in {"done", "now", "next", "later"}
        assert type(pin["lat"]) is float and type(pin["lng"]) is float
        assert_hhmm(pin["start"])
        assert_hhmm(pin["end"])
        assert type(pin["travel_min"]) is int
    assert set(view["route"]) == {"done", "remaining"}
    for part in view["route"].values():
        assert all(len(point) == 2 for point in part)


@pytest.mark.parametrize(
    "clock",
    ["09:00", "09:50", "10:30", "11:50", "12:05", "13:20", "18:59", "19:00"],
    ids=lambda c: f"{c}",
)
def test_AC3_어느_시각이든_NowView_모양(env, plain, clock):
    assert_now_shape(now(env, plain, clock))


@pytest.mark.parametrize("clock", ["14:24", "14:25"], ids=["고정_16분전", "고정_15분전"])
def test_AC3_고정_일정이_있는_코스도_NowView_모양(env, with_fixed, clock):
    assert_now_shape(now(env, with_fixed, clock))


def test_AC3_at은_보낸_값_그대로(env, plain):
    assert now(env, plain, "13:20")["at"] == "2026-12-02T13:20:00"


def test_AC3_day는_그날의_요약(env, plain):
    day = now(env, plain, "13:20")["day"]
    assert day["day_id"] == plain
    assert day["date"] == "2026-12-02"
    assert (day["start"], day["end"]) == ("10:00", "23:00")


@pytest.mark.parametrize("status, value", [("confirmed", "08:00-18:00"), ("unverified", "08:00-18:00")])
def test_AC3_장소_카드의_사실_값에_확인_상태가_그대로(env, status, value):
    places = {"P01": place("P01", km=1.0, hours=week_hours(), status=status)}
    day_id = plant(env, [plan_item(1, "P01", "10:12", "19:00", 12)], places=places)
    fact = now(env, day_id, "13:20")["main"]["item"]["facts"][0]
    assert (fact["field"], fact["value"], fact["status"]) == ("opening_hours", value, status)


def test_AC3_영업시간을_모르는_장소는_값_null_상태_unknown(env):
    places = {"P01": place("P01", km=1.0, hours=None)}
    day_id = plant(env, [plan_item(1, "P01", "10:12", "19:00", 12)], places=places)
    fact = now(env, day_id, "13:20")["main"]["item"]["facts"][0]
    assert (fact["value"], fact["status"]) == (None, "unknown")


# ---------- AC-3: 위치 ----------

LAT, LNG = 35.123456, 135.654321


def test_A1_보낸_위치가_position에(env, plain):
    assert now(env, plain, "13:20", lat=LAT, lng=LNG)["position"] == {"lat": LAT, "lng": LNG}


def test_S7_위치를_안_보내면_position은_null(env, plain):
    assert now(env, plain, "13:20")["position"] is None


def test_AC3_위치를_보내도_저장소가_그대로다(env, plain):
    before = env.repo.snapshot()
    assert get_now(env, plain, "13:20", lat=LAT, lng=LNG).status_code == 200
    after = env.repo.snapshot()
    assert {k: v for k, v in after.items() if k != "logs"} == {k: v for k, v in before.items() if k != "logs"}
    assert str(LAT) not in repr(after) and str(LNG) not in repr(after)


def test_AC3_서버_로그에_위치_값이_없다(env, plain, caplog):
    # 앱 코드의 로그만 본다. 서버 접근 로그의 쿼리는 §11 Q9로 이번 범위가 아니라 막지 않는다 (httpx·uvicorn 제외)
    with caplog.at_level(logging.DEBUG):
        assert get_now(env, plain, "13:20", lat=LAT, lng=LNG).status_code == 200
    ours = [r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore", "uvicorn"))]
    assert not [message for message in ours if str(LAT) in message or str(LNG) in message]


@pytest.mark.parametrize("clock", ["09:00", "11:50", "12:05", "13:20", "19:00"])
def test_A2_판단은_시각과_코스로만_위치는_결과를_안_바꾼다(env, plain, clock):
    without = now(env, plain, clock)
    moved = now(env, plain, clock, lat=LAT, lng=LNG)
    assert moved.pop("position") == {"lat": LAT, "lng": LNG}
    assert without.pop("position") is None
    # §11 Q11: 이동 중 route의 경계 점만 위치를 따른다
    moved.pop("route")
    without.pop("route")
    assert moved == without


# ---------- A2: Snapshot ----------


@pytest.mark.parametrize("clock", ["09:00", "10:30", "12:05", "12:40", "18:30", "19:30"])
def test_A2_이번에_안_만드는_카드로_가는_신호는_중립값(env, plain, seen, clock):
    assert get_now(env, plain, clock).status_code == 200
    snapshot = seen[-1]
    assert snapshot.open_events == []
    assert snapshot.meal_eaten is True
    assert snapshot.rain_prob_2h == 0
    assert snapshot.walked_km == 0
    assert snapshot.outdoor_remaining is False
    assert snapshot.chat_pick is None
    assert snapshot.offline is False
    assert snapshot.safety is False
    assert snapshot.arriving is False  # §11 Q25
    if snapshot.next_item:
        assert snapshot.next_item.hours_checked is True  # §11 Q25


def test_A2_now는_at의_시각(env, plain, seen):
    get_now(env, plain, "13:20")
    assert seen[-1].now == time(13, 20)


@pytest.mark.parametrize(
    "clock, current, following, moving",
    [
        ("09:00", None, "P01", False),
        ("09:59", None, "P01", False),
        ("10:00", None, "P01", True),
        ("10:05", None, "P01", True),
        ("10:12", "P01", "P02", False),
        ("11:59", "P01", "P02", False),
        ("12:00", None, "P02", True),
        ("12:19", None, "P02", True),
        ("12:20", "P02", "P03", False),
        ("18:59", "P03", None, False),
        ("19:00", None, None, False),
    ],
    ids=["시작전", "출발_1분전", "출발_정각", "출발_뒤_1번_도착_전", "일정_시작_정각", "일정_끝_1분전", "일정_끝_정각", "다음_시작_1분전", "다음_시작_정각", "마지막_일정_안", "마지막_일정_끝_정각"],
)
def test_A2_지금_다음_이동중(env, plain, seen, clock, current, following, moving):
    assert get_now(env, plain, clock).status_code == 200
    snapshot = seen[-1]
    assert (snapshot.current_item.name if snapshot.current_item else None) == (f"가상 {current}" if current else None)
    assert (snapshot.next_item.name if snapshot.next_item else None) == (f"가상 {following}" if following else None)
    assert snapshot.moving is moving


def test_A2_고정_일정은_늦지_않게_출발할_시각으로_넘어간다(env, with_fixed, seen):
    assert get_now(env, with_fixed, "13:00").status_code == 200
    assert seen[-1].fixed_event.name == "가상 F01"
    assert seen[-1].fixed_event.leave_by == time(14, 40)


@pytest.mark.parametrize(
    "clock, count",
    [("09:00", 3), ("10:30", 3), ("12:05", 2), ("12:20", 2), ("14:00", 1), ("18:30", 1), ("19:00", 0)],
    ids=["시작전", "1번_안", "1번_뒤", "2번_시작", "2번_뒤", "마지막_안", "끝_정각"],
)
def test_S11_Q26_remaining_items에_지금_일정_포함(env, plain, seen, clock, count):
    assert get_now(env, plain, clock).status_code == 200
    assert seen[-1].remaining_items == count


@pytest.mark.parametrize("clock, name", [("14:59", "가상 F01"), ("15:00", None), ("15:30", None), ("16:10", None)], ids=["시작_1분전", "시작_정각", "안", "끝난_뒤"])
def test_S11_Q4_fixed_event는_시작_전까지만(env, with_fixed, seen, clock, name):
    assert get_now(env, with_fixed, clock).status_code == 200
    assert (seen[-1].fixed_event.name if seen[-1].fixed_event else None) == name


def test_A2_고정_일정이_없으면_fixed_event도_없다(env, plain, seen):
    get_now(env, plain, "13:00")
    assert seen[-1].fixed_event is None


# ---------- AC-2: §A-2 표, 줄마다 ----------


@pytest.mark.parametrize(
    "clock, main",
    [("09:49", "T-01"), ("09:50", "T-02"), ("09:51", "T-02")],
    ids=["출발_11분전", "출발_10분전_정각", "출발_9분전"],
)
def test_AC2_하루_시작_전_출발_10분_전_경계(env, plain, clock, main):
    assert now(env, plain, clock)["main"]["type"] == main


def test_AC2_하루_시작_전_미리보기는_1번이고_남은_분이_null(env, plain):
    main = now(env, plain, "09:00")["main"]
    assert main["type"] == "T-01"
    assert main["item"]["seq"] == 1
    assert main["ends_in_min"] is None


def test_AC2_그날_첫_순간도_하루_시작_전_줄(env, plain):
    main = now(env, plain, "00:00")["main"]
    assert (main["type"], main["item"]["seq"], main["ends_in_min"]) == ("T-01", 1, None)


def test_AC2_하루_시작_전_지금은_없고_다음이_1번(env, plain):
    assert pin_states(now(env, plain, "09:00")) == {1: "next", 2: "later", 3: "later"}


def test_AC2_하루_시작_전_출발_10분_전이면_T_02가_1번을_가리킨다(env, plain):
    main = now(env, plain, "09:50")["main"]
    assert main["next_item"]["seq"] == 1
    assert main["leave_at"] == "10:00"
    assert main["leave_in_min"] == 10


@pytest.mark.parametrize(
    "clock, card, ends",
    [("10:10", "T-01", None), ("10:17", "T-01", None), ("10:18", "T-02", None), ("10:28", "T-02", None)],
    ids=["하루_시작_뒤_출발_18분전", "출발_11분전", "출발_10분전_정각", "출발_정각"],
)
def test_S11_Q12_하루_시작_전은_1번_출발_전(env, card, clock, ends):
    day_id = plant(env, [plan_item(1, "P01", "10:40", "12:00", 12)])  # 하루 10:00 시작, 1번 출발 10:28
    view = now(env, day_id, clock)
    assert view["main"]["type"] == card
    if card == "T-01":
        assert (view["main"]["item"]["seq"], view["main"]["ends_in_min"]) == (1, ends)
    assert pin_states(view) == {1: "next"}


@pytest.mark.parametrize("clock", ["10:00", "10:05", "10:11"], ids=["출발_정각", "출발_뒤", "도착_1분전"])
def test_S11_Q10_Q12_1번_출발_뒤는_이동_중이고_leave_in_min은_0(env, plain, clock):
    view = now(env, plain, clock)
    assert view["main"]["type"] == "T-02"
    assert view["main"]["next_item"]["seq"] == 1
    assert view["main"]["leave_at"] == "10:00"
    assert view["main"]["leave_in_min"] == 0


@pytest.mark.parametrize(
    "clock, main",
    [
        ("10:12", "T-01"),
        ("11:49", "T-01"),
        ("11:50", "T-02"),
        ("11:51", "T-02"),
        ("11:59", "T-02"),
    ],
    ids=["시작_정각", "출발_11분전", "출발_10분전_정각", "출발_9분전", "출발_1분전"],
)
def test_AC2_S11_Q3_일정_안_출발_10분_전_경계(env, plain, clock, main):
    assert now(env, plain, clock)["main"]["type"] == main


@pytest.mark.parametrize("clock", ["10:12", "11:49", "11:50", "11:59", "11:59:59"], ids=lambda c: c)
def test_AC2_일정_안이면_그_일정이_지금_핀(env, plain, clock):
    assert pin_states(now(env, plain, clock)) == {1: "now", 2: "next", 3: "later"}


def test_AC2_일정_시작_1분_전은_아직_일정_안이_아니다(env, plain):
    assert pin_states(now(env, plain, "10:11")) == {1: "next", 2: "later", 3: "later"}


@pytest.mark.parametrize("clock", ["12:00", "12:00:00", "12:01", "12:19"], ids=["끝_정각", "끝_정각_초까지", "끝_1분뒤", "다음_시작_1분전"])
def test_AC2_일정_끝_시각_정각부터는_이동_중(env, plain, clock):
    view = now(env, plain, clock)
    assert view["main"]["type"] == "T-02"
    assert view["main"]["next_item"]["seq"] == 2
    assert pin_states(view) == {1: "done", 2: "next", 3: "later"}
    assert view["main"]["leave_at"] == "12:00"
    assert view["main"]["leave_in_min"] == 0  # §11 Q10


def test_AC2_다음_일정_시작_정각이면_그_일정_안(env, plain):
    view = now(env, plain, "12:20")
    assert view["main"]["type"] == "T-01"
    assert view["main"]["item"]["seq"] == 2
    assert view["main"]["ends_in_min"] == 100
    assert pin_states(view) == {1: "done", 2: "now", 3: "next"}


def test_AC2_T_01의_남은_분은_일정_끝까지(env, plain):
    main = now(env, plain, "13:20")["main"]
    assert (main["item"]["seq"], main["ends_in_min"]) == (2, 40)


@pytest.mark.parametrize(
    "clock, main",
    [("14:24", "T-01"), ("14:25", "T-07"), ("14:26", "T-07")],
    ids=["출발_16분전", "출발_15분전_정각", "출발_14분전"],
)
def test_AC2_고정_일정_출발_15분_전_경계(env, with_fixed, clock, main):
    assert now(env, with_fixed, clock)["main"]["type"] == main


def test_AC2_고정_일정이_순위_2라_다음_이동보다_먼저(env, with_fixed):
    # 14:30은 일반 규칙으로는 T-02 (출발 10분 전)
    assert now(env, with_fixed, "14:30")["main"]["type"] == "T-07"


def test_AC2_T_07의_값(env, with_fixed):
    main = now(env, with_fixed, "14:25")["main"]
    fixed = main["fixed"]
    assert (fixed["name"], fixed["title"], fixed["start"], fixed["end"]) == ("가상 F01", "고정 일정", "15:00", "16:00")  # §12 R4
    assert [fact["status"] for fact in fixed["facts"]] == ["confirmed"]  # §11 Q21
    assert main["leave_by"] == "14:40"
    assert main["leave_in_min"] == 15


@pytest.mark.parametrize("clock", ["14:40", "14:41", "14:50", "14:59"], ids=["출발_정각", "출발_1분뒤", "이동_중", "시작_1분전"])
def test_S11_Q4_출발_시각이_지나도_시작_전이면_T_07이고_leave_in_min은_0(env, with_fixed, clock):
    main = now(env, with_fixed, clock)["main"]
    assert main["type"] == "T-07"
    assert main["leave_by"] == "14:40"
    assert main["leave_in_min"] == 0


@pytest.mark.parametrize("clock, ends", [("15:00", 60), ("15:30", 30), ("15:49", 11)], ids=["시작_정각", "안", "다음_출발_11분전"])
def test_S11_Q4_고정_일정_안이면_T_01이고_지금_일정이_고정_일정(env, with_fixed, clock, ends):
    view = now(env, with_fixed, clock)
    main = view["main"]
    assert (main["type"], main["item"]["seq"], main["item"]["is_fixed"], main["ends_in_min"]) == ("T-01", 2, True, ends)
    assert pin_states(view)[2] == "now"


@pytest.mark.parametrize("clock", ["19:00", "19:01", "23:59"], ids=["끝_정각", "끝_1분뒤", "그날_끝"])
def test_AC2_마지막_일정_끝난_뒤_T_08_다음_없음(env, plain, clock):
    view = now(env, plain, clock)
    assert view["main"]["type"] == "T-08"
    assert view["subs"] == []
    assert pin_states(view) == {1: "done", 2: "done", 3: "done"}


def test_AC2_T_08의_값(env, plain):
    main = now(env, plain, "19:30")["main"]
    assert main["go_home_min"] == 25
    assert main["lodging"] == {"lat": 35.0, "lng": 135.0}


def assert_home_url(main: dict) -> None:
    url = urlparse(main["map_url"])
    query = parse_qs(url.query)
    assert url.scheme == "https"
    assert "google." in url.netloc
    assert "/maps/dir" in url.path
    lat, lng = query["destination"][0].split(",")
    assert (float(lat), float(lng)) == (main["lodging"]["lat"], main["lodging"]["lng"]) == (35.0, 135.0)
    assert query["travelmode"] == ["transit"]


def test_S13_E4_T_08의_map_url은_숙소_좌표_대중교통(env, plain):
    assert_home_url(now(env, plain, "19:30")["main"])


def test_S13_E4_18시_전에_끝난_날의_T_08도(env):
    day_id = plant(env, [plan_item(1, "P01", "10:12", "15:00", 12)])
    assert_home_url(now(env, day_id, "15:00")["main"])


def test_S13_E4_빈_코스의_T_08도_숙소는_있다(env):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    assert_home_url(now(env, day_id, "13:00")["main"])


def test_AC2_마지막_일정이_18시_뒤에_남아_있으면_아직_T_01(env, plain):
    main = now(env, plain, "18:59")["main"]
    assert (main["type"], main["item"]["seq"], main["ends_in_min"]) == ("T-01", 3, 1)


@pytest.mark.parametrize("clock", ["15:00", "15:01", "17:59", "18:00"], ids=["끝_정각", "끝_1분뒤", "18시_1분전", "18시_정각"])
def test_S11_Q1_마지막_일정이_18시_전에_끝나도_시각과_무관하게_T_08(env, clock):
    day_id = plant(env, [plan_item(1, "P01", "10:12", "15:00", 12)])
    view = now(env, day_id, clock)
    assert view["main"]["type"] == "T-08"
    assert view["main"]["go_home_min"] == 25
    assert view["subs"] == []
    assert view["chip"] is None


def test_S11_Q1_마지막_일정이_18시_전이어도_끝나기_전에는_T_01(env):
    day_id = plant(env, [plan_item(1, "P01", "10:12", "15:00", 12)])
    main = now(env, day_id, "14:59")["main"]
    assert (main["type"], main["item"]["seq"], main["ends_in_min"]) == ("T-01", 1, 1)


def test_S11_Q1_compose_screen은_그대로_18시_전이면_T_01():
    snapshot = Snapshot(now=time(15, 0), meal_eaten=True, remaining_items=0)
    assert compose_screen(snapshot).main == "T-01"


@pytest.mark.parametrize("clock", ["15:00", "17:59"], ids=["끝_정각", "18시_1분전"])
def test_S12_R1_Q1로_T_08이_되면_reason도_T_08_문장(env, clock):
    day_id = plant(env, [plan_item(1, "P01", "10:12", "15:00", 12)])
    assert now(env, day_id, clock)["reason"] == DAY_OVER


def rest_items() -> list[CourseItem]:
    """1번 끝 12:00, 쉬는 시간 15분, 12:15 출발, 이동 20분, 2번 12:35 시작."""
    return [plan_item(1, "P01", "10:12", "12:00", 12), plan_item(2, "P02", "12:35", "14:00", 20)]


@pytest.mark.parametrize(
    "clock, card",
    [("11:50", "T-01"), ("11:59", "T-01"), ("12:00", "T-02"), ("12:15", "T-02")],
    ids=["끝_10분전_출발_25분전", "끝_1분전_출발_16분전", "끝_정각_일정_사이", "출발_정각"],
)
def test_S11_Q3_쉬는_시간이_있으면_끝이_아니라_출발이_기준(env, clock, card):
    assert now(env, plant(env, rest_items()), clock)["main"]["type"] == card


def test_S11_Q3_leave_at은_다음_시작_빼기_이동(env):
    main = now(env, plant(env, rest_items()), "12:00")["main"]
    assert main["leave_at"] == "12:15"
    assert main["travel_min"] == 20


def test_S11_Q3_쉬는_시간_안의_T_01_보조_T_02에도_같은_leave_at(env):
    subs = now(env, plant(env, rest_items()), "11:50")["subs"]
    assert subs[0]["leave_at"] == "12:15"
    assert subs[0]["leave_in_min"] == 25


@pytest.mark.parametrize("clock", ["12:15", "12:20", "12:34"], ids=["출발_정각", "이동_중", "도착_1분전"])
def test_S11_Q10_쉬는_시간이_있어도_출발_뒤_leave_in_min은_0(env, clock):
    assert now(env, plant(env, rest_items()), clock)["main"]["leave_in_min"] == 0


@pytest.mark.parametrize(
    "clock, left",
    [("12:00", 15), ("12:05", 10), ("12:14", 1), ("12:15", 0), ("12:16", 0)],
    ids=["끝_정각", "쉬는_중", "출발_1분전", "출발_정각", "출발_1분뒤"],
)
def test_S12_R2_쉬는_시간은_T_02이고_남은_분_출발부터_0(env, clock, left):
    main = now(env, plant(env, rest_items()), clock)["main"]
    assert (main["type"], main["leave_at"], main["leave_in_min"]) == ("T-02", "12:15", left)


def test_S12_R2_쉬는_시간은_이동_중이_아니라_위치가_경계_점이_아니다(env):
    route = now(env, plant(env, rest_items()), "12:05", lat=LAT, lng=LNG)["route"]
    assert route["done"] == [HOME, *stops(1)]
    assert route["remaining"] == [*stops(1, 2), HOME]


def test_S12_R2_출발_시각부터는_위치가_경계_점(env):
    route = now(env, plant(env, rest_items()), "12:15", lat=LAT, lng=LNG)["route"]
    assert route["done"] == [HOME, *stops(1), [LAT, LNG]]


def test_S12_R2_고정_일정_앞_빈_시간도_출발_전이면_남은_분(env):
    items = [plan_item(1, "P01", "10:12", "14:00", 12), plan_item(2, "F01", "15:00", "16:00", 20, fixed=True)]
    places = {"P01": place("P01", km=1.0, hours=week_hours()), "F01": place("F01", km=2.0, hours=week_hours())}
    day_id = plant(env, items, fixed=[fixed_event("15:00", "16:00", places["F01"])], places=places)
    main = now(env, day_id, "14:10")["main"]  # 끝 14:00, 출발 14:40: 고정 일정 15분 전보다 앞
    assert (main["type"], main["leave_in_min"]) == ("T-02", 30)


@pytest.mark.parametrize(
    "value",
    ["2026-12-01T13:20:00", "2026-12-03T13:20:00", "2026-12-01T23:59:59", "2026-12-03T00:00:00", "2027-12-02T13:20:00"],
    ids=["전날", "다음날", "전날_마지막_순간", "다음날_첫_순간", "다른_해"],
)
def test_AC2_하루_밖_날짜는_400(env, plain, value):
    response = env.client.get(f"/days/{plain}/now", params={"at": value})
    assert_error(response, 400, "INVALID_REQUEST")


@pytest.mark.parametrize("clock", ["00:00:00", "23:59:59"], ids=["그날_첫_순간", "그날_마지막_순간"])
def test_AC2_그날_안의_처음과_끝은_200(env, plain, clock):
    assert get_now(env, plain, clock).status_code == 200


def test_AC2_하루_밖_날짜_요청은_저장소를_바꾸지_않는다(env, plain):
    before = env.repo.snapshot()
    env.client.get(f"/days/{plain}/now", params={"at": "2026-12-03T13:20:00"})
    assert env.repo.snapshot() == before


def test_S11_Q7_자정_넘는_하루도_날짜_그대로_비교해_다음_날짜는_400(env):
    day_id = plant(env, [plan_item(1, "P01", "22:00", "25:30", 12)], end="26:00")
    response = env.client.get(f"/days/{day_id}/now", params={"at": "2026-12-03T01:00:00"})
    assert_error(response, 400, "INVALID_REQUEST")


BAD_QUERIES = [
    {},
    {"at": "아무말"},
    {"at": "2026-13-40T10:00:00"},
    {"at": "2026-12-02T13:20:00", "lat": LAT},
    {"at": "2026-12-02T13:20:00", "lng": LNG},  # §12 R9
    {"at": "2026-12-02T13:20:00+09:00"},  # §12 R9
    {"at": "2026-12-02T04:20:00Z"},  # §12 R9
    {"at": "2026-12-02T13:20:00", "lat": "숫자아님", "lng": LNG},
]
BAD_IDS = ["at_없음", "형식_오류", "없는_날짜", "lat만_보냄", "lng만_보냄", "시간대_붙음", "시간대_Z", "lat_형식_오류"]


@pytest.mark.parametrize("params", BAD_QUERIES, ids=BAD_IDS)
def test_S11_Q23_쿼리_오류는_400(env, plain, params):
    assert_error(env.client.get(f"/days/{plain}/now", params=params), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("params", BAD_QUERIES, ids=BAD_IDS)
def test_S11_Q23_쿼리_400이_없는_날_404보다_먼저(env, params):
    assert_error(env.client.get("/days/없는-날/now", params=params), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("params", BAD_QUERIES, ids=BAD_IDS)
def test_S11_Q23_쿼리_400이_고른_코스_없음_404보다_먼저(env, params):
    day_id = env.plant_day({"P01": place("P01", hours=week_hours())}, day_plan(day=DAY))
    assert_error(env.client.get(f"/days/{day_id}/now", params=params), 400, "INVALID_REQUEST")


@pytest.mark.parametrize(
    "lat, lng",
    [(90.01, LNG), (-90.01, LNG), (LAT, 180.01), (LAT, -180.01)],
    ids=["위도_위", "위도_아래", "경도_위", "경도_아래"],
)
def test_S14_좌표_범위_밖은_400(env, plain, lat, lng):
    response = env.client.get(f"/days/{plain}/now", params={"at": "2026-12-02T13:20:00", "lat": lat, "lng": lng})
    assert_error(response, 400, "INVALID_REQUEST")


@pytest.mark.parametrize("lat, lng", [(90.0, 180.0), (-90.0, -180.0)], ids=["위_끝", "아래_끝"])
def test_S14_좌표_범위_끝은_200(env, plain, lat, lng):
    assert now(env, plain, "13:20", lat=lat, lng=lng)["position"] == {"lat": lat, "lng": lng}


def test_S12_R9_하루_밖_날짜와_코스_없음이_겹치면_404가_먼저(env):
    day_id = env.plant_day({"P01": place("P01", hours=week_hours())}, day_plan(day=DAY))
    response = env.client.get(f"/days/{day_id}/now", params={"at": "2026-12-03T13:20:00"})
    assert assert_error(response, 404, "NOT_FOUND")["detail"]["resource"] == "course"


def test_S12_R9_하루_밖_날짜와_없는_날이_겹쳐도_404(env):
    response = env.client.get("/days/없는-날/now", params={"at": "2026-12-03T13:20:00"})
    assert assert_error(response, 404, "NOT_FOUND")["detail"]["resource"] == "day"


# ---------- status, status_text, reason ----------


@pytest.mark.parametrize(
    "clock, status, text",
    [
        ("11:30", "free", FREE),  # 출발까지 30분 정각
        ("11:31", "on_track", ON_TRACK),  # 29분
        ("18:30", "free", FREE),  # 다음 일정 없음
        ("19:30", "free", FREE),
    ],
    ids=["여유_30분_정각", "여유_29분", "마지막_일정_안", "끝난_뒤"],
)
def test_A1_status는_compose_값이고_글자는_표대로(env, plain, clock, status, text):
    view = now(env, plain, clock)
    assert (view["status"], view["status_text"]) == (status, text)


def test_A1_delayed_글자(env, plain, monkeypatch):
    force(monkeypatch, lambda s: {"open_events": [OpenEvent(kind="delay")]})
    view = now(env, plain, "12:40")
    assert (view["status"], view["status_text"]) == ("delayed", DELAYED)


@pytest.mark.parametrize("clock, card", [("13:20", "T-01"), ("12:05", "T-02"), ("19:30", "T-08")])
def test_A3_reason은_compose_문장_그대로(env, plain, clock, card):
    assert now(env, plain, clock)["reason"] == REASONS[card]


def test_A3_T_07의_reason(env, with_fixed):
    assert now(env, with_fixed, "14:25")["reason"] == REASONS["T-07"]


# ---------- A3: 보조 카드 (SCREEN-001 §5) ----------


def test_S5_T_01의_보조는_T_02_T_03(env, plain):
    subs = now(env, plain, "10:30")["subs"]
    assert types(subs) == ["T-02", "T-03"]
    assert subs[0]["next_item"]["seq"] == 2
    assert [entry["seq"] for entry in subs[1]["items"]] == [2, 3]


def test_S5_S11_Q25_T_02의_보조는_T_03뿐_T_05는_이번_범위_밖(env, plain):
    subs = now(env, plain, "12:05")["subs"]
    assert types(subs) == ["T-03"]
    assert [entry["seq"] for entry in subs[0]["items"]] == [2, 3]


def test_S5_T_07의_보조는_T_02(env, with_fixed):
    subs = now(env, with_fixed, "14:25")["subs"]
    assert types(subs) == ["T-02"]
    assert subs[0]["next_item"]["seq"] == 2


def test_S5_하루_시작_전_미리보기의_보조(env, plain):
    subs = now(env, plain, "09:00")["subs"]
    assert types(subs) == ["T-02", "T-03"]
    assert subs[0]["next_item"]["seq"] == 1
    assert [entry["seq"] for entry in subs[1]["items"]] == [1, 2, 3]


def test_S11_Q5_S12_R11_마지막_일정_안이면_T_02도_빈_T_03도_없다(env, plain):
    assert now(env, plain, "18:30")["subs"] == []


def test_S12_R11_마지막_일정_시작부터_보조가_없고_앞_일정에서는_있다(env, plain):
    assert now(env, plain, "14:30")["subs"] == []
    assert types(now(env, plain, "13:20")["subs"]) == ["T-02", "T-03"]


def test_S12_R11_T_03의_남은_일정이_있으면_이동_중에도_남는다(env, plain):
    subs = now(env, plain, "14:10")["subs"]
    assert types(subs) == ["T-03"]
    assert [entry["seq"] for entry in subs[0]["items"]] == [3]


def test_S12_R11_대체_뒤에도_빈_T_03은_없다(env, plain, monkeypatch):
    force(monkeypatch, lambda s: {"walked_km": 12.0})
    view = now(env, plain, "18:30")
    assert view["main"]["type"] == "T-01"
    assert view["subs"] == []


# ---------- A4: T-02 값 ----------


def test_A4_T_02_값(env, plain):
    main = now(env, plain, "11:55")["main"]
    assert main["next_item"]["seq"] == 2
    assert main["leave_at"] == "12:00"
    assert main["leave_in_min"] == 5
    assert main["travel_min"] == 20


def test_A4_map_url은_구글_길찾기_목적지_좌표_대중교통(env, plain):
    main = now(env, plain, "11:55")["main"]
    url = urlparse(main["map_url"])
    query = parse_qs(url.query)
    assert url.scheme == "https"
    assert "google." in url.netloc
    assert "/maps/dir" in url.path
    lat, lng = query["destination"][0].split(",")
    assert (float(lat), float(lng)) == north_of(2.0)
    assert query["travelmode"] == ["transit"]


def test_A4_CourseItemView의_좌표_시각_이름은_저장된_값(env, plain):
    entry = now(env, plain, "13:20")["main"]["item"]
    assert (entry["place_id"], entry["name"]) == ("P02", "가상 P02")
    assert (entry["start"], entry["end"]) == ("12:20", "14:00")
    assert (entry["lat"], entry["lng"]) == north_of(2.0)
    assert entry["is_fixed"] is False


# ---------- pins, route ----------


def test_A1_핀은_코스_순서대로_이름_좌표와_함께(env, plain):
    pins = now(env, plain, "13:20")["pins"]
    assert [(p["seq"], p["place_id"], p["name"]) for p in pins] == [(1, "P01", "가상 P01"), (2, "P02", "가상 P02"), (3, "P03", "가상 P03")]
    assert (pins[1]["lat"], pins[1]["lng"]) == north_of(2.0)
    assert [(p["start"], p["end"]) for p in pins] == [("10:12", "12:00"), ("12:20", "14:00"), ("14:30", "19:00")]  # §11 Q15
    assert [p["travel_min"] for p in pins] == [12, 20, 30]  # §12 R6


HOME = [35.0, 135.0]


def stops(*numbers: int) -> list[list[float]]:
    return [list(north_of(float(n))) for n in numbers]


def is_subsequence(needed: list, whole: list) -> bool:
    walker = iter(whole)
    return all(point in walker for point in needed)


@pytest.mark.parametrize("clock", ["09:00", "10:30", "12:05", "13:20", "18:30", "19:30"])
def test_A1_route는_지난_길과_남은_길을_합치면_숙소에서_숙소까지(env, plain, clock):
    route = now(env, plain, clock)["route"]
    full = [HOME, *stops(1, 2, 3), HOME]
    assert is_subsequence(full, route["done"] + route["remaining"])


@pytest.mark.parametrize("clock", ["09:00", "10:30", "12:05", "13:20", "18:30", "19:30"])
def test_S11_Q11_지난_길의_끝과_남은_길의_시작은_같은_점(env, plain, clock):
    route = now(env, plain, clock)["route"]
    assert route["done"][-1] == route["remaining"][0]


def test_S11_Q11_일정_안이면_지난_길은_그_장소까지_남은_길은_그_장소부터(env, plain):
    route = now(env, plain, "13:20")["route"]
    assert route["done"] == [HOME, *stops(1, 2)]
    assert route["remaining"] == [*stops(2, 3), HOME]


def test_S11_Q11_이동_중이면_보낸_위치가_경계_점(env, plain):
    route = now(env, plain, "12:10", lat=LAT, lng=LNG)["route"]
    assert route["done"] == [HOME, *stops(1), [LAT, LNG]]
    assert route["remaining"] == [[LAT, LNG], *stops(2, 3), HOME]


def test_S11_Q11_1번으로_가는_중이어도_보낸_위치가_경계_점(env, plain):
    route = now(env, plain, "10:05", lat=LAT, lng=LNG)["route"]
    assert route["done"] == [HOME, [LAT, LNG]]
    assert route["remaining"] == [[LAT, LNG], *stops(1, 2, 3), HOME]


def test_S11_Q11_출발_전이면_경계_점은_숙소(env, plain):
    route = now(env, plain, "09:00")["route"]
    assert route["done"] == [HOME]
    assert route["remaining"] == [HOME, *stops(1, 2, 3), HOME]


def test_S11_Q11_끝난_뒤_남은_길은_마지막_장소에서_숙소(env, plain):
    route = now(env, plain, "19:30")["route"]
    assert route["done"] == [HOME, *stops(1, 2, 3)]
    assert route["remaining"] == [*stops(3), HOME]


def test_S12_R3_이동_중_위치가_없으면_경계_점은_앞_장소(env, plain):
    route = now(env, plain, "12:10")["route"]
    assert route["done"] == [HOME, *stops(1)]
    assert route["remaining"] == [*stops(1, 2, 3), HOME]


def test_S12_R3_1번으로_가는_중_위치가_없으면_경계_점은_숙소(env, plain):
    route = now(env, plain, "10:05")["route"]
    assert route["done"] == [HOME]
    assert route["remaining"] == [HOME, *stops(1, 2, 3), HOME]


def test_S12_R3_끝난_뒤_위치를_보내도_남은_길은_그대로(env, plain):
    view = now(env, plain, "19:10", lat=LAT, lng=LNG)
    assert view["route"]["done"] == [HOME, *stops(1, 2, 3)]
    assert view["route"]["remaining"] == [*stops(3), HOME]
    assert view["position"] == {"lat": LAT, "lng": LNG}


# ---------- AC-4: A3 대체 ----------


def unchecked_next(s):
    return s.next_item.model_copy(update={"hours_checked": False})


FORCED = [
    ("X-01", lambda s: {"safety": True}),
    ("T-04", lambda s: {"open_events": [OpenEvent(kind="delay")]}),
    ("T-05", lambda s: {"arriving": True, "moving": False, "next_item": unchecked_next(s)}),
    ("T-06", lambda s: {"open_events": [OpenEvent(kind="closed")]}),
    ("T-09", lambda s: {"walked_km": 12.0}),
    ("T-10", lambda s: {"meal_eaten": False}),
    ("T-11", lambda s: {"chat_pick": "T-11"}),
    ("T-12", lambda s: {"rain_prob_2h": 0.9, "outdoor_remaining": True}),
    ("T-13", lambda s: {"chat_pick": "T-13"}),
]


@pytest.mark.parametrize("card, change", FORCED, ids=[c for c, _ in FORCED])
def test_AC4_지원_밖_카드가_나오면_T_01로_바꾸고_짝_표대로_칩은_null(env, plain, monkeypatch, card, change):
    def forced(snapshot):
        screen = compose_screen(snapshot.model_copy(update=change(snapshot)))
        assert screen.main == card  # 시험 자체 확인: 강제가 실제로 그 카드를 낸다
        return screen

    monkeypatch.setattr("trip.now.compose_screen", forced)
    view = now(env, plain, "12:40")  # 2번 일정 안, 다음 출발까지 80분
    assert view["main"]["type"] == "T-01"
    assert view["main"]["item"]["seq"] == 2
    assert view["main"]["ends_in_min"] == 80
    assert types(view["subs"]) == ["T-02", "T-03"]
    assert view["chip"] is None
    assert view["reason"] == REASONS["T-01"]  # §11 Q24


def test_AC4_대체하면_로그를_남긴다(env, plain, monkeypatch, caplog):
    force(monkeypatch, lambda s: {"walked_km": 12.0})
    with caplog.at_level(logging.DEBUG):
        now(env, plain, "12:40")
    messages = [r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore"))]
    assert any("T-09" in message for message in messages)


def test_S6_지원_목록_안의_카드는_대체하지_않는다(env, plain, monkeypatch):
    force(monkeypatch, lambda s: {"chat_pick": "T-03"})
    view = now(env, plain, "12:40")
    assert view["main"]["type"] == "T-03"
    assert [entry["seq"] for entry in view["main"]["items"]] == [3]
    assert types(view["subs"]) == ["T-02"]


def test_AC4_중립값_덕분에_식사_시간에도_T_10이_안_나온다(env, plain):
    assert now(env, plain, "12:40")["main"]["type"] == "T-01"


@pytest.mark.parametrize("clock", ["09:00", "10:30", "12:05", "12:40", "18:30", "19:30"])
def test_S11_Q2_칩은_항상_null(env, plain, clock):
    assert now(env, plain, clock)["chip"] is None


def test_S11_Q2_compose가_칩을_내는_여유_시간에도_null(env, plain):
    # 시험 자체 확인: 10:30은 출발까지 90분이라 compose가 칩 T-11을 낸다
    snapshot = Snapshot(now=time(10, 30), meal_eaten=True, remaining_items=3, next_item=PlanItem(name="다음", start=time(12, 20), end=time(14, 0), travel_min=20))
    assert compose_screen(snapshot).chip is not None
    assert now(env, plain, "10:30")["chip"] is None


# ---------- §11 Q6: 장소 없는 고정 일정 ----------


@pytest.fixture
def placeless(env) -> str:
    """2번이 장소 없는 고정 일정 13:00~14:00, 이동 0. 3번은 장소가 있다."""
    items = [
        plan_item(1, "P01", "10:12", "12:40", 12),
        plan_item(2, None, "13:00", "14:00", 0, fixed=True),
        plan_item(3, "P03", "14:30", "19:00", 30),
    ]
    places = {"P01": place("P01", km=1.0, hours=week_hours()), "P03": place("P03", km=3.0, hours=week_hours())}
    return plant(env, items, fixed=[fixed_event("13:00", "14:00")], places=places)


def test_S11_Q6_핀과_선에서_뺀다(env, placeless):
    view = now(env, placeless, "12:00")
    assert [pin["seq"] for pin in view["pins"]] == [1, 3]
    route = view["route"]
    assert route["done"] == [HOME, *stops(1)]
    assert route["remaining"] == [*stops(1, 3), HOME]


def test_S11_Q6_일정_안이면_T_01의_facts는_빈_목록_이름은_저장된_제목(env, placeless):
    entry = now(env, placeless, "13:30")["main"]["item"]
    assert (entry["seq"], entry["place_id"], entry["name"], entry["facts"]) == (2, None, "고정 일정", [])
    assert (entry["lat"], entry["lng"]) == (None, None)


def test_S11_Q6_T_02의_map_url은_null(env, placeless):
    t02 = next(card for card in now(env, placeless, "12:30")["subs"] if card["type"] == "T-02")
    assert t02["next_item"]["seq"] == 2
    assert t02["map_url"] is None


def test_S11_Q6_Q21_T_07의_fixed_facts는_빈_목록(env, placeless):
    main = now(env, placeless, "12:50")["main"]
    assert main["type"] == "T-07"
    assert main["fixed"] == {"name": "고정 일정", "title": "고정 일정", "start": "13:00", "end": "14:00", "facts": []}


@pytest.mark.parametrize("clock", ["09:00", "12:00", "12:50", "13:30", "14:10", "19:30"])
def test_S11_Q6_어느_시각이든_모양이_맞다(env, placeless, clock):
    assert_now_shape(now(env, placeless, clock))


# ---------- §11 Q13: 빈 코스 ----------


@pytest.mark.parametrize("clock", ["09:00", "13:00", "19:00"])
def test_S11_Q13_빈_코스를_고른_날은_T_08과_정해진_이유(env, clock):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    view = now(env, day_id, clock)
    assert view["main"]["type"] == "T-08"
    assert view["main"]["go_home_min"] == 0
    assert view["reason"] == "오늘 코스가 비어 있어"
    assert view["subs"] == []
    assert view["pins"] == []
    assert view["chip"] is None


# ---------- §11 Q8: 이름 ----------


def test_S11_Q8_새_모델_이름은_NowCourseItem이고_기존_CourseItemView는_그대로(env):
    schemas = env.app.openapi()["components"]["schemas"]
    assert set(schemas["NowCourseItem"]["properties"]) == ITEM_KEYS
    assert "NowView" in schemas
    assert {"stay_min", "travel_min", "hours_status"} <= set(schemas["CourseItemView"]["properties"])


def test_S11_Q8_NowProps의_ends_in_min은_null_허용():
    item = CatalogItem(name="장소", start=time(10, 0), end=time(11, 0))
    assert NowProps(item=item, ends_in_min=None).ends_in_min is None


# ---------- 속성: A-2 표를 무작위 코스로 ----------

leg = st.tuples(st.integers(min_value=11, max_value=90), st.integers(min_value=0, max_value=40), st.sampled_from([0, 5, 15]))


def expected_main(items: list[tuple[int, int, int]], minute: int) -> str:
    """§A-2 표 + §11 Q1·Q3. items = (시작, 끝, 이동)."""
    current = next((i for i in items if i[0] <= minute < i[1]), None)
    following = next((i for i in items if i[0] > minute), None)
    if following is None:
        return "T-01" if current else "T-08"
    if current is None and following is not items[0]:
        return "T-02"  # 일정 사이
    return "T-02" if following[0] - following[2] - minute <= 10 else "T-01"


@settings(max_examples=80, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(legs=st.lists(leg, min_size=1, max_size=4), minute=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_AC2_속성_쉬는_시간이_있는_무작위_코스에서_표대로(env, legs, minute):
    entries: list[tuple[int, int, int]] = []
    clock = 10 * 60
    for number, (stay, travel, rest) in enumerate(legs):
        start = clock + travel + (rest if number else 0)  # 첫 일정 앞에는 쉬는 시간이 없다 (TASK-002 §8 Q28)
        entries.append((start, start + stay, travel))
        clock = start + stay
    items = [plan_item(n, f"P{n:02d}", hhmm(s), hhmm(e), t) for n, (s, e, t) in enumerate(entries, start=1)]
    view = now(env, plant(env, items), hhmm(minute))
    assert view["main"]["type"] == expected_main(entries, minute)
    assert view["chip"] is None
    states = [pin["state"] for pin in view["pins"]]
    assert states == sorted(states, key=["done", "now", "next", "later"].index)
    assert states.count("now") <= 1 and states.count("next") <= 1
    assert set(types(view["subs"])) <= SUPPORTED
    assert len(view["subs"]) + 1 <= 4  # SCREEN-001 §2
    assert view["position"] is None
    assert view["route"]["done"][-1] == view["route"]["remaining"][0]
    following = next((e for e in entries if e[0] > minute), None)
    if view["main"]["type"] == "T-02":
        assert view["main"]["leave_in_min"] == max(0, following[0] - following[2] - minute)  # §11 Q10, §12 R2


# ---------- A5: /debug/seed-demo의 chosen ----------


def seed_chosen(env, chosen=True) -> dict:
    # §11 Q14: JSON 본문
    response = env.client.post("/debug/seed-demo", json={"chosen": chosen})
    assert response.status_code == 201, response.text
    return response.json()


def demo_now(env, day_id: str, value: str):
    return env.client.get(f"/days/{day_id}/now", params={"at": value})


def test_A5_chosen이면_둘째_날을_바로_열_수_있다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    response = demo_now(env, day_id, "2026-12-02T10:00:00")
    assert response.status_code == 200
    assert response.json()["day"]["day_number"] == 2
    assert response.json()["pins"]


def test_A5_chosen이어도_첫째_셋째_날은_고른_코스가_없다(env):
    seeded = seed_chosen(env)
    for day_id, value in ((seeded["day_ids"][0], "2026-12-01T10:00:00"), (seeded["day_ids"][2], "2026-12-03T10:00:00")):
        assert assert_error(demo_now(env, day_id, value), 404, "NOT_FOUND")["detail"]["resource"] == "course"


def test_A5_chosen은_계획하고_선택까지_끝낸_상태다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    option = env.repo.get_option(env.repo.chosen_option(day_id))
    assert option is not None
    done = env.client.get(f"/planning/{option.session_id}")
    assert done.status_code == 200
    assert done.json()["stage"] == "done"


def test_S11_Q14_relaxed_안을_고른다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    assert env.repo.get_option(env.repo.chosen_option(day_id)).course.label == "relaxed"


def test_S11_Q14_chosen이면_둘째_날에_저녁_예약이_하나(env):
    seeded = seed_chosen(env)
    record = env.repo.get_day(seeded["day_ids"][1])
    assert [(f.title, f.start, f.end) for f in record.plan.fixed] == [("저녁 예약", "18:30", "19:30")]
    fixed = record.plan.fixed[0]
    assert record.places[fixed.place_id].category == "food"
    assert (fixed.lat, fixed.lng) == (record.places[fixed.place_id].lat, record.places[fixed.place_id].lng)
    assert [env.repo.get_day(seeded["day_ids"][i]).plan.fixed for i in (0, 2)] == [[], []]


def test_S11_Q14_고른_코스에_저녁_예약이_고정_일정으로_들어간다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    items = env.repo.get_option(env.repo.chosen_option(day_id)).course.items
    assert [(i.start, i.end) for i in items if i.is_fixed] == [("18:30", "19:30")]


@pytest.mark.parametrize("use_chosen", [False, True], ids=["본문_없음", "chosen_false"])
def test_S11_Q14_chosen이_아니면_기본_시드_그대로_고정_일정이_없다(env, use_chosen):
    seeded = seed_chosen(env, chosen=False) if use_chosen else env.seed()
    assert [env.repo.get_day(day_id).plan.fixed for day_id in seeded["day_ids"]] == [[], [], []]


def test_S11_Q14_데모에서_15분_전_경계로_T_07을_볼_수_있다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    items = env.repo.get_option(env.repo.chosen_option(day_id)).course.items
    fixed = next(i for i in items if i.is_fixed)
    leave = int(fixed.start[:2]) * 60 + int(fixed.start[3:]) - fixed.travel_min
    assert demo_now(env, day_id, f"2026-12-02T{hhmm(leave - 16)}:00").json()["main"]["type"] != "T-07"
    main = demo_now(env, day_id, f"2026-12-02T{hhmm(leave - 15)}:00").json()["main"]
    assert main["type"] == "T-07"
    assert main["fixed"]["start"] == "18:30"
    assert main["fixed"]["facts"]  # §11 Q21: 장소가 있으면 상태


def test_S14_바로_보기의_17시_50분을_열_수_있다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    response = demo_now(env, day_id, "2026-12-02T17:50:00")
    assert response.status_code == 200
    assert response.json()["main"]["type"] in SUPPORTED


def test_S11_Q14_데모에서_예약_뒤_T_08까지_간다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    assert demo_now(env, day_id, "2026-12-02T19:30:00").json()["main"]["type"] == "T-08"


def test_A5_응답_모양은_그대로(env):
    assert set(seed_chosen(env)) == {"trip_id", "day_ids"}


def test_A5_옵션을_안_주면_예전과_같다(env):
    day_id = env.seed()["day_ids"][1]
    assert env.repo.chosen_option(day_id) is None
    assert assert_error(demo_now(env, day_id, "2026-12-02T10:00:00"), 404, "NOT_FOUND")["detail"]["resource"] == "course"


def test_A5_chosen이_false면_고르지_않는다(env):
    day_id = seed_chosen(env, chosen=False)["day_ids"][1]
    assert env.repo.chosen_option(day_id) is None


def test_A5_데모_하루를_5분씩_돌려도_늘_지원_카드만_나온다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    for minute in range(0, 24 * 60, 5):
        response = demo_now(env, day_id, f"2026-12-02T{hhmm(minute)}:00")
        assert response.status_code == 200, f"{hhmm(minute)}: {response.text}"
        view = response.json()
        assert view["main"]["type"] in SUPPORTED, hhmm(minute)
        assert set(types(view["subs"])) <= SUPPORTED, hhmm(minute)


def test_S12_R4_데모_T_07의_이름은_식당_제목은_저녁_예약(env):
    day_id = seed_chosen(env)["day_ids"][1]
    record = env.repo.get_day(day_id)
    fixed = demo_now(env, day_id, "2026-12-02T18:29:00").json()["main"]["fixed"]
    assert fixed["name"] == record.places[record.plan.fixed[0].place_id].name
    assert fixed["title"] == "저녁 예약"


# ---------- §11 Q19: day.must_visits.stay_min ----------


def must_stay(env, places: dict[str, Place], overrides: dict[str, int] | None = None) -> int:
    day_id = env.plant_day(places, day_plan(must=tuple(places), overrides=overrides, day=DAY))
    session = env.session(day_id)
    return session["day"]["must_visits"][0]["stay_min"]


def test_S11_Q19_머문_시간_없으면_60(env):
    assert must_stay(env, {"P01": place("P01", hours=week_hours())}) == 60


def test_S11_Q19_typical이_있으면_typical(env):
    stay = StayRange(min=30, typical=75, max=90)
    assert must_stay(env, {"P01": place("P01", hours=week_hours(), stay=stay)}) == 75


def test_S11_Q19_바꾼_값이_typical보다_먼저(env):
    stay = StayRange(min=30, typical=75, max=120)
    assert must_stay(env, {"P01": place("P01", hours=week_hours(), stay=stay)}, overrides={"P01": 105}) == 105


def test_S11_Q19_바꾼_값은_머문_시간이_없는_장소에도_먼저(env):
    assert must_stay(env, {"P01": place("P01", hours=week_hours())}, overrides={"P01": 45}) == 45


def adjusted_must(env) -> tuple[str, dict, int]:
    stay = StayRange(min=30, typical=60, max=120)
    places = {"P01": place("P01", hours=week_hours(), stay=stay)}
    for number in range(2, 8):
        places[f"P{number:02d}"] = place(f"P{number:02d}", km=float(number), hours=week_hours(), stay=stay)
    day_id = env.plant_day(places, day_plan(must=("P01",), day=DAY))
    sid, course = env.composing(day_id)
    option = course["options"][0]
    response = env.adjust(sid, option["option_id"], "P01", 15)
    assert response.status_code == 200, response.text
    body = response.json()
    changed = next(o for o in body["options"] if o["label"] == option["label"])
    return sid, body, next(i["stay_min"] for i in changed["items"] if i["place_id"] == "P01")


def test_S12_R5_adjust로_바꾼_값이_stay_min에(env):
    _, body, stayed = adjusted_must(env)
    assert stayed != 60  # 시험 자체 확인: typical과 다른 값이어야 구분된다
    assert body["day"]["must_visits"][0]["stay_min"] == stayed


def test_S14_고른_뒤_NowView_day에도_바꾼_값(env):
    sid, body, stayed = adjusted_must(env)
    chosen = body["options"][0]
    day_id = body["day"]["day_id"]
    assert env.select(chosen["option_id"]).status_code == 200
    view = env.client.get(f"/days/{day_id}/now", params={"at": "2026-12-02T10:00:00"}).json()
    assert view["day"]["must_visits"][0]["stay_min"] == stayed


def test_S12_R5_GET으로_다시_받아도_같다(env):
    sid, _, stayed = adjusted_must(env)
    assert env.client.get(f"/planning/{sid}").json()["day"]["must_visits"][0]["stay_min"] == stayed
