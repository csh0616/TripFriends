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
    expected_travel,
    fixed_event,
    hhmm,
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
    # 넣을 곳이 0곳이어도 빈 코스 1안 이상을 돌려준다고 임시 가정 (질문 Q37)
    assert 1 <= len(result) <= 2
    assert len({o.label for o in result}) == len(result)
    return result


def option_for(result, label: str) -> CourseOption:
    """그 이름의 안. 두 안이 같아 하나만 왔으면 그 하나 (§7 Q11)."""
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
    """NFR-04와 §3 F·§7의 불변식. 이동 시간은 거리 공식이 문서에 없어 ±1분 허용 (질문 Q26)."""
    weekday = plan.date.weekday()
    buffer_min = BUFFER[option.label]
    user_stays = {pid: min(300, max(15, v)) for pid, v in plan.stay_overrides.items()}

    position = plan.lodging
    previous = None
    for index, item in enumerate(option.items):
        start, end = to_min(item.start), to_min(item.end)
        assert start < end
        assert item.wait_min >= 0

        if previous is not None:
            assert item.seq == previous.seq + 1
        if item.is_fixed:
            event = next(f for f in plan.fixed if (f.start, f.end) == (item.start, item.end))
            target = (event.lat, event.lng) if event.place_id else position
            assert item.place_id == event.place_id
        else:
            p = places[item.place_id]
            target = (p.lat, p.lng)

        travel = expected_travel(distance_km(position, target)) if target != position else 0
        assert abs(item.travel_min - travel) <= 1
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
    home = expected_travel(distance_km(position, plan.lodging)) if position != plan.lodging else 0
    assert abs(option.go_home_min - home) <= 1
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
    for d in option.dropped:
        if places[d.place_id].hours is None:
            assert d.reason != "closed_at_time"

    # 이동 합: 집 가는 시간을 넣는지는 문서에 없다 (질문 Q35)
    legs = sum(i.travel_min for i in option.items)
    assert legs <= option.total_travel_min <= legs + option.go_home_min


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
    assert len(options(compose_courses(plan, ["D01"], places))) == 1


# ---------- §3 F 이동 시간 (1.2km 기준 양쪽) ----------


@pytest.mark.parametrize(
    "km, minutes",
    [(0.0, 0), (0.25, 4), (0.88, 12), (1.19, 16), (1.21, 14), (2.1, 17), (2.9, 19)],
    ids=["같은자리", "도보_0점25", "도보_0점88", "도보_기준직전", "대중교통_기준직후", "대중교통_2점1", "대중교통_2점9"],
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


@pytest.mark.skip(reason="질문 대기 Q31: '고르게'의 정의와 분 단위 반올림")
def test_질문대기_남는_시간은_같은_범위의_두_곳에_같게_나눔():
    places = as_places(place("D01"), place("D02"))
    plan = day_plan(start="09:00", end="10:55")
    option = option_for(compose_courses(plan, ["D01", "D02"], places), "relaxed")
    assert [i.stay_min for i in option.items] == [50, 50]


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


@pytest.mark.skip(reason="질문 대기 Q34: closed_at_time의 '하루 범위'에 이동 시간이 들어가는지")
def test_질문대기_이동_때문에만_못_들어가면_no_time():
    # 영업 구간 자체는 하루 안이고 이동 16분 때문에 최소 30분이 안 들어간다
    places = as_places(place("D01"), place("D02", km=1.19, hours=opening("10:00", "10:30")))
    plan = day_plan(start="10:00", end="21:00")
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") == "no_time"


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


def test_고정일정과_시간이_겹쳐서만_못_들어가면_closed가_아님():
    # 이유가 fixed_conflict인지 no_time인지는 Q12와 §2가 달라 둘 다 허용 (질문 Q29)
    places = as_places(place("D01"), place("D02", hours=opening("15:00", "16:00")))
    plan = day_plan(fixed=(fixed_event("15:00", "16:00"),))
    for option in options(compose_courses(plan, ["D01", "D02"], places)):
        assert dropped_reason(option, "D02") in ("fixed_conflict", "no_time")


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


@pytest.mark.skip(reason="질문 대기 Q33: 시간 부족 Infeasible의 reason 값과 suggest_drop에 꼭 갈 곳이 들어가는지")
def test_질문대기_꼭갈곳끼리_시간이_모자라면_빼면_되는_곳을_제안():
    places = as_places(place("D01", "landmark"), place("D02", "landmark"))
    plan = day_plan(start="09:00", end="10:30", must=("D01", "D02"))
    result = compose_courses(plan, ["D01", "D02"], places)
    assert result.suggest_drop
    assert set(result.suggest_drop) <= {"D01", "D02"}


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


@pytest.mark.skip(reason="질문 대기 Q32: 사용자가 바꾼 담은 곳을 '가장 많이 넣기'보다 먼저 지키는지")
def test_질문대기_바꾼_카페를_빼면_더_많이_들어가도_다른_곳을_뺀다():
    # D01을 빼면 세 곳이 들어가지만 AC-12 문구는 "다른 곳이 dropped"
    places = as_places(*[place(f"D{i:02d}") for i in range(1, 5)])
    plan = day_plan(start="09:00", end="11:50", overrides={"D01": 120})
    for option in options(compose_courses(plan, ["D01", "D02", "D03", "D04"], places)):
        assert "D01" in visits(option)


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
        assert sorted(result.suggest_drop) == ["D02", "D03"]


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

    # 고정 일정은 숙소에서 갈 수 있고 집에 돌아올 수 있는 시각으로만 만든다 (질문 Q30)
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


@pytest.mark.skip(reason="질문 대기 Q36: 꼭 갈 곳이 있으면 DP가 탐욕법보다 적게 넣을 수 있음")
@settings(max_examples=200, deadline=None)
@given(scenarios(allow_overrides=False))
def test_질문대기_AC14_꼭갈곳이_있어도_DP가_탐욕법_이상(scenario):
    plan, picks, places = scenario
    result = compose_courses(plan, picks, places)
    if isinstance(result, Infeasible):
        return
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
