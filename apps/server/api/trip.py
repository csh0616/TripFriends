"""여행 중 사건 엔드포인트 (TASK-007 §B-4): check, accept, dismiss. 얇게: 일은 `trip.service`가 한다."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from api.access import UserId, require_day, require_event, require_proposal
from api.now import parse_at
from api.planning import _doc
from planning.service import PlanningError
from trip.rehearsal import RehearsalAction
from trip.schemas import NowView
from trip.service import TripService

router = APIRouter()


def _actions_only_when_rehearsing(body: Any) -> None:
    """§12 Q3: 연습이 아닌 요청에 연습 기록이 실리면 400 (조용히 무시하면 앱 버그가 숨는다). 빈 목록도."""
    if body.rehearsal_actions is not None and body.rehearsal is not True:
        raise ValueError("rehearsal_actions는 rehearsal이 true일 때만 보내요")


def check_owned(request: Request, user: str, actions: list[Any] | None) -> None:
    """§11·§12: 연습 기록의 남의 날·사건·제안은 404 (이미 저장된 것일 때. 되돌려져 없는 것은 서버가 모르므로 그대로 받는다)."""
    repo = request.app.state.trip_repo
    for action in actions or []:
        if action.type == "visit_check":
            require_day(request, user, action.day_id)
            continue
        if repo.get_event(action.event.event_id) is not None:
            require_event(request, user, action.event.event_id)
        if action.type == "accept" and repo.get_proposal(action.proposal_id) is not None:
            require_proposal(request, user, action.proposal_id)


class CheckRequest(BaseModel):
    """위치는 본문으로만 (주소·로그에 남지 않게). 저장하지 않는다."""

    at: str
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    rehearsal: StrictBool | None = None  # TASK-014 C3: 기본 false(없음). true면 같은 계산을 하고 저장은 모두 되돌린다
    rehearsal_actions: list[RehearsalAction] | None = None  # §12: 연습 중 한 행동(고른 대안·그대로 갈래·영업 확인), 적힌 순서대로 먼저 적용

    @field_validator("at")
    @classmethod
    def _at(cls, value: str) -> str:
        try:
            parse_at(value)
        except PlanningError as error:
            raise ValueError(error.message) from None
        return value

    @model_validator(mode="after")
    def _both(self) -> "CheckRequest":
        _actions_only_when_rehearsing(self)
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat과 lng는 함께 보내요")
        return self


class VisitCheckRequest(BaseModel):
    """영업 확인 답 (TASK-008 A5). at은 시간대 없는 그날의 시각."""

    day_id: str
    at: str
    was_open: StrictBool
    rehearsal: StrictBool | None = None  # TASK-014 §10 Q5: 기본 false(없음). true면 대안 계산까지 하고 되돌린다
    rehearsal_actions: list[RehearsalAction] | None = None

    @model_validator(mode="after")
    def _rehearsing(self) -> "VisitCheckRequest":
        _actions_only_when_rehearsing(self)
        return self

    @field_validator("at")
    @classmethod
    def _at(cls, value: str) -> str:
        try:
            parse_at(value)
        except PlanningError as error:
            raise ValueError(error.message) from None
        return value


def service(request: Request) -> TripService:
    return request.app.state.trip_service


@router.post("/days/{day_id}/check", responses=_doc(400, 404), summary="여행 중 확인: 시각·위치로 늦어짐 감지 (위치는 저장하지 않음)")
def check(day_id: str, body: CheckRequest, request: Request, user: UserId) -> NowView:
    require_day(request, user, day_id)
    position = (body.lat, body.lng) if body.lat is not None and body.lng is not None else None
    when: datetime = parse_at(body.at)
    if body.rehearsal is True:
        request.state.rehearsal = True  # 문지기(Gate)가 응답 때 commit 대신 rollback
    check_owned(request, user, body.rehearsal_actions)
    return service(request).check(day_id, when, position, body.rehearsal is True, body.rehearsal_actions)


@router.post("/proposals/{proposal_id}/accept", responses=_doc(404, 409), summary="대안 반영")
def accept(proposal_id: str, request: Request, user: UserId) -> NowView:
    require_proposal(request, user, proposal_id)
    return service(request).accept(proposal_id)


@router.post("/events/{event_id}/dismiss", responses=_doc(404, 409), summary="대안 사양: 일정 그대로")
def dismiss(event_id: str, request: Request, user: UserId) -> NowView:
    require_event(request, user, event_id)
    return service(request).dismiss(event_id)


@router.post(
    "/places/{place_id}/visit-checks",
    responses=_doc(400, 404, 409),
    summary="영업 확인 답: 열었어/닫혔어 (그날만 사용자 확인으로 저장, 닫혔어면 대안 계산)",
)
def visit_check(place_id: str, body: VisitCheckRequest, request: Request, user: UserId) -> NowView:
    require_day(request, user, body.day_id)
    if body.rehearsal is True:
        request.state.rehearsal = True
    check_owned(request, user, body.rehearsal_actions)
    return service(request).visit_check(place_id, body.day_id, parse_at(body.at), body.was_open, body.rehearsal is True, body.rehearsal_actions)
