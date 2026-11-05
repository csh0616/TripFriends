"""완료 기준과 오류. 근거: TASK-003 §4, §5, §10, AC-6·7·10~16·18~20, DATA-001 C·D, TASK-002 §7 Q15·Q16, §8 Q37."""

import ast
import importlib
import json
import os
import re
import sys
import tomllib
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from planning_api_helpers import (
    BATCH_KEYS,
    COURSE_KEYS,
    FIXED_STAY,
    MSG_EXHAUSTED,
    MSG_NO_DIRECTION,
    PICKS_KEYS,
    PLACE_KEYS,
    SESSION_KEYS,
    UNKNOWN_TEXT,
    as_dict,
    assert_batch_shape,
    assert_course_shape,
    assert_error,
    at_of,
    cafes,
    course_place_ids,
    demo_places,
    dumped,
    first_option_id,
    ids,
    week_hours,
    without_option_id,
)
from planning_helpers import BASE, MONDAY, day_plan, fixed_event, opening, place

from deciders import JevDecider
from engine.models import Reactions, StayRange
from engine.planning import compose_courses, next_batch

FIRST_SIX = [f"P{i:02d}" for i in range(1, 7)]
SERVER = Path(__file__).parents[1]


def raise_forced(*args, **kwargs):
    raise RuntimeError("테스트가 강제한 예외")

API_TYPES = SERVER.parents[1] / "packages" / "api-types"


def city(count=24):
    return as_dict(cafes(count))


# ---------- AC-6, AC-7: 반응 ----------


def test_F01_AC06_6곳_중_2곳_좋아요_후_next면_4곳_skip과_새_묶음(env):
    sid, batch = env.browse(env.plant_day(city()))
    assert ids(batch) == FIRST_SIX
    env.react(sid, "P02")
    env.react(sid, "P05")
    data = env.next(sid).json()
    assert env.repo.reactions(sid) == Reactions(liked=["P02", "P05"], skipped=["P01", "P03", "P04", "P06"])
    assert not set(ids(data)) & set(FIRST_SIX)
    assert len(ids(data)) == 6


def test_F02_AC06_직접_넘긴_곳은_한번만_기록되고_묶음이_쌓인다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01", "skip")
    env.next(sid)
    assert env.repo.reactions(sid).skipped == FIRST_SIX
    env.next(sid)
    assert env.repo.reactions(sid).skipped == [f"P{i:02d}" for i in range(1, 13)]


def test_F03_AC07_unlike하면_picks에서_빠지고_skip이_되지_않는다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    env.react(sid, "P02")
    response = env.react(sid, "P01", "unlike")
    assert response.json() == {"picks": ["P02"], "picks_count": 1}
    assert env.repo.reactions(sid) == Reactions(liked=["P02"], skipped=[])


def test_F04_AC07_unlike한_곳은_반응이_있으므로_next에서도_skip이_아니다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    env.react(sid, "P01", "unlike")
    env.next(sid)
    reactions = env.repo.reactions(sid)
    assert "P01" not in reactions.skipped
    assert "P01" not in reactions.liked
    assert reactions.skipped == FIRST_SIX[1:]


def test_F05_S4_같은_곳을_두번_좋아해도_담은_곳은_하나(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}


def test_F06_S4_취소_뒤_다시_좋아하면_담긴다(env):
    # DATA-001 C: 담은 곳 = like 중 unlike 안 된 것
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    env.react(sid, "P01", "unlike")
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}


def test_F07_Q18_좋아한_곳을_넘기면_담은_곳에서_빠진다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    assert env.react(sid, "P01", "skip").json() == {"picks": [], "picks_count": 0}
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=["P01"])


def test_F08_Q17_이전_묶음에서_담은_곳도_취소할_수_있다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    env.next(sid)
    assert env.react(sid, "P01", "unlike").json() == {"picks": [], "picks_count": 0}
    reactions = env.repo.reactions(sid)
    assert "P01" not in reactions.liked
    assert "P01" not in reactions.skipped


@pytest.mark.parametrize("action", ["like", "skip"])
def test_F57_Q17_like와_skip은_지금_묶음만(env, action):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid)
    before = env.repo.snapshot()
    assert_error(env.react(sid, "P01", action), 400)
    assert env.repo.snapshot() == before


def test_F58_Q17_이전_묶음에서_담지_않은_곳은_unlike해도_400(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.next(sid)
    before = env.repo.snapshot()
    assert_error(env.react(sid, "P01", "unlike"), 400)
    assert env.repo.snapshot() == before


def test_F59_Q18_picks는_담은_순서(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P03")
    assert env.react(sid, "P01").json()["picks"] == ["P03", "P01"]
    env.react(sid, "P03", "unlike")
    assert env.react(sid, "P03").json()["picks"] == ["P01", "P03"]


def test_F60_Q18_넘긴_곳을_다시_좋아하면_담긴다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01", "skip")
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}


# ---------- AC-10, AC-11: 코스 계산 경계 ----------


def test_F09_AC10_담은_곳_0곳이면_빈_코스_1안(env):
    sid, course = env.composing(env.plant_day(city()))
    assert_course_shape(course)
    assert len(course["options"]) == 1
    option = course["options"][0]
    assert option["label"] == "relaxed"  # TASK-002 §8 Q35
    assert option["items"] == []
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=FIRST_SIX)


def test_F10_AC10_담은_곳_0곳이어도_꼭_갈_곳은_들어간다(env):
    places = city()
    _, course = env.composing(env.plant_day(places, day_plan(must=("P20",))))
    for option in course["options"]:
        assert [i["place_id"] for i in option["items"]] == ["P20"]


def closed_monday_city():
    closed = place("P20", hours=opening("10:00", "18:00", weekday=1), stay=FIXED_STAY)
    return as_dict([*cafes(19), closed])


def test_F11_AC11_꼭_갈_곳이_그날_휴무면_422(env):
    plan = day_plan(must=("P20",))  # 월요일
    sid, _ = env.browse(env.plant_day(closed_monday_city(), plan))
    error = assert_error(env.compose(sid), 422, "COURSE_INFEASIBLE")
    assert error["detail"] == {"reason": "must_visit_closed", "blocking": ["P20"], "suggest_drop": []}


def test_F12_AC11_같은_곳이_여는_날이면_정상(env):
    tuesday = MONDAY.replace(day=MONDAY.day + 1)
    plan = day_plan(must=("P20",), day=tuesday)
    sid, _ = env.browse(env.plant_day(closed_monday_city(), plan))
    response = env.compose(sid)
    assert response.status_code == 200
    for option in response.json()["options"]:
        assert "P20" in [i["place_id"] for i in option["items"]]


def test_F13_AC11_꼭_갈_곳이_하루보다_길면_422_detail에_이유(env):
    places = as_dict([*cafes(19), place("P20", hours=week_hours(), stay=FIXED_STAY)])
    plan = day_plan(start="09:00", end="09:30", must=("P20",))
    sid, _ = env.browse(env.plant_day(places, plan))
    error = assert_error(env.compose(sid), 422, "COURSE_INFEASIBLE")
    assert error["detail"] == {"reason": "must_visit_overflow", "blocking": ["P20"], "suggest_drop": []}


def test_F14_Q3_compose_422면_browsing_유지_skip_기록_안함(env):
    plan = day_plan(must=("P20",))
    sid, _ = env.browse(env.plant_day(closed_monday_city(), plan))
    env.react(sid, "P01")
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.compose(sid), 422)
    assert env.stage(sid) == "browsing"
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=[])
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F15_Q2_자동_시작에서_코스를_못_만들면_422_세션_안_만듦(env):
    day_id = env.plant_day(closed_monday_city(), day_plan(must=("P20",)))
    before = env.repo.snapshot()
    error = assert_error(env.start(day_id, mode="auto"), 422)
    assert error["detail"]["reason"] == "must_visit_closed"
    assert env.repo.snapshot() == before


def test_F61_Q2_asking의_자동에서_코스를_못_만들면_422_asking_유지_대화로_이어감(env):
    day_id = env.plant_day(closed_monday_city(), day_plan(must=("P20",)))
    session = env.session(day_id)
    sid = session["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    response = env.client.post(f"/planning/{sid}/answer", json={"auto": True})
    error = assert_error(response, 422)
    assert error["detail"]["reason"] == "must_visit_closed"
    assert env.stage(sid) == "asking"
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.answer(session).status_code == 200
    assert env.stage(sid) == "browsing"


# ---------- AC-12: 시간 조정 ----------


def item_of(option, pid):
    return next(i for i in option["items"] if i["place_id"] == pid)


def test_F16_AC12_플러스_15_두번이면_30분_늘고_다시_계산(env):
    places = city()
    plan = day_plan()
    sid, course = env.composing(env.plant_day(places, plan), likes=("P01", "P02"))
    first = env.adjust(sid, first_option_id(course), "P01", 15).json()
    assert {item_of(o, "P01")["stay_min"] for o in first["options"]} == {FIXED_STAY.typical + 15}
    second = env.adjust(sid, first_option_id(first), "P01", 15)
    assert second.status_code == 200
    data = second.json()
    assert_course_shape(data)
    for option in data["options"]:
        assert item_of(option, "P01")["stay_min"] == FIXED_STAY.typical + 30
        assert item_of(option, "P01")["stay_source"] == "user"
        assert item_of(option, "P02")["stay_source"] == "auto"
    changed = day_plan(overrides={"P01": 90})
    assert without_option_id(data) == dumped(compose_courses(changed, ["P01", "P02"], places))


def test_F17_AC12_마이너스_15와_되돌리기(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    down = env.adjust(sid, first_option_id(course), "P01", -15).json()
    assert {item_of(o, "P01")["stay_min"] for o in down["options"]} == {45}
    assert {item_of(o, "P01")["stay_source"] for o in down["options"]} == {"user"}
    back_up = env.adjust(sid, first_option_id(down), "P01", 15).json()
    assert {item_of(o, "P01")["stay_min"] for o in back_up["options"]} == {60}
    assert {item_of(o, "P01")["stay_source"] for o in back_up["options"]} == {"user"}


def test_F18_AC12_두_곳을_따로_조정(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01", "P02"))
    first = env.adjust(sid, first_option_id(course), "P01", 15).json()
    data = env.adjust(sid, first_option_id(first), "P02", -15).json()
    for option in data["options"]:
        assert item_of(option, "P01")["stay_min"] == 75
        assert item_of(option, "P02")["stay_min"] == 45


@pytest.mark.parametrize(
    ("minutes", "delta", "expected"),
    [(15, -15, 15), (30, -15, 15), (285, 15, 300), (300, 15, 300)],
    ids=["15에서_빼면_15", "30에서_빼면_15", "285에서_더하면_300", "300에서_더하면_300"],
)
def test_F19_AC12_사용자_값_경계_15분과_300분(env, minutes, delta, expected):
    # TASK-002 §7 Q16: 15~300분, 밖이면 자른다
    stay = StayRange(min=minutes, typical=minutes, max=minutes)
    places = as_dict([*cafes(5, start=2), place("P01", hours=week_hours("00:00", "29:00"), stay=stay)])
    plan = day_plan(start="09:00", end="23:00")
    sid, course = env.composing(env.plant_day(places, plan), likes=("P01",))
    data = env.adjust(sid, first_option_id(course), "P01", delta).json()
    assert {item_of(o, "P01")["stay_min"] for o in data["options"]} == {expected}


@pytest.mark.parametrize(
    ("minutes", "first_delta", "second_delta", "expected"),
    [(300, 15, -15, 285), (15, -15, 15, 30)],
    ids=["300에서_더한_뒤_빼면_285", "15에서_뺀_뒤_더하면_30"],
)
def test_F56_Q14_잘린_값을_저장하므로_다음_조정은_자른_값_기준(env, minutes, first_delta, second_delta, expected):
    stay = StayRange(min=minutes, typical=minutes, max=minutes)
    places = as_dict([*cafes(5, start=2), place("P01", hours=week_hours("00:00", "29:00"), stay=stay)])
    plan = day_plan(start="09:00", end="23:00")
    sid, course = env.composing(env.plant_day(places, plan), likes=("P01",))
    first = env.adjust(sid, first_option_id(course), "P01", first_delta).json()
    data = env.adjust(sid, first_option_id(first), "P01", second_delta).json()
    assert {item_of(o, "P01")["stay_min"] for o in data["options"]} == {expected}


def test_F20_DATA001_D_조정한_시간은_다시_짜도_지킨다(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    env.adjust(sid, first_option_id(course), "P01", 15)
    env.back(sid)
    data = env.compose(sid).json()
    for option in data["options"]:
        assert item_of(option, "P01")["stay_min"] == 75
        assert item_of(option, "P01")["stay_source"] == "user"


def test_F21_S5_조정해서_꼭_갈_곳이_못_들어가면_422(env):
    # 영업 09:00~10:00, 60분은 정각에 맞고 75분은 안 들어간다 (TASK-002 §10-4 Q56)
    places = as_dict([*cafes(6), place("P20", hours=week_hours("09:00", "10:00"), stay=FIXED_STAY)])
    plan = day_plan(must=("P20",))
    sid, course = env.composing(env.plant_day(places, plan))
    assert course["options"]
    error = assert_error(env.adjust(sid, first_option_id(course), "P20", 15), 422, "COURSE_INFEASIBLE")
    assert error["detail"]["reason"] == "user_stay_conflict"
    assert error["detail"]["blocking"] == ["P20"]


def test_F62_Q3_adjust_422면_바꾼_값을_되돌리고_composing_유지(env):
    places = as_dict([*cafes(6), place("P20", hours=week_hours("09:00", "10:00"), stay=FIXED_STAY)])
    sid, course = env.composing(env.plant_day(places, day_plan(must=("P20",))))
    option_id = first_option_id(course)
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, option_id, "P20", 15), 422)
    assert env.stage(sid) == "composing"
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    # 같은 코스안이 그대로 살아 있고, 저장된 값이 없으니 기준은 다시 60분 → 45분
    data = env.adjust(sid, option_id, "P20", -15).json()
    assert {item_of(o, "P20")["stay_min"] for o in data["options"]} == {45}


@pytest.mark.parametrize("delta", [0, 14, 16, 30, -30], ids=str)
def test_F22_S5_delta는_15나_마이너스_15만(env, delta):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, first_option_id(course), "P01", delta), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F23_S5_플러스_15_마이너스_15_양쪽은_정상(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    up = env.adjust(sid, first_option_id(course), "P01", 15)
    assert up.status_code == 200
    assert env.adjust(sid, first_option_id(up.json()), "P01", -15).status_code == 200


@pytest.mark.parametrize("label", ["relaxed", "packed"])
def test_F24_Q14_기준은_고른_안의_머문_시간이고_결과는_두_안_모두에_적용(env, label):
    places = as_dict(cafes(6, stay=StayRange(min=30, typical=60, max=90)))
    sid, course = env.composing(env.plant_day(places), likes=("P01",))
    by_label = {o["label"]: o for o in course["options"]}
    assert set(by_label) == {"relaxed", "packed"}
    assert item_of(by_label["relaxed"], "P01")["stay_min"] != item_of(by_label["packed"], "P01")["stay_min"]
    option = by_label[label]
    expected = item_of(option, "P01")["stay_min"] + 15
    response = env.adjust(sid, option["option_id"], "P01", 15)
    assert response.status_code == 200
    data = response.json()
    for result in data["options"]:
        assert item_of(result, "P01")["stay_min"] == expected
        assert item_of(result, "P01")["stay_source"] == "user"
    changed = day_plan(overrides={"P01": expected})
    assert without_option_id(data) == dumped(compose_courses(changed, ["P01"], places))


@pytest.mark.parametrize("place_id", ["P20", "없는장소"], ids=["담지_않은_곳", "아예_없는_곳"])
def test_F25_Q15_그_안의_items에_없는_장소는_400(env, place_id):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, first_option_id(course), place_id, 15), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F63_Q15_뺀_곳_다른_안에만_있는_곳은_400_그_안에_있으면_정상(env):
    # 60분 2곳: 쉬는 15분이면 135분이라 안 들어가고, 쉬는 5분이면 125분이라 들어간다 (하루 130분)
    plan = day_plan(start="09:00", end="11:10")
    sid, course = env.composing(env.plant_day(city(), plan), likes=("P01", "P02"))
    by_label = {o["label"]: o for o in course["options"]}
    assert set(by_label) == {"relaxed", "packed"}
    relaxed, packed = by_label["relaxed"], by_label["packed"]
    only_packed = {i["place_id"] for i in packed["items"]} - {i["place_id"] for i in relaxed["items"]}
    assert len(only_packed) == 1
    target = only_packed.pop()
    assert target in {d["place_id"] for d in relaxed["dropped"]}
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, relaxed["option_id"], target, -15), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.adjust(sid, packed["option_id"], target, -15).status_code == 200


# ---------- AC-13, AC-14: 되돌아가기, 고르기 ----------


def test_F26_AC13_더_고른_뒤_다시_짜면_반응이_이어지고_새로_담은_곳도_포함(env):
    sid, _ = env.composing(env.plant_day(city()), likes=("P01",))
    batch = env.back(sid).json()
    assert_batch_shape(batch)
    assert not set(ids(batch)) & set(FIRST_SIX)
    assert batch["picks_count"] == 1
    new_pick = ids(batch)[0]
    assert env.react(sid, new_pick).json()["picks_count"] == 2
    course = env.compose(sid).json()
    for option in course["options"]:
        assert course_place_ids(option) == {"P01", new_pick}
    reactions = env.repo.reactions(sid)
    assert reactions.liked == ["P01", new_pick]
    assert set(FIRST_SIX[1:]) <= set(reactions.skipped)
    assert set(ids(batch)) - {new_pick} <= set(reactions.skipped)


def test_F27_AC14_고르면_done이고_저장되고_이후는_409(env):
    day_id = env.plant_day(city())
    sid, course = env.composing(day_id, likes=("P01",))
    option_id = course["options"][-1]["option_id"]
    assert env.repo.chosen_option(day_id) is None
    assert env.select(option_id).status_code == 200
    assert env.stage(sid) == "done"
    assert env.repo.chosen_option(day_id) == option_id
    assert_error(env.compose(sid), 409, "STATE_CONFLICT")
    assert_error(env.select(option_id), 409, "STATE_CONFLICT")
    assert env.repo.chosen_option(day_id) == option_id


def test_F28_AC14_안이_둘이면_어느_쪽이든_고른_것이_저장된다(env):
    places = as_dict(cafes(8, stay=StayRange(min=30, typical=60, max=90)))
    day_id = env.plant_day(places)
    _, course = env.composing(day_id, likes=("P01", "P02", "P03"))
    by_label = {o["label"]: o["option_id"] for o in course["options"]}
    assert set(by_label) == {"relaxed", "packed"}
    packed = by_label["packed"]
    assert env.select(packed).json()["option_id"] == packed
    assert env.repo.chosen_option(day_id) == packed


def test_F29_Q16_조정하면_새_ID이고_옛_ID로_고르면_404(env):
    day_id = env.plant_day(city())
    sid, course = env.composing(day_id, likes=("P01",))
    old = first_option_id(course)
    data = env.adjust(sid, old, "P01", 15).json()
    new = first_option_id(data)
    assert old != new
    assert env.values(sid)["option_ids"] == [o["option_id"] for o in data["options"]]
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.select(old), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.select(new).status_code == 200
    assert env.repo.chosen_option(day_id) == new


def test_F64_Q16_옛_ID로_조정하면_404(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    old = first_option_id(course)
    assert env.adjust(sid, old, "P01", 15).status_code == 200
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, old, "P01", 15), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F66_Q21_코스안_ID만으로_그_세션을_찾는다(env):
    day_a = env.plant_day(city())
    day_b = env.plant_day(city())
    a, _ = env.composing(day_a, likes=("P01",))
    b, course_b = env.composing(day_b, likes=("P01",))
    option_id = first_option_id(course_b)
    assert env.select(option_id).json() == {"day_id": day_b, "option_id": option_id}
    assert env.stage(b) == "done"
    assert env.stage(a) == "composing"
    assert env.repo.chosen_option(day_a) is None


# ---------- AC-15: 자동 ----------


def test_F30_AC15_자동_모드는_바로_코스이고_꼭_갈_곳_포함_가상_도시(env):
    seed = env.seed()
    day_id = seed["day_ids"][1]
    must = env.repo.get_day(day_id).plan.must_visit
    assert len(must) == 1
    response = env.start(day_id, mode="auto")
    assert response.status_code == 201  # §10-2 Q1
    data = response.json()
    assert_course_shape(data)
    for option in data["options"]:
        assert must[0] in [i["place_id"] for i in option["items"]]
    assert env.repo.reactions(data["session_id"]) == Reactions(liked=[], skipped=[])


def test_F31_AC15_자동_코스도_조정하면_같은_곳으로_다시_계산(env):
    places = city()
    plan = day_plan()
    response = env.start(env.plant_day(places, plan), mode="auto")
    sid = response.json()["session_id"]
    data = env.adjust(sid, first_option_id(response.json()), "P01", 15).json()
    changed = day_plan(overrides={"P01": 75})
    assert without_option_id(data) == dumped(compose_courses(changed, FIRST_SIX, places))


def test_F32_AC15_자동_코스도_고를_수_있다(env):
    day_id = env.plant_day(city())
    data = env.start(day_id, mode="auto").json()
    option_id = data["options"][0]["option_id"]
    assert env.select(option_id).json() == {"day_id": day_id, "option_id": option_id}
    assert env.stage(data["session_id"]) == "done"


def test_F33_Q20_자동_코스에서_더_고르면_처음부터_담은_곳_0(env):
    places = city()
    plan = day_plan()
    data = env.start(env.plant_day(places, plan), mode="auto").json()
    sid = data["session_id"]
    assert env.values(sid)["shown"] == []
    batch = env.back(sid).json()
    assert_batch_shape(batch)
    assert batch["picks_count"] == 0
    assert batch["round"] == 1
    assert ids(batch) == next_batch(places, Reactions(liked=[], skipped=[]), None, [], BASE, at_of(plan)).place_ids
    assert ids(batch) == FIRST_SIX  # 자동 코스의 6곳은 보여 준 곳이 아니다
    assert env.stage(sid) == "browsing"
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])


def test_F67_Q20_자동_코스에서_더_고른_뒤_다시_짜면_고른_곳으로만(env):
    data = env.start(env.plant_day(city()), mode="auto").json()
    sid = data["session_id"]
    env.back(sid)
    env.react(sid, "P02")
    course = env.compose(sid).json()
    for option in course["options"]:
        assert course_place_ids(option) == {"P02"}


# ---------- AC-16: 멈춘 자리에서 이어 가기 ----------


def interrupted(env, sid):
    snapshot = env.graph.get_state({"configurable": {"thread_id": sid}})
    return any(task.interrupts for task in snapshot.tasks)


def test_F34_AC16_요청마다_클라이언트가_달라도_같은_저장소와_그래프로_이어진다(env, monkeypatch):
    from planning.repo import MemoryPlanningRepo

    day_id = env.plant_day(city())
    repo, graph = env.repo, env.graph
    created = []
    original = MemoryPlanningRepo.__init__

    def spy(self, *args, **kwargs):
        created.append(self)
        original(self, *args, **kwargs)

    monkeypatch.setattr(MemoryPlanningRepo, "__init__", spy)
    session = TestClient(env.app).post(f"/days/{day_id}/planning", json={"mode": "conversation"}).json()
    sid = session["session_id"]
    assert TestClient(env.app).post(f"/planning/{sid}/answer", json={"choice_ids": []}).status_code == 200
    response = TestClient(env.app).post(f"/planning/{sid}/reactions", json={"place_id": "P01", "action": "like"})
    assert response.json()["picks"] == ["P01"]
    second = TestClient(env.app).post(f"/planning/{sid}/next", json={})
    assert second.json()["round"] == 2
    assert created == []
    assert env.repo is repo
    assert env.graph is graph


def test_F35_AC16_기다리는_자리마다_interrupt로_멈춰_있다(env):
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    assert interrupted(env, sid)  # asking
    env.answer(session)
    assert interrupted(env, sid)  # browsing
    env.react(sid, "P01")
    assert interrupted(env, sid)  # 반응 뒤에도 browsing에서 기다림
    course = env.compose(sid).json()
    assert interrupted(env, sid)  # composing
    env.select(course["options"][0]["option_id"])
    assert not interrupted(env, sid)  # done
    assert env.graph.get_state({"configurable": {"thread_id": sid}}).next == ()


def test_F36_AC16_체크포인터는_MemorySaver(env):
    from langgraph.checkpoint.memory import MemorySaver  # backend가 의존성을 추가한다

    assert isinstance(env.graph.checkpointer, MemorySaver)


def test_F37_AC16_세션끼리_섞이지_않는다(env):
    day_id = env.plant_day(city())
    a, _ = env.browse(day_id)
    b, _ = env.browse(day_id)
    assert a != b
    env.react(a, "P01")
    env.next(a)
    assert env.repo.reactions(b) == Reactions(liked=[], skipped=[])
    assert env.values(b)["round"] == 1
    assert env.values(a)["round"] == 2


# ---------- AC-18: 타입 생성 ----------

S6_SCHEMAS = {
    "PlanningSession": SESSION_KEYS,
    "CandidateBatch": BATCH_KEYS,
    "Picks": PICKS_KEYS,
    "CourseResult": COURSE_KEYS,
    "Place": PLACE_KEYS,
}
ENDPOINTS = [
    "/debug/seed-demo",
    "/days/{day_id}/planning",
    "/planning/{session_id}/answer",
    "/planning/{session_id}/reactions",
    "/planning/{session_id}/next",
    "/planning/{session_id}/compose",
    "/planning/{session_id}/adjust",
    "/planning/{session_id}/back",
    "/course-options/{option_id}/select",
]


def committed_openapi() -> dict:
    return json.loads((API_TYPES / "openapi.json").read_text(encoding="utf-8"))


def test_F38_AC18_커밋된_openapi가_지금_서버_명세와_같다():
    from api.main import app

    assert committed_openapi() == app.openapi()


@pytest.mark.parametrize("path", ENDPOINTS)
def test_F39_AC18_openapi에_엔드포인트_9개(path):
    assert "post" in committed_openapi()["paths"][path]


@pytest.mark.parametrize("name", S6_SCHEMAS)
def test_F40_AC18_openapi에_S6_모델과_키(name):
    schema = committed_openapi()["components"]["schemas"][name]
    assert set(schema["properties"]) == S6_SCHEMAS[name]


@pytest.mark.parametrize("name", S6_SCHEMAS)
def test_F41_AC18_ts_타입에_S6_모델(name):
    assert f"{name}: {{" in (API_TYPES / "index.ts").read_text(encoding="utf-8")


# ---------- AC-19: LLM·Jev 호출 0회 ----------


def run_every_event(env):
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    env.answer(session, ["카페"], "조용한 데")
    env.react(sid, "P01")
    env.react(sid, "P02", "skip")
    env.next(sid, text=UNKNOWN_TEXT)
    env.next(sid, text=UNKNOWN_TEXT)
    env.next(sid, direction_id="closer")
    env.next(sid)
    composed = env.compose(sid).json()
    env.adjust(sid, first_option_id(composed), "P01", 15)
    env.back(sid)
    course = env.compose(sid).json()
    env.select(course["options"][0]["option_id"])
    auto = env.start(env.plant_day(city()), mode="auto")
    assert auto.status_code == 201  # §10-2 Q1
    second = env.session(env.plant_day(city()))
    env.client.post(f"/planning/{second['session_id']}/answer", json={"auto": True})


@pytest.mark.parametrize("key", [None, "test-key"], ids=["키_없음", "키_있음"])
def test_F42_AC19_모든_이벤트에서_Jev와_바깥_HTTP_호출_0회(monkeypatch, key):
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
    monkeypatch.setattr(JevDecider, "warm_up", lambda self: None)  # 서버 예열은 그래프 호출이 아니다
    monkeypatch.setattr(JevDecider, "decide", counter("JevDecider.decide"))
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", counter("http"))
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", counter("async http"))

    with TestClient(app) as client:
        run_every_event(PlanningEnv(client, app))

    assert calls == []


def test_F43_AC19_LLM_도구는_불러오지_않는다_쓰이는_경로에서(env):
    run_every_event(env)
    assert not {"anthropic", "openai", "langchain_openai", "langchain_anthropic"} & set(sys.modules)


def test_F44_AC19_그래프_코드는_판단기와_HTTP를_import하지_않는다():
    tree = ast.parse((SERVER / "graphs" / "planning.py").read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert not imported & {"deciders", "httpx", "requests", "anthropic", "openai"}


# ---------- AC-20, 시드 ----------


@pytest.fixture
def reload_main(monkeypatch):
    """APP_ENV를 바꾼 채 api.main을 다시 읽는다. 끝나면 원래 환경으로 다시 읽는다."""
    import api.main

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)

    def load(value):
        if value is None:
            monkeypatch.delenv("APP_ENV", raising=False)
        else:
            monkeypatch.setenv("APP_ENV", value)
        return importlib.reload(api.main).app

    yield load
    monkeypatch.delenv("APP_ENV", raising=False)
    importlib.reload(api.main)


def test_F45_AC20_R2_운영이면_시드는_공통_형식_404(reload_main):
    with TestClient(reload_main("production")) as client:
        assert_error(client.post("/debug/seed-demo"), 404)


@pytest.mark.parametrize("value", [None, "development", "staging"], ids=["없음", "development", "staging"])
def test_F46_AC20_운영이_아니면_시드는_201(reload_main, value):
    with TestClient(reload_main(value)) as client:
        assert client.post("/debug/seed-demo").status_code == 201


def test_F47_S5_시드는_가상_도시_3일_숙소_중심_둘째_날만_꼭_갈_곳(env):
    seed = env.seed()
    days = [env.repo.get_day(day_id) for day_id in seed["day_ids"]]
    assert len(days) == 3
    assert [d.plan.date for d in days] == [date(2026, 12, 1), date(2026, 12, 2), date(2026, 12, 3)]
    assert [d.day_number for d in days] == [1, 2, 3]
    for day in days:
        assert set(day.places) == set(demo_places())
        assert day.plan.lodging == BASE
        assert (day.plan.start, day.plan.end) == ("10:00", "20:00")
    assert [len(d.plan.must_visit) for d in days] == [0, 1, 0]


def test_F68_Q26_꼭_갈_곳은_둘째_날_여는_곳_중_id가_가장_작은_곳(env):
    seed = env.seed()
    second = env.repo.get_day(seed["day_ids"][1])
    weekday = date(2026, 12, 2).weekday()
    opening_ids = [p.id for p in demo_places().values() if any(o.weekday == weekday for o in p.hours or [])]
    assert second.plan.must_visit == [min(opening_ids)]
    assert second.plan.must_visit == ["D01"]


def test_F69_Q26_Q33_시드_묶음은_at이_그날_시작_시각이고_꼭_갈_곳이_빠진다(env):
    seed = env.seed()
    day_id = seed["day_ids"][1]
    sid, first = env.browse(day_id)
    assert "D01" not in ids(first)
    places = {pid: p for pid, p in demo_places().items() if pid != "D01"}
    reactions = Reactions(liked=[], skipped=ids(first))
    at = datetime(2026, 12, 2, 10, 0)
    data = env.next(sid, direction_id="night").json()
    assert ids(data) == next_batch(places, reactions, "night", ids(first), BASE, at).place_ids


def test_F48_S6_시드_데이터의_출처는_demo(env):
    seed = env.seed()
    _, batch = env.browse(seed["day_ids"][0])
    for entry in batch["candidates"]:
        assert {fact["source_type"] for fact in entry["place"]["facts"]} == {"demo"}


# ---------- 오류 (§5) ----------


def test_F70_Q33_꼭_갈_곳은_첫_묶음과_다음_묶음과_더_고를래에서_빠진다(env):
    places = city(30)
    plan = day_plan(must=("P03",))
    sid, first = env.browse(env.plant_day(places, plan))
    assert ids(first) == ["P01", "P02", "P04", "P05", "P06", "P07"]
    without_must = {pid: p for pid, p in places.items() if pid != "P03"}
    reactions = Reactions(liked=[], skipped=ids(first))
    second = env.next(sid).json()
    assert ids(second) == next_batch(without_must, reactions, None, ids(first), BASE, at_of(plan)).place_ids
    assert "P03" not in ids(second)
    assert env.compose(sid).status_code == 200
    assert "P03" not in ids(env.back(sid).json())


def test_F71_Q33_꼭_갈_곳에는_반응할_수_없다(env):
    sid, _ = env.browse(env.plant_day(city(), day_plan(must=("P03",))))
    before = env.repo.snapshot()
    assert_error(env.react(sid, "P03"), 400)
    assert env.repo.snapshot() == before


@pytest.mark.parametrize("via", ["start", "answer"])
def test_F72_Q33_자동의_6곳은_꼭_갈_곳_제외_6곳(env, via):
    places = city()
    plan = day_plan(must=("P03",))
    day_id = env.plant_day(places, plan)
    if via == "start":
        data = env.start(day_id, mode="auto").json()
    else:
        sid = env.session(day_id)["session_id"]
        data = env.client.post(f"/planning/{sid}/answer", json={"auto": True}).json()
    six = ["P01", "P02", "P04", "P05", "P06", "P07"]
    assert without_option_id(data) == dumped(compose_courses(plan, six, places))
    for option in data["options"]:
        assert course_place_ids(option) == {*six, "P03"}


def test_F49_S5_없는_날로_세션을_시작하면_404(env):
    assert_error(env.start("없는-날"), 404)


SESSION_POSTS = [
    pytest.param("answer", {"choice_ids": []}, id="answer"),
    pytest.param("reactions", {"place_id": "P01", "action": "like"}, id="reactions"),
    pytest.param("next", {}, id="next"),
    pytest.param("compose", None, id="compose"),
    pytest.param("adjust", {"option_id": "없는-코스안", "place_id": "P01", "delta": 15}, id="adjust"),
    pytest.param("back", None, id="back"),
]


@pytest.mark.parametrize(("path", "body"), SESSION_POSTS)
def test_F50_S5_없는_세션은_404(env, path, body):
    response = env.client.post(f"/planning/없는-세션/{path}", json=body)
    assert_error(response, 404)


def test_F51_S5_없는_코스안을_고르면_404(env):
    assert_error(env.select("없는-코스안"), 404)


@pytest.mark.parametrize(
    "place_id",
    ["P20", "없는장소"],
    ids=["있지만_이번_묶음에_없는_곳", "아예_없는_곳"],
)
@pytest.mark.parametrize("action", ["like", "skip", "unlike"])
def test_F52_S5_묶음에_없는_장소_반응은_400이고_저장소_그대로(env, action, place_id):
    sid, _ = env.browse(env.plant_day(city()))
    before = env.repo.snapshot()
    assert_error(env.react(sid, place_id, action), 400)
    assert env.repo.snapshot() == before
    assert env.stage(sid) == "browsing"


def test_F53_S5_묶음_안의_마지막_장소_반응은_정상(env):
    sid, _ = env.browse(env.plant_day(city()))
    assert env.react(sid, "P06").status_code == 200


def test_F54_S5_없는_direction_id는_400이고_저장소_그대로(env):
    sid, batch = env.browse(env.plant_day(city()))
    before = env.repo.snapshot()
    assert_error(env.next(sid, direction_id="sunny"), 400)
    assert env.repo.snapshot() == before
    assert env.values(sid)["batch"] == ids(batch)
    assert env.values(sid)["round"] == 1


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/days/{day}/planning", {"mode": "manual"}),
        ("/days/{day}/planning", {}),
        ("/planning/{sid}/reactions", {"place_id": "P01", "action": "love"}),
        ("/planning/{sid}/reactions", {"action": "like"}),
        ("/planning/{sid}/next", {"direction_id": "closer", "text": "근처로"}),
        ("/planning/{sid}/next", {"text": ""}),
        ("/planning/{sid}/next", {"text": 123}),
        ("/planning/{sid}/next", {"text": "   "}),
        ("/planning/{sid}/next", {"text": "\t\n "}),
    ],
    ids=[
        "없는_mode",
        "mode_없음",
        "없는_action",
        "place_id_없음",
        "방향과_글_동시",
        "빈_글",
        "글이_숫자",
        "공백만",
        "탭과_줄바꿈만",
    ],
)
def test_F55_Q23_본문이_잘못되면_공통_오류_400_아무것도_안_바뀜(env, path, body):
    day = env.plant_day(city())
    sid, _ = env.browse(day)
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.client.post(path.format(day=day, sid=sid), json=body), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


@pytest.mark.parametrize(
    "body",
    [
        {"auto": True, "choice_ids": []},
        {"auto": True, "choice_ids": ["cafe"]},
        {"choice_ids": [], "text": ""},
        {"choice_ids": ["없는칩"]},
        {},
        {"auto": False},
        {"choice_ids": [], "text": "   "},
    ],
    ids=["자동과_빈_칩", "자동과_칩", "빈_글", "없는_칩", "빈_본문", "auto_false", "공백만"],
)
def test_F73_Q23_첫_답의_본문이_잘못되면_400_asking_유지(env, body):
    sid = env.session(env.plant_day(city()))["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.client.post(f"/planning/{sid}/answer", json=body), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


@pytest.mark.parametrize(
    "change",
    [{"option_id": None}, {"place_id": None}, {"delta": None}, {"delta": "15"}],
    ids=["option_id_없음", "place_id_없음", "delta_없음", "delta가_글"],
)
def test_F74_Q23_Q14_adjust_본문이_잘못되면_400(env, change):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    body = {"option_id": first_option_id(course), "place_id": "P01", "delta": 15}
    for key, value in change.items():
        if value is None:
            del body[key]
        else:
            body[key] = value
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.client.post(f"/planning/{sid}/adjust", json=body), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


@pytest.mark.parametrize("text", ["", "   "], ids=["빈_글", "공백만"])
def test_F75_Q23_Q42_빈_글은_해석_기록을_남기지_않는다(env, text):
    sid, _ = env.browse(env.plant_day(city()))
    assert_error(env.next(sid, text=text), 400)
    assert env.repo.decision_logs() == []


@pytest.mark.parametrize(
    ("total", "message", "exhausted"),
    [(24, MSG_NO_DIRECTION, False), (5, MSG_NO_DIRECTION, False), (4, MSG_EXHAUSTED, True)],
    ids=["충분함", "5곳_경계", "4곳_소진"],
)
def test_F77_Q38_자동_뒤_더_고를래는_방향_없음_문장_소진이면_소진_문장_round_1(env, total, message, exhausted):
    data = env.start(env.plant_day(city(total)), mode="auto").json()
    batch = env.back(data["session_id"]).json()
    assert batch["message"] == message
    assert batch["exhausted"] is exhausted
    assert batch["round"] == 1


@pytest.mark.parametrize(
    ("places", "must"),
    [({}, ()), (as_dict(cafes(1)), ("P01",))],
    ids=["장소_없음", "전부_꼭_갈_곳"],
)
def test_F83_Q45_자동_뒤_더_고를래에서_후보가_0곳이면_round_0(env, places, must):
    response = env.start(env.plant_day(places, day_plan(must=must)), mode="auto")
    assert response.status_code == 201
    sid = response.json()["session_id"]
    batch = env.back(sid).json()
    assert batch["candidates"] == []
    assert batch["round"] == 0
    assert env.values(sid)["round"] == 0


def test_F84_Q46_코스를_다시_짠_뒤_옛_ID로_고르면_404(env):
    day_id = env.plant_day(city())
    sid, old = env.composing(day_id, likes=("P01",))
    env.back(sid)
    new = env.compose(sid).json()
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.select(first_option_id(old)), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.select(first_option_id(new)).status_code == 200
    assert env.repo.chosen_option(day_id) == first_option_id(new)


def test_F78_Q39_지금_묶음의_안_담은_곳_unlike는_변화_없고_다음_next에서_skip(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P02")
    state, repo = env.values(sid), env.repo.snapshot()
    response = env.react(sid, "P01", "unlike")
    assert response.status_code == 200
    assert response.json() == {"picks": ["P02"], "picks_count": 1}
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    env.next(sid)
    reactions = env.repo.reactions(sid)
    assert "P01" in reactions.skipped
    assert reactions.liked == ["P02"]


def test_F79_Q39_넘긴_곳_unlike도_변화_없다(env):
    sid, _ = env.browse(env.plant_day(city()))
    env.react(sid, "P01", "skip")
    repo = env.repo.snapshot()
    assert env.react(sid, "P01", "unlike").json() == {"picks": [], "picks_count": 0}
    assert env.repo.snapshot() == repo
    assert env.repo.reactions(sid).skipped == ["P01"]


def test_F80_Q41_다른_세션의_코스안으로_adjust하면_404(env):
    a, _ = env.composing(env.plant_day(city()), likes=("P01",))
    b, course_b = env.composing(env.plant_day(city()), likes=("P01",))
    state_a, state_b, repo = env.values(a), env.values(b), env.repo.snapshot()
    assert_error(env.adjust(a, first_option_id(course_b), "P01", 15), 404)
    assert env.values(a) == state_a
    assert env.values(b) == state_b
    assert env.repo.snapshot() == repo


def test_F81_Q41_코스를_다시_계산한_뒤_옛_ID로_adjust하면_404(env):
    sid, old = env.composing(env.plant_day(city()), likes=("P01",))
    env.back(sid)
    new = env.compose(sid).json()
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, first_option_id(old), "P01", 15), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.adjust(sid, first_option_id(new), "P01", 15).status_code == 200


def test_F82_Q41_R5_더_고를래_뒤_옛_ID로_adjust도_select도_404(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    option_id = first_option_id(course)
    env.back(sid)
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, option_id, "P01", 15), 404)
    assert_error(env.select(option_id), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F76_Q24_R3_오류_코드는_5개_값까지(env, monkeypatch):
    env.client = TestClient(env.app, raise_server_exceptions=False)
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    with monkeypatch.context() as patch:
        patch.setattr("graphs.planning.compose_courses", raise_forced)
        forced = env.adjust(sid, first_option_id(course), "P01", 15)
    assert forced.json()["error"]["code"] == "INTERNAL_ERROR"
    assert env.client.post("/planning/없는-세션/back").json()["error"]["code"] == "NOT_FOUND"
    assert env.adjust(sid, first_option_id(course), "P01", 30).json()["error"]["code"] == "INVALID_REQUEST"
    assert env.compose(sid).json()["error"]["code"] == "STATE_CONFLICT"
    closed = env.plant_day(closed_monday_city(), day_plan(must=("P20",)))
    assert env.start(closed, mode="auto").json()["error"]["code"] == "COURSE_INFEASIBLE"


# ---------- §10-10 R2: 모든 404 ----------


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "/없는-경로"), ("post", "/없는-경로"), ("post", "/planning"), ("get", "/days/없는-날/없는-경로")],
    ids=["GET_없는_경로", "POST_없는_경로", "세션_없는_planning", "없는_하위_경로"],
)
def test_F85_R2_없는_경로도_공통_형식_404(env, method, path):
    assert_error(getattr(env.client, method)(path), 404)


# ---------- §10-10 R1: 예외(500)도 실패한 요청 ----------


@pytest.fixture
def quiet_env(env):
    """서버 예외를 테스트로 다시 던지지 않고 500 응답으로 받는다."""
    env.client = TestClient(env.app, raise_server_exceptions=False)
    return env


def waiting_at(env, sid):
    return env.graph.get_state({"configurable": {"thread_id": sid}}).next


def fail_and_keep(env, sid, monkeypatch, target, send):
    """target에 예외를 강제해 send()가 500이고, 상태·저장소·기다리는 자리가 그대로인지 본다 (R15)."""
    state, repo, waiting = env.values(sid), env.repo.snapshot(), waiting_at(env, sid)
    with monkeypatch.context() as patch:
        patch.setattr(target, raise_forced)
        response = send()
    assert_error(response, 500)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert waiting_at(env, sid) == waiting


def test_F86_R1_compose_예외_뒤_like가_반영되고_옛_compose가_다시_돌지_않는다(quiet_env, monkeypatch):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    env.react(sid, "P01")
    send = lambda: env.compose(sid)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", send)
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", send)  # 두 번 연속
    response = env.react(sid, "P02")
    assert response.status_code == 200
    assert response.json() == {"picks": ["P01", "P02"], "picks_count": 2}
    assert env.stage(sid) == "browsing"
    assert env.repo.reactions(sid) == Reactions(liked=["P01", "P02"], skipped=[])
    assert env.values(sid)["batch"] == ids(batch)


def test_F87_R1_compose_예외_뒤_같은_요청을_다시_보내면_정상(quiet_env, monkeypatch):
    env = quiet_env
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    env.react(sid, "P01")
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", lambda: env.compose(sid))
    response = env.compose(sid)
    assert response.status_code == 200
    assert without_option_id(response.json()) == dumped(compose_courses(plan, ["P01"], places))
    assert env.stage(sid) == "composing"
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=FIRST_SIX[1:])


@pytest.mark.parametrize(
    "body",
    [{}, {"direction_id": "closer"}, {"text": "근처로"}],
    ids=["빈_next", "방향버튼", "알아듣는_글"],
)
def test_F88_R1_next_예외면_skip이_남지_않고_like가_반영되고_다시_보내면_정상(quiet_env, monkeypatch, body):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.next_batch", lambda: env.next(sid, **body))
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])
    assert env.repo.decision_logs() == []
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}
    assert env.values(sid)["batch"] == ids(batch)
    assert env.values(sid)["round"] == 1
    retried = env.next(sid, **body)
    assert retried.status_code == 200
    assert retried.json()["round"] == 2
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=FIRST_SIX[1:])


def test_F89_R1_두번째_못알아들음에서_예외면_횟수와_기록이_그대로(quiet_env, monkeypatch):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    assert env.next(sid, text=UNKNOWN_TEXT).status_code == 200
    send = lambda: env.next(sid, text=UNKNOWN_TEXT)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.next_batch", send)
    assert env.values(sid)["clarify_count"] == 1
    assert len(env.repo.decision_logs()) == 1
    retried = send().json()
    assert retried["clarify"] is None
    assert not set(ids(retried)) & set(ids(batch))


def test_F90_R1_adjust_예외면_값이_저장되지_않고_다시_보내면_한번만_늘어난다(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    option_id = first_option_id(course)
    send = lambda: env.adjust(sid, option_id, "P01", 15)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", send)
    retried = send()
    assert retried.status_code == 200
    assert {item_of(o, "P01")["stay_min"] for o in retried.json()["options"]} == {75}


def test_F91_R1_adjust_예외_뒤_다른_이벤트를_보내면_옛_adjust가_다시_돌지_않는다(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    send = lambda: env.adjust(sid, first_option_id(course), "P01", 15)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", send)
    back = env.back(sid)
    assert back.status_code == 200
    assert_batch_shape(back.json())
    assert env.stage(sid) == "browsing"
    again = env.compose(sid).json()
    assert item_of(again["options"][0], "P01")["stay_min"] == 60
    assert item_of(again["options"][0], "P01")["stay_source"] == "auto"


def test_F92_R1_answer_예외_뒤_asking에서_다시_답할_수_있다(quiet_env, monkeypatch):
    env = quiet_env
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.first_batch", lambda: env.answer(session, ["카페"]))
    assert env.stage(sid) == "asking"
    retried = env.answer(session, ["카페"])
    assert retried.status_code == 200
    assert retried.json()["round"] == 1
    assert env.stage(sid) == "browsing"


def test_F93_R1_answer_예외_뒤_자동을_보내면_옛_answer가_다시_돌지_않는다(quiet_env, monkeypatch):
    env = quiet_env
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.first_batch", lambda: env.answer(session, ["카페"]))
    response = env.client.post(f"/planning/{sid}/answer", json={"auto": True})
    assert response.status_code == 200
    assert_course_shape(response.json())
    assert env.stage(sid) == "composing"


def test_F94_R1_back_예외_뒤_composing에_머물고_조정과_다시_보내기가_된다(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.next_batch", lambda: env.back(sid))
    assert env.stage(sid) == "composing"
    adjusted = env.adjust(sid, first_option_id(course), "P01", 15)
    assert adjusted.status_code == 200
    assert_course_shape(adjusted.json())
    assert env.stage(sid) == "composing"
    assert env.back(sid).status_code == 200
    assert env.stage(sid) == "browsing"


def test_F95_R1_select_예외_뒤_composing에_머물고_다시_고를_수_있다(quiet_env, monkeypatch):
    env = quiet_env
    day_id = env.plant_day(city())
    sid, course = env.composing(day_id, likes=("P01",))
    option_id = first_option_id(course)
    target = "planning.repo.MemoryPlanningRepo.choose_option"
    fail_and_keep(env, sid, monkeypatch, target, lambda: env.select(option_id))
    assert env.stage(sid) == "composing"
    assert env.repo.chosen_option(day_id) is None
    assert env.select(option_id).status_code == 200
    assert env.stage(sid) == "done"
    assert env.repo.chosen_option(day_id) == option_id


@pytest.mark.parametrize("target", ["graphs.planning.compose_courses", "graphs.planning.first_batch"])
def test_F96_R1_자동_시작_예외면_세션을_안_만들고_다음_시작은_정상(quiet_env, monkeypatch, target):
    env = quiet_env
    day_id = env.plant_day(city())
    before = env.repo.snapshot()
    with monkeypatch.context() as patch:
        patch.setattr(target, raise_forced)
        response = env.start(day_id, mode="auto")
    assert_error(response, 500)
    assert env.repo.snapshot() == before
    retried = env.start(day_id, mode="auto")
    assert retried.status_code == 201
    assert_course_shape(retried.json())


def test_F97_R1_asking의_자동_예외_뒤_대화로_이어_간다(quiet_env, monkeypatch):
    env = quiet_env
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    send = lambda: env.client.post(f"/planning/{sid}/answer", json={"auto": True})  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, "graphs.planning.compose_courses", send)
    assert env.stage(sid) == "asking"
    assert env.answer(session).status_code == 200
    assert env.stage(sid) == "browsing"


# ---------- §10-10 R5: 지금 option_ids 규칙 ----------


def test_F98_R5_고른_뒤_지금_option_ids에_있는_다른_안은_409(env):
    places = as_dict(cafes(8, stay=StayRange(min=30, typical=60, max=90)))
    sid, course = env.composing(env.plant_day(places), likes=("P01", "P02", "P03"))
    assert len(course["options"]) == 2
    chosen, other = (o["option_id"] for o in course["options"])
    assert env.select(chosen).status_code == 200
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.select(other), 409)
    assert_error(env.adjust(sid, other, "P01", 15), 409)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


def test_F99_R5_고른_뒤에도_옛_ID는_지금_option_ids에_없으니_404(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    old = first_option_id(course)
    new = first_option_id(env.adjust(sid, old, "P01", 15).json())
    assert env.select(new).status_code == 200
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.select(old), 404)
    assert_error(env.adjust(sid, old, "P01", 15), 404)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


# ---------- §10-10 R6: 고정 일정 ----------


def fixed_city():
    places = city(30)
    return places, day_plan(fixed=(fixed_event("15:00", "16:00", places["P03"]),))


def test_F100_R6_고정_일정_항목을_조정하면_400이고_아무것도_안_바뀐다(env):
    places, plan = fixed_city()
    sid, course = env.composing(env.plant_day(places, plan), likes=("P01",))
    option = course["options"][0]
    assert item_of(option, "P03")["is_fixed"] is True
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.adjust(sid, option["option_id"], "P03", 15), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.adjust(sid, option["option_id"], "P01", 15).status_code == 200


def test_F101_R6_고정_일정_장소는_첫_묶음_다음_묶음_더_고를래에서_빠진다(env):
    places, plan = fixed_city()
    sid, first = env.browse(env.plant_day(places, plan))
    assert ids(first) == ["P01", "P02", "P04", "P05", "P06", "P07"]
    without_fixed = {pid: p for pid, p in places.items() if pid != "P03"}
    reactions = Reactions(liked=[], skipped=ids(first))
    second = env.next(sid).json()
    assert ids(second) == next_batch(without_fixed, reactions, None, ids(first), BASE, at_of(plan)).place_ids
    assert env.compose(sid).status_code == 200
    assert "P03" not in ids(env.back(sid).json())


@pytest.mark.parametrize("via", ["start", "answer"])
def test_F102_R6_자동의_6곳은_고정_일정_장소를_뺀_6곳(env, via):
    places, plan = fixed_city()
    day_id = env.plant_day(places, plan)
    if via == "start":
        data = env.start(day_id, mode="auto").json()
    else:
        sid = env.session(day_id)["session_id"]
        data = env.client.post(f"/planning/{sid}/answer", json={"auto": True}).json()
    six = ["P01", "P02", "P04", "P05", "P06", "P07"]
    assert without_option_id(data) == dumped(compose_courses(plan, six, places))


def test_F103_R6_고정_일정_장소에는_반응할_수_없다(env):
    places, plan = fixed_city()
    sid, _ = env.browse(env.plant_day(places, plan))
    before = env.repo.snapshot()
    assert_error(env.react(sid, "P03"), 400)
    assert env.repo.snapshot() == before


def test_F104_R6_장소_없는_고정_일정은_후보를_빼지_않는다(env):
    _, first = env.browse(env.plant_day(city(), day_plan(fixed=(fixed_event("15:00", "16:00"),))))
    assert ids(first) == FIRST_SIX


# ---------- §10-10 R7: 글만 보낸 첫 답 ----------


def test_F105_R7_글만_보내고_방향이_나오면_200_그_방향으로(env):
    quiet = cafes(6, start=7, crowd=1)
    places = as_dict(cafes(6, crowd=5) + quiet)
    sid = env.session(env.plant_day(places))["session_id"]
    response = env.client.post(f"/planning/{sid}/answer", json={"text": "조용한 데"})
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    assert ids(data) == [p.id for p in quiet]
    assert env.values(sid)["categories"] == []
    assert env.stage(sid) == "browsing"
    assert env.repo.decision_logs()[0]["output"] == {"text": "조용한 데", "direction": "quieter", "understood": True}


def test_F106_R7_글만_보내고_못_알아들으면_200_거르지_않고_되묻지_않는다(env):
    sid = env.session(env.plant_day(city()))["session_id"]
    response = env.client.post(f"/planning/{sid}/answer", json={"text": UNKNOWN_TEXT})
    assert response.status_code == 200
    data = response.json()
    assert_batch_shape(data)
    assert ids(data) == FIRST_SIX
    assert data["clarify"] is None
    assert env.stage(sid) == "browsing"
    assert env.repo.decision_logs()[0]["output"] == {"text": UNKNOWN_TEXT, "direction": None, "understood": False}


@pytest.mark.parametrize("text", ["", "   "], ids=["빈_글", "공백만"])
def test_F107_R7_Q23_글만_보내도_빈_글은_400(env, text):
    sid = env.session(env.plant_day(city()))["session_id"]
    assert_error(env.client.post(f"/planning/{sid}/answer", json={"text": text}), 400)
    assert env.stage(sid) == "asking"


# ---------- §10-10 R8: 엄격한 값 ----------


@pytest.mark.parametrize(
    "delta",
    [15.0, -15.0, "15", True],
    ids=["실수_15", "실수_마이너스_15", "글_15", "참거짓"],
)
def test_F108_R8_delta는_정수만(env, delta):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    body = {"option_id": first_option_id(course), "place_id": "P01", "delta": delta}
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.client.post(f"/planning/{sid}/adjust", json=body), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


@pytest.mark.parametrize("auto", [1, "true", 1.0, "1"], ids=["숫자_1", "글_true", "실수_1", "글_1"])
def test_F109_R8_auto는_true만(env, auto):
    sid = env.session(env.plant_day(city()))["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    assert_error(env.client.post(f"/planning/{sid}/answer", json={"auto": auto}), 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo


# ---------- §10-10 R10: 의존성과 추적 끔 ----------


def test_F110_R10_langchain_core가_의존성에_선언됨():
    project = tomllib.loads((SERVER / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    names = {re.split(r"[\[<>=!~; ]", dep)[0].replace("_", "-").lower() for dep in project["dependencies"]}
    assert "langchain-core" in names


def test_F111_R10_R15_env_example에_추적_끔이_주석이_아닌_줄로_적혀_있다():
    text = (SERVER / ".env.example").read_text(encoding="utf-8")
    assert re.search(r"^LANGSMITH_TRACING=false\s*$", text, re.MULTILINE)


@pytest.mark.parametrize(
    ("before", "after"),
    [(None, "false"), ("true", "false"), ("false", "false")],
    ids=["없으면_false", "true도_false로", "false면_false"],
)
def test_F112_R10_R13_서버_시작_때_추적_값(monkeypatch, reload_main, before, after):
    monkeypatch.setenv("LANGSMITH_TRACING", "원래값-복원용")  # 끝나면 monkeypatch가 원래 환경으로 되돌린다
    if before is None:
        monkeypatch.delenv("LANGSMITH_TRACING")
    else:
        monkeypatch.setenv("LANGSMITH_TRACING", before)
    with TestClient(reload_main(None)):
        assert os.environ.get("LANGSMITH_TRACING") == after


# ---------- §10-11 R11·R12·R15: 응답을 만드는 단계의 예외 ----------

BATCH_BUILDER = "planning.presenter.pick_directions"
COURSE_BUILDER = "planning.presenter.CourseResult"


@pytest.mark.parametrize(
    "body",
    [{}, {"direction_id": "closer"}, {"text": "근처로"}],
    ids=["빈_next", "방향버튼", "알아듣는_글"],
)
def test_F113_R11_R12_next_응답_예외면_round와_skip이_그대로_다시_보내면_한번만(quiet_env, monkeypatch, body):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    fail_and_keep(env, sid, monkeypatch, BATCH_BUILDER, lambda: env.next(sid, **body))
    assert env.values(sid)["round"] == 1
    assert env.values(sid)["batch"] == ids(batch)
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])
    assert env.repo.decision_logs() == []
    assert env.react(sid, "P01").json() == {"picks": ["P01"], "picks_count": 1}
    retried = env.next(sid, **body)
    assert retried.status_code == 200
    assert retried.json()["round"] == 2
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=FIRST_SIX[1:])
    assert env.values(sid)["shown"] == FIRST_SIX + ids(retried.json())
    assert len(env.repo.decision_logs()) == (1 if "text" in body else 0)


def test_F114_R12_되묻기_응답_예외면_횟수와_기록이_그대로_다시_보내면_한번만(quiet_env, monkeypatch):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    send = lambda: env.next(sid, text=UNKNOWN_TEXT)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, BATCH_BUILDER, send)
    assert env.values(sid)["clarify_count"] == 0
    assert env.repo.decision_logs() == []
    retried = send().json()
    assert retried["clarify"]
    assert ids(retried) == ids(batch)
    assert env.values(sid)["clarify_count"] == 1
    assert len(env.repo.decision_logs()) == 1


def test_F115_R12_두번째_못알아들음_응답_예외면_새_묶음이_버려진다(quiet_env, monkeypatch):
    env = quiet_env
    sid, batch = env.browse(env.plant_day(city()))
    assert env.next(sid, text=UNKNOWN_TEXT).status_code == 200
    send = lambda: env.next(sid, text=UNKNOWN_TEXT)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, BATCH_BUILDER, send)
    assert env.values(sid)["clarify_count"] == 1
    assert env.values(sid)["round"] == 1
    assert env.repo.reactions(sid) == Reactions(liked=[], skipped=[])
    retried = send().json()
    assert retried["round"] == 2
    assert not set(ids(retried)) & set(ids(batch))


def test_F116_R11_R12_compose_응답_예외면_browsing_유지_다음_like_정상_다시_보내면_정상(quiet_env, monkeypatch):
    env = quiet_env
    places = city()
    plan = day_plan()
    sid, _ = env.browse(env.plant_day(places, plan))
    env.react(sid, "P01")
    fail_and_keep(env, sid, monkeypatch, COURSE_BUILDER, lambda: env.compose(sid))
    assert env.stage(sid) == "browsing"
    assert env.repo.reactions(sid) == Reactions(liked=["P01"], skipped=[])
    assert env.values(sid)["option_ids"] == []
    assert env.react(sid, "P02").json() == {"picks": ["P01", "P02"], "picks_count": 2}
    assert env.stage(sid) == "browsing"
    retried = env.compose(sid)
    assert retried.status_code == 200
    assert without_option_id(retried.json()) == dumped(compose_courses(plan, ["P01", "P02"], places))
    assert env.stage(sid) == "composing"


def test_F117_R12_adjust_응답_예외면_값과_코스안이_그대로_다시_보내면_한번만(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    option_id = first_option_id(course)
    send = lambda: env.adjust(sid, option_id, "P01", 15)  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, COURSE_BUILDER, send)
    assert env.values(sid)["option_ids"] == [o["option_id"] for o in course["options"]]
    retried = send()
    assert retried.status_code == 200
    assert {item_of(o, "P01")["stay_min"] for o in retried.json()["options"]} == {75}


def test_F118_R12_answer_응답_예외면_asking_유지_다시_보내면_한번만(quiet_env, monkeypatch):
    env = quiet_env
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    send = lambda: env.answer(session, [], "조용한 데")  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, BATCH_BUILDER, send)
    assert env.stage(sid) == "asking"
    assert env.repo.decision_logs() == []
    retried = send()
    assert retried.status_code == 200
    assert retried.json()["round"] == 1
    assert env.stage(sid) == "browsing"
    assert len(env.repo.decision_logs()) == 1


def test_F119_R12_back_응답_예외면_composing_유지_다시_보내면_한번만(quiet_env, monkeypatch):
    env = quiet_env
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    fail_and_keep(env, sid, monkeypatch, BATCH_BUILDER, lambda: env.back(sid))
    assert env.stage(sid) == "composing"
    assert env.values(sid)["round"] == 1
    assert env.values(sid)["option_ids"] == [o["option_id"] for o in course["options"]]
    assert env.adjust(sid, first_option_id(course), "P01", 15).status_code == 200
    retried = env.back(sid)
    assert retried.status_code == 200
    assert retried.json()["round"] == 2
    assert env.stage(sid) == "browsing"


def test_F120_R11_R12_자동_시작_응답_예외면_세션을_안_만들고_다음_시작은_정상(quiet_env, monkeypatch):
    env = quiet_env
    day_id = env.plant_day(city())
    before = env.repo.snapshot()
    with monkeypatch.context() as patch:
        patch.setattr(COURSE_BUILDER, raise_forced)
        response = env.start(day_id, mode="auto")
    assert_error(response, 500)
    assert env.repo.snapshot() == before
    retried = env.start(day_id, mode="auto")
    assert retried.status_code == 201
    assert_course_shape(retried.json())


def test_F121_R12_asking의_자동_응답_예외면_asking_유지_대화로_이어_간다(quiet_env, monkeypatch):
    env = quiet_env
    session = env.session(env.plant_day(city()))
    sid = session["session_id"]
    send = lambda: env.client.post(f"/planning/{sid}/answer", json={"auto": True})  # noqa: E731
    fail_and_keep(env, sid, monkeypatch, COURSE_BUILDER, send)
    assert env.stage(sid) == "asking"
    assert env.answer(session).status_code == 200
    assert env.stage(sid) == "browsing"


def test_F122_R11_ErrorBody_설명에_code_5개(env):
    from planning.schemas import ErrorBody

    codes = ["NOT_FOUND", "INVALID_REQUEST", "STATE_CONFLICT", "COURSE_INFEASIBLE", "INTERNAL_ERROR"]
    model_text = json.dumps(ErrorBody.model_json_schema(), ensure_ascii=False)
    committed_text = json.dumps(committed_openapi()["components"]["schemas"]["ErrorBody"], ensure_ascii=False)
    for code in codes:
        assert code in model_text
        assert code in committed_text


# ---------- §10-11 R13: 추적 강제로 끔 ----------

TRACING_VARS = ["LANGSMITH_TRACING", "LANGSMITH_TRACING_V2", "LANGCHAIN_TRACING_V2"]


def clear_langsmith_cache():
    import langsmith.utils

    cached = getattr(langsmith.utils, "get_env_var", None)
    if hasattr(cached, "cache_clear"):
        cached.cache_clear()


@pytest.mark.parametrize(
    "turned_on",
    [TRACING_VARS, *([name] for name in TRACING_VARS)],
    ids=["셋_다_true", *TRACING_VARS],
)
def test_F123_R13_true로_시작해도_세_변수가_false이고_추적이_꺼져_있다(monkeypatch, reload_main, turned_on):
    from langsmith.utils import tracing_is_enabled

    for name in TRACING_VARS:
        monkeypatch.setenv(name, "true" if name in turned_on else "원래값-복원용")
        if name not in turned_on:
            monkeypatch.delenv(name)
    clear_langsmith_cache()
    try:
        with TestClient(reload_main(None)):
            assert {name: os.environ.get(name) for name in TRACING_VARS} == dict.fromkeys(TRACING_VARS, "false")
            assert tracing_is_enabled() is False
    finally:
        clear_langsmith_cache()


# ---------- §10-11 R14: 모든 HTTP 오류 ----------


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        ("post", "/health", 405),
        ("get", "/debug/seed-demo", 405),
        ("get", "/planning/없는-세션/next", 405),
        ("delete", "/days/없는-날/planning", 405),
        ("put", "/course-options/없는-코스안/select", 405),
        ("post", "/없는-경로", 404),
    ],
    ids=["POST_health", "GET_시드", "GET_next", "DELETE_세션_시작", "PUT_select", "없는_경로는_404"],
)
def test_F124_R14_R2_없는_메서드와_없는_경로_모두_공통_형식(env, method, path, status):
    assert_error(getattr(env.client, method)(path), status)


# ---------- §10-11 받아들임: 명시 null, 자동 + 글 ----------


@pytest.mark.parametrize(
    "body",
    [
        {"auto": True, "text": None},
        {"auto": True, "choice_ids": None},
        {"auto": True, "choice_ids": None, "text": None},
    ],
    ids=["자동과_글_null", "자동과_칩_null", "자동과_둘_다_null"],
)
def test_F126_받아들임_자동의_명시_null은_빠진_것과_같다(env, body):
    sid = env.session(env.plant_day(city()))["session_id"]
    response = env.client.post(f"/planning/{sid}/answer", json=body)
    assert response.status_code == 200
    assert_course_shape(response.json())
    assert env.stage(sid) == "composing"


@pytest.mark.parametrize(
    "body",
    [{"choice_ids": [], "text": None}, {"choice_ids": [], "auto": None}, {"choice_ids": None, "text": "조용한 데"}],
    ids=["글_null", "auto_null", "칩_null_글_있음"],
)
def test_F127_받아들임_첫_답의_명시_null은_빠진_것과_같다(env, body):
    sid = env.session(env.plant_day(city()))["session_id"]
    response = env.client.post(f"/planning/{sid}/answer", json=body)
    assert response.status_code == 200
    assert_batch_shape(response.json())


def test_F128_받아들임_next의_명시_null은_빈_next와_같다(env):
    sid, _ = env.browse(env.plant_day(city()))
    response = env.client.post(f"/planning/{sid}/next", json={"direction_id": None, "text": None})
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "다른 곳들도 찾아봤어"
    assert data["clarify"] is None
    assert data["round"] == 2
    assert env.repo.decision_logs() == []


@pytest.mark.parametrize(
    ("direction_id", "text"),
    [("closer", None), (None, "근처로")],
    ids=["방향만_값", "글만_값"],
)
def test_F129_받아들임_한쪽만_null이면_다른_쪽으로_처리(env, direction_id, text):
    sid, _ = env.browse(env.plant_day(city()))
    response = env.client.post(f"/planning/{sid}/next", json={"direction_id": direction_id, "text": text})
    assert response.status_code == 200
    assert env.values(sid)["last_direction"] == "closer"


@pytest.mark.parametrize(
    "body",
    [{"text": None}, {"choice_ids": None}, {"auto": None}],
    ids=["글_null만", "칩_null만", "auto_null만"],
)
def test_F130_받아들임_전부_null인_첫_답은_빈_본문처럼_400(env, body):
    sid = env.session(env.plant_day(city()))["session_id"]
    assert_error(env.client.post(f"/planning/{sid}/answer", json=body), 400)
    assert env.stage(sid) == "asking"


def test_F131_받아들임_자동과_글을_함께_보내면_400(env):
    sid = env.session(env.plant_day(city()))["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    response = env.client.post(f"/planning/{sid}/answer", json={"auto": True, "text": "x"})
    assert_error(response, 400)
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
