"""계획 대화 저장소 (TASK-003 §2·§3). 반응·코스안·선택 결과는 그래프 상태가 아니라 여기에 둔다 (ADR-013).

`PlanningRepo`는 인터페이스, `MemoryPlanningRepo`는 메모리 구현이다. Supabase 연결은 별도 TASK에서
이 인터페이스만 바꿔 끼운다.
"""

import copy
import threading
import uuid
from abc import ABC, abstractmethod
from typing import Any, Literal, NamedTuple

from engine.models import CourseOption, DayPlan, Place, PlaceId, Reactions

ReactionAction = Literal["like", "skip", "unlike"]


class DayRecord(NamedTuple):
    plan: DayPlan
    places: dict[PlaceId, Place]
    day_number: int  # trip 안에서 몇째 날인지, 1부터 (TASK-003 §10 Q5)


class OptionRecord(NamedTuple):
    """계산해 보여 준 코스안 하나. picks는 이 안을 계산할 때 쓴 담은 곳 (adjust가 같은 목록으로 다시 계산, TASK-003 §10 Q20)."""

    option_id: str
    session_id: str
    picks: list[PlaceId]
    course: CourseOption


class PlanningRepo(ABC):
    # ---- 하루·여행 (심어 두는 쪽) ----
    @abstractmethod
    def save_day(self, day_id: str, plan: DayPlan, places: dict[PlaceId, Place], day_number: int = 1) -> None: ...

    @abstractmethod
    def get_day(self, day_id: str) -> DayRecord | None: ...

    @abstractmethod
    def save_trip(self, trip_id: str, day_ids: list[str]) -> None: ...

    # ---- 세션 ----
    @abstractmethod
    def create_session(self, session_id: str, day_id: str) -> None: ...

    @abstractmethod
    def session_day(self, session_id: str) -> str | None:
        """세션이 속한 day_id. 없는 세션이면 None."""

    # ---- 반응 ----
    @abstractmethod
    def reactions(self, session_id: str) -> Reactions: ...

    @abstractmethod
    def react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> None:
        """like·skip·unlike를 반영한다 (TASK-003 §4 줄05, §10 Q17·Q18·Q39)."""

    @abstractmethod
    def skip_unreacted(self, session_id: str, batch: list[PlaceId]) -> None:
        """이번 묶음에서 반응이 없는 곳을 묶음 순서대로 skip으로 기록한다 (TASK-003 §4 줄06~09)."""

    # ---- 머무는 시간 ----
    @abstractmethod
    def stay_overrides(self, session_id: str) -> dict[PlaceId, int]: ...

    @abstractmethod
    def set_stay_override(self, session_id: str, place_id: PlaceId, minutes: int) -> None: ...

    # ---- 코스안과 선택 ----
    @abstractmethod
    def save_options(self, session_id: str, picks: list[PlaceId], courses: list[CourseOption]) -> list[OptionRecord]:
        """새 ID(uuid4)를 붙여 저장한다. 옛 코스안은 지우지 않는다 (옛 ID는 상태의 option_ids에서 빠질 뿐, §10 Q41)."""

    @abstractmethod
    def get_option(self, option_id: str) -> OptionRecord | None: ...

    @abstractmethod
    def choose_option(self, day_id: str, option_id: str) -> None: ...

    @abstractmethod
    def chosen_option(self, day_id: str) -> str | None: ...

    # ---- 판단 기록 ----
    @abstractmethod
    def log_decision(self, kind: str, model: str, output: dict[str, Any]) -> None: ...

    @abstractmethod
    def decision_logs(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def snapshot(self) -> dict[str, Any]:
        """저장소 전체의 복사본. 테스트가 "실패한 요청은 아무것도 바꾸지 않는다"를 비교하는 데 쓴다."""


class MemoryPlanningRepo(PlanningRepo):
    def __init__(self) -> None:
        # 요청이 여러 스레드에서 들어와도 한 번에 하나씩 바꾼다
        self._lock = threading.RLock()
        self._days: dict[str, DayRecord] = {}
        self._trips: dict[str, list[str]] = {}
        self._sessions: dict[str, str] = {}
        self._liked: dict[str, list[PlaceId]] = {}
        self._skipped: dict[str, list[PlaceId]] = {}
        # 좋아했다가 취소한 곳. 반응이 있었으므로 next에서 skip으로 치지 않는다 (TASK-003 §4 줄06, §10 Q17)
        self._unliked: dict[str, list[PlaceId]] = {}
        self._overrides: dict[str, dict[PlaceId, int]] = {}
        self._options: dict[str, OptionRecord] = {}
        self._chosen: dict[str, str] = {}
        self._logs: list[dict[str, Any]] = []

    def save_day(self, day_id: str, plan: DayPlan, places: dict[PlaceId, Place], day_number: int = 1) -> None:
        with self._lock:
            self._days[day_id] = DayRecord(plan.model_copy(deep=True), {k: v.model_copy(deep=True) for k, v in places.items()}, day_number)

    def get_day(self, day_id: str) -> DayRecord | None:
        with self._lock:
            return self._days.get(day_id)

    def save_trip(self, trip_id: str, day_ids: list[str]) -> None:
        with self._lock:
            self._trips[trip_id] = list(day_ids)

    def create_session(self, session_id: str, day_id: str) -> None:
        with self._lock:
            self._sessions[session_id] = day_id
            self._liked[session_id] = []
            self._skipped[session_id] = []
            self._unliked[session_id] = []
            self._overrides[session_id] = {}

    def session_day(self, session_id: str) -> str | None:
        with self._lock:
            return self._sessions.get(session_id)

    def reactions(self, session_id: str) -> Reactions:
        with self._lock:
            return Reactions(liked=list(self._liked.get(session_id, [])), skipped=list(self._skipped.get(session_id, [])))

    def react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> None:
        with self._lock:
            liked, skipped, unliked = self._liked[session_id], self._skipped[session_id], self._unliked[session_id]
            if action == "like":
                # §10 Q18: 넘긴 곳을 다시 좋아하면 담긴다. 이미 담은 곳이면 순서 그대로
                _remove(skipped, place_id)
                _remove(unliked, place_id)
                if place_id not in liked:
                    liked.append(place_id)
            elif action == "skip":
                # §10 Q18: 좋아한 곳을 넘기면 담은 곳에서 빠진다
                _remove(liked, place_id)
                _remove(unliked, place_id)
                if place_id not in skipped:
                    skipped.append(place_id)
            elif place_id in liked:
                # unlike: 담은 곳에서만 뺀다 (skip으로 바꾸지 않음, AC-7). 담은 곳이 아니면 변화 없음 (§10 Q39)
                _remove(liked, place_id)
                if place_id not in unliked:
                    unliked.append(place_id)

    def skip_unreacted(self, session_id: str, batch: list[PlaceId]) -> None:
        with self._lock:
            liked, skipped, unliked = self._liked[session_id], self._skipped[session_id], self._unliked[session_id]
            for place_id in batch:
                if place_id not in liked and place_id not in skipped and place_id not in unliked:
                    skipped.append(place_id)

    def stay_overrides(self, session_id: str) -> dict[PlaceId, int]:
        with self._lock:
            return dict(self._overrides.get(session_id, {}))

    def set_stay_override(self, session_id: str, place_id: PlaceId, minutes: int) -> None:
        with self._lock:
            self._overrides[session_id][place_id] = minutes

    def save_options(self, session_id: str, picks: list[PlaceId], courses: list[CourseOption]) -> list[OptionRecord]:
        with self._lock:
            records = [OptionRecord(str(uuid.uuid4()), session_id, list(picks), course) for course in courses]
            for record in records:
                self._options[record.option_id] = record
            return records

    def get_option(self, option_id: str) -> OptionRecord | None:
        with self._lock:
            return self._options.get(option_id)

    def choose_option(self, day_id: str, option_id: str) -> None:
        with self._lock:
            self._chosen[day_id] = option_id

    def chosen_option(self, day_id: str) -> str | None:
        with self._lock:
            return self._chosen.get(day_id)

    def log_decision(self, kind: str, model: str, output: dict[str, Any]) -> None:
        with self._lock:
            # DATA-001 decision_logs. R1은 message_id 없이 이 표만 남긴다 (TASK-003 §10 Q28)
            self._logs.append(
                {"message_id": None, "kind": kind, "model": model, "output": dict(output), "latency_ms": None, "cost_usd": None}
            )

    def decision_logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._logs)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(
                {
                    "days": {k: (v.plan.model_dump(), {p: pl.model_dump() for p, pl in v.places.items()}, v.day_number) for k, v in self._days.items()},
                    "trips": self._trips,
                    "sessions": self._sessions,
                    "liked": self._liked,
                    "skipped": self._skipped,
                    "unliked": self._unliked,
                    "overrides": self._overrides,
                    "options": {k: (v.session_id, v.picks, v.course.model_dump()) for k, v in self._options.items()},
                    "chosen": self._chosen,
                    "logs": self._logs,
                }
            )


def _remove(items: list[PlaceId], place_id: PlaceId) -> None:
    if place_id in items:
        items.remove(place_id)
