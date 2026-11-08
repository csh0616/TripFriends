"""만들기 명령의 본체 (TASK-010 §A2~§A4·§A7, §9 Q21 `build_pack(seed, provider, caps)`).

seed를 읽어 resolve -> details -> ① 도시 팩(seed 값 + place_id만, git) ② 캐시(Google 값 + fetched_at, git 밖).
Google에 영업시간이 없을 때만 Serper를 한 번 부른다. 문장은 어디에도 남기지 않는다 (값만).
"""

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from places.provider import PlacesProvider, ResolveError
from places.serper import extract_closed_days, extract_hours

DEFAULT_CAPS: dict[str, int] = {"google": 300, "serper": 100}  # §A7: 만들기 한 번에 google 300 · serper 100
MIN_INTERVAL = 0.1  # §A7: 요청 간격 0.1초 이상


def _interval() -> float:
    return MIN_INTERVAL


@dataclass
class BuildResult:
    pack: dict[str, Any]  # {city_code, timezone, center: {name_ko, place_id}, places: [seed 줄 + place_id]} — git, Google 값 없음
    cache: dict[str, Any]  # {place_id: {location, opening_hours, website, maps_url, business_status, fetched_at(ISO), ...}} — git 밖
    report: dict[str, Any]  # {excluded: [{id, reason}], calls: {google, serper}, stopped: bool}


class _CapExceeded(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


class _Calls:
    """호출 수 세기 + 상한 + 간격. 상한에 닿으면 부르지 않고 _CapExceeded."""

    def __init__(self, caps: dict[str, int], clock: Callable[[], float], sleep: Callable[[float], None]):
        self.caps, self.clock, self.sleep = caps, clock, sleep
        self.used = {"google": 0, "serper": 0}
        self.stopped = False
        self._last: float | None = None

    def call(self, kind: str, fn: Callable[..., Any], *args: Any) -> Any:
        if self.used[kind] >= self.caps[kind]:
            self.stopped = True
            raise _CapExceeded(kind)
        if self._last is not None:
            wait = _interval() - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
        self._last = self.clock()
        self.used[kind] += 1
        return fn(*args)


def _supplement(row: dict[str, Any], serper: Any, calls: _Calls) -> dict[str, Any] | None:
    """A3: 값만 뽑아 {hours, closed_days, source_url}. 아무것도 못 뽑으면 None. 문장은 버린다."""
    try:
        hits = calls.call("serper", serper.search, f"{row['query']} 営業時間")
    except _CapExceeded:
        return None
    except Exception:  # 보완 실패는 '모름'으로 둔다
        return None
    texts = [hit["text"] for hit in hits]
    hours, closed = extract_hours(texts), extract_closed_days(texts)
    if hours is None and closed is None:
        return None
    link = next((hit["link"] for hit in hits if (extract_hours([hit["text"]]) if hours else extract_closed_days([hit["text"]])) is not None), None)
    return {"hours": [list(span) for span in hours] if hours else None, "closed_days": closed, "source_url": link}


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
    calls = _Calls(caps, clock, sleep)
    cache: dict[str, Any] = {}
    excluded: list[dict[str, str]] = []
    rows: list[dict[str, Any]] = []
    fetched_at = now.isoformat()

    def fetch(query: str, area: str) -> tuple[str, dict[str, Any]]:
        place_id = calls.call("google", provider.resolve, query, area)
        return place_id, {**calls.call("google", provider.details, place_id), "fetched_at": fetched_at}

    center_id = None
    try:
        center_id, center_entry = fetch(seed["center"]["query"], "center")
        cache[center_id] = center_entry
    except _CapExceeded:
        pass

    for number, row in enumerate(seed["places"]):
        try:
            place_id, entry = fetch(row["query"], row["area"])
        except ResolveError as error:
            excluded.append({"id": row["id"], "reason": error.reason})
            continue
        except _CapExceeded:
            excluded.extend({"id": left["id"], "reason": "cap_exceeded"} for left in seed["places"][number:])
            break
        if entry["business_status"] == "CLOSED_PERMANENTLY":
            excluded.append({"id": row["id"], "reason": "closed_permanently"})
            continue
        if not entry["opening_hours"] and entry["business_status"] != "CLOSED_TEMPORARILY":
            found = _supplement(row, serper, calls)
            if found:
                entry["serper"] = found
        cache[place_id] = entry
        rows.append({**row, "place_id": place_id})

    pack = {
        "city_code": seed["city_code"],
        "timezone": seed["timezone"],
        "center": {"name_ko": seed["center"]["name_ko"], "place_id": center_id},
        "places": rows,
    }
    report = {"excluded": excluded, "calls": dict(calls.used), "stopped": calls.stopped}
    return BuildResult(pack=pack, cache=cache, report=report)
