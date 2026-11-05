"""개발용 데모 여행 (TASK-003 §5 `POST /debug/seed-demo`, §10 Q26). 정식 `POST /trips`는 별도 TASK."""

import json
import uuid
from datetime import date
from pathlib import Path

from engine.models import DayPlan, Place
from planning.repo import PlanningRepo
from planning.schemas import SeedResult

DEMO_PATH = Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json"
DEMO_CENTER = (35.0, 135.0)  # 가상 도시 중심점 (TASK-002 §2). 숙소 = 중심점
DEMO_DATES = [date(2026, 12, 1), date(2026, 12, 2), date(2026, 12, 3)]  # §10 Q26: 고정
DAY_START, DAY_END = "10:00", "20:00"  # §10 Q26


def demo_places() -> dict[str, Place]:
    rows = json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]
    return {row["id"]: Place.model_validate(row) for row in rows}


def seed_demo(repo: PlanningRepo) -> SeedResult:
    """demo_city 3일. 둘째 날 꼭 갈 곳 1곳 = 그날 여는 곳 중 id가 가장 작은 곳 (§10 Q26)."""
    places = demo_places()
    day_ids: list[str] = []
    for number, day in enumerate(DEMO_DATES, start=1):
        must: list[str] = []
        if number == 2:
            weekday = day.weekday()
            must = [min(p.id for p in places.values() if any(o.weekday == weekday for o in p.hours or []))]
        plan = DayPlan(
            date=day,
            start=DAY_START,
            end=DAY_END,
            lodging=DEMO_CENTER,
            fixed=[],
            must_visit=must,
            stay_overrides={},
        )
        day_id = str(uuid.uuid4())
        repo.save_day(day_id, plan, places, number)
        day_ids.append(day_id)
    trip_id = str(uuid.uuid4())
    repo.save_trip(trip_id, day_ids)
    return SeedResult(trip_id=trip_id, day_ids=day_ids)
