import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from catalog import get_catalog
from engine.compose import Screen, Snapshot, compose_screen

app = FastAPI(title="Tripfriends")


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
