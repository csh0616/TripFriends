"""늦어짐 대안 재료 만들기 (TASK-007 §B-2). 순수 함수: 엔진(`compose_courses`)을 부르는 건 그래프 쪽이고, 여기는 넣을 값과 결과 모양만 다룬다.

위치는 쓰지 않는다. 출발 장소는 코스의 k번 장소 좌표다.
"""

from dataclasses import dataclass
from datetime import datetime

from engine.models import CourseOption, DayPlan, Dropped, Infeasible, PlanFixed, PlaceId
from engine.planning import distance_km, travel_min  # 코스 계산과 같은 이동 분 식
from planning.repo import DayRecord
from trip.detect import DelayCourse, DelayStop


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def delay_course(day_id: str, day: DayRecord, course: CourseOption) -> DelayCourse:
    stops = []
    for item in course.items:
        place = day.places[item.place_id] if item.place_id else None
        stops.append(
            DelayStop(item.seq, place.lat if place else None, place.lng if place else None, item.start, item.end, item.travel_min, item.is_fixed)
        )
    return DelayCourse(day_id, stops)


@dataclass(frozen=True)
class AlternativeInput:
    plan: DayPlan  # 남은 일정만의 하루 (시작 = 지금, 숙소 = 진짜 숙소)
    start: tuple[float, float]  # 출발 장소 = k번 장소 좌표
    picks: list[PlaceId]
    index: int  # 코스 안에서 k번 항목의 자리
    fixed_title: str | None  # 다음 고정 일정 제목
    fixed_slots: list[tuple[PlaceId | None, str, str]]  # 지켜야 할 고정 일정 (장소, 시작, 끝)


def alternative_input(day: DayRecord, course: CourseOption, k: int, at: datetime) -> AlternativeInput | Infeasible:
    """B-2 입력: k+1번부터의 항목, 고정 일정·꼭 갈 곳은 지키고, 하루 끝·숙소는 그대로.

    지금(at)이 하루 끝이거나, 남은 고정 일정이 이미 시작했으면 어떻게 해도 못 지키니 Infeasible.
    """
    index = next(i for i, item in enumerate(course.items) if item.seq == k)
    rest = course.items[index + 1 :]
    now_min = at.hour * 60 + at.minute
    plan = day.plan
    fixed: list[PlanFixed] = []
    free = list(plan.fixed)
    for item in rest:
        if not item.is_fixed:
            continue
        match = next((f for f in free if f.place_id == item.place_id and f.start == item.start and f.end == item.end), None)
        if match is None:
            continue
        free.remove(match)
        fixed.append(match)
    for event in fixed:
        if _minutes(event.start) < now_min:
            return Infeasible(reason="fixed_unreachable", blocking=[event.id], suggest_drop=[])
    if now_min >= _minutes(plan.end):
        return Infeasible(reason="fixed_unreachable", blocking=[], suggest_drop=[])
    here = day.places[course.items[index].place_id]  # type: ignore[index]
    rest_places = {item.place_id for item in rest if item.place_id}
    picks = list(dict.fromkeys(item.place_id for item in rest if item.place_id and not item.is_fixed))
    stays = {item.place_id: item.stay_min for item in rest if item.place_id and item.stay_source == "user"}
    new_plan = DayPlan(
        date=plan.date,
        start=_hhmm(now_min),
        end=plan.end,
        lodging=plan.lodging,  # 하루 끝 복귀는 진짜 숙소. 출발 장소(k번)는 compose_courses의 start로
        fixed=fixed,
        must_visit=[pid for pid in plan.must_visit if pid in rest_places],
        stay_overrides=stays,
    )
    return AlternativeInput(new_plan, (here.lat, here.lng), picks, index, fixed[0].title if fixed else None, [(f.place_id, f.start, f.end) for f in fixed])


def go_home_only(spec: AlternativeInput, result: Infeasible) -> CourseOption | None:
    """넣을 장소 0곳 (§12 정한 것): 고정 일정·꼭 갈 곳이 없는데 k번에서 진짜 숙소까지도 하루 끝을 넘으면
    엔진은 fixed_unreachable(blocking 없음)을 준다. 이때는 남은 장소를 모두 빼고 숙소로 가는 빈 코스 하나로 답한다.
    그 밖의 Infeasible은 None (제안 없음)."""
    if result.reason != "fixed_unreachable" or result.blocking or spec.plan.fixed or spec.plan.must_visit:
        return None
    home = travel_min(distance_km(spec.start, spec.plan.lodging))
    return CourseOption(
        label="relaxed",
        items=[],
        dropped=[Dropped(place_id=pid, reason="no_time") for pid in spec.picks],
        go_home_min=home,
        total_travel_min=home,
    )


@dataclass(frozen=True)
class Shaped:
    course: CourseOption  # 반영하면 되는 전체 코스
    from_index: int
    dropped: tuple[PlaceId, ...]
    keeps_fixed: bool
    first_leave_at: str


def shape(day: DayRecord, course: CourseOption, option: CourseOption, spec: AlternativeInput, at: datetime) -> Shaped:
    """엔진이 준 남은 일정(option)을 지난 항목 뒤에 붙인 전체 코스로. seq는 이어 붙이고, 숙소 복귀는 진짜 숙소로 다시 잰다."""
    prefix = course.items[: spec.index + 1]
    items = [item.model_copy(update={"seq": len(prefix) + number}) for number, item in enumerate(option.items, start=1)]
    last = next((i for i in reversed([*prefix, *items]) if i.place_id), None)
    spot = day.places[last.place_id] if last and last.place_id else None
    go_home = travel_min(distance_km((spot.lat, spot.lng), day.plan.lodging)) if spot else course.go_home_min
    dropped_ids = [d.place_id for d in option.dropped]
    known = {d.place_id for d in course.dropped}
    full = CourseOption(
        label=option.label,
        items=[*prefix, *items],
        dropped=[*course.dropped, *(d for d in option.dropped if d.place_id not in known)],
        go_home_min=go_home,
        total_travel_min=sum(i.travel_min for i in [*prefix, *items]) + go_home,
    )
    kept = {(i.place_id, i.start, i.end) for i in items if i.is_fixed}
    first_leave = _hhmm(_minutes(items[0].start) - items[0].travel_min) if items else _hhmm(at.hour * 60 + at.minute)
    return Shaped(full, spec.index + 1, tuple(dropped_ids), all(slot in kept for slot in spec.fixed_slots), first_leave)


def reason_text(names: list[str], fixed_title: str | None) -> str:
    """B-2 대본. 이름과 고정 일정 제목 말고는 아무것도 끼워 넣지 않는다 (LLM 없음)."""
    if not names:
        return "머무는 시간 줄여서 다 가기"
    tail = f"{fixed_title}에 여유 있게" if fixed_title else "남은 일정 여유 있게"
    return f"{', '.join(names)} 빼고 {tail}"

