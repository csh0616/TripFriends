"""여행 중 사건 엔드포인트 (TASK-007 §B-4): check, accept, dismiss. 얇게: 일은 `trip.service`가 한다."""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from api.now import parse_at
from api.planning import _doc
from planning.service import PlanningError
from trip.schemas import NowView
from trip.service import TripService

router = APIRouter()


class CheckRequest(BaseModel):
    """위치는 본문으로만 (주소·로그에 남지 않게). 저장하지 않는다."""

    at: str
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

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
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat과 lng는 함께 보내요")
        return self


class VisitCheckRequest(BaseModel):
    """영업 확인 답 (TASK-008 A5). at은 시간대 없는 그날의 시각."""

    day_id: str
    at: str
    was_open: StrictBool

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
def check(day_id: str, body: CheckRequest, request: Request) -> NowView:
    position = (body.lat, body.lng) if body.lat is not None and body.lng is not None else None
    when: datetime = parse_at(body.at)
    return service(request).check(day_id, when, position)


@router.post("/proposals/{proposal_id}/accept", responses=_doc(404, 409), summary="대안 반영")
def accept(proposal_id: str, request: Request) -> NowView:
    return service(request).accept(proposal_id)


@router.post("/events/{event_id}/dismiss", responses=_doc(404, 409), summary="대안 사양: 일정 그대로")
def dismiss(event_id: str, request: Request) -> NowView:
    return service(request).dismiss(event_id)


@router.post(
    "/places/{place_id}/visit-checks",
    responses=_doc(400, 404, 409),
    summary="영업 확인 답: 열었어/닫혔어 (그날만 사용자 확인으로 저장, 닫혔어면 대안 계산)",
)
def visit_check(place_id: str, body: VisitCheckRequest, request: Request) -> NowView:
    return service(request).visit_check(place_id, body.day_id, parse_at(body.at), body.was_open)
