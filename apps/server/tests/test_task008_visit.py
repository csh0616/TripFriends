"""TASK-008 영업 확인(T-05)·닫힘 대안(T-06), 서버. 근거: TASK-008 §0-1 G2, §A A1~A6, §B B1~B6, §C C4(서버 시드), §6, §7, §8 AC-2~AC-6·AC-9,
SRS-001 FR-14·15 AC-07·08, SCREEN-001 §3-2·§4-1(순위 2·3·4·5·6)·§5, DATA-001 E(visit_checks)·B(place_facts), TASK-007 B-1·B-3·B-4.

API 본문은 TASK-008 A5(`{day_id, at, was_open}`)가 정본 (§11 Q1, API-001 §2-3 표시).

계약 (§11 Q2·Q3·Q4 승인. test-writer가 정한 것은 [정함] 표시):
    POST /places/{place_id}/visit-checks  본문 {day_id, at, was_open}
        → 200 NowView (Q2). 열었어면 T-05가 사라지고, 닫혔어면 메인 T-06
        → 400 INVALID_REQUEST(본문), 404 NOT_FOUND detail.resource "day"·"place" (Q2), 409 STATE_CONFLICT(A6)
    T-05 카드 (Q3): {type:"T-05", place:{place_id,name}, facts:[Fact], map_url}
        map_url = https://www.google.com/maps/search/?api=1&query={lat},{lng} (구글 지도 장소 검색, 좌표)
    T-06 카드 (B6): {type:"T-06", event_id, closed:{place_id,name}, proposals:[T06Proposal]}
    T06Proposal (§11 Q4 = TASK-007 제안 + closed):
        TASK-007 B-5 키 그대로 {proposal_id, label:"relaxed"(§12 Q22), reason:str, dropped:[{place_id,name}],
                                keeps_fixed:bool, first_leave_at:"HH:MM", items:[NowCourseItem]}
        + closed [정함 안쪽 키]: {alternative:{place_id,name}|null, distance_m:int|null, travel_change_min:int, reordered:bool}
            alternative = 닫힌 곳 대신 갈 대안 (C3 이름), distance_m = 닫힌 곳에서 직선거리 m (C3 거리),
            travel_change_min = 남은 이동 분 합(숙소 복귀 포함), 바뀐 뒤 − 바뀌기 전 (Q4, C3 이동 변화)
                reordered = §14: 닫힌 곳 자리에 넣어서는 영업시간·고정 일정·하루 끝을 못 지켜 compose_courses로 다시 짠 안이면 true [정함 위치]
        [빼고 가기] = alternative null (그 제안의 dropped에 닫힌 곳이 들어 있다), reordered 늘 false (§14 순서 그대로)
        대안의 사실 칩은 items 안 그 대안 줄의 facts (TASK-007 NowCourseItem 그대로)
        대안이 들르는 시각("{HH:MM}에 들러", §14) = items 안 그 대안 줄의 start [정함, 새 키 없음 — §12 Q21처럼 값의 출처를 한 곳으로]
        대안 제안은 가까운 순, [빼고 가기]는 항상 하나·맨 끝(B4 "덧붙인다"). items = 닫힌 곳 자리부터의 남은 일정
        §14 (B3 고침): 대안은 닫힌 곳의 같은 순번(seq)에, 뒤 일정은 순서·머무는 시간 그대로 시각만 다시 계산.
            [빼고 가기]도 순서 그대로 시각만. [빼고 가기]도 못 만들면(그리고 대안도 없으면) 제안 0개
    NowView.event (닫힘 사건이 하나만 열려 있을 때): type "closed", severity "high", state "awaiting"
    trip 저장소(app.state.trip_repo):
        event_by_key(day_id, "closed:{day_id}:{place_id}") → EventRecord (TASK-007 그대로, B1)
        get_visit_check(day_id, place_id) → VisitCheckRecord | None (.place_id, .day_id, .was_open, .checked_at: datetime) [정함]
    다시 짜는 계산은 graphs/trip.py의 모듈 이름 compose_courses (TASK-007 계약 그대로, 예외 주입 자리. §14부터는 닫힌 곳 자리에 못 넣을 때만 부른다)
    대안을 반영(accept)하면 그날 꼭 갈 곳 목록이 planning 저장소 get_day(day_id).plan.must_visit에서 바뀐다 (§7)
"""

from auth_helpers import TESTER, bearer, install_fake_jwks  # TASK-012 §10 Q4: 계획·여행 중 API도 Bearer
import ast
import logging
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from planning_api_helpers import assert_error, demo_places, week_hours
from planning_helpers import place
from trip_helpers import (
    NOW_KEYS,
    OPEN_LATE,
    P01,
    PROPOSAL_KEYS,
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
from engine.planning import distance_km

SERVER = Path(__file__).parents[1]
T05_KEYS = {"type", "place", "facts", "map_url"}
T06_KEYS = {"type", "event_id", "closed", "proposals"}
T06_PROPOSAL_KEYS = PROPOSAL_KEYS | {"closed"}  # §11 Q4: TASK-007 제안 + closed
T06_CLOSED_KEYS = {"alternative", "distance_m", "travel_change_min", "reordered"}  # closed 안쪽 [정함], reordered는 §14
STATUSES = {"confirmed", "unverified", "unknown"}
STAY = StayRange(min=30, typical=60, max=120)
TIGHT = StayRange(min=30, typical=30, max=30)  # 머무는 시간이 하나뿐이라 relaxed·packed가 같다


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def without_logs(found: dict) -> dict:
    return {name: {k: v for k, v in snap.items() if k != "logs"} if isinstance(snap, dict) else snap for name, snap in found.items()}


@pytest.fixture
def quiet_env(env):
    env.client = TestClient(env.app, headers=bearer(TESTER), raise_server_exceptions=False)
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
    return [p for p in card["proposals"] if p["closed"]["alternative"] is not None]


def skip_of(card: dict) -> dict:
    found = [p for p in card["proposals"] if p["closed"]["alternative"] is None]
    assert len(found) == 1
    return found[0]


def alt_id(proposal: dict) -> str:
    return proposal["closed"]["alternative"]["place_id"]


def alt_ids(card: dict) -> list[str]:
    return [alt_id(p) for p in replaces(card)]


def alt_facts(proposal: dict) -> list[dict]:
    """대안의 사실 칩 = items 안 그 대안 줄의 facts."""
    found = [e["facts"] for e in proposal["items"] if e["place_id"] == alt_id(proposal)]
    assert len(found) == 1
    return found[0]


def dropped_ids(proposal: dict) -> set[str]:
    return {gone["place_id"] for gone in proposal["dropped"]}


def is_hhmm(value) -> bool:
    return isinstance(value, str) and len(value) == 5 and value[2] == ":" and value[:2].isdigit() and value[3:].isdigit()


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


def test_T8_A5_Q17_열었어면_사실_값은_원래_영업시간_그대로(env):
    day_id = visit_day(env)
    value = now(env, day_id, "11:30")["main"]["facts"][0]["value"]
    assert value is not None  # 시험 자체 확인 (영업시간 있는 곳)
    view = answered(env, day_id, "P02", "11:40", True)
    for facts in facts_of(view, "P02"):
        assert facts[0]["value"] == value


def test_T8_A5_Q17_영업시간_모름인_곳에_열었어면_값은_null이고_확인됨(env):
    day_id = visit_day(env, second=unverified(hours=None))
    view = answered(env, day_id, "P02", "11:40", True)
    found = facts_of(view, "P02")
    assert found
    for facts in found:
        assert (facts[0]["value"], facts[0]["status"], facts[0]["source_type"]) == (None, "confirmed", "user")


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


@pytest.mark.parametrize("pid", ["P01", "P03"], ids=["지금_장소_확인됨", "다음_아닌_장소_확인됨"])
def test_T8_A5_Q9_확인_대상이_아닌_확인됨_장소는_409이고_그대로(env, pid):
    day_id = visit_day(env)
    before = without_logs(stores(env))
    assert_error(visit_check(env, day_id, pid, "11:40", False), 409, "STATE_CONFLICT")
    assert without_logs(stores(env)) == before
    assert trip_repo(env).get_visit_check(day_id, pid) is None


def test_T8_A5_Q9_미확인이어도_다음_일정이_아니면_409(env):
    # P03도 미확인. 11:40의 다음 일정은 P02라 P03은 대상이 아니다 (A1 "다음 일정 장소")
    places = {"P01": spot("P01", 1.0), "P02": unverified(), "P03": unverified("P03", km=3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    day_id = plant(env, items, places)
    before = without_logs(stores(env))
    assert_error(visit_check(env, day_id, "P03", "11:40", False), 409, "STATE_CONFLICT")
    assert without_logs(stores(env)) == before


# §12 Q26: 다음 장소(P02, 미확인)라도 확인 시간(출발 12:00 − 30 ≤ at < 시작 12:20, A2) 밖이면 409, 저장소 그대로
@pytest.mark.parametrize("clock", ["11:29", "12:20"], ids=["출발_31분_전", "도착_정각"])
def test_T8_A5_Q26_확인_시간_밖의_visit_check는_409이고_그대로(env, clock):
    day_id = visit_day(env)
    before = without_logs(stores(env))
    assert_error(visit_check(env, day_id, "P02", clock, False), 409, "STATE_CONFLICT")
    assert without_logs(stores(env)) == before
    assert trip_repo(env).get_visit_check(day_id, "P02") is None


@pytest.mark.parametrize("clock", ["11:30", "12:19"], ids=["출발_30분_전_정각", "도착_1분_전"])
def test_T8_A5_Q26_확인_시간_안의_visit_check는_200(env, clock):
    day_id = visit_day(env)
    assert visit_check(env, day_id, "P02", clock, True).status_code == 200


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


def test_T8_B6_Q4_T_06_카드와_제안_모양은_TASK007_제안_더하기_closed(env):
    _, view = closed_view(env)
    card = view["main"]
    assert set(card) == T06_KEYS
    assert card["closed"] == {"place_id": "P02", "name": "가상 P02"}
    for proposal in card["proposals"]:
        assert set(proposal) == T06_PROPOSAL_KEYS
        assert type(proposal["proposal_id"]) is str and proposal["proposal_id"]
        assert proposal["label"] == "relaxed"  # §12 Q22
        assert type(proposal["reason"]) is str and proposal["reason"]
        assert type(proposal["keeps_fixed"]) is bool
        assert is_hhmm(proposal["first_leave_at"])
        for gone in proposal["dropped"]:
            assert set(gone) == {"place_id", "name"}
        info = proposal["closed"]
        assert set(info) == T06_CLOSED_KEYS
        assert type(info["travel_change_min"]) is int
        assert type(info["reordered"]) is bool  # §14
        if info["alternative"] is None:
            assert info["distance_m"] is None
            assert info["reordered"] is False  # §14: [빼고 가기]는 순서 그대로
        else:
            assert set(info["alternative"]) == {"place_id", "name"}
            assert type(info["distance_m"]) is int


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
    assert alt_ids(card) == ["A01", "A02", "A03"]
    assert card["proposals"][-1]["closed"]["alternative"] is None
    assert len(card["proposals"]) == 4


def test_T8_B2_AC4_1_5km_안팎(env):
    _, view = closed_view(env, extra=(alt("N01", 1.49), alt("X01", 1.51)))
    assert alt_ids(view["main"]) == ["N01"]


def test_T8_B2_AC4_Q5_1_5km_정각은_안(env):
    # P02(북 2.0km)에서 정북 1.5km (계산 거리 1500.0000000002m). §11 Q5: 정각 포함
    exact = place("E01", km=3.5, hours=OPEN_LATE, stay=STAY)
    _, view = closed_view(env, extra=(exact,))
    assert alt_ids(view["main"]) == ["E01"]


def test_T8_B2_AC4_unknown과_다른_종류는_빠진다(env):
    extra = (alt("U01", 0.1, hours=None), alt("F01", 0.2, category="food"), alt("A01", 0.5))
    _, view = closed_view(env, extra=extra)
    assert alt_ids(view["main"]) == ["A01"]


def test_T8_B2_Q20_영업시간이_있으면_hours_status가_unknown이어도_후보(env):
    # §11 Q20: 화면 사실 기준(영업시간 있음 → unverified)으로 넣는다
    _, view = closed_view(env, extra=(alt("H01", 0.4, status="unknown"),))
    assert alt_ids(view["main"]) == ["H01"]


def test_T8_B2_코스에_있는_곳은_대안이_아니다(env):
    # P01·P03도 같은 cafe이고 P02에서 1km 안이다
    _, view = closed_view(env, extra=())
    assert replaces(view["main"]) == []


def test_T8_B4_대안이_0곳이면_빼고_가기만(env):
    _, view = closed_view(env, extra=())
    proposals = view["main"]["proposals"]
    assert [p["closed"]["alternative"] for p in proposals] == [None]


def test_T8_B3_대안_칸의_값(env):
    _, view = closed_view(env)
    first = replaces(view["main"])[0]
    assert first["closed"]["alternative"] == {"place_id": "A01", "name": "가상 A01"}
    assert abs(first["closed"]["distance_m"] - 300) <= 1
    facts = alt_facts(first)
    assert facts and facts[0]["field"] == "opening_hours"
    assert facts[0]["status"] in STATUSES
    ids = item_ids(first["items"])
    assert "A01" in ids and "P02" not in ids and "P03" in ids
    assert "P01" not in ids  # 지난 일정은 제안에 없다
    assert "A01" not in dropped_ids(first)  # §11 Q8: 대안이 빠진 안은 대안이 아니다


def test_T8_B3_Q7_첫_출발_시각은_앞_장소_끝_뒤이고_첫_일정_전(env):
    # TASK-007 first_leave_at과 같은 뜻 (§11 Q4). Q7: 앞 장소(P01, 끝 12:00)에서 max(at 11:40, 12:00)부터 출발
    _, view = closed_view(env)
    for proposal in view["main"]["proposals"]:
        assert to_min("12:00") <= to_min(proposal["first_leave_at"]) <= to_min(proposal["items"][0]["start"])


def remaining_travel(course, start_index: int) -> int:
    """남은 이동 분 합 = start_index번째 항목부터 오는 이동 + 숙소 복귀 (§11 Q4)."""
    return sum(i.travel_min for i in course.items[start_index:]) + course.go_home_min


@pytest.mark.parametrize("which", ["대안", "빼고_가기"])
def test_T8_B3_Q4_이동_변화_분은_남은_이동_합_숙소_복귀_포함_바뀐_뒤_빼기_바뀌기_전(env, which):
    day_id, view = closed_view(env)
    _, old = chosen(env, day_id)
    proposal = replaces(view["main"])[0] if which == "대안" else skip_of(view["main"])
    assert accept(env, proposal["proposal_id"]).status_code == 200
    _, new = chosen(env, day_id)
    before = remaining_travel(old, 1)  # 닫힌 곳(2번)으로 가는 이동부터: 20 + 30 + 숙소 25
    after = remaining_travel(new, 1)  # 지난 1번은 그대로 (B-3), 그 뒤 = 제안 일정
    assert proposal["closed"]["travel_change_min"] == after - before


def test_T8_B3_Q24_대안을_고른_제안의_dropped에_닫힌_곳은_없다(env):
    _, view = closed_view(env)
    for proposal in replaces(view["main"]):
        assert "P02" not in dropped_ids(proposal)


def test_T8_B4_빼고_가기_칸의_값(env):
    _, view = closed_view(env)
    skip = skip_of(view["main"])
    assert (skip["closed"]["alternative"], skip["closed"]["distance_m"]) == (None, None)
    assert {"place_id": "P02", "name": "가상 P02"} in skip["dropped"]  # TASK-007 dropped = 빠지는 곳
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
    assert alt_ids(card) == ["N01"]
    kept = [(e["place_id"], e["start"], e["end"]) for e in replaces(card)[0]["items"] if e["is_fixed"]]
    assert kept == [("F03", "12:40", "13:40")]
    assert card["proposals"][-1]["closed"]["alternative"] is None
    assert all(p["keeps_fixed"] is True for p in card["proposals"])  # TASK-007 keeps_fixed


def reorder_day(env) -> str:
    """§14 다시 짜야 하는 대안: tight_day와 같은 앞부분, 대안은 R01 하나, 하루 끝 21:00.
    R01을 닫힌 곳(C02) 자리에 넣으면 P01→R01 16분 + 30분 + R01→F03 16분 = 62분 → 11:50에 떠나도 12:52 도착 (고정 12:40을 못 지킴).
    하루 끝이 넉넉하니 compose_courses로 다시 짜면 R01은 고정 일정 F03(12:40~13:40) 뒤에 들어간다 (reordered).
    머무는 시간은 모두 30분 하나(TIGHT)라 대안의 머무는 시간 규칙과 무관하다."""
    places = {
        "P01": place("P01", km=1.0, hours=OPEN_LATE, stay=TIGHT),
        "C02": place("C02", km=1.3, hours=OPEN_LATE, status="unverified", stay=TIGHT),
        "F03": place("F03", category="experience", km=1.0, east_km=0.3, hours=OPEN_LATE, stay=TIGHT),
        "R01": place("R01", km=2.75, hours=OPEN_LATE, stay=TIGHT),
    }
    items = [item(1, "P01", "10:12", "11:50", 12), item(2, "C02", "12:00", "12:30", 10), item(3, "F03", "12:40", "13:40", 7, fixed=True)]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "12:40", "13:40"),), end="21:00")


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
    # §14: compose_courses는 닫힌 곳 자리에 못 넣을 때만 부르므로, 다시 짜야 하는 하루(reorder_day, R01)에서 예외를 넣는다
    env = quiet_env
    day_id = reorder_day(env)
    before, course = without_logs(stores(env)), chosen(env, day_id)
    with monkeypatch.context() as patch:
        patch.setattr("graphs.trip.compose_courses", raise_forced)
        assert_error(visit_check(env, day_id, "C02", "11:40", False), 500, "INTERNAL_ERROR")
    assert without_logs(stores(env)) == before
    assert chosen(env, day_id) == course
    assert trip_repo(env).get_visit_check(day_id, "C02") is None
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id, "C02")) is None
    assert "T-05" in types(cards(now(env, day_id, "11:41")))  # 확인 답도 저장 안 됨 → 다시 묻는다 (C02 출발 11:50의 9분 전이라 T-02의 짝, A3)
    retry = visit_check(env, day_id, "C02", "11:42", False)  # 다음 요청은 정상 (409 아님)
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


def test_T8_S6_Q11_stale_뒤_check는_같은_사건의_제안을_한_번_새로_계산하고_다시_알리지_않는다(env):
    day_id, view = closed_view(env)
    checked(env, day_id, "11:55")
    assert accept(env, replaces(view["main"])[0]["proposal_id"]).status_code == 409
    fresh = checked(env, day_id, "11:56")
    card = fresh["main"]
    assert card["type"] == "T-06"
    assert card["event_id"] == view["main"]["event_id"]  # 새 사건이 아니다
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)).state == "awaiting"
    old_ids = {p["proposal_id"] for p in view["main"]["proposals"]}
    assert card["proposals"] and not old_ids & {p["proposal_id"] for p in card["proposals"]}
    again = checked(env, day_id, "11:57")  # 한 번만
    assert again["main"]["proposals"] == card["proposals"]
    assert accept(env, replaces(card)[0]["proposal_id"]).status_code == 200


# ---------- §7 겹치면 (AC-5) ----------


def test_T8_S7_늦어짐_awaiting과_닫힘_awaiting이면_T_04가_메인이고_둘_다_열려_있다(env):
    day_id, closed = closed_view(env)
    late = checked(env, day_id, "12:20", P01)  # 1번에서 20분 늦음 → 높음
    assert late["main"]["type"] == "T-04"
    assert (late["event"]["type"], late["event"]["event_id"]) == ("delay", late["main"]["event_id"])  # §11 Q12: 메인 카드의 사건
    assert "T-06" not in types(cards(late))
    assert trip_repo(env).event_by_key(day_id, closed_key(day_id)).state == "awaiting"  # 종류가 다르면 닫지 않는다
    assert dismiss(env, late["main"]["event_id"]).status_code == 200
    after = now(env, day_id, "12:21")
    assert after["main"]["type"] == "T-06"
    assert after["main"]["event_id"] == closed["main"]["event_id"]
    assert (after["event"]["type"], after["event"]["event_id"]) == ("closed", closed["main"]["event_id"])


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
    assert alt_ids(card) == ["A01", "A02", "A03"]
    assert "꼭 갈 곳이었어" in skip_of(card)["reason"]


def test_T8_S7_꼭_갈_곳이_아니면_그_표시가_없다(env):
    _, view = closed_view(env)
    assert "꼭 갈 곳" not in skip_of(view["main"])["reason"]


def test_T8_S7_꼭_갈_곳을_대안으로_바꾸면_꼭_갈_곳_목록도_대안으로(env):
    day_id, view = closed_view(env, must=("P02",))
    assert accept(env, replaces(view["main"])[0]["proposal_id"]).status_code == 200
    must = env.repo.get_day(day_id).plan.must_visit
    assert "A01" in must and "P02" not in must


# ---------- §14 대안은 닫힌 곳 자리로 (B3 고침) ----------
# 닫힌 곳(P02, 2번)의 같은 순번에 대안을 넣고, 뒤 일정(P03)은 순서·머무는 시간 그대로 시각만 다시 계산 (DP로 다시 짜지 않음).
# 그렇게 넣어 영업시간·고정 일정·하루 끝을 못 지킬 때만 compose_courses로 다시 짜고 closed.reordered = true.
# 대안이 들르는 시각 = items 안 그 대안 줄의 start [정함]. [빼고 가기]도 순서 그대로 시각만.


def stay_of(entry) -> int:
    if isinstance(entry, dict):
        return to_min(entry["end"]) - to_min(entry["start"])
    return to_min(entry.end) - to_min(entry.start)


def test_T8_S14_대안은_닫힌_곳의_같은_순번에_들어가고_뒤_일정은_순서_그대로(env):
    _, view = closed_view(env)
    proposals = replaces(view["main"])
    assert alt_ids(view["main"]) == ["A01", "A02", "A03"]
    for proposal in proposals:
        entries = proposal["items"]
        assert item_ids(entries) == [alt_id(proposal), "P03"], alt_id(proposal)  # 닫힌 곳 자리 = 첫 줄, 뒤는 원래 순서
        assert [e["seq"] for e in entries] == [2, 3]  # 닫힌 곳(P02)의 seq 2 그대로
        assert proposal["closed"]["reordered"] is False  # 자리에 넣어 다 지켜지면 다시 짜지 않는다


@pytest.mark.parametrize("which", ["대안", "빼고_가기"])
def test_T8_S14_뒤_일정은_머무는_시간_그대로_시각만_다시_계산(env, which):
    # 원래 P03 14:30~19:00 (270분). DP로 다시 짜면 머무는 시간이 바뀐다 → 순서·머무는 시간 그대로, 시각만
    day_id, view = closed_view(env)
    _, old = chosen(env, day_id)
    original = {i.place_id: stay_of(i) for i in old.items if i.place_id}
    proposal = replaces(view["main"])[0] if which == "대안" else skip_of(view["main"])
    later = [e for e in proposal["items"] if e["place_id"] != alt_id(proposal)] if which == "대안" else proposal["items"]
    assert item_ids(later) == ["P03"]
    for entry in later:
        assert stay_of(entry) == original[entry["place_id"]], entry
    assert proposal["closed"]["reordered"] is False


@pytest.mark.parametrize("which", ["대안", "빼고_가기"])
def test_T8_S14_다시_계산한_시각은_앞_장소_끝_뒤_이동_시간_이후(env, which):
    # 첫 줄: 앞 장소(P01) 끝 12:00 (Q7: max(at 11:40, 12:00)) + P01→첫 장소 이동 이후. 그다음 줄: 앞 줄 끝 + 이동 이후 (엔진 이동 식)
    from engine.planning import travel_min

    _, view = closed_view(env)
    proposal = replaces(view["main"])[0] if which == "대안" else skip_of(view["main"])
    prev_end, prev_at = to_min("12:00"), P01
    for entry in proposal["items"]:
        here = (entry["lat"], entry["lng"])
        assert to_min(entry["start"]) >= prev_end + travel_min(distance_km(prev_at, here)), entry
        assert to_min(entry["end"]) > to_min(entry["start"])
        prev_end, prev_at = to_min(entry["end"]), here
    assert to_min(proposal["first_leave_at"]) >= to_min("12:00")


def test_T8_S14_자리에_넣으면_고정_일정을_못_지키는_대안은_다시_짜고_reordered(env):
    day_id = reorder_day(env)
    card = answered(env, day_id, "C02", "11:40", False)["main"]
    assert alt_ids(card) == ["R01"]
    proposal = replaces(card)[0]
    assert proposal["closed"]["reordered"] is True
    assert proposal["keeps_fixed"] is True
    rows = {e["place_id"]: e for e in proposal["items"]}
    assert (rows["F03"]["start"], rows["F03"]["end"], rows["F03"]["is_fixed"]) == ("12:40", "13:40", True)
    assert item_ids(proposal["items"]).index("R01") > item_ids(proposal["items"]).index("F03")  # 순서가 바뀌었다
    assert to_min(rows["R01"]["start"]) >= to_min("13:40")  # 들르는 시각 = 그 줄의 start (고정 일정 뒤)
    assert is_hhmm(rows["R01"]["start"])
    assert skip_of(card)["closed"]["reordered"] is False


def test_T8_S14_다시_짜도_못_지키는_대안은_여전히_뺀다(env):
    # tight_day: R01은 자리에 넣어도, 다시 짜도 고정 일정·하루 끝(14:30)을 못 지킨다 → 대안이 아니다 (B3 그대로)
    day_id = tight_day(env)
    card = answered(env, day_id, "C02", "11:40", False)["main"]
    assert "R01" not in alt_ids(card)


def test_T8_S14_데모_골목_카페_E는_닫힌_곳의_같은_순번에_들어간다(env):
    # 데모 시나리오(2번 언덕 카페 B 닫힘 → 시드 전용 골목 카페 E): E가 2번 자리에, 뒤 일정은 원래 순서 그대로
    _, day_id, entry = demo_scenario(env)
    _, course = chosen(env, day_id)
    rest = [i.place_id for i in course.items if i.seq > entry.seq]
    view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
    proposals = replaces(view["main"])
    assert proposals
    for proposal in proposals:
        assert proposal["closed"]["reordered"] is False
        assert item_ids(proposal["items"]) == [alt_id(proposal), *rest]
        row = proposal["items"][0]
        assert row["seq"] == entry.seq
    skip = skip_of(view["main"])
    assert item_ids(skip["items"]) == rest  # [빼고 가기]도 순서 그대로
    assert skip["closed"]["reordered"] is False


# ---------- §14 [빼고 가기]도 계산 안 될 때 ----------


def stuck_day(env) -> str:
    """닫힌 곳(P02) 뒤 고정 일정 F03이 39km 밖 (엔진 식 127분, 심은 코스 이동은 7분이라 고정 출발 12:33).
    P01 끝 11:50에서 바로 가도 12:40에 못 간다 → 빼고 가기도, 근처 대안(A01~A03)도 못 만든다."""
    places = {
        "P01": place("P01", km=1.0, hours=OPEN_LATE, stay=TIGHT),
        "P02": unverified(),
        "F03": spot("F03", 40.0, category="experience"),
        **{a.id: a for a in ALTS},
    }
    items = [item(1, "P01", "10:12", "11:50", 12), item(2, "P02", "12:00", "12:30", 10), item(3, "F03", "12:40", "13:40", 7, fixed=True)]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "12:40", "13:40"),))


def test_T8_S14_빼고_가기도_못_만들면_제안_0개(env):
    day_id = stuck_day(env)
    view = answered(env, day_id, "P02", "11:40", False)
    assert view["main"]["type"] == "T-06"
    assert view["main"]["proposals"] == []
    assert trip_repo(env).get_visit_check(day_id, "P02") is not None  # 답은 저장된다 (AC-3)


# ---------- §14 고정 일정 장소는 T-05 대상이 아니다 ----------


def fixed_next_day(env) -> str:
    """2번이 고정 일정이고 영업 사실이 미확인 (F02 12:20~14:00, 이동 20 → 출발 12:00, 확인 창이었을 시간 11:30~12:20)."""
    places = {"P01": spot("P01", 1.0), "F02": unverified("F02", category="experience"), "P03": spot("P03", 3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "F02", "12:20", "14:00", 20, fixed=True), item(3, "P03", "14:30", "19:00", 30)]
    return plant(env, items, places, fixed=(fixed_at(places["F02"], "12:20", "14:00"),))


@pytest.mark.parametrize("clock", ["11:30", "11:40", "11:50", "12:19"], ids=["출발_30분_전_정각", "출발_20분_전", "출발_10분_전", "도착_1분_전"])
def test_T8_S14_다음_장소가_고정_일정이면_미확인이어도_T_05가_없다(env, clock):
    day_id = fixed_next_day(env)
    view = now(env, day_id, clock)
    assert "T-05" not in types(cards(view)), clock


def test_T8_S14_고정_일정_장소의_visit_check는_409_not_check_target이고_그대로(env):
    day_id = fixed_next_day(env)
    before = without_logs(stores(env))
    error = assert_error(visit_check(env, day_id, "F02", "11:40", False), 409, "STATE_CONFLICT")
    assert error["detail"]["reason"] == "not_check_target"
    assert without_logs(stores(env)) == before
    assert trip_repo(env).get_visit_check(day_id, "F02") is None


# ---------- §14 409 reason="not_check_target" (승인) ----------


@pytest.mark.parametrize(
    "pid, clock",
    [("P01", "11:40"), ("P03", "11:40"), ("P02", "11:29"), ("P02", "12:20")],
    ids=["지금_장소", "다음_아닌_장소", "출발_31분_전", "도착_정각"],
)
def test_T8_S14_확인_대상이_아니면_409_reason은_not_check_target(env, pid, clock):
    day_id = visit_day(env)
    error = assert_error(visit_check(env, day_id, pid, clock, False), 409, "STATE_CONFLICT")
    assert error["detail"]["reason"] == "not_check_target"


# ---------- §15 Q32 대안의 머무는 시간 ----------
# 대안의 머무는 시간 = 닫힌 곳 자리의 머무는 시간(사용자가 바꾼 값이면 그 값). 대안 장소에 stay.min~max가 있으면 그 안으로,
# 범위 밖이면 가까운 끝값. 그래도 못 지키면 §14대로 다시 짜고 reordered.
# visit_day의 닫힌 곳 자리 = P02 12:20~14:00 (100분). 대안 A01 = P02에서 동쪽 0.3km (영업 늦게까지).

SLOT = 100
RELAXED_BUFFER = 15  # §15 Q33: 다시 잴 때 쉬는 시간은 코스를 짤 때와 같은 규칙 (엔진 relaxed 15분, 앞 항목이 방문일 때만). 제안 label = relaxed (§12 Q22)


def alt_row(proposal: dict) -> dict:
    rows = [e for e in proposal["items"] if e["place_id"] == alt_id(proposal)]
    assert len(rows) == 1
    return rows[0]


@pytest.mark.parametrize(
    "stay, expected",
    [
        (StayRange(min=30, typical=60, max=120), SLOT),
        (StayRange(min=100, typical=110, max=120), 100),
        (StayRange(min=101, typical=110, max=150), 101),
        (StayRange(min=120, typical=150, max=180), 120),
        (StayRange(min=30, typical=60, max=100), 100),
        (StayRange(min=30, typical=60, max=99), 99),
        (StayRange(min=30, typical=45, max=60), 60),
        (None, SLOT),
    ],
    ids=["범위_안_그대로", "min_정각", "min보다_1분_짧으면_min", "min보다_짧으면_min", "max_정각", "max보다_1분_길면_max", "max보다_길면_max", "범위_없으면_그대로"],
)
def test_T8_S15_Q32_대안의_머무는_시간은_닫힌_곳_자리_시간을_범위_안으로(env, stay, expected):
    _, view = closed_view(env, extra=(alt("A01", 0.3, stay=stay),))
    proposal = replaces(view["main"])[0]
    assert alt_id(proposal) == "A01"
    assert proposal["closed"]["reordered"] is False  # 하루 끝 21:00까지 넉넉해 자리에 들어간다
    assert stay_of(alt_row(proposal)) == expected


def user_stay_day(env, user_stay: int, extra=()) -> str:
    """visit_day와 같고, 닫힌 곳 P02의 머무는 시간을 사용자가 user_stay분으로 바꾼 하루 (stay_overrides + stay_source "user")."""
    from planning_helpers import day_plan
    from trip_helpers import DAY

    from engine.models import CourseOption
    from planning.repo import OptionRecord

    places = {"P01": spot("P01", 1.0), "P02": unverified(), "P03": spot("P03", 3.0), **{p.id: p for p in extra}}
    user_item = item(2, "P02", "12:20", hhmm(to_min("12:20") + user_stay), 20).model_copy(update={"stay_source": "user"})
    items = [item(1, "P01", "10:12", "12:00", 12), user_item, item(3, "P03", "14:30", "19:00", 30)]
    plan = day_plan(start="10:00", end="21:00", overrides={"P02": user_stay}, day=DAY)
    day_id = env.plant_day(places, plan, day_number=2)
    option = CourseOption(label="relaxed", items=items, dropped=[], go_home_min=25, total_travel_min=sum(i.travel_min for i in items))
    env.repo.save_options([OptionRecord(f"opt-{day_id}", "planted-session", [], option)])
    env.repo.choose_option(day_id, f"opt-{day_id}")
    return day_id


@pytest.mark.parametrize("user_stay", [45, 30, 120], ids=["45분", "범위_min_정각", "범위_max_정각"])
def test_T8_S15_Q32_사용자가_바꾼_머무는_시간이면_그_값(env, user_stay):
    # A01 범위 30~120 (typical 60) 안의 사용자 값 → 그대로. 장소의 typical(60)이나 닫힌 곳 장소의 범위가 아니다
    day_id = user_stay_day(env, user_stay, extra=(alt("A01", 0.3, stay=StayRange(min=30, typical=60, max=120)),))
    proposal = replaces(answered(env, day_id, "P02", "11:40", False)["main"])[0]
    assert proposal["closed"]["reordered"] is False
    assert stay_of(alt_row(proposal)) == user_stay


def clamp_day(env, alt_stay: StayRange) -> str:
    """Q32 '그래도 못 지키면': 닫힌 곳 C02 자리 30분, 뒤 고정 일정 F03 13:10~14:10, 하루 끝 21:00.
    대안 N01(C02에서 북 0.05km). P01(11:50 끝) → N01 5분 → (쉬는 시간 0 또는 15) → 머무름 → N01 → F03 7분.
    머무름 30분이면 늦어도 12:47 도착(지킴). 90분(범위 min으로 맞춘 값)이면 빨라도 13:32 도착(못 지킴) → 다시 짜면 F03 뒤 (reordered)."""
    places = {
        "P01": place("P01", km=1.0, hours=OPEN_LATE, stay=TIGHT),
        "C02": place("C02", km=1.3, hours=OPEN_LATE, status="unverified", stay=TIGHT),
        "F03": place("F03", category="experience", km=1.0, east_km=0.3, hours=OPEN_LATE, stay=TIGHT),
        "N01": place("N01", km=1.35, hours=OPEN_LATE, stay=alt_stay),
    }
    items = [item(1, "P01", "10:12", "11:50", 12), item(2, "C02", "12:00", "12:30", 10), item(3, "F03", "13:10", "14:10", 7, fixed=True)]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "13:10", "14:10"),), end="21:00")


def test_T8_S15_Q32_범위로_맞춘_머무는_시간으로_자리에서_고정_일정을_지키면_reordered_아님(env):
    day_id = clamp_day(env, TIGHT)
    proposal = replaces(answered(env, day_id, "C02", "11:40", False)["main"])[0]
    assert alt_id(proposal) == "N01"
    assert proposal["closed"]["reordered"] is False
    assert item_ids(proposal["items"]) == ["N01", "F03"]
    assert stay_of(alt_row(proposal)) == 30


def test_T8_S15_Q32_범위로_맞춘_머무는_시간_때문에_고정_일정을_못_지키면_다시_짜고_reordered(env):
    # 자리 30분 < N01 min 90 → 90분. 자리에 넣으면 F03 13:10을 못 지킨다 → 다시 짜고 reordered, N01은 F03 뒤
    day_id = clamp_day(env, StayRange(min=90, typical=90, max=90))
    card = answered(env, day_id, "C02", "11:40", False)["main"]
    assert alt_ids(card) == ["N01"]
    proposal = replaces(card)[0]
    assert proposal["closed"]["reordered"] is True
    assert proposal["keeps_fixed"] is True
    rows = {e["place_id"]: e for e in proposal["items"]}
    assert (rows["F03"]["start"], rows["F03"]["end"]) == ("13:10", "14:10")
    assert item_ids(proposal["items"]).index("N01") > item_ids(proposal["items"]).index("F03")


def test_T8_S15_Q33_자리에_넣은_대안_뒤_일정은_앞_끝_이동_쉬는_시간_뒤에_바로(env):
    # Q33: 방문 뒤 방문이면 쉬는 시간(relaxed 15분). P03은 영업 늦게까지라 기다림 없음 → 대안 끝 + 이동 + 15분에 시작
    from engine.planning import travel_min

    _, view = closed_view(env)
    for proposal in replaces(view["main"]):
        first, then = proposal["items"]
        km = distance_km((first["lat"], first["lng"]), (then["lat"], then["lng"]))
        assert to_min(then["start"]) == to_min(first["end"]) + travel_min(km) + RELAXED_BUFFER, alt_id(proposal)


def test_T8_S15_Q32_데모_골목_카페_E는_자리_시간으로_2번에_들어가고_저녁_예약을_지킨다(env):
    # 데모: 2번 언덕 카페 B 자리 = 그 줄의 머무는 시간, E는 시드 전용 장소(demo_extra.json). 자리 시간을 E 범위로 맞춘 값으로 2번 자리에
    _, day_id, entry = demo_scenario(env)
    record = env.repo.get_day(day_id)
    (extra_id,) = set(record.places) - set(demo_places())
    stay = record.places[extra_id].stay
    expected = entry.stay_min if stay is None else min(max(entry.stay_min, stay.min), stay.max)
    view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
    proposal = next(p for p in replaces(view["main"]) if alt_id(p) == extra_id)
    assert proposal["closed"]["reordered"] is False
    assert proposal["keeps_fixed"] is True
    row = alt_row(proposal)
    assert row["seq"] == entry.seq
    assert stay_of(row) == expected
    fixed_rows = [(e["start"], e["end"]) for e in proposal["items"] if e["is_fixed"]]
    assert fixed_rows == [(f.start, f.end) for f in record.plan.fixed]  # 저녁 예약 18:30~19:30 그대로


# ---------- §15 [빼고 가기]는 다시 짜지 않는다 ----------
# 순서 그대로 시각만 당긴다. 당겨서 여는 시각 전에 도착하면 여는 시각까지 기다린다 (순서 유지).
# 1번을 고정 일정(F01, 12:00 끝)으로 두어 첫 이동 앞 쉬는 시간이 없게 한다 (Q33: 고정 일정 뒤에는 이동 시간만).


def skip_wait_day(env, open_at: str) -> str:
    """1번 고정 F01(북 1.0) 10:12~12:00, 2번 P02(미확인) 12:20~14:00, 3번 P03(북 3.0) 14:30~19:00 (open_at에 연다),
    4번 P04(북 4.0) 19:30~20:00. 근처 대안 없음 (P01이 없고 P03·P04는 코스 안)."""
    places = {
        "F01": spot("F01", 1.0, category="experience"),
        "P02": unverified(),
        "P03": place("P03", km=3.0, hours=week_hours(open_at, "22:00"), stay=STAY),
        "P04": spot("P04", 4.0),
    }
    items = [
        item(1, "F01", "10:12", "12:00", 12, fixed=True),
        item(2, "P02", "12:20", "14:00", 20),
        item(3, "P03", "14:30", "19:00", 30),
        item(4, "P04", "19:30", "20:00", 14),
    ]
    return plant(env, items, places, fixed=(fixed_at(places["F01"], "10:12", "12:00"),), end="21:00")


def skip_arrival() -> int:
    """F01 끝 12:00(Q7: max(at 11:40, 12:00))에 떠나 P03에 닿는 시각 (엔진 이동 식, 고정 일정 뒤라 쉬는 시간 없음)."""
    from engine.planning import travel_min
    from trip_helpers import at_place

    return to_min("12:00") + travel_min(distance_km(at_place(1.0), at_place(3.0)))


@pytest.mark.parametrize(
    "open_offset, start_offset",
    [(1, 1), (0, 0), (-1, 0), (60, 60)],
    ids=["여는_시각_1분_전_도착이면_여는_시각", "여는_시각_정각_도착", "연_뒤_도착이면_도착_시각", "한참_기다려도_순서_그대로"],
)
def test_T8_S15_빼고_가기는_순서_그대로_당기고_여는_시각_전이면_기다린다(env, open_offset, start_offset):
    arrive = skip_arrival()
    day_id = skip_wait_day(env, hhmm(arrive + open_offset))
    card = answered(env, day_id, "P02", "11:40", False)["main"]
    assert replaces(card) == []  # 시험 자체 확인
    skip = skip_of(card)
    assert skip["closed"]["reordered"] is False
    assert item_ids(skip["items"]) == ["P03", "P04"]  # 순서 그대로 (기다려도 P04를 앞으로 당기지 않는다)
    p03, p04 = skip["items"]
    assert to_min(p03["start"]) == arrive + start_offset
    assert to_min(p03["start"]) < to_min("14:30")  # 당겼다
    assert (stay_of(p03), stay_of(p04)) == (270, 30)  # 머무는 시간 그대로 (§14)


def test_T8_S15_Q33_빼고_가기도_방문_뒤_방문은_쉬는_시간을_둔다(env):
    from engine.planning import travel_min
    from trip_helpers import at_place

    day_id = skip_wait_day(env, "08:00")
    p03, p04 = skip_of(answered(env, day_id, "P02", "11:40", False)["main"])["items"]
    assert to_min(p04["start"]) == to_min(p03["end"]) + travel_min(distance_km(at_place(3.0), at_place(4.0))) + RELAXED_BUFFER


def test_T8_S15_빼고_가기는_compose_courses를_부르지_않는다(env, monkeypatch):
    # [빼고 가기]는 다시 짜지 않는다. 대안이 없는 하루에서 compose_courses가 불리면 실패로 센다
    calls = []
    monkeypatch.setattr("graphs.trip.compose_courses", lambda *a, **k: calls.append(1) or raise_forced())
    day_id = skip_wait_day(env, "08:00")
    card = answered(env, day_id, "P02", "11:40", False)["main"]
    assert [p["closed"]["alternative"] for p in card["proposals"]] == [None]
    assert calls == []


# ---------- §16 Q35~Q38 ----------
# Q35: 다시 계산할 때 지금 장소에서 출발하는 첫 이동에는 쉬는 시간이 없다 (출발점은 하루 시작처럼). 둘째 이동부터 원래 규칙.
# Q36: 사용자가 바꾼 머무는 시간은 대안 범위 밖이어도 그 값. Q37: 쉬는 시간 길이는 원래 고른 코스의 방식(relaxed/packed).
# Q38: 자리에 넣은 대안의 시작 = 갈 수 있는 가장 이른 시각 (여는 시각 전이면 여는 시각).
# visit_day: 지금 장소 P01(북 1.0, 방문) 끝 12:00, at 11:40 → 떠나는 시각 12:00 (Q7). 닫힌 곳 P02 예정 시작 12:20.


LEAVE = to_min("12:00")


def buffers() -> dict[str, int]:
    """엔진의 코스 방식별 쉬는 시간 (engine.planning 기존 상수)."""
    from engine.planning import _limits

    lim = _limits()
    return {"relaxed": lim.relaxed_buffer_min, "packed": lim.packed_buffer_min}


def as_label(env, day_id: str, label: str) -> None:
    """심은 하루의 고른 코스를 같은 일정 그대로 label 방식으로 바꿔 고른다."""
    from planning.repo import OptionRecord

    _, course = chosen(env, day_id)
    option_id = f"opt-{day_id}-{label}"
    env.repo.save_options([OptionRecord(option_id, "planted-session", [], course.model_copy(update={"label": label}))])
    env.repo.choose_option(day_id, option_id)


def first_travel(entry: dict) -> int:
    """P01(북 1.0)에서 그 줄 장소까지 엔진 이동 분."""
    from engine.planning import travel_min
    from trip_helpers import at_place

    return travel_min(distance_km(at_place(1.0), (entry["lat"], entry["lng"])))


@pytest.mark.parametrize("label", ["relaxed", "packed"])
def test_T8_S16_Q35_대안_첫_줄은_떠나는_시각_더하기_이동_쉬는_시간_없음(env, label):
    # 앞 장소 P01은 방문이라 원래 규칙이면 쉬는 시간이 붙지만, 지금 장소에서 나가는 첫 이동은 0분
    day_id = visit_day(env, extra=ALTS)
    as_label(env, day_id, label)
    card = answered(env, day_id, "P02", "11:40", False)["main"]
    assert alt_ids(card) == ["A01", "A02", "A03"]
    for proposal in replaces(card):
        first = proposal["items"][0]
        assert first["place_id"] == alt_id(proposal)
        assert to_min(first["start"]) == LEAVE + first_travel(first), alt_id(proposal)  # A01~A03은 08:00에 열어 기다림 없음


@pytest.mark.parametrize("label", ["relaxed", "packed"])
def test_T8_S16_Q35_빼고_가기_첫_줄도_떠나는_시각_더하기_이동_쉬는_시간_없음(env, label):
    day_id = visit_day(env, extra=ALTS)
    as_label(env, day_id, label)
    skip = skip_of(answered(env, day_id, "P02", "11:40", False)["main"])
    (p03,) = skip["items"]
    assert p03["place_id"] == "P03"
    assert to_min(p03["start"]) == LEAVE + first_travel(p03)  # P03 08:00에 열어 기다림 없음


@pytest.mark.parametrize("label", ["relaxed", "packed"])
def test_T8_S16_Q35_Q37_대안_둘째_이동은_고른_코스_방식의_쉬는_시간(env, label):
    from engine.planning import travel_min

    day_id = visit_day(env, extra=ALTS)
    as_label(env, day_id, label)
    for proposal in replaces(answered(env, day_id, "P02", "11:40", False)["main"]):
        first, then = proposal["items"]
        km = distance_km((first["lat"], first["lng"]), (then["lat"], then["lng"]))
        assert to_min(then["start"]) == to_min(first["end"]) + travel_min(km) + buffers()[label], (label, alt_id(proposal))


@pytest.mark.parametrize("label", ["relaxed", "packed"])
def test_T8_S16_Q35_Q37_빼고_가기_둘째_이동은_고른_코스_방식의_쉬는_시간(env, label):
    from engine.planning import travel_min
    from trip_helpers import at_place

    day_id = skip_wait_day(env, "08:00")
    as_label(env, day_id, label)
    p03, p04 = skip_of(answered(env, day_id, "P02", "11:40", False)["main"])["items"]
    assert to_min(p04["start"]) == to_min(p03["end"]) + travel_min(distance_km(at_place(3.0), at_place(4.0))) + buffers()[label]


@pytest.mark.parametrize("user_stay", [29, 20, 121, 150], ids=["범위_min보다_1분_짧음", "범위보다_짧음", "범위_max보다_1분_김", "범위보다_김"])
def test_T8_S16_Q36_사용자가_바꾼_머무는_시간은_대안_범위_밖이어도_그_값(env, user_stay):
    # A01 범위 30~120. 사용자 값이 우선 (Q32의 범위 맞추기를 하지 않는다)
    day_id = user_stay_day(env, user_stay, extra=(alt("A01", 0.3, stay=StayRange(min=30, typical=60, max=120)),))
    proposal = replaces(answered(env, day_id, "P02", "11:40", False)["main"])[0]
    assert alt_id(proposal) == "A01"
    assert proposal["closed"]["reordered"] is False  # 하루 끝 21:00까지 넉넉하다
    assert stay_of(alt_row(proposal)) == user_stay


def a01_arrival() -> int:
    """P01 끝 12:00에 떠나 A01(P02 동쪽 0.3km)에 닿는 시각 (쉬는 시간 없음, Q35)."""
    from engine.planning import travel_min
    from trip_helpers import at_place

    return LEAVE + travel_min(distance_km(at_place(1.0), at_place(2.0, 0.3)))


@pytest.mark.parametrize(
    "open_offset, start_offset",
    [(1, 1), (0, 0), (-1, 0), ("12:20", "12:20")],
    ids=["여는_시각_1분_전_도착이면_여는_시각", "여는_시각_정각_도착", "연_뒤_도착이면_도착_시각", "닫힌_곳_예정_시작에_열면_그때"],
)
def test_T8_S16_Q38_자리에_넣은_대안의_시작은_갈_수_있는_가장_이른_시각(env, open_offset, start_offset):
    # B2 후보 조건(닫힌 곳 예정 시작 12:20에 영업 중, Q29)은 모두 지킨다
    arrive = a01_arrival()
    open_at = to_min(open_offset) if isinstance(open_offset, str) else arrive + open_offset
    expected = to_min(start_offset) if isinstance(start_offset, str) else arrive + start_offset
    assert open_at <= to_min("12:20")  # 시험 자체 확인
    a01 = alt("A01", 0.3, hours=week_hours(hhmm(open_at), "22:00"))
    _, view = closed_view(env, extra=(a01,))
    proposal = replaces(view["main"])[0]
    assert alt_id(proposal) == "A01"
    assert proposal["closed"]["reordered"] is False
    assert to_min(alt_row(proposal)["start"]) == expected


def test_T8_S16_데모_골목_카페_E는_2번_자리_reordered_false_저녁_예약_18_30_그대로(env):
    from planning.seed import DINNER_END, DINNER_START

    _, day_id, entry = demo_scenario(env)
    assert entry.seq == 2  # §16 기록: E가 2번 자리
    record = env.repo.get_day(day_id)
    (extra_id,) = set(record.places) - set(demo_places())
    view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
    proposal = next(p for p in replaces(view["main"]) if alt_id(p) == extra_id)
    assert proposal["closed"]["reordered"] is False
    assert alt_row(proposal)["seq"] == 2
    assert [(e["start"], e["end"]) for e in proposal["items"] if e["is_fixed"]] == [(DINNER_START, DINNER_END)]


# ---------- AC-6 사실 값 ----------


def test_T8_AC6_T_06의_모든_장소_사실에_상태가_있고_이름은_데이터_그대로(env):
    _, view = closed_view(env)
    card = view["main"]
    names = {p.id: p.name for p in ALTS}
    for proposal in replaces(card):
        alternative = proposal["closed"]["alternative"]
        assert alternative["name"] == names[alternative["place_id"]]
        facts = alt_facts(proposal)
        assert facts and all(f["status"] in STATUSES for f in facts)


@pytest.mark.parametrize("was_open", [True, False])
def test_T8_AC6_영업_여부를_지어낸_문장이_없다(env, was_open):
    day_id = visit_day(env, extra=ALTS)
    views = [now(env, day_id, "11:30"), answered(env, day_id, "P02", "11:40", was_open)]
    guesses = ("열었을", "열려 있을", "열 거야", "영업 중일", "아마")
    for view in views:
        for text in string_leaves(cards(view)):
            assert not any(word in text for word in guesses), text


# ---------- C4 데모 시드 (서버, §11 Q18로 고친 C4) ----------
# 데모 시나리오 장소 = chosen: true 코스의 2~5번 중 B2 대안이 1곳 이상 있는 첫 장소.
# 원래 confirmed면 시드에서만 그날 unverified. demo_city.json 30곳으로 조건에 맞는 장소가 없을 때만
# 시드 전용 장소(demo_extra.json) 1곳을 chosen일 때만 더한다. 어느 장소인지 고정하지 않고 규칙으로 센다.


def seed_chosen(env, chosen_flag: bool = True) -> dict:
    response = env.client.post("/debug/seed-demo", json={"chosen": chosen_flag})
    assert response.status_code == 201, response.text
    return response.json()


def b2_alternatives(places: dict, course, entry, weekday: int) -> list[str]:
    """B2 규칙 그대로 (같은 종류, 코스에 없음, 영업시간 있음(Q20: hours_status와 무관), 좌표 있음,
    예정 도착 = 그 장소 예정 시작에 영업 중(Q6: 여는 ≤ 도착 < 닫는), 1.5km 안(Q5: 정각 포함))."""
    closed = places[entry.place_id]
    in_course = {i.place_id for i in course.items if i.place_id}
    arrive = to_min(entry.start)
    found = []
    for p in places.values():
        if p.id in in_course or p.category != closed.category or p.hours is None or p.lat is None or p.lng is None:
            continue
        if distance_km((closed.lat, closed.lng), (p.lat, p.lng)) > 1.5 + 1e-9:
            continue
        if any(o.weekday == weekday and to_min(o.open) <= arrive < to_min(o.close) for o in p.hours):
            found.append(p.id)
    return found


def scenario_entry(places: dict, course, weekday: int):
    """2~5번 중 B2 대안이 1곳 이상 있는 첫 항목. 없으면 None."""
    for entry in course.items:
        if entry.place_id and 2 <= entry.seq <= 5 and b2_alternatives(places, course, entry, weekday):
            return entry
    return None


def demo_day(env):
    seeded = seed_chosen(env)
    day_id = seeded["day_ids"][1]
    record = env.repo.get_day(day_id)
    course = env.repo.get_option(env.repo.chosen_option(day_id)).course
    return seeded, day_id, record, course


def demo_scenario(env):
    seeded, day_id, record, course = demo_day(env)
    entry = scenario_entry(record.places, course, record.plan.date.weekday())
    assert entry is not None, "§11 Q18: 2~5번 중 B2 대안이 있는 장소가 있어야 한다"
    return seeded, day_id, entry


def leave_of(entry) -> int:
    return to_min(entry.start) - entry.travel_min


def test_T8_C4_Q18_데모_시나리오_장소가_있다(env):
    _, _, entry = demo_scenario(env)
    assert 2 <= entry.seq <= 5


def test_T8_C4_Q18_demo_city_30곳으로_안_되면_시드_전용_장소_1곳만_더한다(env):
    seeded, day_id, record, course = demo_day(env)
    original = demo_places()
    weekday = record.plan.date.weekday()
    base = {pid: record.places[pid] for pid in original}
    extra = set(record.places) - set(original)
    assert set(original) <= set(record.places)
    if scenario_entry(base, course, weekday) is None:
        assert len(extra) == 1  # demo_extra.json 1곳
    else:
        assert extra == set()  # 30곳으로 되면 더하지 않는다
    if extra:
        # §12 Q18 결과: 그 1곳은 시나리오 장소의 B2 대안(같은 종류, 1.5km 안, 예정 도착 = 닫힌 곳 예정 시작(Q29)에 영업)이고 출처 demo
        (extra_id,) = extra
        entry = scenario_entry(record.places, course, weekday)
        assert entry is not None
        assert extra_id in b2_alternatives(record.places, course, entry, weekday)
        view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
        assert view["main"]["type"] == "T-06"
        assert extra_id in alt_ids(view["main"])
        rows = [r for p in replaces(view["main"]) for r in p["items"] if r["place_id"] == extra_id]
        assert rows and all(f["source_type"] == "demo" for r in rows for f in r["facts"])
    for index in (0, 2):  # 다른 날에는 더하지 않는다
        assert set(env.repo.get_day(seeded["day_ids"][index]).places) == set(original)


def test_T8_C4_Q18_시나리오_장소는_그날_미확인_또는_모름이고_원래_확인됨이면_미확인_출처_demo(env):
    _, day_id, entry = demo_scenario(env)
    view = now(env, day_id, hhmm(leave_of(entry) - 30))
    fact = view["main"]["facts"][0]
    original = demo_places().get(entry.place_id)
    assert fact["status"] in {"unverified", "unknown"}
    if original is None or original.hours_status == "confirmed":
        assert fact["status"] == "unverified"
    assert fact["source_type"] == "demo"


def test_T8_C4_AC2_데모_시나리오_장소_출발_30분_전에_T_05_31분_전에는_없다(env):
    _, day_id, entry = demo_scenario(env)
    leave = leave_of(entry)
    before = now(env, day_id, hhmm(leave - 31))
    assert not [c for c in cards(before) if c["type"] == "T-05" and c["place"]["place_id"] == entry.place_id]
    view = now(env, day_id, hhmm(leave - 30))
    assert view["main"]["type"] == "T-05"
    assert view["main"]["place"]["place_id"] == entry.place_id


def test_T8_C4_AC8_데모_시나리오_장소가_닫혔어면_대안이_1곳_이상(env):
    # AC-8 Maestro: T-05 → [닫혔어] → T-06 → [이걸로]
    _, day_id, entry = demo_scenario(env)
    view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
    assert view["main"]["type"] == "T-06"
    assert replaces(view["main"])


def test_T8_C4_Q19_시나리오_장소_말고는_그날도_원본_상태(env):
    # §11 Q19: 2번·6번처럼 원래 미확인·모름인 곳은 데이터 그대로 (T-05가 떠도 그대로 둔다)
    _, day_id, entry = demo_scenario(env)
    places = env.repo.get_day(day_id).places
    for pid, original in demo_places().items():
        if pid != entry.place_id:
            assert places[pid].hours_status == original.hours_status, pid


def test_T8_C4_다른_날의_같은_장소는_원본_상태(env):
    seeded, _, entry = demo_scenario(env)
    original = demo_places().get(entry.place_id)
    for index in (0, 2):
        places = env.repo.get_day(seeded["day_ids"][index]).places
        if original is None:
            assert entry.place_id not in places
        else:
            assert places[entry.place_id].hours_status == original.hours_status


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

    install_fake_jwks(monkeypatch)  # TASK-012 §11: 토큰 없이 열린 길은 health·catalog뿐 (가짜 JWKS라 바깥 HTTP 0)
    with TestClient(app, headers=bearer(TESTER)) as client:
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


# ---------- §17 닫힘 대안 이유 문장 ----------
# 자리에 넣음(reordered=false): "{대안}{으로/로} 대신 가기" — 이번엔 "으로/로"만 받침 규칙 (TASK-009 H4 전까지)
# 다시 짬(reordered=true): "순서를 바꿔야 들어가 · {시각}에 들러" ({시각} = items 안 대안 줄 start, §15 Q31)
# [빼고 가기]: "{닫힌 곳} 빼고 가기", 꼭 갈 곳이면 " · 꼭 갈 곳이었어"
# 영문 끝 글자는 문서 예시("골목 카페 E로 대신 가기")만 근거로 고정한다.


def named_alt(name: str, pid: str = "A01", east: float = 0.3):
    return alt(pid, east).model_copy(update={"name": name})


def particle_oracle(name: str) -> str:
    """한글 끝 글자의 받침으로 '으로/로'를 고르는 시험용 기준: 받침 없음·ㄹ받침이면 '로', 그 밖의 받침이면 '으로'."""
    jong = (ord(name[-1]) - 0xAC00) % 28
    return "로" if jong in (0, 8) else "으로"


def one_alt_reason(env, name: str) -> dict:
    _, view = closed_view(env, extra=(named_alt(name),))
    (proposal,) = replaces(view["main"])
    assert proposal["closed"]["reordered"] is False  # 시험 자체 확인: 자리에 넣은 안
    return proposal


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("언덕 카페", "언덕 카페로 대신 가기"),  # 받침 없음
        ("골목 식당", "골목 식당으로 대신 가기"),  # 받침 있음 (ㅇ)
        ("바다 정원", "바다 정원으로 대신 가기"),  # 받침 있음 (ㄴ)
        ("하늘", "하늘로 대신 가기"),  # ㄹ받침은 '로'
        ("별빛 마을", "별빛 마을로 대신 가기"),  # ㄹ받침은 '로'
        ("가", "가로 대신 가기"),  # 한글 첫 글자(받침 없음) 경계
        ("힣", "힣으로 대신 가기"),  # 한글 끝 글자(ㅎ받침) 경계
        ("골목 카페 E", "골목 카페 E로 대신 가기"),  # 문서 예시 (§17)
    ],
    ids=["받침_없음", "받침_ㅇ", "받침_ㄴ", "ㄹ받침_한_글자", "ㄹ받침_여러_글자", "한글_첫_글자_가", "한글_끝_글자_힣", "영문_E_문서_예시"],
)
def test_T8_S17_자리에_넣은_대안의_이유는_대안_이름_으로_로_대신_가기(env, name, expected):
    assert one_alt_reason(env, name)["reason"] == expected


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(last=st.integers(min_value=0xAC00, max_value=0xD7A3).map(chr))
def test_T8_S17_한글_끝_글자_받침에_따라_으로_로(env, last):
    name = f"카페 {last}"
    assert one_alt_reason(env, name)["reason"] == f"{name}{particle_oracle(name)} 대신 가기"


def test_T8_S17_대안_여러_곳이면_제안마다_자기_대안_이름(env):
    names = {"A01": "언덕 카페", "A02": "골목 식당", "A03": "하늘"}
    extra = tuple(named_alt(n, pid, east) for (pid, n), east in zip(names.items(), (0.3, 0.6, 0.9), strict=True))
    _, view = closed_view(env, extra=extra)
    found = {alt_id(p): p["reason"] for p in replaces(view["main"])}
    assert found == {"A01": "언덕 카페로 대신 가기", "A02": "골목 식당으로 대신 가기", "A03": "하늘로 대신 가기"}


def test_T8_S17_닫힌_곳이_꼭_갈_곳이어도_대안_이유는_대신_가기만(env):
    _, view = closed_view(env, extra=(named_alt("언덕 카페"),), must=("P02",))
    (proposal,) = replaces(view["main"])
    assert proposal["reason"] == "언덕 카페로 대신 가기"


def test_T8_S17_다시_짠_대안의_이유는_순서를_바꿔야_들어가_시각에_들러(env):
    day_id = reorder_day(env)
    card = answered(env, day_id, "C02", "11:40", False)["main"]
    (proposal,) = replaces(card)
    assert proposal["closed"]["reordered"] is True  # 시험 자체 확인
    start = next(e["start"] for e in proposal["items"] if e["place_id"] == "R01")
    assert is_hhmm(start)
    assert proposal["reason"] == f"순서를 바꿔야 들어가 · {start}에 들러"


@pytest.mark.parametrize(
    ("must", "expected"),
    [((), "가상 P02 빼고 가기"), (("P02",), "가상 P02 빼고 가기 · 꼭 갈 곳이었어")],
    ids=["꼭_갈_곳_아님", "꼭_갈_곳"],
)
def test_T8_S17_빼고_가기_이유는_닫힌_곳_빼고_가기(env, must, expected):
    _, view = closed_view(env, must=must)
    assert skip_of(view["main"])["reason"] == expected


def test_T8_S17_대안이_0곳이어도_빼고_가기_이유는_같다(env):
    _, view = closed_view(env, extra=())
    assert replaces(view["main"]) == []
    assert skip_of(view["main"])["reason"] == "가상 P02 빼고 가기"


def test_T8_S17_다시_짠_날의_빼고_가기_이유도_같다(env):
    day_id = reorder_day(env)
    card = answered(env, day_id, "C02", "11:40", False)["main"]
    assert skip_of(card)["reason"] == "가상 C02 빼고 가기"


@pytest.mark.parametrize("old", ["머무는 시간 줄여서 다 가기", "여유 있게", "(꼭 갈 곳이었어)"])
def test_T8_S17_닫힘_제안에는_TASK_007_대본이_없다(env, old):
    for must in ((), ("P02",)):
        _, view = closed_view(env, must=must)
        for proposal in view["main"]["proposals"]:
            assert old not in proposal["reason"], proposal["reason"]


def test_T8_S17_데모_골목_카페_E로_대신_가기(env):
    _, day_id, entry = demo_scenario(env)
    view = answered(env, day_id, entry.place_id, hhmm(leave_of(entry) - 30), False)
    found = {p["closed"]["alternative"]["name"]: p["reason"] for p in replaces(view["main"])}
    assert found.get("골목 카페 E") == "골목 카페 E로 대신 가기"
    assert skip_of(view["main"])["reason"] == f"{view['main']['closed']['name']} 빼고 가기"
