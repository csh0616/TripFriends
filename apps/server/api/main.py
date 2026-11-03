import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from catalog import get_catalog
from deciders import JevDecider, RuleDecider
from engine.compose import Screen, Snapshot, compose_screen

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """서버 시작 때 Jev 연결을 한 번 미리 연다 (TASK-001 §9-1 AC-24). 실패해도 서버는 시작한다."""
    app.state.jev = None
    if os.environ.get("AI_GATEWAY_API_KEY"):
        # Jev가 답하지 못하면 되묻기 (SCREEN-001 §4-3 5번)
        app.state.jev = JevDecider(RuleDecider(lambda *_: None, reason="되묻기"))
        try:
            app.state.jev.warm_up()
        except Exception as error:  # 예열 실패는 서버 시작을 막지 않는다
            log.warning("Jev 예열 실패: %s", type(error).__name__)
    yield


app = FastAPI(title="Tripfriends", lifespan=lifespan)


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
