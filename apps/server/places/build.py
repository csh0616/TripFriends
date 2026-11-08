"""만들기 명령의 본체 (TASK-010 §A2~§A4·§A7). 껍데기."""

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from places.provider import PlacesProvider


@dataclass
class BuildResult:
    pack: dict[str, Any]  # {city_code, timezone, places: [seed 값 + place_id]} — git에 올리는 것, Google 값 없음
    cache: dict[str, Any]  # {place_id: {Google 값 + fetched_at + 영업시간 출처}} — git 밖
    report: dict[str, Any]  # {excluded: [{id, reason}], calls: {google, serper}, stopped: bool}


def build_city(
    city_code: str,
    rows: list[dict[str, Any]],
    places: PlacesProvider,
    serper: Any,
    *,
    now: datetime,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> BuildResult:
    raise NotImplementedError
