"""G1 그래프 상태와 날 도우미 (TASK-003 §3). 그래프와 응답 만들기가 함께 쓰므로 따로 둔다 (서로 import하지 않게)."""

from datetime import datetime, time
from typing import Literal

from pydantic import BaseModel

from engine.models import Direction, Place, PlaceId
from planning.repo import DayRecord

Stage = Literal["asking", "browsing", "composing", "done"]
DEFAULT_CLARIFY: list[Direction] = ["quieter", "food", "night"]  # TASK-003 §4-3: 보기가 0개일 때


class PlanningState(BaseModel):
    """TASK-003 §3. 대화 맥락만 담는다. 반응·코스안·선택 결과는 PlanningRepo에 둔다."""

    session_id: str
    day_id: str
    mode: Literal["conversation", "auto"]
    stage: Stage = "asking"
    round: int = 0
    categories: list[str] = []
    shown: list[PlaceId] = []
    batch: list[PlaceId] = []
    last_direction: Direction | None = None
    clarify_count: int = 0
    option_ids: list[str] = []


def candidates(day: DayRecord) -> dict[PlaceId, Place]:
    """TASK-003 §10 Q33: 꼭 갈 곳은 후보에서 뺀다. §10-10 R6: 고정 일정 장소도 뺀다 (장소 없는 고정 일정은 뺄 것이 없음)."""
    excluded = {*day.plan.must_visit, *(f.place_id for f in day.plan.fixed if f.place_id)}
    return {pid: p for pid, p in day.places.items() if pid not in excluded}


def day_start(day: DayRecord) -> datetime:
    """`at` = 그날 시작 시각 (TASK-003 §10 Q26)."""
    hour, minute = day.plan.start.split(":")
    return datetime.combine(day.plan.date, time(int(hour), int(minute)))
