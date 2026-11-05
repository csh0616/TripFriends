"""계획 대화 엔드포인트 (TASK-003 §5). 얇게: 검사·그래프·응답 만들기는 `planning.service`가 한다.

본문 오류는 FastAPI 기본 422가 아니라 400 `INVALID_REQUEST` (TASK-003 §10 Q23·Q44).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from planning.schemas import (
    AdjustRequest,
    AnswerRequest,
    CandidateBatch,
    CourseResult,
    ErrorResponse,
    NextRequest,
    Picks,
    PlanningSession,
    ReactionRequest,
    SelectResult,
    StartRequest,
)
from planning.service import PlanningError, PlanningService

# 이 경로들만 공통 오류 형식으로 바꾼다. 그 밖의 엔드포인트(/debug/compose 등)는 기존 동작 그대로
PLANNING_PREFIXES = ("/days/", "/planning/", "/course-options/")


def get_service(request: Request) -> PlanningService:
    return request.app.state.planning_service


Service = Annotated[PlanningService, Depends(get_service)]


def _error(status: int, code: str, message: str, detail: object = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "detail": detail}})


def http_error_response(status: int, code: str, message: str) -> JSONResponse:
    return _error(status, code, message, None)


def planning_error_handler(_request: Request, exc: PlanningError) -> JSONResponse:
    return _error(exc.status, exc.code, exc.message, exc.detail)


def planning_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """본문·경로 값 오류 -> 400 INVALID_REQUEST. detail에는 어느 필드가 왜 틀렸는지만 담는다 (입력 원문은 넣지 않음)."""
    detail = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return _error(400, "INVALID_REQUEST", "요청 내용이 올바르지 않아요", detail)


def is_planning_path(path: str) -> bool:
    return path.startswith(PLANNING_PREFIXES)


def _doc(*codes: int) -> dict[int | str, dict]:
    return {code: {"model": ErrorResponse} for code in codes}


router = APIRouter()


@router.post(
    "/days/{day_id}/planning",
    status_code=201,
    responses=_doc(400, 404, 422),
    summary="계획 대화 시작 (mode=auto면 바로 코스)",
)
def start_planning(day_id: str, body: StartRequest, service: Service) -> PlanningSession | CourseResult:
    return service.start(day_id, body.mode)


@router.post("/planning/{session_id}/answer", responses=_doc(400, 404, 409, 422), summary="첫 질문의 답 또는 알아서 짜 줘")
def answer(session_id: str, body: AnswerRequest, service: Service) -> CandidateBatch | CourseResult:
    return service.answer(session_id, body)


@router.post("/planning/{session_id}/reactions", responses=_doc(400, 404, 409), summary="좋아·넘김·취소")
def reactions(session_id: str, body: ReactionRequest, service: Service) -> Picks:
    return service.react(session_id, body)


@router.post("/planning/{session_id}/next", responses=_doc(400, 404, 409), summary="다음 묶음 (방향 버튼·직접 입력·빈 요청)")
def next_batch(session_id: str, service: Service, body: NextRequest | None = None) -> CandidateBatch:
    return service.next(session_id, body or NextRequest())


@router.post("/planning/{session_id}/compose", responses=_doc(404, 409, 422), summary="코스 짜기")
def compose(session_id: str, service: Service) -> CourseResult:
    return service.compose(session_id)


@router.post("/planning/{session_id}/adjust", responses=_doc(400, 404, 409, 422), summary="머무는 시간 ±15분")
def adjust(session_id: str, body: AdjustRequest, service: Service) -> CourseResult:
    return service.adjust(session_id, body)


@router.post("/planning/{session_id}/back", responses=_doc(404, 409), summary="더 고를래")
def back(session_id: str, service: Service) -> CandidateBatch:
    return service.back(session_id)


@router.post("/course-options/{option_id}/select", responses=_doc(404, 409), summary="코스안 고르기")
def select(option_id: str, service: Service) -> SelectResult:
    return service.select(option_id)


def drop_default_422(schema: dict) -> dict:
    """계획 API의 본문 오류는 400이라 FastAPI가 자동으로 붙인 422(HTTPValidationError) 설명을 지운다.
    COURSE_INFEASIBLE을 직접 적어 둔 422는 남긴다."""
    for path, operations in schema["paths"].items():
        if not is_planning_path(path):
            continue
        for operation in operations.values():
            response = operation["responses"].get("422")
            ref = response and response.get("content", {}).get("application/json", {}).get("schema", {}).get("$ref", "")
            if ref and ref.endswith("/HTTPValidationError"):
                del operation["responses"]["422"]
    return schema
