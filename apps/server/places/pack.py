"""도시 팩 + 캐시 -> 엔진 장소·화면 facts (TASK-010 §A8·§B7).

영업시간 fact의 출처·상태 (§9 Q4, §11 H4·H7, ADR-015 §3-5):
  Google에서 그 자리에서 받은 영업시간 = google · confirmed (checked_at = 받은 시각). 늦거나 실패해 메모리 값을 쓰면 unverified.
  Google에 없고 Serper로 뽑음 = serper · unverified (source_url = 결과 링크). 임시 휴업·못 뽑음 = unknown.
"""

import json
from typing import Any

from engine.models import Opening, Place, StayRange

WEEKDAY_LABELS = "월화수목금토일"
CLOSED_TEMPORARILY = "CLOSED_TEMPORARILY"


def _serper_openings(serper: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Serper가 뽑은 하루 구간 + 휴무 요일 -> 요일별 영업시간. 시각이 없으면 None."""
    spans = serper.get("hours")
    if not spans:
        return None
    closed = serper.get("closed_days")
    off = set(closed) if isinstance(closed, list) else set()
    return [{"weekday": day, "open": low, "close": high} for day in range(7) if day not in off for low, high in spans]


def _curated_openings(row: dict[str, Any]) -> list[dict[str, Any]] | None:
    """우리가 정한 영업시간 (§13). open_space = 늘 열림(7일 00:00~24:00), curated_hours = 그 시간대를 7일 모두. 없으면 None."""
    if row.get("open_space"):
        return [{"weekday": day, "open": "00:00", "close": "24:00"} for day in range(7)]
    spans = row.get("curated_hours")
    if spans:
        return [{"weekday": day, "open": span["open"], "close": span["close"]} for span in spans for day in range(7)]
    return None


def _hours(row: dict[str, Any], entry: dict[str, Any] | None, live: dict[str, Any] | None = None) -> dict[str, Any]:
    """{openings, status, source_type, source_url, checked_at}. 고르는 순서 (§13 O3):
    그 자리에서 받은 Google 값(confirmed) -> 우리가 정한 값 curated(confirmed) -> 메모리 값(unverified) -> Serper 값(unverified) -> 모름.
    임시 휴업(그 자리에서 받은 값)은 늘 열림이어도 모름이 먼저다 (A4)."""
    unknown = {"openings": None, "status": "unknown", "source_type": "google", "source_url": None, "checked_at": None}
    if live is not None and live.get("business_status") == CLOSED_TEMPORARILY:
        return unknown
    google = live is not None and live.get("opening_hours")
    if google and live["fresh"]:  # type: ignore[index]
        return {"openings": live["opening_hours"], "status": "confirmed", "source_type": "google", "source_url": None, "checked_at": live["checked_at"]}  # type: ignore[index]
    curated = _curated_openings(row)
    if curated:
        return {"openings": curated, "status": "confirmed", "source_type": "curated", "source_url": None, "checked_at": None}
    if google:
        return {"openings": live["opening_hours"], "status": "unverified", "source_type": "google", "source_url": None, "checked_at": live["checked_at"]}  # type: ignore[index]
    serper = (entry or {}).get("serper")
    openings = _serper_openings(serper) if serper else None
    if openings:
        return {"openings": openings, "status": "unverified", "source_type": "serper", "source_url": serper.get("source_url"), "checked_at": entry["fetched_at"]}  # type: ignore[index]
    return unknown


def maps_url(place_id: str) -> str:
    """지도 링크는 place_id로 우리가 만든다 (§11 H5). Google이 준 링크를 저장하지 않는다."""
    return f"https://www.google.com/maps/search/?api=1&query=Google&query_place_id={place_id}"


def _hours_text(openings: list[dict[str, Any]] | None) -> str | None:
    """화면용 한 줄. 7일이 모두 같으면 구간만, 아니면 요일마다."""
    if not openings:
        return None
    by_day: dict[int, list[str]] = {}
    for opening in sorted(openings, key=lambda o: (o["weekday"], o["open"], o["close"])):
        by_day.setdefault(opening["weekday"], []).append(f"{opening['open']}-{opening['close']}")
    texts = {day: ",".join(spans) for day, spans in by_day.items()}
    if len(texts) == 7 and len(set(texts.values())) == 1:
        return texts[0]
    return "; ".join(f"{WEEKDAY_LABELS[day]} {text}" for day, text in sorted(texts.items()))


def facts_for(row: dict[str, Any], entry: dict[str, Any] | None, live: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """[{field, value, status, source_type, source_url, checked_at}]. live = places/live.py가 돌려준 Google 영업시간 (메모리 값, 없으면 None)."""
    hours = _hours(row, entry, live)
    facts: list[dict[str, Any]] = [
        {"field": "stay_min", "value": json.dumps(row["stay"]), "status": "confirmed", "source_type": "curated", "source_url": None, "checked_at": None},
        {
            "field": "opening_hours",
            "value": _hours_text(hours["openings"]),
            "status": hours["status"],
            "source_type": hours["source_type"],
            "source_url": hours["source_url"],
            "checked_at": hours["checked_at"],
        },
    ]
    serper = (entry or {}).get("serper")
    if serper and serper.get("closed_days") is not None and not (live and live.get("business_status") == CLOSED_TEMPORARILY):
        days = serper["closed_days"]
        facts.append(
            {
                "field": "closed_days",
                "value": ",".join(str(d) for d in days) if isinstance(days, list) else None,
                "status": "unverified" if isinstance(days, list) else "unknown",
                "source_type": "serper",
                "source_url": serper.get("source_url"),
                "checked_at": entry["fetched_at"],  # type: ignore[index]
            }
        )
    link = maps_url(row["place_id"])
    facts.append({"field": "maps_url", "value": link, "status": "confirmed", "source_type": "google", "source_url": link, "checked_at": None})
    return facts


def engine_places(pack: dict[str, Any], cache: dict[str, Any], live: dict[str, Any] | None = None) -> dict[str, Place]:
    """demo_city.json과 같은 모양의 장소 목록 (엔진 코드는 그대로). 좌표가 아직 캐시에 없는 곳은 뺀다.
    live = {Google place_id: LiveHours 값}. 영업시간은 여기서만 온다 (디스크 캐시에는 없다, §11 H1)."""
    found: dict[str, Place] = {}
    for row in pack["places"]:
        entry = cache.get(row["place_id"])
        if not entry or not entry.get("location"):
            continue
        hours = _hours(row, entry, (live or {}).get(row["place_id"]))
        found[row["id"]] = Place(
            id=row["id"],
            name=row["name_ko"],
            category=row["category"],
            lat=entry["location"]["lat"],
            lng=entry["location"]["lng"],
            crowd_level=row["crowd_level"],
            price_level=row["price_level"],
            mood_tags=list(row["mood_tags"]),
            hours=[Opening(**o) for o in hours["openings"]] if hours["openings"] else None,
            hours_status=hours["status"],
            stay=StayRange(**row["stay"]),
        )
    return found


def source_types(pack: dict[str, Any], cache: dict[str, Any], live: dict[str, Any] | None = None) -> dict[str, str]:
    """우리 id -> 영업시간 fact의 출처 (계획 화면의 출처 표시용)."""
    return {row["id"]: _hours(row, cache.get(row["place_id"]), (live or {}).get(row["place_id"]))["source_type"] for row in pack["places"]}
