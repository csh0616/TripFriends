"""TASK-007 §B G2 그래프·대안·반영·API·NowView, §6 실패, §7 겹침, §8 AC-2~4·AC-6~10, §0-1 F1·F2 (서버).

근거 우선순위: TASK-007 > TASK-006 §11~§15 > TASK-003 §10 > GRAPH-001 §3 > SCREEN-001 §4-1·§5 > DATA-001 E.
API-001 §2-3의 check·accept·dismiss 모양(응답 TripEvent[], dismiss가 /proposals 아래, 204)은 TASK-007 B-4와 달라 TASK-007을 따랐다 (§11 Q3: B-4가 정본).
§11 답 반영: Q7(오래됨 15분 = 그날 마지막 check의 at), Q9(새로 계산한 뒤 옛 제안 accept = 409), Q11(resolved는 accept·dismiss 응답에만),
Q12(열린 사건이 있는데 다른 장소에서 늦어지면 옛 사건은 낮음이든 awaiting이든 닫고 새 사건 하나만), Q15(서버 reason은 그대로).

계약 (보고서 ④):
    POST /days/{day_id}/check  본문 {at, lat?, lng?} → 200 NowView(+event)
    POST /proposals/{proposal_id}/accept → 200 NowView,  POST /events/{event_id}/dismiss → 200 NowView
    graphs/trip.py가 모듈 이름 `compose_courses`로 대안을 계산한다 (예외 주입 자리, TASK-003 F86과 같은 방식)
    NowView를 만드는 곳은 그대로 trip.now의 모듈 이름 `compose_screen` (TASK-006 계약)
    app.state.trip_graph = G2 그래프(체크포인터 MemorySaver), 스레드 ID = event_id
    고른 코스는 그대로 planning 저장소의 chosen_option / get_option (B-3 "그날의 선택")
"""

from auth_helpers import TESTER, bearer  # TASK-012 §10 Q4: 계획·여행 중 API도 Bearer
import ast
import logging
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from planning_api_helpers import assert_error
from trip_helpers import (
    EVENT_KEYS,
    ITEM_KEYS,
    NOW_KEYS,
    P01,
    PROPOSAL_KEYS,
    T04_KEYS,
    ac05_day,
    accept,
    at_place,
    at_time,
    check,
    checked,
    checkpoints_text,
    chosen,
    dismiss,
    fixed_later_day,
    infeasible_day,
    item,
    now,
    pin_slots,
    plain_day,
    plant,
    slots,
    spot,
    stores,
    to_min,
    types,
)

from deciders import JevDecider
from engine.compose import REASONS, OpenEvent, compose_screen

SERVER = Path(__file__).parents[1]
DAY_OVER = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # §0-1 F2 = TASK-006 §12 R1
DAY_OVER_PILL = "오늘 일정 끝"  # §0-1 F1
FREE = "다음까지 여유 있음"
P02 = at_place(2.0)
P03 = at_place(3.0)
FAR = (35.123456, 135.654321)  # 어느 장소에서도 멀다


def delayed_text(minutes: int) -> str:
    return f"{minutes}분 늦어지는 중"  # B-5


def without_logs(found: dict) -> dict:
    """TASK-006 AC-3 테스트처럼 판단 기록(logs)은 빼고 비교한다 (GRAPH-001 원칙 ⑤로 기록은 늘 수 있다)."""
    return {name: {k: v for k, v in snap.items() if k != "logs"} if isinstance(snap, dict) else snap for name, snap in found.items()}


def assert_hhmm(value: str) -> None:
    assert re.fullmatch(r"[0-9]{2}:[0-9]{2}", value), value


def assert_item(entry: dict) -> None:
    assert set(entry) == ITEM_KEYS
    for fact in entry["facts"]:
        assert fact["status"] in {"confirmed", "unverified", "unknown"}  # 확인 상태 필수
    if entry["place_id"] is not None:
        assert entry["facts"]


def assert_event(event: dict) -> None:
    assert set(event) == EVENT_KEYS
    assert type(event["event_id"]) is str and event["event_id"]
    assert event["type"] == "delay"
    assert event["severity"] in {"low", "high"}
    assert type(event["delay_min"]) is int
    assert event["state"] in {"open_low", "awaiting", "resolved"}
    for proposal in event["proposals"]:
        assert set(proposal) == PROPOSAL_KEYS
        assert type(proposal["proposal_id"]) is str and proposal["proposal_id"]
        assert proposal["label"] in {"relaxed", "packed"}
        assert type(proposal["reason"]) is str and proposal["reason"]
        assert type(proposal["keeps_fixed"]) is bool
        assert_hhmm(proposal["first_leave_at"])
        for gone in proposal["dropped"]:
            assert set(gone) == {"place_id", "name"}
        for entry in proposal["items"]:
            assert_item(entry)


def assert_view(view: dict) -> None:
    assert set(view) == NOW_KEYS
    if view["event"] is not None:
        assert_event(view["event"])
    for card in [view["main"], *view["subs"]]:
        if card["type"] == "T-04":
            assert set(card) == T04_KEYS
            assert card["fixed"] is None or set(card["fixed"]) == {"title", "start"}


@pytest.fixture
def quiet_env(env):
    """서버 예외를 테스트로 다시 던지지 않고 500 응답으로 받는다 (TASK-003 R1 재현 방식)."""
    env.client = TestClient(env.app, headers=bearer(TESTER), raise_server_exceptions=False)
    return env


def raise_forced(*args, **kwargs):
    raise RuntimeError("강제 예외 (시험)")


def high(env) -> tuple[str, dict]:
    """plain_day에서 12:20에 1번(P01)에 있으면 20분 늦음 → 높음 → awaiting."""
    day_id = plain_day(env)
    view = checked(env, day_id, "12:20", P01)
    assert view["event"]["state"] == "awaiting"  # 시험 자체 확인
    return day_id, view


def low(env) -> tuple[str, dict]:
    day_id = plain_day(env)
    view = checked(env, day_id, "12:10", P01)
    assert view["event"]["state"] == "open_low"
    return day_id, view


# ---------- B-4 check: 모양·위치·오류 ----------


@pytest.mark.parametrize("clock, position", [("09:00", None), ("12:10", P01), ("12:20", P01), ("13:20", FAR), ("19:30", P03)])
def test_B4_check는_200_NowView에_event(env, clock, position):
    view = checked(env, plain_day(env), clock, position)
    assert_view(view)
    assert view["at"] == at_time(clock)


def test_B4_check의_position은_본문_위치(env):
    view = checked(env, plain_day(env), "13:20", FAR)
    assert view["position"] == {"lat": FAR[0], "lng": FAR[1]}


def test_B4_S6_위치_없는_check도_200이고_position은_null(env):
    view = checked(env, plain_day(env), "13:20")
    assert view["position"] is None
    assert view["event"] is None


def test_B4_사건이_없으면_event는_null(env):
    assert checked(env, plain_day(env), "13:20", FAR)["event"] is None


BAD_BODIES = [
    {},
    {"at": "아무말"},
    {"at": "2026-13-40T10:00:00"},
    {"at": "2026-12-02T12:20:00+09:00"},
    {"at": "2026-12-02T03:20:00Z"},
    {"at": "2026-12-02T12:20:00", "lat": P01[0]},
    {"at": "2026-12-02T12:20:00", "lng": P01[1]},
    {"at": "2026-12-02T12:20:00", "lat": "숫자아님", "lng": P01[1]},
    {"at": "2026-12-02T12:20:00", "lat": 90.01, "lng": P01[1]},
    {"at": "2026-12-02T12:20:00", "lat": P01[0], "lng": -180.01},
]
BAD_IDS = ["at_없음", "형식_오류", "없는_날짜", "시간대_붙음", "시간대_Z", "lat만", "lng만", "lat_형식_오류", "위도_범위_밖", "경도_범위_밖"]


@pytest.mark.parametrize("body", BAD_BODIES, ids=BAD_IDS)
def test_B4_본문_오류는_400(env, body):
    assert_error(env.client.post(f"/days/{plain_day(env)}/check", json=body), 400, "INVALID_REQUEST")


def test_B4_본문이_객체가_아니면_400(env):
    assert_error(env.client.post(f"/days/{plain_day(env)}/check", json=[]), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("body", BAD_BODIES, ids=BAD_IDS)
def test_B4_본문_400이_없는_날_404보다_먼저(env, body):
    assert_error(env.client.post("/days/없는-날/check", json=body), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("body", BAD_BODIES, ids=BAD_IDS)
def test_B4_본문_400이_고른_코스_없음_404보다_먼저(env, body):
    # TASK-006 §11 Q23과 같은 순서 (지운 GET /now 위치 쿼리 400 테스트의 대체)
    day_id = env.plant_day({"P01": spot("P01", 1.0)})
    assert_error(env.client.post(f"/days/{day_id}/check", json=body), 400, "INVALID_REQUEST")


def test_B4_없는_날은_404_day(env):
    error = assert_error(check(env, "없는-날", "12:20", P01), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "day"


def test_B4_고른_코스가_없으면_404_course(env):
    day_id = env.plant_day({"P01": spot("P01", 1.0)})
    error = assert_error(check(env, day_id, "12:20", P01), 404, "NOT_FOUND")
    assert error["detail"]["resource"] == "course"


def test_B4_하루_밖_날짜는_400(env):
    response = env.client.post(f"/days/{plain_day(env)}/check", json={"at": "2026-12-03T12:20:00", "lat": P01[0], "lng": P01[1]})
    assert_error(response, 400, "INVALID_REQUEST")


def test_B4_TASK006_R9_하루_밖_날짜와_코스_없음이_겹치면_404가_먼저(env):
    day_id = env.plant_day({"P01": spot("P01", 1.0)})
    response = env.client.post(f"/days/{day_id}/check", json={"at": "2026-12-03T12:20:00"})
    assert assert_error(response, 404, "NOT_FOUND")["detail"]["resource"] == "course"


@pytest.mark.parametrize("lat, lng", [(90.0, 180.0), (-90.0, -180.0)], ids=["위_끝", "아래_끝"])
def test_B4_좌표_범위_끝은_200(env, lat, lng):
    assert checked(env, plain_day(env), "13:20", (lat, lng))["position"] == {"lat": lat, "lng": lng}


def test_B4_오류_요청은_아무것도_바꾸지_않는다(env):
    day_id, _ = high(env)
    before = without_logs(stores(env))
    env.client.post(f"/days/{day_id}/check", json={"at": "아무말", "lat": P01[0], "lng": P01[1]})
    env.client.post(f"/days/{day_id}/check", json={"at": "2026-12-03T12:30:00", "lat": P01[0], "lng": P01[1]})
    assert without_logs(stores(env)) == before


# ---------- B-4 GET /now는 위치 쿼리를 무시한다 (TASK-006 Q9 해결) ----------


@pytest.mark.parametrize(
    "params",
    [
        {"lat": P01[0], "lng": P01[1]},
        {"lat": FAR[0], "lng": FAR[1]},
        {"lat": P01[0]},
        {"lng": P01[1]},
        {"lat": "숫자아님", "lng": P01[1]},
        {"lat": 90.01, "lng": 180.01},
    ],
    ids=["장소_위치", "먼_위치", "lat만", "lng만", "형식_오류", "범위_밖"],
)
@pytest.mark.parametrize("clock", ["12:10", "12:20", "13:20"])
def test_B4_GET_now의_위치_쿼리는_무시해_없을_때와_같다(env, params, clock):
    day_id = plain_day(env)
    assert now(env, day_id, clock, **params) == now(env, day_id, clock)


def test_B4_GET_now는_위치가_있어도_감지하지_않는다(env):
    day_id = plain_day(env)
    view = now(env, day_id, "12:20", lat=P01[0], lng=P01[1])
    assert view["event"] is None
    assert view["position"] is None
    assert checked(env, day_id, "12:21")["event"] is None  # 사건이 생기지 않았다


def test_B5_GET_now에도_지금_열린_사건이_실린다(env):
    day_id, view = high(env)
    assert now(env, day_id, "12:21")["event"] == view["event"]


# ---------- B-1 전이표, 줄마다 (AC-6) ----------


def test_B1_줄1_사건_없음에서_감지_없음이면_아무것도_안_한다(env):
    day_id = plain_day(env)
    before = without_logs(stores(env))
    view = checked(env, day_id, "12:05", P01)  # 5분: 문턱 아래
    assert view["event"] is None
    assert view["status"] != "delayed"
    assert without_logs(stores(env)) == before


def test_B1_줄2_낮음이면_사건을_open_low로_저장하고_제안은_없다(env):
    _, view = low(env)
    event = view["event"]
    assert (event["severity"], event["delay_min"], event["state"], event["proposals"]) == ("low", 10, "open_low", [])
    assert (view["status"], view["status_text"]) == ("delayed", delayed_text(10))


def test_B1_줄3_높음이면_제안을_저장하고_awaiting(env):
    _, view = high(env)
    event = view["event"]
    assert (event["severity"], event["delay_min"], event["state"]) == ("high", 20, "awaiting")
    assert 1 <= len(event["proposals"]) <= 2
    assert view["main"]["type"] == "T-04"
    assert (view["status"], view["status_text"]) == ("delayed", delayed_text(20))


def test_B1_줄4_open_low에서_같은_키로_여전히_낮으면_증거만_갱신(env):
    day_id, first = low(env)
    view = checked(env, day_id, "12:15", P01)
    event = view["event"]
    assert event["event_id"] == first["event"]["event_id"]
    assert (event["state"], event["severity"], event["delay_min"], event["proposals"]) == ("open_low", "low", 15, [])
    assert view["status_text"] == delayed_text(15)


def test_B1_줄5_open_low에서_같은_키로_높아지면_대안을_계산해_awaiting(env):
    day_id, first = low(env)
    view = checked(env, day_id, "12:20", P01)
    event = view["event"]
    assert event["event_id"] == first["event"]["event_id"]
    assert (event["state"], event["severity"], event["delay_min"]) == ("awaiting", "high", 20)
    assert 1 <= len(event["proposals"]) <= 2
    assert view["main"]["type"] == "T-04"


def test_B1_줄6_awaiting에서_같은_키면_증거만_갱신하고_제안은_그대로(env):
    day_id, first = high(env)
    view = checked(env, day_id, "12:25", P01)
    event = view["event"]
    assert event["event_id"] == first["event"]["event_id"]
    assert (event["state"], event["delay_min"]) == ("awaiting", 25)
    assert event["proposals"] == first["event"]["proposals"]


def test_B1_줄7_awaiting에서_accept면_반영하고_resolved(env):
    day_id, view = high(env)
    old_id, old = chosen(env, day_id)
    proposal = view["event"]["proposals"][0]
    response = accept(env, proposal["proposal_id"])
    assert response.status_code == 200, response.text
    assert_view(response.json())
    # §11 Q11: 처리 끝난 사건은 accept 응답에만 싣는다
    assert (response.json()["event"]["event_id"], response.json()["event"]["state"]) == (view["event"]["event_id"], "resolved")
    assert chosen(env, day_id)[0] != old_id
    after = checked(env, day_id, "12:25", P01)
    assert after["event"] is None  # §11 Q11: 그 뒤 check에는 싣지 않는다
    assert after["status"] != "delayed"
    assert after["main"]["type"] != "T-04"


def test_B1_줄8_awaiting에서_dismiss면_일정_그대로_resolved(env):
    day_id, view = high(env)
    before = chosen(env, day_id)
    response = dismiss(env, view["event"]["event_id"])
    assert response.status_code == 200, response.text
    assert_view(response.json())
    assert response.json()["main"]["type"] != "T-04"
    # §11 Q11: 처리 끝난 사건은 dismiss 응답에만 싣는다
    assert (response.json()["event"]["event_id"], response.json()["event"]["state"]) == (view["event"]["event_id"], "resolved")
    assert chosen(env, day_id) == before
    after = checked(env, day_id, "12:25", P01)
    assert after["event"] is None  # §11 Q11
    assert after["status"] != "delayed"


def test_B1_줄9_resolved에서_같은_키_check는_아무것도_안_한다(env):
    day_id, view = high(env)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    first = checked(env, day_id, "12:30", P01)
    before = without_logs(stores(env))
    again = checked(env, day_id, "12:50", P01)  # 더 늦어짐 (§7: 다시 안 알린다)
    assert without_logs(stores(env)) == before
    assert (first["event"], again["event"]) == (None, None)  # §11 Q11: resolved 사건은 check에 싣지 않는다
    assert again["status"] != "delayed"
    assert again["main"]["type"] != "T-04"


@pytest.mark.parametrize("decide", ["accept", "dismiss"])
def test_S11_Q11_resolved_사건은_그_뒤_GET_now에도_싣지_않는다(env, decide):
    day_id, view = high(env)
    if decide == "accept":
        response = accept(env, view["event"]["proposals"][0]["proposal_id"])
    else:
        response = dismiss(env, view["event"]["event_id"])
    assert response.json()["event"]["state"] == "resolved"
    for clock in ("12:21", "12:40", "13:30"):
        assert now(env, day_id, clock)["event"] is None


def test_B1_스레드_ID는_사건_ID이고_awaiting이면_interrupt에서_기다린다(env):
    _, view = high(env)
    state = env.app.state.trip_graph.get_state({"configurable": {"thread_id": view["event"]["event_id"]}})
    assert state.next  # 멈춘 자리(interrupt)가 있다


# ---------- B-1 표 밖 조합 → 409, 그대로 (AC-6) ----------


def assert_conflict_keeps(env, send) -> dict:
    before = without_logs(stores(env))
    error = assert_error(send(), 409, "STATE_CONFLICT")
    assert without_logs(stores(env)) == before
    return error


def test_B1_409_open_low에서_dismiss(env):
    day_id, view = low(env)
    assert_conflict_keeps(env, lambda: dismiss(env, view["event"]["event_id"]))
    assert checked(env, day_id, "12:11", P01)["event"]["state"] == "open_low"


def test_B1_409_accept한_제안을_또_accept(env):
    _, view = high(env)
    proposal_id = view["event"]["proposals"][0]["proposal_id"]
    assert accept(env, proposal_id).status_code == 200
    assert_conflict_keeps(env, lambda: accept(env, proposal_id))


def test_B1_409_accept한_뒤_같은_사건의_다른_제안을_accept(env):
    _, view = high(env)
    proposals = view["event"]["proposals"]
    if len(proposals) < 2:
        pytest.skip("이 코스에서 제안이 하나라 다른 제안이 없다 (두 안이 같음, B-2)")
    assert accept(env, proposals[0]["proposal_id"]).status_code == 200
    assert_conflict_keeps(env, lambda: accept(env, proposals[1]["proposal_id"]))


def test_B1_409_accept한_뒤_dismiss(env):
    _, view = high(env)
    assert accept(env, view["event"]["proposals"][0]["proposal_id"]).status_code == 200
    assert_conflict_keeps(env, lambda: dismiss(env, view["event"]["event_id"]))


def test_B1_409_dismiss한_뒤_accept(env):
    _, view = high(env)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    assert_conflict_keeps(env, lambda: accept(env, view["event"]["proposals"][0]["proposal_id"]))


def test_B1_409_dismiss를_두_번(env):
    _, view = high(env)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    assert_conflict_keeps(env, lambda: dismiss(env, view["event"]["event_id"]))


def test_B4_없는_제안_accept는_404_proposal(env):
    plain_day(env)
    assert assert_error(accept(env, "없는-제안"), 404, "NOT_FOUND")["detail"]["resource"] == "proposal"


def test_B4_없는_사건_dismiss는_404_event(env):
    plain_day(env)
    assert assert_error(dismiss(env, "없는-사건"), 404, "NOT_FOUND")["detail"]["resource"] == "event"


# ---------- B-2 대안 계산 (AC-2 = SRS AC-05) ----------


@pytest.fixture
def ac05(env) -> tuple[str, dict]:
    day_id = ac05_day(env)
    return day_id, checked(env, day_id, "12:40", P01)


def test_AC2_SRS_AC05_12시40분이면_높음이고_대안_1에서_2개(ac05):
    _, view = ac05
    event = view["event"]
    assert (event["severity"], event["delay_min"], event["state"]) == ("high", 15, "awaiting")  # 15분이지만 15:30 체험에 늦어 높음 (A4)
    assert 1 <= len(event["proposals"]) <= 2


def test_AC2_대안마다_15시30분_체험을_지킨다(ac05):
    for proposal in ac05[1]["event"]["proposals"]:
        assert proposal["keeps_fixed"] is True
        assert ("F04", "15:30", "16:30", True) in slots(proposal["items"])


def test_AC2_B2_대안은_다음_장소부터이고_지난_곳은_없다(ac05):
    remaining = {"P02", "P03", "F04", "P05"}
    for proposal in ac05[1]["event"]["proposals"]:
        kept = {entry["place_id"] for entry in proposal["items"]}
        gone = {entry["place_id"] for entry in proposal["dropped"]}
        assert "P01" not in kept | gone
        assert kept | gone == remaining  # 남은 장소는 들어가거나 빠지거나
        assert not kept & gone
        assert "F04" not in gone


def test_AC2_B2_대안_일정은_지금_뒤에_시작하고_하루_끝을_넘지_않는다(ac05):
    for proposal in ac05[1]["event"]["proposals"]:
        starts = [to_min(entry["start"]) for entry in proposal["items"]]
        assert starts == sorted(starts)
        assert starts[0] >= to_min("12:40")
        assert all(to_min(entry["end"]) <= to_min("21:00") for entry in proposal["items"])


def test_AC2_B2_첫_출발_시각은_지금과_첫_일정_사이(ac05):
    for proposal in ac05[1]["event"]["proposals"]:
        assert to_min("12:40") <= to_min(proposal["first_leave_at"]) <= to_min(proposal["items"][0]["start"])


def test_AC2_B2_빠지는_곳은_장소_이름과_함께(ac05):
    for proposal in ac05[1]["event"]["proposals"]:
        for gone in proposal["dropped"]:
            assert gone["name"] == f"가상 {gone['place_id']}"


def assert_reason(proposal: dict, fixed_title: str | None) -> None:
    names = [gone["name"] for gone in proposal["dropped"]]
    if not names:
        assert proposal["reason"] == "머무는 시간 줄여서 다 가기"
        return
    tail = f" 빼고 {fixed_title}에 여유 있게" if fixed_title else " 빼고 남은 일정 여유 있게"
    assert proposal["reason"].endswith(tail), proposal["reason"]
    head = proposal["reason"][: -len(tail)]
    for name in names:
        assert name in head
    # 이름 말고 다른 내용(사실 값 등)이 들어가지 않는다: 이름을 지우면 구분 기호만 남는다
    rest = head
    for name in names:
        rest = rest.replace(name, "")
    assert not re.search(r"[0-9가-힣A-Za-z]", rest), head


def test_AC2_B2_이유는_대본_고정_일정_제목으로(ac05):
    for proposal in ac05[1]["event"]["proposals"]:
        assert_reason(proposal, "체험")


def test_B2_고정_일정이_없으면_남은_일정_여유_있게(env):
    _, view = high(env)
    for proposal in view["event"]["proposals"]:
        assert_reason(proposal, None)


def test_B2_두_안이면_label이_다르고_내용도_다르다(ac05):
    proposals = ac05[1]["event"]["proposals"]
    assert len({p["label"] for p in proposals}) == len(proposals)
    if len(proposals) == 2:
        assert slots(proposals[0]["items"]) != slots(proposals[1]["items"]) or proposals[0]["dropped"] != proposals[1]["dropped"]


def test_B2_꼭_갈_곳은_지킨다(env):
    day_id = ac05_day(env, must=("P05",))
    for proposal in checked(env, day_id, "12:40", P01)["event"]["proposals"]:
        assert "P05" in {entry["place_id"] for entry in proposal["items"]}
        assert "P05" not in {gone["place_id"] for gone in proposal["dropped"]}


def test_B2_Infeasible이면_제안_0개이고_awaiting_카드에_고정_일정(env):
    view = checked(env, infeasible_day(env), "13:30", P01)
    event = view["event"]
    assert (event["severity"], event["state"], event["proposals"]) == ("high", "awaiting", [])
    main = view["main"]
    assert main["type"] == "T-04"
    assert main["proposals"] == []
    assert main["fixed"] == {"title": "체험", "start": "15:30"}


def test_B2_TASK005_DP_상한_12곳을_넘는_남은_장소도_계산한다(env):
    places = {"P01": spot("P01", 1.0)}
    items = [item(1, "P01", "10:00", "11:00", 10)]
    clock = 11 * 60 + 5
    for number in range(2, 16):  # 남은 장소 14곳
        pid = f"P{number:02d}"
        places[pid] = spot(pid, 1.0 + number * 0.05)
        items.append(item(number, pid, f"{clock // 60:02d}:{clock % 60:02d}", f"{(clock + 30) // 60:02d}:{(clock + 30) % 60:02d}", 5))
        clock += 35
    day_id = plant(env, items, places)
    view = checked(env, day_id, "11:30", P01)  # 2번 예정 출발 11:00 → 30분 늦음
    assert view["event"]["severity"] == "high"
    assert view["event"]["proposals"]
    for proposal in view["event"]["proposals"]:
        assert len(proposal["items"]) <= 12
        assert {e["place_id"] for e in proposal["items"]} | {g["place_id"] for g in proposal["dropped"]} == set(places) - {"P01"}


# ---------- B-3 반영 (AC-7) ----------


def test_AC7_반영_뒤_지난_항목은_그대로_남은_항목은_제안_옛_안은_보관(env, ac05):
    day_id, view = ac05
    old_id, old = chosen(env, day_id)
    proposal = view["event"]["proposals"][0]
    assert accept(env, proposal["proposal_id"]).status_code == 200
    new_id, new = chosen(env, day_id)
    assert new_id != old_id
    assert new.items[:1] == old.items[:1]  # k = 1번까지는 그대로
    assert slots(new.items[1:]) == slots(proposal["items"])
    assert env.repo.get_option(old_id).course == old  # 옛 안은 기록용으로 남는다


def test_AC7_반영_응답과_뒤_NowView는_새_코스_기준(env, ac05):
    day_id, view = ac05
    proposal = view["event"]["proposals"][0]
    response = accept(env, proposal["proposal_id"]).json()
    _, new = chosen(env, day_id)
    expected = [(e.seq, e.place_id, e.start, e.end) for e in new.items if e.place_id]
    assert pin_slots(response) == expected
    assert pin_slots(now(env, day_id, "13:30")) == expected


def test_S11_Q15_accept_응답의_reason은_서버_compose_문장_그대로(env, ac05):
    day_id, view = ac05
    response = accept(env, view["event"]["proposals"][0]["proposal_id"]).json()
    assert response["reason"] != "바꾼 일정으로 안내할게"  # 그 문장은 앱이 accept 직후 보여 준다
    assert response["reason"] == now(env, day_id, response["at"][11:16])["reason"]


def test_AC7_dismiss는_코스를_바꾸지_않는다(env, ac05):
    day_id, view = ac05
    before = chosen(env, day_id)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    assert chosen(env, day_id) == before


# ---------- B-4 오래된 제안 (stale) ----------


@pytest.mark.parametrize("clock, stale", [("12:29", False), ("12:30", True)], ids=["9분_더_늦음", "10분_더_늦음"])
def test_B4_같은_사건의_delay_min이_10분_이상_늘면_accept는_409_stale(env, clock, stale):
    day_id, view = high(env)
    checked(env, day_id, clock, P01)
    send = lambda: accept(env, view["event"]["proposals"][0]["proposal_id"])  # noqa: E731
    if stale:
        assert assert_conflict_keeps(env, send)["detail"]["reason"] == "stale"
    else:
        assert send().status_code == 200


@pytest.mark.parametrize("clock, stale", [("12:34", False), ("12:35", True)], ids=["14분_지남", "15분_지남"])
def test_B4_제안을_만든_뒤_at이_15분_이상_지나면_accept는_409_stale(env, clock, stale):
    day_id, view = high(env)
    checked(env, day_id, clock, FAR)  # 같은 사건이 다시 감지되지 않는 check (delay_min은 그대로)
    send = lambda: accept(env, view["event"]["proposals"][0]["proposal_id"])  # noqa: E731
    if stale:
        assert assert_conflict_keeps(env, send)["detail"]["reason"] == "stale"
    else:
        assert send().status_code == 200


def test_S11_Q7_15분의_기준은_GET_now가_아니라_그날_마지막_check의_at(env):
    day_id, view = high(env)
    now(env, day_id, "12:40")  # GET은 check가 아니다
    assert accept(env, view["event"]["proposals"][0]["proposal_id"]).status_code == 200


def test_S11_Q7_마지막_check가_앞_시각으로_돌아가면_그_at이_기준(env):
    day_id, view = high(env)
    checked(env, day_id, "12:35", FAR)  # 15분 지남
    checked(env, day_id, "12:21", FAR)  # 마지막 check는 12:21 = 1분
    assert accept(env, view["event"]["proposals"][0]["proposal_id"]).status_code == 200


def test_B4_stale_뒤_check는_같은_사건의_제안을_한_번_새로_계산하고_새_사건은_아니다(env):
    day_id, view = high(env)
    checked(env, day_id, "12:30", P01)
    assert accept(env, view["event"]["proposals"][0]["proposal_id"]).status_code == 409
    fresh = checked(env, day_id, "12:31", P01)
    event = fresh["event"]
    assert event["event_id"] == view["event"]["event_id"]
    assert event["state"] == "awaiting"
    assert event["proposals"]
    old_ids = {p["proposal_id"] for p in view["event"]["proposals"]}
    assert not old_ids & {p["proposal_id"] for p in event["proposals"]}
    again = checked(env, day_id, "12:33", P01)  # 한 번만: 더 늦지 않았으면 그대로
    assert again["event"]["proposals"] == event["proposals"]
    assert accept(env, event["proposals"][0]["proposal_id"]).status_code == 200


def test_B4_새로_계산한_뒤_옛_제안은_반영되지_않는다(env):
    day_id, view = high(env)
    checked(env, day_id, "12:30", P01)
    old = view["event"]["proposals"][0]["proposal_id"]
    assert accept(env, old).status_code == 409
    checked(env, day_id, "12:31", P01)
    before = chosen(env, day_id)
    assert_conflict_keeps(env, lambda: accept(env, old))  # §11 Q9 (추천안 승인): 409 STATE_CONFLICT, 그대로
    assert chosen(env, day_id) == before


# ---------- B-5 NowView ----------


def test_B5_open_low와_awaiting이면_알약은_delayed와_분(env):
    _, low_view = low(env)
    _, high_view = high(env)
    assert (low_view["status"], low_view["status_text"]) == ("delayed", "10분 늦어지는 중")
    assert (high_view["status"], high_view["status_text"]) == ("delayed", "20분 늦어지는 중")


def test_B5_compose에는_awaiting_사건만_open_events로(env, monkeypatch):
    seen = []

    def spy(snapshot):
        seen.append(snapshot)
        return compose_screen(snapshot)

    monkeypatch.setattr("trip.now.compose_screen", spy)
    day_id = plain_day(env)
    checked(env, day_id, "12:10", P01)
    assert seen[-1].open_events == []  # open_low는 카드 안 바꿈
    checked(env, day_id, "12:20", P01)
    assert seen[-1].open_events == [OpenEvent(kind="delay")]


def test_B5_S7_낮음_사건은_카드를_안_바꾸고_알약만(env):
    with_event = plain_day(env)
    twin = plain_day(env)
    a = checked(env, with_event, "12:10", P01)
    b = checked(env, twin, "12:10")  # 위치 없음 = 감지 안 함 (route는 위치가 경계 점이라 비교하지 않는다)
    assert a["event"]["state"] == "open_low"
    for key in ("main", "subs", "reason", "pins"):
        assert a[key] == b[key], key
    assert (a["status"], b["status"]) == ("delayed", "on_track")


def test_B5_T_04_카드_값은_사건과_같다(ac05):
    _, view = ac05
    main, event = view["main"], view["event"]
    assert set(main) == T04_KEYS
    assert (main["event_id"], main["delay_min"]) == (event["event_id"], event["delay_min"])
    assert main["proposals"] == event["proposals"]
    assert main["fixed"] == {"title": "체험", "start": "15:30"}


def test_B5_T_04_fixed는_고정_일정이_없으면_null(env):
    assert high(env)[1]["main"]["fixed"] is None


def test_B5_S5_T_04의_짝은_고정_일정이_있으면_T_07_그다음_T_03(ac05):
    assert types(ac05[1]["subs"]) == ["T-07", "T-03"]


def test_B5_S5_T_04의_짝은_고정_일정이_없으면_T_03(env):
    assert types(high(env)[1]["subs"]) == ["T-03"]


def test_B5_T_04의_reason은_compose_문장(env):
    assert high(env)[1]["reason"] == REASONS["T-04"]


def test_B5_T_04는_지원_목록이라_T_01로_바꾸지_않는다(env, caplog):
    with caplog.at_level(logging.WARNING):
        view = high(env)[1]
    assert view["main"]["type"] == "T-04"
    assert not [r for r in caplog.records if "T-04" in r.getMessage() and "T-01" in r.getMessage()]


def test_B5_NowView_스키마에_event가_있다(env):
    schemas = env.app.openapi()["components"]["schemas"]
    assert "event" in schemas["NowView"]["properties"]


# ---------- §6 실패하면, 줄마다 (AC-8) ----------


def test_S6_줄1_대안_계산_중_예외면_500이고_모두_그대로_다음_check는_정상(quiet_env, monkeypatch):
    env = quiet_env
    day_id = plain_day(env)
    before = without_logs(stores(env))
    with monkeypatch.context() as patch:
        patch.setattr("graphs.trip.compose_courses", raise_forced)
        assert_error(check(env, day_id, "12:20", P01), 500, "INTERNAL_ERROR")
        assert_error(check(env, day_id, "12:21", P01), 500, "INTERNAL_ERROR")  # 두 번 연속
    assert without_logs(stores(env)) == before
    assert now(env, day_id, "12:22")["event"] is None
    view = checked(env, day_id, "12:25", P01)
    # 실패한 12:20 요청이 다시 돌지 않고 이번 요청(25분)이 처리된다 (TASK-003 R1)
    assert (view["event"]["state"], view["event"]["delay_min"]) == ("awaiting", 25)
    assert view["event"]["proposals"]


def test_S6_줄1_낮음에서_높음으로_갈_때_예외면_open_low_그대로(quiet_env, monkeypatch):
    env = quiet_env
    day_id, first = low(env)
    before = without_logs(stores(env))
    with monkeypatch.context() as patch:
        patch.setattr("graphs.trip.compose_courses", raise_forced)
        assert_error(check(env, day_id, "12:20", P01), 500, "INTERNAL_ERROR")
    assert without_logs(stores(env)) == before
    assert now(env, day_id, "12:21")["event"] == first["event"]
    view = checked(env, day_id, "12:22", P01)
    assert (view["event"]["event_id"], view["event"]["state"], view["event"]["delay_min"]) == (first["event"]["event_id"], "awaiting", 22)


def test_S6_줄5_반영_중_예외면_500이고_옛_코스와_awaiting_그대로_다음_요청은_정상(quiet_env, monkeypatch):
    env = quiet_env
    day_id, view = high(env)
    before_course, before_stores = chosen(env, day_id), without_logs(stores(env))
    proposal_id = view["event"]["proposals"][0]["proposal_id"]
    with monkeypatch.context() as patch:
        patch.setattr("trip.now.compose_screen", raise_forced)  # 반영 뒤 화면 계산 (TASK-003 R12: 저장보다 먼저)
        assert_error(accept(env, proposal_id), 500, "INTERNAL_ERROR")
    assert chosen(env, day_id) == before_course
    assert without_logs(stores(env)) == before_stores
    after = now(env, day_id, "12:21")
    assert after["event"]["state"] == "awaiting"
    assert after["event"]["proposals"] == view["event"]["proposals"]
    assert accept(env, proposal_id).status_code == 200


def test_S6_줄5_반영_예외_뒤_dismiss를_보내면_옛_accept가_다시_돌지_않는다(quiet_env, monkeypatch):
    env = quiet_env
    day_id, view = high(env)
    before_course = chosen(env, day_id)
    with monkeypatch.context() as patch:
        patch.setattr("trip.now.compose_screen", raise_forced)
        assert_error(accept(env, view["event"]["proposals"][0]["proposal_id"]), 500, "INTERNAL_ERROR")
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    assert chosen(env, day_id) == before_course


def test_S6_dismiss_응답_계산_중_예외면_500이고_awaiting_그대로(quiet_env, monkeypatch):
    env = quiet_env
    day_id, view = high(env)
    before = without_logs(stores(env))
    with monkeypatch.context() as patch:
        patch.setattr("trip.now.compose_screen", raise_forced)
        assert_error(dismiss(env, view["event"]["event_id"]), 500, "INTERNAL_ERROR")
    assert without_logs(stores(env)) == before
    assert now(env, day_id, "12:21")["event"]["state"] == "awaiting"


def test_S6_check_응답_계산_중_예외면_500이고_사건이_안_생긴다(quiet_env, monkeypatch):
    env = quiet_env
    day_id = plain_day(env)
    before = without_logs(stores(env))
    with monkeypatch.context() as patch:
        patch.setattr("trip.now.compose_screen", raise_forced)
        assert_error(check(env, day_id, "12:20", P01), 500, "INTERNAL_ERROR")
    assert without_logs(stores(env)) == before
    assert checked(env, day_id, "12:21", P01)["event"]["delay_min"] == 21


def test_S6_줄7_위치가_없으면_감지하지_않고_열린_사건은_그대로(env):
    day_id, view = high(env)
    later = checked(env, day_id, "12:30")
    assert later["event"] == view["event"]
    assert (later["event"]["state"], later["event"]["delay_min"]) == ("awaiting", 20)


def test_S6_줄7_위치가_없으면_늦은_시각이어도_사건을_만들지_않는다(env):
    assert checked(env, plain_day(env), "12:45")["event"] is None


# ---------- §7 겹치면 ----------


@pytest.fixture
def later_fixed(env) -> tuple[str, dict]:
    day_id = fixed_later_day(env)
    view = checked(env, day_id, "12:20", P01)
    assert view["event"]["state"] == "awaiting"
    return day_id, view


def test_S7_고정_일정이_멀면_T_04가_메인이고_짝은_T_07_T_03(later_fixed):
    view = later_fixed[1]
    assert view["main"]["type"] == "T-04"
    assert types(view["subs"]) == ["T-07", "T-03"]


@pytest.mark.parametrize("clock, main", [("13:24", "T-04"), ("13:25", "T-07"), ("13:59", "T-07"), ("14:00", "T-04"), ("14:30", "T-04")], ids=["출발_16분전", "출발_15분전", "시작_1분전", "시작_정각", "고정_일정_안"])
def test_S7_고정_일정_임박이면_T_07이_메인이고_지나면_T_04(env, later_fixed, clock, main):
    view = now(env, later_fixed[0], clock)
    assert view["main"]["type"] == main
    assert view["event"]["state"] == "awaiting"
    assert view["status"] == "delayed"


def test_S7_사건을_처리하면_T_04는_메인에서_사라진다(env, later_fixed):
    day_id, view = later_fixed
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    assert now(env, day_id, "14:00")["main"]["type"] != "T-04"


@pytest.mark.parametrize("clock", ["15:00", "19:00", "19:30", "23:59"])
def test_S7_A2_마지막_장소에서는_사건이_안_생긴다(env, clock):
    view = checked(env, plain_day(env), clock, P03)
    assert view["event"] is None


def test_S7_마지막_장소에서_하루가_끝나면_T_08(env):
    view = checked(env, plain_day(env), "19:30", P03)
    assert view["main"]["type"] == "T-08"
    assert view["status"] != "delayed"


def test_S7_resolved_뒤_같은_장소에서_더_늦어져도_다시_안_알린다(env):
    day_id, view = high(env)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    for clock in ("12:40", "13:00", "13:30"):
        later = checked(env, day_id, clock, P01)
        assert later["event"] is None  # §11 Q11
        assert later["status"] != "delayed"
        assert later["main"]["type"] != "T-04"


def test_S7_B1_다음_장소에서_늦어지면_새_사건(env):
    day_id, view = high(env)
    assert dismiss(env, view["event"]["event_id"]).status_code == 200
    later = checked(env, day_id, "14:20", P02)  # 2번 예정 출발 14:00 → 20분
    assert later["event"]["event_id"] != view["event"]["event_id"]
    assert (later["event"]["state"], later["event"]["delay_min"]) == ("awaiting", 20)
    assert later["main"]["type"] == "T-04"


def test_S7_B1_S11_Q12_낮음_사건이_열린_채로_다른_장소에서_늦어지면_옛_사건은_닫고_새_사건(env):
    day_id, first = low(env)
    later = checked(env, day_id, "14:20", P02)
    assert later["event"]["event_id"] != first["event"]["event_id"]
    assert (later["event"]["state"], later["event"]["delay_min"]) == ("awaiting", 20)
    assert now(env, day_id, "14:21")["event"]["event_id"] == later["event"]["event_id"]  # 화면에는 새 사건 하나만
    # 옛 사건은 resolved(사용자 선택 없음): 표 밖 이벤트는 409
    assert_conflict_keeps(env, lambda: dismiss(env, first["event"]["event_id"]))


def test_S7_B1_S11_Q12_awaiting_사건이_열린_채로_다른_장소에서_늦어지면_옛_사건도_닫고_새_사건(env):
    day_id, first = high(env)
    course_before = chosen(env, day_id)
    later = checked(env, day_id, "14:20", P02)
    event = later["event"]
    assert event["event_id"] != first["event"]["event_id"]
    assert (event["state"], event["delay_min"]) == ("awaiting", 20)
    assert later["main"]["type"] == "T-04"
    assert later["main"]["event_id"] == event["event_id"]  # 화면에는 새 사건 하나만
    assert now(env, day_id, "14:21")["event"]["event_id"] == event["event_id"]
    # 옛 사건은 resolved(사용자 선택 없음): 옛 제안 accept·옛 사건 dismiss는 409이고 일정은 그대로
    for proposal in first["event"]["proposals"]:
        assert_conflict_keeps(env, lambda pid=proposal["proposal_id"]: accept(env, pid))
    assert_conflict_keeps(env, lambda: dismiss(env, first["event"]["event_id"]))
    assert chosen(env, day_id) == course_before


# ---------- AC-3 (SRS AC-06): 고르기 전에는 일정 그대로 ----------


def test_AC3_제안이_떠_있고_아무것도_안_고르면_코스와_일정이_그대로(env):
    day_id = plain_day(env)
    baseline = pin_slots(now(env, day_id, "12:20"))
    course_before = chosen(env, day_id)
    checked(env, day_id, "12:20", P01)
    for clock in ("12:21", "12:22", "12:25", "12:28"):
        view = checked(env, day_id, clock, P01)
        assert view["event"]["state"] == "awaiting"
        assert pin_slots(view) == baseline
        assert chosen(env, day_id) == course_before
    assert pin_slots(now(env, day_id, "12:40")) == baseline
    t03 = next(card for card in checked(env, day_id, "12:29", P01)["subs"] if card["type"] == "T-03")
    assert [(e["place_id"], e["start"], e["end"]) for e in t03["items"]] == [("P03", "14:30", "19:00")]


def test_AC3_낮음_사건도_일정을_바꾸지_않는다(env):
    day_id = plain_day(env)
    before = chosen(env, day_id)
    for clock in ("12:10", "12:12", "12:15", "12:19"):
        checked(env, day_id, clock, P01)
    assert chosen(env, day_id) == before


# ---------- AC-4 (SRS AC-10): 같은 사건 5분 뒤 ----------


def test_AC4_같은_사건을_5분_뒤_다시_감지하면_새_알림_없이_제안_그대로(env):
    day_id, first = high(env)
    view = checked(env, day_id, "12:25", P01)
    assert view["event"]["event_id"] == first["event"]["event_id"]
    assert view["event"]["proposals"] == first["event"]["proposals"]
    assert view["event"]["state"] == "awaiting"


def test_AC4_1분마다_다시_감지해도_사건은_하나(env):
    day_id, first = high(env)
    seen = {first["event"]["event_id"]}
    for minute in range(21, 30):
        seen.add(checked(env, day_id, f"12:{minute}", P01)["event"]["event_id"])
    assert seen == {first["event"]["event_id"]}


# ---------- AC-9: 위치가 로그·저장소·체크포인트에 없다 ----------

AC9 = at_place(1.02, east_km=0.031)  # P01에서 약 37m: 감지되는 위치, 장소 좌표와 겹치지 않는 값


def ac9_scenario(env) -> str:
    day_id = plain_day(env)
    checked(env, day_id, "12:10", AC9)
    view = checked(env, day_id, "12:20", AC9)
    assert view["event"]["state"] == "awaiting"  # 시험 자체 확인: 이 위치로 감지된다
    checked(env, day_id, "12:25", AC9)
    return view["event"]["event_id"]


def has_position(text: str) -> bool:
    return any(str(value) in text for value in AC9) or any(f"{value:.6f}" in text for value in AC9)


def test_AC9_위치가_저장소에_없다(env):
    ac9_scenario(env)
    assert not has_position(repr(stores(env)))


def test_AC9_위치가_체크포인트에_없다(env):
    event_id = ac9_scenario(env)
    assert checkpoints_text(env)  # 시험 자체 확인: 체크포인트가 있다
    assert not has_position(checkpoints_text(env))
    assert not has_position(repr(env.app.state.trip_graph.get_state({"configurable": {"thread_id": event_id}}).values))


def test_AC9_위치가_로그에_없다_접근_로그_포함(env, caplog):
    with caplog.at_level(logging.DEBUG):
        ac9_scenario(env)
    assert not [r.getMessage() for r in caplog.records if has_position(r.getMessage())]


def test_AC9_check는_위치를_주소에_싣지_않는다(env, caplog):
    # §12: 테스트 클라이언트가 httpx2를 쓰면 요청 로그는 "httpx2" 로거에 남는다. 둘 다 잡는다 (기대값 그대로)
    with caplog.at_level(logging.DEBUG, logger="httpx"), caplog.at_level(logging.DEBUG, logger="httpx2"):
        checked(env, plain_day(env), "12:20", AC9)
    requests = [r.getMessage() for r in caplog.records if "/check" in r.getMessage()]
    assert requests and not [message for message in requests if "lat" in message or has_position(message)]


# ---------- AC-10: 그래프에서 LLM·Jev 호출 0 ----------


def run_trip_events(env) -> None:
    day_id = plain_day(env)
    checked(env, day_id, "12:10", P01)
    view = checked(env, day_id, "12:20", P01)
    checked(env, day_id, "12:25", P01)
    accept(env, view["event"]["proposals"][0]["proposal_id"])
    other = ac05_day(env)
    second = checked(env, other, "12:40", P01)
    dismiss(env, second["event"]["event_id"])
    checked(env, other, "14:20", at_place(9.2))
    stale_day, stale = high(env)
    checked(env, stale_day, "12:30", P01)
    accept(env, stale["event"]["proposals"][0]["proposal_id"])
    checked(env, stale_day, "12:31", P01)
    checked(env, infeasible_day(env), "13:30", P01)


@pytest.mark.parametrize("key", [None, "test-key"], ids=["키_없음", "키_있음"])
def test_AC10_여행_중_모든_이벤트에서_Jev와_바깥_HTTP_호출_0회(monkeypatch, key):
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
        run_trip_events(PlanningEnv(client, app))

    assert calls == []


def test_AC10_LLM_도구를_불러오지_않는다(env):
    run_trip_events(env)
    assert not {"anthropic", "openai", "langchain_openai", "langchain_anthropic"} & set(sys.modules)


@pytest.mark.parametrize("path", ["graphs/trip.py", "trip/detect.py"])
def test_AC10_그래프와_감지_코드는_판단기와_HTTP를_import하지_않는다(path):
    tree = ast.parse((SERVER / path).read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"deciders", "httpx", "requests", "anthropic", "openai"}


# ---------- §0-1 F1·F2: 하루가 끝난 뒤 알약과 이유 ----------


@pytest.mark.parametrize("clock", ["19:00", "19:30", "23:59"])
def test_F1_F2_마지막_일정이_끝나면_알약은_오늘_일정_끝_중립_이유는_한_문장(env, clock):
    view = now(env, plain_day(env), clock)
    assert view["main"]["type"] == "T-08"
    assert (view["status"], view["status_text"]) == ("free", DAY_OVER_PILL)
    assert view["reason"] == DAY_OVER


@pytest.mark.parametrize("clock", ["15:00", "17:59", "18:00", "20:00"])
def test_F1_F2_18시_전후_어느_때_끝나도_같다(env, clock):
    places = {"P01": spot("P01", 1.0)}
    day_id = plant(env, [item(1, "P01", "10:12", "15:00", 12)], places)
    view = now(env, day_id, clock)
    assert (view["status"], view["status_text"], view["reason"]) == ("free", DAY_OVER_PILL, DAY_OVER)


def test_F1_check_응답도_같다(env):
    view = checked(env, plain_day(env), "19:30", P03)
    assert (view["status_text"], view["reason"]) == (DAY_OVER_PILL, DAY_OVER)


@pytest.mark.parametrize("clock", ["18:30", "18:59"])
def test_F1_마지막_일정_안은_아직_하루_끝이_아니다(env, clock):
    view = now(env, plain_day(env), clock)
    assert view["status_text"] == FREE
    assert view["reason"] != DAY_OVER
