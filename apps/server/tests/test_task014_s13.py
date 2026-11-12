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


# =====================================================================
# §13 3 인코딩 키: 막는 쪽(400)과 로그(쿼리 통째로 지움)가 키를 다르게 읽지 않게
# =====================================================================

COORDS = ("34.987654", "135.123457")
ENCODED = [
    (f"%6Cat={COORDS[0]}&lng={COORDS[1]}", "lat_퍼센트_인코딩"),
    (f"lat={COORDS[0]}&%6Cng={COORDS[1]}", "lng_퍼센트_인코딩"),
    (f"%256Cat={COORDS[0]}", "lat_이중_인코딩"),
    (f"%256C%2561t={COORDS[0]}", "lat_이중_인코딩_두_글자"),
    (f"LAT={COORDS[0]}&Lng={COORDS[1]}", "대문자"),
    (f"%4C%41%54={COORDS[0]}", "대문자_퍼센트_인코딩"),
]


@pytest.mark.parametrize("query", [q for q, _ in ENCODED], ids=[i for _, i in ENCODED])
@pytest.mark.parametrize("path", ["/health", "/trips/current", "/없는-길"])
def test_T14_S13_3_인코딩한_lat·lng_키도_400(osaka, query, path):
    response = osaka.client.get(f"{path}?{query}")
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert COORDS[0] not in response.text and COORDS[1] not in response.text


ACCESS = [
    *[(f"/days/d1/now?at=2026-12-08T12:00:00&{q}", i) for q, i in ENCODED],
    (f"/days/d1/check?lat={COORDS[0]}&lng={COORDS[1]}", "그대로"),
    (f"/health?x=1&lat={COORDS[0]}#frag", "다른_칸과_조각"),
    ("/trips/current?at=2026-12-08T12:00:00", "위치_없는_쿼리"),
]


@pytest.mark.parametrize("path", [p for p, _ in ACCESS], ids=[i for _, i in ACCESS])
@pytest.mark.parametrize("status", [400, 200])
def test_T14_S13_3_접근_로그_요청_줄에는_길만_남고_쿼리는_통째로_없다(osaka, caplog, path, status):
    # §13 3: 쿼리 문자열을 통째로 지운다 (가리기 *** 대신). uvicorn 요청 줄 모양 그대로 남겨 서버가 단 거르개를 본다 (TASK-010 E5와 같은 방식)
    caplog.set_level(logging.DEBUG)
    method = "POST" if "check" in path else "GET"
    logging.getLogger("uvicorn.access").info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:50000", method, path, "1.1", status)
    lines = [r.getMessage() for r in caplog.records if r.name == "uvicorn.access"]
    assert lines, "시험 자체 확인: 요청 줄은 남는다"
    bare = path.split("?")[0]
    assert f"{method} {bare} HTTP/1.1" in lines[0], lines[0]  # 길만
    assert "?" not in lines[0] and "=" not in lines[0].split('"')[1], lines[0]  # 쿼리 통째로 없음
    assert COORDS[0] not in lines[0] and COORDS[1] not in lines[0]


# =====================================================================
# §12 순서 보강 (backend 보고: _replay의 영업 확인 뒤 continue -> break, 닫힘 짝 조건 and -> or)
# "연습 기록 적용 = 실제 적용": 영업 확인(열었어) 뒤에 이어지는 행동이 있는 조합
# =====================================================================


def late_check_day(env) -> str:
    """P02에서 늦는 동안 P03(미확인)의 영업 확인 창이 열려 있는 날.
    1번 P01 10:12~12:00, 2번 P02 12:20~14:00, 3번 P03 14:30~19:00(이동 30 -> 출발 14:00, 확인 창 13:30 ≤ at < 14:30).
    P02에서 14:20이면 20분 늦음(높음, 대안) + P03 T-05가 함께 있다."""
    from test_task008_visit import unverified
    from trip_helpers import item, plant, spot

    places = {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0), "P03": unverified("P03", km=3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    return plant(env, items, places)


def env_check(env, day_id: str, clock: str, position, rehearsal: bool = False, actions=None):
    from trip_helpers import at_time

    body = {"at": at_time(clock)}
    if position is not None:
        body["lat"], body["lng"] = position
    if rehearsal:
        body["rehearsal"] = True
        if actions is not None:
            body["rehearsal_actions"] = actions
    return env.client.post(f"/days/{day_id}/check", json=body)


@pytest.mark.parametrize("order", ["열었어_다음_고른_대안", "고른_대안_다음_열었어", "열었어_다음_그대로_갈래"])
def test_T14_S13_순서_열었어가_섞인_기록도_실제로_같은_순서로_한_것과_같다(env, order):
    from test_task014_location_rehearsal import act_accept, act_dismiss, act_visit, everything, same_shape
    from trip_helpers import at_place, at_time

    P02 = at_place(2.0)

    day_id = late_check_day(env)
    first = env_check(env, day_id, "14:20", P02, rehearsal=True)
    assert first.status_code == 200, first.text
    view = first.json()
    assert view["event"] and view["event"]["proposals"]  # 시험 자체 확인: 높음 + 대안
    event = view["event"]
    opened = act_visit("P03", day_id, at_time("14:20"), was_open=True)
    actions = {
        "열었어_다음_고른_대안": [opened, act_accept(event)],
        "고른_대안_다음_열었어": [act_accept(event), opened],
        "열었어_다음_그대로_갈래": [opened, act_dismiss(event)],
    }[order]
    before = everything(env, "memory")
    practiced = env_check(env, day_id, "14:25", P02, rehearsal=True, actions=actions)
    assert everything(env, "memory") == before
    # 같은 순서를 실제로
    real_event = env_check(env, day_id, "14:20", P02).json()["event"]
    results = []
    for action in actions:
        if action["type"] == "visit_check":
            results.append(env.client.post("/places/P03/visit-checks", json={"day_id": day_id, "at": action["at"], "was_open": True}))
        elif action["type"] == "accept":
            results.append(env.client.post(f"/proposals/{real_event['proposals'][0]['proposal_id']}/accept"))
        else:
            results.append(env.client.post(f"/events/{real_event['event_id']}/dismiss"))
    if actions[0]["type"] == "visit_check":
        assert results[0].status_code == 200, results[0].text  # 시험 자체 확인: 14:20엔 P03이 영업 확인 대상 (T-04 메인이라 카드로는 안 보일 수 있다)
    failed = next((r for r in results if r.status_code != 200), None)
    if failed is not None:  # 실제로 중간에 막히면 연습도 같은 이유로 막힌다
        assert practiced.status_code == failed.status_code, (practiced.text, failed.text)
        return
    assert practiced.status_code == 200, practiced.text
    assert same_shape(practiced.json()) == same_shape(env_check(env, day_id, "14:25", P02).json())
