"""개발용 데모 여행 (TASK-003 §5 `POST /debug/seed-demo`, §10 Q26). 정식 `POST /trips`는 별도 TASK."""

import json
import uuid
from datetime import date, timedelta
from pathlib import Path

from engine.models import CourseOption, DayPlan, Place, PlanFixed
from planning.repo import PlanningRepo
from planning.schemas import SeedDay, SeedResult
from trip.days import day_state
from trip.visit import closed_candidates

DEMO_PATH = Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json"
EXTRA_PATH = Path(__file__).parent / "fixtures" / "demo_extra.json"  # 시드 전용 장소 1곳 (TASK-008 §12 Q18). demo_city.json은 바꾸지 않는다
DEMO_CENTER = (35.0, 135.0)  # 가상 도시 중심점 (TASK-002 §2). 숙소 = 중심점
DEMO_DATES = [date(2026, 12, 1), date(2026, 12, 2), date(2026, 12, 3)]  # §10 Q26: 고정
DAY_START, DAY_END = "10:00", "20:00"  # §10 Q26


def demo_places() -> dict[str, Place]:
    rows = json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]
    return {row["id"]: Place.model_validate(row) for row in rows}


DINNER_TITLE, DINNER_START, DINNER_END = "저녁 예약", "18:30", "19:30"  # TASK-006 §11 Q14


def _dinner(places: dict[str, Place], day: date) -> PlanFixed:
    """TASK-006 §11 Q14: 데모 식당 = 그 시간 내내 여는 food 장소 중 id가 가장 작은 곳 (문서에 고르는 규칙이 없어 정함)."""
    weekday = day.weekday()

    def open_all(p: Place) -> bool:
        return any(o.weekday == weekday and o.open <= DINNER_START and o.close >= DINNER_END for o in p.hours or [])

    restaurant = min((p for p in places.values() if p.category == "food" and open_all(p)), key=lambda p: p.id)
    return PlanFixed(
        id="F1",
        title=DINNER_TITLE,
        start=DINNER_START,
        end=DINNER_END,
        place_id=restaurant.id,
        lat=restaurant.lat,
        lng=restaurant.lng,
    )


def seed_demo(repo: PlanningRepo, *, with_dinner: bool = False, past_days: int | None = None) -> SeedResult:
    """demo_city 3일. 둘째 날 꼭 갈 곳 1곳 = 그날 여는 곳 중 id가 가장 작은 곳 (§10 Q26).

    with_dinner(TASK-006 A5): 둘째 날에만 고정 일정 "저녁 예약" 1개를 넣는다.
    past_days(TASK-010 PM 답 1): 데모 시계 = 첫날 + N일. 날 상태는 기존 day_state 규칙 그대로 (응답 trip_days). None이면 trip_days를 싣지 않는다 (예전 응답 모양 그대로)."""
    demo_today = DEMO_DATES[0] + timedelta(days=past_days or 0)
    places = demo_places()
    day_ids: list[str] = []
    days: list[SeedDay] = []
    for number, day in enumerate(DEMO_DATES, start=1):
        must: list[str] = []
        fixed: list[PlanFixed] = []
        if number == 2:
            weekday = day.weekday()
            if with_dinner:
                fixed = [_dinner(places, day)]
            must = [min(p.id for p in places.values() if any(o.weekday == weekday for o in p.hours or []))]
        plan = DayPlan(
            date=day,
            start=DAY_START,
            end=DAY_END,
            lodging=DEMO_CENTER,
            fixed=fixed,
            must_visit=must,
            stay_overrides={},
        )
        day_id = str(uuid.uuid4())
        repo.save_day(day_id, plan, places, number)
        day_ids.append(day_id)
        days.append(SeedDay(day_id=day_id, date=day, state=day_state(day, demo_today, with_dinner and number == 2)))
    trip_id = str(uuid.uuid4())
    repo.save_trip(trip_id, day_ids)
    if past_days is None:
        return SeedResult(trip_id=trip_id, day_ids=day_ids)  # trip_days는 unset (응답에 키가 없다)
    return SeedResult(trip_id=trip_id, day_ids=day_ids, trip_days=days)


def demo_extra_places() -> dict[str, Place]:
    rows = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))["places"]
    return {row["id"]: Place.model_validate(row) for row in rows}


SCENARIO_SEQS = range(2, 6)  # TASK-008 §11 Q18: chosen 코스의 2~5번


def _scenario_place(places: dict[str, Place], course: CourseOption, weekday: int) -> str | None:
    """코스 2~5번 중 B2 대안이 1곳 이상 있는 첫 장소 (TASK-008 §11 Q18)."""
    in_course = {item.place_id for item in course.items if item.place_id}
    for item in course.items:
        if item.place_id and item.seq in SCENARIO_SEQS:
            start = int(item.start[:2]) * 60 + int(item.start[3:])
            if closed_candidates(places[item.place_id], places, in_course, weekday, start):
                return item.place_id
    return None


def prepare_demo_scenario(repo: PlanningRepo, day_id: str) -> None:
    """chosen 시드의 둘째 날에만 (TASK-008 C4·§11 Q18·§12 Q18). 코스를 고른 뒤에 부르므로 코스는 바뀌지 않는다.

    1. 2~5번 중 B2 대안이 있는 첫 장소를 시나리오 장소로 삼는다.
    2. 30곳으로 그런 장소가 없을 때만 시드 전용 장소 1곳을 이 날에 더한다.
    3. 시나리오 장소가 원래 확인됨이면 이 날 시드에서만 미확인으로 둔다 (출처 demo). 미확인·모름은 데이터 그대로.
    """
    record = repo.get_day(day_id)
    option_id = repo.chosen_option(day_id)
    option = repo.get_option(option_id) if option_id else None
    if record is None or option is None:
        return
    places = dict(record.places)
    weekday = record.plan.date.weekday()
    scenario = _scenario_place(places, option.course, weekday)
    if scenario is None:
        places.update(demo_extra_places())
        scenario = _scenario_place(places, option.course, weekday)
    if scenario is not None and places[scenario].hours_status == "confirmed":
        places[scenario] = places[scenario].model_copy(update={"hours_status": "unverified"})
    repo.save_day(day_id, record.plan, places, record.day_number)
