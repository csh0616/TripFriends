"""TASK-002 테스트 공용 도우미. 판단 로직 없이 입력을 만들고 결과를 읽기만 한다."""

import math
from datetime import date, datetime, time

from engine.models import DayPlan, Opening, Place, PlanFixed, StayRange

BASE = (35.0, 135.0)
EARTH_KM = 6371.0  # §8 Q26
KM_PER_DEGREE = math.radians(1.0) * EARTH_KM
MONDAY = date(2026, 11, 9)
MONDAY_EVENING = datetime(2026, 11, 9, 18, 0)


def to_min(value: str | time) -> int:
    if isinstance(value, time):
        return value.hour * 60 + value.minute
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def north_of(km: float, east_km: float = 0.0, base: tuple[float, float] = BASE) -> tuple[float, float]:
    """기준점에서 북쪽으로 km, 동쪽으로 east_km 떨어진 좌표."""
    lat = base[0] + km / KM_PER_DEGREE
    lng = base[1] + east_km / (KM_PER_DEGREE * math.cos(math.radians(base[0])))
    return (lat, lng)


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def expected_travel(km: float) -> int:
    """TASK-002 §3 F 이동 시간 식."""
    return math.ceil(km / 4.5 * 60) if km <= 1.2 else 10 + math.ceil(km / 20 * 60)


def travel_candidates(km: float) -> set[int]:
    """식의 올림·1.2km 경계에 정확히 걸린 거리만 부동소수점 오차로 두 값을 허용한다. 그 외에는 한 값."""
    return {expected_travel(max(0.0, km - 1e-9)), expected_travel(km + 1e-9)} if km > 0 else {0}


def opening(open_at: str, close_at: str, weekday: int = 0) -> list[Opening]:
    return [Opening(weekday=weekday, open=open_at, close=close_at)]


def place(
    pid: str,
    category: str = "cafe",
    km: float = 0.0,
    crowd: int = 3,
    price: int = 3,
    tags: tuple[str, ...] = (),
    hours: list[Opening] | None = None,
    status: str | None = None,
    stay: StayRange | None = None,
    east_km: float = 0.0,
) -> Place:
    lat, lng = north_of(km, east_km)
    return Place(
        id=pid,
        name=f"가상 {pid}",
        category=category,
        lat=lat,
        lng=lng,
        crowd_level=crowd,
        price_level=price,
        mood_tags=list(tags),
        hours=hours,
        hours_status=status or ("unknown" if hours is None else "confirmed"),
        stay=stay,
    )


def as_places(*items: Place) -> dict[str, Place]:
    """places 모양은 dict[id, Place] (§8 Q21)."""
    return {p.id: p for p in items}


def day_plan(
    start: str = "09:00",
    end: str = "21:00",
    fixed: tuple[PlanFixed, ...] = (),
    must: tuple[str, ...] = (),
    overrides: dict[str, int] | None = None,
    day: date = MONDAY,
) -> DayPlan:
    return DayPlan(
        date=day,
        start=start,
        end=end,
        lodging=BASE,
        fixed=list(fixed),
        must_visit=list(must),
        stay_overrides=overrides or {},
    )


def fixed_event(start: str, end: str, at_place: Place | None = None, fid: str = "F1") -> PlanFixed:
    return PlanFixed(
        id=fid,
        title="고정 일정",
        start=start,
        end=end,
        place_id=at_place.id if at_place else None,
        lat=at_place.lat if at_place else None,
        lng=at_place.lng if at_place else None,
    )
