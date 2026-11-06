"""계획 엔진 데이터 모양 (TASK-002 §2, §7). 필드 선언만 둔다."""

import re
from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, field_validator

PlaceId = str
Category = Literal["cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"]
HoursStatus = Literal["confirmed", "unverified", "unknown"]
Direction = Literal["quieter", "closer", "cheaper", "different", "photo", "indoor", "food", "night"]


def _check_hhmm(value: str) -> str:
    """TASK-003 §0·§10 Q29: 형식은 ASCII 숫자 `HH:MM`만, 분은 0~59. 전각·아라비아 숫자, 줄바꿈, 음수는 거부.

    시·분 값의 범위(자정 넘김 최대 "29:59" 등)는 엔진이 따로 검사한다 (TASK-002 §7 Q12).
    """
    if not re.fullmatch(r"[0-9]{2}:[0-9]{2}", value):
        raise ValueError(f"시각 형식이 잘못됨(HH:MM): {value!r}")
    if int(value[3:]) >= 60:
        raise ValueError(f"시각의 분이 60 이상: {value!r}")
    return value


class Opening(BaseModel):
    weekday: int  # 0=월 ~ 6=일
    open: str  # HH:MM
    close: str  # HH:MM, 자정을 넘기면 "26:00"처럼 24 이상 (최대 "29:59", §7 Q12)

    @field_validator("open", "close")
    @classmethod
    def _hhmm(cls, value: str) -> str:
        return _check_hhmm(value)


class StayRange(BaseModel):
    min: int
    typical: int
    max: int


class Place(BaseModel):
    id: PlaceId
    name: str
    category: Category
    lat: float
    lng: float
    crowd_level: int  # 1~5
    price_level: int  # 1~4
    mood_tags: list[str]
    hours: list[Opening] | None  # None = 모름
    hours_status: HoursStatus
    stay: StayRange | None


class Reactions(BaseModel):
    liked: list[PlaceId]
    skipped: list[PlaceId]


class PlanFixed(BaseModel):
    """계획용 고정 일정 (§7 Q14). engine.compose.FixedEvent와 별개."""

    id: str
    title: str
    start: str
    end: str
    place_id: PlaceId | None
    lat: float | None
    lng: float | None

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, value: str) -> str:
        return _check_hhmm(value)


def _max_must_visit() -> int:
    """TASK-005 A3: 하루 꼭 갈 곳 상한. 기준 값은 함수 안에 둔다 (돌연변이 대상)."""
    return 5


class DayPlan(BaseModel):
    date: Date
    start: str
    end: str
    lodging: tuple[float, float]
    fixed: list[PlanFixed]
    must_visit: list[PlaceId]
    stay_overrides: dict[PlaceId, int]

    @field_validator("must_visit")
    @classmethod
    def _limit_must_visit(cls, value: list[PlaceId]) -> list[PlaceId]:
        """TASK-005 A3·§9 Q12: 서로 다른 꼭 갈 곳이 상한을 넘으면 ValueError (중복은 한 번만 센다)."""
        if len(set(value)) > _max_must_visit():
            raise ValueError(f"꼭 갈 곳은 하루 {_max_must_visit()}곳까지: {len(set(value))}곳")
        return value


class CourseItem(BaseModel):
    seq: int
    place_id: PlaceId | None  # 장소 없는 고정 일정이면 None
    start: str
    end: str
    stay_min: int
    stay_source: Literal["auto", "user"] | None  # 장소 없는 고정 일정이면 None (§8 Q28)
    travel_min: int  # 앞에서 오는 시간
    wait_min: int  # 일찍 도착해 기다린 시간 (§7 Q12)
    is_fixed: bool
    hours_status: HoursStatus | None  # 장소 없는 고정 일정이면 None


class Dropped(BaseModel):
    place_id: PlaceId
    reason: Literal["closed_at_time", "no_time", "fixed_conflict"]


class CourseOption(BaseModel):
    label: Literal["relaxed", "packed"]
    items: list[CourseItem]
    dropped: list[Dropped]
    go_home_min: int
    total_travel_min: int


class Infeasible(BaseModel):
    reason: str
    blocking: list[str]  # 장소 id (§7 Q15). fixed_unreachable이면 고정 일정 id (§9 Q45)
    suggest_drop: list[PlaceId]


class Batch(BaseModel):
    place_ids: list[PlaceId]
    direction: Direction | None
    exhausted: bool
    direction_relaxed: bool
