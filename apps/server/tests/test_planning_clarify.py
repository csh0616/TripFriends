"""되묻기와 해석 기록. 근거: TASK-003 §4-3, AC-8, AC-9, TASK-002 §8 Q25."""

import pytest
from planning_api_helpers import (
    LABELS,
    MSG_CLARIFY,
    MSG_NO_DIRECTION,
    UNKNOWN_TEXT,
    as_dict,
    assert_batch_shape,
    at_of,
    cafes,
    ids,
)
from planning_helpers import BASE, day_plan, place

from engine.models import Reactions
from engine.planning import pick_directions

FIRST_SIX = [f"P{i:02d}" for i in range(1, 7)]


def city(count=30):
    return as_dict(cafes(count))


def test_D01_AC08_첫번째_못알아들음은_clarify_채우고_묶음_그대로(env):
    places = city()
    plan = day_plan()
    sid, batch = env.browse(env.plant_day(places, plan))
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert_batch_shape(data)
    assert ids(data) == ids(batch)
    assert data["round"] == batch["round"]
    assert data["message"] == MSG_CLARIFY
    expected = pick_directions(
        [places[p] for p in FIRST_SIX],
        [p for pid, p in places.items() if pid not in FIRST_SIX],
        Reactions(liked=[], skipped=[]),
        places,
        None,
        BASE,
        at_of(plan),
    )
    assert expected  # 이 입력에서 보기가 0개가 아님 (0개는 D03)
    assert data["clarify"] == [{"id": d, "label": LABELS[d]} for d in expected]
    assert env.values(sid)["clarify_count"] == 1
    assert env.values(sid)["batch"] == FIRST_SIX


def test_D02_AC08_두번째_못알아들음은_방향없이_새_묶음(env):
    places = city()
    plan = day_plan()
    sid, batch = env.browse(env.plant_day(places, plan))
    env.next(sid, text=UNKNOWN_TEXT)
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert_batch_shape(data)
    assert data["clarify"] is None
    assert data["message"] == MSG_NO_DIRECTION
    assert data["round"] == batch["round"] + 1
    assert not set(ids(data)) & set(FIRST_SIX)
    assert env.values(sid)["clarify_count"] == 0


def test_D03_S4_3_보기가_0개면_기본_보기_3개(env):
    # 모두 숙소 자리, 붐빔·가격 낮음, 남은 곳 없음 → pick_directions 0개
    places = as_dict([place(f"P{i:02d}", crowd=1, price=1) for i in range(1, 7)])
    plan = day_plan()
    assert (
        pick_directions(
            list(places.values()), [], Reactions(liked=[], skipped=[]), places, None, BASE, at_of(plan)
        )
        == []
    )
    sid, _ = env.browse(env.plant_day(places, plan))
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["clarify"] == [
        {"id": "quieter", "label": LABELS["quieter"]},
        {"id": "food", "label": LABELS["food"]},
        {"id": "night", "label": LABELS["night"]},
    ]


def test_D04_S4_3_보기가_1개면_기본_보기로_늘리지_않는다(env):
    places = as_dict([place(f"P{i:02d}", crowd=3, price=1) for i in range(1, 7)])
    plan = day_plan()
    assert pick_directions(
        list(places.values()), [], Reactions(liked=[], skipped=[]), places, None, BASE, at_of(plan)
    ) == ["quieter"]
    sid, _ = env.browse(env.plant_day(places, plan))
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["clarify"] == [{"id": "quieter", "label": LABELS["quieter"]}]


def test_D05_S4_3_세번째_못알아들음은_다시_되묻는다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid, text=UNKNOWN_TEXT)
    second = env.next(sid, text=UNKNOWN_TEXT).json()
    third = env.next(sid, text=UNKNOWN_TEXT).json()
    assert third["clarify"]
    assert third["message"] == MSG_CLARIFY
    assert ids(third) == ids(second)


@pytest.mark.parametrize(
    "body",
    [{}, {"direction_id": "closer"}, {"text": "근처로"}],
    ids=["빈_next", "방향버튼", "알아듣는_글"],
)
def test_D06_S4_3_새_묶음을_보여주면_횟수가_0이라_다시_되묻는다(env, body):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.values(sid)["clarify_count"] == 1
    assert env.next(sid, **body).status_code == 200
    assert env.values(sid)["clarify_count"] == 0
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["clarify"]
    assert env.values(sid)["clarify_count"] == 1


def test_D07_S4_3_더_고를래로_새_묶음이_나와도_횟수가_0(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.compose(sid).status_code == 200
    assert env.back(sid).status_code == 200
    assert env.values(sid)["clarify_count"] == 0


def test_D08_S4_3_되묻기_뒤_반응해도_횟수는_유지되어_다음엔_새_묶음(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.react(sid, "P01").status_code == 200
    assert env.values(sid)["clarify_count"] == 1
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["clarify"] is None
    assert not set(ids(data)) & set(FIRST_SIX)


@pytest.mark.skip(reason="질문 대기 Q19: 두 번째 못 알아들었을 때 반응 없는 곳을 skip으로 기록하는지")
def test_D09_두번째_못알아들음도_반응_없는_곳을_skip으로_기록(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    env.next(sid, text=UNKNOWN_TEXT)
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=FIRST_SIX[1:])  # 임시 가정


def parser_logs(env):
    return [log for log in env.repo.decision_logs() if log["kind"] == "parser"]


@pytest.mark.parametrize(
    ("text", "direction", "understood"),
    [("조용한 데", "quieter", True), (UNKNOWN_TEXT, None, False)],
    ids=["알아들음", "못알아들음"],
)
def test_D10_AC09_next_글_해석을_한_줄씩_기록(env, text, direction, understood):
    sid, _ = env.browse(env.plant_day(city()))
    assert parser_logs(env) == []
    assert env.next(sid, text=text).status_code == 200
    logs = parser_logs(env)
    assert len(logs) == 1
    assert logs[0]["kind"] == "parser"
    assert logs[0]["model"] == "rule"
    assert logs[0]["output"] == {"text": text, "direction": direction, "understood": understood}


def test_D11_AC09_여러번_입력하면_매번_한_줄씩(env):
    sid, _ = env.browse(env.plant_day(city()))
    for text in (UNKNOWN_TEXT, UNKNOWN_TEXT, "밤에", UNKNOWN_TEXT):
        assert env.next(sid, text=text).status_code == 200
    assert [log["output"]["understood"] for log in parser_logs(env)] == [False, False, True, False]
    assert [log["output"]["direction"] for log in parser_logs(env)] == [None, None, "night", None]


@pytest.mark.parametrize(
    ("text", "direction", "understood"),
    [("조용한 데", "quieter", True), (UNKNOWN_TEXT, None, False)],
    ids=["알아들음", "못알아들음"],
)
def test_D12_AC09_첫_질문의_글_해석도_기록(env, text, direction, understood):
    env.browse(env.plant_day(city()), [], text)
    assert [log["output"] for log in parser_logs(env)] == [
        {"text": text, "direction": direction, "understood": understood}
    ]


@pytest.mark.parametrize("body", [{}, {"direction_id": "closer"}], ids=["빈_next", "방향버튼"])
def test_D13_AC09_글이_없으면_해석_기록_없음(env, body):
    sid, _ = env.browse(env.plant_day(city()))
    assert env.next(sid, **body).status_code == 200
    assert parser_logs(env) == []
