"""TASK-014 §11·§12 연습 기록: 연습 요청이 앞선 연습 행동을 먼저 적용한다 (실제와 같은 코드, 같은 트랜잭션, 끝나면 전부 되돌림).

행동 셋: accept(고른 대안) · dismiss(그대로 갈래) · visit_check(영업 확인). 순서대로 적용한다.
- visit_check는 실제 `TripService.visit_check`를 그대로 부른다 (오류도 실제 그대로: 없는 장소 404, 지금 확인할 장소가 아니면 409).
- accept·dismiss는 클라이언트가 보낸 사건을 받는다. 그 연습 요청에서 서버가 만든 사건(닫힘)은 앞선 visit_check가 만든 것과 모양이 같아야 하고,
  그렇지 않으면(순서가 뒤집힘) 400. 늦어짐 사건은 모양을 코스에 맞춰 다시 세워 저장소에 놓은 뒤 실제 accept·dismiss를 부른다.
- 모양이 이상한 것은 400 VALIDATION_ERROR. 남의 날·사건·제안은 API 층에서 404.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from engine.models import CourseItem, CourseOption, Dropped
from engine.planning import distance_km, travel_min
from planning.repo import DayRecord
from trip.repo import EventRecord, ProposalRecord
from trip.schemas import NowEvent, NowProposal
from trip.trips import invalid


def _check_at(value: str) -> str:
    from api.now import parse_at  # 순환을 피하려고 안에서
    from planning.service import PlanningError

    try:
        parse_at(value)
    except PlanningError as error:
        raise ValueError(error.message) from None
    return value


class AcceptAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["accept"]
    event: NowEvent
    proposal_id: str

    @model_validator(mode="after")
    def _inside(self) -> "AcceptAction":
        if self.proposal_id not in {p.proposal_id for p in self.event.proposals}:
            raise ValueError("proposal_id가 그 사건의 제안이 아니에요")
        return self


class DismissAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["dismiss"]
    event: NowEvent


class VisitCheckAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["visit_check"]
    place_id: str
    day_id: str
    at: str
    was_open: StrictBool

    @field_validator("at")
    @classmethod
    def _at(cls, value: str) -> str:
        return _check_at(value)


RehearsalAction = Annotated[AcceptAction | DismissAction | VisitCheckAction, Field(discriminator="type")]


def _minutes(value: str) -> int:
    if len(value) != 5 or value[2] != ":" or not (value[:2] + value[3:]).isdigit():
        raise invalid("rehearsal_actions", "시각 모양이 올바르지 않아요")
    return int(value[:2]) * 60 + int(value[3:])


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def shape_of(event: NowEvent) -> dict[str, Any]:
    """사건 모양 비교용: id(요청마다 새로 만든다)와 사실 칩(그사이 확인으로 바뀔 수 있다)은 뺀다."""

    def strip(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: strip(v) for k, v in value.items() if k not in ("event_id", "proposal_id", "facts")}
        if isinstance(value, list):
            return [strip(v) for v in value]
        return value

    return strip(event.model_dump())


def rebuild(day_id: str, day: DayRecord, course: CourseOption, event: NowEvent, when: datetime) -> tuple[EventRecord, list[ProposalRecord]]:
    """클라이언트가 보낸 늦어짐 사건을 지금 코스에 맞춰 사건·제안 기록으로 다시 세운다. 맞지 않으면 400.

    제안의 일정(items)은 지금 코스의 장소들을 다시 짠 것이어야 한다 (장소가 코스에 없으면 400).
    """
    if event.type != "delay":
        raise invalid("rehearsal_actions", "닫힘 사건은 앞선 영업 확인 기록과 함께 와야 해요")
    in_course = {item.place_id for item in course.items if item.place_id}
    originals = {item.place_id: item for item in course.items if item.place_id}
    records: list[ProposalRecord] = []
    k: int | None = None
    for proposal in event.proposals:
        from_index = _from_index(course, proposal, in_course)
        here = course.items[from_index - 1]
        if here.place_id is None:
            raise invalid("rehearsal_actions", "사건의 장소가 그날 코스에 없어요")
        if k is None:
            k = here.seq
        elif k != here.seq:
            raise invalid("rehearsal_actions", "한 사건의 제안은 같은 장소에서 시작해야 해요")
        records.append(_proposal_record(event, proposal, course, day, from_index, originals, when))
    if k is None:
        raise invalid("rehearsal_actions", "제안이 없는 사건이에요")
    record = EventRecord(event.event_id, day_id, f"delay:{day_id}:{k}", k, event.severity, event.delay_min, event.state, when)
    return record, records


def _from_index(course: CourseOption, proposal: NowProposal, in_course: set[str]) -> int:
    for item in proposal.items:
        if item.place_id is not None and item.place_id not in in_course:
            raise invalid("rehearsal_actions", "사건의 장소가 그날 코스에 없어요")
    for dropped in proposal.dropped:
        if dropped.place_id not in in_course:
            raise invalid("rehearsal_actions", "사건의 장소가 그날 코스에 없어요")
    if proposal.items:
        index = proposal.items[0].seq - 1
    else:
        slots = [i for i, item in enumerate(course.items) if item.place_id in {d.place_id for d in proposal.dropped}]
        if not slots:
            raise invalid("rehearsal_actions", "제안 모양이 올바르지 않아요")
        index = min(slots)
    if not 1 <= index <= len(course.items):
        raise invalid("rehearsal_actions", "제안이 코스와 맞지 않아요")
    return index


def _proposal_record(event: NowEvent, proposal: NowProposal, course: CourseOption, day: DayRecord, from_index: int, originals: dict[str, CourseItem], when: datetime) -> ProposalRecord:
    prefix = course.items[:from_index]
    spot = prefix[-1]
    position = (day.places[spot.place_id].lat, day.places[spot.place_id].lng) if spot.place_id else None
    previous_end = _minutes(spot.end)
    items: list[CourseItem] = []
    for number, view in enumerate(proposal.items, start=from_index + 1):
        if view.seq != number:
            raise invalid("rehearsal_actions", "제안 일정의 순서가 올바르지 않아요")
        start, end = _minutes(view.start), _minutes(view.end)
        if view.place_id is not None:
            original = originals[view.place_id]
            place = day.places[view.place_id]
            travel = travel_min(distance_km(position, (place.lat, place.lng))) if position else original.travel_min
            position = (place.lat, place.lng)
        else:
            original = next((i for i in course.items[from_index:] if i.place_id is None and i.start == view.start and i.end == view.end), None)
            if original is None:
                raise invalid("rehearsal_actions", "제안 일정이 코스와 맞지 않아요")
            travel = original.travel_min
        items.append(
            original.model_copy(
                update={"seq": number, "start": view.start, "end": view.end, "stay_min": end - start, "travel_min": travel,
                        "wait_min": max(0, start - previous_end - travel), "is_fixed": view.is_fixed}
            )
        )
        previous_end = end
    known = {d.place_id for d in course.dropped}
    dropped = [*course.dropped, *(Dropped(place_id=d.place_id, reason="no_time") for d in proposal.dropped if d.place_id not in known)]
    last = next((i for i in reversed([*prefix, *items]) if i.place_id), None)
    home = travel_min(distance_km((day.places[last.place_id].lat, day.places[last.place_id].lng), day.plan.lodging)) if last and last.place_id else course.go_home_min
    full = CourseOption(label=proposal.label, items=[*prefix, *items], dropped=dropped, go_home_min=home, total_travel_min=sum(i.travel_min for i in [*prefix, *items]) + home)
    return ProposalRecord(
        proposal.proposal_id, event.event_id, proposal.label, proposal.reason, tuple(d.place_id for d in proposal.dropped),
        proposal.keeps_fixed, proposal.first_leave_at, full, from_index, when, event.delay_min,
    )

