import logging
import os
import re
import threading
from datetime import UTC, datetime, timedelta
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
from api.account import router as account_router
from api.now import router as now_router
from api.trip import router as trip_router
from api.access import UserId
from api.auth import JwksCache
from api.gate import Gate, UnitOfWork
from api.trips import api_error_handler, router as trips_router, trip_validation_handler
from api.planning import _doc, drop_default_422, http_error_response, is_planning_path, is_trip_path, planning_error_handler, planning_validation_handler, router as planning_router
from engine.compose import Screen, Snapshot, compose_screen
from graphs.planning import build_planning_graph
from planning.repo import MemoryPlanningRepo
from trip.claims import MemoryClaims
from trip.link import AccountLink
from trip.repo import MemoryTripRepo
from trip.service import TripService
from trip.store import MemoryTripStore
from langgraph.checkpoint.memory import MemorySaver
import psycopg
from store.unit import SaverParticipant, StorageUnavailable
from trip.trips import ApiError, TripBook
from places.city import open_city
from planning.schemas import ErrorResponse, SeedChosenResult, SeedRequest, SeedResult
from planning.service import PlanningError, PlanningService
from planning.seed import DEMO_DATES

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
    # TASK-003: 저장소·그래프는 서버 시작 때 한 번 만들고 요청 사이에 이어 쓴다 (AC-16)
    # TASK-003 §10-11 R13: R1은 추적(langsmith) 전송을 강제로 끈다. 켜진 값이 있어도 덮어쓴다 (켜는 것은 나중에 ADR로 결정)
    for name in ("LANGSMITH_TRACING", "LANGSMITH_TRACING_V2", "LANGCHAIN_TRACING_V2"):
        os.environ[name] = "false"
    # TASK-010: 도시 데이터(가짜 또는 실제 오사카 팩)와 여행 저장. 시계는 요청 때마다 읽는다 (테스트가 서버 시작 뒤 바꿔 넣는다)
    app.state.clock = lambda: datetime.now(UTC)
    app.state.city, _fake = open_city()
    app.state.places_provider = app.state.city.provider
    # TASK-012 A2: DATABASE_URL이 있으면 Postgres 저장소·체크포인터, 없으면 지금처럼 메모리. 연결은 요청이 처음 DB를 쓸 때 연다
    # (DB가 닿지 않아도 서버는 켜지고, 저장소를 쓰는 요청만 503 STORAGE_UNAVAILABLE)
    database_url = os.environ.get("DATABASE_URL") or None
    if database_url:
        from store.postgres import PostgresCheckpointer, PostgresClaims, PostgresPlanningRepo, PostgresTripRepo, PostgresTripStore

        app.state.planning_repo = PostgresPlanningRepo(database_url, app.state.city, lambda: app.state.clock())
        app.state.trip_repo = PostgresTripRepo(database_url)
        app.state.trip_store = PostgresTripStore(database_url)
        app.state.claims = PostgresClaims(database_url)
        planning_saver: Any = PostgresCheckpointer(database_url)  # A4: 서버를 다시 켜도 계획 대화가 그 자리에서 이어진다
        trip_saver: Any = PostgresCheckpointer(database_url)
    else:
        app.state.planning_repo = MemoryPlanningRepo()
        app.state.trip_repo = MemoryTripRepo()  # TASK-007: 사건·제안
        app.state.trip_store = MemoryTripStore()
        app.state.claims = MemoryClaims()  # §15 S3: 처리된 익명 사용자
        planning_saver, trip_saver = MemorySaver(), MemorySaver()
    app.state.planning_graph = build_planning_graph(app.state.planning_repo, planning_saver)
    app.state.planning_service = PlanningService(app.state.planning_repo, app.state.planning_graph)
    app.state.trip_service = TripService(app.state.trip_repo, app.state.planning_repo, checkpointer=trip_saver)
    app.state.trip_graph = app.state.trip_service.graph  # G2, 스레드 ID = 사건 ID
    _mask_access_log()
    app.state.trip_book = TripBook(app.state.planning_repo, app.state.city, lambda: app.state.clock(), app.state.trip_store)
    app.state.account_link = AccountLink(app.state.trip_book, app.state.trip_store, app.state.claims)
    app.state.planning_service.before_start = lambda day_id: app.state.trip_book.refresh_hours("planning", day_id)  # §11 H3 ①
    app.state.trip_service.refresh_hours = app.state.trip_book.refresh_hours  # H3 ② ③
    app.state.trip_service.map_id = lambda our_id: (app.state.city.row(our_id) or {}).get("place_id")  # 지도 링크: 실제 여행은 place_id (PM 답 3)
    # TASK-012 A3: 요청 하나 = 트랜잭션 하나. 메모리 저장소는 실패하면 되돌릴 수 있게 상태를 떠 둔다 (§10 Q8)
    app.state.unit = UnitOfWork(
        [app.state.planning_repo, app.state.trip_repo, app.state.trip_store, app.state.claims, SaverParticipant(planning_saver), SaverParticipant(trip_saver)],
        memory=database_url is None,
    )
    # TASK-012 B2: 로그인 토큰의 공개 키는 SUPABASE_URL의 JWKS에서 받아 캐시한다. 없으면 모든 인증 길이 401 (닫힌 채로 실패)
    supabase_url = os.environ.get("SUPABASE_URL")
    app.state.jwks = JwksCache(supabase_url) if supabase_url else None
    if app.state.jwks is None:
        log.warning("SUPABASE_URL이 없어 로그인 토큰을 확인할 수 없음: 인증이 필요한 요청은 모두 401")
    app.state.jev = None
    if os.environ.get("AI_GATEWAY_API_KEY"):
        # Jev가 답하지 못하면 되묻기 (SCREEN-001 §4-3 5번)
        app.state.jev = JevDecider(RuleDecider(lambda *_: None, reason="되묻기"))
        threading.Thread(target=_warm_up, args=(app.state.jev,), name="jev-warm-up", daemon=True).start()
    yield


_PRODUCTION = os.environ.get("APP_ENV", "development") == "production"
# §12 2: 운영이면 API 문서 길을 끈다 (공개 서버에 API 지도를 내놓지 않음). app.openapi() 직접 호출(타입 생성)은 그대로 된다
app = FastAPI(
    title="Tripfriends",
    lifespan=lifespan,
    docs_url=None if _PRODUCTION else "/docs",
    redoc_url=None if _PRODUCTION else "/redoc",
    openapi_url=None if _PRODUCTION else "/openapi.json",
)
app.add_exception_handler(PlanningError, planning_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
app.add_middleware(Gate)  # TASK-012 B2·A3: Bearer 확인 + 요청 하나 = 트랜잭션 하나


@app.exception_handler(StorageUnavailable)
@app.exception_handler(psycopg.OperationalError)
async def storage_unavailable_handler(_request: Request, exc: Exception):
    """TASK-012 §6: DB에 못 붙으면 503 STORAGE_UNAVAILABLE. 응답에 연결 주소·원문을 담지 않는다 (원인은 로그에 종류만)."""
    log.warning("저장소 사용 불가: %s", type(exc).__name__)
    return http_error_response(503, "STORAGE_UNAVAILABLE", "지금 저장소에 못 붙었어요. 잠시 뒤 다시 해 주세요")


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
app.include_router(account_router)

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


    @app.post("/debug/seed-demo", status_code=201, response_model_exclude_unset=True, responses=_doc())
    def debug_seed_demo(request: Request, user: UserId, body: SeedRequest | None = None) -> SeedResult | SeedChosenResult:
        """개발용 데모 여행 (TASK-003 §5). 운영(APP_ENV=production)에서는 길 자체가 없어 404.
        `{"chosen": true}`(TASK-006 A5): 둘째 날을 계획·선택까지 해 둔다.
        TASK-012 §11: 토큰이 필요하고, 데모는 그 사용자 소유(is_demo)다. 지금 여행은 바꾸지 않는다 —
        `{"as_current": true}`일 때만 그 사용자의 지금 여행으로 붙인다 (점검 전용, 이전 여행은 archived)."""
        past_days = body.past_days if body and "past_days" in body.model_fields_set else None
        result = request.app.state.planning_service.seed(chosen=bool(body and body.chosen), past_days=past_days)
        request.app.state.trip_book.attach_demo(
            user,
            result.trip_id,
            result.day_ids,
            list(DEMO_DATES),
            DEMO_DATES[0] + timedelta(days=past_days or 0),
            as_current=bool(body and body.as_current),
        )
        return result
