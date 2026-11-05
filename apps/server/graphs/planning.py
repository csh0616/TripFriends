"""G1 계획 대화 그래프 (TASK-003 §3·§4, GRAPH-001 §2). R1: 규칙 노드만. LLM·Jev는 부르지 않는다 (AC-19).

구조 (GRAPH-001 §2의 interrupt 3개가 노드 3개)
    START -> start --(conversation)--> ask       (I1: 첫 질문의 답을 기다림, stage=asking)
                   \\--(auto)---------> course    (코스 계산 뒤 I3)
    ask    --answer--> browse | --auto--> course
    browse --reaction--> browse | --next--> browse | --compose--> course
    course --adjust--> course | --back--> browse | --select--> END
각 대기 노드는 `interrupt()`로 멈췄다가 `Command(resume=이벤트)`로 이어지면 §4 전이표의 줄(`TRANSITIONS`)을 한 번 실행한다.

원칙 (TASK-003 §10)
- 실패한 요청은 아무것도 바꾸지 않는다: 줄 함수는 **먼저 계산하고 성공했을 때만** 저장소에 쓴다. 실패하면 상태 갱신 없이
  같은 대기 노드로 돌아온다 (상태 값·저장소 그대로).
- 상태에는 대화 맥락만 (§3). 반응·코스안·선택은 저장소.
- 응답을 만드는 데 필요한 결과는 요청마다 `config["configurable"]["outbox"]`에 담아 돌려준다 (체크포인트에 남기지 않음).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel

from engine.models import Batch, CourseOption, Direction, Infeasible, Place, PlaceId
from engine.planning import clamp_user_stay, compose_courses, first_batch, next_batch, parse_direction
from planning.repo import DayRecord, PlanningRepo

Stage = Literal["asking", "browsing", "composing", "done"]

# TASK-003 §4-1, §10 Q4: 칩 ID -> 종류
CHIP_CATEGORIES: dict[str, list[str]] = {
    "walk_alley": ["walk"],
    "food_tour": ["food"],
    "shopping": ["shop"],
    "night_view": ["night"],
    "cafe": ["cafe"],
    "museum_experience": ["museum", "experience"],
}
DEFAULT_CLARIFY: list[Direction] = ["quieter", "food", "night"]  # TASK-003 §4-3: 보기가 0개일 때
PARSER_TEXT_LIMIT = 200  # TASK-003 §10 Q28: 글 원문은 200자까지 저장


class PlanningState(BaseModel):
    """TASK-003 §3. 대화 맥락만 담는다. 반응·코스안·선택 결과는 PlanningRepo에 둔다."""

    session_id: str
    day_id: str
    mode: Literal["conversation", "auto"]
    stage: Stage = "asking"
    round: int = 0
    categories: list[str] = []
    shown: list[PlaceId] = []
    batch: list[PlaceId] = []
    last_direction: Direction | None = None
    clarify_count: int = 0
    option_ids: list[str] = []


# ---------- 요청이 돌려받는 결과 ----------


@dataclass
class Outcome:
    """그래프가 한 번 돌고 나서 API가 응답을 만들 때 필요한 것. 값 계산은 API가 그때 상태로 다시 한다 (TASK-003 §10 원칙 2)."""

    kind: Literal["question", "batch", "picks", "course", "selected", "infeasible", "invalid", "conflict"]
    first: bool = False  # 첫 묶음 (message 대본)
    clarify: bool = False  # 되묻기 (§4-3)
    exhausted: bool = False  # 엔진이 이 묶음을 만들 때 낸 값
    direction_relaxed: bool = False
    infeasible: Infeasible | None = None
    problem: str = ""  # invalid일 때 이유


class Outbox:
    def __init__(self) -> None:
        self.outcome: Outcome | None = None


@dataclass
class _Run:
    repo: PlanningRepo
    outbox: Outbox

    def done(self, outcome: Outcome) -> None:
        self.outbox.outcome = outcome


# ---------- 공통 도우미 ----------


def _day(run: _Run, state: PlanningState) -> DayRecord:
    day = run.repo.get_day(state.day_id)
    assert day is not None  # 세션은 있는 날에만 만든다
    return day


def candidates(day: DayRecord) -> dict[PlaceId, Place]:
    """TASK-003 §10 Q33: 꼭 갈 곳은 후보에서 뺀다."""
    return {pid: p for pid, p in day.places.items() if pid not in day.plan.must_visit}


def day_start(day: DayRecord) -> datetime:
    """`at` = 그날 시작 시각 (TASK-003 §10 Q26)."""
    hour, minute = day.plan.start.split(":")
    return datetime.combine(day.plan.date, time(int(hour), int(minute)))


def _compose(day: DayRecord, picks: list[PlaceId], overrides: dict[PlaceId, int]) -> list[CourseOption] | Infeasible:
    plan = day.plan.model_copy(update={"stay_overrides": {**day.plan.stay_overrides, **overrides}})
    return compose_courses(plan, picks, day.places)


def _with_courses(run: _Run, state: PlanningState, picks: list[PlaceId], courses: list[CourseOption], **update: Any) -> PlanningState:
    records = run.repo.save_options(state.session_id, picks, courses)
    return state.model_copy(update={"stage": "composing", "option_ids": [r.option_id for r in records], **update})


def _with_batch(state: PlanningState, batch: Batch, direction: Direction | None, **update: Any) -> PlanningState:
    """새 묶음을 보여 줌. 빈 묶음이면 round 그대로 (TASK-003 §10 Q31·Q45), 새 묶음이면 clarify_count 0 (§4-3)."""
    return state.model_copy(
        update={
            "stage": "browsing",
            "round": state.round + 1 if batch.place_ids else state.round,
            "shown": [*state.shown, *batch.place_ids],
            "batch": list(batch.place_ids),
            "last_direction": direction,  # TASK-003 §10 Q22: next{}·back 뒤에는 None
            "clarify_count": 0,
            "option_ids": [],
            **update,
        }
    )


def _log_parse(run: _Run, text: str, direction: Direction | None) -> None:
    """TASK-003 §4-3·AC-9: 직접 입력 해석은 매번 한 줄 (해석은 글 전체, 저장만 200자까지, §10 Q28·Q43)."""
    run.repo.log_decision(
        "parser", "rule", {"text": text[:PARSER_TEXT_LIMIT], "direction": direction, "understood": direction is not None}
    )


# ---------- §4 전이표 한 줄 한 줄 ----------
# 반환: (새 상태 또는 None=그대로, 다음 노드 stage). 실패하면 outcome만 남기고 상태·저장소는 그대로 둔다.


def _row_auto(run: _Run, state: PlanningState, _event: dict[str, Any]) -> PlanningState | None:
    """§4-2 자동: 담은 곳 = 꼭 갈 곳 + first_batch(categories=[], None)의 6곳 -> compose_courses. 반응 기록·shown은 남기지 않는다 (§10 Q20)."""
    day = _day(run, state)
    picks = first_batch(candidates(day), [], None, day.plan.lodging, day_start(day)).place_ids  # §10 Q33: 꼭 갈 곳 제외 6곳
    result = _compose(day, picks, {})
    if isinstance(result, Infeasible):
        run.done(Outcome("infeasible", infeasible=result))  # §10 Q2: 422, 상태는 그대로
        return None
    run.done(Outcome("course"))
    return _with_courses(run, state, picks, result, round=0, shown=[], batch=[], last_direction=None, clarify_count=0)


def _row_answer(run: _Run, state: PlanningState, event: dict[str, Any]) -> PlanningState | None:
    """줄03 asking × answer: §4-1 첫 묶음 -> browsing."""
    day = _day(run, state)
    categories = [c for chip in event["choice_ids"] for c in CHIP_CATEGORIES[chip]]
    categories = list(dict.fromkeys(categories))  # TASK-003 미정: 같은 칩을 두 번 보내면 한 번으로 본다
    direction: Direction | None = None
    text = event.get("text")
    if text is not None:
        direction = parse_direction(text)  # 못 알아들으면 무시하고 진행, 첫 질문에서는 되묻지 않음 (§4-1)
        _log_parse(run, text, direction)
    batch = first_batch(candidates(day), categories, direction, day.plan.lodging, day_start(day))
    run.done(Outcome("batch", first=True, exhausted=batch.exhausted, direction_relaxed=batch.direction_relaxed))
    # TASK-003 미정: 첫 묶음에 글로 말한 방향이 있으면 last_direction으로 둔다 (왜 문장·방향 버튼에서 직전 방향으로 쓰임)
    return _with_batch(state, batch, direction, categories=categories)


def _row_reaction(run: _Run, state: PlanningState, event: dict[str, Any]) -> PlanningState | None:
    """줄05 browsing × reaction: 저장소에 반영, 묶음은 그대로."""
    run.repo.react(state.session_id, event["place_id"], event["action"])
    run.done(Outcome("picks"))
    return None


def _row_next(run: _Run, state: PlanningState, event: dict[str, Any]) -> PlanningState | None:
    """줄06 방향 버튼 / 줄07 글 / 줄08 빈 next. 되묻기(§4-3)는 줄07의 못 알아들음."""
    day = _day(run, state)
    direction: Direction | None = event.get("direction_id")
    text = event.get("text")
    if text is not None:
        direction = parse_direction(text)
        _log_parse(run, text, direction)
        if direction is None and state.clarify_count == 0:
            # §4-3: 첫 번째 못 알아들음은 묶음 그대로 되묻기 (skip 기록 없음)
            run.done(Outcome("batch", clarify=True))
            return state.model_copy(update={"clarify_count": 1})
        # 두 번째 못 알아들음은 방향 없이 진행 (direction은 None 그대로, clarify_count는 _with_batch가 0으로)
    run.repo.skip_unreacted(state.session_id, state.batch)  # §10 Q19: 두 번째 못 알아들음도 skip 기록
    batch = next_batch(
        candidates(day), run.repo.reactions(state.session_id), direction, state.shown, day.plan.lodging, day_start(day)
    )
    run.done(Outcome("batch", exhausted=batch.exhausted, direction_relaxed=batch.direction_relaxed))
    return _with_batch(state, batch, direction)


def _row_compose(run: _Run, state: PlanningState, _event: dict[str, Any]) -> PlanningState | None:
    """줄09 browsing × compose: 반응 없는 곳 skip 기록 -> 담은 곳으로 compose_courses -> composing.
    먼저 계산하고, 코스를 못 만들면(§10 Q3) 아무것도 기록하지 않는다."""
    day = _day(run, state)
    picks = run.repo.reactions(state.session_id).liked  # skip 기록은 담은 곳을 바꾸지 않는다
    result = _compose(day, picks, run.repo.stay_overrides(state.session_id))
    if isinstance(result, Infeasible):
        run.done(Outcome("infeasible", infeasible=result))
        return None
    run.repo.skip_unreacted(state.session_id, state.batch)
    run.done(Outcome("course"))
    return _with_courses(run, state, picks, result)


def _row_adjust(run: _Run, state: PlanningState, event: dict[str, Any]) -> PlanningState | None:
    """줄10 composing × adjust: stay_overrides[place_id] ±15 -> 다시 계산 (§10 Q14).
    기준값 = 저장된 값, 없으면 그 안(option_id)에서의 머문 시간. 15~300으로 자른 값을 저장. 못 만들면 되돌릴 것도 없이 그대로(§10 Q3)."""
    day = _day(run, state)
    option = run.repo.get_option(event["option_id"])
    assert option is not None  # check_event가 확인함
    place_id = event["place_id"]
    overrides = run.repo.stay_overrides(state.session_id)
    base = overrides[place_id] if place_id in overrides else next(i.stay_min for i in option.course.items if i.place_id == place_id)
    minutes = clamp_user_stay(base + event["delta"])
    result = _compose(day, option.picks, {**overrides, place_id: minutes})  # §10 Q20: 그 안의 담은 곳 목록으로
    if isinstance(result, Infeasible):
        run.done(Outcome("infeasible", infeasible=result))
        return None
    run.repo.set_stay_override(state.session_id, place_id, minutes)
    run.done(Outcome("course"))
    return _with_courses(run, state, option.picks, result)


def _row_back(run: _Run, state: PlanningState, _event: dict[str, Any]) -> PlanningState | None:
    """줄11 composing × back: next_batch(None) -> browsing. 자동 세션이면 shown이 비어 있어 처음부터 (§10 Q20)."""
    day = _day(run, state)
    batch = next_batch(
        candidates(day), run.repo.reactions(state.session_id), None, state.shown, day.plan.lodging, day_start(day)
    )
    run.done(Outcome("batch", exhausted=batch.exhausted, direction_relaxed=batch.direction_relaxed))
    return _with_batch(state, batch, None)


def _row_select(run: _Run, state: PlanningState, event: dict[str, Any]) -> PlanningState | None:
    """줄12 composing × select: 저장소에 선택 저장 -> done."""
    run.repo.choose_option(state.day_id, event["option_id"])
    run.done(Outcome("selected"))
    return state.model_copy(update={"stage": "done"})


_Row = Callable[[_Run, PlanningState, dict[str, Any]], PlanningState | None]

# §4 전이표 (시작 두 줄은 `start` 노드). 표에 없는 (stage, 이벤트)는 409 (줄13)
TRANSITIONS: dict[tuple[str, str], _Row] = {
    ("asking", "answer"): _row_answer,  # 줄03
    ("asking", "auto"): _row_auto,  # 줄04
    ("browsing", "reaction"): _row_reaction,  # 줄05
    ("browsing", "next"): _row_next,  # 줄06·07·08
    ("browsing", "compose"): _row_compose,  # 줄09
    ("composing", "adjust"): _row_adjust,  # 줄10
    ("composing", "back"): _row_back,  # 줄11
    ("composing", "select"): _row_select,  # 줄12
}


def can_handle(stage: str, kind: str) -> bool:
    """§4 마지막 줄: 표에 없는 조합이면 False (409)."""
    return (stage, kind) in TRANSITIONS


def check_event(repo: PlanningRepo, state: PlanningState, event: dict[str, Any]) -> str | None:
    """상태를 봐야 아는 값 오류(400)의 이유. 문제 없으면 None. 아무것도 바꾸지 않는다.

    - 반응: like·skip은 지금 묶음의 장소만, unlike는 지금 묶음이나 담은 곳 (TASK-003 §10 Q17·Q33)
    - adjust: 그 안(option_id)의 items에 있는 장소만 (§10 Q15)
    """
    kind = event["kind"]
    if kind == "reaction":
        place_id, action = event["place_id"], event["action"]
        allowed = list(state.batch)
        if action == "unlike":
            allowed += repo.reactions(state.session_id).liked
        if place_id not in allowed:
            return f"지금 보여 준 묶음에 없는 장소: {place_id}"
    elif kind == "adjust":
        option = repo.get_option(event["option_id"])
        if option is None or event["place_id"] not in {i.place_id for i in option.course.items}:
            return f"그 코스안에 없는 장소: {event['place_id']}"
    return None


# ---------- 노드 ----------

_NODE_OF_STAGE = {"asking": "ask", "browsing": "browse", "composing": "course", "done": END}
_Next = Literal["ask", "browse", "course", "__end__"]


def new_state(session_id: str, day_id: str, mode: Literal["conversation", "auto"]) -> dict[str, Any]:
    """그래프에 처음 넣는 값. 모든 필드를 채워 넣어 상태 값이 11개로 고정되게 한다."""
    return PlanningState(session_id=session_id, day_id=day_id, mode=mode).model_dump()


def build_planning_graph(repo: PlanningRepo):
    """규칙 노드 그래프를 MemorySaver 체크포인터로 컴파일해 돌려준다."""

    def run_of(config: RunnableConfig) -> _Run:
        return _Run(repo, config["configurable"]["outbox"])

    def start(state: PlanningState, config: RunnableConfig) -> Command[_Next]:
        """(시작) 줄01 conversation: 첫 질문 -> asking / 줄02 auto: §4-2 -> composing."""
        run = run_of(config)
        if state.mode == "auto":
            nxt = _row_auto(run, state, {})
            if nxt is None:
                return Command(goto=END)  # §10 Q2: 세션을 만들지 않는다 (API가 스레드도 지운다)
            repo.create_session(state.session_id, state.day_id)
            return Command(goto="course", update=nxt.model_dump())
        repo.create_session(state.session_id, state.day_id)
        run.done(Outcome("question"))
        return Command(goto="ask", update=state.model_dump())

    def wait_node(stage: str) -> Callable[[PlanningState, RunnableConfig], Command[_Next]]:
        def wait(state: PlanningState, config: RunnableConfig) -> Command[_Next]:
            event = interrupt({"waiting_for": stage})  # 멈춘 자리. 앱의 다음 요청이 Command(resume=이벤트)로 이어 준다
            run = run_of(config)
            row = TRANSITIONS.get((stage, event["kind"]))
            if row is None:  # 줄13: 표에 없는 조합. 상태 그대로
                run.done(Outcome("conflict"))
                return Command(goto=_NODE_OF_STAGE[stage])
            problem = check_event(repo, state, event)
            if problem:
                run.done(Outcome("invalid", problem=problem))
                return Command(goto=_NODE_OF_STAGE[stage])
            new = row(run, state, event)
            if new is None:  # 반응이거나 실패 (§10 원칙 1): 상태 그대로 같은 자리에서 다시 기다림
                return Command(goto=_NODE_OF_STAGE[stage])
            return Command(goto=_NODE_OF_STAGE[new.stage], update=new.model_dump())

        wait.__name__ = f"wait_{stage}"
        return wait

    builder = StateGraph(PlanningState)
    builder.add_node("start", start, destinations=("ask", "course", END))
    builder.add_node("ask", wait_node("asking"), destinations=("ask", "browse", "course"))
    builder.add_node("browse", wait_node("browsing"), destinations=("browse", "course"))
    builder.add_node("course", wait_node("composing"), destinations=("course", "browse", END))
    builder.add_edge(START, "start")
    return builder.compile(checkpointer=MemorySaver())
