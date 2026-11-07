"""GET /days/{day_id}/now 응답 모양 (TASK-006 §A-1, §11 Q8·Q15, §12 R4·R6). 카드는 평평하게(`type` + 값), 시각은 HH:MM."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, PrivateAttr

from planning.schemas import DaySummary, Fact, LatLng


class NowCourseItem(BaseModel):
    """여행 중 화면의 일정 한 개. 기존 CourseItemView(계획 화면)와 별개 (Q8)."""

    seq: int
    place_id: str | None  # 장소 없는 고정 일정이면 null
    name: str  # 장소 이름, 장소가 없는 고정 일정이면 저장된 title
    start: str
    end: str
    lat: float | None
    lng: float | None
    is_fixed: bool
    facts: list[Fact]  # 장소가 없으면 [] (Q6)


class NowFixed(BaseModel):
    """T-07의 고정 일정. name = 장소 이름(없으면 title), title = 저장된 제목 (R4)."""

    name: str
    title: str
    start: str
    end: str
    facts: list[Fact]  # 장소가 없으면 [] (Q21)


class NowCardT01(BaseModel):
    type: Literal["T-01"] = "T-01"
    item: NowCourseItem
    ends_in_min: int | None  # 하루 시작 전 미리보기면 null


class NowCardT02(BaseModel):
    type: Literal["T-02"] = "T-02"
    next_item: NowCourseItem
    leave_at: str
    leave_in_min: int
    travel_min: int
    map_url: str | None  # 장소가 없으면 null (Q6)


class NowCardT03(BaseModel):
    type: Literal["T-03"] = "T-03"
    items: list[NowCourseItem]


class NowDropped(BaseModel):
    place_id: str
    name: str


class NowProposal(BaseModel):
    """늦어짐 대안 한 개 (TASK-007 B-5). items = 제안대로 바뀌는 남은 일정."""

    proposal_id: str
    label: Literal["relaxed", "packed"]
    reason: str
    dropped: list[NowDropped]
    keeps_fixed: bool
    first_leave_at: str
    items: list[NowCourseItem]


class NowPlaceRef(BaseModel):
    place_id: str
    name: str


class NowClosedInfo(BaseModel):
    """닫힘 대안 한 줄 (TASK-008 §12 Q21). 대안의 사실 칩은 제안 items 안 그 장소 줄의 facts."""

    alternative: NowPlaceRef | None  # [빼고 가기]면 null
    distance_m: int | None  # 닫힌 곳에서 직선거리 m, [빼고 가기]면 null
    travel_change_min: int  # 남은 이동 분 합(숙소 복귀 포함), 바뀐 뒤 - 바뀌기 전


class NowT06Proposal(NowProposal):
    """TASK-007 제안 + closed (TASK-008 §11 Q4). label은 relaxed (§12 Q22)."""

    closed: NowClosedInfo


class NowEvent(BaseModel):
    event_id: str
    type: Literal["delay", "closed"] = "delay"
    severity: Literal["low", "high"]
    delay_min: int  # 닫힘 사건은 0
    state: Literal["open_low", "awaiting", "resolved"]
    proposals: list[NowT06Proposal | NowProposal]
    _closed_place_id: str | None = PrivateAttr(default=None)  # 닫힘 사건이 가리키는 장소 (응답에는 나가지 않는다)

    @property
    def closed_place_id(self) -> str | None:
        return self._closed_place_id


class NowT04Fixed(BaseModel):
    title: str
    start: str


class NowCardT04(BaseModel):
    type: Literal["T-04"] = "T-04"
    event_id: str
    delay_min: int
    proposals: list[NowProposal]
    fixed: NowT04Fixed | None


class NowCardT05(BaseModel):
    """영업 확인 (TASK-008 A4): 영업 여부를 추측하지 않고 사실의 상태·출처·확인 날짜만 싣는다."""

    type: Literal["T-05"] = "T-05"
    place: NowPlaceRef
    facts: list[Fact]
    map_url: str


class NowCardT06(BaseModel):
    """닫힘 대안 (TASK-008 B6)."""

    type: Literal["T-06"] = "T-06"
    event_id: str
    closed: NowPlaceRef
    proposals: list[NowT06Proposal]


class NowCardT07(BaseModel):
    type: Literal["T-07"] = "T-07"
    fixed: NowFixed
    leave_by: str
    leave_in_min: int


class NowCardT08(BaseModel):
    type: Literal["T-08"] = "T-08"
    go_home_min: int
    lodging: LatLng
    map_url: str


NowCard = Annotated[
    NowCardT01 | NowCardT02 | NowCardT03 | NowCardT04 | NowCardT05 | NowCardT06 | NowCardT07 | NowCardT08,
    Field(discriminator="type"),
]


class NowPin(BaseModel):
    seq: int
    place_id: str
    name: str
    lat: float
    lng: float
    start: str
    end: str
    travel_min: int  # 앞에서 오는 이동 분 (R6)
    state: Literal["done", "now", "next", "later"]


class NowRoute(BaseModel):
    done: list[tuple[float, float]]
    remaining: list[tuple[float, float]]


class NowView(BaseModel):
    day: DaySummary
    at: str
    status: Literal["on_track", "delayed", "free"]
    status_text: str
    reason: str
    main: NowCard
    subs: list[NowCard]
    chip: None = None  # Q2: 이번엔 항상 null
    pins: list[NowPin]
    route: NowRoute
    position: LatLng | None
    event: NowEvent | None = None  # TASK-007 B-5: 지금 열린 사건 (처리 끝난 사건은 accept·dismiss 응답에만)
