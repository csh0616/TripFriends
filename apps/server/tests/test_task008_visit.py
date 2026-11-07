"""TASK-008 영업 확인(T-05)·닫힘 대안(T-06), 서버. 근거: TASK-008 §0-1 G2, §A A1~A6, §B B1~B6, §C C4(서버 시드), §6, §7, §8 AC-2~AC-6·AC-9,
SRS-001 FR-14·15 AC-07·08, SCREEN-001 §3-2·§4-1(순위 2·3·4·5·6)·§5, DATA-001 E(visit_checks)·B(place_facts), TASK-007 B-1·B-3·B-4.

API 본문은 TASK-008 A5(`{day_id, at, was_open}`)를 따랐다. API-001 §2-3의 `{trip_day_id, was_open}`과 다르다 (TASK-007 §11 Q3처럼 TASK가 정본으로 봄, 질문).

계약 (보고서 ④, test-writer가 정한 것은 [정함] 표시):
    POST /places/{place_id}/visit-checks  본문 {day_id, at, was_open}
        → 200 NowView [정함: 200]. 열었어면 T-05가 사라지고, 닫혔어면 메인 T-06
        → 400 INVALID_REQUEST(본문) [정함], 404 NOT_FOUND detail.resource "day"·"place" [정함], 409 STATE_CONFLICT(A6)
    T-05 카드 [정함]: {type:"T-05", place:{place_id,name}, facts:[Fact], map_url}
        map_url = https://www.google.com/maps/search/?api=1&query={lat},{lng} (구글 지도 장소 검색, 좌표)
    T-06 카드 (B6): {type:"T-06", event_id, closed:{place_id,name}, proposals:[T06Proposal]}
    T06Proposal [정함]: {proposal_id, kind:"replace"|"skip", place:{place_id,name}|null, distance_m:int|null,
                        travel_change_min:int, facts:[Fact], reason:str|null, items:[NowCourseItem]}
        replace는 가까운 순, skip([빼고 가기])은 항상 하나·맨 끝. items = 닫힌 곳 자리부터의 남은 일정
    NowView.event (닫힘 사건이 하나만 열려 있을 때): type "closed", severity "high", state "awaiting"
    trip 저장소(app.state.trip_repo):
        event_by_key(day_id, "closed:{day_id}:{place_id}") → EventRecord (TASK-007 그대로, B1)
        get_visit_check(day_id, place_id) → VisitCheckRecord | None (.place_id, .day_id, .was_open, .checked_at: datetime) [정함]
    대안 계산은 graphs/trip.py의 모듈 이름 compose_courses (TASK-007 계약 그대로, 예외 주입 자리)
    대안을 반영(accept)하면 그날 꼭 갈 곳 목록이 planning 저장소 get_day(day_id).plan.must_visit에서 바뀐다 (§7)
"""

import ast
import logging
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from planning_api_helpers import assert_error, demo_places
from planning_helpers import place
from trip_helpers import (
    NOW_KEYS,
    OPEN_LATE,
    P01,
    accept,
    at_time,
    checked,
    chosen,
    dismiss,
    fixed_at,
    item,
    now,
    plant,
    spot,
    stores,
    to_min,
    types,
)

from deciders import JevDecider
from engine.compose import REASONS, compose_screen
from engine.models import StayRange

SERVER = Path(__file__).parents[1]
T05_KEYS = {"type", "place", "facts", "map_url"}
T06_KEYS = {"type", "event_id", "closed", "proposals"}
T06_PROPOSAL_KEYS = {"proposal_id", "kind", "place", "distance_m", "travel_change_min", "facts", "reason", "items"}
STATUSES = {"confirmed", "unverified", "unknown"}
STAY = StayRange(min=30, typical=60, max=120)
TIGHT = StayRange(min=30, typical=30, max=30)  # 머무는 시간이 하나뿐이라 relaxed·packed가 같다


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def without_logs(found: dict) -> dict:
    return {name: {k: v for k, v in snap.items() if k != "logs"} if isinstance(snap, dict) else snap for name, snap in found.items()}


@pytest.fixture
def quiet_env(env):
    env.client = TestClient(env.app, raise_server_exceptions=False)
    return env


def raise_forced(*args, **kwargs):
    raise RuntimeError("강제 예외 (시험)")


# ---------- 심어 두는 하루 ----------
# 1번 P01 10:12~12:00(이동 12), 2번 P02 12:20~14:00(이동 20 → 출발 12:00), 3번 P03 14:30~19:00(이동 30).
# P02의 영업 확인 창(A2) = 11:30 ≤ at < 12:20. 출발 10분 전(순위 5) = 11:50.


def unverified(pid: str = "P02", km: float = 2.0, status: str = "unverified", hours=OPEN_LATE, category: str = "cafe"):
    return place(pid, category=category, km=km, hours=hours, status=status if hours is not None else None, stay=STAY)


def alt(pid: str, east: float, category: str = "cafe", hours=OPEN_LATE, status: str | None = None, stay=STAY):
    """P02(북쪽 2.0km)에서 동쪽으로 east km."""
    return place(pid, category=category, km=2.0, east_km=east, hours=hours, status=status, stay=stay)


def visit_day(env, second=None, extra=(), must: tuple[str, ...] = ()) -> str:
    places = {"P01": spot("P01", 1.0), "P02": second or unverified(), "P03": spot("P03", 3.0)}
    for extra_place in extra:
        places[extra_place.id] = extra_place
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    return plant(env, items, places, must=must)


ALTS = (alt("A01", 0.3), alt("A02", 0.6), alt("A03", 0.9), alt("A04", 1.2))


def visit_check(env, day_id: str, place_id: str, clock: str, was_open, **extra):
    body = {"day_id": day_id, "at": at_time(clock), "was_open": was_open, **extra}
    return env.client.post(f"/places/{place_id}/visit-checks", json=body)


def answered(env, day_id: str, place_id: str, clock: str, was_open: bool) -> dict:
    response = visit_check(env, day_id, place_id, clock, was_open)
    assert response.status_code == 200, response.text
    return response.json()


def cards(view: dict) -> list[dict]:
    return [view["main"], *view["subs"]]


def card_of(view: dict, kind: str) -> dict | None:
    return next((card for card in cards(view) if card["type"] == kind), None)


def facts_of(view: dict, place_id: str) -> list[list[dict]]:
    """화면 어디에든(카드 안 일정 줄) 나온 그 장소의 facts 목록들."""
    found = []

    def walk(value):
        if isinstance(value, dict):
            if value.get("place_id") == place_id and "facts" in value:
                found.append(value["facts"])
            for inner in value.values():
                walk(inner)
        elif isinstance(value, list):
            for inner in value:
                walk(inner)

    walk(cards(view))
    return found


def trip_repo(env):
    return env.app.state.trip_repo


def closed_key(day_id: str, place_id: str = "P02") -> str:
    return f"closed:{day_id}:{place_id}"


def string_leaves(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for inner in value.values() for s in string_leaves(inner)]
    if isinstance(value, list):
        return [s for inner in value for s in string_leaves(inner)]
    return []


def replaces(card: dict) -> list[dict]:
    return [p for p in card["proposals"] if p["kind"] == "replace"]


def skip_of(card: dict) -> dict:
    found = [p for p in card["proposals"] if p["kind"] == "skip"]
    assert len(found) == 1
    return found[0]


def item_ids(entries: list[dict]) -> list[str | None]:
    return [e["place_id"] for e in entries]


def closed_view(env, extra=ALTS, must: tuple[str, ...] = ()) -> tuple[str, dict]:
    day_id = visit_day(env, extra=extra, must=must)
    view = answered(env, day_id, "P02", "11:40", False)
    assert view["main"]["type"] == "T-06"  # 시험 자체 확인
    return day_id, view


# ---------- A2·A3 언제 뜨나 (AC-2 = SRS AC-07) ----------


def test_T8_A2_AC2_출발_31분_전에는_T_05가_없다(env):
    view = now(env, visit_day(env), "11:29")
    assert "T-05" not in types(cards(view))
    assert view["main"]["type"] == "T-01"


@pytest.mark.parametrize("clock", ["11:30", "11:40", "11:49"], ids=["30분_전_정각", "20분_전", "11분_전"])
def test_T8_A2_AC2_출발_30분_전부터는_메인_T_05이고_짝은_T_02(env, clock):
    view = now(env, visit_day(env), clock)
    assert view["main"]["type"] == "T-05"
    assert types(view["subs"]) == ["T-02"]  # SCREEN-001 §5 T-05 → T-02
    assert view["reason"] == REASONS["T-05"]


@pytest.mark.parametrize("clock", ["11:50", "12:00", "12:10", "12:19"], ids=["출발_10분_전", "출발_정각", "이동_중", "도착_1분_전"])
def test_T8_A3_출발_10분_전부터는_T_02가_메인이고_T_05는_보조(env, clock):
    view = now(env, visit_day(env), clock)
    assert view["main"]["type"] == "T-02"
    assert types(view["subs"]) == ["T-05", "T-03"]  # SCREEN-001 §5 "T-02 → T-05(영업 확인 전이면), T-03"


@pytest.mark.parametrize("clock", ["12:20", "12:21", "13:59"], ids=["도착_정각", "도착_뒤", "일정_안"])
def test_T8_A2_AC2_도착_정각부터는_T_05가_없다(env, clock):
    assert "T-05" not in types(cards(now(env, visit_day(env), clock)))


@pytest.mark.parametrize("clock", ["11:30", "11:50", "12:10"])
def test_T8_A1_AC2_확인됨이면_창_안에서도_T_05가_없다(env, clock):
    view = now(env, visit_day(env, second=unverified(status="confirmed")), clock)
    assert "T-05" not in types(cards(view))


def test_T8_A1_확인됨이면_출발_10분_전_T_02의_짝은_T_03만(env):
    view = now(env, visit_day(env, second=unverified(status="confirmed")), "11:50")
    assert (view["main"]["type"], types(view["subs"])) == ("T-02", ["T-03"])


def test_T8_A1_영업시간_모름_unknown도_대상(env):
    view = now(env, visit_day(env, second=unverified(hours=None)), "11:30")
    assert view["main"]["type"] == "T-05"
    assert view["main"]["facts"][0]["status"] == "unknown"


def test_T8_A2_POST_check도_같은_창에서_T_05(env):
    assert checked(env, visit_day(env), "11:30")["main"]["type"] == "T-05"


def test_T8_A2_1분씩_돌려도_T_05는_창_안에서만(env):
    day_id = visit_day(env)
    for minute in range(10 * 60, 15 * 60):
        shown = "T-05" in types(cards(now(env, day_id, hhmm(minute))))
        assert shown is (to_min("11:30") <= minute < to_min("12:20")), hhmm(minute)


def test_T8_A2_창_밖에서는_T_02의_짝에_T_05가_없다_중립값(env):
    # A2: hours_checked=False는 창 안에서만. 3번(P03) 출발 14:00 전 10분은 P03이 확인됨이라 원래 없음 → 미확인 3번으로 확인
    places = {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0), "P03": unverified("P03", km=3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    day_id = plant(env, items, places)
    assert types(now(env, day_id, "11:50")["subs"]) == ["T-03"]  # 다음은 확인된 P02
    assert types(now(env, day_id, "13:50")["subs"]) == ["T-05", "T-03"]  # 다음은 미확인 P03, 창 안


# ---------- A4 T-05 카드 값 (AC-2·AC-6) ----------


def test_T8_A4_T_05_카드_모양(env):
    card = now(env, visit_day(env), "11:30")["main"]
    assert set(card) == T05_KEYS
    assert card["place"] == {"place_id": "P02", "name": "가상 P02"}


def test_T8_A4_AC6_사실에_상태_출처_확인_날짜(env):
    fact = now(env, visit_day(env), "11:30")["main"]["facts"][0]
    assert fact["field"] == "opening_hours"
    assert fact["status"] == "unverified"
    assert fact["source_type"] == "demo"
    assert fact["checked_at"] is None  # 앱이 "확인한 적 없음"으로 보여 준다 (C1)


def test_T8_A4_지도_링크는_구글_지도_장소_검색_좌표(env):
    card = now(env, visit_day(env), "11:30")["main"]
    url = urlparse(card["map_url"])
    assert (url.scheme, url.netloc, url.path) == ("https", "www.google.com", "/maps/search/")
    query = parse_qs(url.query)
    assert query["api"] == ["1"]
    lat, lng = map(float, query["query"][0].split(","))
    expected = unverified()
    assert (lat, lng) == pytest.approx((expected.lat, expected.lng), abs=1e-9)


def test_T8_A3_보조로_나온_T_05도_같은_값(env):
    day_id = visit_day(env)
    main = now(env, day_id, "11:30")["main"]
    sub = card_of(now(env, day_id, "11:50"), "T-05")
    assert sub == main


def test_T8_AC6_T_05_카드의_글자는_모두_데이터에서_온다(env):
    card = now(env, visit_day(env), "11:30")["main"]
    fact = card["facts"][0]
    allowed = {"T-05", "P02", "가상 P02", card["map_url"], fact["field"], fact["status"], fact["source_type"]}
    allowed |= {v for v in (fact["value"], fact["checked_at"]) if v is not None}
    assert set(string_leaves(card)) <= allowed


# ---------- A5 답 저장 ----------


def test_T8_A5_열었어는_200_NowView이고_T_05가_사라진다(env):
    view = answered(env, visit_day(env), "P02", "11:40", True)
    assert set(view) == NOW_KEYS
    assert view["at"] == at_time("11:40")
    assert "T-05" not in types(cards(view))
    assert view["main"]["type"] == "T-01"


def test_T8_A5_C2_열었어면_그날_그_장소의_사실은_확인됨_user_checked_at(env):
    day_id = visit_day(env)
    for view in (answered(env, day_id, "P02", "11:40", True), now(env, day_id, "11:50")):
        found = facts_of(view, "P02")
        assert found
        for facts in found:
            assert (facts[0]["status"], facts[0]["source_type"], facts[0]["checked_at"]) == ("confirmed", "user", at_time("11:40"))


def test_T8_A5_열었어면_visit_checks에_기록(env):
    day_id = visit_day(env)
    answered(env, day_id, "P02", "11:40", True)
    record = trip_repo(env).get_visit_check(day_id, "P02")
    assert (record.place_id, record.day_id, record.was_open, record.checked_at) == ("P02", day_id, True, datetime(2026, 12, 2, 11, 40))


def test_T8_A5_AC3_닫혔어면_visit_checks에_사용자_확인_닫힘과_날짜(env):
    day_id, _ = closed_view(env)
    record = trip_repo(env).get_visit_check(day_id, "P02")
    assert (record.was_open, record.checked_at) == (False, datetime(2026, 12, 2, 11, 40))


def test_T8_A5_닫혔어면_그날_사실은_휴무_확인됨_user(env):
    day_id, view = closed_view(env)
    found = facts_of(view, "P02")
    assert found  # T-03 남은 일정에 P02가 있다 (반영 전이라 일정 그대로)
    for facts in found:
        fact = facts[0]
        assert (fact["status"], fact["source_type"], fact["checked_at"], fact["value"]) == ("confirmed", "user", at_time("11:40"), None)


@pytest.mark.parametrize("was_open", [True, False])
def test_T8_A5_S7_원본_장소_데이터는_그대로(env, was_open):
    day_id = visit_day(env, extra=ALTS)
    before = env.repo.get_day(day_id).places["P02"].model_dump()
    answered(env, day_id, "P02", "11:40", was_open)
    assert env.repo.get_day(day_id).places["P02"].model_dump() == before


def test_T8_A5_답하기_전에는_확인_기록이_없다(env):
    day_id = visit_day(env)
    now(env, day_id, "11:40")
    assert trip_repo(env).get_visit_check(day_id, "P02") is None


# ---------- A6 같은 날 같은 장소는 한 번 (AC-5) ----------


def test_T8_A6_열었어_뒤에는_창_안에서도_다시_묻지_않는다(env):
    day_id = visit_day(env)
    answered(env, day_id, "P02", "11:35", True)
    for clock in ("11:40", "11:50", "12:10"):
        assert "T-05" not in types(cards(now(env, day_id, clock))), clock


@pytest.mark.parametrize("first, second", [(True, True), (True, False), (False, True), (False, False)])
def test_T8_A6_S6_같은_장소_두_번째_답은_409이고_그대로(env, first, second):
    day_id = visit_day(env, extra=ALTS)
    answered(env, day_id, "P02", "11:40", first)
    before, course = without_logs(stores(env)), chosen(env, day_id)
    assert_error(visit_check(env, day_id, "P02", "11:45", second), 409, "STATE_CONFLICT")
    assert without_logs(stores(env)) == before
    assert chosen(env, day_id) == course
    assert trip_repo(env).get_visit_check(day_id, "P02").was_open is first


def test_T8_A6_S7_다른_날에는_다시_묻고_원본_사실_그대로(env):
    shared = {"P01": spot("P01", 1.0), "P02": unverified(), "P03": spot("P03", 3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    one, other = plant(env, items, shared), plant(env, items, shared)
    answered(env, one, "P02", "11:40", True)
    view = now(env, other, "11:40")
    assert view["main"]["type"] == "T-05"
    assert (view["main"]["facts"][0]["status"], view["main"]["facts"][0]["source_type"]) == ("unverified", "demo")
    assert trip_repo(env).get_visit_check(other, "P02") is None


# ---------- visit-check 오류 ----------

BAD_BODIES = [
    {"at": "2026-12-02T11:40:00", "was_open": True},
    {"day_id": "{day}", "was_open": True},
    {"day_id": "{day}", "at": "2026-12-02T11:40:00"},
    {"day_id": "{day}", "at": "아무말", "was_open": True},
    {"day_id": "{day}", "at": "2026-12-02T11:40:00+09:00", "was_open": True},
    {"day_id": "{day}", "at": "2026-12-02T11:40:00", "was_open": "아무말"},
]
BAD_IDS = ["day_id_없음", "at_없음", "was_open_없음", "at_형식_오류", "시간대_붙음", "was_open_형식_오류"]


@pytest.mark.parametrize("body", BAD_BODIES, ids=BAD_IDS)
def test_T8_A5_본문_오류는_400이고_아무것도_안_바뀐다(env, body):
    day_id = visit_day(env)
    before = without_logs(stores(env))
    filled = {k: (day_id if v == "{day}" else v) for k, v in body.items()}
    assert_error(env.client.post("/places/P02/visit-checks", json=filled), 400, "INVALID_REQUEST")
    assert without_logs(stores(env)) == before


def test_T8_A5_없는_날은_404_day(env):
    visit_day(env)
    error = assert_error(visit_check(env, "없는-날", "P02", "11:40", True), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "day"


def test_T8_A5_그날_데이터에_없는_장소는_404_place(env):
    day_id = visit_day(env)
    error = assert_error(visit_check(env, day_id, "없는-장소", "11:40", True), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "place"


def test_T8_A5_하루_밖_날짜는_400(env):
    day_id = visit_day(env)
    response = env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": "2026-12-03T11:40:00", "was_open": True})
    assert_error(response, 400, "INVALID_REQUEST")
    assert trip_repo(env).get_visit_check(day_id, "P02") is None


# ---------- B1 [닫혔어] → 사건 (AC-3 = SRS AC-08) ----------


def test_T8_B1_닫혔어면_closed_사건_높음_awaiting_dedupe_key(env):
    day_id, view = closed_view(env)
    record = trip_repo(env).event_by_key(day_id, closed_key(day_id))
    assert record is not None
    assert (record.severity, record.state) == ("high", "awaiting")
    assert view["main"]["event_id"] == record.event_id


def test_T8_B1_NowView_event는_closed_사건(env):
    _, view = closed_view(env)
    event = view["event"]
    assert (event["type"], event["severity"], event["state"]) == ("closed", "high", "awaiting")
    assert event["event_id"] == view["main"]["event_id"]


def test_T8_B1_그래프_스레드는_사건_ID이고_awaiting에서_기다린다(env):
    day_id, view = closed_view(env)
    state = env.app.state.trip_graph.get_state({"configurable": {"thread_id": view["main"]["event_id"]}})
    assert state.next  # interrupt에서 멈춰 있다


def test_T8_B1_FR13_닫혔어만으로는_일정이_안_바뀐다(env):
    day_id = visit_day(env, extra=ALTS)
    course = chosen(env, day_id)
    answered(env, day_id, "P02", "11:40", False)
    assert chosen(env, day_id) == course
    for clock in ("11:45", "12:00", "12:30"):
        view = now(env, day_id, clock)
        assert "P02" in [pin["place_id"] for pin in view["pins"]]
        assert chosen(env, day_id) == course


# ---------- B6 T-06 카드 ----------


def test_T8_B6_메인_T_06_짝_T_03_이유는_compose_문장(env):
    _, view = closed_view(env)
    assert types(view["subs"]) == ["T-03"]
    assert view["reason"] == REASONS["T-06"]


def test_T8_B6_T_06_카드_모양(env):
    _, view = closed_view(env)
    card = view["main"]
    assert set(card) == T06_KEYS
    assert card["closed"] == {"place_id": "P02", "name": "가상 P02"}
    for proposal in card["proposals"]:
        assert set(proposal) == T06_PROPOSAL_KEYS
        assert type(proposal["proposal_id"]) is str and proposal["proposal_id"]
        assert proposal["kind"] in {"replace", "skip"}
        assert type(proposal["travel_change_min"]) is int


def test_T8_B6_GET_now에도_T_06이_계속_메인(env):
    day_id, view = closed_view(env)
    for clock in ("11:45", "11:55", "12:10"):
        later = now(env, day_id, clock)
        assert later["main"]["type"] == "T-06", clock
        assert later["main"]["event_id"] == view["main"]["event_id"]
        assert later["main"]["proposals"] == view["main"]["proposals"]


# ---------- B2·B3·B4 대안 (AC-3·AC-4) ----------


def test_T8_B2_AC3_대안은_가까운_순_최대_3곳이고_빼고_가기가_맨_끝(env):
    _, view = closed_view(env)
    card = view["main"]
    assert [p["place"]["place_id"] for p in replaces(card)] == ["A01", "A02", "A03"]
    assert card["proposals"][-1]["kind"] == "skip"
    assert len(card["proposals"]) == 4


def test_T8_B2_AC4_1_5km_안팎(env):
    _, view = closed_view(env, extra=(alt("N01", 1.49), alt("X01", 1.51)))
    assert [p["place"]["place_id"] for p in replaces(view["main"])] == ["N01"]


def test_T8_B2_AC4_unknown과_다른_종류는_빠진다(env):
    extra = (alt("U01", 0.1, hours=None), alt("F01", 0.2, category="food"), alt("A01", 0.5))
    _, view = closed_view(env, extra=extra)
    assert [p["place"]["place_id"] for p in replaces(view["main"])] == ["A01"]


def test_T8_B2_코스에_있는_곳은_대안이_아니다(env):
    # P01·P03도 같은 cafe이고 P02에서 1km 안이다
    _, view = closed_view(env, extra=())
    assert replaces(view["main"]) == []


def test_T8_B4_대안이_0곳이면_빼고_가기만(env):
    _, view = closed_view(env, extra=())
    proposals = view["main"]["proposals"]
    assert [p["kind"] for p in proposals] == ["skip"]


def test_T8_B3_대안_칸의_값(env):
    _, view = closed_view(env)
    first = replaces(view["main"])[0]
    assert first["place"] == {"place_id": "A01", "name": "가상 A01"}
    assert abs(first["distance_m"] - 300) <= 1
    assert first["facts"] and first["facts"][0]["field"] == "opening_hours"
    assert first["facts"][0]["status"] in STATUSES
    ids = item_ids(first["items"])
    assert "A01" in ids and "P02" not in ids and "P03" in ids
    assert "P01" not in ids  # 지난 일정은 제안에 없다


def test_T8_B4_빼고_가기_칸의_값(env):
    _, view = closed_view(env)
    skip = skip_of(view["main"])
    assert (skip["place"], skip["distance_m"], skip["facts"]) == (None, None, [])
    assert item_ids(skip["items"]) == ["P03"]


def test_T8_B3_제안의_일정_줄에는_상태가_있다(env):
    _, view = closed_view(env)
    for proposal in view["main"]["proposals"]:
        for entry in proposal["items"]:
            if entry["place_id"] is not None:
                assert entry["facts"] and all(f["status"] in STATUSES for f in entry["facts"])


def tight_day(env) -> str:
    """B3 고정 일정을 못 지키는 대안은 뺀다.
    1번 P01(북 1.0) 10:12~11:50, 2번 C02(북 1.3, 미확인) 12:00~12:30, 3번 고정 F03(북 1.0·동 0.3) 12:40~13:40.
    N01(북 1.35): P01→N01 5분 + 30분 + N01→F03 7분 = 42분 → 11:50에 떠나도 12:32 도착 (지킴)
    R01(북 2.75, C02에서 1.45km): 16분 + 30분 + 16분 = 62분 → 11:40에 떠나도 12:42 도착 (못 지킴)
    하루 끝 14:30: 고정 일정 뒤에 넣으면 숙소 복귀가 하루 끝을 넘어서(N01 14:32, R01 14:45) 고정 일정 앞에만 들어갈 수 있다.
    (엔진은 고정 일정을 늘 지키고 못 넣는 곳을 뺀다: R01은 빠진 안이 되므로 R01 대안은 없다)"""
    places = {
        "P01": place("P01", km=1.0, hours=OPEN_LATE, stay=TIGHT),
        "C02": place("C02", km=1.3, hours=OPEN_LATE, status="unverified", stay=TIGHT),
        "F03": place("F03", category="experience", km=1.0, east_km=0.3, hours=OPEN_LATE, stay=TIGHT),
        "N01": place("N01", km=1.35, hours=OPEN_LATE, stay=TIGHT),
        "R01": place("R01", km=2.75, hours=OPEN_LATE, stay=TIGHT),
    }
    items = [item(1, "P01", "10:12", "11:50", 12), item(2, "C02", "12:00", "12:30", 10), item(3, "F03", "12:40", "13:40", 7, fixed=True)]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "12:40", "13:40"),), end="14:30")


def test_T8_B3_고정_일정을_못_지키는_대안은_뺀다(env):
    day_id = tight_day(env)
    view = answered(env, day_id, "C02", "11:40", False)
    card = view["main"]
    assert [p["place"]["place_id"] for p in replaces(card)] == ["N01"]
    kept = [(e["place_id"], e["start"], e["end"]) for e in replaces(card)[0]["items"] if e["is_fixed"]]
    assert kept == [("F03", "12:40", "13:40")]
    assert card["proposals"][-1]["kind"] == "skip"


# ---------- B5 [이걸로]·[그대로 둘게] ----------


def test_T8_B5_이걸로는_닫힌_곳을_대안으로_바꾼_새_코스안(env):
    day_id, view = closed_view(env)
    old_id, old = chosen(env, day_id)
    pick = replaces(view["main"])[0]
    response = accept(env, pick["proposal_id"])
    assert response.status_code == 200, response.text
    new_id, new = chosen(env, day_id)
    assert new_id != old_id
    assert env.repo.get_option(old_id).course == old  # 옛 안은 남긴다 (TASK-007 B-3)
    assert [(i.place_id, i.start, i.end) for i in new.items[:1]] == [(i.place_id, i.start, i.end) for i in old.items[:1]]  # 지난 항목 그대로
    ids = [i.place_id for i in new.items]
    assert "P02" not in ids and "A01" in ids and "P03" in ids


def test_T8_B5_이걸로_응답은_T_06이_사라지고_사건은_resolved(env):
    day_id, view = closed_view(env)
    after = accept(env, replaces(view["main"])[0]["proposal_id"]).json()
    assert after["main"]["type"] != "T-06"
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)).state == "resolved"
    assert now(env, day_id, "11:45")["main"]["type"] not in {"T-05", "T-06"}


def test_T8_B4_빼고_가기를_고르면_닫힌_곳만_빠진다(env):
    day_id, view = closed_view(env)
    assert accept(env, skip_of(view["main"])["proposal_id"]).status_code == 200
    ids = [i.place_id for i in chosen(env, day_id)[1].items]
    assert ids == ["P01", "P03"]


def test_T8_B5_그대로_둘게는_일정과_닫힌_곳_그대로(env):
    day_id, view = closed_view(env)
    course = chosen(env, day_id)
    after = dismiss(env, view["main"]["event_id"])
    assert after.status_code == 200, after.text
    assert chosen(env, day_id) == course
    assert after.json()["main"]["type"] != "T-06"
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)).state == "resolved"
    later = now(env, day_id, "11:45")
    assert "P02" in [pin["place_id"] for pin in later["pins"]]
    assert "T-05" not in types(cards(later))  # A6: 이미 답했다


def test_T8_B5_처리된_사건에_다시_고르면_409이고_그대로(env):
    day_id, view = closed_view(env)
    assert dismiss(env, view["main"]["event_id"]).status_code == 200
    course, before = chosen(env, day_id), without_logs(stores(env))
    assert_error(accept(env, replaces(view["main"])[0]["proposal_id"]), 409, "STATE_CONFLICT")
    assert_error(dismiss(env, view["main"]["event_id"]), 409, "STATE_CONFLICT")
    assert chosen(env, day_id) == course
    assert without_logs(stores(env)) == before


# ---------- §6 실패하면 (AC-5) ----------


def test_T8_S6_대안_계산_중_예외면_500이고_기록_사건_일정_답_모두_그대로(quiet_env, monkeypatch):
    env = quiet_env
    day_id = visit_day(env, extra=ALTS)
    before, course = without_logs(stores(env)), chosen(env, day_id)
    with monkeypatch.context() as patch:
        patch.setattr("graphs.trip.compose_courses", raise_forced)
        assert_error(visit_check(env, day_id, "P02", "11:40", False), 500, "INTERNAL_ERROR")
    assert without_logs(stores(env)) == before
    assert chosen(env, day_id) == course
    assert trip_repo(env).get_visit_check(day_id, "P02") is None
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)) is None
    assert now(env, day_id, "11:41")["main"]["type"] == "T-05"  # 확인 답도 저장 안 됨 → 다시 묻는다
    retry = visit_check(env, day_id, "P02", "11:42", False)  # 다음 요청은 정상 (409 아님)
    assert retry.status_code == 200, retry.text
    assert retry.json()["main"]["type"] == "T-06"


@pytest.mark.parametrize("clock, status", [("11:54", 200), ("11:55", 409)], ids=["14분_뒤", "15분_뒤"])
def test_T8_S6_대안_accept_오래됨은_TASK007_B4와_같다(env, clock, status):
    day_id, view = closed_view(env)
    checked(env, day_id, clock)  # 그날 마지막 check의 at (TASK-007 §11 Q7)
    response = accept(env, replaces(view["main"])[0]["proposal_id"])
    assert response.status_code == status, response.text
    if status == 409:
        assert assert_error(response, 409, "STATE_CONFLICT")["detail"]["reason"] == "stale"


# ---------- §7 겹치면 (AC-5) ----------


def test_T8_S7_늦어짐_awaiting과_닫힘_awaiting이면_T_04가_메인이고_둘_다_열려_있다(env):
    day_id, closed = closed_view(env)
    late = checked(env, day_id, "12:20", P01)  # 1번에서 20분 늦음 → 높음
    assert late["main"]["type"] == "T-04"
    assert "T-06" not in types(cards(late))
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)).state == "awaiting"  # 종류가 다르면 닫지 않는다
    assert dismiss(env, late["main"]["event_id"]).status_code == 200
    after = now(env, day_id, "12:21")
    assert after["main"]["type"] == "T-06"
    assert after["main"]["event_id"] == closed["main"]["event_id"]


def fixed_after_closed(env) -> str:
    """2번 P02(미확인) 12:20~13:00, 3번 고정 F03 13:30~14:30(이동 20 → 출발 13:10, 15분 전 = 12:55)."""
    places = {"P01": spot("P01", 1.0), "P02": unverified(), "F03": spot("F03", 2.5, category="experience"), **{a.id: a for a in ALTS}}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "13:00", 20), item(3, "F03", "13:30", "14:30", 20, fixed=True)]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "13:30", "14:30"),))


@pytest.mark.parametrize("clock, main", [("12:54", "T-06"), ("12:55", "T-07")], ids=["고정_출발_16분_전", "고정_출발_15분_전"])
def test_T8_S7_고정_일정_임박이면_T_07이_메인(env, clock, main):
    day_id = fixed_after_closed(env)
    assert answered(env, day_id, "P02", "11:40", False)["main"]["type"] == "T-06"
    assert now(env, day_id, clock)["main"]["type"] == main


def test_T8_S7_닫힌_곳이_꼭_갈_곳이면_대안은_같게_빼고_가기_이유에_표시(env):
    _, view = closed_view(env, must=("P02",))
    card = view["main"]
    assert [p["place"]["place_id"] for p in replaces(card)] == ["A01", "A02", "A03"]
    assert "꼭 갈 곳이었어" in (skip_of(card)["reason"] or "")


def test_T8_S7_꼭_갈_곳이_아니면_그_표시가_없다(env):
    _, view = closed_view(env)
    assert "꼭 갈 곳" not in (skip_of(view["main"])["reason"] or "")


def test_T8_S7_꼭_갈_곳을_대안으로_바꾸면_꼭_갈_곳_목록도_대안으로(env):
    day_id, view = closed_view(env, must=("P02",))
    assert accept(env, replaces(view["main"])[0]["proposal_id"]).status_code == 200
    must = env.repo.get_day(day_id).plan.must_visit
    assert "A01" in must and "P02" not in must


# ---------- AC-6 사실 값 ----------


def test_T8_AC6_T_06의_모든_장소_사실에_상태가_있고_이름은_데이터_그대로(env):
    _, view = closed_view(env)
    card = view["main"]
    names = {p.id: p.name for p in ALTS}
    for proposal in replaces(card):
        assert proposal["place"]["name"] == names[proposal["place"]["place_id"]]
        assert proposal["facts"] and all(f["status"] in STATUSES for f in proposal["facts"])


@pytest.mark.parametrize("was_open", [True, False])
def test_T8_AC6_영업_여부를_지어낸_문장이_없다(env, was_open):
    day_id = visit_day(env, extra=ALTS)
    views = [now(env, day_id, "11:30"), answered(env, day_id, "P02", "11:40", was_open)]
    guesses = ("열었을", "열려 있을", "열 거야", "영업 중일", "아마")
    for view in views:
        for text in string_leaves(cards(view)):
            assert not any(word in text for word in guesses), text


# ---------- C4 데모 시드 (서버) ----------


def seed_chosen(env, chosen_flag: bool = True) -> dict:
    response = env.client.post("/debug/seed-demo", json={"chosen": chosen_flag})
    assert response.status_code == 201, response.text
    return response.json()


def third(env, day_id: str):
    return env.repo.get_option(env.repo.chosen_option(day_id)).course.items[2]


def test_T8_C4_데모_3번_장소는_그날_미확인이고_출처_demo(env):
    day_id = seed_chosen(env)["day_ids"][1]
    entry = third(env, day_id)
    view = now(env, day_id, entry.start)  # 3번 일정 안: 메인 T-01이 3번
    assert view["main"]["item"]["place_id"] == entry.place_id
    fact = view["main"]["item"]["facts"][0]
    assert (fact["status"], fact["source_type"]) == ("unverified", "demo")


def test_T8_C4_AC2_데모_3번_출발_30분_전에_T_05_31분_전에는_없다(env):
    day_id = seed_chosen(env)["day_ids"][1]
    entry = third(env, day_id)
    leave = to_min(entry.start) - entry.travel_min
    before = now(env, day_id, hhmm(leave - 31))
    assert not [c for c in cards(before) if c["type"] == "T-05" and c["place"]["place_id"] == entry.place_id]
    view = now(env, day_id, hhmm(leave - 30))
    assert view["main"]["type"] == "T-05"
    assert view["main"]["place"]["place_id"] == entry.place_id


def test_T8_C4_다른_날의_같은_장소는_원본_상태(env):
    seeded = seed_chosen(env)
    pid = third(env, seeded["day_ids"][1]).place_id
    original = demo_places()[pid].hours_status
    for index in (0, 2):
        assert env.repo.get_day(seeded["day_ids"][index]).places[pid].hours_status == original


def test_T8_C4_chosen이_아니면_장소_상태는_원본_그대로(env):
    seeded = seed_chosen(env, chosen_flag=False)
    original = {pid: p.hours_status for pid, p in demo_places().items()}
    for day_id in seeded["day_ids"]:
        assert {pid: p.hours_status for pid, p in env.repo.get_day(day_id).places.items()} == original


# ---------- §0-1 G2 대체(A3) 로그 문장 형식 ----------


@pytest.mark.parametrize(
    "card, change",
    [("T-09", lambda s: {"walked_km": 12.0}), ("X-01", lambda s: {"safety": True}), ("T-13", lambda s: {"chat_pick": "T-13"})],
    ids=["T-09", "X-01", "T-13"],
)
def test_T8_G2_대체_로그_문장은_승인된_형식(env, monkeypatch, caplog, card, change):
    def forced(snapshot):
        screen = compose_screen(snapshot.model_copy(update=change(snapshot)))
        assert screen.main == card  # 시험 자체 확인
        return screen

    monkeypatch.setattr("trip.now.compose_screen", forced)
    day_id = plant(env, [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20)], {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0)})
    with caplog.at_level(logging.DEBUG, logger="trip.now"):
        now(env, day_id, "12:40")
    records = [r for r in caplog.records if r.name == "trip.now" and "T-01로 바꿨어" in r.getMessage()]
    assert records
    assert {r.getMessage() for r in records} == {f"지원 밖 카드 {card}가 나와 T-01로 바꿨어 (A3)"}
    assert {r.levelno for r in records} == {logging.WARNING}


# ---------- AC-9 LLM·Jev 0회 ----------


def run_visit_events(env) -> None:
    opened = visit_day(env, extra=ALTS)
    now(env, opened, "11:30")
    answered(env, opened, "P02", "11:40", True)
    day_id, view = closed_view(env)
    accept(env, replaces(view["main"])[0]["proposal_id"])
    other, second = closed_view(env)
    dismiss(env, second["main"]["event_id"])
    skipped, third_view = closed_view(env, must=("P02",))
    accept(env, skip_of(third_view["main"])["proposal_id"])
    answered(env, tight_day(env), "C02", "11:40", False)


@pytest.mark.parametrize("key", [None, "test-key"], ids=["키_없음", "키_있음"])
def test_T8_AC9_영업_확인과_닫힘_대안에서_Jev와_바깥_HTTP_호출_0회(monkeypatch, key):
    import httpx

    from api.main import app
    from planning_api_helpers import PlanningEnv

    calls = []

    def counter(name):
        def record(*args, **kwargs):
            calls.append(name)
            raise AssertionError(f"{name} 호출됨")

        return record

    monkeypatch.delenv("APP_ENV", raising=False)
    if key:
        monkeypatch.setenv("AI_GATEWAY_API_KEY", key)
    else:
        monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.setattr(JevDecider, "warm_up", lambda self: None)
    monkeypatch.setattr(JevDecider, "decide", counter("JevDecider.decide"))
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", counter("http"))
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", counter("async http"))

    with TestClient(app) as client:
        run_visit_events(PlanningEnv(client, app))

    assert calls == []


def test_T8_AC9_LLM_도구를_불러오지_않는다(env):
    run_visit_events(env)
    assert not {"anthropic", "openai", "langchain_openai", "langchain_anthropic"} & set(sys.modules)


@pytest.mark.parametrize("path", ["graphs/trip.py", "trip/visit.py", "trip/now.py"])
def test_T8_AC9_규칙_코드는_판단기와_HTTP를_import하지_않는다(path):
    tree = ast.parse((SERVER / path).read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"deciders", "httpx", "requests", "anthropic", "openai"}


def test_T8_B6_NowView_스키마에_T_05와_T_06이_있다(env):
    schemas = env.app.openapi()["components"]["schemas"]
    main = repr(schemas["NowView"]["properties"]["main"])
    assert "T-05" in main or "NowCardT05" in main
    assert "T-06" in main or "NowCardT06" in main
