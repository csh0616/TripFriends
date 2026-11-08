"""캐시 수명과 다시 부르기 (TASK-010 §A5, §9 Q7: 나이가 같으면 오래된 것, §11 H1).

디스크 캐시 = 좌표 + fetched_at + Serper가 뽑은 사실 값만. git 밖(apps/server/.cache/)에 둔다 (ADR-015 §3-1).
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Literal

from places.provider import PlacesProvider

Field = Literal["location"]


def _limits() -> dict[str, timedelta]:
    """좌표 30일 (ADR-015 §3-2). 기준 값은 함수 안에 둔다 (돌연변이 대상). 영업시간은 디스크에 두지 않는다 (§11 H1, places/live.py)."""
    return {"location": timedelta(days=30)}


def _refresh_rules() -> dict[str, float]:
    """다시 부르기 한 번에 Google 100회 (§12 답 5: 서버 시작 때 좌표 다시 부르기 상한), 요청 간격 0.1초 이상."""
    return {"google_cap": 100, "interval": 0.1}


def is_stale(entry: dict[str, Any], field: Field, now: datetime) -> bool:
    """나이가 수명과 같으면 오래된 것이다 (Q7)."""
    return now - datetime.fromisoformat(entry["fetched_at"]) >= _limits()[field]


def needs_refresh(entry: dict[str, Any] | None, now: datetime) -> bool:
    """캐시에 없거나 좌표가 오래됐다."""
    return entry is None or is_stale(entry, "location", now)


def refresh(
    cache: dict[str, Any],
    place_ids: list[str],
    provider: PlacesProvider,
    *,
    now: datetime,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """오래된 좌표만 다시 부른다 (한 번에 Google 100회까지). 반환 (새 캐시, 보고 {calls: {google}, failed: [place_id], stopped: bool}).

    다시 부르다 실패하면 이전 좌표를 그대로 쓰고 failed에 적는다. Google의 영업시간 등은 받아도 버린다 (§11 H1)."""
    rules = _refresh_rules()
    result = dict(cache)
    calls, failed, stopped = 0, [], False
    last: float | None = None
    for place_id in dict.fromkeys(place_ids):
        entry = cache.get(place_id)
        if not needs_refresh(entry, now):
            continue
        if calls >= rules["google_cap"]:
            stopped = True
            break
        if last is not None and clock() - last < rules["interval"]:
            sleep(rules["interval"] - (clock() - last))
        last = clock()
        calls += 1
        try:
            found = provider.details(place_id)
        except Exception:  # 공급자 실패는 계획을 멈추지 않는다. 원인 문장은 남기지 않는다
            failed.append(place_id)
            continue
        fresh: dict[str, Any] = {"location": found["location"], "fetched_at": now.isoformat()}
        if entry is not None and entry.get("serper"):
            fresh["serper"] = entry["serper"]  # Serper 사실 값은 만들 때 것 그대로
        result[place_id] = fresh
    return result, {"calls": {"google": calls}, "failed": failed, "stopped": stopped}


def load_cache(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def save_cache(path: Path, cache: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
