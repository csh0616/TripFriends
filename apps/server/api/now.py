"""GET /days/{day_id}/now (TASK-006 §A1). 읽기 전용: 위치를 포함해 아무것도 저장하지 않는다."""

import re
from datetime import datetime
from fastapi import APIRouter, Request

from api.access import UserId, require_day
from api.planning import _doc
from planning.service import PlanningError
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
    summary="여행 중 화면: 지금(at) 시각의 카드·지도 (위치는 받지 않음, 위치는 POST /check)",
)
def get_now(day_id: str, request: Request, user: UserId, at: str | None = None) -> NowView:
    # 순서 (TASK-003 Q40, TASK-006 R9): 쿼리 형식 400 -> 없는(남의) 날 404 -> 고른 코스 없음 404 -> 하루 밖 날짜 400
    # TASK-007 B-4: lat·lng 쿼리는 받지 않는다 (보내도 무시)
    when = parse_at(at)
    require_day(request, user, day_id)
    return request.app.state.trip_service.now(day_id, when)
