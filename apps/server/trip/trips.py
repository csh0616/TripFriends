"""여행 만들기·고정 일정·장소 검색 (TASK-010 §B). 메모리 저장 (서버를 다시 켜면 사라진다: 알려진 한계, TASK-011에서 Supabase).

원칙: 실패한 요청은 아무것도 바꾸지 않는다 -> 모든 검사를 끝낸 뒤에 저장한다.
날 상태(state)는 저장하지 않고 응답을 만들 때마다 도시 시간대로 계산한다 (B6).
"""

import threading
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from engine.models import DayPlan, PlanFixed
from planning.repo import PlanningRepo
from planning.seed import DAY_END, DAY_START
from places.city import CityData
from trip.days import DayState, city_today, day_state

CITY_CODE = "osaka"


class ApiError(Exception):
    """공통 오류 `{"error": {code, message, detail}}` (API-001 §1). TASK-010의 400 VALIDATION_ERROR·409 PLAN_EXISTS·503 PROVIDER_UNAVAILABLE."""

    def __init__(self, status: int, code: str, message: str, detail: Any = None):
        super().__init__(message)
        self.status, self.code, self.message, self.detail = status, code, message, detail


def invalid(field_name: str, message: str) -> ApiError:
    return ApiError(400, "VALIDATION_ERROR", message, {"field": field_name})


def _rules() -> dict[str, int]:
    """B1·B3의 기준 값 (기간·시작일·꼭 갈 곳·제목). 가설이라 함수 안에 둔다 (돌연변이 대상)."""
    return {"max_days": 7, "max_start_ahead": 180, "max_must_per_day": 5, "title_max": 30}


# ---------- 응답 모양 (API-001 §2-1, TASK-010 §9 Q12) ----------


class FixedEvent(BaseModel):
    fixed_event_id: str
    trip_day_id: str
    title: str
    start_at: datetime
    end_at: datetime
    place_id: str | None


class TripDay(BaseModel):
    day_id: str
    date: date
    state: DayState
    chosen_option_id: str | None  # 그날 고른 코스. 없으면 null -> 앱은 계획 대화부터 (§9 Q6)
    fixed_events: list[FixedEvent]


class Trip(BaseModel):
    trip_id: str
    city_code: str
    start_date: date
    end_date: date
    lodging_place_id: str | None  # place_id만 저장, 좌표는 캐시 (B5)
    status: Literal["active", "archived"]
    trip_days: list[TripDay]


class MustVisit(BaseModel):
    date: date
    place_id: str


class TripCreate(BaseModel):
    city_code: str
    start_date: date
    end_date: date
    lodging_place_id: str | None = None
    must_visits: list[MustVisit] = []


class FixedEventCreate(BaseModel):
    trip_day_id: str
    title: str
    start_at: datetime
    end_at: datetime
    place_id: str | None = None


class PlaceFact(BaseModel):
    field: str
    value: str | None
    status: Literal["confirmed", "unverified", "unknown"]
    source_type: str
    source_url: str | None
    checked_at: str | None


class PlaceImage(BaseModel):
    category: str  # URL 없음. 색·그림은 앱의 placeholderFor가 정한다 (§9 Q20)


class PlaceHit(BaseModel):
    id: str
    name: str
    category: str
    area: str
    facts: list[PlaceFact]
    image: PlaceImage


class LodgingHit(BaseModel):
    place_id: str
    name: str
    address_short: str


# ---------- 저장 ----------


@dataclass
class _Trip:
    trip_id: str
    device_id: str
    city_code: str
    start_date: date
    end_date: date
    lodging_place_id: str | None
    day_ids: list[str]
    status: Literal["active", "archived"] = "active"


@dataclass
class _Fixed:
    fixed_event_id: str
    trip_id: str
    trip_day_id: str
    title: str
    start_at: datetime
    end_at: datetime
    place_id: str | None


@dataclass
class _Store:
    trips: dict[str, _Trip] = field(default_factory=dict)
    fixed: dict[str, _Fixed] = field(default_factory=dict)
    day_trip: dict[str, str] = field(default_factory=dict)  # day_id -> trip_id


def _hhmm(moment: datetime, day: date) -> str:
    """도시 시간대 시각. 다음 날 00:00은 24:00 (그날 끝)."""
    if moment.date() > day:
        return "24:00"
    return f"{moment.hour:02d}:{moment.minute:02d}"


class TripBook:
    def __init__(self, planning: PlanningRepo, city: CityData, clock: Callable[[], datetime]):
        self.planning, self.city, self.clock = planning, city, clock
        self._store = _Store()
        self._lock = threading.RLock()

    # ---- 도우미 ----

    def _tz(self) -> ZoneInfo:
        return ZoneInfo(self.city.timezone)

    def _today(self) -> date:
        return city_today(self.clock(), self.city.timezone)

    def _own(self, trip_id: str, device_id: str) -> _Trip:
        trip = self._store.trips.get(trip_id)
        if trip is None or trip.device_id != device_id:  # 다른 기기의 여행은 없는 것과 같다
            raise ApiError(404, "NOT_FOUND", "없는 여행이에요", {"resource": "trip", "trip_id": trip_id})
        return trip

    def _view(self, trip: _Trip) -> Trip:
        today = self._today()
        days: list[TripDay] = []
        for number, day_id in enumerate(trip.day_ids):
            chosen = self.planning.chosen_option(day_id)
            day = trip.start_date + timedelta(days=number)
            events = sorted((f for f in self._store.fixed.values() if f.trip_day_id == day_id), key=lambda f: f.start_at)
            days.append(
                TripDay(
                    day_id=day_id,
                    date=day,
                    state=day_state(day, today, chosen is not None),
                    chosen_option_id=chosen,
                    fixed_events=[_fixed_view(f) for f in events],
                )
            )
        return Trip(
            trip_id=trip.trip_id,
            city_code=trip.city_code,
            start_date=trip.start_date,
            end_date=trip.end_date,
            lodging_place_id=trip.lodging_place_id,
            status=trip.status,
            trip_days=days,
        )

    # ---- B1·B2 ----

    def create(self, device_id: str, body: TripCreate) -> Trip:
        rules = _rules()
        if body.city_code != CITY_CODE:
            raise invalid("city_code", "지금은 오사카만 만들 수 있어요")
        days = (body.end_date - body.start_date).days + 1
        if days < 1 or days > rules["max_days"]:
            raise invalid("end_date", f"여행은 1일에서 {rules['max_days']}일까지 만들 수 있어요")
        today = self._today()
        if not today <= body.start_date <= today + timedelta(days=rules["max_start_ahead"]):
            raise invalid("start_date", f"시작일은 오늘부터 {rules['max_start_ahead']}일 뒤까지 고를 수 있어요")

        places = self.city.engine_places()
        per_day: dict[date, list[str]] = {}
        for visit in body.must_visits:
            if not body.start_date <= visit.date <= body.end_date:
                raise invalid("must_visits", "꼭 갈 곳의 날짜가 여행 기간 밖이에요")
            if visit.place_id not in places:
                raise invalid("must_visits", "이 도시에 없는 장소예요")
            ids = per_day.setdefault(visit.date, [])
            if visit.place_id not in ids:
                ids.append(visit.place_id)
            if len(ids) > rules["max_must_per_day"]:
                raise invalid("must_visits", f"꼭 갈 곳은 하루 {rules['max_must_per_day']}곳까지 고를 수 있어요")

        with self._lock:
            lodging = self.city.lodging_location(body.lodging_place_id, self.clock()) if body.lodging_place_id else None
            start_point = lodging or self.city.center()
            sources = self.city.sources()
            trip_id = str(uuid.uuid4())
            day_ids: list[str] = []
            for number in range(days):
                day = body.start_date + timedelta(days=number)
                plan = DayPlan(
                    date=day,
                    start=DAY_START,
                    end=DAY_END,
                    lodging=start_point,
                    fixed=[],
                    must_visit=per_day.get(day, []),
                    stay_overrides={},
                )
                day_id = str(uuid.uuid4())
                self.planning.save_day(day_id, plan, places, number + 1, lodging_known=lodging is not None, sources=sources)
                day_ids.append(day_id)
                self._store.day_trip[day_id] = trip_id
            self.planning.save_trip(trip_id, day_ids)
            for old in self._store.trips.values():
                if old.device_id == device_id and old.status == "active":
                    old.status = "archived"  # 지우지 않는다 (B2)
            trip = _Trip(trip_id, device_id, body.city_code, body.start_date, body.end_date, body.lodging_place_id, day_ids)
            self._store.trips[trip_id] = trip
            return self._view(trip)

    def current(self, device_id: str) -> Trip:
        with self._lock:
            active = [t for t in self._store.trips.values() if t.device_id == device_id and t.status == "active"]
            if not active:
                raise ApiError(404, "NOT_FOUND", "여행이 없어요", {"resource": "trip"})
            return self._view(active[-1])

    def get(self, trip_id: str, device_id: str) -> Trip:
        with self._lock:
            return self._view(self._own(trip_id, device_id))

    # ---- B3 고정 일정 ----

    def _plan_fixed(self, day_id: str) -> list[PlanFixed]:
        tz = self._tz()
        record = self.planning.get_day(day_id)
        assert record is not None
        fixed: list[PlanFixed] = []
        for f in sorted((f for f in self._store.fixed.values() if f.trip_day_id == day_id), key=lambda f: f.start_at):
            place = record.places.get(f.place_id) if f.place_id else None
            fixed.append(
                PlanFixed(
                    id=f.fixed_event_id,
                    title=f.title,
                    start=_hhmm(f.start_at.astimezone(tz), record.plan.date),
                    end=_hhmm(f.end_at.astimezone(tz), record.plan.date),
                    place_id=f.place_id,
                    lat=place.lat if place else None,
                    lng=place.lng if place else None,
                )
            )
        return fixed

    def _sync_plan(self, day_id: str) -> None:
        record = self.planning.get_day(day_id)
        assert record is not None
        plan = record.plan.model_copy(update={"fixed": self._plan_fixed(day_id)})
        self.planning.save_day(day_id, plan, record.places, record.day_number, lodging_known=record.lodging_known, sources=record.sources)

    def add_fixed(self, trip_id: str, device_id: str, body: FixedEventCreate) -> FixedEvent:
        with self._lock:
            trip = self._own(trip_id, device_id)
            if body.trip_day_id not in trip.day_ids:
                raise ApiError(404, "NOT_FOUND", "없는 날이에요", {"resource": "day", "day_id": body.trip_day_id})
            if self.planning.chosen_option(body.trip_day_id) is not None:
                raise ApiError(409, "PLAN_EXISTS", "계획을 이미 골랐어요. 계획을 다시 짜야 해요", {"day_id": body.trip_day_id})
            title = body.title.strip()
            if not 1 <= len(title) <= _rules()["title_max"]:
                raise invalid("title", f"제목은 1자에서 {_rules()['title_max']}자까지 쓸 수 있어요")
            tz = self._tz()
            day = trip.start_date + timedelta(days=trip.day_ids.index(body.trip_day_id))
            start_at, end_at = (m if m.tzinfo else m.replace(tzinfo=tz) for m in (body.start_at, body.end_at))
            day_start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
            day_end = day_start + timedelta(days=1)
            if end_at <= start_at:
                raise invalid("end_at", "끝나는 시각은 시작보다 뒤여야 해요")
            if start_at < day_start or start_at >= day_end:
                raise invalid("start_at", "그날 안의 시각이어야 해요")
            if end_at > day_end:
                raise invalid("end_at", "그날 안의 시각이어야 해요")
            if body.place_id is not None and body.place_id not in self.planning.get_day(body.trip_day_id).places:  # type: ignore[union-attr]
                raise invalid("place_id", "이 도시에 없는 장소예요")
            for other in self._store.fixed.values():
                if other.trip_day_id == body.trip_day_id and start_at < other.end_at and other.start_at < end_at:
                    raise invalid("start_at", "같은 날 다른 일정과 시간이 겹쳐요")  # 맞닿는 것은 겹침이 아니다
            made = _Fixed(str(uuid.uuid4()), trip_id, body.trip_day_id, title, start_at, end_at, body.place_id)
            self._store.fixed[made.fixed_event_id] = made
            self._sync_plan(body.trip_day_id)
            return _fixed_view(made)

    def delete_fixed(self, fixed_event_id: str, device_id: str) -> None:
        with self._lock:
            found = self._store.fixed.get(fixed_event_id)
            if found is None:
                raise ApiError(404, "NOT_FOUND", "없는 고정 일정이에요", {"resource": "fixed_event", "fixed_event_id": fixed_event_id})
            self._own(found.trip_id, device_id)
            if self.planning.chosen_option(found.trip_day_id) is not None:
                raise ApiError(409, "PLAN_EXISTS", "계획을 이미 골랐어요. 계획을 다시 짜야 해요", {"day_id": found.trip_day_id})
            del self._store.fixed[fixed_event_id]
            self._sync_plan(found.trip_day_id)

    # ---- A5 계획 세션 시작 때 오래된 값만 다시 부르기 ----

    def refresh_for_day(self, day_id: str) -> None:
        """실제 여행의 날이면 그날 후보 중 오래된 장소 값만 다시 부른다. 실패하면 이전 값 + 미확인 (cache.refresh)."""
        with self._lock:
            record = self.planning.get_day(day_id)
            if record is None or day_id not in self._store.day_trip:
                return
            ids = [self.city.row(pid)["place_id"] for pid in record.places if self.city.row(pid)]  # type: ignore[index]
            self.city.refresh(self.clock(), ids)
            self.planning.save_day(
                day_id, record.plan, self.city.engine_places(), record.day_number, lodging_known=record.lodging_known, sources=self.city.sources()
            )

    # ---- B4 ----

    def search(self, q: str) -> list[PlaceHit]:
        return [
            PlaceHit(
                id=row["id"],
                name=row["name_ko"],
                category=row["category"],
                area=row["area"],
                facts=[PlaceFact(**fact) for fact in self.city.facts(row)],
                image=PlaceImage(category=row["category"]),
            )
            for row in self.city.search(q)
        ]


def _fixed_view(f: _Fixed) -> FixedEvent:
    return FixedEvent(fixed_event_id=f.fixed_event_id, trip_day_id=f.trip_day_id, title=f.title, start_at=f.start_at, end_at=f.end_at, place_id=f.place_id)
