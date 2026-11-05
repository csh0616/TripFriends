"""표에 없는 조합. 근거: TASK-003 §4 마지막 줄, §5, AC-5, §10-8 Q40·Q41·Q42."""

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
    "adjust": lambda env, c: env.adjust(c.sid, c.option_id, "P01", 15),
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
# 지금 option_ids에 있는 ID가 있을 수 없어 stage 검사까지 가지 못하고 404가 먼저인 조합
# (§10-8 Q40·Q41, §10-10 R5, C03·C07·C11)
NOT_FOUND_FIRST = {("asking", "select"), ("asking", "adjust"), ("browsing", "adjust"), ("browsing", "select")}
COMBOS = [(s, e) for s in STAGES for e in EVENTS if (s, e) not in IN_TABLE | NOT_FOUND_FIRST]


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
    assert len(COMBOS) + len(NOT_FOUND_FIRST) == 30
    assert len(COMBOS) == 26


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
    assert response.status_code == 201  # §10-2 Q1
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
def test_C05_Q44_없는_방향은_단계가_틀려도_409가_아니라_400(env, stage):
    c = prepare(env, stage)
    state_before = env.values(c.sid)
    repo_before = env.repo.snapshot()
    assert_error(env.next(c.sid, direction_id="sunny"), 400)
    assert env.values(c.sid) == state_before
    assert env.repo.snapshot() == repo_before


def test_C06_AC05_409_뒤에도_표에_있는_이벤트로_그대로_이어진다(env):
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    assert env.react(sid, "P01").status_code == 409
    assert env.answer(session).status_code == 200
    assert env.back(sid).status_code == 409
    assert env.react(sid, "P01").status_code == 200
    assert env.stage(sid) == "browsing"


@pytest.mark.parametrize("stage", ["asking", "browsing"])
def test_C07_Q40_코스안이_없는_단계의_adjust는_409가_아니라_404(env, stage):
    c = prepare(env, stage)
    state_before = env.values(c.sid)
    repo_before = env.repo.snapshot()
    assert_error(env.adjust(c.sid, "없는-코스안", "P01", 15), 404)
    assert env.values(c.sid) == state_before
    assert env.repo.snapshot() == repo_before


def test_C11_R5_더_고를래_뒤_옛_코스안으로_select하면_409가_아니라_404(env):
    c = prepare(env, "browsing", "select")
    state_before = env.values(c.sid)
    repo_before = env.repo.snapshot()
    assert_error(env.select(c.option_id), 404)
    assert env.values(c.sid) == state_before
    assert env.repo.snapshot() == repo_before


BAD_BODIES = [
    pytest.param("asking", "next", {"text": ""}, id="asking_next_빈_글"),
    pytest.param("asking", "next", {"direction_id": "closer", "text": "근처"}, id="asking_next_방향과_글"),
    pytest.param("asking", "reactions", {"action": "like"}, id="asking_반응_place_id_없음"),
    pytest.param("browsing", "answer", {"auto": True, "choice_ids": []}, id="browsing_answer_자동과_칩"),
    pytest.param("browsing", "answer", {"auto": False}, id="browsing_answer_auto_false"),
    pytest.param("browsing", "adjust", {"place_id": "P01", "delta": 15}, id="browsing_adjust_option_id_없음"),
    pytest.param("composing", "next", {"text": "   "}, id="composing_next_공백만"),
    pytest.param("composing", "answer", {"auto": False}, id="composing_answer_auto_false"),
    pytest.param("done", "next", {"text": ""}, id="done_next_빈_글"),
    pytest.param("done", "adjust", {"place_id": "P01", "delta": 15}, id="done_adjust_option_id_없음"),
]


@pytest.mark.parametrize(("stage", "path", "body"), BAD_BODIES)
def test_C08_Q40_틀린_단계에_잘못된_본문이면_409가_아니라_400(env, stage, path, body):
    c = prepare(env, stage)
    state_before = env.values(c.sid)
    repo_before = env.repo.snapshot()
    assert_error(env.client.post(f"/planning/{c.sid}/{path}", json=body), 400)
    assert env.values(c.sid) == state_before
    assert env.repo.snapshot() == repo_before


@pytest.mark.parametrize(
    ("url", "body"),
    [
        ("/days/없는-날/planning", {}),
        ("/planning/없는-세션/answer", {"auto": True, "choice_ids": []}),
        ("/planning/없는-세션/answer", {"auto": False}),
        ("/planning/없는-세션/reactions", {"action": "like"}),
        ("/planning/없는-세션/next", {"text": ""}),
        ("/planning/없는-세션/next", {"direction_id": "closer", "text": "근처"}),
        ("/planning/없는-세션/adjust", {"place_id": "P01", "delta": 15}),
    ],
    ids=["없는_날_mode_없음", "자동과_칩", "auto_false", "place_id_없음", "빈_글", "방향과_글", "option_id_없음"],
)
def test_C09_Q40_없는_세션에_잘못된_본문이면_404가_아니라_400(env, url, body):
    repo_before = env.repo.snapshot()
    assert_error(env.client.post(url, json=body), 400)
    assert env.repo.snapshot() == repo_before


def test_C10_Q40_없는_코스안에_잘못된_본문이면_404가_아니라_400(env):
    c = prepare(env, "composing")
    body = {"option_id": "없는-코스안", "delta": 15}
    assert_error(env.client.post(f"/planning/{c.sid}/adjust", json=body), 400)
