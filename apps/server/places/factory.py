"""환경 변수로 공급자 고르기 (TASK-010 §K·§6). 키 값은 어디에도 찍지 않는다.

PLACES_PROVIDER=fake 이거나 GOOGLE_PLACES_API_KEY가 없으면 가짜 공급자로 켜지고 경고 한 줄.
"""

import logging
import os
from collections.abc import Mapping
from typing import Any

from places.provider import FakePlaces, GooglePlaces, PlacesProvider
from places.serper import FakeSerper, SerperSearch

log = logging.getLogger(__name__)
FAKE_WARNING = "가짜 장소 공급자 사용 중"


class NullSerper:
    """Serper 키가 없을 때: 보완을 건너뛴다 (영업시간은 '모름'으로 남는다)."""

    def search(self, q: str) -> list[dict[str, Any]]:
        return []


def make_providers(env: Mapping[str, str] | None = None) -> tuple[PlacesProvider, Any, bool]:
    """(장소 공급자, Serper 검색, 가짜인가)."""
    env = os.environ if env is None else env
    google_key = env.get("GOOGLE_PLACES_API_KEY")
    if env.get("PLACES_PROVIDER") == "fake" or not google_key:
        log.warning(FAKE_WARNING)
        return FakePlaces(), FakeSerper(), True
    serper_key = env.get("SERPER_API_KEY")
    if not serper_key:
        log.warning("SERPER_API_KEY 없음: 영업시간 보완을 건너뜀")
    return GooglePlaces(google_key), SerperSearch(serper_key) if serper_key else NullSerper(), False
