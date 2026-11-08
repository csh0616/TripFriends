"""만들기 명령의 본체 (TASK-010 §A2~§A4·§A7, §9 Q21 `build_pack(seed, provider, caps)`). 껍데기."""

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from places.provider import PlacesProvider

DEFAULT_CAPS: dict[str, int] = {}  # §A7: 만들기 한 번에 google 300 · serper 100 (구현이 채운다)


@dataclass
class BuildResult:
    pack: dict[str, Any]  # {city_code, timezone, center: {name_ko, place_id}, places: [seed 줄 + place_id]} — git, Google 값 없음
    cache: dict[str, Any]  # {place_id: {location, opening_hours, website, maps_url, business_status, fetched_at(ISO), ...}} — git 밖
    report: dict[str, Any]  # {excluded: [{id, reason}], calls: {google, serper}, stopped: bool}


def build_pack(
    seed: dict[str, Any],
    provider: PlacesProvider,
    caps: dict[str, int],
    *,
    serper: Any,
    now: datetime,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> BuildResult:
    raise NotImplementedError
