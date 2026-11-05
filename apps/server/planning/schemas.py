"""/planning 응답 모양 (TASK-003 §6). 필드 선언만 둔다."""

from typing import Literal

from pydantic import BaseModel

from engine.models import Category, CourseItem, Direction, Dropped, HoursStatus, PlaceId

Stage = Literal["asking", "browsing", "composing", "done"]


class Choice(BaseModel):
    id: str
    label: str


class Question(BaseModel):
    text: str
    choices: list[Choice]
    allow_text: bool
    allow_auto: bool


class PlanningSession(BaseModel):
    session_id: str
    stage: Stage
    question: Question


class Fact(BaseModel):
    field: str
    value: str | None
    status: HoursStatus
    source_type: str
    checked_at: str | None


class Place(BaseModel):
    """앱에 보내는 모양. engine.models.Place와 별개."""

    id: PlaceId
    name: str
    category: Category
    lat: float
    lng: float
    crowd_level: int
    price_level: int
    mood_tags: list[str]
    facts: list[Fact]


class Candidate(BaseModel):
    place: Place
    why: str


class DirectionChoice(BaseModel):
    id: Direction
    label: str


class CandidateBatch(BaseModel):
    session_id: str
    stage: Stage
    round: int
    message: str
    candidates: list[Candidate]
    directions: list[DirectionChoice]
    clarify: list[DirectionChoice] | None
    picks_count: int
    exhausted: bool
    direction_relaxed: bool


class Picks(BaseModel):
    picks: list[PlaceId]
    picks_count: int


class CourseResultOption(BaseModel):
    option_id: str
    label: Literal["relaxed", "packed"]
    items: list[CourseItem]
    dropped: list[Dropped]
    go_home_min: int
    total_travel_min: int


class CourseResult(BaseModel):
    session_id: str
    stage: Stage
    options: list[CourseResultOption]


class SelectResult(BaseModel):
    day_id: str
    option_id: str


class SeedResult(BaseModel):
    trip_id: str
    day_ids: list[str]
