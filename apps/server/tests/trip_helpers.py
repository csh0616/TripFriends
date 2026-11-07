"""TASK-007 여행 중 테스트 공용 도우미. 판단 로직 없이 하루를 심고, 요청을 보내고, 결과를 읽기만 한다.

장소는 숙소(35.0, 135.0)에서 북쪽으로 km만큼 떨어져 있다 (planning_helpers.north_of).
"""

from datetime import date
from typing import Any

from planning_api_helpers import week_hours
from planning_helpers import day_plan, north_of, place

from engine.models import CourseItem, CourseOption, Place, PlanFixed, StayRange
from planning.repo import OptionRecord

DAY = date(2026, 12, 2)
OPEN_LATE = week_hours("08:00", "22:00")  # 대안 계산(B-2)이 영업시간 때문에 흔들리지 않게 늦게까지 연다
STAY = StayRange(min=30, typical=60, max=120)

# TASK-006 §A-1 + TASK-007 §B-5 event
NOW_KEYS = {"day", "at", "status", "status_text", "reason", "main", "subs", "chip", "pins", "route", "position", "event"}
EVENT_KEYS = {"event_id", "type", "severity", "delay_min", "state", "proposals"}
PROPOSAL_KEYS = {"proposal_id", "label", "reason", "dropped", "keeps_fixed", "first_leave_at", "items"}
ITEM_KEYS = {"seq", "place_id", "name", "start", "end", "lat", "lng", "is_fixed", "facts"}  # NowCourseItem
T04_KEYS = {"type", "event_id", "delay_min", "proposals", "fixed"}


def to_min(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:5])


def item(seq: int, pid: str | None, start: str, end: str, travel: int, fixed: bool = False) -> CourseItem:
    return CourseItem(
        seq=seq,
        place_id=pid,
        start=start,
        end=end,
        stay_min=to_min(end) - to_min(start),
        stay_source="auto" if pid else None,
        travel_min=travel,
        wait_min=0,
        is_fixed=fixed,
        hours_status="confirmed" if pid else None,
    )


def spot(pid: str, km: float, category: str = "cafe") -> Place:
    return place(pid, category=category, km=km, hours=OPEN_LATE, stay=STAY)


def at_place(km: float, east_km: float = 0.0) -> tuple[float, float]:
    """북쪽 km 지점 (장소 좌표와 같은 식)."""
    return north_of(km, east_km)


def plant(
    env,
    items: list[CourseItem],
    places: dict[str, Place],
    fixed: tuple[PlanFixed, ...] = (),
    must: tuple[str, ...] = (),
    start: str = "10:00",
    end: str = "21:00",
    go_home: int = 25,
) -> str:
    """고른 코스가 있는 하루를 저장소에 바로 심는다 (TASK-006 테스트와 같은 방식)."""
    plan = day_plan(start=start, end=end, fixed=fixed, must=must, day=DAY)
    day_id = env.plant_day(places, plan, day_number=2)
    option = CourseOption(label="relaxed", items=items, dropped=[], go_home_min=go_home, total_travel_min=sum(i.travel_min for i in items))
    env.repo.save_options([OptionRecord(f"opt-{day_id}", "planted-session", [], option)])
    env.repo.choose_option(day_id, f"opt-{day_id}")
    return day_id


def fixed_at(spot_place: Place | None, start: str, end: str, title: str = "체험", fid: str = "F1") -> PlanFixed:
    return PlanFixed(
        id=fid,
        title=title,
        start=start,
        end=end,
        place_id=spot_place.id if spot_place else None,
        lat=spot_place.lat if spot_place else None,
        lng=spot_place.lng if spot_place else None,
    )


# ---------- 심어 두는 하루 ----------

P01 = at_place(1.0)  # 1번 장소 좌표


def plain_day(env) -> str:
    """고정 일정 없음. 1번(P01) 끝 12:00, 2번 시작 12:20·이동 20 → 1번 예정 출발 12:00.
    P01에서 12:10이면 10분(낮음), 12:20이면 20분(높음). 2번 예정 출발 14:00, 3번이 마지막."""
    places = {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0), "P03": spot("P03", 3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    return plant(env, items, places)


def ac05_day(env, must: tuple[str, ...] = ()) -> str:
    """SRS AC-05: 12:40 현재(1번 P01에 있음), 다음 13:00 시작, 이동 35분, 15:30 고정 체험.
    P01 → P02 8.2km는 엔진 식으로도 35분 (10 + ceil(8.2 / 20 × 60)).
    15분 늦으면 2번 13:15~14:15, 3번 14:26~15:26, 체험 도착 15:33 → 고정 일정에 늦음."""
    places = {
        "P01": spot("P01", 1.0),
        "P02": spot("P02", 9.2),
        "P03": spot("P03", 10.0),
        "F04": spot("F04", 10.5, category="experience"),
        "P05": spot("P05", 11.0),
    }
    items = [
        item(1, "P01", "10:12", "12:20", 12),
        item(2, "P02", "13:00", "14:00", 35),
        item(3, "P03", "14:15", "15:15", 11),
        item(4, "F04", "15:30", "16:30", 7, fixed=True),
        item(5, "P05", "16:45", "18:00", 8),
    ]
    return plant(env, items, places, fixed=(fixed_at(places["F04"], "15:30", "16:30"),), must=must)


def fixed_later_day(env) -> str:
    """3번이 고정 일정 14:00(이동 20 → 출발 13:40). P01에서 12:20이면 20분 늦음(높음), 그때 고정 출발까지 80분."""
    places = {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0), "F03": spot("F03", 3.0, category="experience"), "P04": spot("P04", 4.0)}
    items = [
        item(1, "P01", "10:12", "12:00", 12),
        item(2, "P02", "12:20", "13:30", 20),
        item(3, "F03", "14:00", "15:00", 20, fixed=True),
        item(4, "P04", "15:30", "17:00", 30),
    ]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "14:00", "15:00"),))


def infeasible_day(env) -> str:
    """고정 일정 F03이 P01에서 39km(엔진 식 127분). 심은 코스의 이동은 5분이라 고정 출발 15:25.
    13:30에 P01에 있으면 90분 늦음(높음)이고, 무엇을 빼도 15:30에 못 간다 (B-2 Infeasible). 고정 출발까지 115분이라 T-07은 아니다."""
    places = {"P01": spot("P01", 1.0), "P02": spot("P02", 2.0), "F03": spot("F03", 40.0, category="experience")}
    items = [
        item(1, "P01", "10:12", "12:00", 12),
        item(2, "P02", "12:20", "14:00", 20),
        item(3, "F03", "15:30", "16:30", 5, fixed=True),
    ]
    return plant(env, items, places, fixed=(fixed_at(places["F03"], "15:30", "16:30"),))


# ---------- 요청 ----------


def at_time(clock: str) -> str:
    return f"2026-12-02T{clock}:00" if clock.count(":") == 1 else f"2026-12-02T{clock}"


def check(env, day_id: str, clock: str, position: tuple[float, float] | None = None, **extra: Any):
    """B-4: 위치는 본문으로."""
    body: dict[str, Any] = {"at": at_time(clock)}
    if position is not None:
        body["lat"], body["lng"] = position
    body.update(extra)
    return env.client.post(f"/days/{day_id}/check", json=body)


def checked(env, day_id: str, clock: str, position: tuple[float, float] | None = None) -> dict:
    response = check(env, day_id, clock, position)
    assert response.status_code == 200, response.text
    return response.json()


def accept(env, proposal_id: str):
    return env.client.post(f"/proposals/{proposal_id}/accept")


def dismiss(env, event_id: str):
    return env.client.post(f"/events/{event_id}/dismiss")


def get_now(env, day_id: str, clock: str, **params):
    return env.client.get(f"/days/{day_id}/now", params={"at": at_time(clock), **params})


def now(env, day_id: str, clock: str, **params) -> dict:
    response = get_now(env, day_id, clock, **params)
    assert response.status_code == 200, response.text
    return response.json()


# ---------- 읽기 ----------


def chosen(env, day_id: str) -> tuple[str, CourseOption]:
    option_id = env.repo.chosen_option(day_id)
    return option_id, env.repo.get_option(option_id).course


def slots(entries) -> list[tuple]:
    """일정 비교용: (장소, 시작, 끝, 고정). 응답(dict)과 엔진 모델 모두 받는다."""
    out = []
    for e in entries:
        if isinstance(e, dict):
            out.append((e["place_id"], e["start"], e["end"], e["is_fixed"]))
        else:
            out.append((e.place_id, e.start, e.end, e.is_fixed))
    return out


def pin_slots(view: dict) -> list[tuple]:
    return [(p["seq"], p["place_id"], p["start"], p["end"]) for p in view["pins"]]


def types(cards: list[dict]) -> list[str]:
    return [card["type"] for card in cards]


def stores(env) -> dict[str, Any]:
    """app.state에서 snapshot()이 있는 저장소를 모두 모은다 (사건·제안을 어느 저장소에 두든 잡히게)."""
    found = {}
    for name, value in vars(env.app.state)["_state"].items():
        if hasattr(value, "snapshot") and callable(value.snapshot):
            found[name] = value.snapshot()
    return found


def checkpoints_text(env) -> str:
    """app.state의 그래프(체크포인터가 있는 것)마다 저장된 체크포인트 전부를 글자로."""
    parts = []
    for value in vars(env.app.state)["_state"].values():
        saver = getattr(value, "checkpointer", None)
        if saver is None or not hasattr(saver, "list"):
            continue
        for entry in saver.list(None):
            parts.append(repr(entry))
    return "\n".join(parts)
