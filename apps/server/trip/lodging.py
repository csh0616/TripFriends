"""숙소 입력 검사·정리와 좌표 풀이 (TASK-015 §A·§9·§11~§14). 순수 함수: 같은 입력 -> 같은 결과.

저장 모양은 여섯 칸이 늘 있는 dict `{kind, place_id, address_text, lat, lng, label}` 또는 None.
좌표를 가지는 것은 pin뿐이다. place·address는 place_id로 그때그때 좌표를 구한다 (Google 좌표 30일 규칙은 CityData가 지킨다).
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any

from trip.detect import _distance_m

KINDS = ("place", "address", "pin")
FIELDS = ("kind", "place_id", "address_text", "lat", "lng", "label")


def _limits() -> dict[str, int]:
    """기준 값 (돌연변이 대상): 이름표 최대 글자, pin이 도시 중심에서 이 거리(m) 이상이면 밖 (§9 Q5, §13 Q2)."""
    return {"label_max": 30, "pin_max_m": 50_000}


class LodgingError(Exception):
    """400 INVALID_LODGING의 이유 하나 (§11 Q1). 순서: invalid_kind -> missing_field -> invalid_type -> coords_not_allowed -> field_not_allowed -> label_too_long -> too_far."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _kind(raw: dict[str, Any]) -> str:
    kind = raw.get("kind")
    if _blank(kind):
        raise LodgingError("missing_field")  # null·빈 글·공백만 (§13 Q7, §14 Q4)
    if not isinstance(kind, str) or kind not in KINDS:  # 정확 일치만: " pin "도 invalid_kind (§14 Q4). 숫자·참거짓·목록·객체도 여기
        raise LodgingError("invalid_kind")
    return kind


def normalize(raw: dict[str, Any], center: tuple[float, float] | None) -> dict[str, Any]:
    """요청 본문의 숙소 -> 저장 모양. 틀리면 LodgingError(reason). center = 도시 중심 (pin 거리 검사용)."""
    kind = _kind(raw)
    place_id, address, lat, lng, label = raw.get("place_id"), raw.get("address_text"), raw.get("lat"), raw.get("lng"), raw.get("label")
    if kind == "place" and _blank(place_id):  # 없음·빈 글만 missing_field. 값이 있는데 글자가 아니면 invalid_type (§15 Q2)
        raise LodgingError("missing_field")
    if kind == "address" and (_blank(address) or _blank(place_id)):  # 주소는 글과 place_id 둘 다 필수 (§17 Q-C)
        raise LodgingError("missing_field")
    if kind == "pin" and (lat is None or lng is None):
        raise LodgingError("missing_field")
    # kind 밖 여섯 칸 타입 오류: 글자 칸은 str·null, 좌표 칸은 숫자(bool 제외)·null (§15 Q1). null은 타입 오류가 아니다
    if any(v is not None and not isinstance(v, str) for v in (place_id, address, label)) or any(v is not None and not _number(v) for v in (lat, lng)):
        raise LodgingError("invalid_type")
    if kind != "pin" and (lat is not None or lng is not None):
        raise LodgingError("coords_not_allowed")  # 조용히 버리지 않는다 (§9 Q4)
    if (kind != "address" and not _blank(address)) or (kind == "pin" and not _blank(place_id)):
        raise LodgingError("field_not_allowed")  # kind에 속하지 않는 글자 칸(label 제외)에 값이 있으면 (§17 Q-D, §18). 빈 글은 null로 받는다
    text = label.strip() if isinstance(label, str) else None
    if text is not None and len(text) > _limits()["label_max"]:
        raise LodgingError("label_too_long")  # 자르지 않는다 (§11 Q2)
    if kind == "pin" and center is not None:
        meters = _distance_m(center, (float(lat), float(lng)))
        if round(meters, 6) >= _limits()["pin_max_m"]:  # detect._within처럼 소수 6자리 반올림 뒤 비교: 정확히 50km는 밖 (§13 Q2)
            raise LodgingError("too_far")
    kept_place = place_id.strip() if isinstance(place_id, str) and place_id.strip() else None
    return {
        "kind": kind,
        "place_id": kept_place if kind != "pin" else None,
        "address_text": address.strip() if kind == "address" else None,
        "lat": float(lat) if kind == "pin" else None,
        "lng": float(lng) if kind == "pin" else None,
        "label": text or None,
    }


def from_place_id(place_id: str | None) -> dict[str, Any] | None:
    """옛 요청 칸 lodging_place_id -> {kind: place} (요청에서만, §9)."""
    if not place_id:
        return None
    return {"kind": "place", "place_id": place_id, "address_text": None, "lat": None, "lng": None, "label": None}


def location(lodging: dict[str, Any] | None, place_location: Callable[[str, datetime], tuple[float, float] | None], now: datetime) -> tuple[float, float] | None:
    """숙소의 좌표. pin은 찍은 좌표, place·address는 place_id의 좌표(캐시 30일). 못 구하면 None = 숙소 없음 (§30 Q6)."""
    if lodging is None:
        return None
    if lodging["kind"] == "pin":
        return float(lodging["lat"]), float(lodging["lng"])
    if not lodging.get("place_id"):
        return None
    return place_location(lodging["place_id"], now)
