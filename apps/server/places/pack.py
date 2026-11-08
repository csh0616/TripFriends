"""도시 팩 + 캐시 -> 엔진 장소·화면 facts (TASK-010 §A8·§B7).

영업시간 fact의 출처·상태 (§9 Q4, ADR-015 §3-5):
  Google에서 이번에 받은 영업시간 = google · confirmed (checked_at = fetched_at). 다시 받기 실패 = unverified.
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


def _hours(entry: dict[str, Any] | None) -> dict[str, Any]:
    """{openings, status, source_type, source_url, checked_at}."""
    unknown = {"openings": None, "status": "unknown", "source_type": "google", "source_url": None, "checked_at": None}
    if entry is None or entry.get("business_status") == CLOSED_TEMPORARILY:
        return unknown
    if entry.get("opening_hours"):
        status = "unverified" if entry.get("refresh_failed") else "confirmed"
        return {"openings": entry["opening_hours"], "status": status, "source_type": "google", "source_url": None, "checked_at": entry["fetched_at"]}
    serper = entry.get("serper")
    openings = _serper_openings(serper) if serper else None
    if openings:
        return {"openings": openings, "status": "unverified", "source_type": "serper", "source_url": serper.get("source_url"), "checked_at": entry["fetched_at"]}
    return unknown


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


def facts_for(row: dict[str, Any], entry: dict[str, Any] | None) -> list[dict[str, Any]]:
    """[{field, value, status, source_type, source_url, checked_at}]"""
    hours = _hours(entry)
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
    if serper and serper.get("closed_days") is not None and entry.get("business_status") != CLOSED_TEMPORARILY:  # type: ignore[union-attr]
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
    for field, key in (("website", "website"), ("maps_url", "maps_url")):
        if entry and entry.get(key):
            facts.append({"field": field, "value": entry[key], "status": "confirmed", "source_type": "google", "source_url": entry[key], "checked_at": entry["fetched_at"]})
    return facts


def engine_places(pack: dict[str, Any], cache: dict[str, Any]) -> dict[str, Place]:
    """demo_city.json과 같은 모양의 장소 목록 (엔진 코드는 그대로). 좌표가 아직 캐시에 없는 곳은 뺀다."""
    found: dict[str, Place] = {}
    for row in pack["places"]:
        entry = cache.get(row["place_id"])
        if not entry or not entry.get("location"):
            continue
        hours = _hours(entry)
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


def source_types(pack: dict[str, Any], cache: dict[str, Any]) -> dict[str, str]:
    """우리 id -> 영업시간 fact의 출처 (계획 화면의 출처 표시용)."""
    return {row["id"]: _hours(cache.get(row["place_id"]))["source_type"] for row in pack["places"]}
