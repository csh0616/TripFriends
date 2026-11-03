"""화면 조합 함수 (GRAPH-001 §6, SCREEN-001 §4~§5). 순수 함수, TDD 대상."""

from datetime import time
from typing import Literal

from pydantic import BaseModel, Field


class PlanItem(BaseModel):
    """오늘 코스의 일정 한 개."""

    name: str
    start: time
    end: time
    travel_min: int = 0  # 이 일정으로 가는 이동 시간. 출발 시각 = start - travel_min
    is_meal: bool = False
    is_outdoor: bool = False
    hours_checked: bool = False  # 영업 확인을 했는지 (SCREEN-001 §4-1 순위 6, §5 T-02 짝)


class FixedEvent(BaseModel):
    """예약·공연 같은 고정 일정."""

    name: str
    leave_by: time  # 늦지 않으려면 출발해야 하는 시각


class OpenEvent(BaseModel):
    """열린 사건. delay = 미응답 대안이 있는 늦어짐, closed = 닫힘 확인됨."""

    kind: Literal["delay", "closed"]


class Snapshot(BaseModel):
    """compose_screen 입력: 지금 상황 (TASK-001 §2 engine/compose.py)."""

    now: time
    offline: bool = False
    safety: bool = False  # 안전 말 또는 SOS 누름
    current_item: PlanItem | None = None
    next_item: PlanItem | None = None
    fixed_event: FixedEvent | None = None
    open_events: list[OpenEvent] = Field(default_factory=list)
    walked_km: float = 0.0
    meal_eaten: bool = False  # 이번 끼니 먹음
    rain_prob_2h: float = 0.0  # 0~1
    outdoor_remaining: bool = False
    remaining_items: int = 0
    chat_pick: str | None = None  # 대화(G3)가 고른 메인 카드 ID
    moving: bool = False  # 다음 장소로 이동 중
    arriving: bool = False  # 다음 장소 도착 직전


class SuggestionChip(BaseModel):
    card: str  # 누르면 메인으로 올라갈 카드 ID
    label: str


class Screen(BaseModel):
    """compose_screen 출력."""

    main: str
    subs: list[str] = Field(default_factory=list)  # 최대 3장
    chip: SuggestionChip | None = None  # 0~1개
    move_status: Literal["on_track", "delayed", "free"]
    reason: str  # 바뀐 이유 한 줄 (대본 틀)


def compose_screen(snapshot: Snapshot) -> Screen:
    raise NotImplementedError
