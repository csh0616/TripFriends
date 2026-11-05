"""TASK-003 API 테스트 공용 도우미. 판단 로직 없이 요청을 보내고 결과를 읽기만 한다."""

import json
from datetime import datetime, time
from pathlib import Path
from types import SimpleNamespace

from planning_helpers import day_plan, place

from engine.models import DayPlan, Opening, Place, StayRange

DEMO_PATH = Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json"

# TASK-003 §6 방향 이름표
LABELS = {
    "quieter": "좀 더 한적한 데",
    "closer": "숙소랑 가까운 데",
    "cheaper": "좀 더 저렴한 데",
    "different": "완전 다른 느낌",
    "photo": "사진 예쁜 데",
    "indoor": "실내로",
    "food": "먹을 데",
    "night": "밤에 갈 데",
}
# TASK-003 §4-1 칩 대응표
CHIP_CATEGORIES = {
    "골목 산책": {"walk"},
    "맛집 투어": {"food"},
    "쇼핑": {"shop"},
    "야경": {"night"},
    "카페": {"cafe"},
    "전시·체험": {"museum", "experience"},
}
# TASK-003 §6 message 대본
MSG_FIRST = "이런 곳들 어때? 마음에 들면 담아 줘"
MSG_NO_DIRECTION = "다른 곳들도 찾아봤어"
MSG_CLARIFY = "이 중에 있어?"
MSG_EXHAUSTED = "더 보여 줄 곳이 거의 없어. 이제 코스 짜 볼까?"
QUESTION_TAIL = " 어떤 하루면 좋겠어? 끌리는 거 다 골라 줘!"
QUESTION_TEXT = "둘째 날은" + QUESTION_TAIL
# TASK-003 §10 Q4: 칩 ID와 보내는 순서
CHOICES = [
    {"id": "walk_alley", "label": "골목 산책"},
    {"id": "food_tour", "label": "맛집 투어"},
    {"id": "shopping", "label": "쇼핑"},
    {"id": "night_view", "label": "야경"},
    {"id": "cafe", "label": "카페"},
    {"id": "museum_experience", "label": "전시·체험"},
]
# TASK-003 §10 Q24: 오류 code는 이 4개뿐
ERROR_CODES = {404: "NOT_FOUND", 400: "INVALID_REQUEST", 409: "STATE_CONFLICT", 422: "COURSE_INFEASIBLE"}
WHY_NONE = "이런 곳도 있어요"
UNKNOWN_TEXT = "그냥 아무거나"  # POC-001 §5-1 키워드가 하나도 없는 문장
FIXED_STAY = StayRange(min=60, typical=60, max=60)  # 두 안에서 머문 시간이 같아지는 장소

SESSION_KEYS = {"session_id", "stage", "question"}
QUESTION_KEYS = {"text", "choices", "allow_text", "allow_auto"}
BATCH_KEYS = {
    "session_id",
    "stage",
    "round",
    "message",
    "candidates",
    "directions",
    "clarify",
    "picks_count",
    "exhausted",
    "direction_relaxed",
}
PLACE_KEYS = {"id", "name", "category", "lat", "lng", "crowd_level", "price_level", "mood_tags", "facts"}
FACT_KEYS = {"field", "value", "status", "source_type", "checked_at"}
PICKS_KEYS = {"picks", "picks_count"}
COURSE_KEYS = {"session_id", "stage", "options"}
OPTION_KEYS = {"option_id", "label", "items", "dropped", "go_home_min", "total_travel_min"}
ITEM_KEYS = {
    "seq",
    "place_id",
    "start",
    "end",
    "stay_min",
    "stay_source",
    "travel_min",
    "wait_min",
    "is_fixed",
    "hours_status",
}


def week_hours(open_at: str = "08:00", close_at: str = "18:00") -> list[Opening]:
    return [Opening(weekday=w, open=open_at, close=close_at) for w in range(7)]


def cafes(count: int, start: int = 1, **kw) -> list[Place]:
    """크기만 정한 평범한 장소들. 모두 매일 열고 머문 시간이 60분으로 고정."""
    kw.setdefault("hours", week_hours())
    kw.setdefault("stay", FIXED_STAY)
    return [place(f"P{i:02d}", **kw) for i in range(start, start + count)]


def as_dict(items: list[Place]) -> dict[str, Place]:
    return {p.id: p for p in items}


def demo_places() -> dict[str, Place]:
    raw = json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]
    return {p["id"]: Place(**p) for p in raw}


DIRECTION_GROUPS = {
    "quieter": {"crowd": 1},
    "closer": {"km": 0.5},
    "cheaper": {"price": 1},
    "photo": {"tags": ("사진",)},
    "indoor": {"tags": ("실내",)},
    "food": {"category": "food"},
    "night": {"tags": ("밤",)},
    "different": {"tags": ("새로움",)},
}


def direction_city() -> tuple[dict[str, Place], dict[str, set[str]]]:
    """P01~P06은 어떤 방향에도 안 맞는다 (첫 묶음). 그 뒤 방향마다 그 방향에만 맞는 6곳씩."""
    base = dict(km=2.0, crowd=3, price=3, hours=week_hours("10:00", "18:00"), stay=FIXED_STAY)
    items = [place(f"P{i:02d}", tags=("기본",), **base) for i in range(1, 7)]
    groups: dict[str, set[str]] = {}
    number = 7
    for direction, change in DIRECTION_GROUPS.items():
        kw = {**base, "tags": ("평범",), **change}
        members = [place(f"P{i:02d}", **kw) for i in range(number, number + 6)]
        groups[direction] = {p.id for p in members}
        items += members
        number += 6
    return as_dict(items), groups


class PlanningEnv:
    def __init__(self, client, app):
        self.client = client
        self.app = app
        self.day_count = 0

    @property
    def repo(self):
        return self.app.state.planning_repo

    @property
    def graph(self):
        return self.app.state.planning_graph

    def plant_day(self, places: dict[str, Place], plan: DayPlan | None = None, day_number: int = 1) -> str:
        self.day_count += 1
        day_id = f"day-{self.day_count}"
        self.repo.save_day(day_id, plan or day_plan(), places, day_number)
        return day_id

    def seed(self) -> dict:
        response = self.client.post("/debug/seed-demo")
        assert response.status_code == 201, response.text
        return response.json()

    def start(self, day_id: str, mode: str = "conversation"):
        return self.client.post(f"/days/{day_id}/planning", json={"mode": mode})

    def values(self, session_id: str) -> dict:
        """그래프 상태. 스레드 ID = 세션 ID (TASK-003 §3)."""
        return self.graph.get_state({"configurable": {"thread_id": session_id}}).values

    def stage(self, session_id: str) -> str:
        return self.values(session_id)["stage"]

    def session(self, day_id: str) -> dict:
        response = self.start(day_id)
        assert response.status_code == 201, response.text
        return response.json()

    def answer(self, session: dict, labels=(), text=None):
        by_label = {c["label"]: c["id"] for c in session["question"]["choices"]}
        body = {"choice_ids": [by_label[label] for label in labels]}
        if text is not None:
            body["text"] = text
        return self.client.post(f"/planning/{session['session_id']}/answer", json=body)

    def browse(self, day_id: str, labels=(), text=None) -> tuple[str, dict]:
        session = self.session(day_id)
        response = self.answer(session, labels, text)
        assert response.status_code == 200, response.text
        return session["session_id"], response.json()

    def react(self, sid: str, place_id: str, action: str = "like"):
        return self.client.post(f"/planning/{sid}/reactions", json={"place_id": place_id, "action": action})

    def next(self, sid: str, **body):
        return self.client.post(f"/planning/{sid}/next", json=body)

    def compose(self, sid: str):
        return self.client.post(f"/planning/{sid}/compose")

    def adjust(self, sid: str, option_id: str, place_id: str, delta: int):
        body = {"option_id": option_id, "place_id": place_id, "delta": delta}
        return self.client.post(f"/planning/{sid}/adjust", json=body)

    def back(self, sid: str):
        return self.client.post(f"/planning/{sid}/back")

    def select(self, option_id: str):
        return self.client.post(f"/course-options/{option_id}/select")

    def composing(self, day_id: str, likes: tuple[str, ...] = ()) -> tuple[str, dict]:
        sid, _ = self.browse(day_id)
        for place_id in likes:
            assert self.react(sid, place_id).status_code == 200
        response = self.compose(sid)
        assert response.status_code == 200, response.text
        return sid, response.json()


def ids(batch: dict) -> list[str]:
    return [c["place"]["id"] for c in batch["candidates"]]


def candidate(batch: dict, place_id: str) -> dict:
    return next(c for c in batch["candidates"] if c["place"]["id"] == place_id)


def opening_fact(place_json: dict) -> dict:
    return next(f for f in place_json["facts"] if f["field"] == "opening_hours")


def at_of(plan: DayPlan) -> datetime:
    hour, minute = plan.start.split(":")
    return datetime.combine(plan.date, time(int(hour), int(minute)))


def without_option_id(course: dict) -> list[dict]:
    return [{k: v for k, v in option.items() if k != "option_id"} for option in course["options"]]


def dumped(options) -> list[dict]:
    return [option.model_dump(mode="json") for option in options]


def course_place_ids(option: dict) -> set[str]:
    return {i["place_id"] for i in option["items"]} | {d["place_id"] for d in option["dropped"]}


def assert_error(response, status: int, code: str | None = None) -> dict:
    """공통 오류 모양 `{"error": {"code", "message", "detail"}}` (TASK-003 §5). code 값은 §10 Q24."""
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "detail"}
    assert body["error"]["code"] == (code or ERROR_CODES[status])
    assert type(body["error"]["message"]) is str and body["error"]["message"]
    return body["error"]


def assert_direction_choices(entries: list[dict]) -> None:
    for entry in entries:
        assert set(entry) == {"id", "label"}
        assert entry["label"] == LABELS[entry["id"]]


def assert_place_shape(data: dict) -> None:
    assert set(data) == PLACE_KEYS
    assert type(data["id"]) is str
    assert type(data["name"]) is str
    assert data["category"] in {"cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"}
    assert type(data["lat"]) is float
    assert type(data["lng"]) is float
    assert type(data["crowd_level"]) is int
    assert type(data["price_level"]) is int
    assert type(data["mood_tags"]) is list and all(type(t) is str for t in data["mood_tags"])
    assert type(data["facts"]) is list and data["facts"]
    for fact in data["facts"]:
        assert set(fact) == FACT_KEYS
        assert type(fact["field"]) is str
        assert fact["value"] is None or type(fact["value"]) is str
        assert fact["status"] in {"confirmed", "unverified", "unknown"}  # facts에 상태 필수 (AC-17)
        assert type(fact["source_type"]) is str
        assert fact["checked_at"] is None or type(fact["checked_at"]) is str
    opening_fact(data)


def assert_session_shape(data: dict) -> None:
    from planning.schemas import PlanningSession

    assert set(data) == SESSION_KEYS
    assert type(data["session_id"]) is str
    assert data["stage"] == "asking"
    question = data["question"]
    assert set(question) == QUESTION_KEYS
    assert type(question["text"]) is str
    assert question["allow_text"] is True
    assert question["allow_auto"] is True
    assert len(question["choices"]) == 6
    for choice in question["choices"]:
        assert set(choice) == {"id", "label"}
        assert type(choice["id"]) is str and type(choice["label"]) is str
    PlanningSession.model_validate(data)


def assert_batch_shape(data: dict) -> None:
    from planning.schemas import CandidateBatch

    assert set(data) == BATCH_KEYS
    assert type(data["session_id"]) is str
    assert data["stage"] == "browsing"
    assert type(data["round"]) is int
    assert type(data["message"]) is str
    assert type(data["picks_count"]) is int
    assert type(data["exhausted"]) is bool
    assert type(data["direction_relaxed"]) is bool
    assert type(data["candidates"]) is list
    for entry in data["candidates"]:
        assert set(entry) == {"place", "why"}
        assert type(entry["why"]) is str and entry["why"]
        assert_place_shape(entry["place"])
    assert type(data["directions"]) is list
    assert_direction_choices(data["directions"])
    assert data["clarify"] is None or type(data["clarify"]) is list
    assert_direction_choices(data["clarify"] or [])
    CandidateBatch.model_validate(data)


def assert_picks_shape(data: dict) -> None:
    from planning.schemas import Picks

    assert set(data) == PICKS_KEYS
    assert type(data["picks"]) is list and all(type(p) is str for p in data["picks"])
    assert type(data["picks_count"]) is int
    assert data["picks_count"] == len(data["picks"])
    Picks.model_validate(data)


def assert_course_shape(data: dict) -> None:
    from planning.schemas import CourseResult

    assert set(data) == COURSE_KEYS
    assert type(data["session_id"]) is str
    assert data["stage"] == "composing"
    assert type(data["options"]) is list and data["options"]
    for option in data["options"]:
        assert set(option) == OPTION_KEYS
        assert type(option["option_id"]) is str and option["option_id"]
        assert option["label"] in {"relaxed", "packed"}
        assert type(option["go_home_min"]) is int
        assert type(option["total_travel_min"]) is int
        for item in option["items"]:
            assert set(item) == ITEM_KEYS
            assert type(item["seq"]) is int
            assert item["place_id"] is None or type(item["place_id"]) is str
            assert type(item["start"]) is str and type(item["end"]) is str
            assert type(item["stay_min"]) is int
            assert item["stay_source"] in {"auto", "user", None}
            assert type(item["travel_min"]) is int
            assert type(item["wait_min"]) is int
            assert type(item["is_fixed"]) is bool
            assert item["hours_status"] in {"confirmed", "unverified", "unknown", None}
        for dropped_entry in option["dropped"]:
            assert set(dropped_entry) == {"place_id", "reason"}
            assert dropped_entry["reason"] in {"closed_at_time", "no_time", "fixed_conflict"}
    CourseResult.model_validate(data)


def first_option_id(course: dict) -> str:
    return course["options"][0]["option_id"]


def ctx(**kw) -> SimpleNamespace:
    return SimpleNamespace(**kw)
