"""계획 대화 저장소 (TASK-003 §2). 껍데기: 인터페이스 시그니처만 둔다."""

from abc import ABC, abstractmethod
from typing import Any, NamedTuple

from engine.models import DayPlan, Place, PlaceId, Reactions


class DayRecord(NamedTuple):
    plan: DayPlan
    places: dict[PlaceId, Place]


class PlanningRepo(ABC):
    @abstractmethod
    def save_day(self, day_id: str, plan: DayPlan, places: dict[PlaceId, Place]) -> None: ...

    @abstractmethod
    def get_day(self, day_id: str) -> DayRecord | None: ...

    @abstractmethod
    def reactions(self, session_id: str) -> Reactions: ...

    @abstractmethod
    def chosen_option(self, day_id: str) -> str | None: ...

    @abstractmethod
    def decision_logs(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def snapshot(self) -> dict[str, Any]: ...


class MemoryPlanningRepo(PlanningRepo):
    def save_day(self, day_id: str, plan: DayPlan, places: dict[PlaceId, Place]) -> None:
        raise NotImplementedError

    def get_day(self, day_id: str) -> DayRecord | None:
        raise NotImplementedError

    def reactions(self, session_id: str) -> Reactions:
        raise NotImplementedError

    def chosen_option(self, day_id: str) -> str | None:
        raise NotImplementedError

    def decision_logs(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def snapshot(self) -> dict[str, Any]:
        raise NotImplementedError
