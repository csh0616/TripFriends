"""G1 계획 대화 그래프 (TASK-003 §3·§4). 껍데기: 상태 필드 선언과 시그니처만 둔다."""

from typing import Literal

from pydantic import BaseModel

from engine.models import Direction, PlaceId
from planning.repo import PlanningRepo


class PlanningState(BaseModel):
    """TASK-003 §3. 대화 맥락만 담는다. 반응·코스안·선택 결과는 PlanningRepo에 둔다."""

    session_id: str
    day_id: str
    mode: Literal["conversation", "auto"]
    stage: Literal["asking", "browsing", "composing", "done"]
    round: int
    categories: list[str]
    shown: list[PlaceId]
    batch: list[PlaceId]
    last_direction: Direction | None
    clarify_count: int
    option_ids: list[str]


def build_planning_graph(repo: PlanningRepo):
    """규칙 노드 그래프를 MemorySaver 체크포인터로 컴파일해 돌려준다."""
    raise NotImplementedError
