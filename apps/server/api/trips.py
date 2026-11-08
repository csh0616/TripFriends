"""여행 만들기 엔드포인트 (TASK-010 §B). 얇게: 검사·저장은 `trip.trips.TripBook`이 한다.

오류는 공통 형식 {"error": {code, message, detail}}. 400 VALIDATION_ERROR(detail.field = 틀린 칸), 409 PLAN_EXISTS, 503 PROVIDER_UNAVAILABLE.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from api.planning import _doc, _error
from planning.schemas import CourseResultOption
from trip.trips import CITY_CODE, ApiError, FixedEvent, FixedEventCreate, LodgingHit, PlaceHit, Trip, TripBook, TripCreate, invalid

router = APIRouter()
LODGING_TIMEOUT = 3.0  # 초 (§6: 숙소 검색 3초 넘으면 같은 안내)
LODGING_MIN_CHARS, LODGING_LIMIT = 2, 5  # B5
_lodging_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="lodging-search")
DeviceHeader = Annotated[str | None, Header(alias="X-Device-Id")]


def book(request: Request) -> TripBook:
    return request.app.state.trip_book


def device(value: str | None) -> str:
    """§9 Q16: X-Device-Id가 없거나 비면 400."""
    if value is None or not value.strip():
        raise invalid("X-Device-Id", "X-Device-Id 헤더가 필요해요")
    return value.strip()


def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return _error(exc.status, exc.code, exc.message, exc.detail)


def trip_validation_handler(exc: RequestValidationError) -> JSONResponse:
    """본문·쿼리 형식 오류도 400 VALIDATION_ERROR. detail.field는 body 바로 아래 칸 이름 (입력 원문은 담지 않는다)."""
    loc = [str(part) for part in exc.errors()[0]["loc"] if part not in ("body", "query")]
    return _error(400, "VALIDATION_ERROR", "요청 내용이 올바르지 않아요", {"field": loc[0] if loc else "body"})


def check_city(city_code: str) -> None:
    if city_code != CITY_CODE:
        raise invalid("city_code", "지금은 오사카만 쓸 수 있어요")


@router.post("/trips", status_code=201, responses=_doc(400), summary="여행 만들기 (이전 여행은 archived)")
def create_trip(body: TripCreate, request: Request, x_device_id: DeviceHeader = None) -> Trip:
    return book(request).create(device(x_device_id), body)


@router.get("/trips/current", responses=_doc(400, 404), summary="이 기기의 지금 여행")
def current_trip(request: Request, x_device_id: DeviceHeader = None) -> Trip:
    return book(request).current(device(x_device_id))


@router.get("/trips/{trip_id}", responses=_doc(400, 404), summary="여행 하나")
def get_trip(trip_id: str, request: Request, x_device_id: DeviceHeader = None) -> Trip:
    return book(request).get(trip_id, device(x_device_id))


@router.post("/trips/{trip_id}/fixed-events", status_code=201, responses=_doc(400, 404, 409), summary="고정 일정 추가")
def add_fixed_event(trip_id: str, body: FixedEventCreate, request: Request, x_device_id: DeviceHeader = None) -> FixedEvent:
    return book(request).add_fixed(trip_id, device(x_device_id), body)


@router.delete("/fixed-events/{fixed_event_id}", status_code=204, responses=_doc(400, 404, 409), summary="고정 일정 지우기")
def delete_fixed_event(fixed_event_id: str, request: Request, x_device_id: DeviceHeader = None) -> Response:
    book(request).delete_fixed(fixed_event_id, device(x_device_id))
    return Response(status_code=204)


@router.get("/days/{day_id}/course", responses=_doc(400, 404), summary="그날 고른 코스 (코스안 카드와 같은 모양, 지난 날도 읽힘)")
def chosen_course(day_id: str, request: Request, x_device_id: DeviceHeader = None) -> CourseResultOption:
    return book(request).course(day_id, device(x_device_id))


@router.get("/places/search", responses=_doc(400), summary="장소 검색 (꼭 갈 곳, 도시 팩 안)")
def search_places(city_code: str, request: Request, q: str = "") -> list[PlaceHit]:
    check_city(city_code)
    return book(request).search(q)


@router.get("/places/lodging-search", responses=_doc(400, 503), summary="숙소 검색 (Google 실시간)")
def search_lodging(city_code: str, request: Request, q: str = "") -> list[LodgingHit]:
    check_city(city_code)
    text = q.strip()
    if len(text) < LODGING_MIN_CHARS:
        return []
    future = _lodging_pool.submit(request.app.state.places_provider.search_lodging, text)
    try:
        found: list[dict[str, Any]] = future.result(timeout=LODGING_TIMEOUT)
    except Exception:  # 실패·시간 초과 모두 같은 안내 (원인 문장은 담지 않는다)
        raise ApiError(503, "PROVIDER_UNAVAILABLE", "지금 숙소 검색을 못 해요", None) from None
    return [LodgingHit(**hit) for hit in found[:LODGING_LIMIT]]
