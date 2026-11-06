"""코스 계산 안전장치. 근거: TASK-005 §A(A3·A4·A5·A6), §4, §5, §6 AC-3·AC-4, §7. TASK-002 동작은 test_compose_courses.py가 본다.

이 파일에서 N은 "꼭 갈 곳 + 고정 일정 + 담은 곳"(중복 없이)으로 읽는다 (§A A4의 "꼭 갈 곳 + 고정 일정만으로 15를 넘으면").
어느 담은 곳이 잘리는지는 문서·코드에 규칙이 없어 보지 않는다 (질문 목록). 몇 곳이 어떤 이유로 잘리는지만 본다.
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

from engine.models import DayPlan, Infeasible, Opening, Place, StayRange
from engine.planning import compose_courses
from planning.seed import seed_demo

SERVER_ROOT = Path(__file__).parents[1]
GOLDEN = Path(__file__).parent / "fixtures" / "task005_regression_golden.json"
LIMIT_SECONDS = 2.0  # A6
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


def setup(musts: int, fixed: int, picks: int) -> tuple[DayPlan, list[str], dict[str, Place]]:
    must_places = spots(musts, prefix="M")
    pick_places = spots(picks, prefix="P")
    plan = long_day(must=tuple(p.id for p in must_places), fixed=fixed_rows(fixed))
    return plan, [p.id for p in pick_places], as_places(*must_places, *pick_places)


def assert_cut(plan: DayPlan, picks: list[str], places: dict[str, Place], result, cut: int) -> None:
    """모든 안에서 담은 곳이 정확히 cut곳 빠지고, 이유는 no_time, 꼭 갈 곳은 그대로."""
    assert_all_valid(plan, picks, places, result)
    for option in options(result):
        assert [d.reason for d in option.dropped] == ["no_time"] * cut
        assert {d.place_id for d in option.dropped} <= set(picks)
        assert set(plan.must_visit) <= set(visits(option))
        assert len(visits(option)) == len(plan.must_visit) + len(picks) - cut


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


def test_T5_S4_데모_시드는_꼭갈곳_상한의_영향을_받지_않는다(env):
    seeded = seed_demo(env.repo)
    musts = [len(env.repo.get_day(day_id).plan.must_visit) for day_id in seeded.day_ids]
    assert musts == [0, 1, 0]


# ---------- §5 1줄: A3이 A4보다 먼저 ----------


def test_T5_S5_꼭갈곳_6곳에_고정일정_11개면_too_many_places가_아니라_입력에서_ValueError():
    with pytest.raises(ValueError):
        setup(6, 11, 0)


# ---------- A4: 꼭 갈 곳 + 고정 일정만으로 15 초과 ----------


@pytest.mark.parametrize(
    "musts, fixed",
    [(5, 11), (4, 12), (0, 16)],
    ids=["꼭갈곳5_고정11", "꼭갈곳4_고정12", "고정16"],
)
@pytest.mark.parametrize("picks", [0, 3], ids=["담은곳_없음", "담은곳_3"])
def test_T5_A4_S4_꼭갈곳과_고정일정_합이_16이면_too_many_places(musts, fixed, picks):
    plan, chosen, places = setup(musts, fixed, picks)
    result = compose_courses(plan, chosen, places)
    assert isinstance(result, Infeasible), f"Infeasible이어야 하는데 {result!r}"
    assert result.reason == "too_many_places"


@pytest.mark.parametrize(
    "musts, fixed",
    [(5, 10), (4, 11), (0, 15)],
    ids=["꼭갈곳5_고정10", "꼭갈곳4_고정11", "고정15"],
)
def test_T5_A4_꼭갈곳과_고정일정_합이_15면_계산한다(musts, fixed):
    plan, chosen, places = setup(musts, fixed, 0)
    result = compose_courses(plan, chosen, places)
    assert_all_valid(plan, chosen, places, result)
    for option in options(result):
        assert len(visits(option)) == musts
        assert option.dropped == []


# ---------- A4: 담은 곳 때문에 15 초과 ----------


@pytest.mark.parametrize(
    "musts, picks",
    [(0, 15), (1, 14), (5, 10)],
    ids=["담은곳15", "꼭갈곳1_담은곳14", "꼭갈곳5_담은곳10"],
)
def test_T5_A4_N이_15면_아무것도_자르지_않는다(musts, picks):
    plan, chosen, places = setup(musts, 0, picks)
    result = compose_courses(plan, chosen, places)
    assert_all_valid(plan, chosen, places, result)
    for option in options(result):
        assert option.dropped == []
        assert len(visits(option)) == 15


@pytest.mark.parametrize(
    "musts, picks",
    [(0, 16), (5, 11)],
    ids=["담은곳16", "꼭갈곳5_담은곳11"],
)
def test_T5_A4_S4_N이_16이면_시간이_남아도_담은곳_1곳이_no_time으로_잘린다(musts, picks):
    plan, chosen, places = setup(musts, 0, picks)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), 1)


@pytest.mark.parametrize(
    "musts, fixed, picks, cut",
    [(5, 9, 2, 1), (5, 9, 3, 2), (5, 10, 1, 1), (5, 10, 3, 3)],
    ids=["고정9_합16", "고정9_합17", "고정10_합16", "고정10_담은곳_전부_잘림"],
)
def test_T5_A4_고정일정도_N에_들어가_담은곳이_잘린다(musts, fixed, picks, cut):
    plan, chosen, places = setup(musts, fixed, picks)
    assert_cut(plan, chosen, places, compose_courses(plan, chosen, places), cut)


def test_T5_S5_자르기는_한_번만_N이_16이면_정확히_1곳만_빠진다():
    # §5 2줄: 코드에 기존 15곳 제한이 없어(engine·graphs·planning을 찾아봄) 이중으로 자르면 14곳이 된다
    plan, chosen, places = setup(0, 0, 16)
    for option in options(compose_courses(plan, chosen, places)):
        assert len(visits(option)) == 15


def test_T5_A4_꼭갈곳이_담은곳에도_있으면_한_번만_센다():
    # 꼭 갈 곳 1 + 담은 곳 15(그중 1곳이 꼭 갈 곳) = 서로 다른 15곳
    items = spots(15)
    plan = long_day(must=("D01",))
    picks = [p.id for p in items]
    for option in options(compose_courses(plan, picks, as_places(*items))):
        assert option.dropped == []
        assert len(visits(option)) == 15


def test_T5_A4_DP에_못_들어가는_닫힌_곳은_N에_세지_않는다():
    # A4는 "DP에 들어가는 N". 닫힌 곳은 DP 전에 빠지므로 담은 곳 16곳이어도 N=15라 더 자르지 않는다
    closed = place("D16", hours=opening("09:00", "20:00", 1))
    items = [*spots(15), closed]
    picks = [p.id for p in items]
    plan = long_day()
    for option in options(compose_courses(plan, picks, as_places(*items))):
        assert len(visits(option)) == 15
        assert [(d.place_id, d.reason) for d in option.dropped] == [("D16", "closed_at_time")]


@settings(max_examples=40, deadline=None)
@given(st.integers(0, 5), st.integers(0, 16), st.integers(0, 4))
def test_T5_A4_임의의_수에서_too_many_자르기_그대로를_가른다(musts, fixed, picks):
    plan, chosen, places = setup(musts, fixed, picks)
    result = compose_courses(plan, chosen, places)
    if musts + fixed > 15:
        assert isinstance(result, Infeasible)
        assert result.reason == "too_many_places"
    else:
        assert_cut(plan, chosen, places, result, max(0, musts + fixed + picks - 15))


def run_in_child(musts: int, fixed: int, picks: int) -> dict:
    """지금 코드는 N=25에서 몇 분 멈춘다 (TASK-004 §14). pytest가 멈추지 않게 자식 프로세스로 돌리고 시간이 지나면 그 자식만 끈다."""
    script = f"""
import json, sys
sys.path.insert(0, "tests")
from test_task005_safety import setup
from engine.models import Infeasible
from engine.planning import compose_courses
plan, chosen, places = setup({musts}, {fixed}, {picks})
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


def test_T5_A4_담은곳_25곳도_멈추지_않고_15곳으로_계산한다():
    outcome = run_in_child(0, 0, 25)
    assert outcome["visits"] and all(count == 15 for count in outcome["visits"])
    assert all(reasons == ["no_time"] for reasons in outcome["reasons"])


def test_T5_A4_too_many_places면_담은곳이_많아도_계산하지_않는다():
    assert run_in_child(5, 11, 20) == {"reason": "too_many_places"}


# ---------- A5: API 422, 상태·저장소 그대로 ----------


def too_many_day(env) -> str:
    """꼭 갈 곳 5 + 고정 일정 11 = 16. 후보 8곳은 따로 있다."""
    musts = spots(5, prefix="M", stay=FIXED_STAY)
    others = spots(8, prefix="P", stay=FIXED_STAY)
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(11))
    return env.plant_day(as_places(*musts, *others), plan)


def assert_too_many(response) -> None:
    error = assert_error(response, 422, "COURSE_INFEASIBLE")
    assert error["detail"]["reason"] == "too_many_places"


def test_T5_A5_S4_코스_짜기가_too_many_places면_422이고_상태와_저장소_그대로(env):
    sid, _ = env.browse(too_many_day(env))
    state, repo = env.values(sid), env.repo.snapshot()
    before = env.client.get(f"/planning/{sid}").json()
    assert_too_many(env.compose(sid))
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.client.get(f"/planning/{sid}").json() == before


def test_T5_A5_S4_알아서_짜_줘가_too_many_places면_422이고_첫_질문_그대로(env):
    session = env.session(too_many_day(env))
    sid = session["session_id"]
    state, repo = env.values(sid), env.repo.snapshot()
    assert_too_many(env.client.post(f"/planning/{sid}/answer", json={"auto": True}))
    assert env.values(sid) == state
    assert env.repo.snapshot() == repo
    assert env.client.get(f"/planning/{sid}").json() == session


def test_T5_A5_S4_자동_시작이_too_many_places면_422이고_세션을_남기지_않는다(env):
    day_id = too_many_day(env)
    repo = env.repo.snapshot()
    assert_too_many(env.start(day_id, mode="auto"))
    assert env.repo.snapshot() == repo


def test_T5_A5_꼭갈곳과_고정일정_합이_15면_API는_200(env):
    musts = spots(5, prefix="M", stay=FIXED_STAY)
    others = spots(8, prefix="P", stay=FIXED_STAY)
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(10))
    _, course = env.composing(env.plant_day(as_places(*musts, *others), plan))
    assert_course_shape(course)
    assert all(option["dropped"] == [] for option in course["options"])


def test_T5_A5_S4_담은곳_때문에_넘으면_API는_200이고_dropped에_no_time(env):
    # 꼭 갈 곳 5 + 고정 일정 9 + 담은 곳 2 = 16
    musts = spots(5, prefix="M", stay=FIXED_STAY)
    others = spots(8, prefix="P", stay=FIXED_STAY)
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(9))
    day_id = env.plant_day(as_places(*musts, *others), plan)
    sid, course = env.composing(day_id, likes=("P01", "P02"))
    assert_course_shape(course)
    assert env.stage(sid) == "composing"
    for option in course["options"]:
        assert [d["reason"] for d in option["dropped"]] == ["no_time"]
        assert option["dropped"][0]["place_id"] in {"P01", "P02"}
    assert first_option_id(course)


def test_T5_A5_S4_자동으로_고른_6곳_때문에_넘어도_API는_200(env):
    # 꼭 갈 곳 5 + 고정 일정 5 + 자동으로 고른 6곳 = 16 (TASK-003 §10 Q33)
    musts = spots(5, prefix="M", stay=FIXED_STAY)
    others = spots(8, prefix="P", stay=FIXED_STAY)
    plan = long_day(must=tuple(p.id for p in musts), fixed=fixed_rows(5))
    response = env.start(env.plant_day(as_places(*musts, *others), plan), mode="auto")
    assert response.status_code == 201, response.text
    for option in response.json()["options"]:
        assert [d["reason"] for d in option["dropped"]] == ["no_time"]


# ---------- A6: N=15 최악 입력 2초 ----------


def median_seconds(plan: DayPlan, picks: list[str], places: dict[str, Place]) -> float:
    """3번 중앙값 (TASK-002 AC-16과 같은 방식). 2번이 이미 넘으면 중앙값도 넘으니 3번째는 돌리지 않는다."""
    runs: list[float] = []
    for _ in range(3):
        started = time.perf_counter()
        result = compose_courses(plan, picks, places)
        runs.append(time.perf_counter() - started)
        assert isinstance(result, list)
        if sum(run > LIMIT_SECONDS for run in runs) >= 2:
            break
    return statistics.median(runs) if len(runs) == 3 else max(runs)


def random_open(r: random.Random, _i: int) -> dict:
    return {"hours": [Opening(weekday=0, open=hhmm(r.randrange(0, 20 * 60, 5)), close="29:59")]}


@pytest.mark.slow
def test_T5_A6_N15_영업시간_모름_무작위_좌표면_2초_이내():
    items = scattered(15)
    seconds = median_seconds(long_day(), [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


@pytest.mark.slow
def test_T5_A6_S4_N15_여는_시각이_제각각이면_기다림_때문에_갈래가_늘어도_2초_이내():
    items = scattered(15, make=random_open)
    seconds = median_seconds(long_day(), [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


@pytest.mark.slow
def test_T5_A6_S4_N15_담은곳14에_고정일정1이어도_2초_이내():
    items = scattered(14)
    plan = long_day(fixed=(fixed_event("12:00", "13:00"),))
    seconds = median_seconds(plan, [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


@pytest.mark.slow
def test_T5_A6_A4_담은곳이_16곳이어도_잘린_뒤_2초_이내():
    items = scattered(16)
    seconds = median_seconds(long_day(), [p.id for p in items], as_places(*items))
    assert seconds <= LIMIT_SECONDS, f"{seconds:.2f}초"


# ---------- §7: N <= 15에서는 결과가 그대로 ----------


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
    add("N15_하루_12시간", day_plan(), mixed(15, 15))
    add("N15_시간이_많이_모자람", day_plan(start="10:00", end="14:00"), mixed(15, 16))
    add("N15_시간_충분", long_day(), scattered(15))
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


def test_T5_S7_회귀표가_모든_경우를_담고_있다():
    assert set(json.loads(GOLDEN.read_text(encoding="utf-8"))) == set(regression_cases())


@pytest.mark.parametrize("name", list(regression_cases()))
def test_T5_S7_N15_이하_결과는_TASK005_전과_같다(name):
    plan, picks, places = regression_cases()[name]
    assert dump(compose_courses(plan, picks, places)) == json.loads(GOLDEN.read_text(encoding="utf-8"))[name]
