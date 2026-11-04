"""TASK-002 테스트 공용 도우미. 판단 로직 없이 입력을 만들고 결과를 읽기만 한다."""

import math
from datetime import date, datetime, time

from engine.models import DayPlan, Opening, Place, PlanFixed, StayRange

BASE = (35.0, 135.0)
KM_PER_DEGREE = 111.195  # 지구 반지름 약 6371km. 거리 공식은 문서에 없음 (질문 Q26)
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
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def expected_travel(km: float) -> int:
    """TASK-002 §3 F 이동 시간 식."""
    return math.ceil(km / 4.5 * 60) if km <= 1.2 else 10 + math.ceil(km / 20 * 60)


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
    """next_batch·compose_courses의 places 모양. dict[id, Place]로 가정 (질문 Q21)."""
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


def fixed_event(start: str, end: str, at_place: Place | None = None) -> PlanFixed:
    return PlanFixed(
        id="F1",
        title="고정 일정",
        start=start,
        end=end,
        place_id=at_place.id if at_place else None,
        lat=at_place.lat if at_place else None,
        lng=at_place.lng if at_place else None,
    )
