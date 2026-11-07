"""TASK-007 §12 (backend 질문 답, 11-09).

1) `compose_courses`의 `start` 인자 (기본값 = `lodging`): 첫 이동은 start에서, 하루 끝 복귀는 진짜 숙소(`plan.lodging`) 기준.
   §8 "엔진 동작 바꾸지 않기"의 예외. 생략하거나 lodging을 주면 지금과 결과가 같다 (TASK-002·005 회귀는 기존 테스트 그대로).
2) 늦어짐 대안은 시작 = 지금 장소(k번), 끝 = 진짜 숙소.
3) 엔진 공개 이름 `distance_km`, `travel_min` (동작 그대로). 밑줄 이름은 엔진 안에서만.

공개 이름은 아직 없으므로 테스트 함수 안에서 import한다 (모듈 수집이 깨지지 않게, 해당 테스트만 빨강).
"""

import ast
import inspect
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_helpers import (
    BASE,
    as_places,
    day_plan,
    distance_km,
    fixed_event,
    north_of,
    opening,
    place,
    to_min,
    travel_candidates,
)
from trip_helpers import at_place, checked, item, plant, spot

from engine.models import CourseOption, Infeasible
from engine.planning import _distance_km, _travel_min, compose_courses

SERVER = Path(__file__).parents[1]
FAR_KM = 10.0  # 숙소에서 10km: 엔진 식으로 10 + ceil(10 / 20 * 60) = 40분
FAR = north_of(FAR_KM)
OPEN_ALL = opening("08:00", "23:00")  # MONDAY(weekday 0) 하루 종일 영업


def visits(option: CourseOption) -> list[str]:
    return [i.place_id for i in option.items if not i.is_fixed]


def course_list(result) -> list[CourseOption]:
    assert isinstance(result, list), f"코스 목록이어야 하는데 {result!r}"
    return result


# ---------- 1. compose_courses(start=...) ----------


def test_S12_compose_courses에_start_인자가_있다():
    params = inspect.signature(compose_courses).parameters
    assert "start" in params  # §12 글자대로
    assert list(params)[:3] == ["plan", "picks", "places"]  # 기존 인자 위치 그대로
    assert params["start"].default is not inspect.Parameter.empty  # 기본값이 있다 (생략 가능)


def test_S12_start의_좌표_타입은_lodging과_같다():
    annotation = inspect.signature(compose_courses).parameters["start"].annotation
    assert "tuple[float, float]" in str(annotation), annotation


def sample_day():
    places = as_places(
        place("C1", "cafe", km=1.0, hours=OPEN_ALL),
        place("M1", "museum", km=2.0, hours=OPEN_ALL),
        place("W1", "walk", km=3.0, east_km=1.0, hours=OPEN_ALL),
        place("F1", "experience", km=4.0, hours=OPEN_ALL),
    )
    plan = day_plan(start="09:00", end="20:00", fixed=(fixed_event("14:00", "15:00", places["F1"]),), must=("M1",))
    return plan, ["C1", "M1", "W1"], places


def test_S12_start를_생략하면_lodging을_준_것과_같다():
    plan, picks, places = sample_day()
    assert compose_courses(plan, picks, places) == compose_courses(plan, picks, places, start=plan.lodging)


@settings(max_examples=40, deadline=None)
@given(
    kms=st.lists(st.floats(min_value=0.0, max_value=15.0, allow_nan=False), min_size=1, max_size=4),
    end_hour=st.integers(min_value=11, max_value=22),
)
def test_S12_속성_start를_lodging으로_주면_생략과_결과가_같다(kms, end_hour):
    places = as_places(*(place(f"P{n}", "cafe", km=km, hours=OPEN_ALL) for n, km in enumerate(kms, start=1)))
    plan = day_plan(start="09:00", end=f"{end_hour:02d}:00")
    picks = list(places)
    assert compose_courses(plan, picks, places) == compose_courses(plan, picks, places, start=plan.lodging)


def test_S12_start를_주면_첫_이동은_start에서():
    places = as_places(place("P1", "cafe", km=FAR_KM, hours=OPEN_ALL))
    plan = day_plan(start="10:00", end="20:00")
    for option in course_list(compose_courses(plan, ["P1"], places, start=FAR)):
        assert visits(option) == ["P1"]
        assert option.items[0].travel_min == 0  # start = P1 자리라 이동 0분
        assert option.items[0].start == "10:00"


def test_S12_start_생략이면_첫_이동은_숙소에서():
    """대조: 같은 하루에서 start를 안 주면 숙소에서 10km(40분)."""
    places = as_places(place("P1", "cafe", km=FAR_KM, hours=OPEN_ALL))
    plan = day_plan(start="10:00", end="20:00")
    for option in course_list(compose_courses(plan, ["P1"], places)):
        assert option.items[0].travel_min in travel_candidates(distance_km(BASE, FAR))


def test_S12_start를_주면_첫_고정_일정까지_이동도_start에서():
    places = as_places(place("F1", "experience", km=FAR_KM, hours=OPEN_ALL))
    plan = day_plan(start="10:00", end="20:00", fixed=(fixed_event("10:00", "11:00", places["F1"]),))
    for option in course_list(compose_courses(plan, [], places, start=FAR)):
        first = option.items[0]
        assert (first.place_id, first.is_fixed, first.travel_min) == ("F1", True, 0)


def test_S12_start를_주어도_하루_끝_복귀는_진짜_숙소까지():
    places = as_places(place("P1", "cafe", km=FAR_KM, hours=OPEN_ALL))
    plan = day_plan(start="10:00", end="20:00")
    for option in course_list(compose_courses(plan, ["P1"], places, start=FAR)):
        assert option.go_home_min in travel_candidates(distance_km(FAR, BASE))  # 40분, start로 돌아가는 0분이 아님
        assert option.total_travel_min == sum(i.travel_min for i in option.items) + option.go_home_min


@pytest.mark.parametrize(
    "end, kept",
    [("11:09", False), ("11:10", True)],
    ids=["복귀가_1분_넘침", "복귀가_정각"],
)
def test_S12_start를_주면_하루_끝_마감은_진짜_숙소_복귀로_계산(end, kept):
    """start = P1 자리(이동 0) → 10:00~10:30 (카페 최소 30분) → 숙소 40분 → 11:10.
    숙소 복귀가 11:10에 정각이면 들어가고, 하루 끝이 11:09면 빠진다 (start로 돌아간다고 치면 둘 다 들어감)."""
    places = as_places(place("P1", "cafe", km=FAR_KM, hours=OPEN_ALL))
    plan = day_plan(start="10:00", end=end)
    for option in course_list(compose_courses(plan, ["P1"], places, start=FAR)):
        assert visits(option) == (["P1"] if kept else [])
        if kept:
            assert to_min(option.items[-1].end) + option.go_home_min <= to_min(end)


@settings(max_examples=40, deadline=None)
@given(
    start_km=st.floats(min_value=0.0, max_value=12.0, allow_nan=False),
    kms=st.lists(st.floats(min_value=0.0, max_value=12.0, allow_nan=False), min_size=1, max_size=3),
    end_hour=st.integers(min_value=11, max_value=21),
)
def test_S12_속성_start가_어디든_첫_이동은_start에서_복귀는_숙소로(start_km, kms, end_hour):
    start = north_of(start_km, east_km=0.5)
    places = as_places(*(place(f"P{n}", "cafe", km=km, hours=OPEN_ALL) for n, km in enumerate(kms, start=1)))
    plan = day_plan(start="10:00", end=f"{end_hour:02d}:00")
    result = compose_courses(plan, list(places), places, start=start)
    if isinstance(result, Infeasible):
        return
    for option in result:
        if not option.items:
            continue
        first, last = option.items[0], option.items[-1]
        first_at = (places[first.place_id].lat, places[first.place_id].lng)
        last_at = (places[last.place_id].lat, places[last.place_id].lng)
        assert first.travel_min in travel_candidates(distance_km(start, first_at))
        assert option.go_home_min in travel_candidates(distance_km(last_at, BASE))
        assert to_min(last.end) + option.go_home_min <= to_min(plan.end)


# ---------- 2. 늦어짐 대안: 시작 = k번, 끝 = 진짜 숙소 ----------

LODGING_FAR_KM = 30.0  # 숙소(BASE)에서 30km: 엔진 식으로 10 + 90 = 100분


def far_from_lodging_day(env, end: str) -> str:
    """1번 P01, 2번 P02 모두 숙소에서 30km쯤 (서로 0.5km, 걸어서 7분).
    1번 예정 출발 12:00 (2번 12:20 시작, 이동 20). 12:20에 P01이면 20분 늦음 = 높음 (trip_helpers.plain_day와 같은 꼴)."""
    places = {"P01": spot("P01", LODGING_FAR_KM), "P02": spot("P02", LODGING_FAR_KM + 0.5)}
    items = [item(1, "P01", "10:00", "12:00", 100), item(2, "P02", "12:20", "13:20", 20)]
    return plant(env, items, places, end=end)


def test_S12_대안은_진짜_숙소로_돌아갈_시간이_없으면_남은_장소를_뺀다(env):
    """14:00 끝: P01에서 12:20 출발 → P02 12:27~12:57(최소 30분) → 숙소 102분 → 14:39 > 14:00 이라 P02는 못 넣는다.
    끝을 k번 장소(P01, 7분)로 잡으면 13:04로 들어가 버린다."""
    day_id = far_from_lodging_day(env, end="14:00")
    view = checked(env, day_id, "12:20", at_place(LODGING_FAR_KM))
    event = view["event"]
    assert (event["severity"], event["state"]) == ("high", "awaiting")  # 시험 자체 확인
    assert event["proposals"]
    for proposal in event["proposals"]:
        assert "P02" not in {entry["place_id"] for entry in proposal["items"]}
        assert "P02" in {gone["place_id"] for gone in proposal["dropped"]}


@pytest.mark.parametrize("end", ["14:00", "15:00"])
def test_S12_대안의_마지막_장소에서_진짜_숙소까지_가도_하루_끝_안(env, end):
    day_id = far_from_lodging_day(env, end=end)
    view = checked(env, day_id, "12:20", at_place(LODGING_FAR_KM))
    places = {"P01": spot("P01", LODGING_FAR_KM), "P02": spot("P02", LODGING_FAR_KM + 0.5)}
    for proposal in view["event"]["proposals"]:
        visited = [entry for entry in proposal["items"] if entry["place_id"]]
        if not visited:
            continue
        last = visited[-1]
        home = max(travel_candidates(distance_km((places[last["place_id"]].lat, places[last["place_id"]].lng), BASE)))
        assert to_min(last["end"]) + home <= to_min(end), (last, home)


def test_S12_대안을_반영한_코스의_숙소_복귀는_진짜_숙소_기준(env):
    from trip_helpers import accept, chosen

    day_id = far_from_lodging_day(env, end="15:00")
    view = checked(env, day_id, "12:20", at_place(LODGING_FAR_KM))
    proposal = view["event"]["proposals"][0]
    assert accept(env, proposal["proposal_id"]).status_code == 200
    _, course = chosen(env, day_id)
    last = [i for i in course.items if i.place_id][-1]
    spot_at = {"P01": at_place(LODGING_FAR_KM), "P02": at_place(LODGING_FAR_KM + 0.5)}[last.place_id]
    assert course.go_home_min in travel_candidates(distance_km(spot_at, BASE))
    assert to_min(last.end) + course.go_home_min <= to_min("15:00")


# ---------- 3. 엔진 공개 이름 distance_km, travel_min ----------


def test_S12_엔진이_distance_km와_travel_min을_공개_이름으로_내보낸다():
    import engine.planning as planning

    assert callable(getattr(planning, "distance_km", None))
    assert callable(getattr(planning, "travel_min", None))


coords = st.tuples(
    st.floats(min_value=-80.0, max_value=80.0, allow_nan=False),
    st.floats(min_value=-179.0, max_value=179.0, allow_nan=False),
)


@settings(max_examples=200, deadline=None)
@given(a=coords, b=coords)
def test_S12_distance_km는_밑줄_이름과_같은_값(a, b):
    from engine.planning import distance_km as public_distance

    assert public_distance(a, b) == _distance_km(a, b)


@settings(max_examples=200, deadline=None)
@given(km=st.floats(min_value=0.0, max_value=200.0, allow_nan=False))
def test_S12_travel_min은_밑줄_이름과_같은_값(km):
    from engine.planning import travel_min as public_travel

    assert public_travel(km) == _travel_min(km)


@pytest.mark.parametrize("km", [0.0, 1.2, 1.2000001, 8.2, 30.0], ids=["0", "걷기_끝_정각", "걷기_끝_넘음", "8.2", "30"])
def test_S12_travel_min_경계도_밑줄_이름과_같다(km):
    from engine.planning import travel_min as public_travel

    assert public_travel(km) == _travel_min(km)


# 엔진 밖 서버 코드. evals(TASK-005 dp_vs_greedy 측정)는 회귀를 건드리지 말라는 §12에 따라 이번 검사에서 뺀다 (질문으로 남김)
SERVER_PACKAGES = ["api", "catalog", "deciders", "graphs", "planning", "trip"]


def engine_private_imports(path: Path) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] == "engine":
            found += [f"{node.module}.{alias.name}" for alias in node.names if alias.name.startswith("_")]
        if isinstance(node, ast.Attribute) and node.attr.startswith("_") and not node.attr.startswith("__"):
            base = node.value
            if isinstance(base, ast.Name) and base.id in {"planning_engine", "engine"}:
                found.append(f"{base.id}.{node.attr}")
    return found


def server_files() -> list[Path]:
    return sorted(p for name in SERVER_PACKAGES for p in (SERVER / name).rglob("*.py") if ".venv" not in p.parts)


def test_S12_검사할_서버_파일이_있다():
    names = {p.relative_to(SERVER).as_posix() for p in server_files()}
    assert "trip/alternatives.py" in names and "graphs/trip.py" in names  # 시험 자체 확인


@pytest.mark.parametrize("path", server_files(), ids=lambda p: p.relative_to(SERVER).as_posix())
def test_S12_엔진_밖_서버_코드는_엔진의_밑줄_이름을_import하지_않는다(path):
    assert engine_private_imports(path) == []
