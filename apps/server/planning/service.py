"""/planning 요청 한 건을 처리한다: 검사 -> 그래프 재개 -> 응답 만들기.

오류 순서 (TASK-003 §10 Q40): 본문 오류 400(FastAPI가 본문을 먼저 검사) -> 없는 세션·코스안 404 -> stage 409 -> 값 오류 400·계산 불가 422.

**실패한 요청은 그래프 상태·저장소를 바꾸지 않는다 (§10 원칙 1).** 그래프에 요청을 넣기 전에 404·409·400을 여기서 모두 가린다
(`can_handle`, `check_event`는 그래프 안의 줄과 같은 함수). 그래서 이 4xx들은 체크포인트도 만들지 않는다. 코스를 못 만드는 422는
그래프 안에서 계산해야 알 수 있는데, 줄 함수가 "계산 -> 성공했을 때만 저장" 순서라 저장소는 그대로이고 상태 갱신도 없다.
"""

import threading
import uuid
from typing import Any

from langgraph.types import Command

from engine.models import Infeasible
from pydantic import BaseModel

from graphs.planning import Outbox, Outcome, PlanningState, build_planning_graph, can_handle, check_event, new_state
from planning.repo import PlanningRepo
from planning.schemas import (
    SeedChosenResult,
    AdjustRequest,
    AnswerRequest,
    CandidateBatch,
    CourseResult,
    NextRequest,
    Picks,
    PlanningDone,
    PlanningSession,
    ReactionRequest,
    SeedResult,
    SelectResult,
)
from planning import presenter
from planning.seed import seed_demo

# §10 Q24, §10-10 R3
STATUS = {"NOT_FOUND": 404, "INVALID_REQUEST": 400, "STATE_CONFLICT": 409, "COURSE_INFEASIBLE": 422, "INTERNAL_ERROR": 500}


class PlanningError(Exception):
    """공통 오류 `{"error": {"code", "message", "detail"}}` (TASK-003 §5)."""

    def __init__(self, code: str, message: str, detail: Any = None):
        super().__init__(message)
        self.code = code
        self.status = STATUS[code]
        self.message = message
        self.detail = detail


def _internal() -> PlanningError:
    """§10-10 R1: 줄 처리 중 예외. 원인은 서버 로그에만 남기고 응답에는 담지 않는다."""
    return PlanningError("INTERNAL_ERROR", "서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요", None)


def _infeasible(result: Infeasible) -> PlanningError:
    return PlanningError("COURSE_INFEASIBLE", "코스를 만들 수 없어요", result.model_dump())  # §5: Infeasible 내용을 detail에


class PlanningService:
    def __init__(self, repo: PlanningRepo, graph: Any | None = None):
        self.repo = repo
        self.graph = graph if graph is not None else build_planning_graph(repo)
        # 같은 세션의 요청이 동시에 들어와도 한 번에 하나씩 처리한다 (체크포인터·저장소가 메모리라 서버 안에서만 막으면 된다)
        self._lock = threading.RLock()

    # ---- 도우미 ----

    def _config(self, session_id: str, box: Outbox | None = None) -> dict[str, Any]:
        configurable: dict[str, Any] = {"thread_id": session_id}
        if box is not None:
            configurable["outbox"] = box
        return {"configurable": configurable}

    def _state(self, session_id: str) -> PlanningState:
        """없는 세션이면 404."""
        if self.repo.session_day(session_id) is None:
            raise PlanningError("NOT_FOUND", "없는 세션이에요", {"resource": "session", "session_id": session_id})  # TASK-004 §12-1 A7
        values = self.graph.get_state(self._config(session_id)).values
        return PlanningState(**values)

    def _resume(self, state: PlanningState, event: dict[str, Any]) -> BaseModel:
        """stage 409 -> 값 오류 400을 가린 뒤 그래프를 멈춘 자리에서 이어 가고, 줄 함수가 **이미 만들어 둔** 응답을 돌려준다.

        응답은 그래프 안에서 새 상태와 함께 계산된다 (TASK-003 §10-11 R12). 여기서는 값을 다시 계산하지 않는다.
        """
        if not can_handle(state.stage, event["kind"]):
            raise PlanningError("STATE_CONFLICT", f"지금 단계({state.stage})에서는 할 수 없어요", {"stage": state.stage})
        problem = check_event(self.repo, state, event)
        if problem:
            raise PlanningError("INVALID_REQUEST", problem, None)
        box = Outbox()
        self.graph.invoke(Command(resume=event), self._config(state.session_id, box))
        return self._response(box.outcome)

    @staticmethod
    def _response(outcome: Outcome | None) -> BaseModel:
        assert outcome is not None
        if outcome.kind == "error":
            raise _internal()  # 그래프가 실패한 이벤트를 버리고 같은 자리에서 기다리는 중이다 (graphs/planning.py)
        if outcome.kind == "infeasible":
            assert outcome.infeasible is not None
            raise _infeasible(outcome.infeasible)
        assert outcome.response is not None
        return outcome.response

    # ---- 엔드포인트 ----

    def seed(self, chosen: bool = False) -> SeedResult | SeedChosenResult:
        """chosen(TASK-006 A5·Q14): 둘째 날을 자동으로 계획하고 relaxed 안을 고른 상태로 둔다 (저녁 예약 포함)."""
        with self._lock:
            result = seed_demo(self.repo, with_dinner=chosen)
            if chosen:
                course = self.start(result.day_ids[1], "auto")
                option = next(o for o in course.options if o.label == "relaxed")  # type: ignore[union-attr]
                self.select(option.option_id)
                record = self.repo.get_day(result.day_ids[1])
                chosen_option = self.repo.get_option(self.repo.chosen_option(result.day_ids[1]))
                assert record is not None and chosen_option is not None
                summary = presenter.day_summary(result.day_ids[1], record, self.repo.stay_overrides(chosen_option.session_id))  # NowView의 day와 같은 함수
                return SeedChosenResult(trip_id=result.trip_id, day_ids=result.day_ids, day=summary)
            return result

    def start(self, day_id: str, mode: str) -> PlanningSession | CourseResult:
        with self._lock:
            day = self.repo.get_day(day_id)
            if day is None:
                raise PlanningError("NOT_FOUND", "없는 날이에요", {"resource": "day", "day_id": day_id})  # TASK-004 §12-1 A7
            session_id = str(uuid.uuid4())
            box = Outbox()
            self.graph.invoke(new_state(session_id, day_id, mode), self._config(session_id, box))  # type: ignore[arg-type]
            outcome = box.outcome
            if outcome is not None and outcome.kind in ("error", "infeasible"):
                # §10 Q2·§10-10 R1: 시작에서 코스를 못 만들거나 예외가 나면 세션을 만들지 않는다 (저장소엔 안 썼고, 스레드도 지운다)
                self.graph.checkpointer.delete_thread(session_id)
            return self._response(outcome)  # type: ignore[return-value]

    def current(self, session_id: str) -> PlanningSession | CandidateBatch | CourseResult | PlanningDone:
        """TASK-004 A1: GET. 지금 stage의 응답을 **지금 상태로 다시 계산**해서 준다.

        그래프를 재개하지 않는다(`graph.get_state`는 읽기뿐이라 체크포인트가 늘지 않는다). 저장소도 읽기뿐이다.
        응답은 POST가 쓰는 presenter 함수로 만들어 두 길이 갈라지지 않는다. 예외는 아무것도 바꾸기 전이라
        500 공통 형식이 되고 다음 요청에 영향이 없다 (TASK-003 §10-10 R1, §10-11 R11).
        """
        with self._lock:
            state = self._state(session_id)  # 없으면 404 resource=session
            day = self.repo.get_day(state.day_id)
            if state.stage == "done":
                option_id = self.repo.chosen_option(state.day_id)
                assert option_id is not None  # done은 select가 저장한 뒤에만 된다
                return presenter.done_response(state, option_id)
            assert day is not None  # 세션은 있는 날에만 만든다
            if state.stage == "asking":
                return presenter.session_response(state, day, self.repo.stay_overrides(session_id))
            if state.stage == "browsing":
                return presenter.batch_now(
                    state,
                    self.repo.reactions(session_id),
                    self.repo.batch_relaxed(session_id),
                    self.repo.batch_first(session_id),
                    day,
                    self.repo.stay_overrides(session_id),
                )
            records = [self.repo.get_option(option_id) for option_id in state.option_ids]
            assert all(record is not None for record in records)
            return presenter.course_response(state, records, day, self.repo.stay_overrides(session_id))  # type: ignore[arg-type]

    def answer(self, session_id: str, body: AnswerRequest) -> CandidateBatch | CourseResult:
        with self._lock:
            state = self._state(session_id)
            if body.auto:
                return self._resume(state, {"kind": "auto"})  # type: ignore[return-value]
            event = {"kind": "answer", "choice_ids": body.choice_ids or [], "text": body.text}
            return self._resume(state, event)  # type: ignore[return-value]

    def react(self, session_id: str, body: ReactionRequest) -> Picks:
        with self._lock:
            state = self._state(session_id)
            return self._resume(state, {"kind": "reaction", "place_id": body.place_id, "action": body.action})  # type: ignore[return-value]

    def next(self, session_id: str, body: NextRequest) -> CandidateBatch:
        with self._lock:
            state = self._state(session_id)
            event = {"kind": "next", "direction_id": body.direction_id, "text": body.text}
            return self._resume(state, event)  # type: ignore[return-value]

    def compose(self, session_id: str) -> CourseResult:
        with self._lock:
            state = self._state(session_id)
            return self._resume(state, {"kind": "compose"})  # type: ignore[return-value]

    def adjust(self, session_id: str, body: AdjustRequest) -> CourseResult:
        with self._lock:
            state = self._state(session_id)
            # §10 Q40·Q41: 지금 보여 주는 코스안이 아니면(없는·다른 세션의·옛 ID) stage보다 먼저 404
            if body.option_id not in state.option_ids:
                raise PlanningError("NOT_FOUND", "없는 코스안이에요", {"resource": "option", "option_id": body.option_id})  # A7
            event = {"kind": "adjust", "option_id": body.option_id, "place_id": body.place_id, "delta": body.delta}
            return self._resume(state, event)  # type: ignore[return-value]

    def back(self, session_id: str) -> CandidateBatch:
        with self._lock:
            state = self._state(session_id)
            return self._resume(state, {"kind": "back"})  # type: ignore[return-value]

    def select(self, option_id: str) -> SelectResult:
        with self._lock:
            option = self.repo.get_option(option_id)
            if option is None:
                raise PlanningError("NOT_FOUND", "없는 코스안이에요", {"resource": "option", "option_id": option_id})  # A7
            state = self._state(option.session_id)  # §10 Q21: 코스안 ID만으로 세션을 찾는다
            # §10-10 R5: 그 세션의 지금 option_ids에 없으면(옛 ID·back 뒤·다시 계산한 뒤) 404, 있는데 composing이 아니면 409
            if option_id not in state.option_ids:
                raise PlanningError("NOT_FOUND", "지금 보여 주는 코스안이 아니에요", {"resource": "option", "option_id": option_id})  # A7
            if state.stage != "composing":
                raise PlanningError("STATE_CONFLICT", f"지금 단계({state.stage})에서는 고를 수 없어요", {"stage": state.stage})
            return self._resume(state, {"kind": "select", "option_id": option_id})  # type: ignore[return-value]
