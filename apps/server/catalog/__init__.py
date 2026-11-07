"""카드 카탈로그 (SCREEN-001 §3)."""

from datetime import time
from typing import Literal

from pydantic import BaseModel


class CardSpec(BaseModel):
    id: str  # 예: "T-01"
    name: str
    shows: str  # 이 카드가 보여 주는 것 (Jev 보기 설명용 한 줄)
    has_place: bool  # 장소가 들어가 확인 상태 표시가 필수인 카드
    props: type[BaseModel]


# ---------- props에서 함께 쓰는 값 (API-001 §1·§3, DATA-001 place_facts) ----------


class Fact(BaseModel):
    """장소의 사실 값 하나. 값은 엔진·DB 결과만 넣는다."""

    field: str
    value: str
    status: Literal["confirmed", "unverified", "unknown"]
    source_type: Literal["official", "api", "collected", "user", "estimate"]
    source_url: str | None = None
    checked_at: str | None = None


class Place(BaseModel):
    id: str
    name: str
    facts: list[Fact]


class CourseItem(BaseModel):
    """오늘 코스의 일정 한 개 (카드에 보여 주는 모양)."""

    name: str
    start: time
    end: time
    place: Place | None = None


# ---------- props: T-01·T-02·T-04·T-09만 정의 (TASK-001 §2) ----------


class NowProps(BaseModel):
    item: CourseItem
    ends_in_min: int | None  # 하루 시작 전 미리보기는 null (TASK-006 §11 Q8)


class NextMoveProps(BaseModel):
    next_item: CourseItem
    leave_at: time
    travel_min: int
    map_url: str


class DelayEvent(BaseModel):
    delay_min: int


class DelayProposal(BaseModel):
    label: str
    items: list[CourseItem]


class DelayProps(BaseModel):
    event: DelayEvent
    proposals: list[DelayProposal]


class RestProps(BaseModel):
    places: list[Place]
    walk_min: int


class EmptyProps(BaseModel):
    """TODO: 해당 카드를 만들 때 props를 정의한다."""


_CARDS: list[tuple[str, str, str, bool, type[BaseModel]]] = [
    # 3-1. 계획 대화 카드
    ("P-01", "질문 + 보기 칩", "질문 하나와 고를 수 있는 보기 칩", False, EmptyProps),
    ("P-02", "후보 묶음", "후보 장소 5~6곳과 사실 값, 고른 이유", False, EmptyProps),
    ("P-03", "방향 버튼", "다시 찾을 방향 2~3개와 직접 말하기", False, EmptyProps),
    ("P-04", "담은 곳", "지금까지 담은 장소와 개수", False, EmptyProps),
    ("P-05", "코스 짜기 버튼", "담은 곳으로 코스를 짜는 버튼", False, EmptyProps),
    ("P-06", "코스안", "머무는 시간이 들어간 코스안과 빠진 곳", False, EmptyProps),
    ("P-07", "다트", "동네·도시 단위로 무작위 장소 고르기", False, EmptyProps),
    # 3-2. 여행 중 카드
    ("T-01", "지금 할 일", "지금 있는 일정과 남은 시간", False, NowProps),
    ("T-02", "다음 이동", "다음 장소, 출발 시각, 이동 방법·시간", True, NextMoveProps),
    ("T-03", "남은 일정", "오늘 남은 일정 줄", False, EmptyProps),
    ("T-04", "늦어짐 대안", "늦어진 시간과 대안 2안", False, DelayProps),
    ("T-05", "영업 확인", "가기 전에 열었는지 확인", True, EmptyProps),
    ("T-06", "닫힘 대안", "같은 종류 대안 3곳과 동선 변화", True, EmptyProps),
    ("T-07", "고정 일정 임박", "예약·공연까지 남은 시간, 지금 출발해야 하는지", False, EmptyProps),
    ("T-08", "숙소 가는 법", "숙소까지 이동, 마지막 열차(미확인 표시)", False, EmptyProps),
    ("T-09", "근처 쉴 곳", "지금 열린 카페·벤치 3곳", True, RestProps),
    ("T-10", "근처 먹을 곳", "지금 열린 식당 3곳", True, EmptyProps),
    ("T-11", "여유 시간 제안", "남은 여유 시간과 근처에 갈 만한 1~2곳", True, EmptyProps),
    ("T-12", "날씨 바꾸기", "비 예보와 실내로 바꾼 안", False, EmptyProps),
    ("T-13", "AI 설명", "장소·문화 설명 (AI가 쓴 설명 표시)", False, EmptyProps),
    ("T-14", "되묻기", "\"이 중에 있어?\" 버튼 2~3개", False, EmptyProps),
    ("X-01", "SOS", "긴급 번호, 현재 주소, 숙소 주소", False, EmptyProps),
    ("X-02", "오프라인 띠", "오프라인: 저장된 일정만 보여", False, EmptyProps),
]

_CATALOG = [
    CardSpec(id=id_, name=name, shows=shows, has_place=has_place, props=props)
    for id_, name, shows, has_place, props in _CARDS
]


def get_catalog() -> list[CardSpec]:
    return list(_CATALOG)
