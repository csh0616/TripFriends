"""GET /days/{day_id}/now (TASK-006 §A1). 읽기 전용: 위치를 포함해 아무것도 저장하지 않는다."""

import re
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request

from api.planning import _doc
from planning.service import PlanningError
from trip.now import build_now_view
from trip.schemas import NowView

router = APIRouter()

# 시간대 없는 ISO 시각만 (R9: +09:00·Z는 400). 초는 있어도 없어도 된다
AT_FORMAT = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?")


def _bad(message: str) -> PlanningError:
    return PlanningError("INVALID_REQUEST", message, None)


def parse_at(raw: str | None) -> datetime:
    if raw is None or not AT_FORMAT.fullmatch(raw):
        raise _bad("at은 2026-12-02T13:20:00 같은 시각이어야 해요")
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        raise _bad("at이 올바른 시각이 아니에요") from None


@router.get(
    "/days/{day_id}/now",
    responses=_doc(400, 404),
    summary="여행 중 화면: 지금(at) 시각의 카드·지도 (위치는 저장하지 않음)",
)
def get_now(
    day_id: str,
    request: Request,
    at: str | None = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> NowView:
    # 순서 (TASK-003 Q40, TASK-006 R9): 쿼리 형식 400 -> 없는 날 404 -> 고른 코스 없음 404 -> 하루 밖 날짜 400
    when = parse_at(at)
    if (lat is None) != (lng is None):
        raise _bad("lat과 lng는 함께 보내요")
    repo = request.app.state.planning_service.repo
    day = repo.get_day(day_id)
    if day is None:
        raise PlanningError("NOT_FOUND", "없는 날이에요", {"resource": "day", "day_id": day_id})
    option_id = repo.chosen_option(day_id)
    option = repo.get_option(option_id) if option_id else None
    if option is None:
        raise PlanningError("NOT_FOUND", "고른 코스가 없어요", {"resource": "course", "day_id": day_id})
    if when.date() != day.plan.date:
        raise _bad("at이 그날이 아니에요")  # Q7: 날짜 그대로 비교
    position = (lat, lng) if lat is not None and lng is not None else None
    return build_now_view(day_id, day, option.course, when, position, repo.stay_overrides(option.session_id))
