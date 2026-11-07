"""여행 중 요청 한 건: 검사 -> 감지 -> (필요하면) G2 그래프 재개 -> NowView (TASK-007 §B-4).

오류 순서: 본문 400(FastAPI) -> 없는 날 404 -> 고른 코스 없음 404 -> 하루 밖 날짜 400 (TASK-006 R9).
위치는 `check` 한 번 안에서만 쓰고 저장하지 않는다. 그래프에는 감지 결과만 들어간다 (AC-9).
"""

import threading
import uuid
from datetime import datetime
from typing import Any

from langgraph.types import Command

from graphs.trip import Outbox, Outcome, Request, build_trip_graph, can_handle, new_state
from engine.models import CourseOption
from planning.repo import DayRecord, PlanningRepo
from planning.service import PlanningError
from trip.alternatives import delay_course
from trip.detect import DelayFinding, detect_delay, is_stale
from trip.now import build_now_view, event_view
from trip.repo import EventRecord, TripRepo
from trip.schemas import NowEvent, NowView


def _internal() -> PlanningError:
    return PlanningError("INTERNAL_ERROR", "서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요", None)


class TripService:
    def __init__(self, trip: TripRepo, planning: PlanningRepo, graph: Any | None = None):
        self.trip = trip
        self.planning = planning
        self.graph = graph if graph is not None else build_trip_graph(trip, planning)
        self._lock = threading.RLock()
        # 그날 마지막 check의 at (§11 Q7). 시각 하나일 뿐 위치가 아니고 사건 데이터도 아니라 저장소 밖에 둔다
        self._last_check: dict[str, datetime] = {}

    # ---- 도우미 ----

    def load(self, day_id: str, when: datetime) -> tuple[DayRecord, CourseOption, dict[str, int]]:
        day = self.planning.get_day(day_id)
        if day is None:
            raise PlanningError("NOT_FOUND", "없는 날이에요", {"resource": "day", "day_id": day_id})
        option_id = self.planning.chosen_option(day_id)
        option = self.planning.get_option(option_id) if option_id else None
        if option is None:
            raise PlanningError("NOT_FOUND", "고른 코스가 없어요", {"resource": "course", "day_id": day_id})
        if when.date() != day.plan.date:
            raise PlanningError("INVALID_REQUEST", "at이 그날이 아니에요", None)
        return day, option.course, self.planning.stay_overrides(option.session_id)

    def _event_view(self, day: DayRecord, record: EventRecord | None) -> NowEvent | None:
        return event_view(record, self.trip.current_proposals(record.event_id), day) if record else None

    def now(self, day_id: str, when: datetime) -> NowView:
        """GET /now: 읽기뿐. 위치는 받지 않는다. 열린 사건이 있으면 싣는다."""
        with self._lock:
            day, course, overrides = self.load(day_id, when)
            return build_now_view(day_id, day, course, when, None, overrides, self._event_view(day, self.trip.open_event(day_id)))

    def _builder(self, day_id: str, day: DayRecord, course: CourseOption, when: datetime, position, overrides):
        def build(event: NowEvent | None, new_course: CourseOption | None) -> NowView:
            return build_now_view(day_id, day, new_course or course, when, position, overrides, event)

        return build

    def _invoke(self, thread: str, payload: Any, request: Request) -> Outcome:
        box = Outbox(request)
        self.graph.invoke(payload, {"configurable": {"thread_id": thread, "outbox": box}})
        assert box.outcome is not None
        return box.outcome

    # ---- check ----

    def check(self, day_id: str, when: datetime, position: tuple[float, float] | None) -> NowView:
        with self._lock:
            day, course, overrides = self.load(day_id, when)
            build = self._builder(day_id, day, course, when, position, overrides)
            previous = self._last_check.get(day_id)
            finding = detect_delay(delay_course(day_id, day, course), when, position)
            current = self.trip.open_event(day_id)
            if finding is None:  # 위치 없음·이동 중·문턱 아래: 열린 사건 그대로
                view = build(self._event_view(day, current), None)
            else:
                view = self._with_finding(day_id, day, course, when, finding, current, build, previous)
            self._last_check[day_id] = when  # 성공한 check만 (앞 시각으로 돌아가도 그 at)
            return view

    def _with_finding(self, day_id, day, course, when, finding: DelayFinding, current, build, previous) -> NowView:
        request = Request(day_id, day, course, when, build, finding=finding, last_check_at=previous)
        same = self.trip.event_by_key(day_id, finding.dedupe_key)
        if same is not None:
            outcome = self._invoke(same.event_id, Command(resume={"kind": "check"}), request)
            return self._response(outcome)
        event_id = str(uuid.uuid4())
        request.closes = current.event_id if current else None
        outcome = self._invoke(event_id, new_state(event_id, day_id, finding), request)
        if outcome.kind != "ok":
            self.graph.checkpointer.delete_thread(event_id)  # 사건을 만들지 않았으니 스레드도 지운다
        response = self._response(outcome)
        if current:  # 옛 사건은 이미 저장소에서 닫혔다. 그래프 상태를 맞춘다
            self._invoke(current.event_id, Command(resume={"kind": "close"}), request)
        return response

    @staticmethod
    def _response(outcome: Outcome) -> NowView:
        if outcome.kind == "error":
            raise _internal()
        assert outcome.response is not None
        return outcome.response

    # ---- accept·dismiss ----

    def _decide_request(self, record: EventRecord, proposal_id: str | None) -> Request:
        day_id = record.day_id
        when = self._last_check.get(day_id, record.at)
        day, course, overrides = self.load(day_id, when)
        return Request(day_id, day, course, when, self._builder(day_id, day, course, when, None, overrides), proposal_id=proposal_id)

    def accept(self, proposal_id: str) -> NowView:
        with self._lock:
            proposal = self.trip.get_proposal(proposal_id)
            if proposal is None:
                raise PlanningError("NOT_FOUND", "없는 제안이에요", {"resource": "proposal", "proposal_id": proposal_id})
            record = self.trip.get_event(proposal.event_id)
            assert record is not None
            if not can_handle(record.state, "accept"):
                raise PlanningError("STATE_CONFLICT", f"지금 상태({record.state})에서는 고를 수 없어요", {"state": record.state})
            if proposal.superseded or is_stale(proposal.created_at, proposal.base_delay_min, record.delay_min, self._last_check.get(record.day_id)):
                raise PlanningError("STATE_CONFLICT", "제안이 오래됐어요", {"reason": "stale"})
            request = self._decide_request(record, proposal_id)
            return self._response(self._invoke(record.event_id, Command(resume={"kind": "accept"}), request))

    def dismiss(self, event_id: str) -> NowView:
        with self._lock:
            record = self.trip.get_event(event_id)
            if record is None:
                raise PlanningError("NOT_FOUND", "없는 사건이에요", {"resource": "event", "event_id": event_id})
            if not can_handle(record.state, "dismiss"):
                raise PlanningError("STATE_CONFLICT", f"지금 상태({record.state})에서는 할 수 없어요", {"state": record.state})
            request = self._decide_request(record, None)
            return self._response(self._invoke(event_id, Command(resume={"kind": "dismiss"}), request))
