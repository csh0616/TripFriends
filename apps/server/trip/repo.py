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


class TripRepo(ABC):
    @abstractmethod
    def put_event(self, record: EventRecord) -> None: ...

    @abstractmethod
    def get_event(self, event_id: str) -> EventRecord | None: ...

    @abstractmethod
    def event_by_key(self, day_id: str, dedupe_key: str) -> EventRecord | None: ...

    @abstractmethod
    def open_event(self, day_id: str) -> EventRecord | None:
        """그날 아직 처리되지 않은(open_low·awaiting) 사건. 화면에는 하나만 싣는다."""

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

    def put_event(self, record: EventRecord) -> None:
        with self._lock:
            self._events[record.event_id] = record

    def get_event(self, event_id: str) -> EventRecord | None:
        with self._lock:
            return self._events.get(event_id)

    def event_by_key(self, day_id: str, dedupe_key: str) -> EventRecord | None:
        with self._lock:
            return next((e for e in self._events.values() if e.day_id == day_id and e.dedupe_key == dedupe_key), None)

    def open_event(self, day_id: str) -> EventRecord | None:
        with self._lock:
            return next((e for e in self._events.values() if e.day_id == day_id and e.state != "resolved"), None)

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

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy({"events": self._events, "proposals": self._proposals, "order": self._order})
