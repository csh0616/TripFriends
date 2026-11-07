"""영업 확인(T-05)·닫힘 대안(T-06) 규칙 (TASK-008 §A·§B). 순수 함수: 같은 입력 -> 같은 출력.

영업 여부를 추측하지 않는다 (CLAUDE.md 규칙 2): 여기는 "언제 물을지", "누가 대안 후보인지", "사용자가 답한 사실"만 다룬다.
기준 값(30분 전, 1.5km, 3곳)은 모듈 상수가 아니라 `_limits()` 안에 둔다 (돌연변이 대상).
"""

import math
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import NamedTuple

from engine.models import Place
from planning.schemas import Fact


class _Limits(NamedTuple):
    earth_km: float  # TASK-002 §8 Q26와 같은 지구 반지름 (하버사인)
    lead_min: int  # A2: 출발 30분 전부터 묻는다
    radius_m: float  # B2: 닫힌 곳에서 1.5km 안 (정각 포함, §11 Q5)
    max_alternatives: int  # B2: 가까운 순 최대 3곳
    round_digits: int  # §12 Q25: 거리 비교는 소수 6자리 반올림 뒤


def _limits() -> _Limits:
    return _Limits(earth_km=6371.0, lead_min=30, radius_m=1500.0, max_alternatives=3, round_digits=6)


# ---------- A. 영업 확인 ----------


def in_check_window(leave_min: int, start_min: int, now_min: int) -> bool:
    """A2: leave - 30 <= now < start (분 단위, 0시 기준)."""
    return leave_min - _limits().lead_min <= now_min < start_min


def needs_check(status: str, checked_today: bool) -> bool:
    """A1·A6: 영업 사실 상태가 미확인·모름이고 그날 확인 기록이 없을 때만."""
    return status in ("unverified", "unknown") and not checked_today


@dataclass(frozen=True)
class VisitCheckRecord:
    """DATA-001 E `visit_checks`: 그날 그 장소를 사용자가 확인한 기록. 원본 장소 데이터는 건드리지 않는다."""

    place_id: str
    day_id: str
    was_open: bool
    checked_at: datetime


def user_confirmed_fact(original: Fact, check: VisitCheckRecord) -> Fact:
    """A5·§11 Q17: 그날은 사용자 확인이 이긴다. 열었어면 원래 영업시간 값 그대로, 닫혔어면 그날 휴무(값 없음).

    상태는 confirmed, 출처는 user, 확인 시각은 사용자가 답한 시각."""
    return Fact(
        field=original.field,
        value=original.value if check.was_open else None,
        status="confirmed",
        source_type="user",
        checked_at=check.checked_at.isoformat(),
    )


def map_search_url(lat: float, lng: float) -> str:
    """A4: 구글 지도 장소 검색 (좌표). 외부 API는 부르지 않는다 (§9)."""
    return f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"


@dataclass(frozen=True)
class ClosedFinding:
    """[닫혔어] 한 건. 그래프는 이 결과만 받는다 (DelayFinding과 같은 자리)."""

    k: int  # 닫힌 장소의 코스 seq
    place_id: str
    dedupe_key: str
    check: VisitCheckRecord


def closed_key(day_id: str, place_id: str) -> str:
    """B1: 사건 중복 방지 키."""
    return f"closed:{day_id}:{place_id}"


# ---------- B. 닫힘 대안 후보 ----------


@dataclass(frozen=True)
class Candidate:
    place_id: str
    distance_m: int  # 닫힌 곳에서 직선거리 m


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _meters(a: Place, b: Place) -> float:
    assert a.lat is not None and a.lng is not None and b.lat is not None and b.lng is not None
    lat1, lng1, lat2, lng2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * _limits().earth_km * 1000 * math.asin(math.sqrt(h))


def _open_at(place: Place, weekday: int, arrive_min: int) -> bool:
    """§11 Q6: 여는 시각 <= 도착 < 닫는 시각. 영업시간을 모르면(None) 영업 중이라 하지 않는다."""
    if place.hours is None:
        return False
    return any(o.weekday == weekday and _minutes(o.open) <= arrive_min < _minutes(o.close) for o in place.hours)


def closed_candidates(closed: Place, places: Mapping[str, Place], exclude: Collection[str], weekday: int, arrive_min: int) -> list[Candidate]:
    """B2: 같은 category, exclude(코스에 있는 곳 + 그날 닫힘 확인 기록) 밖, 도착 시각에 영업 중, 닫힌 곳에서 1.5km 안,
    좌표 있음(§6). 가까운 순 최대 3곳. 영업 사실이 unknown(영업시간 자체가 없음)인 곳은 뺀다."""
    lim = _limits()
    if closed.lat is None or closed.lng is None:
        return []
    found: list[tuple[float, Place]] = []
    for place in places.values():
        if place.id == closed.id or place.id in exclude or place.category != closed.category:
            continue
        if place.lat is None or place.lng is None:
            continue  # §6: 좌표 없음
        if not _open_at(place, weekday, arrive_min):
            continue
        meters = _meters(closed, place)
        if round(meters, lim.round_digits) > lim.radius_m:  # §12 Q25
            continue
        found.append((meters, place))
    found.sort(key=lambda row: (row[0], row[1].id))
    return [Candidate(place.id, round(meters)) for meters, place in found[: lim.max_alternatives]]
