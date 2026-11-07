"""앱 화면용 서버 소작업. 근거: TASK-004 §A(A1~A5), §12-1(A6, A7, Q1, Q2, Q3), §13-1(A8), AC-2, AC-3, TASK-003 §5, §6, §10(원칙 1·2, Q6, Q37, Q38, R1, R4, R5, R11, R12)."""

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from planning_api_helpers import (
    BATCH_KEYS,
    COURSE_KEYS,
    FIXED_STAY,
    ITEM_KEYS,
    MSG_CLARIFY,
    MSG_EXHAUSTED,
    MSG_FIRST,
    MSG_NO_DIRECTION,
    PICKS_KEYS,
    QUESTION_KEYS,
    SESSION_KEYS,
    UNKNOWN_TEXT,
    as_dict,
    assert_error,
    cafes,
    first_option_id,
    ids,
    week_hours,
)
from planning_helpers import day_plan, fixed_event, opening, place

from engine.models import StayRange

SERVER = Path(__file__).parents[1]
API_TYPES = SERVER.parents[1] / "packages" / "api-types"
DAY_KEYS = {"day_id", "day_number", "date", "start", "end", "lodging", "must_visits", "fixed"}
DONE_KEYS = {"day_id", "option_id", "stage"}
BATCH_BUILDER = "planning.presenter.pick_directions"  # 기존 F113과 같은 강제 지점
COURSE_BUILDER = "planning.presenter.CourseResult"  # 기존 F116과 같은 강제 지점
DAY_LOOKUP = "planning.repo.MemoryPlanningRepo.get_day"
CHOSEN_LOOKUP = "planning.repo.MemoryPlanningRepo.chosen_option"


def raise_forced(*args, **kwargs):
    raise RuntimeError("테스트가 강제한 예외")


def city(count=24):
    return as_dict(cafes(count))


@pytest.fixture
def quiet_env(env):
    """서버 예외를 테스트로 다시 던지지 않고 500 응답으로 받는다."""
    env.client = TestClient(env.app, raise_server_exceptions=False)
    return env


def get(env, session_id):
    return env.client.get(f"/planning/{session_id}")


def get_ok(env, session_id) -> dict:
    response = get(env, session_id)
    assert response.status_code == 200, response.text
    return response.json()


def frozen(env, sid) -> dict:
    """요청 전후로 그대로여야 하는 것: 그래프 상태, 저장소, 기다리는 자리, 체크포인트 값과 개수."""
    config = {"configurable": {"thread_id": sid}}
    snapshot = env.graph.get_state(config)
    return {
        "values": snapshot.values,
        "next": snapshot.next,
        "checkpoint_id": snapshot.config["configurable"]["checkpoint_id"],
        "checkpoints": len(list(env.graph.get_state_history(config))),
        "repo": env.repo.snapshot(),
    }


# ---------- stage 4개로 가는 길 ----------


def at_asking(env, places=None, plan=None):
    session = env.session(env.plant_day(places or city(), plan))
    return session["session_id"], session


def at_browsing(env, places=None, plan=None):
    return env.browse(env.plant_day(places or city(), plan))


def at_composing(env, places=None, plan=None):
    return env.composing(env.plant_day(places or city(), plan), likes=("P01", "P02"))


def at_done(env, places=None, plan=None):
    day_id = env.plant_day(places or city(), plan)
    sid, course = env.composing(day_id, likes=("P01", "P02"))
    option_id = first_option_id(course)
    response = env.select(option_id)
    assert response.status_code == 200, response.text
    return sid, {"day_id": day_id, "option_id": option_id, "stage": "done"}


STAGES = {"asking": at_asking, "browsing": at_browsing, "composing": at_composing, "done": at_done}
STAGE_PARAMS = [pytest.param(fn, id=name) for name, fn in STAGES.items()]


# ---------- 응답 모양 (TASK-003 §6 + day + name) ----------


def assert_new_session_shape(data: dict) -> None:
    from planning.schemas import PlanningSession

    assert set(data) == SESSION_KEYS
    assert data["stage"] == "asking"
    assert set(data["question"]) == QUESTION_KEYS
    assert_day_shape(data["day"])
    PlanningSession.model_validate(data)


def assert_new_batch_shape(data: dict) -> None:
    from planning.schemas import CandidateBatch

    assert set(data) == BATCH_KEYS
    assert data["stage"] == "browsing"
    assert_day_shape(data["day"])
    CandidateBatch.model_validate(data)


def assert_new_course_shape(data: dict) -> None:
    from planning.schemas import CourseResult

    assert set(data) == COURSE_KEYS
    assert data["stage"] == "composing"
    assert_day_shape(data["day"])
    for option in data["options"]:
        for item in option["items"]:
            assert set(item) == ITEM_KEYS
        for dropped in option["dropped"]:
            assert set(dropped) == {"place_id", "reason", "name"}
            assert type(dropped["name"]) is str and dropped["name"]
    CourseResult.model_validate(data)


def assert_day_shape(day: dict) -> None:
    assert set(day) == DAY_KEYS
    assert type(day["day_id"]) is str
    assert type(day["day_number"]) is int
    assert set(day["lodging"]) == {"lat", "lng"}
    assert type(day["lodging"]["lat"]) is float and type(day["lodging"]["lng"]) is float
    for must in day["must_visits"]:
        assert set(must) == {"place_id", "name", "stay_min"}  # TASK-006 §11 Q19
    for fixed in day["fixed"]:
        assert set(fixed) == {"place_id", "name", "start", "end"}


SHAPES = {"asking": assert_new_session_shape, "browsing": assert_new_batch_shape, "composing": assert_new_course_shape}


def must_stay(place, overrides: dict[str, int] | None = None) -> int:
    """TASK-006 §11 Q19: 바꾼 머문 시간 > typical > 60."""
    if overrides and place.id in overrides:
        return overrides[place.id]
    return place.stay.typical if place.stay else 60


def expected_day(env, day_id: str) -> dict:
    """저장소의 하루 데이터에서 만든 기대값 (A2). 고정 일정 name = 장소 이름, 없으면 title (Q1)."""
    record = env.repo.get_day(day_id)
    plan = record.plan
    return {
        "day_id": day_id,
        "day_number": record.day_number,
        "date": plan.date.isoformat(),
        "start": plan.start,
        "end": plan.end,
        "lodging": {"lat": plan.lodging[0], "lng": plan.lodging[1]},
        "must_visits": [
            {"place_id": pid, "name": record.places[pid].name, "stay_min": must_stay(record.places[pid], plan.stay_overrides)}
            for pid in plan.must_visit
        ],
        "fixed": [
            {
                "place_id": f.place_id,
                "name": record.places[f.place_id].name if f.place_id else f.title,
                "start": f.start,
                "end": f.end,
            }
            for f in plan.fixed
        ],
    }


# ---------- A1: stage별 응답 ----------


def test_S01_A1_asking이면_첫_질문을_다시_준다(env):
    sid, session = at_asking(env)
    data = get_ok(env, sid)
    assert_new_session_shape(data)
    assert data == session


def test_S02_A1_browsing이면_지금_묶음을_다시_준다(env):
    sid, batch = at_browsing(env)
    data = get_ok(env, sid)
    assert_new_batch_shape(data)
    assert data == batch


def test_S03_A1_원칙2_반응_뒤에는_why와_담은_수를_지금_상태로_다시_계산(env):
    places = as_dict(
        [
            place("P01", tags=("골목",), hours=week_hours()),
            place("P02", tags=("골목",), hours=week_hours()),
            *cafes(20, start=3),
        ]
    )
    sid, batch = at_browsing(env, places)
    assert env.react(sid, "P01").status_code == 200
    data = get_ok(env, sid)
    assert ids(data) == ids(batch)
    assert data["picks_count"] == 1
    assert data["round"] == batch["round"]
    by_id = {c["place"]["id"]: c["why"] for c in data["candidates"]}
    assert by_id["P02"] == "골목 좋아해서 골랐어요"  # P01을 담아서 바뀐 값


def test_S04_A1_방향으로_받은_묶음도_같은_message와_묶음(env):
    sid, _ = at_browsing(env)
    response = env.next(sid, direction_id="closer").json()
    assert get_ok(env, sid) == response


def test_S05_A1_Q6_글로_방향을_말한_첫_묶음은_다시_받아도_첫_묶음_대본(env):
    places = as_dict(cafes(24, crowd=1))
    sid, batch = env.browse(env.plant_day(places), [], "조용한 데")
    assert batch["message"] == MSG_FIRST
    assert get_ok(env, sid)["message"] == MSG_FIRST


def test_S06_A1_Q38_자동_뒤_더_고를래_묶음은_round_1이어도_방향_없음_대본(env):
    data = env.start(env.plant_day(city()), mode="auto").json()
    sid = data["session_id"]
    batch = env.back(sid).json()
    assert (batch["round"], batch["message"]) == (1, MSG_NO_DIRECTION)
    assert get_ok(env, sid) == batch


def test_S07_A1_R4_direction_relaxed는_묶음을_만들_때의_값_그대로(env):
    items = cafes(6, crowd=5) + cafes(4, start=7, crowd=1) + cafes(8, start=30, crowd=5)
    sid, _ = env.browse(env.plant_day(as_dict(items)))
    batch = env.next(sid, direction_id="quieter").json()
    assert batch["direction_relaxed"] is True
    assert get_ok(env, sid)["direction_relaxed"] is True
    env.react(sid, ids(batch)[0])
    assert get_ok(env, sid)["direction_relaxed"] is True


@pytest.mark.parametrize(
    ("total", "exhausted"),
    [(10, True), (11, False)],
    ids=["안_보여준_곳_4", "안_보여준_곳_5_경계"],
)
def test_S08_A1_Q37_exhausted는_지금_안_보여준_곳_5_미만인지_다시_계산(env, total, exhausted):
    sid, first = at_browsing(env, city(total))
    assert first["exhausted"] is False
    assert get_ok(env, sid)["exhausted"] is exhausted


@pytest.mark.parametrize(
    ("total", "message"),
    [(10, MSG_EXHAUSTED), (11, MSG_FIRST)],
    ids=["안_보여준_곳_4", "안_보여준_곳_5_경계"],
)
def test_S09_Q2_첫_묶음_뒤_소진이_되면_message도_소진_문장(env, total, message):
    sid, first = at_browsing(env, city(total))
    assert first["message"] == MSG_FIRST
    assert get_ok(env, sid)["message"] == message


@pytest.mark.parametrize(
    ("total", "exhausted", "message"),
    [(16, True, MSG_EXHAUSTED), (17, False, MSG_NO_DIRECTION)],
    ids=["안_보여준_곳_4", "안_보여준_곳_5_경계"],
)
def test_S71_Q2_다음_묶음도_GET에서는_지금_기준으로_다시_계산(env, total, exhausted, message):
    sid, _ = at_browsing(env, city(total))
    response = env.next(sid).json()
    assert response["exhausted"] is False
    data = get_ok(env, sid)
    assert data["exhausted"] is exhausted
    assert data["message"] == message


def test_S72_Q2_방향_묶음이_소진이_되면_방향_문구_대신_소진_문장(env):
    sid, _ = at_browsing(env, city(16))
    response = env.next(sid, direction_id="closer").json()
    assert response["message"] == "숙소랑 가까운 데 쪽으로 다시 찾아봤어!"
    assert get_ok(env, sid)["message"] == MSG_EXHAUSTED


def test_S10_A1_Q31_빈_묶음도_그대로_돌려준다(env):
    sid, _ = at_browsing(env, city(6))
    batch = env.next(sid).json()
    assert batch["candidates"] == []
    data = get_ok(env, sid)
    assert data["candidates"] == []
    assert data["exhausted"] is True
    assert data["message"] == MSG_EXHAUSTED
    assert data["round"] == batch["round"]


def test_S11_A1_되묻기_뒤에도_묶음과_stage는_그대로(env):
    sid, batch = at_browsing(env)
    response = env.next(sid, text=UNKNOWN_TEXT).json()
    assert response["clarify"]
    data = get_ok(env, sid)
    assert_new_batch_shape(data)
    assert ids(data) == ids(batch)
    assert env.values(sid)["clarify_count"] == 1


def test_S12_Q3_되묻기_뒤_GET은_되묻기_응답과_같다(env):
    sid, _ = at_browsing(env)
    response = env.next(sid, text=UNKNOWN_TEXT).json()
    data = get_ok(env, sid)
    assert data == response
    assert data["clarify"]
    assert data["message"] == MSG_CLARIFY


def test_S73_Q3_되묻기_중_담아도_되묻기_칩과_문구가_나오고_담은_곳이_새로_계산(env):
    sid, batch = at_browsing(env)
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.react(sid, ids(batch)[0]).status_code == 200
    data = get_ok(env, sid)
    assert data["message"] == MSG_CLARIFY
    assert data["clarify"]
    assert data["picks"] == [ids(batch)[0]]
    assert data["picks_count"] == 1


def test_S74_Q3_Q6_되묻기와_소진이_겹치면_GET도_되묻기_문장_exhausted는_true(env):
    sid, _ = at_browsing(env, city(10))
    env.next(sid, text=UNKNOWN_TEXT)
    data = get_ok(env, sid)
    assert data["message"] == MSG_CLARIFY
    assert data["exhausted"] is True
    assert data["clarify"]


@pytest.mark.parametrize("step", ["둘째_못알아들음", "방향", "빈_next"])
def test_S75_Q3_되묻기가_끝나면_GET의_clarify는_null(env, step):
    sid, _ = at_browsing(env)
    env.next(sid, text=UNKNOWN_TEXT)
    body = {"둘째_못알아들음": {"text": UNKNOWN_TEXT}, "방향": {"direction_id": "closer"}, "빈_next": {}}[step]
    response = env.next(sid, **body).json()
    assert response["clarify"] is None
    data = get_ok(env, sid)
    assert data["clarify"] is None
    assert data["message"] != MSG_CLARIFY
    assert env.values(sid)["clarify_count"] == 0


def test_S13_A1_composing이면_지금_option_ids의_코스안을_ID까지_같게(env):
    sid, course = at_composing(env)
    data = get_ok(env, sid)
    assert_new_course_shape(data)
    assert data == course
    assert [o["option_id"] for o in data["options"]] == env.values(sid)["option_ids"]


def test_S14_A1_조정_뒤에는_새_코스안을_준다_옛_ID_없음(env):
    sid, course = at_composing(env)
    adjusted = env.adjust(sid, first_option_id(course), "P01", 15).json()
    data = get_ok(env, sid)
    assert data == adjusted
    assert first_option_id(course) not in [o["option_id"] for o in data["options"]]


def test_S15_A1_두_안이면_두_안_모두(env):
    places = as_dict(cafes(8, stay=StayRange(min=30, typical=60, max=90)))
    sid, course = at_composing(env, places)
    assert len(course["options"]) == 2
    assert get_ok(env, sid) == course


def test_S16_A1_자동_시작한_세션도_composing으로_다시_준다(env):
    day_id = env.plant_day(city())
    started = env.start(day_id, mode="auto").json()
    assert get_ok(env, started["session_id"]) == started


def test_S17_A1_첫_질문의_알아서_짜_줘_뒤에도_composing으로_다시_준다(env):
    sid, _ = at_asking(env)
    response = env.client.post(f"/planning/{sid}/answer", json={"auto": True})
    assert response.status_code == 200, response.text
    assert get_ok(env, sid) == response.json()


def test_S18_A1_done이면_day_id_option_id_stage_세_키만(env):
    sid, expected = at_done(env)
    data = get_ok(env, sid)
    assert set(data) == DONE_KEYS
    assert data == expected


def test_S19_A1_done의_option_id는_실제로_고른_안(env):
    places = as_dict(cafes(8, stay=StayRange(min=30, typical=60, max=90)))
    day_id = env.plant_day(places)
    sid, course = env.composing(day_id, likes=("P01", "P02", "P03"))
    second = course["options"][1]["option_id"]
    assert env.select(second).status_code == 200
    assert get_ok(env, sid) == {"day_id": day_id, "option_id": second, "stage": "done"}


# ---------- A1: 바뀌지 않음, 되풀이, 404 ----------


@pytest.mark.parametrize("arrive", STAGE_PARAMS)
def test_S20_A1_AC2_GET은_상태_저장소_체크포인트를_바꾸지_않는다(env, arrive):
    sid, _ = arrive(env)
    before = frozen(env, sid)
    assert get(env, sid).status_code == 200
    assert frozen(env, sid) == before


@pytest.mark.parametrize("arrive", STAGE_PARAMS)
def test_S21_A1_AC2_세_번_연속_불러도_응답이_같고_아무것도_안_바뀐다(env, arrive):
    sid, _ = arrive(env)
    before = frozen(env, sid)
    first = get_ok(env, sid)
    assert get_ok(env, sid) == first
    assert get_ok(env, sid) == first
    assert frozen(env, sid) == before


def test_S22_A1_되묻기_횟수와_해석_기록도_GET으로_늘지_않는다(env):
    sid, _ = at_browsing(env)
    env.next(sid, text=UNKNOWN_TEXT)
    before = frozen(env, sid)
    logs = env.repo.decision_logs()
    assert get(env, sid).status_code == 200
    assert frozen(env, sid) == before
    assert env.repo.decision_logs() == logs


def test_S23_A1_GET_뒤에도_멈춘_자리에서_그대로_이어_간다(env):
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    get_ok(env, sid)
    batch = env.answer(session).json()
    assert env.stage(sid) == "browsing"
    get_ok(env, sid)
    assert env.react(sid, ids(batch)[0]).status_code == 200
    get_ok(env, sid)
    course = env.compose(sid).json()
    assert env.stage(sid) == "composing"
    get_ok(env, sid)
    assert env.select(first_option_id(course)).status_code == 200
    assert env.stage(sid) == "done"
    assert get_ok(env, sid)["stage"] == "done"


def test_S24_A1_없는_세션이면_404_공통_형식(env):
    assert_error(get(env, "없는-세션"), 404, "NOT_FOUND")


@given(session_id=st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-", min_size=1, max_size=40))
@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_S25_A1_어떤_없는_세션_ID도_404이고_저장소가_그대로(env, session_id):
    before = env.repo.snapshot()
    assert_error(get(env, session_id), 404, "NOT_FOUND")
    assert env.repo.snapshot() == before


def test_S26_R14_GET만_열고_다른_메서드는_405_공통_형식(env):
    sid, _ = at_browsing(env)
    assert_error(env.client.post(f"/planning/{sid}"), 405)
    assert_error(env.client.delete(f"/planning/{sid}"), 405)


def test_S27_세션끼리_섞이지_않는다(env):
    a, batch_a = at_browsing(env)
    b, batch_b = at_browsing(env)
    env.react(a, "P01")
    assert get_ok(env, a)["picks_count"] == 1
    assert get_ok(env, b) == batch_b
    assert batch_a["session_id"] != batch_b["session_id"]


# ---------- 원칙 1: 실패한 요청 뒤의 GET ----------


def closed_monday_city():
    closed = place("P20", hours=opening("10:00", "18:00", weekday=1), stay=FIXED_STAY)
    return as_dict([*cafes(19), closed])


def test_S28_원칙1_compose_422_뒤_GET은_요청_전_묶음과_같다(env):
    sid, _ = at_browsing(env, closed_monday_city(), day_plan(must=("P20",)))
    env.react(sid, "P01")
    before_get = get_ok(env, sid)
    assert_error(env.compose(sid), 422, "COURSE_INFEASIBLE")
    assert get_ok(env, sid) == before_get
    assert env.stage(sid) == "browsing"


def test_S29_원칙1_adjust_422_뒤_GET은_같은_ID와_머문_시간(env):
    places = as_dict([*cafes(6), place("P20", hours=week_hours("09:00", "10:00"), stay=FIXED_STAY)])
    sid, course = env.composing(env.plant_day(places, day_plan(must=("P20",))))
    assert_error(env.adjust(sid, first_option_id(course), "P20", 15), 422)
    assert get_ok(env, sid) == course


def test_S30_원칙1_자동_답_422_뒤_GET은_첫_질문_그대로(env):
    sid, session = at_asking(env, closed_monday_city(), day_plan(must=("P20",)))
    assert_error(env.client.post(f"/planning/{sid}/answer", json={"auto": True}), 422)
    assert get_ok(env, sid) == session


def test_S31_원칙1_409_뒤_GET은_지금_stage를_준다(env):
    """TASK-004 §7의 409 복구가 쓰는 길."""
    sid, session = at_asking(env)
    assert_error(env.compose(sid), 409, "STATE_CONFLICT")
    assert get_ok(env, sid) == session


def test_S32_원칙1_400_뒤_GET은_요청_전과_같다(env):
    sid, batch = at_browsing(env)
    assert_error(env.next(sid, direction_id="sunny"), 400)
    assert_error(env.react(sid, "없는장소"), 400)
    assert get_ok(env, sid) == batch


@pytest.mark.parametrize(
    ("target", "send"),
    [
        ("graphs.planning.next_batch", lambda env, sid: env.next(sid)),
        (BATCH_BUILDER, lambda env, sid: env.next(sid)),
        ("graphs.planning.compose_courses", lambda env, sid: env.compose(sid)),
        (COURSE_BUILDER, lambda env, sid: env.compose(sid)),
    ],
    ids=["next_계산", "next_응답", "compose_계산", "compose_응답"],
)
def test_S33_R1_R12_POST가_500이어도_GET은_요청_전과_같다(quiet_env, monkeypatch, target, send):
    env = quiet_env
    sid, _ = at_browsing(env)
    env.react(sid, "P01")
    before_get = get_ok(env, sid)
    with monkeypatch.context() as patch:
        patch.setattr(target, raise_forced)
        assert_error(send(env, sid), 500, "INTERNAL_ERROR")
    assert get_ok(env, sid) == before_get


def test_S34_R1_adjust가_500이어도_GET은_같은_ID(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = at_composing(env)
    with monkeypatch.context() as patch:
        patch.setattr("graphs.planning.compose_courses", raise_forced)
        assert_error(env.adjust(sid, first_option_id(course), "P01", 15), 500)
    assert get_ok(env, sid) == course


# ---------- R11: GET 자신의 응답 단계 예외 ----------


GET_FAULTS = [
    pytest.param(at_asking, DAY_LOOKUP, id="asking_하루_찾기"),
    pytest.param(at_browsing, DAY_LOOKUP, id="browsing_하루_찾기"),
    pytest.param(at_browsing, BATCH_BUILDER, id="browsing_응답_만들기"),
    pytest.param(at_composing, DAY_LOOKUP, id="composing_하루_찾기"),
    pytest.param(at_composing, COURSE_BUILDER, id="composing_응답_만들기"),
    pytest.param(at_done, CHOSEN_LOOKUP, id="done_고른_안_찾기"),
]


@pytest.mark.parametrize(("arrive", "target"), GET_FAULTS)
def test_S35_R11_GET_응답_단계_예외는_500_공통_형식이고_아무것도_안_바뀐다(quiet_env, monkeypatch, arrive, target):
    env = quiet_env
    sid, _ = arrive(env)
    before = frozen(env, sid)
    with monkeypatch.context() as patch:
        patch.setattr(target, raise_forced)
        error = assert_error(get(env, sid), 500, "INTERNAL_ERROR")
    assert "테스트가 강제한 예외" not in error["message"]
    assert frozen(env, sid) == before


@pytest.mark.parametrize(("arrive", "target"), GET_FAULTS)
def test_S36_R1_GET_예외_뒤_같은_GET을_다시_보내면_정상(quiet_env, monkeypatch, arrive, target):
    env = quiet_env
    sid, _ = arrive(env)
    expected = get_ok(env, sid)
    with monkeypatch.context() as patch:
        patch.setattr(target, raise_forced)
        assert_error(get(env, sid), 500)
    assert get_ok(env, sid) == expected


def test_S37_R1_browsing_GET_예외_뒤_like와_compose가_정상(quiet_env, monkeypatch):
    env = quiet_env
    sid, _ = at_browsing(env)
    with monkeypatch.context() as patch:
        patch.setattr(BATCH_BUILDER, raise_forced)
        assert_error(get(env, sid), 500)
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}
    assert env.compose(sid).status_code == 200
    assert env.stage(sid) == "composing"


def test_S38_R1_asking_GET_예외_뒤_답이_정상(quiet_env, monkeypatch):
    env = quiet_env
    sid, session = at_asking(env)
    with monkeypatch.context() as patch:
        patch.setattr(DAY_LOOKUP, raise_forced)
        assert_error(get(env, sid), 500)
    assert env.answer(session).status_code == 200
    assert env.stage(sid) == "browsing"


def test_S39_R1_composing_GET_예외_뒤_고르기가_정상(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = at_composing(env)
    with monkeypatch.context() as patch:
        patch.setattr(COURSE_BUILDER, raise_forced)
        assert_error(get(env, sid), 500)
    assert env.select(first_option_id(course)).status_code == 200
    assert env.stage(sid) == "done"


# ---------- A2: day 요약 ----------


def full_plan() -> tuple[dict, object]:
    places = city(60)
    plan = day_plan(
        must=("P50", "P51"),
        fixed=(fixed_event("15:00", "16:00", places["P40"]),),
    )
    return places, plan


def success_responses(env, day_id: str):
    """day가 있어야 하는 성공 응답을 모두 지나간다. (이름, 응답 JSON)."""
    results = []

    def record(name, response, status=200):
        assert response.status_code == status, f"{name}: {response.text}"
        results.append((name, response.json()))
        return response.json()

    session = record("시작", env.start(day_id), 201)
    sid = session["session_id"]
    record("GET_asking", get(env, sid))
    first = record("첫_답", env.answer(session))
    record("GET_첫_묶음", get(env, sid))
    env.react(sid, ids(first)[0])
    record("GET_반응_뒤", get(env, sid))
    record("되묻기", env.next(sid, text=UNKNOWN_TEXT))
    record("두번째_못알아들음", env.next(sid, text=UNKNOWN_TEXT))
    record("방향", env.next(sid, direction_id="closer"))
    record("글_방향", env.next(sid, text="밤에"))
    record("빈_next", env.next(sid))
    course = record("코스", env.compose(sid))
    record("GET_코스", get(env, sid))
    in_course = next(i["place_id"] for i in course["options"][0]["items"] if not i["is_fixed"])
    record("조정", env.adjust(sid, first_option_id(course), in_course, 15))
    record("더_고를래", env.back(sid))
    record("다시_코스", env.compose(sid))
    return results


FLOW_NAMES = [
    "시작",
    "GET_asking",
    "첫_답",
    "GET_첫_묶음",
    "GET_반응_뒤",
    "되묻기",
    "두번째_못알아들음",
    "방향",
    "글_방향",
    "빈_next",
    "코스",
    "GET_코스",
    "조정",
    "더_고를래",
    "다시_코스",
]


def test_S40_A2_AC3_성공_응답_15종_모두_day가_저장소_값과_같다_심어둔_하루(env):
    places, plan = full_plan()
    day_id = env.plant_day(places, plan, day_number=4)
    results = success_responses(env, day_id)
    assert [name for name, _ in results] == FLOW_NAMES
    expected = expected_day(env, day_id)
    for name, body in results:
        assert body["day"] == expected, name
        SHAPES[body["stage"]](body)


def test_S41_A2_AC3_성공_응답_15종_모두_day가_저장소_값과_같다_가상_도시_둘째_날(env):
    day_id = env.seed()["day_ids"][1]
    results = success_responses(env, day_id)
    expected = expected_day(env, day_id)
    d01 = env.repo.get_day(day_id).places["D01"]
    assert expected["must_visits"] == [{"place_id": "D01", "name": d01.name, "stay_min": must_stay(d01)}]
    assert expected["date"] == "2026-12-02"
    assert (expected["start"], expected["end"], expected["day_number"]) == ("10:00", "20:00", 2)
    assert len(results) == 15
    # TASK-006 §12 R5: 세션에서 ±15로 바꾼 머문 시간도 stay_min에 든다. 조정 뒤 응답 3개만 그 값을 쓴다
    overrides = env.repo.stay_overrides(results[0][1]["session_id"])
    assert "D01" in overrides
    after_adjust = {**expected, "must_visits": [{**expected["must_visits"][0], "stay_min": overrides["D01"]}]}
    for name, body in results:
        assert body["day"] == (after_adjust if name in {"조정", "더_고를래", "다시_코스"} else expected), name


def test_S42_A2_자동_시작_응답에도_day(env):
    places, plan = full_plan()
    day_id = env.plant_day(places, plan)
    response = env.start(day_id, mode="auto")
    assert response.status_code == 201
    assert_new_course_shape(response.json())
    assert response.json()["day"] == expected_day(env, day_id)


def test_S43_A2_자동_뒤_더_고를래_응답에도_day(env):
    day_id = env.plant_day(city())
    sid = env.start(day_id, mode="auto").json()["session_id"]
    data = env.back(sid).json()
    assert_new_batch_shape(data)
    assert data["day"] == expected_day(env, day_id)


def test_S44_A2_첫_질문의_알아서_짜_줘_응답에도_day(env):
    day_id = env.plant_day(city())
    sid = env.session(day_id)["session_id"]
    data = env.client.post(f"/planning/{sid}/answer", json={"auto": True}).json()
    assert_new_course_shape(data)
    assert data["day"] == expected_day(env, day_id)


@pytest.mark.parametrize("arrive", [at_asking, at_browsing, at_composing], ids=["asking", "browsing", "composing"])
def test_S45_A2_꼭_갈_곳_고정_일정이_없으면_빈_목록(env, arrive):
    sid, response = arrive(env)
    for body in (response, get_ok(env, sid)):
        assert body["day"]["must_visits"] == []
        assert body["day"]["fixed"] == []


@pytest.mark.parametrize("arrive", [at_asking, at_browsing, at_composing], ids=["asking", "browsing", "composing"])
def test_S46_A2_꼭_갈_곳이_있으면_순서대로_이름까지(env, arrive):
    places = city(30)
    sid, response = arrive(env, places, day_plan(must=("P21", "P20")))
    expected = [
        {"place_id": "P21", "name": "가상 P21", "stay_min": must_stay(places["P21"])},
        {"place_id": "P20", "name": "가상 P20", "stay_min": must_stay(places["P20"])},
    ]
    for body in (response, get_ok(env, sid)):
        assert body["day"]["must_visits"] == expected
        assert body["day"]["fixed"] == []


def test_S47_A2_장소_있는_고정_일정은_place_id_시각까지(env):
    places = city(30)
    plan = day_plan(fixed=(fixed_event("15:00", "16:00", places["P20"]),))
    sid, session = at_asking(env, places, plan)
    fixed = session["day"]["fixed"]
    assert len(fixed) == 1
    assert set(fixed[0]) == {"place_id", "name", "start", "end"}
    assert (fixed[0]["place_id"], fixed[0]["start"], fixed[0]["end"]) == ("P20", "15:00", "16:00")


def test_S48_A2_장소_없는_고정_일정은_place_id가_null(env):
    plan = day_plan(fixed=(fixed_event("15:00", "16:00"),))
    _, session = at_asking(env, city(), plan)
    fixed = session["day"]["fixed"]
    assert len(fixed) == 1
    assert set(fixed[0]) == {"place_id", "name", "start", "end"}
    assert (fixed[0]["place_id"], fixed[0]["start"], fixed[0]["end"]) == (None, "15:00", "16:00")


@pytest.mark.parametrize(
    ("at_place", "expected"),
    [(True, "가상 P20"), (False, "고정 일정")],
    ids=["장소_있음", "장소_없음"],
)
def test_S49_Q1_day_fixed의_name은_장소_이름_없으면_title(env, at_place, expected):
    places = city(30)
    event = fixed_event("15:00", "16:00", places["P20"] if at_place else None)
    sid, session = at_asking(env, places, day_plan(fixed=(event,)))
    for body in (session, get_ok(env, sid)):
        assert body["day"]["fixed"][0]["name"] == expected


@pytest.mark.parametrize("number", [1, 2, 3, 6, 10], ids=str)
def test_S50_A2_day_number는_저장소_값_그대로(env, number):
    day_id = env.plant_day(city(), day_number=number)
    session = env.session(day_id)
    assert session["day"]["day_number"] == number
    assert get_ok(env, session["session_id"])["day"]["day_number"] == number


def test_S51_A2_날짜_시각_숙소는_저장소_값_그대로_기본값이_아니다(env):
    plan = day_plan(start="07:30", end="23:15", day=date(2027, 1, 31))
    plan = plan.model_copy(update={"lodging": (34.5, 133.25)})
    _, session = at_asking(env, city(), plan)
    day = session["day"]
    assert day["date"] == "2027-01-31"
    assert (day["start"], day["end"]) == ("07:30", "23:15")
    assert day["lodging"] == {"lat": 34.5, "lng": 133.25}


def test_S52_A2_같은_여행의_세_날은_자기_날짜와_번호(env):
    day_ids = env.seed()["day_ids"]
    days = [env.session(d)["day"] for d in day_ids]
    assert [d["day_id"] for d in days] == day_ids
    assert [d["day_number"] for d in days] == [1, 2, 3]
    assert [d["date"] for d in days] == ["2026-12-01", "2026-12-02", "2026-12-03"]
    assert [len(d["must_visits"]) for d in days] == [0, 1, 0]


def test_S53_A2_반응과_고르기_응답은_day를_넣지_않는다(env):
    """A2는 세 모델만 적었다. TASK-003 §5·§6의 Picks와 select 응답은 그대로."""
    day_id = env.plant_day(city())
    sid, _ = env.browse(day_id)
    assert set(env.react(sid, "P01").json()) == PICKS_KEYS
    course = env.compose(sid).json()
    option_id = first_option_id(course)
    assert env.select(option_id).json() == {"day_id": day_id, "option_id": option_id}


# ---------- A3: CourseItem·Dropped의 name ----------


def test_S54_A3_AC3_코스_항목_name은_장소_이름_모든_항목_모든_안(env):
    places = as_dict(cafes(8, stay=StayRange(min=30, typical=60, max=90)))
    sid, course = at_composing(env, places)
    assert len(course["options"]) == 2
    for body in (course, get_ok(env, sid)):
        for option in body["options"]:
            assert option["items"]
            for item in option["items"]:
                assert item["name"] == f"가상 {item['place_id']}"


def test_S55_A3_조정_자동_다시_짜기_응답에도_name(env):
    sid, course = at_composing(env)
    adjusted = env.adjust(sid, first_option_id(course), "P01", 15).json()
    assert_new_course_shape(adjusted)
    env.back(sid)
    again = env.compose(sid).json()
    assert_new_course_shape(again)
    auto = env.start(env.plant_day(city()), mode="auto").json()
    assert_new_course_shape(auto)
    for body in (adjusted, again, auto):
        for item in body["options"][0]["items"]:
            assert item["name"] == f"가상 {item['place_id']}"


def test_S56_A3_장소_있는_고정_일정_항목_name은_장소_이름(env):
    places = city(30)
    plan = day_plan(fixed=(fixed_event("15:00", "16:00", places["P20"]),))
    _, course = at_composing(env, places, plan)
    fixed = next(i for i in course["options"][0]["items"] if i["is_fixed"])
    assert fixed["place_id"] == "P20"
    assert fixed["name"] == "가상 P20"  # 일정 제목("고정 일정")이 아니라 장소 이름 (Q1)


def test_S57_A3_장소_없는_고정_일정_항목에도_name_키가_있다(env):
    _, course = at_composing(env, city(), day_plan(fixed=(fixed_event("15:00", "16:00"),)))
    item = next(i for i in course["options"][0]["items"] if i["is_fixed"])
    assert item["place_id"] is None
    assert "name" in item


def test_S58_Q1_장소_없는_고정_일정_항목의_name은_저장된_title(env):
    sid, course = at_composing(env, city(), day_plan(fixed=(fixed_event("15:00", "16:00"),)))
    for body in (course, get_ok(env, sid)):
        item = next(i for i in body["options"][0]["items"] if i["is_fixed"])
        assert item["name"] == "고정 일정"


DROPPED_CASES = [
    pytest.param("15:29", "closed_at_time", id="closed_at_time"),
    pytest.param("16:00", "fixed_conflict", id="fixed_conflict"),
]


@pytest.mark.parametrize(("close_at", "reason"), DROPPED_CASES)
def test_S59_A3_AC3_빠진_곳_name_이유별(env, close_at, reason):
    target = place("P02", hours=opening("15:00", close_at))
    places = as_dict([*cafes(1), target, *cafes(6, start=3)])
    plan = day_plan(fixed=(fixed_event("15:00", "16:00"),))
    sid, course = at_composing(env, places, plan)
    for body in (course, get_ok(env, sid)):
        entry = next(d for d in body["options"][0]["dropped"] if d["place_id"] == "P02")
        assert entry == {"place_id": "P02", "reason": reason, "name": "가상 P02"}


def test_S60_A3_AC3_빠진_곳_name_시간이_모자람(env):
    # 60분 2곳: 쉬는 15분이면 135분이라 하루 130분에 안 들어간다 (기존 F63과 같은 하루)
    plan = day_plan(start="09:00", end="11:10")
    sid, course = at_composing(env, city(), plan)
    relaxed = next(o for o in course["options"] if o["label"] == "relaxed")
    assert len(relaxed["dropped"]) == 1
    entry = relaxed["dropped"][0]
    assert entry["reason"] == "no_time"
    assert entry["name"] == f"가상 {entry['place_id']}"


# ---------- A4: /debug/compose 본문 오류 ----------

VALID_SNAPSHOT = {"now": "12:00"}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"now": "시각이_아님"},
        {"now": 12345678901234567890},
        {"now": "12:00", "offline": "아마도"},
        {"now": "12:00", "open_events": "목록이_아님"},
        {"now": "12:00", "rain_prob_2h": "많이"},
        [],
        "글",
    ],
    ids=["빈_본문", "시각_아님", "시각이_큰_숫자", "참거짓_아님", "목록_아님", "숫자_아님", "배열", "글"],
)
def test_S61_A4_본문이_잘못되면_400_INVALID_REQUEST_공통_형식(env, body):
    assert_error(env.client.post("/debug/compose", json=body), 400, "INVALID_REQUEST")


def test_S62_A4_JSON이_아니어도_400_공통_형식(env):
    response = env.client.post("/debug/compose", content=b"{not json", headers={"content-type": "application/json"})
    assert_error(response, 400, "INVALID_REQUEST")


def test_S63_A4_본문이_아예_없어도_400_공통_형식(env):
    assert_error(env.client.post("/debug/compose"), 400, "INVALID_REQUEST")


def test_S64_A4_맞는_본문은_그대로_200(env):
    response = env.client.post("/debug/compose", json=VALID_SNAPSHOT)
    assert response.status_code == 200, response.text
    assert "error" not in response.json()


# ---------- A5: 타입 재생성 ----------


def committed_openapi() -> dict:
    return json.loads((API_TYPES / "openapi.json").read_text(encoding="utf-8"))


def resolve(spec: dict, schema: dict) -> dict:
    while "$ref" in schema:
        schema = spec["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def test_S65_A5_openapi에_GET_planning(env):
    spec = committed_openapi()
    operation = spec["paths"]["/planning/{session_id}"]["get"]
    assert {"200", "404"} <= set(operation["responses"])


def test_S66_A5_GET의_200은_4가지_모양이다():
    spec = committed_openapi()
    schema = spec["paths"]["/planning/{session_id}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    branches = [resolve(spec, s) for s in schema["anyOf"]]
    assert len(branches) == 4
    keys = {frozenset(b["properties"]) for b in branches}
    assert frozenset(SESSION_KEYS) in keys
    assert frozenset(BATCH_KEYS) in keys
    assert frozenset(COURSE_KEYS) in keys
    assert frozenset(DONE_KEYS) in keys


@pytest.mark.parametrize("name", ["PlanningSession", "CandidateBatch", "CourseResult"])
def test_S67_A5_세_모델의_day가_요약_8개_필드(name):
    spec = committed_openapi()
    schema = spec["components"]["schemas"][name]
    assert "day" in schema["required"]
    day = resolve(spec, schema["properties"]["day"])
    assert set(day["properties"]) == DAY_KEYS
    assert set(resolve(spec, day["properties"]["lodging"])["properties"]) == {"lat", "lng"}
    must = resolve(spec, day["properties"]["must_visits"]["items"])
    assert set(must["properties"]) == {"place_id", "name", "stay_min"}
    fixed = resolve(spec, day["properties"]["fixed"]["items"])
    assert set(fixed["properties"]) == {"place_id", "name", "start", "end"}


def course_part(spec: dict, field: str) -> tuple[str, dict]:
    """모델 이름은 정해져 있지 않아 CourseResult에서 찾아 들어간다. (모델 이름, 스키마)."""
    course = resolve(spec, spec["components"]["schemas"]["CourseResult"])
    option = resolve(spec, course["properties"]["options"]["items"])
    ref = option["properties"][field]["items"]["$ref"]
    return ref.rsplit("/", 1)[-1], resolve(spec, {"$ref": ref})


@pytest.mark.parametrize(("field", "keys"), [("items", ITEM_KEYS), ("dropped", {"place_id", "reason", "name"})])
def test_S68_A5_코스_항목과_빠진_곳에_name(field, keys):
    _, schema = course_part(committed_openapi(), field)
    assert set(schema["properties"]) == keys


def test_S69_A5_ts_타입에도_같은_내용():
    source = (API_TYPES / "index.ts").read_text(encoding="utf-8")
    assert '"/planning/{session_id}": {' in source
    assert "must_visits:" in source
    assert "day_number:" in source
    block = source.split("CandidateBatch: {", 1)[1].split("};", 1)[0]
    assert "picks:" in block
    spec = committed_openapi()
    for field in ("items", "dropped"):
        name, _ = course_part(spec, field)
        block = source.split(f"{name}: {{", 1)[1].split("};", 1)[0]
        assert "name:" in block


def test_S70_A5_커밋한_명세가_지금_서버와_같다_GET_포함():
    from api.main import app

    assert committed_openapi() == app.openapi()
    assert "get" in app.openapi()["paths"]["/planning/{session_id}"]


# ---------- A6 (Q7): CandidateBatch의 picks ----------


def test_S76_A6_첫_묶음의_picks는_빈_목록(env):
    sid, batch = at_browsing(env)
    assert batch["picks"] == []
    assert get_ok(env, sid)["picks"] == []


def test_S77_A6_GET의_picks는_담은_순서(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P03")
    env.react(sid, "P01")
    env.react(sid, "P02")
    data = get_ok(env, sid)
    assert data["picks"] == ["P03", "P01", "P02"]
    assert data["picks_count"] == 3


def test_S78_A6_취소하면_빠지고_다시_담으면_맨_뒤(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P03")
    env.react(sid, "P01")
    env.react(sid, "P03", "unlike")
    assert get_ok(env, sid)["picks"] == ["P01"]
    env.react(sid, "P03")
    assert get_ok(env, sid)["picks"] == ["P01", "P03"]


def test_S79_A6_담은_곳을_넘기면_빠진다(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P01")
    env.react(sid, "P02")
    env.react(sid, "P01", "skip")
    data = get_ok(env, sid)
    assert data["picks"] == ["P02"]
    assert data["picks_count"] == 1


def test_S80_A6_POST_next는_이전_묶음에서_담은_곳까지(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P02")
    env.react(sid, "P01")
    data = env.next(sid).json()
    assert data["picks"] == ["P02", "P01"]
    assert get_ok(env, sid)["picks"] == ["P02", "P01"]


def test_S81_A6_POST_되묻기_응답에도_picks(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P01")
    assert env.next(sid, text=UNKNOWN_TEXT).json()["picks"] == ["P01"]


def test_S82_A6_POST_더_고를래_응답에도_picks_코스를_거쳐도_유지(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P02")
    env.react(sid, "P01")
    env.compose(sid)
    data = env.back(sid).json()
    assert data["picks"] == ["P02", "P01"]
    assert get_ok(env, sid)["picks"] == ["P02", "P01"]


def test_S83_A6_자동_뒤_더_고를래는_빈_목록(env):
    sid = env.start(env.plant_day(city()), mode="auto").json()["session_id"]
    assert env.back(sid).json()["picks"] == []
    assert get_ok(env, sid)["picks"] == []


def test_S84_A6_picks는_Picks_응답과_같다(env):
    sid, _ = at_browsing(env)
    env.react(sid, "P04")
    picks = env.react(sid, "P02").json()
    data = get_ok(env, sid)
    assert data["picks"] == picks["picks"]
    assert data["picks_count"] == picks["picks_count"]


def test_S85_A6_실패한_요청은_picks를_바꾸지_않는다(quiet_env, monkeypatch):
    env = quiet_env
    sid, _ = at_browsing(env)
    env.react(sid, "P01")
    with monkeypatch.context() as patch:
        patch.setattr("graphs.planning.next_batch", raise_forced)
        assert_error(env.next(sid), 500)
    assert_error(env.react(sid, "없는장소"), 400)
    assert get_ok(env, sid)["picks"] == ["P01"]


def test_S86_A6_A5_명세의_CandidateBatch에_picks(env):
    schema = committed_openapi()["components"]["schemas"]["CandidateBatch"]
    assert "picks" in schema["required"]
    assert schema["properties"]["picks"]["type"] == "array"


# ---------- A7 (Q21): 404 detail.resource ----------


def resource_of(response) -> str:
    return assert_error(response, 404, "NOT_FOUND")["detail"]["resource"]


SESSION_REQUESTS = [
    pytest.param("get", "", None, id="GET"),
    pytest.param("post", "/answer", {"choice_ids": []}, id="answer"),
    pytest.param("post", "/reactions", {"place_id": "P01", "action": "like"}, id="reactions"),
    pytest.param("post", "/next", {}, id="next"),
    pytest.param("post", "/compose", None, id="compose"),
    pytest.param("post", "/adjust", {"option_id": "없는-코스안", "place_id": "P01", "delta": 15}, id="adjust"),
    pytest.param("post", "/back", None, id="back"),
]


@pytest.mark.parametrize(("method", "tail", "body"), SESSION_REQUESTS)
def test_S87_A7_없는_세션이면_session(env, method, tail, body):
    kw = {} if body is None else {"json": body}
    assert resource_of(getattr(env.client, method)(f"/planning/없는-세션{tail}", **kw)) == "session"


def test_S88_A7_없는_코스안_고르기는_option(env):
    assert resource_of(env.select("없는-코스안")) == "option"


def test_S89_A7_세션은_있는데_없는_코스안_조정은_option(env):
    sid, _ = at_composing(env)
    assert resource_of(env.adjust(sid, "없는-코스안", "P01", 15)) == "option"


def test_S90_A7_옛_코스안_조정과_고르기는_option_세션은_살아_있다(env):
    sid, course = at_composing(env)
    old = first_option_id(course)
    assert env.adjust(sid, old, "P01", 15).status_code == 200
    assert resource_of(env.adjust(sid, old, "P01", 15)) == "option"
    assert resource_of(env.select(old)) == "option"
    assert get(env, sid).status_code == 200


def test_S91_A7_더_고를래_뒤_옛_코스안은_option(env):
    sid, course = at_composing(env)
    old = first_option_id(course)
    env.back(sid)
    assert resource_of(env.adjust(sid, old, "P01", 15)) == "option"
    assert resource_of(env.select(old)) == "option"


def test_S92_A7_다른_세션의_코스안_조정은_option(env):
    a, _ = at_composing(env)
    _, course_b = at_composing(env)
    assert resource_of(env.adjust(a, first_option_id(course_b), "P01", 15)) == "option"


def test_S93_A7_없는_날이면_day(env):
    assert resource_of(env.start("없는-날")) == "day"


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/없는-경로"), ("post", "/없는-경로"), ("post", "/planning"), ("get", "/days/없는-날/없는-경로")],
    ids=["GET_없는_경로", "POST_없는_경로", "세션_없는_planning", "없는_하위_경로"],
)
def test_S94_A7_없는_경로면_route(env, method, path):
    assert resource_of(getattr(env.client, method)(path)) == "route"


def test_S95_A7_운영의_시드_경로도_route(monkeypatch):
    import importlib

    import api.main

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.setenv("APP_ENV", "production")
    try:
        with TestClient(importlib.reload(api.main).app) as client:
            assert resource_of(client.post("/debug/seed-demo")) == "route"
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)


def test_S96_A7_Q40_세션도_코스안도_없으면_세션이_먼저(env):
    assert resource_of(env.adjust("없는-세션", "없는-코스안", "P01", 15)) == "session"


def test_S97_A7_404는_아무것도_바꾸지_않는다(env):
    sid, course = at_composing(env)
    env.adjust(sid, first_option_id(course), "P01", 15)
    before = frozen(env, sid)
    assert resource_of(env.select(first_option_id(course))) == "option"
    assert frozen(env, sid) == before


# ---------- A8 (§13-1): CourseItem의 lat, lng ----------


def scattered():
    """숙소(BASE)와 항목들이 일렬이 아닌 도시. 좌표가 전부 다르다."""
    return as_dict(
        [
            place("P01", km=0.3, east_km=-0.2, hours=week_hours(), stay=FIXED_STAY),
            place("P02", km=0.1, east_km=0.4, hours=week_hours(), stay=FIXED_STAY),
            *[place(f"P{i:02d}", km=0.05 * i, east_km=0.03 * i, hours=week_hours(), stay=FIXED_STAY) for i in range(3, 12)],
        ]
    )


def all_items(body: dict) -> list[dict]:
    return [item for option in body["options"] for item in option["items"]]


def test_S98_A8_코스_항목_lat_lng는_장소_좌표_POST와_GET_모든_안(env):
    places = scattered()
    sid, course = at_composing(env, places)
    for body in (course, get_ok(env, sid)):
        assert all_items(body)
        for item in all_items(body):
            assert type(item["lat"]) is float and type(item["lng"]) is float
            assert (item["lat"], item["lng"]) == (places[item["place_id"]].lat, places[item["place_id"]].lng)


def test_S99_A8_항목마다_좌표가_달라_숙소와_일렬이_아니다(env):
    places = scattered()
    sid, course = at_composing(env, places)
    for body in (course, get_ok(env, sid)):
        lodging = body["day"]["lodging"]
        home = (lodging["lat"], lodging["lng"])
        items = {i["place_id"]: (i["lat"], i["lng"]) for i in body["options"][0]["items"]}
        first, second = items["P01"], items["P02"]
        assert first != second
        cross = (first[0] - home[0]) * (second[1] - home[1]) - (first[1] - home[1]) * (second[0] - home[0])
        assert cross != 0


def test_S100_A8_장소_있는_고정_일정은_장소_좌표(env):
    places = scattered()
    plan = day_plan(fixed=(fixed_event("15:00", "16:00", places["P05"]),))
    sid, course = at_composing(env, places, plan)
    for body in (course, get_ok(env, sid)):
        fixed = next(i for i in body["options"][0]["items"] if i["is_fixed"])
        assert fixed["place_id"] == "P05"
        assert (fixed["lat"], fixed["lng"]) == (places["P05"].lat, places["P05"].lng)


def test_S101_A8_장소_없는_고정_일정은_lat_lng_키가_있고_null(env):
    sid, course = at_composing(env, scattered(), day_plan(fixed=(fixed_event("15:00", "16:00"),)))
    for body in (course, get_ok(env, sid)):
        for option in body["options"]:
            fixed = next(i for i in option["items"] if i["is_fixed"])
            assert fixed["place_id"] is None
            assert "lat" in fixed and "lng" in fixed
            assert fixed["lat"] is None and fixed["lng"] is None


def test_S102_A8_장소_없는_고정_일정과_장소_항목이_한_코스에_섞여도_항목별로_맞다(env):
    places = scattered()
    sid, course = at_composing(env, places, day_plan(fixed=(fixed_event("15:00", "16:00"),)))
    for body in (course, get_ok(env, sid)):
        items = body["options"][0]["items"]
        assert {i["is_fixed"] for i in items} == {True, False}
        for item in items:
            if item["place_id"] is None:
                assert (item["lat"], item["lng"]) == (None, None)
            else:
                assert (item["lat"], item["lng"]) == (places[item["place_id"]].lat, places[item["place_id"]].lng)


def test_S103_A8_조정_다시_짜기_자동_응답에도_좌표(env):
    places = scattered()
    sid, course = at_composing(env, places)
    adjusted = env.adjust(sid, first_option_id(course), "P01", 15).json()
    env.back(sid)
    again = env.compose(sid).json()
    auto = env.start(env.plant_day(places), mode="auto").json()
    session = env.session(env.plant_day(places))
    answered = env.client.post(f"/planning/{session['session_id']}/answer", json={"auto": True}).json()
    for body in (adjusted, again, auto, answered):
        assert all_items(body)
        for item in all_items(body):
            assert (item["lat"], item["lng"]) == (places[item["place_id"]].lat, places[item["place_id"]].lng)


@given(
    spots=st.lists(
        st.tuples(st.floats(min_value=0.05, max_value=2.0), st.floats(min_value=-2.0, max_value=2.0)),
        min_size=2,
        max_size=6,
    )
)
@settings(max_examples=15, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_S104_A8_어떤_좌표든_응답_항목은_그_장소의_좌표와_같다(env, spots):
    places = as_dict(
        [place(f"P{i:02d}", km=km, east_km=east, hours=week_hours(), stay=FIXED_STAY) for i, (km, east) in enumerate(spots, start=1)]
    )
    sid, course = at_composing(env, places)
    for body in (course, get_ok(env, sid)):
        for item in all_items(body):
            assert (item["lat"], item["lng"]) == (places[item["place_id"]].lat, places[item["place_id"]].lng)


def test_S105_A8_명세의_코스_항목_lat_lng는_숫자_또는_null이고_빠지지_않는다():
    spec = committed_openapi()
    _, schema = course_part(spec, "items")
    for field in ("lat", "lng"):
        assert field in schema["required"]
        types = {branch.get("type") for branch in schema["properties"][field]["anyOf"]}
        assert types == {"number", "null"}


def test_S106_A8_ts_타입에도_lat_lng():
    source = (API_TYPES / "index.ts").read_text(encoding="utf-8")
    name, _ = course_part(committed_openapi(), "items")
    block = source.split(f"{name}: {{", 1)[1].split("};", 1)[0]
    assert "lat: number | null" in block
    assert "lng: number | null" in block


def test_S107_A8_빠진_곳에는_좌표를_더하지_않는다(env):
    target = place("P02", hours=opening("15:00", "15:29"))
    places = as_dict([*cafes(1), target, *cafes(6, start=3)])
    _, course = at_composing(env, places, day_plan(fixed=(fixed_event("15:00", "16:00"),)))
    assert course["options"][0]["dropped"]
    for entry in course["options"][0]["dropped"]:
        assert set(entry) == {"place_id", "reason", "name"}


# ---------- §13-3 "서버 정한 것": 고정 일정 title 시각순 짝짓기 ----------


def test_S108_S13_장소_없는_고정_일정이_둘이면_title은_시각순으로_짝짓는다(env):
    early = fixed_event("11:00", "12:00", fid="F1").model_copy(update={"title": "점심 약속"})
    late = fixed_event("15:00", "16:00", fid="F2").model_copy(update={"title": "저녁 약속"})
    sid, course = at_composing(env, city(), day_plan(fixed=(late, early)))  # 저장 순서를 일부러 거꾸로
    for body in (course, get_ok(env, sid)):
        fixed = {i["start"]: i["name"] for i in body["options"][0]["items"] if i["is_fixed"]}
        assert fixed == {"11:00": "점심 약속", "15:00": "저녁 약속"}
