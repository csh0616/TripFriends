"""순서를 그대로 둔 채 시각만 다시 계산 (TASK-008 §14~§16). 순수 함수: 같은 입력 -> 같은 출력.

닫힌 곳 자리에 대안을 넣거나(§14), 닫힌 곳을 빼고 뒤를 당길 때(§15) 쓴다. DP로 다시 짜지 않는다 (그건 `compose_courses`).
규칙은 엔진의 시각 식과 같다 (이동 분 `travel_min`, 방문 뒤 방문에만 쉬는 시간, 영업 구간 안에서 가장 이른 시작).
지금 장소에서 나가는 첫 이동에는 쉬는 시간이 없다 (§16 Q35). 쉬는 시간 길이는 고른 코스의 방식 (§16 Q37).
"""

from dataclasses import dataclass
from typing import NamedTuple

from engine.models import CourseItem, Place
from engine.planning import distance_km, travel_min


class _Rules(NamedTuple):
    relaxed_buffer_min: int  # 엔진 `relaxed_buffer_min`과 같은 값
    packed_buffer_min: int
    open_all_day: int  # 영업시간 모름이면 하루 전체 (엔진 `intervals`와 같음)


def _rules() -> _Rules:
    return _Rules(relaxed_buffer_min=15, packed_buffer_min=5, open_all_day=10**6)


def buffer_min(label: str) -> int:
    """§16 Q37: 원래 고른 코스의 방식 (relaxed/packed)."""
    rules = _rules()
    return rules.relaxed_buffer_min if label == "relaxed" else rules.packed_buffer_min


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _hours_status(place: Place) -> str:
    """엔진 TASK-002 §7 Q13과 같은 규칙."""
    if place.hours is None:
        return "unknown"
    return "unverified" if place.hours_status == "unknown" else place.hours_status


def _intervals(place: Place, weekday: int) -> list[tuple[int, int]]:
    if place.hours is None:
        return [(0, _rules().open_all_day)]
    return sorted((_minutes(o.open), _minutes(o.close)) for o in place.hours if o.weekday == weekday)


def _earliest(place: Place, weekday: int, ready: int, stay: int) -> int | None:
    """영업 구간 안에서 ready 이후 가장 이른 시작 (여는 시각 전이면 여는 시각). 구간에 stay분이 안 들어가면 None."""
    best = None
    for low, high in _intervals(place, weekday):
        start = max(ready, low)
        if start + stay <= high and (best is None or start < best):
            best = start
    return best


@dataclass(frozen=True)
class Slot:
    """다시 시각을 잴 일정 한 줄. 순서·머무는 시간은 그대로 받는다."""

    place_id: str | None
    stay_min: int
    stay_source: str | None
    is_fixed: bool
    start: str  # 고정 일정일 때만 쓴다 (시각 그대로)
    end: str
    coord: tuple[float, float] | None  # 고정 일정의 좌표 (장소 없으면 None = 이동 0분, 그 자리 그대로)


def slot_of(item: CourseItem, coord: tuple[float, float] | None) -> Slot:
    return Slot(item.place_id, item.stay_min, item.stay_source, item.is_fixed, item.start, item.end, coord)


def retime(
    slots: list[Slot],
    places: dict[str, Place],
    weekday: int,
    origin: tuple[float, float],
    ready: int,
    buffer: int,
    day_end: int,
    lodging: tuple[float, float],
    first_seq: int,
) -> tuple[list[CourseItem], int] | None:
    """origin에서 ready에 떠나 slots를 순서대로. 영업시간·고정 일정·하루 끝 중 하나라도 못 지키면 None.

    반환: (항목들, 마지막 장소에서 숙소 복귀 분)."""
    t, here, after_visit = ready, origin, False  # 첫 이동에는 쉬는 시간 없음 (Q35), 고정 일정 뒤에도 없음
    items: list[CourseItem] = []
    for number, slot in enumerate(slots, start=first_seq):
        if slot.is_fixed:
            tt = travel_min(distance_km(here, slot.coord)) if slot.coord else 0
            if t + tt > _minutes(slot.start):
                return None
            items.append(
                CourseItem(
                    seq=number, place_id=slot.place_id, start=slot.start, end=slot.end, stay_min=_minutes(slot.end) - _minutes(slot.start),
                    stay_source=None, travel_min=tt, wait_min=0, is_fixed=True,
                    hours_status=_hours_status(places[slot.place_id]) if slot.place_id else None,  # type: ignore[arg-type]
                )
            )
            t, after_visit = _minutes(slot.end), False
            here = slot.coord or here
            continue
        assert slot.place_id is not None
        place = places[slot.place_id]
        tt = travel_min(distance_km(here, (place.lat, place.lng)))
        arrive = t + tt + (buffer if after_visit else 0)
        start = _earliest(place, weekday, arrive, slot.stay_min)
        if start is None:
            return None
        items.append(
            CourseItem(
                seq=number, place_id=place.id, start=_hhmm(start), end=_hhmm(start + slot.stay_min), stay_min=slot.stay_min,
                stay_source=slot.stay_source,  # type: ignore[arg-type]
                travel_min=tt, wait_min=start - arrive, is_fixed=False, hours_status=_hours_status(place),  # type: ignore[arg-type]
            )
        )
        t, here, after_visit = start + slot.stay_min, (place.lat, place.lng), True
    home = travel_min(distance_km(here, lodging))
    if t + home > day_end:
        return None
    return items, home
