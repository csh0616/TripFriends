"""늦어짐 감지 규칙 (TASK-007 §A, §11 Q1·Q2). 순수 함수: 같은 (코스, 시각, 위치) -> 같은 결과.

위치는 이 함수 안에서만 쓰고 어디에도 남기지 않는다 (AC-9). LLM·판단기·HTTP를 부르지 않는다 (AC-10).
기준 값은 모듈 상수가 아니라 `_limits()` 안에 둔다 (돌연변이 대상).
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, NamedTuple


class _Limits(NamedTuple):
    earth_km: float  # TASK-002 §8 Q26와 같은 지구 반지름 (하버사인)
    near_m: float  # A1: 150m 안 (150m 포함, §11 Q1)
    min_delay_min: int  # A3: 10분 미만은 늦은 게 아님
    high_delay_min: int  # A4: 20분 이상은 높음
    stale_min: int  # B-4: 제안을 만든 뒤 마지막 check까지 15분 이상이면 오래됨
    stale_growth_min: int  # B-4: 같은 사건의 delay_min이 10분 이상 늘면 오래됨


def _limits() -> _Limits:
    return _Limits(earth_km=6371.0, near_m=150.0, min_delay_min=10, high_delay_min=20, stale_min=15, stale_growth_min=10)


@dataclass(frozen=True)
class DelayStop:
    """코스 항목 하나. 장소 없는 고정 일정은 lat·lng가 None, travel_min = 앞에서 오는 이동 분."""

    seq: int
    lat: float | None
    lng: float | None
    start: str
    end: str
    travel_min: int
    is_fixed: bool


@dataclass(frozen=True)
class DelayCourse:
    day_id: str
    stops: list[DelayStop]


@dataclass(frozen=True)
class DelayFinding:
    k: int  # at_place의 seq
    delay_min: int
    severity: Literal["low", "high"]
    dedupe_key: str


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * _limits().earth_km * 1000 * math.asin(math.sqrt(h))


def _within(meters: float) -> bool:
    # 150m 정각은 부동소수점 때문에 150.0000000001 또는 149.99999999처럼 나온다. 소수 6자리(미크로미터)까지 반올림해 "150m 포함"을 지킨다
    return round(meters, 6) <= _limits().near_m


def _at_place(course: DelayCourse, position: tuple[float, float]) -> int | None:
    """A1: 150m 안의 코스 장소 중 가장 가까운 곳의 stops 안 순번. 같은 거리면 앞 순번."""
    best: tuple[float, int] | None = None
    for index, stop in enumerate(course.stops):
        if stop.lat is None or stop.lng is None:
            continue  # 장소 없는 고정 일정은 위치 비교에서 뺀다
        meters = _distance_m(position, (stop.lat, stop.lng))
        if _within(meters) and (best is None or meters < best[0]):
            best = (meters, index)
    return best[1] if best else None


def _misses_fixed(stops: list[DelayStop], shift: int, left_at: int) -> bool:
    """A4·§11 Q2: 남은 일정을 차례로 민다. 다음 시작 = max(원래 시작, 앞 끝 + 이동).

    사이의 빈 시간이 먼저 흡수하고, 흡수하지 못한 만큼만 다음으로 넘어간다. 고정 일정은 시작을 못 미루니 밀리면 늦은 것.
    left_at = 예정 출발 + 늦은 분 (지금 막 출발하는 시각)
    """
    ready = left_at  # 앞 일정이 끝나 이동을 시작하는 시각
    for stop in stops:
        start, end = _minutes(stop.start), _minutes(stop.end)
        new_start = max(start, ready + stop.travel_min)
        if stop.is_fixed:
            if new_start > start:
                return True
            ready = end  # 고정 일정은 제 시각에 끝난다
        else:
            ready = end + (new_start - start)  # 머무는 시간은 그대로, 밀린 만큼 끝도 밀린다
    return False


def detect_delay(course: DelayCourse, at: datetime, position: tuple[float, float] | None) -> DelayFinding | None:
    """A1~A5. 위치가 없거나, 150m 안에 코스 장소가 없거나(이동 중), 마지막 장소이거나, 10분 미만이면 None."""
    if position is None:
        return None
    index = _at_place(course, position)
    if index is None or index + 1 >= len(course.stops):
        return None  # 지킬 다음 일정이 없으면 늦어짐도 없다 (A2)
    here, following = course.stops[index], course.stops[index + 1]
    leave = _minutes(following.start) - following.travel_min  # 예정 출발 시각
    now_seconds = at.hour * 3600 + at.minute * 60 + at.second
    late_seconds = now_seconds - leave * 60
    if late_seconds <= 0:
        return None
    delay = late_seconds // 60  # 분, 내림
    lim = _limits()
    if delay < lim.min_delay_min:
        return None
    high = delay >= lim.high_delay_min or _misses_fixed(course.stops[index + 1 :], delay, leave + delay)
    return DelayFinding(here.seq, delay, "high" if high else "low", f"delay:{course.day_id}:{here.seq}")


def is_stale(created_at: datetime, base_delay_min: int, delay_min: int, last_check_at: datetime | None) -> bool:
    """B-4·§11 Q7: 제안을 만든 뒤 마지막 check의 at이 15분 이상 지났거나, 같은 사건의 delay_min이 10분 이상 늘었으면 오래됨."""
    lim = _limits()
    if delay_min - base_delay_min >= lim.stale_growth_min:
        return True
    return last_check_at is not None and last_check_at - created_at >= timedelta(minutes=lim.stale_min)
