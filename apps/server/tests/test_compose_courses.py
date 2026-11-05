"""코스 계산. 근거: TASK-002 §3 F, AC-8~16, §7 Q9~Q18, SCREEN-001 §2 머무는 시간, SRS FR-03·07·07a, NFR-04."""

import statistics
import time
from datetime import date

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_helpers import (
    MONDAY,
    as_places,
    day_plan,
    distance_km,
    fixed_event,
    hhmm,
    travel_candidates,
    north_of,
    opening,
    place,
    to_min,
)

from engine.models import CourseOption, DayPlan, Infeasible, Opening, Place, PlanFixed, StayRange
from engine.planning import compose_courses, compose_greedy

BUFFER = {"relaxed": 15, "packed": 5}
DEFAULT_STAY = {
    "cafe": (30, 60, 90),
    "food": (45, 60, 90),
    "walk": (30, 60, 120),
    "museum": (60, 90, 150),
    "landmark": (60, 120, 180),
    "shop": (30, 60, 120),
    "experience": (60, 90, 150),
    "night": (60, 90, 150),
}


def options(result) -> list[CourseOption]:
    assert isinstance(result, list), f"코스 목록이어야 하는데 {result!r}"
    # 넣을 곳이 0곳이어도 빈 코스 1안 (§8 Q37)
    assert 1 <= len(result) <= 2
    assert len({o.label for o in result}) == len(result)
    return result


def option_for(result, label: str) -> CourseOption:
    """그 이름의 안. 두 안이 같아 relaxed만 왔으면 그 하나 (§7 Q11, §8 Q35). packed만 올 수도 있다 (§9 Q42)."""
    all_options = options(result)
    for option in all_options:
        if option.label == label:
            return option
    assert len(all_options) == 1, f"{label} 안이 없음"
    return all_options[0]


def visits(option: CourseOption) -> list[str]:
    return [i.place_id for i in option.items if not i.is_fixed]


def item_of(option: CourseOption, pid: str):
    return next(i for i in option.items if i.place_id == pid)


def fixed_items(option: CourseOption):
    return [i for i in option.items if i.is_fixed]


def dropped_reason(option: CourseOption, pid: str) -> str:
    return next(d.reason for d in option.dropped if d.place_id == pid)


def stay_range(p: Place) -> tuple[int, int, int]:
    return (p.stay.min, p.stay.typical, p.stay.max) if p.stay else DEFAULT_STAY[p.category]


def covers(hours: list[Opening], weekday: int, start: int, end: int) -> bool:
    return any(
        o.weekday == weekday and to_min(o.open) <= start and end <= to_min(o.close) for o in hours
    )


def assert_course_valid(plan: DayPlan, picks: list[str], places: dict[str, Place], option: CourseOption):
    """NFR-04와 §3 F·§7·§8의 불변식."""
    weekday = plan.date.weekday()
    buffer_min = BUFFER[option.label]
    user_stays = {pid: min(300, max(15, v)) for pid, v in plan.stay_overrides.items()}

    position = plan.lodging
    previous = None
    for index, item in enumerate(option.items):
        start, end = to_min(item.start), to_min(item.end)
        assert start < end
        assert item.wait_min >= 0

        assert item.seq == index + 1  # §8 Q35
        if item.is_fixed:
            event = next(f for f in plan.fixed if (f.start, f.end) == (item.start, item.end))
            target = (event.lat, event.lng) if event.place_id else position
            assert item.place_id == event.place_id
            assert item.stay_source is None  # §8 Q28, §9 Q46
            if event.place_id is None:
                assert item.hours_status is None
            else:
                venue = places[event.place_id]
                venue_status = "unverified" if venue.hours_status == "unknown" else venue.hours_status
                assert item.hours_status == ("unknown" if venue.hours is None else venue_status)
        else:
            p = places[item.place_id]
            target = (p.lat, p.lng)

        assert item.travel_min in travel_candidates(distance_km(position, target))
        ready = plan_start_or_previous_end(plan, previous) + item.travel_min
        if previous is not None and not previous.is_fixed and not item.is_fixed:
            ready += buffer_min
        assert start >= ready, f"{index}번 항목이 겹침"
        position = target

        if not item.is_fixed:
            p = places[item.place_id]
            assert end - start == item.stay_min
            low, typical, high = stay_range(p)
            if item.place_id in user_stays:
                assert item.stay_min == user_stays[item.place_id]
                assert item.stay_source == "user"
            else:
                assert item.stay_source == "auto"
                assert low <= item.stay_min <= (typical if option.label == "packed" else high)
                # §8 Q31: 5분씩 늘리고 목표에서 멈춘다
                assert (
                    (item.stay_min - low) % 5 == 0
                    or (item.stay_min - typical) % 5 == 0
                    or item.stay_min == high
                )
            if p.hours is None:
                assert item.hours_status == "unknown"
            else:
                assert covers(p.hours, weekday, start, end), f"{p.id} 영업시간 위반"
                expected = "unverified" if p.hours_status == "unknown" else p.hours_status
                assert item.hours_status == expected
        previous = item

    # 고정 일정: 시각 그대로, 빠짐없이 한 번씩
    assert sorted((i.start, i.end) for i in fixed_items(option)) == sorted((f.start, f.end) for f in plan.fixed)

    # 집까지
    assert option.go_home_min in travel_candidates(distance_km(position, plan.lodging))
    if option.items:
        assert to_min(option.items[-1].end) + option.go_home_min <= to_min(plan.end)

    # 꼭 갈 곳은 반드시, 담은 곳은 넣거나 dropped에 한 번
    wanted = set(picks) | set(plan.must_visit)
    visited = visits(option)
    dropped = [d.place_id for d in option.dropped]
    assert len(visited) == len(set(visited))
    assert len(dropped) == len(set(dropped))
    assert set(visited) | set(dropped) == wanted
    assert not set(visited) & set(dropped)
    assert set(plan.must_visit) <= set(visited)
    # §8 Q32: 바꾼 곳은 유지. 꼭 갈 곳이 아니면 그날 닫힌 경우만 빠질 수 있다 (§9 Q44 ①)
    for pid in (set(plan.stay_overrides) & wanted) - set(visited):
        assert next(d.reason for d in option.dropped if d.place_id == pid) == "closed_at_time"
    for d in option.dropped:
        if places[d.place_id].hours is None:
            assert d.reason != "closed_at_time"

    # §8 Q35: 숙소 복귀 포함
    assert option.total_travel_min == sum(i.travel_min for i in option.items) + option.go_home_min


def plan_start_or_previous_end(plan: DayPlan, previous) -> int:
    return to_min(plan.start) if previous is None else to_min(previous.end)


def assert_all_valid(plan, picks, places, result):
    for option in options(result):
        assert_course_valid(plan, picks, places, option)


# ---------- AC-8, §7 Q11: 시간 충분 ----------


@pytest.mark.parametrize("must_in_picks", [False, True], ids=["꼭갈곳이_담은곳에_없음", "꼭갈곳도_담은곳"])
def test_AC08_꼭갈곳1_담은곳4_시간충분이면_2안_모두_5곳(must_in_picks):
    places = as_places(*[place(f"D{i:02d}", km=0.1 * i) for i in range(1, 6)])
    picks = ["D02", "D03", "D04", "D05"] + (["D01"] if must_in_picks else [])
    plan = day_plan(must=("D01",))

    result = compose_courses(plan, picks, places)

    assert {o.label for o in options(result)} == {"relaxed", "packed"}
    for option in result:
        assert sorted(visits(option)) == ["D01", "D02", "D03", "D04", "D05"]
        assert option.dropped == []
    assert_all_valid(plan, picks, places, result)


def test_Q11_두_안이_같으면_1안():
    # 머물 시간이 딱 최소만큼뿐이라 쉬는 시간·늘리기의 차이가 없음
    places = as_places(place("D01", "cafe"))
    plan = day_plan(start="09:00", end="09:30")
    result = options(compose_courses(plan, ["D01"], places))
    assert [o.label for o in result] == ["relaxed"]  # §8 Q35


def test_Q37_넣을_곳이_없으면_빈_코스_1안():
    result = options(compose_courses(day_plan(), [], {}))
    assert len(result) == 1
    assert result[0].items == []
    assert result[0].dropped == []
    assert result[0].go_home_min == 0
    assert result[0].total_travel_min == 0


def test_Q37_모두_못_들어가도_빈_코스_1안에_이유():
    places = as_places(place("D01", km=0.88))
    result = options(compose_courses(day_plan(start="09:00", end="09:53"), ["D01"], places))
    assert len(result) == 1
    assert result[0].items == []
    assert dropped_reason(result[0], "D01") == "no_time"


def test_Q35_seq는_1부터_total은_숙소복귀_포함():
    places = as_places(place("D01", km=0.25), place("D02", km=0.25))
    for option in options(compose_courses(day_plan(), ["D01", "D02"], places)):
        assert [i.seq for i in option.items] == [1, 2]
        assert option.go_home_min == 4
        assert option.total_travel_min == 8  # 오는 길 4 + 같은 자리 0 + 집 4


# ---------- §3 F 이동 시간 (1.2km 기준 양쪽) ----------


@pytest.mark.parametrize(
    "km, minutes",
    [
        (0.0, 0),
        (0.25, 4),
        (0.88, 12),
        (1.19, 16),
        (1.2 - 1e-6, 16),
        (1.2 + 1e-6, 14),
        (1.21, 14),
        (2.1, 17),
        (2.9, 19),
    ],
    ids=[
        "같은자리",
        "도보_0점25",
        "도보_0점88",
        "도보_1점19",
        "도보_1점2_바로_안쪽",
        "대중교통_1점2_바로_바깥",
        "대중교통_1점21",
        "대중교통_2점1",
        "대중교통_2점9",
    ],
)
def test_이동시간_1점2km까지_도보_넘으면_대중교통(km, minutes):
    places = as_places(place("D01", km=km))
    result = compose_courses(day_plan(), ["D01"], places)
    for option in options(result):
        item = item_of(option, "D01")
        assert item.travel_min == minutes
        assert option.go_home_min == minutes


def test_Q14_하루_시작은_숙소에서_출발_첫장소까지_이동포함():
    places = as_places(place("D01", km=0.88))
    for option in options(compose_courses(day_plan(start="09:00"), ["D01"], places)):
        assert to_min(item_of(option, "D01").start) == to_min("09:12")


# ---------- §3 F, §7 Q9: 머무는 시간 ----------


@pytest.mark.parametrize("category, stay", DEFAULT_STAY.items(), ids=DEFAULT_STAY.keys())
def test_Q9_시간이_넉넉하면_여유안은_최대_알찬안은_보통(category, stay):
    places = as_places(place("D01", category))
    result = compose_courses(day_plan(), ["D01"], places)
    assert item_of(option_for(result, "relaxed"), "D01").stay_min == stay[2]
    assert item_of(option_for(result, "packed"), "D01").stay_min == stay[1]


@pytest.mark.parametrize("category, stay", DEFAULT_STAY.items(), ids=DEFAULT_STAY.keys())
def test_Q9_시간이_딱_최소만큼이면_최소(category, stay):
    places = as_places(place("D01", category))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + stay[0]))
    for option in options(compose_courses(plan, ["D01"], places)):
        item = item_of(option, "D01")
        assert item.stay_min == stay[0]
        assert item.stay_source == "auto"


def test_장소에_머무는시간_값이_있으면_종류_기본값보다_먼저():
    places = as_places(place("D01", "cafe", stay=StayRange(min=20, typical=40, max=70)))
    result = compose_courses(day_plan(), ["D01"], places)
    assert item_of(option_for(result, "relaxed"), "D01").stay_min == 70
    assert item_of(option_for(result, "packed"), "D01").stay_min == 40
    tight = compose_courses(day_plan(start="09:00", end="09:20"), ["D01"], places)
    assert item_of(options(tight)[0], "D01").stay_min == 20


def test_Q10_여유안은_보통까지_먼저_채운다():
    # 09:00~10:55 = 115분, 쉬는 15분, 최소 합 60 → 남는 40분. 보통(60)을 넘길 수 없음
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end="10:55")
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "relaxed")
    stays = [i.stay_min for i in option.items]
    assert all(30 <= s <= 60 for s in stays)
    assert sum(stays) > 60


def test_Q10_여유안은_보통을_채운_뒤_최대_쪽으로():
    # 09:00~11:45 = 165분, 쉬는 15분 → 머물 시간 150분. 둘 다 보통 60은 넘김
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end="11:45")
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "relaxed")
    assert all(60 <= i.stay_min <= 90 for i in option.items)


def test_Q10_알찬안은_시간이_남아도_보통까지만():
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end="11:45")
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "packed")
    assert [i.stay_min for i in option.items] == [60, 60]


@pytest.mark.parametrize(
    "label, minutes, stays",
    [
        ("relaxed", 115, [50, 50]),
        ("relaxed", 118, [50, 50]),
        ("relaxed", 120, [55, 50]),
        ("relaxed", 140, [65, 60]),
        ("packed", 69, [30, 30]),
        ("packed", 70, [35, 30]),
    ],
    ids=["여유_40분_고르게", "여유_43분_3분은_남김", "여유_45분_앞곳부터", "여유_65분_보통_넘어", "알찬_4분은_안늘림", "알찬_5분이면_앞곳"],
)
def test_Q31_남는_시간은_5분씩_방문순서대로_나눔(label, minutes, stays):
    # 같은 자리 카페 2곳 (30·60·90). 남는 시간 = 하루 − 쉬는 시간 − 최소 60
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + minutes))
    option = option_for(compose_courses(plan, ["D01", "D02"], places), label)
    assert visits(option) == ["D01", "D02"]
    assert [i.stay_min for i in option.items] == stays


def test_Q31_목표에_닿은_곳은_멈추고_나머지만_늘림():
    # 남는 40분: D01 +5(보통 35), D02 +30(보통 60), 5분은 남김
    places = as_places(place("D01", stay=StayRange(min=30, typical=35, max=40)), place("D02"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + 105))
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "packed")
    assert [i.stay_min for i in option.items] == [35, 60]


def test_Q31_사용자가_바꾼_곳은_늘리지_않음():
    # 45 + 쉬는 15 + 30 = 90, 남는 10분은 D02에만
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + 100), overrides={"D01": 45})
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "relaxed")
    assert [i.stay_min for i in option.items] == [45, 40]


# ---------- §3 F, §7 Q10: 쉬는 시간, 안마다 따로 고르기 ----------


def test_쉬는시간_장소_사이_여유15분_알찬5분():
    places = as_places(place("D01"), place("D02"))
    result = compose_courses(day_plan(), ["D01", "D02"], places)
    for label, buffer_min in BUFFER.items():
        option = option_for(result, label)
        first, second = option.items
        assert to_min(second.start) - to_min(first.end) == buffer_min


@pytest.mark.parametrize(
    "minutes, packed, relaxed",
    [(100, 3, 2), (99, 2, 2), (120, 3, 3), (119, 3, 2)],
    ids=["알찬_딱맞음", "알찬_1분모자람", "여유_딱맞음", "여유_1분모자람"],
)
def test_Q10_쉬는시간을_넣은채_안마다_따로_골라서_여유안은_더_적을수_있음(minutes, packed, relaxed):
    # 같은 자리 카페 3곳, 최소 30분: 알찬 30×3+5×2=100분, 여유 30×3+15×2=120분
    places = as_places(place("D01"), place("D02"), place("D03"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + minutes))
    result = compose_courses(plan, ["D01", "D02", "D03"], places)
    assert len(visits(option_for(result, "packed"))) == packed
    assert len(visits(option_for(result, "relaxed"))) == relaxed
    assert_all_valid(plan, ["D01", "D02", "D03"], places, result)


# ---------- §3 F 고르기: 많이 → 이동 합 → id ----------


def test_DP_이동이_길어도_가장_많이_넣는_쪽():
    # 하루 100분. 큰 명소 D01(이동 0, 60분)은 다른 곳과 함께 못 들어감. D02+D03은 들어감
    places = as_places(place("D01", "landmark"), place("D02", km=0.88), place("D03", km=0.88))
    plan = day_plan(start="09:00", end="10:40")
    result = compose_courses(plan, ["D01", "D02", "D03"], places)
    for option in options(result):
        assert sorted(visits(option)) == ["D02", "D03"]
        assert dropped_reason(option, "D01") == "no_time"


def test_DP_개수가_같으면_이동_합이_작은_쪽():
    # 하루 120분이면 어느 두 곳이든 들어가고 세 곳은 못 들어감. 가까운 D02+D03
    places = as_places(place("D01", km=2.9), place("D02", km=0.25), place("D03", km=0.25))
    plan = day_plan(start="09:00", end="11:00")
    result = compose_courses(plan, ["D01", "D02", "D03"], places)
    for option in options(result):
        assert sorted(visits(option)) == ["D02", "D03"]


def test_DP_이동까지_같으면_id_순으로_고름():
    places = as_places(place("D01", km=0.25), place("D02", km=0.25))
    plan = day_plan(start="09:00", end="09:50")
    for option in options(compose_courses(plan, ["D02", "D01"], places)):
        assert visits(option) == ["D01"]
        assert dropped_reason(option, "D02") == "no_time"


@pytest.mark.parametrize("ids", [["D01", "D02"], ["P2", "P10"]], ids=["두자리", "숫자크기_P2_P10"])
def test_DP_Q2_이동까지_같으면_방문순서도_id_숫자_순(ids):
    places = as_places(*[place(pid, km=0.25) for pid in ids])
    for option in options(compose_courses(day_plan(), list(reversed(ids)), places)):
        assert visits(option) == ids


# ---------- AC-9, §7 Q12: 영업시간 ----------


def test_AC09_17시에_닫는_곳은_먼저_넣는_순서를_찾음():
    # 다른 곳 먼저면 16:18~17:18로 17시를 넘긴다
    closing = place("D02", "landmark", km=0.25, hours=opening("09:00", "17:00"))
    other = place("D01", "landmark", km=0.56)
    places = as_places(other, closing)
    plan = day_plan(start="15:00", end="21:00")
    result = compose_courses(plan, ["D01", "D02"], places)
    for option in options(result):
        assert visits(option) == ["D02", "D01"]
        assert to_min(item_of(option, "D02").end) <= to_min("17:00")


@pytest.mark.parametrize(
    "start, kept",
    [("16:30", True), ("16:31", False)],
    ids=["닫는_정각에_끝남_허용", "1분_넘치면_closed_at_time"],
)
def test_AC09_Q12_닫는_정각_경계(start, kept):
    places = as_places(place("D01"), place("D02", hours=opening("09:00", "17:00")))
    plan = day_plan(start=start, end="21:00")
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        if kept:
            item = item_of(option, "D02")
            assert item.start == "16:30"
            assert item.end == "17:00"
        else:
            assert "D02" not in visits(option)
            assert dropped_reason(option, "D02") == "closed_at_time"


def test_Q12_일찍_도착하면_여는_시각까지_기다림():
    places = as_places(place("D01", km=0.25, hours=opening("11:00", "20:00")))
    for option in options(compose_courses(day_plan(start="09:00"), ["D01"], places)):
        item = item_of(option, "D01")
        assert item.start == "11:00"
        assert item.wait_min == 116  # 이동 4분 뒤 09:04 도착 → 11:00까지


@pytest.mark.parametrize(
    "weekday, kept",
    [(0, True), (1, False), (6, False)],
    ids=["그_요일", "다음_요일", "전날_요일"],
)
def test_Q12_그날_요일의_영업구간만_본다_휴무면_closed_at_time(weekday, kept):
    places = as_places(place("D01"), place("D02", hours=opening("09:00", "20:00", weekday)))
    for option in options(compose_courses(day_plan(), ["D01", "D02"], places)):
        if kept:
            assert "D02" in visits(option)
        else:
            assert dropped_reason(option, "D02") == "closed_at_time"


def test_요일_번호는_0이_월요일_6이_일요일():
    sunday = date(2026, 11, 15)
    places = as_places(place("D01", hours=opening("09:00", "20:00", 6)))
    result = compose_courses(day_plan(day=sunday), ["D01"], places)
    assert visits(options(result)[0]) == ["D01"]


def test_Q12_머무는_동안_내내_한_구간_안에_있어야_함():
    # 쪼개진 두 구간은 합쳐 60분이지만 한 구간에 큰 명소 최소 60분이 안 들어감
    hours = [
        Opening(weekday=0, open="11:00", close="11:30"),
        Opening(weekday=0, open="12:00", close="12:30"),
    ]
    places = as_places(place("D01"), place("D02", "landmark", hours=hours))
    for option in options(compose_courses(day_plan(), ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") == "closed_at_time"


@pytest.mark.parametrize("close_at", ["26:00", "29:59"])
def test_Q12_자정_넘겨_닫는_표기를_읽음(close_at):
    places = as_places(place("D01", "night", hours=opening("20:00", close_at)))
    plan = day_plan(start="20:00", end="23:30")
    for option in options(compose_courses(plan, ["D01"], places)):
        assert visits(option) == ["D01"]


def test_Q34_이동_때문에만_못_들어가면_no_time():
    # 영업 구간 자체는 하루 안이고 이동 16분 때문에 최소 30분이 안 들어간다
    places = as_places(place("D01"), place("D02", km=1.19, hours=opening("10:00", "10:30")))
    plan = day_plan(start="10:00", end="21:00")
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") == "no_time"


@pytest.mark.parametrize(
    "end, reason",
    [("20:30", "no_time"), ("20:29", "closed_at_time")],
    ids=["숙소복귀_때문이면_no_time", "하루끝까지_최소가_안들어가면_closed"],
)
def test_Q34_하루_범위는_이동_제외_start에서_end(end, reason):
    # 20:00~20:30이면 영업·하루 범위 안에 30분이 들어가지만 숙소까지 16분을 못 뺀다
    places = as_places(place("D01"), place("D02", km=1.19, hours=opening("20:00", "22:00")))
    plan = day_plan(start="19:00", end=end)
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") == reason


@pytest.mark.parametrize("value, feasible", [(30, True), (31, False)], ids=["최소와_같음", "1분_넘침"])
def test_Q34_최소는_들어가는데_사용자값이_안들어가는_꼭갈곳은_user_stay_conflict(value, feasible):
    places = as_places(place("D01", hours=opening("10:00", "10:30")))
    plan = day_plan(must=("D01",), overrides={"D01": value})
    result = compose_courses(plan, [], places)
    if feasible:
        assert visits(options(result)[0]) == ["D01"]
    else:
        assert isinstance(result, Infeasible)
        assert result.reason == "user_stay_conflict"
        assert result.blocking == ["D01"]
        assert result.suggest_drop == ["D01"]  # §9 Q44 ④


@pytest.mark.parametrize("close_at", ["26:00", "29:59"])
def test_Q27_하루_끝이_자정을_넘어도_받음(close_at):
    places = as_places(place("D01", "night", hours=opening("23:30", close_at)))
    plan = day_plan(start="23:30", end=close_at)
    result = compose_courses(plan, ["D01"], places)
    assert item_of(option_for(result, "packed"), "D01").end == "25:00"  # 23:30 + 보통 90분
    assert item_of(option_for(result, "relaxed"), "D01").end == "26:00"  # 23:30 + 최대 150분


# ---------- §7 Q13: 확인 상태 ----------


@pytest.mark.parametrize(
    "hours, status, expected",
    [
        (None, "unknown", "unknown"),
        (None, "confirmed", "unknown"),
        (opening("00:00", "23:59"), "confirmed", "confirmed"),
        (opening("00:00", "23:59"), "unverified", "unverified"),
        (opening("00:00", "23:59"), "unknown", "unverified"),
    ],
    ids=["모름", "None이면_데이터가_확인이어도_모름", "확인됨", "미확인", "영업시간_있는데_모름이면_미확인"],
)
def test_Q13_확인상태_판정을_항목에_복사(hours, status, expected):
    places = as_places(place("D01", hours=hours, status=status))
    for option in options(compose_courses(day_plan(), ["D01"], places)):
        assert item_of(option, "D01").hours_status == expected


# ---------- 하루 끝 ----------


@pytest.mark.parametrize(
    "end, kept",
    [("09:54", True), ("09:53", False)],
    ids=["숙소까지_딱_맞음", "1분_모자람"],
)
def test_하루끝은_end_빼기_숙소까지_이동(end, kept):
    # 이동 12 + 최소 30 + 집까지 12 = 54분
    places = as_places(place("D01", km=0.88))
    for option in options(compose_courses(day_plan(start="09:00", end=end), ["D01"], places)):
        if kept:
            assert visits(option) == ["D01"]
        else:
            assert visits(option) == []
            assert dropped_reason(option, "D01") == "no_time"


# ---------- AC-10, §7 Q14: 고정 일정 ----------


@pytest.mark.parametrize("with_place", [False, True], ids=["장소없음", "장소있음"])
def test_AC10_고정일정_15시_16시_시각그대로_겹침없음(with_place):
    cafes = [place(f"D{i:02d}", km=0.1 * i) for i in range(1, 5)]
    venue = place("D09", km=0.5)
    places = as_places(*cafes, venue)
    plan = day_plan(fixed=(fixed_event("15:00", "16:00", venue if with_place else None),))
    picks = [p.id for p in cafes]

    result = compose_courses(plan, picks, places)

    for option in options(result):
        fixed = fixed_items(option)
        assert [(i.start, i.end) for i in fixed] == [("15:00", "16:00")]
        assert sorted(visits(option)) == picks
    assert_all_valid(plan, picks, places, result)


def test_Q14_장소없는_고정일정은_이동0분이고_다음_이동은_직전_장소에서():
    before = place("D01", km=0.88, hours=opening("09:00", "10:30"))
    after = place("D02", km=1.19, hours=opening("11:00", "20:00"))
    places = as_places(before, after)
    plan = day_plan(start="09:00", end="14:00", fixed=(fixed_event("10:30", "11:00"),))

    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        first, fixed, second = option.items
        assert (first.place_id, fixed.is_fixed, second.place_id) == ("D01", True, "D02")
        assert fixed.travel_min == 0
        assert second.travel_min == 5  # 숙소에서 오면 16분, D01에서 오면 0.31km 5분
        assert (fixed.place_id, fixed.hours_status, fixed.stay_source) == (None, None, None)  # §8 Q28


@pytest.mark.parametrize(
    "with_place, first_stay, second_start",
    [(False, 60, "10:30"), (True, 55, "10:34")],
    ids=["장소없음_이동0", "장소있음_이동4분_앞곳은_5분단위라_55분"],
)
def test_Q28_고정일정_앞뒤에는_쉬는시간_없이_이동시간만(with_place, first_stay, second_start):
    venue = place("D09", km=0.25)
    places = as_places(
        place("D01", hours=opening("09:00", "10:00")), place("D02", hours=opening("10:30", "20:00")), venue
    )
    plan = day_plan(fixed=(fixed_event("10:00", "10:30", venue if with_place else None),))
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert visits(option) == ["D01", "D02"]
        assert item_of(option, "D01").stay_min == first_stay
        assert item_of(option, "D02").start == second_start


@pytest.mark.parametrize(
    "close_at, reason",
    [("15:29", "closed_at_time"), ("16:00", "fixed_conflict"), ("16:29", "fixed_conflict"), ("16:30", None)],
    ids=["최소가_안들어가면_먼저_closed", "영업이_고정일정과_같음", "1분_모자라_모두_겹침", "고정일정_끝나고_딱_들어감"],
)
def test_Q29_판정순서_closed_다음_fixed_conflict(close_at, reason):
    places = as_places(place("D01"), place("D02", hours=opening("15:00", close_at)))
    plan = day_plan(fixed=(fixed_event("15:00", "16:00"),))
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        if reason is None:
            assert item_of(option, "D02").start == "16:00"
        else:
            assert dropped_reason(option, "D02") == reason


def test_Q29_겹치지_않는_시간대가_있는데_이동으로_못가면_no_time():
    # 16:00~16:30은 고정 일정과 안 겹치지만 이동 16분이면 최소 30분이 안 들어간다
    places = as_places(place("D01"), place("D02", km=1.19, hours=opening("15:00", "16:30")))
    plan = day_plan(fixed=(fixed_event("15:00", "16:00"),))
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") == "no_time"


# ---------- §8 Q30: 고정 일정 입력 검사 ----------


@pytest.mark.parametrize(
    "events",
    [
        (("09:30", "10:30"), ("10:00", "11:00")),
        (("10:00", "11:00"), ("10:59", "11:30")),
        (("08:59", "10:00"),),
        (("20:00", "21:01"),),
    ],
    ids=["겹침", "1분_겹침", "시작이_1분_이름", "끝이_1분_늦음"],
)
def test_Q30_고정일정끼리_겹치거나_하루_밖이면_ValueError(events):
    fixed = tuple(fixed_event(s, e, fid=f"F{i}") for i, (s, e) in enumerate(events))
    with pytest.raises(ValueError):
        compose_courses(day_plan(fixed=fixed), [], {})


@pytest.mark.parametrize(
    "events",
    [
        (("10:00", "11:00"), ("11:00", "11:30")),
        (("09:00", "10:00"),),
        (("20:00", "21:00"),),
    ],
    ids=["맞닿음", "시작_정각", "끝_정각"],
)
def test_Q30_맞닿거나_하루_시작_끝_정각이면_입력_오류가_아님(events):
    fixed = tuple(fixed_event(s, e, fid=f"F{i}") for i, (s, e) in enumerate(events))
    result = compose_courses(day_plan(fixed=fixed), [], {})
    assert [(i.start, i.end) for i in options(result)[0].items] == list(events)


@pytest.mark.parametrize("start, reachable", [("09:14", True), ("09:13", False)], ids=["딱_맞음", "1분_모자람"])
def test_Q30_숙소에서_고정일정까지_시간_안에_못가면_fixed_unreachable(start, reachable):
    venue = place("D09", km=1.21)  # 이동 14분
    plan = day_plan(fixed=(fixed_event(start, "10:00", venue),))
    result = compose_courses(plan, [], as_places(venue))
    if reachable:
        assert fixed_items(options(result)[0])[0].start == start
    else:
        assert result == Infeasible(reason="fixed_unreachable", blocking=["F1"], suggest_drop=[])  # §9 Q45 ①


@pytest.mark.parametrize("start, reachable", [("10:14", True), ("10:13", False)], ids=["딱_맞음", "1분_모자람"])
def test_Q30_고정일정_사이를_시간_안에_못가면_fixed_unreachable(start, reachable):
    first_venue, second_venue = place("D08"), place("D09", km=1.21)  # 사이 14분
    fixed = (
        fixed_event("09:00", "10:00", first_venue, fid="F1"),
        fixed_event(start, "11:00", second_venue, fid="F2"),
    )
    result = compose_courses(day_plan(fixed=fixed), [], as_places(first_venue, second_venue))
    if reachable:
        assert len(fixed_items(options(result)[0])) == 2
    else:
        assert result == Infeasible(reason="fixed_unreachable", blocking=["F2"], suggest_drop=[])  # §9 Q45 ①


@pytest.mark.parametrize("end, reachable", [("20:48", True), ("20:49", False)], ids=["딱_맞음", "1분_넘침"])
def test_Q45_고정일정_뒤_숙소복귀가_하루끝을_넘으면_fixed_unreachable(end, reachable):
    venue = place("D09", km=0.88)  # 숙소까지 12분, 하루 끝 21:00
    plan = day_plan(fixed=(fixed_event("20:00", end, venue),))
    result = compose_courses(plan, [], as_places(venue))
    if reachable:
        option = options(result)[0]
        assert fixed_items(option)[0].end == end
        assert option.go_home_min == 12
    else:
        assert result == Infeasible(reason="fixed_unreachable", blocking=["F1"], suggest_drop=[])


@pytest.mark.parametrize(
    "start, end",
    [("10:00", "10:00"), ("10:01", "10:00")],
    ids=["시작과_끝이_같음", "시작이_끝보다_늦음"],
)
def test_Q45_고정일정_시작이_끝보다_늦거나_같으면_ValueError(start, end):
    with pytest.raises(ValueError):
        compose_courses(day_plan(fixed=(fixed_event(start, end),)), [], {})


def test_Q45_고정일정_시작이_끝보다_1분_빠르면_정상():
    result = compose_courses(day_plan(fixed=(fixed_event("10:00", "10:01"),)), [], {})
    assert fixed_items(options(result)[0])[0].end == "10:01"


@pytest.mark.parametrize(
    "plan_end, fixed_end, valid",
    [
        ("29:59", "29:59", True),
        ("29:59", "30:00", False),
        ("30:00", "20:00", False),
    ],
    ids=["고정일정과_하루끝_29시59분", "고정일정_끝_30시", "하루끝_30시"],
)
def test_Q45_29시59분을_넘는_시각은_ValueError(plan_end, fixed_end, valid):
    if valid:
        plan = day_plan(end=plan_end, fixed=(fixed_event("29:00", fixed_end),))
        assert fixed_items(options(compose_courses(plan, [], {}))[0])[0].end == fixed_end
    else:
        with pytest.raises(ValueError):
            plan = day_plan(end=plan_end, fixed=(fixed_event("19:00", fixed_end),))
            compose_courses(plan, [], {})


@pytest.mark.parametrize(
    "hours, status, expected",
    [
        (None, "unknown", "unknown"),
        (None, "confirmed", "unknown"),
        (opening("00:00", "23:59"), "confirmed", "confirmed"),
        (opening("00:00", "23:59"), "unverified", "unverified"),
        (opening("00:00", "23:59"), "unknown", "unverified"),
    ],
    ids=["모름", "None이면_데이터가_확인이어도_모름", "확인됨", "미확인", "영업시간_있는데_모름이면_미확인"],
)
def test_Q46_장소있는_고정일정은_그_장소의_판정값이고_stay_source는_None(hours, status, expected):
    venue = place("D09", km=0.25, hours=hours, status=status)
    plan = day_plan(fixed=(fixed_event("10:00", "11:00", venue),))
    for option in options(compose_courses(plan, [], as_places(venue))):
        item = fixed_items(option)[0]
        assert item.place_id == "D09"
        assert item.hours_status == expected
        assert item.stay_source is None


# ---------- AC-11, §7 Q15: 꼭 갈 곳이 영업시간 밖 ----------


@pytest.mark.parametrize(
    "hours",
    [opening("09:00", "20:00", 1), opening("10:00", "10:29")],
    ids=["그날_휴무", "영업구간이_최소보다_1분_짧음"],
)
def test_AC11_Q15_꼭갈곳이_영업시간_밖이면_Infeasible(hours):
    places = as_places(place("D01", hours=hours), place("D02"))
    result = compose_courses(day_plan(must=("D01",)), ["D02"], places)
    assert result == Infeasible(reason="must_visit_closed", blocking=["D01"], suggest_drop=[])


def test_AC11_Q12_영업구간이_최소와_딱_같으면_가능():
    places = as_places(place("D01", hours=opening("10:00", "10:30")))
    plan = day_plan(must=("D01",))
    for option in options(compose_courses(plan, [], places)):
        assert visits(option) == ["D01"]


def test_AC11_Q15_닫힌_꼭갈곳만_blocking에():
    closed = opening("09:00", "20:00", 1)
    places = as_places(place("D01", hours=closed), place("D02", hours=closed), place("D03"))
    result = compose_courses(day_plan(must=("D01", "D02", "D03")), [], places)
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_closed"
    assert sorted(result.blocking) == ["D01", "D02"]
    assert result.suggest_drop == []


def test_FR07_꼭갈곳끼리_시간이_모자라면_Infeasible():
    places = as_places(place("D01", "landmark"), place("D02", "landmark"))
    plan = day_plan(start="09:00", end="10:30", must=("D01", "D02"))
    result = compose_courses(plan, ["D01", "D02"], places)
    assert isinstance(result, Infeasible)
    assert result.reason


def test_Q33_꼭갈곳끼리_시간이_모자라면_must_visit_overflow():
    places = as_places(place("D01", "landmark"), place("D02", "landmark"))
    plan = day_plan(start="09:00", end="10:30", must=("D01", "D02"))
    result = compose_courses(plan, ["D01", "D02"], places)
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_overflow"
    assert sorted(result.blocking) == ["D01", "D02"]
    assert sorted(result.suggest_drop) == ["D01", "D02"]


def test_Q33_빼면_나머지가_들어가는_꼭갈곳만_제안():
    # 하루 94분. 큰 명소 D01(60)을 빼면 카페 둘(65분)이 들어가고, 카페를 빼면 95분이라 안 들어간다
    places = as_places(place("D01", "landmark"), place("D02"), place("D03"))
    plan = day_plan(start="09:00", end="10:34", must=("D01", "D02", "D03"))
    result = compose_courses(plan, [], places)
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_overflow"
    assert sorted(result.blocking) == ["D01", "D02", "D03"]
    assert result.suggest_drop == ["D01"]


# ---------- AC-12, §7 Q16: 사용자가 바꾼 머무는 시간 ----------


def test_AC12_카페를_120분으로_바꾸면_지키고_넘친_곳은_no_time():
    # 하루 170분. 바꾸기 전에는 세 곳 다 들어감
    places = as_places(place("D01"), place("D02"), place("D03", km=2.1))
    picks = ["D01", "D02", "D03"]
    before = compose_courses(day_plan(start="09:00", end="11:50"), picks, places)
    for option in options(before):
        assert sorted(visits(option)) == picks

    plan = day_plan(start="09:00", end="11:50", overrides={"D01": 120})
    after = compose_courses(plan, picks, places)
    for option in options(after):
        cafe = item_of(option, "D01")
        assert cafe.stay_min == 120
        assert cafe.stay_source == "user"
        assert item_of(option, "D02").stay_source == "auto"
        assert dropped_reason(option, "D03") == "no_time"
    assert_all_valid(plan, picks, places, after)


def test_Q32_바꾼_곳은_빼면_더_많이_들어가도_유지():
    # D01을 빼면 세 곳이 들어가지만 꼭 갈 곳처럼 유지한다. 나머지는 id 순으로 한 곳
    places = as_places(*[place(f"D{i:02d}") for i in range(1, 5)])
    plan = day_plan(start="09:00", end="11:50", overrides={"D01": 120})
    for option in options(compose_courses(plan, ["D01", "D02", "D03", "D04"], places)):
        assert visits(option) == ["D01", "D02"]
        assert dropped_reason(option, "D03") == "no_time"
        assert dropped_reason(option, "D04") == "no_time"


def test_Q44_꼭갈곳_1곳이_혼자서_못들어가면_must_visit_overflow_제안없음():
    places = as_places(place("D01"))
    plan = day_plan(start="09:00", end="09:29", must=("D01",))
    assert compose_courses(plan, [], places) == Infeasible(
        reason="must_visit_overflow", blocking=["D01"], suggest_drop=[]
    )


def test_Q44_꼭갈곳_1곳이_최소와_딱_같으면_들어감():
    places = as_places(place("D01"))
    plan = day_plan(start="09:00", end="09:30", must=("D01",))
    assert visits(options(compose_courses(plan, [], places))[0]) == ["D01"]


@pytest.mark.parametrize(
    "end, feasible",
    [("09:54", True), ("09:53", False)],
    ids=["이동_포함_딱_맞음", "이동_포함_1분_모자람"],
)
def test_Q44_꼭갈곳_1곳의_시간에_오가는_이동도_들어감(end, feasible):
    # 이동 12 + 최소 30 + 숙소까지 12 = 54분
    places = as_places(place("D01", km=0.88))
    result = compose_courses(day_plan(start="09:00", end=end, must=("D01",)), [], places)
    if feasible:
        assert visits(options(result)[0]) == ["D01"]
    else:
        assert result == Infeasible(reason="must_visit_overflow", blocking=["D01"], suggest_drop=[])


@pytest.mark.parametrize(
    "weekday, kept",
    [(0, True), (1, False)],
    ids=["그날_영업", "그날_휴무"],
)
def test_Q44_시간을_바꾼_담은곳이_그날_휴무면_Infeasible이_아니라_closed_at_time(weekday, kept):
    places = as_places(place("D01", hours=opening("09:00", "20:00", weekday)), place("D02"))
    plan = day_plan(overrides={"D01": 45})
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        if kept:
            item = item_of(option, "D01")
            assert (item.stay_min, item.stay_source) == (45, "user")
        else:
            assert visits(option) == ["D02"]
            assert dropped_reason(option, "D01") == "closed_at_time"


def test_Q44_Infeasible_순서_fixed_unreachable이_must_visit_closed보다_먼저():
    venue = place("D09", km=1.21)  # 이동 14분
    places = as_places(venue, place("D01", hours=opening("09:00", "20:00", 1)))
    plan = day_plan(fixed=(fixed_event("09:13", "10:00", venue),), must=("D01",))
    assert compose_courses(plan, [], places) == Infeasible(
        reason="fixed_unreachable", blocking=["F1"], suggest_drop=[]
    )


def test_Q44_Infeasible_순서_must_visit_closed가_must_visit_overflow보다_먼저():
    places = as_places(
        place("D01", hours=opening("09:00", "20:00", 1)), place("D02", "landmark"), place("D03", "landmark")
    )
    plan = day_plan(start="09:00", end="10:30", must=("D01", "D02", "D03"))
    assert compose_courses(plan, [], places) == Infeasible(
        reason="must_visit_closed", blocking=["D01"], suggest_drop=[]
    )


def test_Q44_Infeasible_순서_must_visit_overflow가_user_stay_conflict보다_먼저():
    # 최소 시간만으로도 두 곳이 안 들어간다 (60 + 쉬는 5 + 60 > 90). 사용자 값도 넘친다
    places = as_places(place("D01", "landmark"), place("D02", "landmark"))
    plan = day_plan(start="09:00", end="10:30", must=("D01", "D02"), overrides={"D01": 120})
    result = compose_courses(plan, [], places)
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_overflow"
    assert sorted(result.blocking) == ["D01", "D02"]


def test_Q44_Infeasible_순서_must_visit_closed가_user_stay_conflict보다_먼저():
    places = as_places(place("D01", hours=opening("09:00", "20:00", 1)), place("D02"))
    plan = day_plan(start="09:00", end="11:00", must=("D01", "D02"), overrides={"D02": 121})
    assert compose_courses(plan, [], places) == Infeasible(
        reason="must_visit_closed", blocking=["D01"], suggest_drop=[]
    )


def test_Q44_Infeasible_순서_fixed_unreachable이_must_visit_overflow와_user_stay_conflict보다_먼저():
    venue = place("D09", km=1.21)
    places = as_places(venue, place("D01", "landmark"), place("D02", "landmark"))
    plan = day_plan(
        start="09:00",
        end="10:30",
        fixed=(fixed_event("09:13", "09:20", venue),),
        must=("D01", "D02"),
        overrides={"D01": 120},
    )
    assert compose_courses(plan, [], places) == Infeasible(
        reason="fixed_unreachable", blocking=["F1"], suggest_drop=[]
    )


@pytest.mark.parametrize(
    "minutes, labels",
    [(65, ["packed"]), (74, ["packed"]), (75, ["relaxed", "packed"])],
    ids=["알찬안_딱_맞음", "여유안_1분_모자람", "여유안_딱_맞음"],
)
def test_Q42_꼭갈곳이_알찬안에만_들어가면_packed_1안만(minutes, labels):
    # 같은 자리 카페 2곳: 알찬 30+5+30=65분, 여유 30+15+30=75분
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + minutes), must=("D01", "D02"))
    result = compose_courses(plan, [], places)
    assert sorted(o.label for o in options(result)) == sorted(labels)
    for option in result:
        assert visits(option) == ["D01", "D02"]
    assert_all_valid(plan, [], places, result)


def test_Q42_꼭갈곳이_알찬안에도_1분_모자라면_Infeasible():
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end=hhmm(to_min("09:00") + 64), must=("D01", "D02"))
    result = compose_courses(plan, [], places)
    assert isinstance(result, Infeasible)
    assert result.reason == "must_visit_overflow"


@pytest.mark.parametrize(
    "picks, stays",
    [(["D01"], {"D01": 60}), (["D01", "D02"], {"D01": 60, "D02": 45})],
    ids=["담지_않으면_무시", "담으면_지킴"],
)
def test_Q43_담은곳_꼭갈곳이_아닌_장소의_사용자값은_무시(picks, stays):
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(overrides={"D02": 45})
    option = option_for(compose_courses(plan, picks, places), "packed")
    assert {i.place_id: i.stay_min for i in option.items} == stays
    assert option.dropped == []
    assert_course_valid(plan, picks, places, option)


def test_Q43_담지_않은_곳의_사용자값으로는_Infeasible이_되지_않음():
    # 하루 60분에 D02를 300분으로 바꿔 두어도 담지 않았으므로 상관없다
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end="10:00", must=("D01",), overrides={"D02": 300})
    assert visits(options(compose_courses(plan, [], places))[0]) == ["D01"]


@pytest.mark.parametrize("value, feasible", [(75, True), (86, False)], ids=["두_안_모두_들어감", "알찬안도_1분_넘침"])
def test_Q32_바꾼_담은곳과_꼭갈곳이_함께_못들어가면_user_stay_conflict(value, feasible):
    # 하루 150분. 꼭 갈 큰 명소 60분 + 쉬는 시간 + 사용자 값
    places = as_places(place("D01", "landmark"), place("D02"), place("D03"))
    plan = day_plan(start="09:00", end="11:30", must=("D01",), overrides={"D02": value})
    result = compose_courses(plan, ["D02", "D03"], places)
    if feasible:
        for option in options(result):
            assert visits(option) == ["D01", "D02"]
    else:
        assert isinstance(result, Infeasible)
        assert result.reason == "user_stay_conflict"
        assert result.blocking == ["D02"]
        assert sorted(result.suggest_drop) == ["D02", "D03"]  # §9 Q44 ④


@pytest.mark.parametrize(
    "value, kept_as",
    [(14, 15), (15, 15), (20, 20), (200, 200), (300, 300), (301, 300)],
    ids=["14는_15로", "15_그대로", "범위밖_짧아도_그대로", "범위밖_길어도_그대로", "300_그대로", "301은_300으로"],
)
def test_Q16_사용자값은_15에서_300분이면_그대로_밖이면_자름(value, kept_as):
    places = as_places(place("D01"))
    plan = day_plan(start="08:00", end="22:00", overrides={"D01": value})
    for option in options(compose_courses(plan, ["D01"], places)):
        item = item_of(option, "D01")
        assert item.stay_min == kept_as
        assert item.stay_source == "user"


@pytest.mark.parametrize(
    "value, feasible",
    [(120, True), (121, False)],
    ids=["딱_맞음", "1분_넘침"],
)
def test_Q16_사용자값_때문에_꼭갈곳을_못넣으면_user_stay_conflict(value, feasible):
    places = as_places(place("D01"), place("D02"), place("D03"))
    plan = day_plan(start="09:00", end="11:00", must=("D01",), overrides={"D01": value})
    result = compose_courses(plan, ["D02", "D03"], places)
    if feasible:
        assert visits(options(result)[0]) == ["D01"]
    else:
        assert isinstance(result, Infeasible)
        assert result.reason == "user_stay_conflict"
        assert result.blocking == ["D01"]
        assert sorted(result.suggest_drop) == ["D01", "D02", "D03"]  # §9 Q44 ④


# ---------- §7 Q17: 탐욕법 ----------


@pytest.mark.parametrize("buffer_min, second_start", [(5, "09:43"), (0, "09:38")])
def test_Q17_탐욕법은_지금_위치에서_가장_가까운_곳부터_최소_머무는시간(buffer_min, second_start):
    # 숙소 기준 거리 순이면 A→C→B지만, A에서는 B가 더 가깝다
    a = place("D03", km=0.25)
    b = place("D01", km=0.5)
    c = place("D02", km=-0.4)
    items = compose_greedy(day_plan(), ["D01", "D02", "D03"], as_places(a, b, c), buffer_min)
    assert [i.place_id for i in items] == ["D03", "D01", "D02"]
    assert all(i.stay_min == 30 for i in items)
    assert items[0].start == "09:04"
    assert items[1].start == second_start


def test_AC14_탐욕법이_놓치는_순서를_DP는_찾음():
    # 가까운 D01부터 가면 D02(10:45에 닫음)를 못 넣음. D02 먼저면 둘 다 들어감
    places = as_places(place("D01", km=0.25), place("D02", km=0.88, hours=opening("10:00", "10:45")))
    plan = day_plan(start="10:00", end="21:00")
    greedy = compose_greedy(plan, ["D01", "D02"], places, 5)
    assert [i.place_id for i in greedy] == ["D01"]
    assert visits(option_for(compose_courses(plan, ["D01", "D02"], places), "packed")) == ["D02", "D01"]


# ---------- 임의 입력 (Hypothesis) ----------

openings = st.builds(
    lambda weekday, start, length: Opening(
        weekday=weekday, open=hhmm(start), close=hhmm(min(start + length, to_min("29:59")))
    ),
    st.sampled_from([0, 0, 0, 1, 6]),
    st.integers(6, 18).map(lambda h: h * 60),
    st.integers(30, 720),
)
stay_ranges = st.builds(
    lambda low, up, more: StayRange(min=low, typical=low + up, max=low + up + more),
    st.integers(15, 60),
    st.integers(0, 60),
    st.integers(0, 60),
)


@st.composite
def scenarios(draw, allow_must=True, allow_overrides=True):
    count = draw(st.integers(1, 6))
    places: dict[str, Place] = {}
    for number in range(1, count + 1):
        pid = f"D{number:02d}"
        hours = draw(st.none() | st.lists(openings, min_size=1, max_size=3))
        status = draw(st.sampled_from(["confirmed", "unverified", "unknown"]))
        places[pid] = place(
            pid,
            category=draw(st.sampled_from(sorted(DEFAULT_STAY))),
            km=draw(st.integers(-250, 250)) / 100,
            east_km=draw(st.integers(-250, 250)) / 100,
            hours=hours,
            status="unknown" if hours is None else status,
            stay=draw(st.none() | stay_ranges),
        )
    ids = list(places)
    start = draw(st.integers(8, 11)) * 60 + draw(st.sampled_from([0, 30]))
    end = draw(st.integers(18, 23)) * 60  # 고정 일정은 늦어도 17:00에 끝난다

    # 고정 일정은 하루 안이고 숙소에서 갈 수 있는 시각으로 만든다 (§8 Q30)
    fixed: list[PlanFixed] = []
    if draw(st.booleans()):
        fixed_start = draw(st.integers(12 * 4, 15 * 4)) * 15
        fixed_len = draw(st.integers(2, 8)) * 15
        venue = None
        if draw(st.booleans()):
            venue = place("F1", km=draw(st.integers(-200, 200)) / 100)
            places["F1"] = venue
        fixed.append(fixed_event(hhmm(fixed_start), hhmm(fixed_start + fixed_len), venue))

    must = draw(st.lists(st.sampled_from(ids), unique=True, max_size=2)) if allow_must else []
    picks = draw(st.lists(st.sampled_from(ids), unique=True))
    overrides = {}
    if allow_overrides:
        # 담지 않은 곳의 값도 만든다. 무시되어야 한다 (§9 Q43)
        for pid in draw(st.lists(st.sampled_from(ids), unique=True, max_size=2)):
            overrides[pid] = draw(st.integers(1, 400))
    plan = DayPlan(
        date=MONDAY,
        start=hhmm(start),
        end=hhmm(end),
        lodging=north_of(0.0),
        fixed=fixed,
        must_visit=must,
        stay_overrides=overrides,
    )
    return plan, picks, places


@settings(max_examples=200, deadline=None)
@given(scenarios())
def test_AC13_임의_입력에서_겹침_영업시간_고정일정_하루범위_머무는시간_위반_0건(scenario):
    plan, picks, places = scenario
    result = compose_courses(plan, picks, places)
    if isinstance(result, Infeasible):
        assert result.reason
        return
    assert_all_valid(plan, picks, places, result)


@settings(max_examples=200, deadline=None)
@given(scenarios(allow_must=False, allow_overrides=False))
def test_AC14_임의_입력에서_DP가_넣은_장소수는_탐욕법_이상(scenario):
    plan, picks, places = scenario
    result = compose_courses(plan, picks, places)
    if isinstance(result, Infeasible):
        return  # §7 Q17: DP가 Infeasible이면 비교에서 뺀다
    packed = option_for(result, "packed")
    greedy = compose_greedy(plan, picks, places, 5)
    assert len(visits(packed)) >= len([i for i in greedy if not i.is_fixed])


@settings(max_examples=200, deadline=None)
@given(scenarios())
def test_AC15_같은_입력을_두번_넣으면_같은_결과(scenario):
    plan, picks, places = scenario
    first = compose_courses(plan, picks, places)
    second = compose_courses(
        plan.model_copy(deep=True), list(picks), {pid: p.model_copy(deep=True) for pid, p in places.items()}
    )
    assert first == second


# ---------- AC-16, §7 Q18: 12곳 실행 시간 ----------


@pytest.mark.slow
@pytest.mark.parametrize(
    "must_count",
    [1, 2],
    ids=["꼭갈곳1_담은곳11", "꼭갈곳2_담은곳10_꼭갈곳은_담은곳에_없음"],
)
def test_AC16_꼭갈곳과_담은곳_합쳐_12곳이면_3번_중앙값_1초_이내(must_count):
    all_places = [
        place(f"D{i:02d}", km=0.15 * (i % 4), east_km=0.15 * (i % 3), hours=opening("08:00", "23:00") if i % 2 else None)
        for i in range(1, 13)
    ]
    ids = [p.id for p in all_places]
    must, picks = ids[:must_count], ids[must_count:]
    assert len(set(must) | set(picks)) == 12
    plan = day_plan(start="08:00", end="23:00", must=tuple(must))
    places = as_places(*all_places)

    runs = []
    for _ in range(3):
        started = time.perf_counter()
        result = compose_courses(plan, picks, places)
        runs.append(time.perf_counter() - started)

    assert isinstance(result, list)
    assert statistics.median(runs) <= 1.0
