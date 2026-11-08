"""장소 공급자 인터페이스 (TASK-010 §A1). 껍데기: 시그니처만."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Literal

import httpx

class ResolveError(Exception):
    """resolve가 장소 하나로 정해지지 않음. reason: not_found(0곳) | ambiguous(여러 곳)."""

    def __init__(self, reason: Literal["not_found", "ambiguous"], query: str):
        super().__init__(f"{reason}: {query}")
        self.reason = reason
        self.query = query


class PlacesProvider(ABC):
    @abstractmethod
    def resolve(self, query: str, area: str) -> str:
        """장소 하나의 place_id. 0곳·여러 곳이면 ResolveError."""

    @abstractmethod
    def details(self, place_id: str) -> dict[str, Any]:
        """{location: {lat, lng}, opening_hours: [{weekday, open, close}] | None, website, maps_url,
        business_status: OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY}"""

    @abstractmethod
    def search_lodging(self, q: str) -> list[dict[str, Any]]:
        """[{place_id, name, address_short}]"""


class FakePlaces(PlacesProvider):
    """손으로 만든 testdata/cities/osaka-fake.json을 읽는 가짜."""

    def __init__(self, path: Path | None = None):
        raise NotImplementedError

    def resolve(self, query: str, area: str) -> str:
        raise NotImplementedError

    def details(self, place_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def search_lodging(self, q: str) -> list[dict[str, Any]]:
        raise NotImplementedError


class GooglePlaces(PlacesProvider):
    """Places API (New). 필드 마스크 필수. client는 테스트가 가짜 전송(httpx.MockTransport)을 넣는 자리."""

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        raise NotImplementedError

    def resolve(self, query: str, area: str) -> str:
        raise NotImplementedError

    def details(self, place_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def search_lodging(self, q: str) -> list[dict[str, Any]]:
        raise NotImplementedError
