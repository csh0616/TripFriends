"""장소 공급자 인터페이스 (TASK-010 §A1). 실제(GooglePlaces)와 가짜(FakePlaces)를 같은 모양으로 바꿔 끼운다.

Google 응답 값은 이 모듈 밖으로 나갈 때 우리 모양(details의 다섯 값)으로만 나간다. 로그에 응답을 찍지 않는다.
"""

import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Literal

import httpx



def testdata_dir() -> Path:
    """저장소 루트의 testdata/cities (손으로 만든 가짜 값). mutmut이 복사본 폴더에서 돌려도 찾도록 위로 올라가며 찾는다."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "testdata" / "cities").is_dir():
            return parent / "testdata" / "cities"
    raise FileNotFoundError("testdata/cities를 찾을 수 없어요")


FAKE_PLACES_PATH = testdata_dir() / "osaka-fake.json"

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
DETAILS_URL = "https://places.googleapis.com/v1/places/"
# 필드 마스크: 필요한 필드만 (리뷰·사진은 넣지 않는다, TASK-010 §8)
RESOLVE_MASK = "places.id"
DETAILS_MASK = "id,location,regularOpeningHours.periods,websiteUri,googleMapsUri,businessStatus"
LODGING_MASK = "places.id,places.displayName,places.shortFormattedAddress"
LODGING_LIMIT = 5
LODGING_BIAS = {"latitude": 34.6666, "longitude": 135.5013, "radius": 8000.0}  # 난바역 근처 (B5: 도시 중심 반경 안으로 치우침)
HTTP_TIMEOUT = 3.0  # 초. AI·외부 호출은 시간 제한을 둔다


class ResolveError(Exception):
    """resolve가 장소 하나로 정해지지 않음. reason: not_found(0곳) | ambiguous(여러 곳)."""

    def __init__(self, reason: Literal["not_found", "ambiguous"], query: str):
        super().__init__(f"{reason}: {query}")
        self.reason = reason
        self.query = query


class ProviderAuthError(Exception):
    """인증·요금 오류(응답 401·403·429). 다시 시도하지 않고, 만들기는 전체를 멈춘다 (PM 답 Q2)."""


class ProviderTransientError(Exception):
    """일시 오류(응답 5xx·시간 초과)가 한 번 다시 시도해도 계속됨. 만들기는 그 줄만 provider_error로 뺀다 (PM 답 Q2)."""


AUTH_STATUSES = (401, 403, 429)


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


def _load_fake(path: Path | None) -> dict[str, Any]:
    return json.loads((path or FAKE_PLACES_PATH).read_text(encoding="utf-8"))


class FakePlaces(PlacesProvider):
    """손으로 만든 testdata/cities/osaka-fake.json을 읽는 가짜. Google을 흉내 낸다 (TASK-010 §9 Q5)."""

    def __init__(self, path: Path | None = None):
        self._data = _load_fake(path)

    def resolve(self, query: str, area: str) -> str:
        found = self._data["resolve"].get(query, [])
        if not found:
            raise ResolveError("not_found", query)
        if len(found) > 1:
            raise ResolveError("ambiguous", query)
        return found[0]

    def details(self, place_id: str) -> dict[str, Any]:
        if place_id not in self._data["details"]:
            raise LookupError(f"모르는 place_id: {place_id}")
        found = self._data["details"][place_id]
        return {
            "location": dict(found["location"]),
            "opening_hours": [dict(o) for o in found["opening_hours"]] if found["opening_hours"] is not None else None,
            "website": found["website"],
            "maps_url": found["maps_url"],
            "business_status": found["business_status"],
        }

    def search_lodging(self, q: str) -> list[dict[str, Any]]:
        return [
            {"place_id": hit["place_id"], "name": hit["name"], "address_short": hit["address_short"]}
            for hit in self._data["lodging"]
            if q in hit["name"]
        ]


def _hhmm(hour: int, minute: int) -> str:
    return f"{hour:02d}:{minute:02d}"


def _opening_hours(periods: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    """Places API (New)의 regularOpeningHours.periods -> 엔진 Opening 모양.

    Google의 요일 번호는 0=일요일 ~ 6=토요일이고 엔진은 0=월요일이다 (TASK-010 §10 Q25). 바꾸는 곳은 여기 한 곳.
    닫는 날이 다르면(자정을 넘김) 엔진 표현대로 24 이상의 시로 쓴다 (최대 29:59). close가 없으면 24시간 영업.
    """
    if not periods:
        return None
    result: list[dict[str, Any]] = []
    for period in periods:
        opened, closed = period.get("open"), period.get("close")
        if opened is None:
            continue
        if closed is None:
            return [{"weekday": day, "open": "00:00", "close": "24:00"} for day in range(7)]
        weekday = (opened["day"] - 1) % 7
        extra_days = (closed["day"] - opened["day"]) % 7
        close_hour = closed.get("hour", 0) + 24 * extra_days
        close = _hhmm(close_hour, closed.get("minute", 0)) if close_hour < 30 else "29:59"
        result.append({"weekday": weekday, "open": _hhmm(opened.get("hour", 0), opened.get("minute", 0)), "close": close})
    return result or None


class GooglePlaces(PlacesProvider):
    """Places API (New). 필드 마스크 필수. client는 테스트가 가짜 전송(httpx.MockTransport)을 넣는 자리."""

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self._key = api_key
        self._client = client or httpx.Client(timeout=HTTP_TIMEOUT)

    def _headers(self, mask: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": mask, "Content-Type": "application/json"}

    def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """보내기. 인증·요금 오류는 바로 ProviderAuthError, 5xx·시간 초과는 한 번 다시 시도한 뒤 ProviderTransientError."""
        for attempt in range(2):
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.TimeoutException:
                continue
            if response.status_code in AUTH_STATUSES:
                raise ProviderAuthError(f"Google 응답 {response.status_code}")
            if response.status_code >= 500:
                continue
            response.raise_for_status()
            return response
        raise ProviderTransientError("Google 일시 오류")

    def _search(self, body: dict[str, Any], mask: str) -> list[dict[str, Any]]:
        return self._send("POST", SEARCH_URL, headers=self._headers(mask), json=body).json().get("places", [])

    def resolve(self, query: str, area: str) -> str:
        # 가장 맞는 한 곳만 받는다 (pageSize 1). 한 곳도 없으면 not_found
        found = self._search({"textQuery": query, "pageSize": 1, "languageCode": "ja"}, RESOLVE_MASK)
        if not found:
            raise ResolveError("not_found", query)
        return found[0]["id"]

    def details(self, place_id: str) -> dict[str, Any]:
        body = self._send("GET", DETAILS_URL + place_id, headers=self._headers(DETAILS_MASK)).json()
        where = body["location"]
        return {
            "location": {"lat": where["latitude"], "lng": where["longitude"]},
            "opening_hours": _opening_hours(body.get("regularOpeningHours", {}).get("periods")),
            "website": body.get("websiteUri"),
            "maps_url": body.get("googleMapsUri"),
            "business_status": body.get("businessStatus", "OPERATIONAL"),
        }

    def search_lodging(self, q: str) -> list[dict[str, Any]]:
        body = {
            "textQuery": q,
            "includedType": "lodging",
            "pageSize": LODGING_LIMIT,
            "languageCode": "ko",
            "locationBias": {"circle": {"center": {k: LODGING_BIAS[k] for k in ("latitude", "longitude")}, "radius": LODGING_BIAS["radius"]}},
        }
        return [
            {
                "place_id": hit["id"],
                "name": hit.get("displayName", {}).get("text", ""),
                "address_short": hit.get("shortFormattedAddress", ""),
            }
            for hit in self._search(body, LODGING_MASK)
        ]
