"""코스 계산 안전장치. 근거: TASK-005 §A(A3·A4·A5·A6), §4, §5, §6 AC-3·AC-4, §7, §9(우선). TASK-002 동작은 test_compose_courses.py가 본다.

N은 꼭 갈 곳 + 고정 일정 + 담은 곳을 중복 없이 센 값이다 (§9 Q2·Q12·Q13). 상한은 12 (§9 Q1).
시간을 재는 테스트는 `slow`라 기본 실행에서 빠진다. `uv run pytest -m slow`로 돌린다 (§9-4).
"""

import json
import random
import statistics
import subprocess
import sys
import time
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_api_helpers import FIXED_STAY, assert_course_shape, assert_error, first_option_id
from planning_helpers import as_places, day_plan, fixed_event, hhmm, opening, place
from test_compose_courses import assert_all_valid, options, visits

import evals.dp_vs_greedy as dp_vs_greedy
from engine.models import DayPlan, Infeasible, Opening, Place, StayRange
from engine.planning import compose_courses
from planning.seed import seed_demo

SERVER_ROOT = Path(__file__).parents[1]
GOLDEN = Path(__file__).parent / "fixtures" / "task005_regression_golden.json"
CAP = 12  # §9 Q1
LIMIT_SECONDS = 2.0  # §9 Q1
HANG_GUARD_SECONDS = 15  # 문서 값이 아니다. 지금 코드가 N=25에서 테스트를 멈추지 않게 하는 안전 줄


def long_day(**kw) -> DayPlan:
    """머물 시간이 넉넉한 하루. 잘리는 이유가 "진짜 시간 부족"이 아님을 보려고 쓴다."""
    return day_plan(start="00:00", end="29:59", **kw)


def spots(count: int, first: int = 1, prefix: str = "D", **kw) -> list[Place]:
    """같은 자리 카페. 어떤 순서로도 긴 하루에 다 들어간다."""
    return [place(f"{prefix}{i:02d}", **kw) for i in range(first, first + count)]


def scattered(count: int, seed: int = 7, make=lambda _r, _i: {}) -> list[Place]:
    r = random.Random(seed)
    return [
        place(f"D{i:02d}", km=r.uniform(-1, 1), east_km=r.uniform(-1, 1), **make(r, i)) for i in range(1, count + 1)
    ]


def fixed_rows(count: int) -> tuple:
    """장소 없는 고정 일정 count개: 매시 정각부터 30분."""
    return tuple(fixed_event(hhmm(60 * (i + 1)), hhmm(60 * (i + 1) + 30), fid=f"F{i:02d}") for i in range(count))


def setup(musts: int, fixed: int, picks: int, changed: int = 0) -> tuple[DayPlan, list[str], dict[str, Place]]:
    """담은 곳 중 앞의 changed곳은 사용자가 머문 시간을 바꾼 곳."""
    must_places = spots(musts, prefix="M")
    pick_places = spots(picks, prefix="P")
    overrides = {p.id: 30 for p in pick_places[:changed]}
    plan = long_day(must=tuple(p.id for p in must_places), fixed=fixed_rows(fixed), overrides=overrides)
    return plan, [p.id for p in pick_places], as_places(*must_places, *pick_places)


def same_venue_rows(venue: Place, count: int) -> tuple:
    """같은 장소에서 열리는 고정 일정 count개: 01:00부터 30분마다 15분. 고정 일정 id는 각각 다르다."""
    return tuple(fixed_event(hhmm(60 + 30 * i), hhmm(75 + 30 * i), venue, fid=f"S{i:02d}") for i in range(count))


def same_venue_setup(musts: int, events: int, picks: int) -> tuple[DayPlan, list[str], dict[str, Place]]:
    """꼭 갈 곳 + 담은 곳 + 어디에도 안 담은 장소 V01의 고정 일정 events개."""
    venue = place("V01")
    must_places = spots(musts, prefix="M")
    pick_places = spots(picks, prefix="P")
    plan = long_day(must=tuple(p.id for p in must_places), fixed=same_venue_rows(venue, events))
    return plan, [p.id for p in pick_places], as_places(venue, *must_places, *pick_places)


def same_venue_short_day(musts: int, events: int, picks: int) -> tuple[DayPlan, list[str], dict[str, Place]]:
    """하루가 16:00에 끝나 담은 곳이 다 못 들어간다. 빠진 곳의 이유를 가를 때 고정 일정 수만큼 갈래가 2배씩 는다 (`_Day.fits`)."""
    plan, chosen, places = same_venue_setup(musts, events, picks)
    return plan.model_copy(update={"end": "16:00"}), chosen, places


def assert_cut(plan: DayPlan, picks: list[str], places: dict[str, Place], result, cut: list[str]) -> None:
    """모든 안에서 cut의 곳만 빠지고, 이유는 no_time, 꼭 갈 곳은 그대로."""
    assert_all_valid(plan, picks, places, result)
    for option in options(result):
        assert sorted((d.place_id, d.reason) for d in option.dropped) == sorted((pid, "no_time") for pid in cut)
        assert set(plan.must_visit) <= set(visits(option))
        assert set(visits(option)) == (set(plan.must_visit) | set(picks)) - set(cut)


def too_many(result) -> Infeasible:
    assert isinstance(result, Infeasible), f"Infeasible이어야 하는데 {result!r}"
    assert result.reason == "too_many_places"
    return result


# ---------- A3: 하루 꼭 갈 곳 5곳 ----------


def make_plan(musts: int) -> DayPlan:
    return day_plan(must=tuple(f"M{i:02d}" for i in range(1, musts + 1)))


@pytest.mark.parametrize("musts", [0, 1, 5], ids=["없음", "데모_시드와_같은_1곳", "경계_5곳"])
def test_T5_A3_꼭갈곳_5곳까지는_DayPlan이_만들어진다(musts):
    assert len(make_plan(musts).must_visit) == musts


@pytest.mark.parametrize("musts", [6, 7, 25], ids=["경계_6곳", "7곳", "멈춤이_재현된_25곳"])
def test_T5_A3_S4_꼭갈곳_6곳_이상이면_ValueError(musts):
    with pytest.raises(ValueError):
        make_plan(musts)


@settings(max_examples=30, deadline=None)
@given(st.integers(0, 30))
def test_T5_A3_어떤_수든_5곳까지만_받는다(musts):
    if musts <= 5:
        assert len(make_plan(musts).must_visit) == musts
    else:
        with pytest.raises(ValueError):
            make_plan(musts)


def test_T5_S9_Q12_꼭갈곳_안의_중복은_한_번만_세어_서로_다른_5곳이면_받는다():
    plan = day_plan(must=("M01", "M01", "M02", "M03", "M04", "M05"))
    assert len(plan.must_visit) == 6


def test_T5_S9_Q12_중복을_빼고_6곳이면_ValueError():
    with pytest.raises(ValueError):
        day_plan(must=("M01", "M01", "M02", "M03", "M04", "M05", "M06"))


def test_T5_S4_데모_시드는_꼭갈곳_상한의_영향을_받지_않는다(env):
    seeded = seed_demo(env.repo)
    musts = [len(env.repo.get_day(day_id).plan.must_visit) for day_id in seeded.day_ids]
    assert musts == [0, 1, 0]


# ---------- §5 1줄: A3이 A4보다 먼저 ----------


def test_T5_S5_꼭갈곳_6곳에_고정일정_8개면_too_many_places가_아니라_입력에서_ValueError():
    with pytest.raises(ValueError):
        setup(6, 8, 0)


# ---------- A4 + §9 Q1·Q2: 꼭 갈 곳 + 고정 일정만으로 12 초과 ----------


@pytest.mark.parametrize(
    "musts, fixed",
    [(5, 8), (4, 9), (0, 13)],
    ids=["꼭갈곳5_고정8", "꼭갈곳4_고정9", "고정13"],
)
@pytest.mark.parametrize("picks", [0, 3], ids=["담은곳_없음", "담은곳_3"])
def test_T5_A4_S9_Q1_꼭갈곳과_고정일정_합이_13이면_too_many_places(musts, fixed, picks):
    plan, chosen, places = setup(musts, fixed, picks)
    too_many(compose_courses(plan, chosen, places))


@pytest.mark.parametrize(
    "musts, fixed",
    [(5, 7), (4, 8), (0, 12)],
    ids=["꼭갈곳5_고정7", "꼭갈곳4_고정8", "고정12"],
)
def test_T5_A4_S9_Q1_꼭갈곳과_고정일정_합이_12면_계산한다(musts, fixed):
    plan, chosen, places = setup(musts, fixed, 0)
    result = compose_courses(plan, chosen, places)
    assert_all_valid(plan, chosen, places, result)
    for option in options(result):
        assert len(visits(option)) == musts
        assert option.dropped == []


# ---------- §9 Q10: too_many_places의 blocking·suggest_drop ----------


@pytest.mark.parametrize(
    "musts, fixed, changed, suggest",
    [
        (5, 8, 0, ["M05"]),
        (5, 9, 0, ["M04", "M05"]),
        (5, 7, 1, ["M05"]),
        (1, 13, 0, ["M01"]),
        (0, 13, 0, []),
        (0, 0, 13, []),
    ],
    ids=["1곳_넘침", "2곳_넘침", "바꾼_곳_때문에_넘침", "넘친_수가_꼭갈곳보다_많음", "꼭갈곳_없음_고정만", "꼭갈곳_없음_바꾼_곳만"],
)
def test_T5_S9_Q10_blocking은_전부_suggest_drop은_꼭갈곳_뒤에서_넘친_수만큼(musts, fixed, changed, suggest):
    plan, chosen, places = setup(musts, fixed, changed, changed=changed)
    result = too_many(compose_courses(plan, chosen, places))
    expected = {*plan.must_visit, *(f.id for f in plan.fixed), *plan.stay_overrides}
    assert sorted(result.blocking) == sorted(expected)
    assert sorted(result.suggest_drop) == suggest


def test_T5_S9_Q10_뒤는_id가_아니라_꼭갈곳_목록의_뒤():
    items = spots(5, prefix="M")
    plan = long_day(must=("M05", "M04", "M03", "M02", "M01"), fixed=fixed_rows(8))
    assert too_many(compose_courses(plan, [], as_places(*items))).suggest_drop == ["M01"]


def test_T5_S9_Q10_담은_곳은_바꾸지_않았으면_blocking에_넣지_않는다():
    plan, chosen, places = setup(5, 8, 2)
    result = too_many(compose_courses(plan, chosen, places))
    assert not set(result.blocking) & set(chosen)


# ---------- §9 Q11: 실패 순서 ----------


def test_T5_S9_Q11_없는_장소_id가_too_many_places보다_먼저():
    plan, _, places = setup(5, 8, 0)
    with pytest.raises(ValueError):
        compose_courses(plan, ["없는곳"], places)


def test_T5_S9_Q11_고정일정_겹침이_too_many_places보다_먼저():
    items = spots(5, prefix="M")
    overlap = fixed_event("01:10", "01:20", fid="겹침")
    plan = long_day(must=tuple(p.id for p in items), fixed=(*fixed_rows(8), overlap))
    with pytest.raises(ValueError):
        compose_courses(plan, [], as_places(*items))


def test_T5_S9_Q11_too_many_places가_must_visit_closed보다_먼저이고_닫힌_꼭갈곳도_센다():
    items = [place("M01", hours=opening("09:00", "20:00", 1)), *spots(4, first=2, prefix="M")]
    plan = long_day(must=tuple(p.id for p in items), fixed=fixed_rows(8))
    too_many(compose_courses(plan, [], as_places(*items)))


def test_T5_S9_Q11_합이_12면_닫힌_꼭갈곳은_그대로_must_visit_closed():
    items = [place("M01", hours=opening("09:00", "20:00", 1)), *spots(4, first=2, prefix="M")]
    plan = long_day(must=tuple(p.id for p in items), fixed=fixed_rows(7))
    result = compose_courses(plan, [], as_places(*items))
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_closed"


def test_T5_S9_Q11_too_many_places가_fixed_unreachable보다_먼저():
    venue = place("V01", km=1.21)  # 숙소에서 14분이라 00:13 시작이면 못 간다
    items = spots(5, prefix="M")
    far = fixed_event("00:13", "00:40", venue, fid="먼곳")
    plan = long_day(must=tuple(p.id for p in items), fixed=(far, *fixed_rows(7)))
    too_many(compose_courses(plan, [], as_places(venue, *items)))


@pytest.mark.skip(reason="질문: §9 Q11과 TASK-002 §9 Q44(test_Q44_Infeasible_순서_fixed_unreachable이_must_visit_closed보다_먼저)가 반대. 답이 오면 푼다")
def test_T5_S9_Q11_must_visit_closed가_fixed_unreachable보다_먼저():
    venue = place("D09", km=1.21)
    places = as_places(venue, place("D01", hours=opening("09:00", "20:00", 1)))
    plan = day_plan(fixed=(fixed_event("09:13", "10:00", venue),), must=("D01",))
    assert compose_courses(plan, [], places).reason == "must_visit_closed"


# ---------- A4 + §9 Q1·Q3: 담은 곳 때문에 12 초과 ----------


@pytest.mark.parametrize(
    "musts, picks",
    [(0, 12), (1, 11), (5, 7)],
    ids=["담은곳12", "꼭갈곳1_담은곳11", "꼭갈곳5_담은곳7"],
)
def test_T5_A4_S9_Q1_N이_12면_아무것도_자르지_않는다(musts, picks):
    plan, chosen, places = setup(musts, 0, picks)
    result = compose_courses(plan, chosen, places)
    assert_all_valid(plan, chosen, places, result)
    for option in options(result):
        assert option.dropped == []
        assert len(visits(option)) == CAP


@pytest.mark.parametrize(
    "musts, picks",
    [(0, 13), (5, 8)],
    ids=["담은곳13", "꼭갈곳5_담은곳8"],
)
def test_T5_A4_S4_S9_Q3_N이_13이면_시간이_남아도_맨_뒤에_담은_곳이_no_time으로_잘린다(musts, picks):
    plan, chosen, places = setup(musts, 0, picks)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), chosen[-1:])


@pytest.mark.parametrize(
    "musts, fixed, picks, cut",
    [(5, 6, 2, 1), (5, 6, 3, 2), (5, 7, 1, 1), (5, 7, 3, 3)],
    ids=["고정6_합13", "고정6_합14", "고정7_합13", "고정7_담은곳_전부_잘림"],
)
def test_T5_A4_S9_Q2_고정일정도_N에_들어가_담은곳이_잘린다(musts, fixed, picks, cut):
    plan, chosen, places = setup(musts, fixed, picks)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), chosen[-cut:])


def test_T5_S5_S9_Q4_자르기는_한_번만_N이_13이면_정확히_1곳만_빠진다():
    # 코드에 기존 제한이 없다 (§9 Q4). 이중으로 자르면 11곳이 된다
    plan, chosen, places = setup(0, 0, 13)
    for option in options(compose_courses(plan, chosen, places)):
        assert len(visits(option)) == CAP


def test_T5_S9_Q3_뒤는_id가_아니라_담은_순서의_뒤():
    items = spots(14)
    picks = [p.id for p in reversed(items)]  # D14 ... D01
    plan = long_day()
    assert_cut(plan, picks, as_places(*items), compose_courses(plan, picks, as_places(*items)), ["D02", "D01"])


@pytest.mark.parametrize(
    "picks, changed, cut",
    [
        (["P01", "P02", "P03"], ["P03"], ["P02"]),
        (["P01", "P02", "P03"], ["P02", "P03"], ["P01"]),
        (["P03", "P01", "P02"], ["P02"], ["P01"]),
    ],
    ids=["맨_뒤를_바꿈", "뒤의_둘을_바꿈", "담은_순서가_id와_다름"],
)
def test_T5_S9_Q3_Q5_머문_시간을_바꾼_곳은_건너뛰고_그_앞을_자른다(picks, changed, cut):
    # 꼭 갈 곳 5 + 고정 일정 5 + 담은 곳 3 = 13
    musts = spots(5, prefix="M")
    items = spots(3, prefix="P")
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(5), overrides={pid: 30 for pid in changed})
    places = as_places(*musts, *items)
    assert_cut(plan, picks, places, compose_courses(plan, picks, places), cut)


def test_T5_S9_Q3_꼭갈곳이_담은_곳_맨_뒤에_있어도_자르지_않는다():
    items = spots(13)
    picks = [p.id for p in items]
    plan = long_day(must=("D13",))
    assert_cut(plan, picks, as_places(*items), compose_courses(plan, picks, as_places(*items)), ["D12"])


def test_T5_S9_Q5_바꾼_곳까지_합쳐_13이면_too_many_places():
    plan, chosen, places = setup(5, 7, 1, changed=1)
    too_many(compose_courses(plan, chosen, places))


def test_T5_S9_Q5_바꾼_곳까지_합쳐_12면_바꾼_곳은_남고_안_바꾼_곳이_잘린다():
    plan, chosen, places = setup(5, 6, 2, changed=1)
    assert chosen == ["P01", "P02"]
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), ["P02"])


def test_T5_S9_Q5_바꾼_곳만_12곳이면_나머지가_모두_잘린다():
    plan, chosen, places = setup(0, 0, 15, changed=12)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), chosen[12:])


def test_T5_S9_Q5_꼭갈곳의_머문_시간을_바꿔도_한_번만_센다():
    plan, chosen, places = setup(5, 7, 0)
    plan = plan.model_copy(update={"stay_overrides": {"M01": 30}})
    assert_all_valid(plan, chosen, places, compose_courses(plan, chosen, places))


def test_T5_S9_Q5_담지_않은_곳의_바꾼_값은_세지_않는다():
    # TASK-002 §9 Q43: 담은 곳·꼭 갈 곳이 아니면 무시
    plan, chosen, places = setup(5, 7, 0)
    plan = plan.model_copy(update={"stay_overrides": {"없는곳": 30}})
    assert_all_valid(plan, chosen, places, compose_courses(plan, chosen, places))


# ---------- §9 Q12·Q13: 중복은 한 번만 ----------


def test_T5_S9_Q13_꼭갈곳이_담은곳에도_있으면_한_번만_센다():
    items = spots(12)
    plan = long_day(must=("D01",))
    picks = [p.id for p in items]
    for option in options(compose_courses(plan, picks, as_places(*items))):
        assert option.dropped == []
        assert len(visits(option)) == CAP


def test_T5_S9_Q12_담은곳_안의_중복은_한_번만_센다():
    items = spots(12)
    picks = [*(p.id for p in items), "D01"]
    for option in options(compose_courses(long_day(), picks, as_places(*items))):
        assert option.dropped == []
        assert len(visits(option)) == CAP


def test_T5_S9_Q12_꼭갈곳_안의_중복은_too_many에서도_한_번만_센다():
    items = spots(5, prefix="M")
    plan = long_day(must=("M01", "M01", "M02", "M03", "M04", "M05"), fixed=fixed_rows(7))
    assert isinstance(compose_courses(plan, [], as_places(*items)), list)


def test_T5_S9_Q13_꼭갈곳이_고정일정_장소이면_한_번만_세어_too_many가_아니다():
    # 꼭 갈 곳 5 + 고정 일정 8, 그중 하나가 꼭 갈 곳 M05에서 열림 = 서로 다른 12
    items = spots(5, prefix="M")
    at_must = fixed_event("20:00", "20:30", items[4], fid="F99")
    plan = long_day(must=tuple(p.id for p in items), fixed=(*fixed_rows(7), at_must))
    assert isinstance(compose_courses(plan, [], as_places(*items)), list)


def test_T5_S9_Q13_담은곳이_고정일정_장소이면_한_번만_세어_자르지_않는다():
    # 꼭 갈 곳 5 + 고정 일정 6 + 담은 곳 2, 담은 곳 P01이 고정 일정 장소 = 서로 다른 12
    musts = spots(5, prefix="M")
    picks = spots(2, prefix="P")
    at_pick = fixed_event("20:00", "20:30", picks[0], fid="F99")
    plan = long_day(must=tuple(p.id for p in musts), fixed=(*fixed_rows(5), at_pick))
    result = compose_courses(plan, ["P01", "P02"], as_places(*musts, *picks))
    for option in options(result):
        assert option.dropped == []
        assert "P02" in visits(option)


# ---------- §9 Q2: 같은 장소 고정 일정은 각각 센다 (Q12·Q13의 "중복 id"는 id가 같을 때뿐) ----------


@pytest.mark.parametrize(
    "picks, events, cut",
    [(10, 2, 0), (11, 2, 1), (10, 3, 1), (11, 3, 2)],
    ids=["합12_안_잘림", "담은곳11_고정2_합13", "담은곳10_고정3_합13", "담은곳11_고정3_합14"],
)
def test_T5_S9_Q2_같은_장소_고정일정도_각각_세어_담은곳이_잘린다(picks, events, cut):
    plan, chosen, places = same_venue_setup(0, events, picks)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), chosen[picks - cut :])


def test_T5_S9_Q2_꼭갈곳과_같은_장소_고정일정_합이_12면_계산한다():
    plan, chosen, places = same_venue_setup(5, 7, 0)
    assert isinstance(compose_courses(plan, chosen, places), list)


@pytest.mark.parametrize("musts, events", [(5, 8), (1, 12), (0, 13)], ids=["꼭갈곳5_고정8", "꼭갈곳1_고정12", "고정13"])
def test_T5_S9_Q2_꼭갈곳과_같은_장소_고정일정_합이_13이면_too_many_places(musts, events):
    plan, chosen, places = same_venue_setup(musts, events, 0)
    result = too_many(compose_courses(plan, chosen, places))
    assert sorted(result.blocking) == sorted({*plan.must_visit, *(f.id for f in plan.fixed)})


def test_T5_S9_Q2_담은곳_11에_같은_장소_고정일정_28개도_멈추지_않고_too_many_places():
    assert run_in_child(0, 28, 11, build="same_venue_short_day") == {"reason": "too_many_places"}


@pytest.mark.parametrize("events, is_too_many", [(8, False), (9, True)], ids=["합12", "합13"])
def test_T5_S9_Q13_같은_장소_고정일정의_장소가_꼭갈곳이면_그_사이만_한_번_센다(events, is_too_many):
    # 꼭 갈 곳 5곳 중 V01이 고정 일정 장소: 꼭 갈 곳 4 + 고정 일정 events개
    venue = place("V01")
    musts = spots(4, prefix="M")
    plan = long_day(must=("V01", *(p.id for p in musts)), fixed=same_venue_rows(venue, events))
    result = compose_courses(plan, [], as_places(venue, *musts))
    if is_too_many:
        too_many(result)
    else:
        assert isinstance(result, list)


@pytest.mark.parametrize("picks, cut", [(10, []), (11, ["P11"])], ids=["합12", "합13"])
def test_T5_S9_Q13_같은_장소_고정일정의_장소가_담은곳이면_그_사이만_한_번_센다(picks, cut):
    # 담은 곳 picks곳 + V01(고정 일정 장소) + 고정 일정 2개
    venue = place("V01")
    items = spots(picks, prefix="P")
    plan = long_day(fixed=same_venue_rows(venue, 2))
    chosen = ["V01", *(p.id for p in items)]
    for option in options(compose_courses(plan, chosen, as_places(venue, *items))):
        assert [d.place_id for d in option.dropped] == cut
        assert "V01" not in visits(option)


# ---------- A4 "DP에 들어가는 N" ----------


def test_T5_A4_DP에_못_들어가는_닫힌_곳은_N에_세지_않는다():
    # 담은 곳 13곳 중 닫힌 곳 1곳은 DP 전에 빠지므로 N=12라 더 자르지 않는다
    closed = place("D13", hours=opening("09:00", "20:00", 1))
    items = [*spots(12), closed]
    picks = [p.id for p in items]
    for option in options(compose_courses(long_day(), picks, as_places(*items))):
        assert len(visits(option)) == CAP
        assert [(d.place_id, d.reason) for d in option.dropped] == [("D13", "closed_at_time")]


def test_T5_A4_S9_Q3_닫힌_곳을_뺀_뒤에도_넘치면_나머지의_뒤부터_자른다():
    closed = place("D14", hours=opening("09:00", "20:00", 1))
    items = [*spots(13), closed]
    picks = [p.id for p in items]
    for option in options(compose_courses(long_day(), picks, as_places(*items))):
        assert sorted((d.place_id, d.reason) for d in option.dropped) == [("D13", "no_time"), ("D14", "closed_at_time")]


@settings(max_examples=40, deadline=None)
@given(st.integers(0, 5), st.integers(0, 13), st.integers(0, 4), st.integers(0, 4))
def test_T5_A4_S9_임의의_수에서_too_many_자르기_그대로를_가른다(musts, fixed, picks, changed):
    changed = min(changed, picks)
    plan, chosen, places = setup(musts, fixed, picks, changed=changed)
    result = compose_courses(plan, chosen, places)
    if musts + fixed + changed > CAP:
        too_many(result)
        return
    over = max(0, musts + fixed + picks - CAP)
    assert_cut(plan, chosen, places, result, chosen[picks - over :])


def run_in_child(musts: int, fixed: int, picks: int, build: str = "setup") -> dict:
    """지금 코드는 N=25에서 몇 분 멈춘다 (TASK-004 §14). pytest가 멈추지 않게 자식 프로세스로 돌리고 시간이 지나면 그 자식만 끈다."""
    script = f"""
import json, sys
sys.path.insert(0, "tests")
from test_task005_safety import {build}
from engine.models import Infeasible
from engine.planning import compose_courses
plan, chosen, places = {build}({musts}, {fixed}, {picks})
result = compose_courses(plan, chosen, places)
if isinstance(result, Infeasible):
    print(json.dumps({{"reason": result.reason}}))
else:
    print(json.dumps({{"visits": [len([i for i in o.items if not i.is_fixed]) for o in result],
                      "reasons": [sorted({{d.reason for d in o.dropped}}) for o in result]}}))
"""
    try:
        done = subprocess.run(
            [sys.executable, "-c", script], cwd=SERVER_ROOT, capture_output=True, text=True, timeout=HANG_GUARD_SECONDS
        )
    except subprocess.TimeoutExpired:
        pytest.fail(f"N={musts + fixed + picks}이 {HANG_GUARD_SECONDS}초 안에 끝나지 않음 (DP 상한이 없음)")
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_T5_A4_담은곳_25곳도_멈추지_않고_12곳으로_계산한다():
    outcome = run_in_child(0, 0, 25)
    assert outcome["visits"] and all(count == CAP for count in outcome["visits"])
    assert all(reasons == ["no_time"] for reasons in outcome["reasons"])


def test_T5_A4_too_many_places면_담은곳이_많아도_계산하지_않는다():
    assert run_in_child(5, 8, 20) == {"reason": "too_many_places"}


# ---------- §9 Q20: DP vs 탐욕법 ----------


def test_T5_S9_Q20_AC18_측정은_자른_뒤_같은_입력으로_DP가_탐욕법보다_적지_않다(monkeypatch):
    # 다 들어가는 담은 곳 13곳: DP만 12곳으로 자르고 탐욕법은 13곳을 넣으면 DP가 적게 나온다
    items = spots(13)
    monkeypatch.setattr(dp_vs_greedy, "_demo_places", lambda: as_places(*items))
    monkeypatch.setattr(dp_vs_greedy, "generate_cases", lambda _count=1: [(long_day(), [p.id for p in items])])
    assert dp_vs_greedy.measure(1)["dp_fewer_count"] == 0


# ---------- A5: API 422, 상태·저장소 그대로 ----------


def planted(env, fixed: int) -> str:
    """꼭 갈 곳 5 + 고정 일정 fixed개. 후보 8곳은 따로 있다."""
    musts = spots(5, prefix="M", stay=FIXED_STAY)
    others = spots(8, prefix="P", stay=FIXED_STAY)
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(fixed))
    return env.plant_day(as_places(*musts, *others), plan)


def assert_too_many(response) -> None:
    error = assert_error(response, 422, "COURSE_INFEASIBLE")
    assert error["detail"]["reason"] == "too_many_places"
    assert error["detail"]["suggest_drop"] == ["M05"]  # §9 Q10: 1곳 넘침
    assert len(error["detail"]["blocking"]) == 13


def test_T5_A5_S4_코스_짜기가_too_many_places면_422이고_상태와_저장소_그대로(env):
    sid, _ = env.browse(planted(env, 8))
    state, repo = env.values(sid), env.repo.snapshot()
    before = env.client.get(f"/planning/{sid}").json()
    assert_too_many(env.compose(sid))
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.client.get(f"/planning/{sid}").json() == before


def test_T5_A5_S4_알아서_짜_줘가_too_many_places면_422이고_첫_질문_그대로(env):
    session = env.session(planted(env, 8))
    sid = session["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    assert_too_many(env.client.post(f"/planning/{sid}/answer", json={"auto": True}))
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.client.get(f"/planning/{sid}").json() == session


def test_T5_A5_S4_자동_시작이_too_many_places면_422이고_세션을_남기지_않는다(env):
    day_id = planted(env, 8)
    repo = env.repo.snapshot()
    assert_too_many(env.start(day_id, mode="auto"))
    assert env.repo.snapshot() == repo


def test_T5_A5_꼭갈곳과_고정일정_합이_12면_API는_200(env):
    _, course = env.composing(planted(env, 7))
    assert_course_shape(course)
    assert all(option["dropped"] == [] for option in course["options"])


@pytest.mark.parametrize(
    "likes, dropped",
    [(("P01", "P02"), "P02"), (("P02", "P01"), "P01")],
    ids=["담은_순서대로", "담은_순서가_id와_반대"],
)
def test_T5_A5_S4_S9_Q3_담은곳_때문에_넘으면_API는_200이고_나중에_담은_곳이_no_time(env, likes, dropped):
    # 꼭 갈 곳 5 + 고정 일정 6 + 담은 곳 2 = 13
    sid, course = env.composing(planted(env, 6), likes=likes)
    assert_course_shape(course)
    assert env.stage(sid) == "composing"
    assert first_option_id(course)
    for option in course["options"]:
        assert [(d["place_id"], d["reason"]) for d in option["dropped"]] == [(dropped, "no_time")]


def test_T5_A5_S4_자동으로_고른_6곳_때문에_넘어도_API는_200(env):
    # 꼭 갈 곳 5 + 고정 일정 2 + 자동으로 고른 6곳 = 13 (TASK-003 §10 Q33)
    response = env.start(planted(env, 2), mode="auto")
    assert response.status_code == 201, response.text
    for option in response.json()["options"]:
        assert [(d["place_id"], d["reason"]) for d in option["dropped"]] == [("P06", "no_time")]


# ---------- A6 + §9 Q1·9-4: N=12 최악 입력 2초 ----------


def median_seconds(plan: DayPlan, picks: list[str], places: dict[str, Place]) -> float:
    """3회 중앙값 (§9-4)."""
    runs: list[float] = []
    for _ in range(3):
        started = time.perf_counter()
        result = compose_courses(plan, picks, places)
        runs.append(time.perf_counter() - started)
        assert isinstance(result, list)
    return statistics.median(runs)


def plain(_r: random.Random, _i: int) -> dict:
    return {}


def random_open(r: random.Random, _i: int) -> dict:
    """여는 시각이 제각각이면 기다림 때문에 비교할 갈래가 늘어난다."""
    return {"hours": [Opening(weekday=0, open=hhmm(r.randrange(0, 20 * 60, 5)), close="29:59")]}


def random_open_and_stay(r: random.Random, i: int) -> dict:
    return {**random_open(r, i), "stay": StayRange(min=r.randrange(15, 120, 5), typical=120, max=180)}


def three_windows(_r: random.Random, _i: int) -> dict:
    return {
        "hours": [
            Opening(weekday=0, open="00:00", close="06:00"),
            Opening(weekday=0, open="07:00", close="15:00"),
            Opening(weekday=0, open="16:00", close="29:59"),
        ]
    }


def spread_fixed(count: int) -> tuple:
    return tuple(fixed_event(hhmm(540 + i * 120), hhmm(570 + i * 120), fid=f"F{i}") for i in range(count))


WORST_INPUTS = {
    "모름": plain,
    "여는_시각_제각각": random_open,
    "여는_시각과_머묾_제각각": random_open_and_stay,
    "하루_3구간_영업": three_windows,
}


@pytest.mark.slow
@pytest.mark.parametrize("fixed", [0, 1, 2], ids=["담은곳12", "담은곳11_고정1", "담은곳10_고정2"])
@pytest.mark.parametrize("make", WORST_INPUTS.values(), ids=WORST_INPUTS.keys())
def test_T5_A6_S9_Q1_N12_최악_입력에서_3회_중앙값_2초_이내(make, fixed):
    items = scattered(CAP - fixed, make=make)
    plan = long_day(fixed=spread_fixed(fixed))
    seconds = median_seconds(plan, [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


# 상한이 없으면 10초 가까이 걸리던 입력 (b9e8370 보고의 측정표). 12곳으로 잘려서 빨라져야 한다
@pytest.mark.slow
@pytest.mark.parametrize(
    "count, fixed, make",
    [(15, 0, plain), (15, 0, random_open), (15, 0, three_windows), (14, 1, plain), (13, 2, plain), (16, 0, plain)],
    ids=["담은곳15", "담은곳15_여는_시각_제각각", "담은곳15_3구간", "담은곳14_고정1", "담은곳13_고정2", "담은곳16"],
)
def test_T5_A6_S9_Q1_상한을_넘는_입력도_잘린_뒤_2초_이내(count, fixed, make):
    items = scattered(count, make=make)
    plan = long_day(fixed=spread_fixed(fixed))
    seconds = median_seconds(plan, [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


# ---------- §7 + §9 Q1: N <= 12에서는 결과가 그대로 ----------


def _hours_0921(_r, _i) -> dict:
    return {"hours": opening("09:00", "21:00")}


def regression_cases() -> dict[str, tuple[DayPlan, list[str], dict[str, Place]]]:
    """TASK-005를 시작하기 전 엔진 결과를 tests/fixtures/task005_regression_golden.json에 그대로 저장해 두고 비교한다."""
    cases: dict[str, tuple[DayPlan, list[str], dict[str, Place]]] = {}

    def add(name: str, plan: DayPlan, items: list[Place], picks: list[str] | None = None) -> None:
        cases[name] = (plan, [p.id for p in items] if picks is None else picks, as_places(*items))

    categories = ["cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"]

    def mixed(count: int, seed: int) -> list[Place]:
        r = random.Random(seed)
        return [
            place(
                f"D{i:02d}",
                categories[r.randrange(len(categories))],
                km=r.uniform(-2, 2),
                east_km=r.uniform(-2, 2),
                hours=opening("08:00", "22:00") if i % 3 else None,
            )
            for i in range(1, count + 1)
        ]

    for count in (1, 3, 5, 8, 10, 12):
        add(f"N{count}_여러_종류", day_plan(), mixed(count, count))
    add("N12_시간_충분", long_day(), scattered(12))
    add("합12_담은곳11_고정1", long_day(fixed=spread_fixed(1)), scattered(11))
    five = spots(5, prefix="M")
    add("합12_꼭갈곳5_고정7", long_day(must=tuple(p.id for p in five), fixed=fixed_rows(7)), five, [])
    items = mixed(8, 21)
    add("꼭갈곳2", day_plan(must=("D01", "D02")), items)
    add("꼭갈곳5_N10", day_plan(must=tuple(f"D{i:02d}" for i in range(1, 6))), mixed(10, 22))
    add("고정일정1_N8", day_plan(fixed=(fixed_event("13:00", "14:00"),)), mixed(8, 23))
    add("고정일정2_N6", day_plan(fixed=(fixed_event("11:00", "11:30", fid="F1"), fixed_event("15:00", "16:00", fid="F2"))), mixed(6, 24))
    add("사용자값", day_plan(overrides={"D01": 120, "D02": 15}), mixed(6, 25))
    add("머무는값", day_plan(), [place("D01", stay=StayRange(min=20, typical=40, max=70)), *spots(3, first=2)])
    add("닫힌_곳", day_plan(), [place("D01", hours=opening("09:00", "20:00", 1)), *spots(3, first=2)])
    add("빈_입력", day_plan(), [])
    add("꼭갈곳_닫힘_Infeasible", day_plan(must=("D01",)), [place("D01", hours=opening("09:00", "20:00", 1))], [])
    add("꼭갈곳_넘침_Infeasible", day_plan(start="09:00", end="10:30", must=("D01", "D02")), [place("D01", "landmark"), place("D02", "landmark")], [])
    add("사용자값_충돌_Infeasible", day_plan(start="09:00", end="09:53", overrides={"D01": 40}), [place("D01", km=0.88)])
    venue = place("D09", km=1.21)
    add("고정일정_못감_Infeasible", day_plan(fixed=(fixed_event("09:13", "10:00", venue),)), [venue], [])
    return cases


def dump(result) -> object:
    if isinstance(result, Infeasible):
        return result.model_dump(mode="json")
    return [option.model_dump(mode="json") for option in result]


# §9 Q1로 상한이 12가 되어 이제 잘리는 입력. 저장본 값은 §9 전 그대로 두고 비교에서만 뺀다
OVER_CAP_NOW = {"N15_하루_12시간", "N15_시간이_많이_모자람", "N15_시간_충분"}


def test_T5_S7_회귀표가_모든_경우를_담고_있다():
    assert set(json.loads(GOLDEN.read_text(encoding="utf-8"))) == set(regression_cases()) | OVER_CAP_NOW


@pytest.mark.parametrize("name", list(regression_cases()))
def test_T5_S7_S9_Q1_N12_이하_결과는_TASK005_전과_같다(name):
    plan, picks, places = regression_cases()[name]
    assert dump(compose_courses(plan, picks, places)) == json.loads(GOLDEN.read_text(encoding="utf-8"))[name]
