"""여행 중 화면 `NowView` 만들기 (TASK-006 §A). 순수 함수: 같은 (하루, 코스, 시각, 위치) -> 같은 결과.

흐름: 시각과 고른 코스로 `Snapshot`을 만들고 -> `compose_screen`(TASK-001, 그대로)이 카드를 고르고 -> 여기서 카드 값을 채운다.
위치는 지도 선(route)의 경계 점과 `position`에만 쓰고 판단에는 쓰지 않는다 (A2). 아무것도 저장하지 않는다.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, time
from typing import Literal

from engine.compose import REASONS, FixedEvent, PlanItem, Screen, Snapshot, compose_screen
from engine.models import CourseOption, Place
from planning.presenter import _opening_fact, day_summary
from planning.repo import DayRecord
from planning.schemas import Fact, LatLng
from trip.schemas import (
    NowCard,
    NowCardT01,
    NowCardT02,
    NowCardT03,
    NowCardT07,
    NowCardT08,
    NowCourseItem,
    NowFixed,
    NowPin,
    NowRoute,
    NowView,
)

log = logging.getLogger(__name__)

SUPPORTED = ("T-01", "T-02", "T-03", "T-07", "T-08")  # A3: 이번에 만드는 카드
STATUS_TEXT = {"on_track": "동선대로 가는 중", "delayed": "늦어지는 중", "free": "다음까지 여유 있음"}
DAY_OVER_REASON = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # §12 R1
EMPTY_COURSE_REASON = "오늘 코스가 비어 있어"  # §11 Q13
T01_PAIRS = ("T-02", "T-03")  # SCREEN-001 §5 짝 표: T-01의 보조


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _time(minutes: int) -> time:
    """Snapshot 시각. 같은 날짜 안 24시 넘는 일정은 다음 TASK (§12 R11)라 23:59로 자른다."""
    clamped = max(0, min(minutes, 23 * 60 + 59))
    return time(clamped // 60, clamped % 60)


@dataclass(frozen=True)
class _Entry:
    seq: int
    place: Place | None
    name: str  # 장소 이름, 장소가 없는 고정 일정이면 저장된 title
    title: str  # 고정 일정이면 저장된 title (R4), 아니면 name
    start: str
    end: str
    start_min: int
    end_min: int
    travel_min: int
    is_fixed: bool

    @property
    def leave_min(self) -> int:
        """출발 시각 = 시작 - 이동 분 (§11 Q3)."""
        return self.start_min - self.travel_min


def _entries(day: DayRecord, course: CourseOption) -> list[_Entry]:
    fixed = day.plan.fixed
    by_slot = {(f.place_id, f.start, f.end): f.title for f in fixed if f.place_id}
    untitled = iter(f.title for f in sorted((f for f in fixed if f.place_id is None), key=lambda f: (f.start, f.end)))
    entries = []
    for item in course.items:
        place = day.places[item.place_id] if item.place_id else None
        if place is None:
            name = title = next(untitled)  # planning.presenter.course_response와 같은 짝짓기
        else:
            name = place.name
            title = by_slot.get((place.id, item.start, item.end), name)
        entries.append(
            _Entry(item.seq, place, name, title, item.start, item.end, _minutes(item.start), _minutes(item.end), item.travel_min, item.is_fixed)
        )
    return entries


def _facts(place: Place | None, weekday: int) -> list[Fact]:
    return [_opening_fact(place, weekday)] if place else []  # 장소가 없으면 [] (Q6)


def _view(entry: _Entry, weekday: int) -> NowCourseItem:
    place = entry.place
    return NowCourseItem(
        seq=entry.seq,
        place_id=place.id if place else None,
        name=entry.name,
        start=entry.start,
        end=entry.end,
        lat=place.lat if place else None,
        lng=place.lng if place else None,
        is_fixed=entry.is_fixed,
        facts=_facts(place, weekday),
    )


def _plan_item(entry: _Entry) -> PlanItem:
    # 영업 확인은 TASK-007(T-05)이라 확인한 것으로 둔다 (Q25)
    return PlanItem(name=entry.name, start=_time(entry.start_min), end=_time(entry.end_min), travel_min=entry.travel_min, hours_checked=True)


@dataclass(frozen=True)
class _Moment:
    """at 시점의 일정 상태."""

    now_min: int
    current: _Entry | None
    following: _Entry | None
    upcoming_fixed: _Entry | None
    remaining: int
    traveling: bool  # 다음 일정 출발 시각이 지나 이동 중 (§12 R2)
    between: bool  # 일정 사이: 이동 중이거나 쉬는 시간


def _moment(entries: list[_Entry], now_min: int) -> _Moment:
    current = next((e for e in entries if e.start_min <= now_min < e.end_min), None)
    following = next((e for e in entries if e.start_min > now_min), None)
    upcoming_fixed = next((e for e in entries if e.is_fixed and e.start_min > now_min), None)  # Q4: 시작 전까지만
    remaining = sum(1 for e in entries if e.end_min > now_min)  # Q26: 지금 일정 포함
    after_leave = current is None and following is not None and now_min >= following.leave_min
    after_some = any(e.end_min <= now_min for e in entries)
    between = current is None and following is not None and (after_leave or after_some)
    return _Moment(now_min, current, following, upcoming_fixed, remaining, after_leave, between)


def _snapshot(m: _Moment) -> Snapshot:
    """A2: 이번에 안 만드는 카드로 가는 신호는 중립값 (+ Q25).

    moving: 일정 사이(쉬는 시간 포함)면 True. 쉬는 시간도 메인이 T-02여야 해서(R2) compose의 "이동 중" 입구를 이렇게 쓴다.
    # TASK-006 미정: R2는 쉬는 시간의 Snapshot.moving 값을 정하지 않았다 (결과 T-02만 정함)
    """
    fixed = m.upcoming_fixed
    return Snapshot(
        now=_time(m.now_min),
        current_item=_plan_item(m.current) if m.current else None,
        next_item=_plan_item(m.following) if m.following else None,
        fixed_event=FixedEvent(name=fixed.name, leave_by=_time(fixed.leave_min)) if fixed else None,
        open_events=[],
        meal_eaten=True,
        rain_prob_2h=0,
        walked_km=0,
        outdoor_remaining=False,
        chat_pick=None,
        offline=False,
        safety=False,
        arriving=False,
        remaining_items=m.remaining,
        moving=m.between,
    )


def _map_url(entry: _Entry) -> str | None:
    """구글 지도 길찾기 URL (대중교통). 장소가 없으면 None (Q6). 경로 API는 부르지 않는다 (§9)."""
    if entry.place is None:
        return None
    return f"https://www.google.com/maps/dir/?api=1&destination={entry.place.lat},{entry.place.lng}&travelmode=transit"


def _card(kind: str, m: _Moment, entries: list[_Entry], course: CourseOption, day: DayRecord, weekday: int) -> NowCard | None:
    """카드 값 채우기 (A4). 지금 이 카드를 만들 수 없으면 None."""
    if kind == "T-01":
        entry = m.current or m.following  # 하루 시작 전 미리보기는 1번 (ends_in_min=null)
        if entry is None:
            return None
        ends_in = entry.end_min - m.now_min if m.current else None
        return NowCardT01(item=_view(entry, weekday), ends_in_min=ends_in)
    if kind == "T-02":
        nxt = m.following
        if nxt is None:
            return None
        return NowCardT02(
            next_item=_view(nxt, weekday),
            leave_at=_hhmm(nxt.leave_min),
            leave_in_min=max(0, nxt.leave_min - m.now_min),  # 이동 중 0 (Q10), 쉬는 시간은 남은 분 (R2)
            travel_min=nxt.travel_min,
            map_url=_map_url(nxt),
        )
    if kind == "T-03":
        later = [e for e in entries if e.start_min > m.now_min]  # 지금 일정 제외
        return NowCardT03(items=[_view(e, weekday) for e in later])
    if kind == "T-07":
        fixed = m.upcoming_fixed
        if fixed is None:
            return None
        return NowCardT07(
            fixed=NowFixed(name=fixed.name, title=fixed.title, start=fixed.start, end=fixed.end, facts=_facts(fixed.place, weekday)),
            leave_by=_hhmm(fixed.leave_min),
            leave_in_min=max(0, fixed.leave_min - m.now_min),  # Q4: 출발 시각이 지나도 시작 전이면 0
        )
    if kind == "T-08":
        lat, lng = day.plan.lodging
        return NowCardT08(go_home_min=course.go_home_min, lodging=LatLng(lat=lat, lng=lng))
    return None


def _subs(kinds: list[str], m: _Moment, entries: list[_Entry], course: CourseOption, day: DayRecord, weekday: int) -> list[NowCard]:
    cards: list[NowCard] = []
    for kind in kinds:
        if kind not in SUPPORTED:
            continue
        card = _card(kind, m, entries, course, day, weekday)
        if card is None or (isinstance(card, NowCardT03) and not card.items):
            continue  # Q5·R11: 다음 일정이 없어 보조가 없으면 T-02도 빈 T-03도 뺀다
        cards.append(card)
    return cards


def _pins(entries: list[_Entry], m: _Moment) -> list[NowPin]:
    pins = []
    for e in entries:
        if e.place is None:
            continue  # Q6: 장소 없는 고정 일정은 핀에서 뺀다
        if e.end_min <= m.now_min:
            state: Literal["done", "now", "next", "later"] = "done"
        elif m.current is e:
            state = "now"
        elif m.following is e:
            state = "next"
        else:
            state = "later"
        pins.append(
            NowPin(seq=e.seq, place_id=e.place.id, name=e.name, lat=e.place.lat, lng=e.place.lng, start=e.start, end=e.end, travel_min=e.travel_min, state=state)
        )
    return pins


def _route(entries: list[_Entry], m: _Moment, home: tuple[float, float], position: tuple[float, float] | None) -> NowRoute:
    """숙소 -> 1 -> 2 … -> 숙소. 지난 길 끝 = 남은 길 시작 (Q11). 위치는 이동 중일 때만 경계 점 (R2·R3)."""
    placed = [e for e in entries if e.place is not None]
    passed = [e for e in placed if e.end_min <= m.now_min or e is m.current]
    rest = [e for e in placed if e not in passed]
    done = [home, *[(e.place.lat, e.place.lng) for e in passed if e.place]]
    boundary = done[-1]
    if m.traveling and m.following is not None and position is not None:
        boundary = position
        done.append(boundary)
    remaining = [boundary, *[(e.place.lat, e.place.lng) for e in rest if e.place], home]
    return NowRoute(done=done, remaining=remaining)


def build_now_view(
    day_id: str,
    day: DayRecord,
    course: CourseOption,
    at: datetime,
    position: tuple[float, float] | None,
    stay_overrides: dict[str, int] | None = None,
) -> NowView:
    """at는 시간대 없는 그날의 시각. 날짜 검사는 부르는 쪽 몫."""
    summary = day_summary(day_id, day, stay_overrides)
    weekday = day.plan.date.weekday()
    home = (day.plan.lodging[0], day.plan.lodging[1])
    now_min = at.hour * 60 + at.minute
    entries = _entries(day, course)
    m = _moment(entries, now_min)
    screen = compose_screen(_snapshot(m))

    main_kind, subs_kinds, reason = _decide(screen, m, entries)
    main = _card(main_kind, m, entries, course, day, weekday)
    if main is None:  # 만들 수 없는 카드는 T-01로 (A3와 같은 안전장치)
        main_kind, subs_kinds, reason = _replace_with_t01(main_kind, screen)
        main = _card("T-01", m, entries, course, day, weekday)
    assert main is not None  # 코스가 비지 않았고 하루가 끝나지 않았다면 지금 일정이나 다음 일정이 있다
    return NowView(
        day=summary,
        at=at.isoformat(),
        status=screen.move_status,
        status_text=STATUS_TEXT[screen.move_status],
        reason=reason,
        main=main,
        subs=_subs(subs_kinds, m, entries, course, day, weekday),
        pins=_pins(entries, m),
        route=_route(entries, m, home, position),
        position=LatLng(lat=position[0], lng=position[1]) if position else None,
    )


def _replace_with_t01(kind: str, screen: Screen) -> tuple[str, list[str], str]:
    """A3: 지원 목록 밖 카드는 T-01로, 보조는 짝 표대로, 칩은 null(항상), 이유는 T-01 기본 문장 (Q24)."""
    log.warning("지원 밖 카드 %s가 나와 T-01로 바꿨어 (A3)", kind)
    return "T-01", list(T01_PAIRS), REASONS["T-01"]


def _decide(screen: Screen, m: _Moment, entries: list[_Entry]) -> tuple[str, list[str], str]:
    """compose 결과 -> (메인, 보조, 이유). A3 대체와 하루가 끝난 뒤 T-08(Q1·R1·Q13)을 NowView 층에서 처리한다."""
    kind, subs, reason = screen.main, list(screen.subs), screen.reason
    if kind not in SUPPORTED:
        kind, subs, reason = _replace_with_t01(kind, screen)
    day_over = m.current is None and m.following is None
    if not entries:
        return "T-08", [], EMPTY_COURSE_REASON  # Q13: 빈 코스를 고른 날
    if day_over and kind == "T-01":
        return "T-08", [], DAY_OVER_REASON  # Q1: 마지막 일정이 끝나면 시각과 무관하게 T-08 (compose는 18시 전이면 T-01)
    return kind, subs, reason
