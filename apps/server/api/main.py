import logging
import os
import re
import threading
from datetime import UTC, datetime
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel

from catalog import get_catalog
from deciders import JevDecider, RuleDecider
from api.now import router as now_router
from api.trip import router as trip_router
from api.trips import api_error_handler, router as trips_router, trip_validation_handler
from api.planning import drop_default_422, http_error_response, is_planning_path, is_trip_path, planning_error_handler, planning_validation_handler, router as planning_router
from engine.compose import Screen, Snapshot, compose_screen
from graphs.planning import build_planning_graph
from planning.repo import MemoryPlanningRepo
from trip.repo import MemoryTripRepo
from trip.service import TripService
from trip.trips import ApiError, TripBook
from places.city import open_city
from planning.schemas import ErrorResponse, SeedChosenResult, SeedRequest, SeedResult
from planning.service import PlanningError, PlanningService

log = logging.getLogger(__name__)

# TASK-010 §9 Q19·§E5: 요청 기록 줄(uvicorn.access)은 남기되 쿼리의 위치 값만 가린다 (실제 GPS는 TASK-011, 그 전의 바닥)
_POSITION_QUERY = re.compile(r"([?&](?:lat|lng|lon|latitude|longitude)=)[^&\s\"]*", re.IGNORECASE)


class MaskPosition(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _POSITION_QUERY.sub(r"\1***", record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_POSITION_QUERY.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args)
        return True


def _mask_access_log() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, MaskPosition) for f in access.filters):
        access.addFilter(MaskPosition())


def _warm_up(jev: JevDecider) -> None:
    try:
        jev.warm_up()
    except Exception as error:  # 예열 실패는 서버를 막지 않는다
        log.warning("Jev 예열 실패: %s", type(error).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """서버 시작 때 Jev 연결을 한 번 미리 연다 (TASK-001 §9-1 AC-24).

    예열은 뒤에서 돌고 서버 시작은 기다리지 않는다 (§9-3). 예열 중 요청도 판단 시간 제한(0.8초)을 따른다.
    """
    # TASK-003: 저장소·그래프(MemorySaver)는 서버 시작 때 한 번 만들고 요청 사이에 이어 쓴다 (AC-16)
    # TASK-003 §10-11 R13: R1은 추적(langsmith) 전송을 강제로 끈다. 켜진 값이 있어도 덮어쓴다 (켜는 것은 나중에 ADR로 결정)
    for name in ("LANGSMITH_TRACING", "LANGSMITH_TRACING_V2", "LANGCHAIN_TRACING_V2"):
        os.environ[name] = "false"
    app.state.planning_repo = MemoryPlanningRepo()
    app.state.planning_graph = build_planning_graph(app.state.planning_repo)
    app.state.planning_service = PlanningService(app.state.planning_repo, app.state.planning_graph)
    app.state.trip_repo = MemoryTripRepo()  # TASK-007: 사건·제안
    app.state.trip_service = TripService(app.state.trip_repo, app.state.planning_repo)
    app.state.trip_graph = app.state.trip_service.graph  # G2, 스레드 ID = 사건 ID
    _mask_access_log()
    # TASK-010: 도시 데이터(가짜 또는 실제 오사카 팩)와 여행 저장. 시계는 요청 때마다 읽는다 (테스트가 서버 시작 뒤 바꿔 넣는다)
    app.state.clock = lambda: datetime.now(UTC)
    app.state.city, _fake = open_city()
    app.state.places_provider = app.state.city.provider
    app.state.trip_book = TripBook(app.state.planning_repo, app.state.city, lambda: app.state.clock())
    app.state.planning_service.before_start = app.state.trip_book.refresh_for_day  # §A5
    app.state.jev = None
    if os.environ.get("AI_GATEWAY_API_KEY"):
        # Jev가 답하지 못하면 되묻기 (SCREEN-001 §4-3 5번)
        app.state.jev = JevDecider(RuleDecider(lambda *_: None, reason="되묻기"))
        threading.Thread(target=_warm_up, args=(app.state.jev,), name="jev-warm-up", daemon=True).start()
    yield


app = FastAPI(title="Tripfriends", lifespan=lifespan)
app.add_exception_handler(PlanningError, planning_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """TASK-003 §10 Q23: 계획 API의 본문 오류는 400 공통 형식. 그 밖의 API는 FastAPI 기본(422) 그대로."""
    if is_trip_path(request.url.path):
        return trip_validation_handler(exc)  # TASK-010 §9 Q13: 여행 API는 400 VALIDATION_ERROR
    if is_planning_path(request.url.path):
        return planning_validation_handler(request, exc)
    return await request_validation_exception_handler(request, exc)




@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    """TASK-003 §10-10 R2·§10-11 R14: 없는 경로(404)와 405 등 모든 HTTP 오류를 공통 형식으로 (이미 만든 PlanningError는 아래 처리기).

    code는 404 NOT_FOUND, 405 INVALID_REQUEST만 문서가 정했다.
    # TASK-003 미정: 그 밖의 4xx는 INVALID_REQUEST, 5xx는 INTERNAL_ERROR로 둔다 (문서에 없는 새 code 값을 만들지 않으려고)
    """
    code = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL_ERROR" if exc.status_code >= 500 else "INVALID_REQUEST"
    # TASK-004 §12-1 A7: 없는 경로의 404는 detail.resource = "route" (이미 만든 리소스 404는 PlanningError가 session·option·day)
    detail = {"resource": "route"} if exc.status_code == 404 else None
    response = http_error_response(exc.status_code, code, str(exc.detail), detail)
    if exc.headers:
        response.headers.update(exc.headers)  # 405의 Allow 등
    return response


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    """TASK-003 §10-11 R11: 처리 중 예기치 못한 예외도 500 공통 형식. 원인은 로그에만 남기고 응답에는 담지 않는다."""
    log.exception("처리되지 않은 예외: %s %s", request.method, request.url.path)
    return http_error_response(500, "INTERNAL_ERROR", "서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요")


app.include_router(planning_router)
app.include_router(now_router)
app.include_router(trip_router)
app.include_router(trips_router)

_default_openapi = app.openapi


def _openapi() -> dict[str, Any]:
    return drop_default_422(_default_openapi())


app.openapi = _openapi  # type: ignore[method-assign]


class Health(BaseModel):
    ok: bool
    cards: int


class CardInfo(BaseModel):
    id: str
    name: str
    shows: str
    has_place: bool
    props_schema: dict[str, Any]  # props의 JSON Schema


@app.get("/health")
def health() -> Health:
    return Health(ok=True, cards=len(get_catalog()))


@app.get("/catalog")
def catalog() -> list[CardInfo]:
    return [
        CardInfo(
            id=card.id,
            name=card.name,
            shows=card.shows,
            has_place=card.has_place,
            props_schema=card.props.model_json_schema(),
        )
        for card in get_catalog()
    ]


# 개발 환경에서만 연다 (APP_ENV=production이면 닫힘)
if os.environ.get("APP_ENV", "development") != "production":

    @app.post("/debug/compose", responses={400: {"model": ErrorResponse}})
    def debug_compose(snapshot: Snapshot) -> Screen:
        return compose_screen(snapshot)


    @app.post("/debug/seed-demo", status_code=201)
    def debug_seed_demo(request: Request, body: SeedRequest | None = None) -> SeedResult | SeedChosenResult:
        """개발용 데모 여행 (TASK-003 §5). 운영(APP_ENV=production)에서는 길 자체가 없어 404.
        `{"chosen": true}`(TASK-006 A5): 둘째 날을 계획·선택까지 해 둔다."""
        return request.app.state.planning_service.seed(chosen=bool(body and body.chosen))
