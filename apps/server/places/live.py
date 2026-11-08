"""Google 영업시간: 필요할 때 불러 메모리에만 1시간 (TASK-010 §11 H2·H4·H6). 껍데기: 시그니처만 (test-writer)."""

from datetime import datetime
from typing import Any

from places.provider import PlacesProvider

CAPS: dict[str, int] = {}  # §11 H6: planning 80 · now 20 · alternatives 20 (구현이 채운다)


class LiveHours:
    def __init__(self, provider: PlacesProvider, *, deadline: float = 0.0):
        raise NotImplementedError

    def fetch(self, place_ids: list[str], *, now: datetime, cap: int) -> dict[str, dict[str, Any] | None]:
        raise NotImplementedError
