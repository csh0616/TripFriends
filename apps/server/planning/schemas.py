"""/planning 요청·응답 모양 (TASK-003 §5·§6). OpenAPI → packages/api-types로 이어지는 계약."""

import datetime as dt
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, StrictBool, field_validator, model_validator

from engine.models import Category, CourseItem, Direction, Dropped, HoursStatus, PlaceId

Stage = Literal["asking", "browsing", "composing", "done"]
Mode = Literal["conversation", "auto"]
# TASK-003 §10 Q4: 칩 ID
ChipId = Literal["walk_alley", "food_tour", "shopping", "night_view", "cafe", "museum_experience"]


# ---------- 요청 (§5) ----------
# 본문 오류는 모두 400 INVALID_REQUEST (§10 Q23). 모르는 필드는 거부한다 (§10-10 그대로 받아들인 것:
# 오타가 빈 요청으로 읽히면 반응 기록이 바뀐다)


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _not_blank(text: str | None) -> None:
    if text is not None and not text.strip():
        raise ValueError("글이 비어 있음")  # §10 Q23·Q42: 빈 글·공백만


class StartRequest(_Request):
    mode: Mode


class AnswerRequest(_Request):
    """`{choice_ids[], text?}` 또는 `{auto: true}` (§5). 섞거나 `{auto: false}`, 빈 본문은 400.

    §10-10 R7: `choice_ids`를 빼고 글만 보내면 `[]`로 본다 ("직접 말할래"). R8: auto는 JSON `true`만.
    """

    choice_ids: list[ChipId] | None = None
    text: str | None = None
    auto: StrictBool | None = None

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        _not_blank(self.text)
        if self.auto is not None:
            if self.auto is not True or self.choice_ids is not None or self.text is not None:
                # TASK-003 §10-11 (받아들임): `{"auto": true, "text": "…"}`도 400으로 확정
                raise ValueError("auto는 true 하나만 보낸다")  # §10 Q23·Q42
        elif self.choice_ids is None and self.text is None:
            raise ValueError("choice_ids, text, auto 중 하나가 필요함")
        return self


class NextRequest(_Request):
    direction_id: Direction | None = None
    text: str | None = None

    @model_validator(mode="after")
    def _one_of(self) -> Self:
        _not_blank(self.text)
        if self.direction_id is not None and self.text is not None:
            raise ValueError("direction_id와 text는 함께 보내지 않는다")  # §10 Q23
        return self


class ReactionRequest(_Request):
    place_id: PlaceId
    action: Literal["like", "skip", "unlike"]


class AdjustRequest(_Request):
    option_id: str  # §10 Q14: §5 표에 추가
    place_id: PlaceId
    delta: Literal[15, -15]

    @field_validator("delta", mode="before")
    @classmethod
    def _integer_only(cls, value: object) -> object:
        # §10-10 R8: delta는 정수만. pydantic의 Literal은 15.0도 15로 받아들이므로 값 검사 전에 종류를 본다
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("delta는 정수 15 또는 -15")
        return value


# ---------- 응답 (§6) ----------


class Choice(BaseModel):
    id: str
    label: str


class Question(BaseModel):
    text: str
    choices: list[Choice]
    allow_text: bool
    allow_auto: bool


class LatLng(BaseModel):
    lat: float
    lng: float


class DayMustVisit(BaseModel):
    place_id: PlaceId
    name: str
    stay_min: int  # TASK-006 Q19·R5: 바꾼 머문 시간 > typical > 60


class DayFixed(BaseModel):
    place_id: PlaceId | None  # 장소 없는 고정 일정이면 None
    name: str  # TASK-004 §12-1 Q1: 장소 이름, 장소가 없으면 저장된 title
    start: str
    end: str


class DaySummary(BaseModel):
    """TASK-004 A2: 저장소의 하루 데이터 요약 (PlanningSession·CandidateBatch·CourseResult에 붙는다)."""

    day_id: str
    day_number: int
    date: dt.date
    start: str
    end: str
    lodging: LatLng
    must_visits: list[DayMustVisit]
    fixed: list[DayFixed]


class PlanningSession(BaseModel):
    session_id: str
    stage: Stage
    question: Question
    day: DaySummary


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
    day: DaySummary
    picks: list[PlaceId]  # TASK-004 §12-1 A6(Q7): 담은 순서


class Picks(BaseModel):
    picks: list[PlaceId]
    picks_count: int


class CourseItemView(CourseItem):
    """TASK-004 A3: 앱이 장소 이름을 다시 찾지 않게 `name`을 더한 응답용 CourseItem. 엔진의 CourseItem은 그대로 둔다.
    name = 장소 이름, 장소가 없는 고정 일정이면 저장된 title (§12-1 Q1)."""

    name: str
    lat: float | None  # TASK-004 A8: 장소 좌표(표시용). 장소 없는 고정 일정이면 null (키는 있음)
    lng: float | None


class DroppedView(Dropped):
    """TASK-004 A3: 엔진의 Dropped에 `name`을 더한 응답용."""

    name: str


class CourseResultOption(BaseModel):
    option_id: str
    label: Literal["relaxed", "packed"]
    items: list[CourseItemView]
    dropped: list[DroppedView]
    go_home_min: int
    total_travel_min: int


class CourseResult(BaseModel):
    session_id: str
    stage: Stage
    options: list[CourseResultOption]
    day: DaySummary


class SelectResult(BaseModel):
    day_id: str
    option_id: str


class PlanningDone(BaseModel):
    """TASK-004 A1: done 단계의 GET 응답. select 응답(SelectResult)에 stage를 더한 모양."""

    day_id: str
    option_id: str
    stage: Literal["done"]


class SeedRequest(_Request):
    """TASK-006 A5·Q14: JSON 본문. 본문이 없으면 예전 시드 그대로."""

    chosen: bool = False


class SeedResult(BaseModel):
    trip_id: str
    day_ids: list[str]


class SeedChosenResult(SeedResult):
    """`{"chosen": true}` 응답 (TASK-006 A5·Q1). 일반 시드 응답에는 day 키가 없다 (null도 아님)."""

    day: "DaySummary"


class ErrorBody(BaseModel):
    """공통 오류 (§5). code는 NOT_FOUND·INVALID_REQUEST·STATE_CONFLICT·COURSE_INFEASIBLE·INTERNAL_ERROR 5개뿐 (§10 Q24, §10-10 R3)."""

    code: Literal["NOT_FOUND", "INVALID_REQUEST", "STATE_CONFLICT", "COURSE_INFEASIBLE", "INTERNAL_ERROR"]  # §10 Q24, §10-10 R3
    message: str
    detail: Any = None


class ErrorResponse(BaseModel):
    error: ErrorBody
