"""G2 여행 중 늦어짐 그래프 (TASK-007 §B-1, GRAPH-001 §3). R1: 규칙 노드만. LLM·Jev는 부르지 않는다 (AC-10).

스레드 ID = 사건 ID. 체크포인터는 TASK-003과 같은 MemorySaver.

    START -> start --(낮음)--> open_low   (사건 저장, 알약만)
                   \\--(높음)--> awaiting   (대안 계산 -> 제안 저장 -> interrupt)
    open_low --check(높아짐)--> awaiting | --check--> open_low | --close--> resolved
    awaiting --check--> awaiting | --accept / dismiss / close--> resolved
    resolved --check--> resolved (아무것도 안 함)

원칙 (TASK-003 R1·R12 그대로)
- 줄 함수의 순서는 **계산 -> 응답 만들기 -> 저장 -> 상태 갱신**. 응답(NowView)을 만들다 예외가 나면 저장은 한 줄도 하지 않는다.
- 줄 함수에서 예외가 나도 그래프는 같은 interrupt 자리로 돌아와 기다린다 (실패한 이벤트는 버려진다).
- 상태에는 대화 맥락만. 사건·제안은 TripRepo, 위치는 어디에도 없다 (감지는 그래프 밖의 순수 함수이고, 그래프는 감지 결과만 받는다. AC-9).
- 요청 값(감지 결과·화면 만드는 함수)은 `config["configurable"]["outbox"]`로 넘기고 체크포인트에는 남기지 않는다.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel

from engine.models import CourseOption, Infeasible
from engine.planning import compose_courses
from planning.repo import DayRecord, OptionRecord, PlanningRepo
from trip.alternatives import alternative_input, reason_text, shape
from trip.detect import DelayFinding, is_stale
from trip.now import event_view
from trip.repo import EventRecord, ProposalRecord, TripRepo
from trip.schemas import NowEvent, NowView

log = logging.getLogger(__name__)

Stage = Literal["starting", "open_low", "awaiting", "resolved"]
ViewBuilder = Callable[[NowEvent | None, CourseOption | None], NowView]


class TripState(BaseModel):
    """대화 맥락만 (위치·분·제안은 없다)."""

    event_id: str
    day_id: str
    dedupe_key: str
    k: int
    stage: Stage = "starting"


# ---------- 요청이 돌려받는 결과 ----------


@dataclass
class Outcome:
    kind: Literal["ok", "conflict", "error"]
    response: NowView | None = None


@dataclass
class Request:
    """이번 요청 한 건의 값. 그래프 밖에서 만들어 넘기고 체크포인트에는 남기지 않는다."""

    day_id: str
    day: DayRecord
    course: CourseOption
    when: datetime
    build_view: ViewBuilder
    finding: DelayFinding | None = None
    proposal_id: str | None = None
    closes: str | None = None  # 새 사건이 시작되면서 닫을 옛 사건 (§11 Q12)
    last_check_at: datetime | None = None  # 이번 check 직전의 마지막 check 시각


@dataclass
class Outbox:
    request: Request
    outcome: Outcome | None = None
    done: list[str] = field(default_factory=list)


@dataclass
class _Run:
    trip: TripRepo
    planning: PlanningRepo
    box: Outbox

    @property
    def req(self) -> Request:
        return self.box.request

    def finish(self, response: NowView | None) -> None:
        self.box.outcome = Outcome("ok", response)


# ---------- 대안 계산 (B-2) ----------


def _make_proposals(run: _Run, event_id: str, finding: DelayFinding) -> list[ProposalRecord]:
    """높음 사건의 제안. Infeasible이면 []. 예외는 그대로 올라가 줄을 실패시킨다 (§6)."""
    req = run.req
    spec = alternative_input(req.day, req.course, finding.k, req.when)
    if isinstance(spec, Infeasible):
        return []
    result = compose_courses(spec.plan, spec.picks, req.day.places)
    if isinstance(result, Infeasible):
        return []
    records = []
    for option in result:
        shaped = shape(req.day, req.course, option, spec, req.when)
        names = [req.day.places[pid].name for pid in shaped.dropped]
        records.append(
            ProposalRecord(
                proposal_id=str(uuid.uuid4()),
                event_id=event_id,
                label=option.label,
                reason=reason_text(names, spec.fixed_title),
                dropped=shaped.dropped,
                keeps_fixed=shaped.keeps_fixed,
                first_leave_at=shaped.first_leave_at,
                course=shaped.course,
                from_index=shaped.from_index,
                created_at=req.when,
                base_delay_min=finding.delay_min,
            )
        )
    return records


def _view(run: _Run, record: EventRecord, proposals: list[ProposalRecord], course: CourseOption | None = None) -> NowView:
    return run.req.build_view(event_view(record, proposals, run.req.day), course)


# ---------- 전이표 한 줄 한 줄 ----------
# 반환: 새 stage (None = 그대로). 순서: 계산 -> 응답 -> 저장.


def _row_start(run: _Run, state: TripState) -> Stage:
    """(없음) × check: 낮음이면 open_low, 높음이면 대안 계산 후 awaiting."""
    finding = run.req.finding
    assert finding is not None
    high = finding.severity == "high"
    proposals = _make_proposals(run, state.event_id, finding) if high else []
    record = EventRecord(
        state.event_id, state.day_id, finding.dedupe_key, finding.k, finding.severity, finding.delay_min,
        "awaiting" if high else "open_low", run.req.when,
    )
    response = _view(run, record, proposals)
    old = run.trip.get_event(run.req.closes) if run.req.closes else None
    if old:  # 저장 (§11 Q12): 옛 사건은 사용자 선택 없이 닫는다
        run.trip.put_event(replace(old, state="resolved"))
    run.trip.put_event(record)
    run.trip.put_proposals(record.event_id, proposals)
    run.finish(response)
    return record.state  # type: ignore[return-value]


def _row_check_low(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """open_low × check: 같은 키. 여전히 낮으면 증거만, 높음으로 바뀌면 대안 계산 -> awaiting."""
    finding = run.req.finding
    assert finding is not None
    record = run.trip.get_event(state.event_id)
    assert record is not None
    if finding.severity == "high":
        proposals = _make_proposals(run, state.event_id, finding)
        new = replace(record, severity="high", delay_min=finding.delay_min, state="awaiting", at=run.req.when)
        response = _view(run, new, proposals)
        run.trip.put_event(new)
        run.trip.put_proposals(new.event_id, proposals)
        run.finish(response)
        return "awaiting"
    new = replace(record, delay_min=finding.delay_min, at=run.req.when)
    response = _view(run, new, [])
    run.trip.put_event(new)
    run.finish(response)
    return "open_low"


def _row_check_awaiting(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """awaiting × check: 증거만 갱신, 제안은 그대로 (AC-10).

    예외: 지금까지 모은 증거로 이미 오래된 제안이면(B-4) 한 번 새로 계산한다. 사건은 그대로고 새로 알리지 않는다.
    """
    finding = run.req.finding
    assert finding is not None
    record = run.trip.get_event(state.event_id)
    assert record is not None
    current = run.trip.current_proposals(state.event_id)
    new = replace(record, delay_min=finding.delay_min, at=run.req.when)
    if current and is_stale(current[0].created_at, current[0].base_delay_min, record.delay_min, run.req.last_check_at):
        fresh = _make_proposals(run, state.event_id, finding)
        response = _view(run, new, fresh)
        run.trip.put_event(new)
        run.trip.put_proposals(state.event_id, fresh)
    else:
        response = _view(run, new, current)
        run.trip.put_event(new)
    run.finish(response)
    return "awaiting"


def _row_accept(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """awaiting × accept: 제안을 그날의 새 코스안으로. 옛 안은 그대로 남는다 (B-3)."""
    record = run.trip.get_event(state.event_id)
    proposal = run.trip.get_proposal(run.req.proposal_id or "")
    assert record is not None and proposal is not None
    chosen_id = run.planning.chosen_option(state.day_id)
    old_option = run.planning.get_option(chosen_id) if chosen_id else None
    assert old_option is not None
    new_option = OptionRecord(str(uuid.uuid4()), old_option.session_id, old_option.picks, proposal.course)
    done = replace(record, state="resolved", user_choice="accepted")
    response = _view(run, done, run.trip.current_proposals(state.event_id), proposal.course)
    run.planning.save_options([new_option])
    run.planning.choose_option(state.day_id, new_option.option_id)
    run.trip.put_event(done)
    run.finish(response)
    return "resolved"


def _row_dismiss(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """awaiting × dismiss: 일정 그대로."""
    record = run.trip.get_event(state.event_id)
    assert record is not None
    done = replace(record, state="resolved", user_choice="dismissed")
    response = _view(run, done, run.trip.current_proposals(state.event_id))
    run.trip.put_event(done)
    run.finish(response)
    return "resolved"


def _row_resolved_check(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """resolved × check: 같은 사건은 다시 알리지 않는다. 아무것도 저장하지 않는다."""
    run.finish(run.req.build_view(None, None))
    return "resolved"


def _row_close(run: _Run, state: TripState, _event: dict[str, Any]) -> Stage:
    """open_low·awaiting × close (§11 Q12): 다른 장소의 새 사건이 생겨 사용자 선택 없이 닫는다.
    저장은 새 사건의 start 줄이 이미 했다. 여기서는 그래프 상태만 맞춘다."""
    run.finish(None)
    return "resolved"


_Row = Callable[[_Run, TripState, dict[str, Any]], Stage]

# B-1 전이표 (시작 줄은 `start` 노드)
TRANSITIONS: dict[tuple[str, str], _Row] = {
    ("open_low", "check"): _row_check_low,
    ("awaiting", "check"): _row_check_awaiting,
    ("awaiting", "accept"): _row_accept,
    ("awaiting", "dismiss"): _row_dismiss,
    ("resolved", "check"): _row_resolved_check,
    ("open_low", "close"): _row_close,
    ("awaiting", "close"): _row_close,
}


def can_handle(stage: str, kind: str) -> bool:
    """표에 없는 조합이면 False (409)."""
    return (stage, kind) in TRANSITIONS


# ---------- 노드 ----------

_Next = Literal["open_low", "awaiting", "resolved", "__end__"]


def new_state(event_id: str, day_id: str, finding: DelayFinding) -> dict[str, Any]:
    return TripState(event_id=event_id, day_id=day_id, dedupe_key=finding.dedupe_key, k=finding.k).model_dump()


def build_trip_graph(trip: TripRepo, planning: PlanningRepo):
    def run_of(config: RunnableConfig) -> _Run:
        return _Run(trip, planning, config["configurable"]["outbox"])

    def start(state: TripState, config: RunnableConfig) -> Command[_Next]:
        run = run_of(config)
        try:
            stage = _row_start(run, state)
        except Exception:
            log.exception("늦어짐 사건 시작 중 예외")  # 위치는 이 함수에 오지 않는다
            run.box.outcome = Outcome("error")
            return Command(goto=END)  # 사건을 만들지 않는다 (API가 스레드를 지우고 500)
        return Command(goto=stage, update=state.model_copy(update={"stage": stage}).model_dump())

    def wait_node(stage: str) -> Callable[[TripState, RunnableConfig], Command[_Next]]:
        def wait(state: TripState, config: RunnableConfig) -> Command[_Next]:
            event = interrupt({"waiting_for": stage})
            run = run_of(config)
            # TASK-003 §10-10 R1: interrupt() 뒤 예외를 그대로 내보내면 다음 요청 때 옛 resume 값으로 다시 돈다.
            # 그래서 잡아서 task를 정상 종료시키고 같은 자리에서 다시 기다린다.
            try:
                row = TRANSITIONS.get((stage, event["kind"]))
                if row is None:
                    run.box.outcome = Outcome("conflict")
                    return Command(goto=stage)
                new_stage = row(run, state, event)
            except Exception:
                log.exception("늦어짐 그래프 줄 처리 중 예외")
                run.box.outcome = Outcome("error")
                return Command(goto=stage)
            return Command(goto=new_stage, update=state.model_copy(update={"stage": new_stage}).model_dump())

        wait.__name__ = f"wait_{stage}"
        return wait

    builder = StateGraph(TripState)
    builder.add_node("start", start, destinations=("open_low", "awaiting", END))
    builder.add_node("open_low", wait_node("open_low"), destinations=("open_low", "awaiting", "resolved"))
    builder.add_node("awaiting", wait_node("awaiting"), destinations=("awaiting", "resolved"))
    builder.add_node("resolved", wait_node("resolved"), destinations=("resolved",))
    builder.add_edge(START, "start")
    return builder.compile(checkpointer=MemorySaver())
