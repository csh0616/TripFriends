"""캐시 수명과 다시 부르기 (TASK-010 §A5·§A7). 껍데기."""

import time
from datetime import datetime
from typing import Any, Callable, Literal

from places.provider import PlacesProvider


def is_stale(entry: dict[str, Any], field: Literal["location", "opening_hours"], now: datetime) -> bool:
    raise NotImplementedError


def refresh(
    cache: dict[str, Any],
    place_ids: list[str],
    provider: PlacesProvider,
    *,
    now: datetime,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """오래된 것만 다시 부른다. 반환 (새 캐시, 보고 {calls: {google}, failed: [place_id], stopped: bool})."""
    raise NotImplementedError
