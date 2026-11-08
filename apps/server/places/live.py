"""Google 영업시간: 필요할 때 불러 **메모리에만** 1시간 (TASK-010 §11 H2·H4·H6, ADR-015 v1.1).

디스크에는 쓰지 않는다 (서버를 다시 켜면 비어 있다). 여러 곳은 동시에 부르고 전체 2초 안에 돌아오지 못한 곳은 기다리지 않는다.
대체 순서는 fact를 만드는 쪽(places/pack.py)이 정한다: 그 자리 값 -> 메모리 값(미확인) -> Serper 값(미확인) -> 모름.
"""

import threading
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta
from typing import Any

from places.provider import PlacesProvider

CAPS: dict[str, int] = {"planning": 80, "now": 20, "alternatives": 20}  # §11 H6: 계획 세션 하나 · 여행 중 화면 1시간 · 대안 찾기 한 번


def _rules() -> dict[str, Any]:
    """메모리 수명 1시간(같으면 오래된 것, Q7), 한 번 부르기 전체 상한 2초(NFR-02). 기준 값은 함수 안에 둔다 (돌연변이 대상)."""
    return {"ttl": timedelta(hours=1), "deadline": 2.0}


class LiveHours:
    def __init__(self, provider: PlacesProvider, *, deadline: float | None = None):
        self.provider = provider
        self.deadline = _rules()["deadline"] if deadline is None else deadline
        self._memory: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _recall_one(self, place_id: str, now: datetime) -> dict[str, Any] | None:
        with self._lock:
            found = self._memory.get(place_id)
        if found is None:
            return None
        return {**found, "fresh": now - datetime.fromisoformat(found["checked_at"]) < _rules()["ttl"]}

    def recall(self, place_ids: list[str], now: datetime) -> dict[str, dict[str, Any] | None]:
        """부르지 않고 메모리 값만. 수명이 지났으면 fresh False(= 미확인)."""
        return {place_id: self._recall_one(place_id, now) for place_id in place_ids}

    def fetch(self, place_ids: list[str], *, now: datetime, cap: int) -> dict[str, dict[str, Any] | None]:
        """{place_id: 값 | None}. 메모리 값이 1시간 안이면 부르지 않는다 (상한에도 세지 않는다).
        나머지는 cap 개까지 동시에 부르고, 늦거나 실패하거나 cap 밖이면 메모리 값(미확인) 또는 None."""
        result: dict[str, dict[str, Any] | None] = {}
        needed: list[str] = []
        for place_id in dict.fromkeys(place_ids):
            result[place_id] = self._recall_one(place_id, now)
            if result[place_id] is None or not result[place_id]["fresh"]:  # type: ignore[index]
                needed.append(place_id)
        calls = needed[:cap]
        if calls:
            pool = ThreadPoolExecutor(max_workers=len(calls), thread_name_prefix="live-hours")
            futures = {pool.submit(self.provider.details, place_id): place_id for place_id in calls}
            done, _late = wait(futures, timeout=self.deadline)
            pool.shutdown(wait=False, cancel_futures=True)  # 늦은 곳은 기다리지 않는다
            for future in done:
                try:
                    found = future.result()
                except Exception:  # 실패한 곳만 대체 (원인 문장은 남기지 않는다)
                    continue
                value = {"opening_hours": found.get("opening_hours"), "business_status": found.get("business_status", "OPERATIONAL"), "checked_at": now.isoformat()}
                with self._lock:
                    self._memory[futures[future]] = value
                result[futures[future]] = {**value, "fresh": True}
        return result
