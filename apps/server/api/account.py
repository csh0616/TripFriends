"""계정 연결 엔드포인트 (TASK-012 §C4·C6, API-001). 얇게: 규칙은 `trip.link.AccountLink`.

헤더 Bearer = 계정 토큰(문지기가 확인), 본문 `anonymous_token` = 연결 전 익명 세션 토큰(여기서 같은 JWKS로 확인).
토큰 글자는 로그·응답에 남기지 않는다 (§15 S4). 이메일은 읽지도 저장하지도 않는다 (§15 S6).
"""

from fastapi import APIRouter, Request

from api.access import UserId
from api.auth import AuthError, AuthUnavailable
from api.planning import _doc
from trip.link import ChooseBody, ClaimBody, ClaimResult
from trip.trips import ApiError, Trip

router = APIRouter()


def anonymous_user(request: Request, account_id: str, token: str) -> str:
    """두 토큰을 모두 확인하고 익명 쪽 user_id를 돌려준다. 거절은 아무것도 바꾸기 전에."""
    if getattr(request.state, "is_anonymous", True):
        raise ApiError(400, "ACCOUNT_REQUIRED", "계정으로 로그인한 상태에서만 연결할 수 있어요", None)
    jwks = request.app.state.jwks
    try:
        claims = jwks.verify_claims(token)
    except AuthUnavailable as error:
        raise ApiError(503, "AUTH_UNAVAILABLE", "지금 로그인 확인을 못 해요. 잠시 뒤 다시 해 주세요", None) from error
    except AuthError:
        raise ApiError(401, "UNAUTHORIZED", "로그인 정보를 확인하지 못했어요", None) from None
    if claims.get("is_anonymous") is not True:
        raise ApiError(400, "NOT_ANONYMOUS_TOKEN", "익명 세션의 토큰이 아니에요", None)
    if claims["sub"] == account_id:
        raise ApiError(400, "SAME_USER", "같은 사용자의 토큰 둘이에요", None)
    return claims["sub"]


@router.post("/account/claim", responses=_doc(400, 409), response_model_exclude_none=True, summary="익명 여행을 로그인한 계정으로 (옮기거나 고르게 하기)")
def claim(body: ClaimBody, request: Request, user: UserId) -> ClaimResult:
    anonymous_id = anonymous_user(request, user, body.anonymous_token)
    return request.app.state.account_link.claim(anonymous_id, user)


@router.post("/account/claim/choose", responses=_doc(400, 404, 409), summary="두 여행 중 하나를 지금 여행으로")
def claim_choose(body: ChooseBody, request: Request, user: UserId) -> Trip:
    anonymous_id = anonymous_user(request, user, body.anonymous_token)
    return request.app.state.account_link.choose(anonymous_id, user, body.trip_id)
