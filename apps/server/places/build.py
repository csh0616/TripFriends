"""만들기 명령의 본체 (TASK-010 §A2~§A4·§A7, §9 Q21 `build_pack(seed, provider, caps)`, §11 H1).

seed를 읽어 resolve -> details -> ① 도시 팩(seed 값 + place_id만, git) ② 캐시(좌표 + fetched_at + Serper 사실 값, git 밖).
Google에 영업시간이 없을 때만 Serper를 한 번 부른다. 문장은 어디에도 남기지 않는다 (값만).
"""

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from engine.planning import distance_km
from places.provider import PlacesProvider, ProviderTransientError, ResolveError
from places.serper import extract_closed_days, extract_hours

DEFAULT_CAPS: dict[str, int] = {"google": 300, "serper": 100}  # §A7: 만들기 한 번에 google 300 · serper 100
MIN_INTERVAL = 0.1  # §A7: 요청 간격 0.1초 이상


def _interval() -> float:
    return MIN_INTERVAL


def _area_radius_km() -> float:
    """찾은 곳이 지역 중심에서 이보다 멀면 ambiguous로 뺀다 (PM 답 Q2). 정확히 3.0km는 넣는다 (1.5km 대안 반경과 같은 '정각 포함')."""
    return 3.0


@dataclass
class BuildResult:
    pack: dict[str, Any]  # {city_code, timezone, center: {name_ko, place_id}, places: [seed 줄 + place_id]} — git, Google 값 없음
    cache: dict[str, Any]  # {place_id: {location, fetched_at(ISO), serper?}} — git 밖 (§11 H1: Google 영업시간 등은 없음)
    report: dict[str, Any]  # {excluded: [{id, reason}], calls: {google, serper}, stopped: bool, hours: {id: google|serper|None}}


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
    hours_source: dict[str, str | None] = {}
    fetched_at = now.isoformat()

    def fetch(query: str, area: str) -> tuple[str, dict[str, Any]]:
        """(place_id, 받은 details). 디스크에 남기는 것은 좌표뿐이라 나머지는 호출한 쪽에서 버린다 (§11 H1)."""
        place_id = calls.call("google", provider.resolve, query, area)
        return place_id, calls.call("google", provider.details, place_id)

    center_id = None
    area_pins: dict[str, dict[str, Any]] = {}
    area_centers: dict[str, tuple[float, float]] = {}
    resolved: dict[str, tuple[str, dict[str, Any]]] = {}  # 같은 query는 한 번만 부른다 (난바역 = center)
    try:
        for name, query, area in [("center", seed["center"]["query"], "center"), *((a["id"], a["query"], a["id"]) for a in seed.get("areas", []))]:
            if query not in resolved:
                resolved[query] = fetch(query, area)
            place_id, found = resolved[query]
            cache[place_id] = {"location": found["location"], "fetched_at": fetched_at}  # 좌표만 (좌표는 캐시에만)
            if name == "center":
                center_id = place_id
            else:
                area_pins[name] = {"name_ko": next(a["name_ko"] for a in seed["areas"] if a["id"] == name), "place_id": place_id}
                area_centers[name] = (found["location"]["lat"], found["location"]["lng"])
    except _CapExceeded:
        pass

    for number, row in enumerate(seed["places"]):
        try:
            place_id, details = fetch(row["query"], row["area"])
        except ResolveError as error:
            excluded.append({"id": row["id"], "reason": error.reason})
            continue
        except ProviderTransientError:  # 일시 오류: 그 줄만 뺀다. 인증·요금 오류(ProviderAuthError)는 그대로 밖으로 나가 전체를 멈춘다
            excluded.append({"id": row["id"], "reason": "provider_error"})
            continue
        except _CapExceeded:
            excluded.extend({"id": left["id"], "reason": "cap_exceeded"} for left in seed["places"][number:])
            break
        if details["business_status"] == "CLOSED_PERMANENTLY":
            excluded.append({"id": row["id"], "reason": "closed_permanently"})
            continue
        near = area_centers.get(row["area"])
        if near is not None and distance_km(near, (details["location"]["lat"], details["location"]["lng"])) > _area_radius_km():
            excluded.append({"id": row["id"], "reason": "ambiguous"})  # 엉뚱한 곳을 찾았을 가능성 (PM 답 Q2)
            continue
        entry: dict[str, Any] = {"location": details["location"], "fetched_at": fetched_at}  # Google 영업시간·사이트·지도 링크는 디스크에 두지 않는다
        has_google_hours = bool(details["opening_hours"])
        if not has_google_hours and details["business_status"] != "CLOSED_TEMPORARILY":
            found = _supplement(row, serper, calls)
            if found:
                entry["serper"] = found
        cache[place_id] = entry
        hours_source[row["id"]] = "google" if has_google_hours else "serper" if entry.get("serper", {}).get("hours") else None
        rows.append({**row, "place_id": place_id})

    pack = {
        "city_code": seed["city_code"],
        "timezone": seed["timezone"],
        "center": {"name_ko": seed["center"]["name_ko"], "place_id": center_id},
        "areas": area_pins,
        "places": rows,
    }
    # hours: 영업시간을 어디서 얻을 수 있었나 (채움 비율 측정용, A6). 값 자체는 담지 않는다
    report = {"excluded": excluded, "calls": dict(calls.used), "stopped": calls.stopped, "hours": hours_source}
    return BuildResult(pack=pack, cache=cache, report=report)
