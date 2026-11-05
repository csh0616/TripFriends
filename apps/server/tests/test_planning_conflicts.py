"""표에 없는 조합. 근거: TASK-003 §4 마지막 줄, §5, AC-5."""

import pytest
from planning_api_helpers import as_dict, assert_error, cafes, ctx

STAGES = ["asking", "browsing", "composing", "done"]
EVENTS = {
    "answer": lambda env, c: env.client.post(f"/planning/{c.sid}/answer", json={"choice_ids": []}),
    "auto": lambda env, c: env.client.post(f"/planning/{c.sid}/answer", json={"auto": True}),
    "reaction": lambda env, c: env.react(c.sid, "P01"),
    "next_direction": lambda env, c: env.next(c.sid, direction_id="quieter"),
    "next_text": lambda env, c: env.next(c.sid, text="그냥 아무거나"),
    "next_empty": lambda env, c: env.next(c.sid),
    "compose": lambda env, c: env.compose(c.sid),
    "adjust": lambda env, c: env.adjust(c.sid, "P01", 15),
    "back": lambda env, c: env.back(c.sid),
    "select": lambda env, c: env.select(c.option_id),
}
IN_TABLE = {
    ("asking", "answer"),
    ("asking", "auto"),
    ("browsing", "reaction"),
    ("browsing", "next_direction"),
    ("browsing", "next_text"),
    ("browsing", "next_empty"),
    ("browsing", "compose"),
    ("composing", "adjust"),
    ("composing", "back"),
    ("composing", "select"),
}
# 코스안이 만들어지기 전이라 select의 경로에 넣을 option_id가 있을 수 없는 조합 (C03)
UNREACHABLE = {("asking", "select")}
COMBOS = [(s, e) for s in STAGES for e in EVENTS if (s, e) not in IN_TABLE | UNREACHABLE]


def city():
    return as_dict(cafes(24))


def prepare(env, stage: str, event: str = ""):
    """그 stage의 세션을 만든다. browsing×select는 코스안이 있어야 하므로 compose → back으로."""
    day_id = env.plant_day(city())
    if stage == "asking":
        return ctx(sid=env.session(day_id)["session_id"], option_id="없음")
    if stage == "browsing" and event != "select":
        sid, _ = env.browse(day_id)
        return ctx(sid=sid, option_id="없음")
    sid, course = env.composing(day_id, likes=("P01",))
    option_id = course["options"][0]["option_id"]
    if stage == "browsing":
        assert env.back(sid).status_code == 200
    if stage == "done":
        assert env.select(option_id).status_code == 200
    return ctx(sid=sid, option_id=option_id)


def assert_conflict_keeps_everything(env, c, send):
    state_before = env.values(c.sid)
    repo_before = env.repo.snapshot()
    response = send()
    assert_error(response, 409, "STATE_CONFLICT")
    assert env.values(c.sid) == state_before
    assert env.repo.snapshot() == repo_before


def test_C00_AC05_조합_수는_표_밖_30개():
    assert len(COMBOS) + len(UNREACHABLE) == 30


@pytest.mark.parametrize(("stage", "event"), COMBOS, ids=[f"{s}×{e}" for s, e in COMBOS])
def test_C01_AC05_표에_없는_조합은_409이고_stage와_저장소_그대로(env, stage, event):
    c = prepare(env, stage, event)
    assert env.stage(c.sid) == stage
    assert_conflict_keeps_everything(env, c, lambda: EVENTS[event](env, c))
    assert env.stage(c.sid) == stage


AUTO_EVENTS = ["answer", "auto", "reaction", "next_direction", "next_text", "next_empty", "compose"]


@pytest.mark.parametrize("event", AUTO_EVENTS)
def test_C02_AC05_자동모드_composing도_표에_없는_이벤트는_409(env, event):
    response = env.start(env.plant_day(city()), mode="auto")
    assert response.status_code == 201  # Q1 임시 가정
    c = ctx(sid=response.json()["session_id"], option_id="없음")
    assert_conflict_keeps_everything(env, c, lambda: EVENTS[event](env, c))
    assert env.stage(c.sid) == "composing"


def test_C03_AC05_asking에서는_코스안이_없으니_select는_404(env):
    c = prepare(env, "asking")
    repo_before = env.repo.snapshot()
    assert_error(env.select("없는-코스안"), 404)
    assert env.stage(c.sid) == "asking"
    assert env.repo.snapshot() == repo_before


@pytest.mark.parametrize("stage", ["asking", "composing", "done"])
def test_C04_AC05_묶음에_없는_장소라도_지금_단계에서_못하는_반응은_400이_아니라_409(env, stage):
    c = prepare(env, stage)
    assert_conflict_keeps_everything(env, c, lambda: env.react(c.sid, "없는장소"))


@pytest.mark.parametrize("stage", ["asking", "composing", "done"])
def test_C05_AC05_없는_방향이라도_지금_단계에서_못하는_next는_400이_아니라_409(env, stage):
    c = prepare(env, stage)
    assert_conflict_keeps_everything(env, c, lambda: env.next(c.sid, direction_id="sunny"))


def test_C06_AC05_409_뒤에도_표에_있는_이벤트로_그대로_이어진다(env):
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    assert env.react(sid, "P01").status_code == 409
    assert env.answer(session).status_code == 200
    assert env.back(sid).status_code == 409
    assert env.react(sid, "P01").status_code == 200
    assert env.stage(sid) == "browsing"
