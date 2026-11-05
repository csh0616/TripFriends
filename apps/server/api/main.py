import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from pydantic import BaseModel

from catalog import get_catalog
from deciders import JevDecider, RuleDecider
from api.planning import drop_default_422, is_planning_path, planning_error_handler, planning_validation_handler, router as planning_router
from engine.compose import Screen, Snapshot, compose_screen
from graphs.planning import build_planning_graph
from planning.repo import MemoryPlanningRepo
from planning.schemas import SeedResult
from planning.service import PlanningError, PlanningService

log = logging.getLogger(__name__)


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
    app.state.planning_repo = MemoryPlanningRepo()
    app.state.planning_graph = build_planning_graph(app.state.planning_repo)
    app.state.planning_service = PlanningService(app.state.planning_repo, app.state.planning_graph)
    app.state.jev = None
    if os.environ.get("AI_GATEWAY_API_KEY"):
        # Jev가 답하지 못하면 되묻기 (SCREEN-001 §4-3 5번)
        app.state.jev = JevDecider(RuleDecider(lambda *_: None, reason="되묻기"))
        threading.Thread(target=_warm_up, args=(app.state.jev,), name="jev-warm-up", daemon=True).start()
    yield


app = FastAPI(title="Tripfriends", lifespan=lifespan)
app.add_exception_handler(PlanningError, planning_error_handler)  # type: ignore[arg-type]


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """TASK-003 §10 Q23: 계획 API의 본문 오류는 400 공통 형식. 그 밖의 API는 FastAPI 기본(422) 그대로."""
    if is_planning_path(request.url.path):
        return planning_validation_handler(request, exc)
    return await request_validation_exception_handler(request, exc)


app.include_router(planning_router)

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

    @app.post("/debug/compose")
    def debug_compose(snapshot: Snapshot) -> Screen:
        return compose_screen(snapshot)


    @app.post("/debug/seed-demo", status_code=201)
    def debug_seed_demo(request: Request) -> SeedResult:
        """개발용 데모 여행 (TASK-003 §5). 운영(APP_ENV=production)에서는 길 자체가 없어 404."""
        return request.app.state.planning_service.seed()
