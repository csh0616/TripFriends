"""TASK-015 §18 숙소 입력 규칙 두 가지 (서버). 근거: TASK-015 §18 test-writer 남은 질문 표 ·
Q4("pin에 빈 place_id(\"\") -> 값 없음으로 본다(모든 칸: 자른 뒤 빈 글 = null) -> 받는다") ·
Q5("place에 address_text -> field_not_allowed — 규칙을 하나로: kind에 속하지 않는 칸에 값이 있으면(label 제외) field_not_allowed, 좌표만 coords_not_allowed") ·
API-001 2-1 POST /trips (11-16 c9: invalid_kind -> missing_field -> invalid_type -> coords_not_allowed -> field_not_allowed(kind에 속하지 않는 칸에 값 — label 제외,
좌표는 coords_not_allowed) -> label_too_long -> too_far 순으로 하나) · TASK-015 §9 Q4(조용히 버리지 않는다) · §17 Q-C(kind마다 필수 칸) · §17 Q-D.

계약 (§18로 넓힌 것):
    kind마다 속한 칸 (label은 모든 kind):
        place   : place_id
        address : address_text · place_id
        pin     : lat · lng
    속하지 않는 칸에 값이 있으면:
        lat·lng          -> coords_not_allowed (지금 그대로)
        place_id·address_text -> field_not_allowed (§17 Q-D는 pin만 -> §18 Q5로 모든 kind. 지금 새로 걸리는 것: place의 address_text)
    "값이 있다" = 글자 칸이면 앞뒤 공백(공백·탭·줄바꿈)을 자른 뒤 빈 글이 아님. 자른 뒤 빈 글 = null = 값 없음 (§18 Q4 "모든 칸")
        -> 속하지 않는 칸의 빈 글은 받고, 응답·저장 모양에서 그 칸은 null
    글자가 아닌 값(숫자 등)은 지금처럼 invalid_type (field_not_allowed보다 앞)
    reason 순서는 API-001 c9 그대로: invalid_kind -> missing_field -> invalid_type -> coords_not_allowed -> field_not_allowed -> label_too_long -> too_far
"""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from test_task015_lodging import (  # noqa: F401 (픽스처 mem · mem_v3를 이 모듈에 등록)
    ADDR_ID,
    CENTER_V3,
    FAR,
    FIELDS,
    GOOGLE_LODGING_ID,
    LABEL,
    LONG,
    PIN,
    TYPED,
    full,
    install_address_search,
    lodging_reason,
    mem,
    mem_v3,
    pin_body,
    post_trip,
    stores,
)

BLANKS = ["", " ", "   ", "\t", "\n", " \t\n "]
BLANK_IDS = ["빈_글", "공백_하나", "공백_셋", "탭", "줄바꿈", "섞임"]

PLACE = {"kind": "place", "place_id": GOOGLE_LODGING_ID}
ADDRESS = {"kind": "address", "address_text": TYPED, "place_id": ADDR_ID}


# ---------- §18 Q5 place에 address_text = field_not_allowed ----------

FIELD_NOT_ALLOWED_PLACE = [
    pytest.param({**PLACE, "address_text": TYPED}, id="place에_address_text"),
    pytest.param({**PLACE, "address_text": TYPED, "label": LABEL}, id="이름표_있는_place에_address_text"),
    pytest.param(full("place", place_id=GOOGLE_LODGING_ID, address_text=TYPED), id="여섯_칸_place에_address_text"),
    pytest.param({**PLACE, "address_text": f"  {TYPED}  "}, id="앞뒤_공백_붙은_address_text"),
    pytest.param({**PLACE, "address_text": "a"}, id="한_글자_address_text"),
]


@pytest.mark.parametrize("sent", FIELD_NOT_ALLOWED_PLACE)
def test_T15_S18_Q5_place에_address_text_값이_오면_400_field_not_allowed이고_아무것도_저장하지_않는다(mem, sent):
    """§18 Q5 (이전 동작: place의 address_text를 받고 버림 -> 201, 응답 address_text null)."""
    before = stores(mem)
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "INVALID_LODGING"
    assert lodging_reason(response) == "field_not_allowed", response.json()
    assert stores(mem) == before


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({**PLACE, "label": LABEL}, id="place_label"),
        pytest.param({**ADDRESS, "label": LABEL}, id="address_label"),
        pytest.param({**pin_body(), "label": LABEL}, id="pin_label"),
    ],
)
def test_T15_S18_Q5_경계_label은_어느_kind에도_속하지_않는_칸이_아니다(mem_v3, monkeypatch, sent):
    install_address_search(monkeypatch, mem_v3)
    response = post_trip(mem_v3, sent)
    assert response.status_code == 201, response.text
    assert response.json()["lodging"]["label"] == LABEL


def test_T15_S18_Q5_경계_address의_address_text와_place_id는_자기_칸이라_받는다(mem_v3, monkeypatch):
    install_address_search(monkeypatch, mem_v3)
    response = post_trip(mem_v3, ADDRESS)
    assert response.status_code == 201, response.text
    assert response.json()["lodging"] == full("address", address_text=TYPED, place_id=ADDR_ID)


@pytest.mark.parametrize(
    ("sent", "expected"),
    [
        pytest.param({**PLACE, "lat": PIN[0], "lng": PIN[1]}, "coords_not_allowed", id="place_좌표는_coords"),
        pytest.param({**ADDRESS, "lat": PIN[0], "lng": PIN[1]}, "coords_not_allowed", id="address_좌표는_coords"),
        pytest.param({**PLACE, "lat": PIN[0]}, "coords_not_allowed", id="place_위도만도_coords"),
        pytest.param({**pin_body(), "place_id": GOOGLE_LODGING_ID}, "field_not_allowed", id="pin_place_id는_field"),
        pytest.param({**pin_body(), "address_text": TYPED}, "field_not_allowed", id="pin_address_text는_field"),
        pytest.param({**PLACE, "address_text": TYPED}, "field_not_allowed", id="place_address_text는_field"),
    ],
)
def test_T15_S18_Q5_좌표만_coords_not_allowed_그_밖의_속하지_않는_칸은_field_not_allowed(mem, sent, expected):
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == expected, response.json()


# ---------- §18 Q5 순서: API-001 c9 그대로 ----------

ORDER_S18 = [
    # field_not_allowed(place의 address_text)는 coords_not_allowed 다음, label_too_long 앞
    pytest.param({"kind": "house", "address_text": TYPED}, "invalid_kind", id="kind+place에_주소"),
    pytest.param({"kind": "place", "address_text": TYPED}, "missing_field", id="필수칸+place에_주소"),
    pytest.param({"kind": "place", "place_id": "   ", "address_text": TYPED}, "missing_field", id="공백_place_id+place에_주소"),
    pytest.param({**PLACE, "address_text": TYPED, "label": 5}, "invalid_type", id="타입+place에_주소"),
    pytest.param({**PLACE, "address_text": 5}, "invalid_type", id="place의_address_text가_숫자면_타입"),
    pytest.param({**PLACE, "address_text": TYPED, "lat": PIN[0], "lng": PIN[1]}, "coords_not_allowed", id="좌표+place에_주소"),
    pytest.param({**PLACE, "address_text": TYPED, "lat": FAR[0], "lng": FAR[1], "label": LONG}, "coords_not_allowed", id="좌표+place에_주소+label"),
    pytest.param({**PLACE, "address_text": TYPED, "label": LONG}, "field_not_allowed", id="place에_주소+label"),
    pytest.param({**PLACE, "address_text": "   ", "label": LONG}, "label_too_long", id="place에_공백_주소는_값_없음+label"),
    pytest.param({**pin_body(FAR), "place_id": "", "label": LONG}, "label_too_long", id="pin에_빈_place_id는_값_없음+label"),
    pytest.param({**pin_body(FAR), "address_text": " \t "}, "too_far", id="pin에_공백_주소는_값_없음+멀다"),
]


@pytest.mark.parametrize(("sent", "expected"), ORDER_S18)
def test_T15_S18_Q5_여러_조건이_겹치면_API_c9_순서로_먼저_걸린_reason_하나만(request, sent, expected):
    far = FAR[0] in (sent.get("lat"), sent.get("lng"))
    osaka = request.getfixturevalue("mem_v3" if far else "mem")
    before = stores(osaka)
    response = post_trip(osaka, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == expected, response.json()
    assert isinstance(response.json()["error"]["detail"]["reason"], str)
    assert stores(osaka) == before


# ---------- §18 Q4 모든 칸: 자른 뒤 빈 글 = null ----------


@pytest.mark.parametrize("blank", BLANKS, ids=BLANK_IDS)
@pytest.mark.parametrize("field", ["place_id", "address_text"])
def test_T15_S18_Q4_pin의_빈_place_id·address_text는_값_없음이라_받고_응답은_null(mem_v3, field, blank):
    response = post_trip(mem_v3, {**pin_body(), field: blank})
    assert response.status_code == 201, response.text
    assert response.json()["lodging"] == full("pin", lat=PIN[0], lng=PIN[1])


@pytest.mark.parametrize("blank", BLANKS, ids=BLANK_IDS)
def test_T15_S18_Q4_place의_빈_address_text는_값_없음이라_받고_응답은_null(mem, blank):
    response = post_trip(mem, {**PLACE, "address_text": blank})
    assert response.status_code == 201, response.text
    assert response.json()["lodging"] == full("place", place_id=GOOGLE_LODGING_ID)


@pytest.mark.parametrize("blank", BLANKS, ids=BLANK_IDS)
def test_T15_S18_Q4_pin의_place_id와_address_text가_둘_다_빈_글이어도_받는다(mem_v3, blank):
    response = post_trip(mem_v3, {**pin_body(label=LABEL), "place_id": blank, "address_text": blank})
    assert response.status_code == 201, response.text
    assert response.json()["lodging"] == full("pin", lat=PIN[0], lng=PIN[1], label=LABEL)


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": ""}, id="place_빈_place_id"),
        pytest.param({"kind": "address", "address_text": TYPED, "place_id": " \n "}, id="address_공백_place_id"),
        pytest.param({"kind": "address", "address_text": "\t", "place_id": ADDR_ID}, id="address_탭_주소"),
    ],
)
def test_T15_S18_Q4_경계_자기_필수_칸이_빈_글이면_값_없음이라_missing_field(mem, sent):
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "missing_field", response.json()


# ---------- 속성: 규칙 하나 (trip.lodging.normalize, 순수 함수) ----------

_WS = st.text(alphabet=" \t\n", max_size=4)
_FILLED = st.text(alphabet=st.characters(blacklist_categories=("Cs",)), min_size=1, max_size=12).filter(lambda t: t.strip() != "")
_OWN = {"place": {"place_id"}, "address": {"address_text", "place_id"}, "pin": {"lat", "lng"}}
_GOOD = {
    "place": {"kind": "place", "place_id": GOOGLE_LODGING_ID},
    "address": {"kind": "address", "address_text": TYPED, "place_id": ADDR_ID},
    "pin": {"kind": "pin", "lat": PIN[0], "lng": PIN[1]},
}


@settings(max_examples=150, deadline=None)
@given(
    kind=st.sampled_from(["place", "address", "pin"]),
    place_id=st.one_of(st.none(), _WS, _FILLED),
    address=st.one_of(st.none(), _WS, _FILLED),
    label=st.one_of(st.none(), _WS, st.text(min_size=1, max_size=30).filter(lambda t: t.strip() != "")),
)
def test_T15_S18_속성_속하지_않는_글자_칸에_값이_있으면_field_not_allowed_없으면_받고_null(kind, place_id, address, label):
    """맞는 본문에서 place_id·address_text 중 그 kind에 속하지 않는 칸만 바꾼다 (자기 칸은 맞는 값 그대로). 좌표는 건드리지 않는다."""
    from trip.lodging import LodgingError, normalize

    raw = dict(_GOOD[kind])
    foreign = {"place_id": place_id, "address_text": address}
    for name, value in foreign.items():
        if name not in _OWN[kind]:
            raw[name] = value
    raw["label"] = label
    filled = [name for name, value in foreign.items() if name not in _OWN[kind] and isinstance(value, str) and value.strip()]
    if filled:
        with pytest.raises(LodgingError) as caught:
            normalize(raw, CENTER_V3)
        assert caught.value.reason == "field_not_allowed"
        return
    saved = normalize(raw, CENTER_V3)
    assert set(saved) == FIELDS
    for name in foreign:
        if name not in _OWN[kind]:
            assert saved[name] is None, name
    assert saved["label"] == (label.strip() or None if isinstance(label, str) else None)


@settings(max_examples=80, deadline=None)
@given(kind=st.sampled_from(["place", "address"]), lat=st.one_of(st.none(), st.floats(-89, 89)), lng=st.one_of(st.none(), st.floats(-179, 179)), address=st.one_of(st.none(), _FILLED))
def test_T15_S18_속성_좌표가_오면_속하지_않는_글자_칸이_있어도_coords_not_allowed가_먼저(kind, lat, lng, address):
    from trip.lodging import LodgingError, normalize

    raw = {**_GOOD[kind], "lat": lat, "lng": lng}
    if kind == "place":
        raw["address_text"] = address
    if lat is None and lng is None:
        if kind == "place" and address is not None:
            with pytest.raises(LodgingError) as caught:
                normalize(raw, CENTER_V3)
            assert caught.value.reason == "field_not_allowed"
        else:
            assert normalize(raw, CENTER_V3)["kind"] == kind
        return
    with pytest.raises(LodgingError) as caught:
        normalize(raw, CENTER_V3)
    assert caught.value.reason == "coords_not_allowed"
