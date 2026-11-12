"""여행·고정 일정 저장소 (TASK-012 A2). `TripBook`이 쓰는 인터페이스와 메모리 구현. Postgres 구현은 `store.postgres.PostgresTripStore`.

여행의 주인(owner_id)은 늘 있다 (§11 Q1). 날의 주인 = 그 날이 속한 여행의 주인.
"""

import copy
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Any, Literal


@dataclass
class TripRow:
    trip_id: str
    owner_id: str
    city_code: str
    start_date: date
    end_date: date
    lodging_place_id: str | None
    day_ids: list[str]
    status: Literal["active", "archived"] = "active"
    is_demo: bool = False  # A5: 개발용 데모 여행
    demo_current: bool = False  # 데모가 지금 여행으로 붙었나 (as_current, 점검 전용). 지금 여행 = active이면서 데모가 아닌 것(또는 붙은 데모)
    demo_today: date | None = None  # 데모 시드 전용: 이 여행의 날 상태를 계산하는 시계 (없으면 진짜 오늘)


@dataclass
class FixedRow:
    fixed_event_id: str
    trip_id: str
    trip_day_id: str
    title: str
    start_at: datetime
    end_at: datetime
    place_id: str | None


class TripStore(ABC):
    @abstractmethod
    def add_trip(self, row: TripRow, archive_active: bool = True) -> None:
        """여행을 넣고 날들을 이 여행에 붙인다. archive_active면 같은 주인의 지금 여행은 같은 때 archived (지우지 않음, B2)."""

    @abstractmethod
    def get_trip(self, trip_id: str) -> TripRow | None: ...

    @abstractmethod
    def move_trips(self, from_owner: str, to_owner: str) -> None:
        """from_owner의 데모가 아닌 여행을 모두 to_owner에게 옮긴다 (보관 여행도 상태 그대로, 날·고정 일정·코스는 여행을 따라간다). 지우지 않는다 (§16 Q1)."""

    @abstractmethod
    def archive_trip(self, trip_id: str) -> None:
        """이 여행을 archived로 (지우지 않음, §16 Q2)."""

    @abstractmethod
    def trip_of_day(self, day_id: str) -> TripRow | None: ...

    @abstractmethod
    def active_trip(self, owner_id: str) -> TripRow | None:
        """그 사용자의 지금 여행: 만든 순서로 마지막 active (데모는 as_current로 붙은 것만)."""

    @abstractmethod
    def day_owner(self, day_id: str) -> str | None:
        """날의 주인 user_id. 없는 날이거나 주인을 모르면 None."""

    @abstractmethod
    def fixed_for_day(self, day_id: str) -> list[FixedRow]:
        """시작 시각 순."""

    @abstractmethod
    def get_fixed(self, fixed_event_id: str) -> FixedRow | None: ...

    @abstractmethod
    def add_fixed(self, row: FixedRow) -> None: ...

    @abstractmethod
    def delete_fixed(self, fixed_event_id: str) -> None: ...

    @abstractmethod
    def snapshot(self) -> dict[str, Any]: ...


def _is_current(trip: TripRow) -> bool:
    """지금 여행 후보: 데모가 아니거나, as_current로 붙은 데모 (§12 3)."""
    return not trip.is_demo or trip.demo_current


@dataclass
class _Data:
    trips: dict[str, TripRow] = field(default_factory=dict)
    fixed: dict[str, FixedRow] = field(default_factory=dict)
    day_trip: dict[str, str] = field(default_factory=dict)  # day_id -> trip_id


class MemoryTripStore(TripStore):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._data = _Data()

    def add_trip(self, row: TripRow, archive_active: bool = True) -> None:
        with self._lock:
            if archive_active:
                for old in self._data.trips.values():
                    if old.owner_id == row.owner_id and old.status == "active" and _is_current(old):
                        old.status = "archived"
            for day_id in row.day_ids:
                self._data.day_trip[day_id] = row.trip_id
            self._data.trips[row.trip_id] = row

    def get_trip(self, trip_id: str) -> TripRow | None:
        with self._lock:
            return self._data.trips.get(trip_id)

    def move_trips(self, from_owner: str, to_owner: str) -> None:
        with self._lock:
            for trip in self._data.trips.values():
                if trip.owner_id == from_owner and not trip.is_demo:
                    trip.owner_id = to_owner

    def archive_trip(self, trip_id: str) -> None:
        with self._lock:
            trip = self._data.trips.get(trip_id)
            if trip is not None:
                trip.status = "archived"

    def trip_of_day(self, day_id: str) -> TripRow | None:
        with self._lock:
            trip_id = self._data.day_trip.get(day_id)
            return self._data.trips.get(trip_id) if trip_id else None

    def active_trip(self, owner_id: str) -> TripRow | None:
        with self._lock:
            active = [t for t in self._data.trips.values() if t.owner_id == owner_id and t.status == "active" and _is_current(t)]
            return active[-1] if active else None

    def day_owner(self, day_id: str) -> str | None:
        with self._lock:
            trip = self.trip_of_day(day_id)
            return trip.owner_id if trip else None

    def fixed_for_day(self, day_id: str) -> list[FixedRow]:
        with self._lock:
            return sorted((f for f in self._data.fixed.values() if f.trip_day_id == day_id), key=lambda f: f.start_at)

    def get_fixed(self, fixed_event_id: str) -> FixedRow | None:
        with self._lock:
            return self._data.fixed.get(fixed_event_id)

    def add_fixed(self, row: FixedRow) -> None:
        with self._lock:
            self._data.fixed[row.fixed_event_id] = row

    def delete_fixed(self, fixed_event_id: str) -> None:
        with self._lock:
            self._data.fixed.pop(fixed_event_id, None)

    # ---- A3: 요청이 실패하면 되돌린다 ----

    def capture(self) -> _Data:
        with self._lock:
            d = self._data
            return _Data(
                {k: replace(v, day_ids=list(v.day_ids)) for k, v in d.trips.items()}, dict(d.fixed), dict(d.day_trip)
            )

    def restore(self, saved: _Data) -> None:
        with self._lock:
            self._data = saved

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy({"trips": self._data.trips, "fixed": self._data.fixed, "day_trip": self._data.day_trip})
