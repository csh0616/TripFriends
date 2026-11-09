"""계획 대화 저장소 (TASK-003 §2·§3). 반응·코스안·선택 결과는 그래프 상태가 아니라 여기에 둔다 (ADR-013).

`PlanningRepo`는 인터페이스, `MemoryPlanningRepo`는 메모리 구현이다. Supabase 연결은 별도 TASK에서
이 인터페이스만 바꿔 끼운다.
"""

import copy
import threading
import uuid
from abc import ABC, abstractmethod
from typing import Any, Literal, NamedTuple

from engine.models import CourseOption, DayPlan, Place, PlaceId, Reactions

ReactionAction = Literal["like", "skip", "unlike"]


class DayRecord(NamedTuple):
    plan: DayPlan
    places: dict[PlaceId, Place]
    day_number: int  # trip 안에서 몇째 날인지, 1부터 (TASK-003 §10 Q5)
    lodging_known: bool = True  # False면 lodging은 도시 중심(출발점)일 뿐 숙소가 아니다 -> 숙소로 돌아가기 없음 (TASK-010 §9 Q10·§10 Q27)
    sources: dict[PlaceId, str] | None = None  # 장소 -> 영업시간 fact의 source_type. None이면 모두 "demo" (TASK-010 B7)


class OptionRecord(NamedTuple):
    """계산해 보여 준 코스안 하나. picks는 이 안을 계산할 때 쓴 담은 곳 (adjust가 같은 목록으로 다시 계산, TASK-003 §10 Q20)."""

    option_id: str
    session_id: str
    picks: list[PlaceId]
    course: CourseOption


class PlanningRepo(ABC):
    # ---- 하루·여행 (심어 두는 쪽) ----
    @abstractmethod
    def save_day(
        self,
        day_id: str,
        plan: DayPlan,
        places: dict[PlaceId, Place],
        day_number: int = 1,
        *,
        lodging_known: bool = True,
        sources: dict[PlaceId, str] | None = None,
    ) -> None: ...

    @abstractmethod
    def get_day(self, day_id: str) -> DayRecord | None: ...

    @abstractmethod
    def replace_must_visit(self, day_id: str, old: PlaceId, new: PlaceId) -> None:
        """그날 꼭 갈 곳 목록에서 old를 new로 바꾼다 (TASK-008 §7: 닫힌 곳을 대안으로 바꿀 때). 다른 필드는 그대로."""

    @abstractmethod
    def save_trip(self, trip_id: str, day_ids: list[str]) -> None: ...

    # ---- 세션 ----
    @abstractmethod
    def create_session(self, session_id: str, day_id: str) -> None: ...

    @abstractmethod
    def session_day(self, session_id: str) -> str | None:
        """세션이 속한 day_id. 없는 세션이면 None."""

    # ---- 반응 ----
    @abstractmethod
    def reactions(self, session_id: str) -> Reactions: ...

    @abstractmethod
    def reactions_after_react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> Reactions:
        """`react`를 한 뒤의 반응을 **저장하지 않고** 돌려준다 (응답을 먼저 만들기 위해: TASK-003 §10-11 R12)."""

    @abstractmethod
    def react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> None:
        """like·skip·unlike를 반영한다 (TASK-003 §4 줄05, §10 Q17·Q18·Q39)."""

    @abstractmethod
    def reactions_after_skip(self, session_id: str, batch: list[PlaceId]) -> Reactions:
        """`skip_unreacted(batch)`를 한 뒤의 반응을 **저장하지 않고** 돌려준다 (계산 먼저, 저장은 나중에: TASK-003 §10-10 R1)."""

    @abstractmethod
    def skip_unreacted(self, session_id: str, batch: list[PlaceId]) -> None:
        """이번 묶음에서 반응이 없는 곳을 묶음 순서대로 skip으로 기록한다 (TASK-003 §4 줄06~09)."""

    # ---- 묶음의 성질 ----
    @abstractmethod
    def save_batch_relaxed(self, session_id: str, relaxed: bool) -> None:
        """지금 묶음을 만들 때의 direction_relaxed (TASK-003 §10-10 R4). 그래프 상태 필드는 11개로 두려고 저장소에 둔다."""

    @abstractmethod
    def batch_relaxed(self, session_id: str) -> bool: ...

    @abstractmethod
    def save_batch_first(self, session_id: str, first: bool) -> None:
        """# TASK-004 미정: 문서에 없는 저장 항목. 그래프 상태는 11개 고정이라 저장소에 둔다 (relaxed와 같은 방식).
        지금 묶음이 첫 질문의 답으로 만든 첫 묶음인지 (TASK-004 A1: GET이 message 대본 우선순위, TASK-003 §10 Q6을 다시 적용하려고)."""

    @abstractmethod
    def batch_first(self, session_id: str) -> bool: ...

    # ---- 머무는 시간 ----
    @abstractmethod
    def stay_overrides(self, session_id: str) -> dict[PlaceId, int]: ...

    @abstractmethod
    def set_stay_override(self, session_id: str, place_id: PlaceId, minutes: int) -> None: ...

    # ---- 코스안과 선택 ----
    @abstractmethod
    def save_options(self, records: list[OptionRecord]) -> None:
        """코스안을 저장한다. 옛 코스안은 지우지 않는다 (옛 ID는 상태의 option_ids에서 빠질 뿐, §10 Q41).
        ID는 `new_option_records`로 미리 만든다 (응답을 저장보다 먼저 만들기 위해: §10-11 R12)."""

    @abstractmethod
    def get_option(self, option_id: str) -> OptionRecord | None: ...

    @abstractmethod
    def choose_option(self, day_id: str, option_id: str) -> None: ...

    @abstractmethod
    def chosen_option(self, day_id: str) -> str | None: ...

    # ---- 판단 기록 ----
    @abstractmethod
    def log_decision(self, kind: str, model: str, output: dict[str, Any]) -> None: ...

    @abstractmethod
    def decision_logs(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def snapshot(self) -> dict[str, Any]:
        """저장소 전체의 복사본. 테스트가 "실패한 요청은 아무것도 바꾸지 않는다"를 비교하는 데 쓴다."""


class MemoryPlanningRepo(PlanningRepo):
    def __init__(self) -> None:
        # 요청이 여러 스레드에서 들어와도 한 번에 하나씩 바꾼다
        self._lock = threading.RLock()
        self._days: dict[str, DayRecord] = {}
        self._trips: dict[str, list[str]] = {}
        self._sessions: dict[str, str] = {}
        self._liked: dict[str, list[PlaceId]] = {}
        self._skipped: dict[str, list[PlaceId]] = {}
        # 좋아했다가 취소한 곳. 반응이 있었으므로 next에서 skip으로 치지 않는다 (TASK-003 §4 줄06, §10 Q17, §10-10 그대로 받아들인 것)
        self._unliked: dict[str, list[PlaceId]] = {}
        self._overrides: dict[str, dict[PlaceId, int]] = {}
        self._relaxed: dict[str, bool] = {}
        self._first: dict[str, bool] = {}
        self._options: dict[str, OptionRecord] = {}
        self._chosen: dict[str, str] = {}
        self._logs: list[dict[str, Any]] = []

    def save_day(
        self,
        day_id: str,
        plan: DayPlan,
        places: dict[PlaceId, Place],
        day_number: int = 1,
        *,
        lodging_known: bool = True,
        sources: dict[PlaceId, str] | None = None,
    ) -> None:
        with self._lock:
            self._days[day_id] = DayRecord(
                plan.model_copy(deep=True),
                {k: v.model_copy(deep=True) for k, v in places.items()},
                day_number,
                lodging_known,
                dict(sources) if sources is not None else None,
            )

    def get_day(self, day_id: str) -> DayRecord | None:
        with self._lock:
            return self._days.get(day_id)

    def replace_must_visit(self, day_id: str, old: PlaceId, new: PlaceId) -> None:
        with self._lock:
            record = self._days[day_id]
            must = [new if pid == old else pid for pid in record.plan.must_visit]
            self._days[day_id] = record._replace(plan=record.plan.model_copy(update={"must_visit": list(dict.fromkeys(must))}))

    def save_trip(self, trip_id: str, day_ids: list[str]) -> None:
        with self._lock:
            self._trips[trip_id] = list(day_ids)

    def create_session(self, session_id: str, day_id: str) -> None:
        with self._lock:
            self._sessions[session_id] = day_id
            self._liked[session_id] = []
            self._skipped[session_id] = []
            self._unliked[session_id] = []
            self._overrides[session_id] = {}
            self._relaxed[session_id] = False
            self._first[session_id] = False

    def session_day(self, session_id: str) -> str | None:
        with self._lock:
            return self._sessions.get(session_id)

    def reactions(self, session_id: str) -> Reactions:
        with self._lock:
            return Reactions(liked=list(self._liked.get(session_id, [])), skipped=list(self._skipped.get(session_id, [])))

    def reactions_after_react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> Reactions:
        with self._lock:
            liked, skipped, _ = _apply_reaction(
                list(self._liked[session_id]), list(self._skipped[session_id]), list(self._unliked[session_id]), place_id, action
            )
            return Reactions(liked=liked, skipped=skipped)

    def react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> None:
        with self._lock:
            self._liked[session_id], self._skipped[session_id], self._unliked[session_id] = _apply_reaction(
                self._liked[session_id], self._skipped[session_id], self._unliked[session_id], place_id, action
            )

    def _unreacted(self, session_id: str, batch: list[PlaceId]) -> list[PlaceId]:
        reacted = {*self._liked[session_id], *self._skipped[session_id], *self._unliked[session_id]}
        return [place_id for place_id in batch if place_id not in reacted]

    def reactions_after_skip(self, session_id: str, batch: list[PlaceId]) -> Reactions:
        with self._lock:
            skipped = [*self._skipped[session_id], *self._unreacted(session_id, batch)]
            return Reactions(liked=list(self._liked[session_id]), skipped=skipped)

    def skip_unreacted(self, session_id: str, batch: list[PlaceId]) -> None:
        with self._lock:
            self._skipped[session_id].extend(self._unreacted(session_id, batch))

    def save_batch_relaxed(self, session_id: str, relaxed: bool) -> None:
        with self._lock:
            self._relaxed[session_id] = relaxed

    def batch_relaxed(self, session_id: str) -> bool:
        with self._lock:
            return self._relaxed.get(session_id, False)

    def save_batch_first(self, session_id: str, first: bool) -> None:
        with self._lock:
            self._first[session_id] = first

    def batch_first(self, session_id: str) -> bool:
        with self._lock:
            return self._first.get(session_id, False)

    def stay_overrides(self, session_id: str) -> dict[PlaceId, int]:
        with self._lock:
            return dict(self._overrides.get(session_id, {}))

    def set_stay_override(self, session_id: str, place_id: PlaceId, minutes: int) -> None:
        with self._lock:
            self._overrides[session_id][place_id] = minutes

    def save_options(self, records: list[OptionRecord]) -> None:
        with self._lock:
            for record in records:
                self._options[record.option_id] = record

    def get_option(self, option_id: str) -> OptionRecord | None:
        with self._lock:
            return self._options.get(option_id)

    def choose_option(self, day_id: str, option_id: str) -> None:
        with self._lock:
            self._chosen[day_id] = option_id

    def chosen_option(self, day_id: str) -> str | None:
        with self._lock:
            return self._chosen.get(day_id)

    def log_decision(self, kind: str, model: str, output: dict[str, Any]) -> None:
        with self._lock:
            # DATA-001 decision_logs. R1은 message_id 없이 이 표만 남긴다 (TASK-003 §10 Q28). latency_ms·cost_usd는 None (§10-10 그대로 받아들인 것)
            self._logs.append(
                {"message_id": None, "kind": kind, "model": model, "output": dict(output), "latency_ms": None, "cost_usd": None}
            )

    def decision_logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._logs)

    # ---- TASK-012 A3: 요청이 실패하면 되돌린다 (store.unit.Transaction이 부른다) ----

    def capture(self) -> dict[str, Any]:
        """지금 상태를 떠 둔다. 기록(DayRecord·OptionRecord·로그)은 바뀌지 않고 갈아 끼우기만 하므로 목록·사전만 복사한다."""
        with self._lock:
            return {
                "_days": dict(self._days),
                "_trips": {k: list(v) for k, v in self._trips.items()},
                "_sessions": dict(self._sessions),
                "_liked": {k: list(v) for k, v in self._liked.items()},
                "_skipped": {k: list(v) for k, v in self._skipped.items()},
                "_unliked": {k: list(v) for k, v in self._unliked.items()},
                "_overrides": {k: dict(v) for k, v in self._overrides.items()},
                "_relaxed": dict(self._relaxed),
                "_first": dict(self._first),
                "_options": dict(self._options),
                "_chosen": dict(self._chosen),
                "_logs": list(self._logs),
            }

    def restore(self, saved: dict[str, Any]) -> None:
        with self._lock:
            for name, value in saved.items():
                setattr(self, name, value)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(
                {
                    "days": {k: (v.plan.model_dump(), {p: pl.model_dump() for p, pl in v.places.items()}, v.day_number) for k, v in self._days.items()},
                    "trips": self._trips,
                    "sessions": self._sessions,
                    "liked": self._liked,
                    "skipped": self._skipped,
                    "unliked": self._unliked,
                    "overrides": self._overrides,
                    "relaxed": self._relaxed,
                    "first": self._first,
                    "options": {k: (v.session_id, v.picks, v.course.model_dump()) for k, v in self._options.items()},
                    "chosen": self._chosen,
                    "logs": self._logs,
                }
            )


def new_option_records(session_id: str, picks: list[PlaceId], courses: list[CourseOption]) -> list[OptionRecord]:
    """새 ID(uuid4)를 붙인 코스안 레코드. 저장은 하지 않는다."""
    return [OptionRecord(str(uuid.uuid4()), session_id, list(picks), course) for course in courses]


def _apply_reaction(
    liked: list[PlaceId], skipped: list[PlaceId], unliked: list[PlaceId], place_id: PlaceId, action: ReactionAction
) -> tuple[list[PlaceId], list[PlaceId], list[PlaceId]]:
    """like·skip·unlike 규칙 한 곳. 받은 목록을 바꿔서 돌려준다 (호출하는 쪽이 복사본을 넘기면 저장 없이 계산만 된다)."""
    if action == "like":
        # §10 Q18: 넘긴 곳을 다시 좋아하면 담긴다. 이미 담은 곳이면 순서 그대로
        _remove(skipped, place_id)
        _remove(unliked, place_id)
        if place_id not in liked:
            liked.append(place_id)
    elif action == "skip":
        # §10 Q18: 좋아한 곳을 넘기면 담은 곳에서 빠진다
        _remove(liked, place_id)
        _remove(unliked, place_id)
        if place_id not in skipped:
            skipped.append(place_id)
    elif place_id in liked:
        # unlike: 담은 곳에서만 뺀다 (skip으로 바꾸지 않음, AC-7). 담은 곳이 아니면 변화 없음 (§10 Q39)
        _remove(liked, place_id)
        if place_id not in unliked:
            unliked.append(place_id)
    return liked, skipped, unliked


def _remove(items: list[PlaceId], place_id: PlaceId) -> None:
    if place_id in items:
        items.remove(place_id)
