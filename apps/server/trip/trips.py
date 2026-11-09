"""여행 만들기·고정 일정·장소 검색 (TASK-010 §B). 저장은 `trip.store.TripStore` 뒤에 있다 (메모리·Postgres, TASK-012 A2).

원칙: 실패한 요청은 아무것도 바꾸지 않는다 -> 모든 검사를 끝낸 뒤에 저장한다.
날 상태(state)는 저장하지 않고 응답을 만들 때마다 도시 시간대로 계산한다 (B6).
"""

import threading
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Callable, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from engine.models import DayPlan, PlanFixed
from planning.presenter import option_view
from planning.repo import PlanningRepo
from planning.schemas import CourseResultOption
from planning.seed import DAY_END, DAY_START
from places.city import CityData
from places.live import CAPS
from trip.days import DayState, city_today, day_state
from trip.store import FixedRow, MemoryTripStore, TripRow, TripStore
from trip.visit import _limits as visit_limits, _meters as meters

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


class DayBrief(BaseModel):
    """날짜 목록의 날 요약 (TASK-011 §9 Q2). 고른 코스의 마지막 줄 끝 · 장소가 있는 줄 수 · 이동 합계(분)."""

    end_time: str
    place_count: int
    move_min: int


class DayMust(BaseModel):
    place_id: str
    name: str


class TripDay(BaseModel):
    day_id: str
    date: date
    state: DayState
    chosen_option_id: str | None  # 그날 고른 코스. 없으면 null -> 앱은 계획 대화부터 (§9 Q6)
    fixed_events: list[FixedEvent]
    summary: DayBrief | None = None  # 고른 코스가 있는 날만 (TASK-011 §9 Q2)
    must_visits: list[DayMust] = []  # 넣은 순서, 이름은 도시 팩 장소 이름


class Trip(BaseModel):
    trip_id: str
    city_code: str
    start_date: date
    end_date: date
    lodging_place_id: str | None  # place_id만 저장, 좌표는 캐시 (B5)
    status: Literal["active", "archived"]
    is_demo: bool = False  # TASK-012 §10 Q11: 개발용 데모 여행 (A5)
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


def _brief(course: CourseResultOption) -> DayBrief | None:
    if not course.items:
        return None
    return DayBrief(
        end_time=course.items[-1].end,
        place_count=sum(1 for item in course.items if item.place_id is not None),
        move_min=course.total_travel_min,
    )


def _hhmm(moment: datetime, day: date) -> str:
    """도시 시간대 시각. 다음 날 00:00은 24:00 (그날 끝)."""
    if moment.date() > day:
        return "24:00"
    return f"{moment.hour:02d}:{moment.minute:02d}"


class TripBook:
    def __init__(self, planning: PlanningRepo, city: CityData, clock: Callable[[], datetime], store: TripStore | None = None):
        self.planning, self.city, self.clock = planning, city, clock
        self.store: TripStore = store if store is not None else MemoryTripStore()
        self._lock = threading.RLock()

    # ---- 도우미 ----

    def _tz(self) -> ZoneInfo:
        return ZoneInfo(self.city.timezone)

    def _today(self) -> date:
        return city_today(self.clock(), self.city.timezone)

    def _own(self, trip_id: str, user_id: str) -> TripRow:
        trip = self.store.get_trip(trip_id)
        if trip is None or trip.owner_id != user_id:  # 남의 여행은 없는 것과 같다 (§11 Q3)
            raise ApiError(404, "NOT_FOUND", "없는 여행이에요", {"resource": "trip", "trip_id": trip_id})
        return trip

    def owns_day(self, day_id: str, user_id: str) -> bool:
        return self.store.day_owner(day_id) == user_id

    def _view(self, trip: TripRow) -> Trip:
        today = trip.demo_today or self._today()
        days: list[TripDay] = []
        for number, day_id in enumerate(trip.day_ids):
            chosen = self.planning.chosen_option(day_id)
            day = trip.start_date + timedelta(days=number)
            events = self.store.fixed_for_day(day_id)
            record = self.planning.get_day(day_id)
            option = self.planning.get_option(chosen) if chosen else None
            days.append(
                TripDay(
                    day_id=day_id,
                    date=day,
                    state=day_state(day, today, chosen is not None),
                    chosen_option_id=chosen,
                    fixed_events=[_fixed_view(f) for f in events],
                    summary=_brief(option_view(option, record)) if option and record else None,
                    must_visits=[DayMust(place_id=pid, name=record.places[pid].name) for pid in record.plan.must_visit] if record else [],
                )
            )
        return Trip(
            trip_id=trip.trip_id,
            city_code=trip.city_code,
            start_date=trip.start_date,
            end_date=trip.end_date,
            lodging_place_id=trip.lodging_place_id,
            status=trip.status,
            is_demo=trip.is_demo,
            trip_days=days,
        )

    # ---- B1·B2 ----

    def create(self, user_id: str, body: TripCreate) -> Trip:
        rules = _rules()
        if body.city_code != CITY_CODE:
            raise invalid("city_code", "지금은 오사카만 만들 수 있어요")
        days = (body.end_date - body.start_date).days + 1
        if days < 1 or days > rules["max_days"]:
            raise invalid("end_date", f"여행은 1일에서 {rules['max_days']}일까지 만들 수 있어요")
        today = self._today()
        if not today <= body.start_date <= today + timedelta(days=rules["max_start_ahead"]):
            raise invalid("start_date", f"시작일은 오늘부터 {rules['max_start_ahead']}일 뒤까지 고를 수 있어요")

        places, sources = self.city.places_now(self.clock())
        per_day: dict[date, list[str]] = {}
        placed_on: dict[str, date] = {}
        for visit in body.must_visits:
            if not body.start_date <= visit.date <= body.end_date:
                raise invalid("must_visits", "꼭 갈 곳의 날짜가 여행 기간 밖이에요")
            if visit.place_id not in places:
                raise invalid("must_visits", "이 도시에 없는 장소예요")
            if placed_on.setdefault(visit.place_id, visit.date) != visit.date:
                raise invalid("must_visits", "같은 장소는 한 날에만 꼭 갈 곳으로 담을 수 있어요")  # §11 D1
            ids = per_day.setdefault(visit.date, [])
            if visit.place_id not in ids:
                ids.append(visit.place_id)
            if len(ids) > rules["max_must_per_day"]:
                raise invalid("must_visits", f"꼭 갈 곳은 하루 {rules['max_must_per_day']}곳까지 고를 수 있어요")

        with self._lock:
            lodging = self.city.lodging_location(body.lodging_place_id, self.clock()) if body.lodging_place_id else None
            start_point = lodging or self.city.center()
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
            trip = TripRow(trip_id, user_id, body.city_code, body.start_date, body.end_date, body.lodging_place_id, day_ids)
            self.store.add_trip(trip)  # 이전 여행은 지우지 않고 archived (B2). 요청 하나 = 트랜잭션 하나라 중간에 실패하면 모두 되돌아간다 (A3)
            self.planning.save_trip(trip_id, day_ids)
            return self._view(trip)

    def attach_demo(
        self, user_id: str, trip_id: str, day_ids: list[str], dates: list[date], demo_today: date, as_current: bool = False
    ) -> None:
        """데모 시드 여행을 이 사용자 소유로 둔다 (§11 Q2, is_demo). 지금 여행은 바꾸지 않는다: 데모는 active + is_demo (§12 3).
        as_current(개발 점검 전용, 승현 11-09)일 때만 그 사용자의 지금 여행으로 붙이고 이전 여행은 B2처럼 archived."""
        with self._lock:
            row = TripRow(
                trip_id, user_id, CITY_CODE, dates[0], dates[-1], None, day_ids,
                is_demo=True, demo_current=as_current, demo_today=demo_today,
            )
            self.store.add_trip(row, archive_active=as_current)

    def current(self, user_id: str) -> Trip:
        with self._lock:
            active = self.store.active_trip(user_id)
            if active is None:
                raise ApiError(404, "NOT_FOUND", "여행이 없어요", {"resource": "trip"})
            return self._view(active)

    def get(self, trip_id: str, user_id: str) -> Trip:
        with self._lock:
            return self._view(self._own(trip_id, user_id))

    # ---- B3 고정 일정 ----

    def _plan_fixed(self, day_id: str) -> list[PlanFixed]:
        tz = self._tz()
        record = self.planning.get_day(day_id)
        assert record is not None
        fixed: list[PlanFixed] = []
        for f in self.store.fixed_for_day(day_id):
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

    def add_fixed(self, trip_id: str, user_id: str, body: FixedEventCreate) -> FixedEvent:
        with self._lock:
            trip = self._own(trip_id, user_id)
            if body.trip_day_id not in trip.day_ids:
                raise ApiError(404, "NOT_FOUND", "없는 날이에요", {"resource": "day", "day_id": body.trip_day_id})
            if self.planning.chosen_option(body.trip_day_id) is not None:
                raise ApiError(409, "PLAN_EXISTS", "계획을 이미 골랐어요. 계획을 다시 짜야 해요", {"day_id": body.trip_day_id})
            title = body.title.strip()
            if not 1 <= len(title) <= _rules()["title_max"]:
                raise invalid("title", f"제목은 1자에서 {_rules()['title_max']}자까지 쓸 수 있어요")
            tz = self._tz()
            day = trip.start_date + timedelta(days=trip.day_ids.index(body.trip_day_id))
            for name, moment in (("start_at", body.start_at), ("end_at", body.end_at)):
                if moment.tzinfo is None:
                    raise invalid(name, "시각에 시간대(+09:00 등)가 있어야 해요")  # API-001 §1: ISO 8601 시간대 포함
            start_at, end_at = body.start_at, body.end_at
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
            for other in self.store.fixed_for_day(body.trip_day_id):
                if start_at < other.end_at and other.start_at < end_at:
                    raise invalid("start_at", "같은 날 다른 일정과 시간이 겹쳐요")  # 맞닿는 것은 겹침이 아니다
            made = FixedRow(str(uuid.uuid4()), trip_id, body.trip_day_id, title, start_at, end_at, body.place_id)
            self.store.add_fixed(made)
            self._sync_plan(body.trip_day_id)
            return _fixed_view(made)

    def delete_fixed(self, fixed_event_id: str, user_id: str) -> None:
        with self._lock:
            found = self.store.get_fixed(fixed_event_id)
            if found is None:
                raise ApiError(404, "NOT_FOUND", "없는 고정 일정이에요", {"resource": "fixed_event", "fixed_event_id": fixed_event_id})
            self._own(found.trip_id, user_id)
            if self.planning.chosen_option(found.trip_day_id) is not None:
                raise ApiError(409, "PLAN_EXISTS", "계획을 이미 골랐어요. 계획을 다시 짜야 해요", {"day_id": found.trip_day_id})
            self.store.delete_fixed(fixed_event_id)
            self._sync_plan(found.trip_day_id)

    # ---- 고른 코스 읽기 (§12 답 3) ----

    def course(self, day_id: str, user_id: str) -> CourseResultOption:
        """그날 고른 코스. 고르지 않은 날·다른 사용자의 날·없는 날은 모두 404. 지난 날도 읽힌다."""
        with self._lock:
            option_id = self.planning.chosen_option(day_id)
            option = self.planning.get_option(option_id) if option_id else None
            record = self.planning.get_day(day_id)
            if not self.owns_day(day_id, user_id) or option is None or record is None:
                raise ApiError(404, "NOT_FOUND", "고른 코스가 없어요", {"resource": "course", "day_id": day_id})
            return option_view(option, record)

    # ---- §11 H3 Google 영업시간을 부르는 때 ----

    def refresh_hours(self, kind: Literal["planning", "now", "alternatives"], day_id: str, place_id: str | None = None) -> None:
        """실제 여행의 날이면 필요한 장소의 Google 영업시간을 부르고(메모리 1시간·동시 2초·상한), 그날 데이터에 반영한다.

        planning: 계획 세션 시작 - 그날 후보 전부. now: 여행 중 화면 - 오늘 코스·고정 일정 장소. alternatives: 닫힘 대안 - 닫힌 곳 1.5km 안 후보.
        늦거나 실패한 곳은 LiveHours·facts의 대체 순서를 따르고, 계획·대안 찾기는 멈추지 않는다. 데모 여행(is_demo)은 실제 여행이 아니라 부르지 않는다."""
        with self._lock:
            record = self.planning.get_day(day_id)
            trip = self.store.trip_of_day(day_id)
            if record is None or trip is None or trip.is_demo:
                return
            ids = self._hour_targets(kind, day_id, record, place_id)
            now = self.clock()
            if kind == "planning":
                self.city.refresh(now)  # 오래된 좌표(30일)도 이때 한 번에 100곳까지
            self.city.live.fetch([self.city.row(pid)["place_id"] for pid in ids if self.city.row(pid)], now=now, cap=CAPS[kind])  # type: ignore[index]
            places, sources = self.city.places_now(now)
            self.planning.save_day(day_id, record.plan, places, record.day_number, lodging_known=record.lodging_known, sources=sources)

    def _hour_targets(self, kind: str, day_id: str, record: Any, place_id: str | None) -> list[str]:
        if kind == "planning":
            return list(record.places)
        if kind == "now":
            option_id = self.planning.chosen_option(day_id)
            option = self.planning.get_option(option_id) if option_id else None
            course = [item.place_id for item in option.course.items if item.place_id] if option else []
            fixed = [f.place_id for f in record.plan.fixed if f.place_id]
            return list(dict.fromkeys([*course, *fixed]))
        closed = record.places.get(place_id) if place_id else None
        if closed is None:
            return []
        radius = visit_limits().radius_m
        near = sorted((p for p in record.places.values() if p.id != closed.id and meters(closed, p) <= radius), key=lambda p: (meters(closed, p), p.id))
        return [p.id for p in near]

    # ---- B4 ----

    def search(self, q: str) -> list[PlaceHit]:
        return [
            PlaceHit(
                id=row["id"],
                name=row["name_ko"],
                category=row["category"],
                area=row["area"],
                facts=[PlaceFact(**fact) for fact in self.city.facts(row, self.clock())],
                image=PlaceImage(category=row["category"]),
            )
            for row in self.city.search(q)
        ]


def _fixed_view(f: FixedRow) -> FixedEvent:
    return FixedEvent(fixed_event_id=f.fixed_event_id, trip_day_id=f.trip_day_id, title=f.title, start_at=f.start_at, end_at=f.end_at, place_id=f.place_id)
