"""여행 중 화면 `NowView` 만들기 (TASK-006 §A). 순수 함수: 같은 (하루, 코스, 시각, 위치) -> 같은 결과.

흐름: 시각과 고른 코스로 `Snapshot`을 만들고 -> `compose_screen`(TASK-001, 그대로)이 카드를 고르고 -> 여기서 카드 값을 채운다.
위치는 지도 선(route)의 경계 점과 `position`에만 쓰고 판단에는 쓰지 않는다 (A2). 아무것도 저장하지 않는다.
"""

import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, time
from typing import Literal

from engine.compose import REASONS, FixedEvent, OpenEvent, PlanItem, Screen, Snapshot, compose_screen
from engine.models import CourseOption, Place
from planning.presenter import _opening_fact, day_summary
from planning.repo import DayRecord
from places.pack import maps_url
from planning.schemas import Fact, LatLng
from trip.schemas import (
    NowCard,
    NowCardT01,
    NowCardT02,
    NowCardT03,
    NowCardT04,
    NowCardT05,
    NowCardT06,
    NowCardT07,
    NowCardT08,
    NowCourseItem,
    NowDropped,
    NowClosedInfo,
    NowEvent,
    NowFixed,
    NowPin,
    NowPlaceRef,
    NowProposal,
    NowRoute,
    NowT04Fixed,
    NowT06Proposal,
    NowView,
)
from trip.repo import EventRecord, ProposalRecord
from trip.visit import VisitCheckRecord, in_check_window, map_search_url, needs_check, user_confirmed_fact

log = logging.getLogger(__name__)

SUPPORTED = ("T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08")  # A3: 이번에 만드는 카드 (T-04: TASK-007, T-05·T-06: TASK-008)
STATUS_TEXT = {"on_track": "동선대로 가는 중", "delayed": "늦어지는 중", "free": "다음까지 여유 있음"}
DAY_OVER_REASON = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # §12 R1, TASK-007 F2
DAY_OVER_PILL = "오늘 일정 끝"  # TASK-007 F1


def delayed_text(delay_min: int) -> str:
    return f"{delay_min}분 늦어지는 중"  # TASK-007 B-5
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
    source: str = "demo"  # 영업시간 fact의 source_type (TASK-010 Q1: 실제 여행은 장소의 실제 출처, 데모는 demo)

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
            _Entry(
                item.seq, place, name, title, item.start, item.end, _minutes(item.start), _minutes(item.end), item.travel_min, item.is_fixed,
                (day.sources or {}).get(place.id, "demo") if place else "demo",
            )
        )
    return entries


Checks = Mapping[str, VisitCheckRecord]  # 그날 사용자 확인 기록 (장소 id -> 기록)


def _facts(place: Place | None, weekday: int, checks: Checks | None = None, source: str = "demo") -> list[Fact]:
    """장소가 없으면 [] (Q6). 그날 사용자가 확인했으면 그 확인이 이긴다 (TASK-008 A5·§7). 원본 장소 데이터는 그대로."""
    if place is None:
        return []
    fact = _opening_fact(place, weekday, source)
    check = (checks or {}).get(place.id)
    return [user_confirmed_fact(fact, check) if check else fact]


def _view(entry: _Entry, weekday: int, checks: Checks | None = None) -> NowCourseItem:
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
        facts=_facts(place, weekday, checks, entry.source),
    )


def _plan_item(entry: _Entry, hours_checked: bool = True) -> PlanItem:
    # 영업 확인(T-05)이 필요한 경우만 False (TASK-008 A2: TASK-006 Q25 중립값을 이 경우만 해제)
    return PlanItem(name=entry.name, start=_time(entry.start_min), end=_time(entry.end_min), travel_min=entry.travel_min, hours_checked=hours_checked)


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


def _snapshot(m: _Moment, delayed: bool = False, closed: bool = False, to_check: "_Entry | None" = None) -> Snapshot:
    """A2: 이번에 안 만드는 카드로 가는 신호는 중립값 (+ Q25).

    moving: 일정 사이(쉬는 시간 포함)면 True. 쉬는 시간도 메인이 T-02여야 해서(R2) compose의 "이동 중" 입구를 이렇게 쓴다.
    # TASK-006 미정: R2는 쉬는 시간의 Snapshot.moving 값을 정하지 않았다 (결과 T-02만 정함)
    """
    fixed = m.upcoming_fixed
    return Snapshot(
        now=_time(m.now_min),
        current_item=_plan_item(m.current) if m.current else None,
        next_item=_plan_item(m.following, hours_checked=m.following is not to_check) if m.following else None,
        fixed_event=FixedEvent(name=fixed.name, leave_by=_time(fixed.leave_min)) if fixed else None,
        open_events=([OpenEvent(kind="delay")] if delayed else []) + ([OpenEvent(kind="closed")] if closed else []),  # B-5: awaiting 사건만 (open_low는 알약만)
        meal_eaten=True,
        rain_prob_2h=0,
        walked_km=0,
        outdoor_remaining=False,
        chat_pick=None,
        offline=False,
        safety=False,
        arriving=to_check is not None,
        remaining_items=m.remaining,
        moving=m.between,
    )


def check_target(entries: list[_Entry], m: _Moment, weekday: int, checks: Checks) -> _Entry | None:
    """A1·A2·A6: 다음 일정 장소가 영업 확인 대상이고 확인 시간 안이면 그 일정, 아니면 None."""
    nxt = m.following
    if nxt is None or nxt.place is None or nxt.is_fixed:
        return None  # §14: 고정 일정 장소는 사용자가 예약한 곳 (영업 확인은 예약처 몫)
    status = _opening_fact(nxt.place, weekday).status
    if not needs_check(status, nxt.place.id in checks):
        return None
    return nxt if in_check_window(nxt.leave_min, nxt.start_min, m.now_min) else None


def visit_check_target(day: DayRecord, course: CourseOption, at: datetime, checks: Checks) -> str | None:
    """at에 영업 확인을 받을 수 있는 장소 id (없으면 None). visit-check 요청이 "지금 물을 대상인가"를 같은 규칙으로 본다."""
    entries = _entries(day, course)
    target = check_target(entries, _moment(entries, at.hour * 60 + at.minute), day.plan.date.weekday(), checks)
    return target.place.id if target and target.place else None


MapId = Callable[[str], "str | None"]  # 우리 장소 id -> 구글 place_id (실제 여행만. 데모 장소는 None -> 좌표)


def _map_url(entry: _Entry, map_id: MapId | None = None) -> str | None:
    """구글 지도 길찾기 URL (대중교통). 장소가 없으면 None (Q6). 경로 API는 부르지 않는다 (§9).
    구글 place_id가 있으면 destination_place_id로 넣는다 (TASK-010 PM 답 3, §11 H5)."""
    if entry.place is None:
        return None
    return _transit_url(entry.place.lat, entry.place.lng, map_id(entry.place.id) if map_id else None)


def _transit_url(lat: float, lng: float, place_id: str | None = None) -> str:
    """도착지 좌표 -> 구글 지도 대중교통 길찾기 URL (T-02·T-08 공용)."""
    link = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
    if place_id:
        link += f"&destination_place_id={place_id}"
    return f"{link}&travelmode=transit"


def _card(
    kind: str,
    m: _Moment,
    entries: list[_Entry],
    course: CourseOption,
    day: DayRecord,
    weekday: int,
    event: NowEvent | None = None,
    checks: Checks | None = None,
    to_check: _Entry | None = None,
    map_id: MapId | None = None,
) -> NowCard | None:
    """카드 값 채우기 (A4). 지금 이 카드를 만들 수 없으면 None. event = 이 카드의 사건 (T-04: 늦어짐, T-06: 닫힘)."""
    checks = checks or {}
    if kind == "T-01":
        entry = m.current or m.following  # 하루 시작 전 미리보기는 1번 (ends_in_min=null)
        if entry is None:
            return None
        ends_in = entry.end_min - m.now_min if m.current else None
        return NowCardT01(item=_view(entry, weekday, checks), ends_in_min=ends_in)
    if kind == "T-02":
        nxt = m.following
        if nxt is None:
            return None
        return NowCardT02(
            next_item=_view(nxt, weekday, checks),
            leave_at=_hhmm(nxt.leave_min),
            leave_in_min=max(0, nxt.leave_min - m.now_min),  # 이동 중 0 (Q10), 쉬는 시간은 남은 분 (R2)
            travel_min=nxt.travel_min,
            map_url=_map_url(nxt, map_id),
        )
    if kind == "T-03":
        later = [e for e in entries if e.start_min > m.now_min]  # 지금 일정 제외
        return NowCardT03(items=[_view(e, weekday, checks) for e in later])
    if kind == "T-04":
        if event is None:
            return None
        upcoming = m.upcoming_fixed
        return NowCardT04(
            event_id=event.event_id,
            delay_min=event.delay_min,
            proposals=event.proposals,
            fixed=NowT04Fixed(title=upcoming.title, start=upcoming.start) if upcoming else None,
        )
    if kind == "T-05":
        target = to_check
        if target is None or target.place is None:
            return None
        place = target.place
        return NowCardT05(
            place=NowPlaceRef(place_id=place.id, name=place.name),
            facts=_facts(place, weekday, checks, target.source),
            map_url=maps_url(gid) if map_id and (gid := map_id(place.id)) else map_search_url(place.lat, place.lng),
        )
    if kind == "T-06":
        if event is None or event.type != "closed":
            return None
        closed_id = event.closed_place_id
        if closed_id is None:
            return None
        return NowCardT06(
            event_id=event.event_id,
            closed=NowPlaceRef(place_id=closed_id, name=day.places[closed_id].name),
            proposals=[p for p in event.proposals if isinstance(p, NowT06Proposal)],
        )
    if kind == "T-07":
        fixed = m.upcoming_fixed
        if fixed is None:
            return None
        return NowCardT07(
            fixed=NowFixed(name=fixed.name, title=fixed.title, start=fixed.start, end=fixed.end, facts=_facts(fixed.place, weekday, checks, fixed.source)),
            leave_by=_hhmm(fixed.leave_min),
            leave_in_min=max(0, fixed.leave_min - m.now_min),  # Q4: 출발 시각이 지나도 시작 전이면 0
        )
    if kind == "T-08":
        lat, lng = day.plan.lodging
        return NowCardT08(go_home_min=course.go_home_min, lodging=LatLng(lat=lat, lng=lng), map_url=_transit_url(lat, lng))
    return None


def _subs(
    kinds: list[str],
    m: _Moment,
    entries: list[_Entry],
    course: CourseOption,
    day: DayRecord,
    weekday: int,
    checks: Checks | None = None,
    to_check: _Entry | None = None,
    map_id: MapId | None = None,
) -> list[NowCard]:
    cards: list[NowCard] = []
    for kind in kinds:
        if kind not in SUPPORTED:
            continue
        card = _card(kind, m, entries, course, day, weekday, None, checks, to_check, map_id)
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


def _shown_event(event: NowEvent | None, others: Sequence[NowEvent]) -> NowEvent | None:
    """화면의 `event` 칸. 방금 처리된(resolved) 사건은 그 응답에 싣는다 (TASK-007 B-5).
    그 밖에는 메인 카드의 사건 우선: 늦어짐 awaiting(T-04, 순위 3) > 닫힘 awaiting(T-06, 순위 4) > 늦어짐 open_low (TASK-008 §7)."""
    if event is not None and event.state == "resolved":
        return event
    pool = [e for e in (event, *others) if e is not None]
    for kind, state in (("delay", "awaiting"), ("closed", "awaiting"), ("delay", "open_low")):
        found = next((e for e in pool if e.type == kind and e.state == state), None)
        if found:
            return found
    return event


def build_now_view(
    day_id: str,
    day: DayRecord,
    course: CourseOption,
    at: datetime,
    position: tuple[float, float] | None,
    stay_overrides: dict[str, int] | None = None,
    event: NowEvent | None = None,
    others: Sequence[NowEvent] = (),
    checks: Checks | None = None,
    map_id: MapId | None = None,
) -> NowView:
    """at는 시간대 없는 그날의 시각. 날짜 검사는 부르는 쪽 몫.

    event = 부르는 쪽이 정한 화면 사건(방금 처리된 사건 등), others = 그 밖에 열려 있는 사건 (종류마다 하나, TASK-008 §7).
    checks = 그날 사용자 영업 확인 기록 (TASK-008 A5)."""
    checks = checks or {}
    summary = day_summary(day_id, day, stay_overrides)
    weekday = day.plan.date.weekday()
    home = (day.plan.lodging[0], day.plan.lodging[1])
    now_min = at.hour * 60 + at.minute
    entries = _entries(day, course)
    m = _moment(entries, now_min)
    events = [e for e in (event, *others) if e is not None]
    delay_event = next((e for e in events if e.type == "delay" and e.state in ("open_low", "awaiting")), None)
    delay_awaiting = next((e for e in events if e.type == "delay" and e.state == "awaiting"), None)
    closed_awaiting = next((e for e in events if e.type == "closed" and e.state == "awaiting"), None)
    to_check = check_target(entries, m, weekday, checks)
    screen = compose_screen(_snapshot(m, delay_awaiting is not None, closed_awaiting is not None, to_check))

    main_kind, subs_kinds, reason = _decide(screen, m, entries)
    card_event = delay_awaiting if main_kind == "T-04" else closed_awaiting
    main = _card(main_kind, m, entries, course, day, weekday, card_event, checks, to_check, map_id)
    if main is None:  # 만들 수 없는 카드는 T-01로 (A3와 같은 안전장치)
        main_kind, subs_kinds, reason = _replace_with_t01(main_kind, screen)
        main = _card("T-01", m, entries, course, day, weekday, None, checks)
    day_over = m.current is None and m.following is None
    if delay_event is not None:
        status, status_text = "delayed", delayed_text(delay_event.delay_min)  # B-5
    elif day_over:
        status, status_text = screen.move_status, DAY_OVER_PILL  # F1
    else:
        status, status_text = screen.move_status, STATUS_TEXT[screen.move_status]
    assert main is not None  # 코스가 비지 않았고 하루가 끝나지 않았다면 지금 일정이나 다음 일정이 있다
    return NowView(
        day=summary,
        at=at.isoformat(),
        status=status,
        status_text=status_text,
        reason=reason,
        main=main,
        subs=_subs(subs_kinds, m, entries, course, day, weekday, checks, to_check, map_id),
        pins=_pins(entries, m),
        route=_route(entries, m, home, position),
        position=LatLng(lat=position[0], lng=position[1]) if position else None,
        event=_shown_event(event, others),
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
    if day_over and kind in ("T-01", "T-08"):
        return "T-08", [], DAY_OVER_REASON  # Q1·F2: 마지막 일정이 끝나면 시각과 무관하게 T-08, 이유는 문장 하나 (compose는 18시 전이면 T-01)
    return kind, subs, reason


def event_view(record: EventRecord, proposals: list[ProposalRecord], day: DayRecord, checks: Checks | None = None) -> NowEvent:
    """저장된 사건·제안 -> 응답. 이름·일정은 코스와 장소 데이터에서만 가져온다 (LLM 없음).

    닫힘 사건의 제안은 TASK-007 제안 + closed (TASK-008 §12 Q21). 대안의 사실 칩은 items 안 그 장소 줄의 facts."""
    weekday = day.plan.date.weekday()
    views: list[NowT06Proposal | NowProposal] = []
    for p in proposals:
        entries = _entries(day, p.course)[p.from_index :]
        fields = dict(
            proposal_id=p.proposal_id,
            label=p.label,
            reason=p.reason,
            dropped=[NowDropped(place_id=pid, name=day.places[pid].name) for pid in p.dropped],
            keeps_fixed=p.keeps_fixed,
            first_leave_at=p.first_leave_at,
            items=[_view(e, weekday, checks) for e in entries],
        )
        if p.closed is None:
            views.append(NowProposal(**fields))
            continue
        alternative = p.closed.alternative
        views.append(
            NowT06Proposal(
                **fields,
                closed=NowClosedInfo(
                    alternative=NowPlaceRef(place_id=alternative, name=day.places[alternative].name) if alternative else None,
                    distance_m=p.closed.distance_m,
                    travel_change_min=p.closed.travel_change_min,
                    reordered=p.closed.reordered,
                ),
            )
        )
    view = NowEvent(event_id=record.event_id, type=record.type, severity=record.severity, delay_min=record.delay_min, state=record.state, proposals=views)
    if record.type == "closed":
        view._closed_place_id = record.dedupe_key.removeprefix(f"closed:{record.day_id}:")
    return view
