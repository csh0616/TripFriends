"""누구의 요청인가(B2)와 남의 것은 404(§11 Q3). 문지기(`api.gate`)가 확인한 user_id를 꺼내고, 리소스가 이 사용자 것인지 본다.

남의 날·계획 세션·코스안·사건·제안은 **없는 것과 같은 404 NOT_FOUND**: 있는지 알리지 않는다 (없는 것과 같은 메시지·detail).
검사는 각 엔드포인트가 본문·쿼리 형식 검사(400) 뒤, 서비스를 부르기 전에 한다 (TASK-003 §10 Q40의 오류 순서를 그대로 둔다).
"""

from typing import Annotated

from fastapi import Depends, Request, Security
from fastapi.security import HTTPBearer

from planning.service import PlanningError
from trip.trips import ApiError

_bearer_doc = HTTPBearer(auto_error=False, description="Supabase 로그인 토큰 (익명 계정도 같다)")  # Swagger에서 토큰을 넣어 볼 수 있게. 확인은 api.gate가 한다


def current_user(request: Request, _doc: object = Security(_bearer_doc)) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:  # 문지기가 먼저 걸러서 보통 오지 않는다 (방어용)
        raise ApiError(401, "UNAUTHORIZED", "로그인 정보를 확인하지 못했어요", None)
    return user_id


UserId = Annotated[str, Depends(current_user)]


def _not_found(message: str, **detail: str) -> PlanningError:
    return PlanningError("NOT_FOUND", message, detail)


def require_day(request: Request, user_id: str, day_id: str) -> None:
    if not request.app.state.trip_book.owns_day(day_id, user_id):
        raise _not_found("없는 날이에요", resource="day", day_id=day_id)


def require_session(request: Request, user_id: str, session_id: str) -> None:
    day_id = request.app.state.planning_repo.session_day(session_id)
    if day_id is None or not request.app.state.trip_book.owns_day(day_id, user_id):
        raise _not_found("없는 세션이에요", resource="session", session_id=session_id)


def require_option(request: Request, user_id: str, option_id: str) -> None:
    option = request.app.state.planning_repo.get_option(option_id)
    day_id = request.app.state.planning_repo.session_day(option.session_id) if option else None
    if day_id is None or not request.app.state.trip_book.owns_day(day_id, user_id):
        raise _not_found("없는 코스안이에요", resource="option", option_id=option_id)


def require_event(request: Request, user_id: str, event_id: str) -> None:
    record = request.app.state.trip_repo.get_event(event_id)
    if record is None or not request.app.state.trip_book.owns_day(record.day_id, user_id):
        raise _not_found("없는 사건이에요", resource="event", event_id=event_id)


def require_proposal(request: Request, user_id: str, proposal_id: str) -> None:
    proposal = request.app.state.trip_repo.get_proposal(proposal_id)
    record = request.app.state.trip_repo.get_event(proposal.event_id) if proposal else None
    if record is None or not request.app.state.trip_book.owns_day(record.day_id, user_id):
        raise _not_found("없는 제안이에요", resource="proposal", proposal_id=proposal_id)
