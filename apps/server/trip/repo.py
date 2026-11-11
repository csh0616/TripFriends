"""여행 중 사건·제안 저장소 (TASK-007 §B, DATA-001 E: trip_events, recompose_proposals). 메모리 구현.

위치는 이 저장소에 오지 않는다 (AC-9): 사건에는 장소 순번(k)과 늦은 분만 남는다.
"""

import copy
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal

from engine.models import CourseOption, PlaceId
from trip.visit import VisitCheckRecord

EventState = Literal["open_low", "awaiting", "resolved"]


@dataclass(frozen=True)
class EventRecord:
    event_id: str
    day_id: str
    dedupe_key: str
    k: int
    severity: Literal["low", "high"]
    delay_min: int  # 가장 최근 증거
    state: EventState
    at: datetime  # 가장 최근 증거의 시각
    user_choice: Literal["accepted", "dismissed"] | None = None

    @property
    def type(self) -> Literal["delay", "closed"]:
        """사건 종류. dedupe_key의 앞부분 (delay:… / closed:…)."""
        return "closed" if self.dedupe_key.startswith("closed:") else "delay"


@dataclass(frozen=True)
class ClosedInfo:
    """닫힘 대안(TASK-008 §12 Q21) 한 줄: 닫힌 곳 대신 갈 대안(없으면 [빼고 가기])과 거리·이동 변화."""

    closed_place_id: PlaceId
    alternative: PlaceId | None
    distance_m: int | None
    travel_change_min: int  # 남은 이동 분 합(숙소 복귀 포함), 바뀐 뒤 - 바뀌기 전 (Q4)
    reordered: bool = False  # §14: 자리에 넣어서는 못 지켜 compose_courses로 다시 짠 안


@dataclass(frozen=True)
class ProposalRecord:
    proposal_id: str
    event_id: str
    label: Literal["relaxed", "packed"]
    reason: str
    dropped: tuple[PlaceId, ...]
    keeps_fixed: bool
    first_leave_at: str
    course: CourseOption  # 반영하면 그날의 새 코스안이 되는 전체 코스 (지난 항목 + 제안)
    from_index: int  # course.items 중 제안이 시작하는 자리
    created_at: datetime  # 만든 check의 at
    base_delay_min: int  # 만들 때의 delay_min
    superseded: bool = False
    closed: ClosedInfo | None = None  # 닫힘 사건의 제안이면


class TripRepo(ABC):
    @abstractmethod
    def put_event(self, record: EventRecord) -> None: ...

    @abstractmethod
    def get_event(self, event_id: str) -> EventRecord | None: ...

    @abstractmethod
    def event_by_key(self, day_id: str, dedupe_key: str) -> EventRecord | None: ...

    @abstractmethod
    def open_event(self, day_id: str, kind: Literal["delay", "closed"] = "delay") -> EventRecord | None:
        """그날 아직 처리되지 않은(open_low·awaiting) 그 종류의 사건. 종류마다 하나씩 열려 있을 수 있다 (TASK-008 §7)."""

    @abstractmethod
    def open_events(self, day_id: str) -> list[EventRecord]:
        """그날 아직 처리되지 않은 사건 전부 (종류마다 하나)."""

    @abstractmethod
    def put_visit_check(self, record: VisitCheckRecord) -> None: ...

    @abstractmethod
    def get_visit_check(self, day_id: str, place_id: str) -> VisitCheckRecord | None: ...

    @abstractmethod
    def visit_checks(self, day_id: str) -> dict[str, VisitCheckRecord]:
        """그날 확인 기록 (장소 id -> 기록)."""

    @abstractmethod
    def put_proposals(self, event_id: str, records: list[ProposalRecord]) -> None:
        """사건의 제안을 새로 둔다. 옛 제안은 지우지 않고 오래됨(superseded)으로 표시한다."""

    @abstractmethod
    def get_proposal(self, proposal_id: str) -> ProposalRecord | None: ...

    @abstractmethod
    def current_proposals(self, event_id: str) -> list[ProposalRecord]: ...

    @abstractmethod
    def snapshot(self) -> dict[str, Any]: ...


class MemoryTripRepo(TripRepo):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._events: dict[str, EventRecord] = {}
        self._proposals: dict[str, ProposalRecord] = {}
        self._order: dict[str, list[str]] = {}  # event_id -> proposal_id들 (만든 순서)
        self._visit_checks: dict[tuple[str, str], VisitCheckRecord] = {}  # (day_id, place_id) -> 기록

    def put_event(self, record: EventRecord) -> None:
        with self._lock:
            self._events[record.event_id] = record

    def get_event(self, event_id: str) -> EventRecord | None:
        with self._lock:
            return self._events.get(event_id)

    def event_by_key(self, day_id: str, dedupe_key: str) -> EventRecord | None:
        with self._lock:
            return next((e for e in self._events.values() if e.day_id == day_id and e.dedupe_key == dedupe_key), None)

    def open_event(self, day_id: str, kind: Literal["delay", "closed"] = "delay") -> EventRecord | None:
        with self._lock:
            return next((e for e in self._events.values() if e.day_id == day_id and e.state != "resolved" and e.type == kind), None)

    def open_events(self, day_id: str) -> list[EventRecord]:
        with self._lock:
            return [e for e in self._events.values() if e.day_id == day_id and e.state != "resolved"]

    def put_visit_check(self, record: VisitCheckRecord) -> None:
        with self._lock:
            self._visit_checks[(record.day_id, record.place_id)] = record

    def get_visit_check(self, day_id: str, place_id: str) -> VisitCheckRecord | None:
        with self._lock:
            return self._visit_checks.get((day_id, place_id))

    def visit_checks(self, day_id: str) -> dict[str, VisitCheckRecord]:
        with self._lock:
            return {pid: rec for (did, pid), rec in self._visit_checks.items() if did == day_id}

    def put_proposals(self, event_id: str, records: list[ProposalRecord]) -> None:
        with self._lock:
            for old_id in self._order.get(event_id, []):
                self._proposals[old_id] = replace(self._proposals[old_id], superseded=True)
            for record in records:
                self._proposals[record.proposal_id] = record
            self._order[event_id] = [*self._order.get(event_id, []), *(r.proposal_id for r in records)]

    def get_proposal(self, proposal_id: str) -> ProposalRecord | None:
        with self._lock:
            return self._proposals.get(proposal_id)

    def current_proposals(self, event_id: str) -> list[ProposalRecord]:
        with self._lock:
            found = [self._proposals[pid] for pid in self._order.get(event_id, [])]
            return [p for p in found if not p.superseded]

    # ---- TASK-012 A3: 요청이 실패하면 되돌린다 (store.unit.Transaction이 부른다). 기록은 바뀌지 않고 갈아 끼우기만 한다 ----

    def capture(self) -> dict[str, Any]:
        with self._lock:
            return {
                "_events": dict(self._events),
                "_proposals": dict(self._proposals),
                "_order": {k: list(v) for k, v in self._order.items()},
                "_visit_checks": dict(self._visit_checks),
            }

    def restore(self, saved: dict[str, Any]) -> None:
        with self._lock:
            for name, value in saved.items():
                setattr(self, name, value)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy({"events": self._events, "proposals": self._proposals, "order": self._order, "visit_checks": self._visit_checks})
