"""서버가 쓰는 도시 데이터 한 덩어리 (TASK-010 §A5·§A8·§B4). 도시 팩 + 캐시 + 공급자.

- 가짜 모드(PLACES_PROVIDER=fake 또는 키 없음): 서버 시작 때 가짜 seed + FakePlaces로 팩을 **메모리에서** 만든다. 파일을 쓰지 않는다 (§9 Q11).
- 실제 모드: places/packs/osaka.json + .cache/places/osaka.json을 읽고, 오래된 것만 다시 부른다. 팩이 없으면 가짜로 켠다 (경고 한 줄).
"""

import json
import logging
import os
import threading
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from engine.models import Place
from places.build import DEFAULT_CAPS, build_pack
from places.cache import load_cache, needs_refresh, refresh, save_cache
from places.factory import FAKE_WARNING, make_providers
from places.pack import engine_places, facts_for, source_types
from places.provider import FakePlaces, PlacesProvider
from places.seed import load_seed

log = logging.getLogger(__name__)
SERVER = Path(__file__).resolve().parents[1]
PACK_PATH = SERVER / "places" / "packs" / "osaka.json"
CACHE_PATH = SERVER / ".cache" / "places" / "osaka.json"
FAKE_SEED = SERVER.parents[1] / "testdata" / "cities" / "osaka-seed-fake.yaml"
SEARCH_LIMIT = 10  # B4


def _no_sleep(_seconds: float) -> None:
    return None


class CityData:
    def __init__(
        self,
        pack: dict[str, Any],
        cache: dict[str, Any],
        provider: PlacesProvider,
        *,
        cache_path: Path | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.pack, self.cache, self.provider = pack, cache, provider
        self._cache_path = cache_path  # None이면 파일에 쓰지 않는다 (가짜 모드)
        self._sleep = sleep
        self._lock = threading.RLock()

    @property
    def city_code(self) -> str:
        return self.pack["city_code"]

    @property
    def timezone(self) -> str:
        return self.pack["timezone"]

    def row(self, our_id: str) -> dict[str, Any] | None:
        return next((row for row in self.pack["places"] if row["id"] == our_id), None)

    def engine_places(self) -> dict[str, Place]:
        with self._lock:
            return engine_places(self.pack, self.cache)

    def sources(self) -> dict[str, str]:
        with self._lock:
            return source_types(self.pack, self.cache)

    def center(self) -> tuple[float, float]:
        """숙소가 없을 때 하루 시작점 (§9 Q10). 좌표는 캐시에서만 온다."""
        location = self.cache[self.pack["center"]["place_id"]]["location"]
        return location["lat"], location["lng"]

    def facts(self, row: dict[str, Any]) -> list[dict[str, Any]]:
        with self._lock:
            return facts_for(row, self.cache.get(row["place_id"]))

    def search(self, q: str) -> list[dict[str, Any]]:
        """이름·별칭 부분 일치, 최대 10개 (B4). 빈 글이면 []."""
        needle = q.strip().casefold()
        if not needle:
            return []
        hits = [row for row in self.pack["places"] if any(needle in text.casefold() for text in [row["name_ko"], *row["aliases"]])]
        return hits[:SEARCH_LIMIT]

    def _all_place_ids(self) -> list[str]:
        return [self.pack["center"]["place_id"], *(row["place_id"] for row in self.pack["places"])]

    def refresh(self, now: datetime, place_ids: list[str] | None = None) -> dict[str, Any]:
        """오래된 것만 다시 부른다 (한 번에 Google 30회까지, A5·A7). 실패한 곳은 이전 값 + 미확인."""
        with self._lock:
            self.cache, report = refresh(self.cache, place_ids or self._all_place_ids(), self.provider, now=now, sleep=self._sleep)
            if self._cache_path is not None:
                save_cache(self._cache_path, self.cache)
            return report

    def lodging_location(self, place_id: str, now: datetime) -> tuple[float, float] | None:
        """고른 숙소의 좌표. 캐시(30일)에 두고, 못 구하면 None (여행은 숙소 없이도 만들어진다)."""
        with self._lock:
            if needs_refresh(self.cache.get(place_id), now):
                try:
                    self.cache[place_id] = {**self.provider.details(place_id), "fetched_at": now.isoformat()}
                except Exception as error:  # 숙소 좌표를 못 구해도 여행 만들기는 계속
                    log.warning("숙소 좌표를 못 구함: %s", type(error).__name__)
                    return None
            location = self.cache[place_id]["location"]
            return location["lat"], location["lng"]


def fake_city() -> CityData:
    """가짜 seed + FakePlaces로 메모리에서 만든 팩 (파일 안 씀)."""
    from places.serper import FakeSerper

    provider = FakePlaces()
    built = build_pack(load_seed(FAKE_SEED), provider, DEFAULT_CAPS, serper=FakeSerper(), now=datetime.now(UTC), sleep=_no_sleep)
    return CityData(built.pack, built.cache, provider, sleep=_no_sleep)


def open_city(env: Mapping[str, str] | None = None, *, now: datetime | None = None) -> tuple[CityData, bool]:
    """서버 시작 때 한 번. (도시 데이터, 가짜인가). 경고는 한 줄."""
    env = os.environ if env is None else env
    provider, _serper, fake = make_providers(env)
    if fake:
        return fake_city(), True
    if not PACK_PATH.is_file():
        log.warning("도시 팩이 없어 가짜 장소로 켬 (uv run python -m places build osaka 필요). %s", FAKE_WARNING)
        return fake_city(), True
    city = CityData(json.loads(PACK_PATH.read_text(encoding="utf-8")), load_cache(CACHE_PATH), provider, cache_path=CACHE_PATH)
    try:
        city.refresh(now or datetime.now(UTC))  # 서버 시작 때 오래된 것을 다시 부른다 (A5)
    except Exception as error:
        log.warning("시작 때 장소 값 다시 부르기 실패: %s", type(error).__name__)
    return city, False
