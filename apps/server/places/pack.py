"""도시 팩 + 캐시 -> 엔진 장소·화면 facts (TASK-010 §A8·§B7). 껍데기."""

from typing import Any

from engine.models import Place


def facts_for(row: dict[str, Any], entry: dict[str, Any] | None) -> list[dict[str, Any]]:
    """[{field, value, status, source_type, source_url, checked_at}]"""
    raise NotImplementedError


def engine_places(pack: dict[str, Any], cache: dict[str, Any]) -> dict[str, Place]:
    """demo_city.json과 같은 모양의 장소 목록 (엔진 코드는 그대로)."""
    raise NotImplementedError
