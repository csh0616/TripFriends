"""상태 전이표 줄마다 테스트. 근거: TASK-003 §3, §4 전이표, AC-4 (B14·B15는 §3)."""

import pytest
from planning_api_helpers import (
    LABELS,
    MSG_CLARIFY,
    MSG_FIRST,
    MSG_NO_DIRECTION,
    UNKNOWN_TEXT,
    as_dict,
    assert_batch_shape,
    assert_course_shape,
    assert_picks_shape,
    assert_session_shape,
    at_of,
    cafes,
    course_place_ids,
    dumped,
    ids,
    without_option_id,
)
from planning_helpers import BASE, day_plan
from pydantic import ValidationError

from engine.models import Reactions
from engine.planning import compose_courses, next_batch
from graphs.planning import PlanningState

FIRST_SIX = ["P01", "P02", "P03", "P04", "P05", "P06"]
STATE_FIELDS = {
    "session_id",
    "day_id",
    "mode",
    "stage",
    "round",
    "categories",
    "shown",
    "batch",
    "last_direction",
    "clarify_count",
    "option_ids",
}


def city(count=24):
    return as_dict(cafes(count))


def test_B01_AC04_줄01_시작_대화모드는_첫_질문을_보내고_asking(env):
    response = env.start(env.plant_day(city()))
    assert response.status_code == 201
    data = response.json()
    assert_session_shape(data)
    assert env.stage(data["session_id"]) == "asking"
    values = env.values(data["session_id"])
    assert values["mode"] == "conversation"
    assert values["batch"] == []


def test_B02_AC04_줄02_시작_자동모드는_꼭_갈곳과_6곳으로_코스를_짜고_composing(env):
    places = city()
    plan = day_plan(must=("P20",))
    response = env.start(env.plant_day(places, plan), mode="auto")
    assert response.status_code == 201  # Q1 임시 가정
    data = response.json()
    assert_course_shape(data)
    assert env.stage(data["session_id"]) == "composing"
    assert without_option_id(data) == dumped(compose_courses(plan, FIRST_SIX, places))
    for option in data["options"]:
        assert course_place_ids(option) == {*FIRST_SIX, "P20"}
    assert env.repo.reactions(data["session_id"]) == Reactions(liked=[], skipped=[])


def test_B03_AC04_줄03_asking에서_답하면_첫_묶음과_browsing(env):
    session = env.session(env.plant_day(city()))
    response = env.answer(session, ["카페"])
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    assert ids(data) == FIRST_SIX
    assert data["round"] == 1
    assert data["message"] == MSG_FIRST
    assert env.stage(session["session_id"]) == "browsing"


def test_B04_AC04_줄04_asking에서_알아서_짜줘면_composing(env):
    places = city()
    plan = day_plan(must=("P20",))
    session = env.session(env.plant_day(places, plan))
    sid = session["session_id"]
    response = env.client.post(f"/planning/{sid}/answer", json={"auto": True})
    assert response.status_code == 200
    data = response.json()
    assert_course_shape(data)
    assert env.stage(sid) == "composing"
    assert without_option_id(data) == dumped(compose_courses(plan, FIRST_SIX, places))
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])


@pytest.mark.parametrize(
    ("actions", "liked", "skipped"),
    [
        (["like"], ["P01"], []),
        (["skip"], [], ["P01"]),
        (["like", "unlike"], [], []),
    ],
    ids=["like", "skip", "unlike"],
)
def test_B05_AC04_줄05_반응은_저장소에_반영하고_묶음은_그대로(env, actions, liked, skipped):
    sid, batch = env.browse(env.plant_day(city()))
    before = env.values(sid)
    for action in actions:
        response = env.react(sid, "P01", action)
        assert response.status_code == 200
    assert_picks_shape(response.json())
    assert response.json()["picks"] == liked
    assert env.repo.reactions(sid) == Reactions(liked=liked, skipped=skipped)
    assert env.values(sid)["batch"] == before["batch"] == ids(batch)
    assert env.values(sid)["round"] == before["round"]
    assert env.stage(sid) == "browsing"


def test_B06_AC04_줄06_방향버튼은_skip_기록_후_그_방향으로_다음_묶음(env):
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    assert env.react(sid, "P01").status_code == 200
    response = env.next(sid, direction_id="closer")
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    reactions = Reactions(liked=["P01"], skipped=FIRST_SIX[1:])
    assert env.repo.reactions(sid) == reactions
    assert ids(data) == next_batch(places, reactions, "closer", FIRST_SIX, BASE, at_of(plan)).place_ids
    assert data["round"] == 2
    assert env.values(sid)["last_direction"] == "closer"
    assert env.stage(sid) == "browsing"


def test_B07a_AC04_줄07_글을_알아들으면_방향버튼과_같다(env):
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    response = env.next(sid, text="근처로 가자")  # POC-001 §5-1 "근처" → closer
    assert response.status_code == 200
    data = response.json()
    reactions = Reactions(liked=[], skipped=FIRST_SIX)
    assert env.repo.reactions(sid) == reactions
    assert ids(data) == next_batch(places, reactions, "closer", FIRST_SIX, BASE, at_of(plan)).place_ids
    assert data["clarify"] is None
    assert data["message"] == f"{LABELS['closer']} 쪽으로 다시 찾아봤어!"
    assert env.stage(sid) == "browsing"


def test_B07b_AC04_줄07_글을_못_알아들으면_되묻고_묶음과_반응은_그대로(env):
    sid, batch = env.browse(env.plant_day(city()))
    response = env.next(sid, text=UNKNOWN_TEXT)
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    assert ids(data) == ids(batch)
    assert data["message"] == MSG_CLARIFY
    assert data["clarify"]
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])  # 알아들었을 때만 skip 기록
    assert env.stage(sid) == "browsing"


def test_B08_AC04_줄08_빈_next는_skip_기록_후_방향없이_다음_묶음(env):
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    response = env.next(sid)
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    reactions = Reactions(liked=[], skipped=FIRST_SIX)
    assert env.repo.reactions(sid) == reactions
    assert ids(data) == next_batch(places, reactions, None, FIRST_SIX, BASE, at_of(plan)).place_ids
    assert data["message"] == MSG_NO_DIRECTION
    assert env.values(sid)["round"] == 2
    assert env.stage(sid) == "browsing"


def test_B09_AC04_줄09_코스짜기는_skip_기록_후_담은_곳으로_계산하고_composing(env):
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    for pid in ("P01", "P02"):
        assert env.react(sid, pid).status_code == 200
    response = env.compose(sid)
    assert response.status_code == 200
    data = response.json()
    assert_course_shape(data)
    assert env.repo.reactions(sid) == Reactions(liked=["P01", "P02"], skipped=FIRST_SIX[2:])
    assert without_option_id(data) == dumped(compose_courses(plan, ["P01", "P02"], places))
    assert env.values(sid)["option_ids"] == [o["option_id"] for o in data["options"]]
    assert env.stage(sid) == "composing"


def test_B10_AC04_줄10_시간조정은_다시_계산하고_composing(env):
    places = city()
    plan = day_plan()
    sid, _ = env.composing(env.plant_day(places, plan), likes=("P01", "P02"))
    response = env.adjust(sid, "P01", 15)
    assert response.status_code == 200
    data = response.json()
    assert_course_shape(data)
    changed = day_plan(overrides={"P01": 75})
    assert without_option_id(data) == dumped(compose_courses(changed, ["P01", "P02"], places))
    assert env.stage(sid) == "composing"


def test_B11_AC04_줄11_더_고를래는_방향없이_다음_묶음이고_browsing(env):
    places = city()
    plan = day_plan()
    sid, _ = env.composing(env.plant_day(places, plan), likes=("P01",))
    response = env.back(sid)
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    reactions = Reactions(liked=["P01"], skipped=FIRST_SIX[1:])
    assert ids(data) == next_batch(places, reactions, None, FIRST_SIX, BASE, at_of(plan)).place_ids
    assert data["round"] == 2
    assert data["message"] == MSG_NO_DIRECTION
    assert env.stage(sid) == "browsing"


def test_B12_AC04_줄12_코스안_고르면_저장하고_done(env):
    day_id = env.plant_day(city())
    sid, course = env.composing(day_id, likes=("P01",))
    option_id = course["options"][0]["option_id"]
    response = env.select(option_id)
    assert response.status_code == 200
    assert response.json() == {"day_id": day_id, "option_id": option_id}
    assert env.repo.chosen_option(day_id) == option_id
    assert env.stage(sid) == "done"


def test_B13_AC04_줄13_그_외_조합은_409_대표_경우_전체는_C01(env):
    sid, _ = env.browse(env.plant_day(city()))
    before = env.repo.snapshot()
    response = env.back(sid)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STATE_CONFLICT"
    assert env.stage(sid) == "browsing"
    assert env.repo.snapshot() == before


def test_B14_S3_PlanningState_필드는_문서의_11개뿐():
    assert set(PlanningState.model_fields) == STATE_FIELDS


@pytest.mark.parametrize(
    ("field", "value"),
    [("mode", "manual"), ("stage", "start"), ("last_direction", "sideways")],
    ids=["mode", "stage", "last_direction"],
)
def test_B15_S3_PlanningState_허용값_밖이면_거부(field, value):
    good = dict(
        session_id="s",
        day_id="d",
        mode="conversation",
        stage="asking",
        round=0,
        categories=[],
        shown=[],
        batch=[],
        last_direction=None,
        clarify_count=0,
        option_ids=[],
    )
    PlanningState(**good)
    with pytest.raises(ValidationError):
        PlanningState(**{**good, field: value})


def test_B16_S3_그래프_상태는_보여준_곳과_지금_묶음을_담는다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid)
    values = env.values(sid)
    assert values["session_id"] == sid
    assert values["shown"] == [f"P{i:02d}" for i in range(1, 13)]
    assert values["batch"] == [f"P{i:02d}" for i in range(7, 13)]
    assert set(values) == STATE_FIELDS  # 반응·코스안·선택 결과는 상태에 없음
