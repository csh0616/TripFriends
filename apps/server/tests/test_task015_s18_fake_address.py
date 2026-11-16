"""TASK-015 §18 가짜 공급자(FakePlaces)에 주소 검색에서만 나오는 결과. Maestro `lodging-address.yaml` · reviewer a1 스크린샷용.
근거: TASK-015 §18 "같이 할 것"(reviewer가 못 본 것: 가짜 공급자에 주소 결과 데이터를 더해 시뮬레이터 스크린샷으로 본다 · AC-5 Maestro lodging-*.yaml) ·
§A 표 ②(이름으로 못 찾으면 같은 글을 주소로) · task-015-design §1-2 a1(주소 결과 줄) · TASK-010 §9 Q5(가짜 공급자 = 손으로 만든 가짜 값).

데이터 (testdata/cities/osaka-fake.json, test-writer가 지어낸 값):
    address: [{query: "난바 주소 1-1", place_id: "FAKE-address-1", name: "가짜 주소 장소 1", address_short: "가짜구 난바 주소 1-1"}]
    details["FAKE-address-1"]: location (34.6593, 135.5047) — 오사카 안(도시 중심 v3에서 약 0.8km), 다른 가짜 좌표·center와 겹치지 않음

계약 (backend가 FakePlaces에 넣는다):
    FakePlaces.search_address(q) = search_lodging(q) 결과 + address 표에서 query == q인 줄 ({place_id, name, address_short}만, query 칸은 내보내지 않음)
    -> "난바 주소 1-1": 숙소 검색 0건 · 주소 검색 1건 / 그 밖의 글: 지금 그대로(= 숙소 검색과 같은 결과)
"""

import json

import pytest

from places.provider import FAKE_PLACES_PATH, FakePlaces
from test_task015_lodging import ME, mem  # noqa: F401 (픽스처)
from auth_helpers import bearer

Q = "난바 주소 1-1"
HIT = {"place_id": "FAKE-address-1", "name": "가짜 주소 장소 1", "address_short": "가짜구 난바 주소 1-1"}
AT = (34.6593, 135.5047)
CENTER_V3 = (34.6662, 135.5010)


def _data() -> dict:
    return json.loads(FAKE_PLACES_PATH.read_text(encoding="utf-8"))


# ---------- 데이터 자체 (초록이어야 함: test-writer가 넣었다) ----------


def test_T15_S18_가짜_데이터_주소_표에_한_줄이_있고_FAKE_로_시작한다():
    rows = _data()["address"]
    assert rows == [{"query": Q, **HIT}]
    assert all(row["place_id"].startswith("FAKE-") for row in rows)


def test_T15_S18_가짜_데이터_주소_장소의_좌표는_오사카_안이고_다른_가짜_좌표·center와_겹치지_않는다():
    from trip.detect import _distance_m

    data = _data()
    location = data["details"]["FAKE-address-1"]["location"]
    assert (location["lat"], location["lng"]) == AT
    assert _distance_m(CENTER_V3, AT) < 5_000
    others = [(d["location"]["lat"], d["location"]["lng"]) for pid, d in data["details"].items() if pid != "FAKE-address-1"]
    assert AT not in others
    assert AT[0] not in {lat for lat, _ in others} and AT[1] not in {lng for _, lng in others}
    assert AT[0] != CENTER_V3[0] and AT[1] != CENTER_V3[1]
    assert AT[0] != data["center"]["lat"] and AT[1] != data["center"]["lng"]


def test_T15_S18_가짜_데이터_주소_검색_글은_숙소_이름_어디에도_없다():
    assert all(Q not in row["name"] for row in _data()["lodging"])


# ---------- 가짜 공급자 동작 (backend 구현 전 빨강) ----------


def test_T15_S18_가짜_공급자_난바_주소_1_1은_숙소_검색_0건():
    assert FakePlaces().search_lodging(Q) == []


def test_T15_S18_가짜_공급자_난바_주소_1_1은_주소_검색_1건():
    assert FakePlaces().search_address(Q) == [HIT]


def test_T15_S18_가짜_공급자_주소_결과의_details_좌표():
    assert tuple(FakePlaces().details("FAKE-address-1")["location"].values()) == AT


@pytest.mark.parametrize("q", ["난바", "호텔", "난바 테스트 호텔 1", "우메다", "난바 주소", "난바 주소 1-1 ", "주소 1-1", "없는 글"])
def test_T15_S18_가짜_공급자_경계_다른_글은_지금처럼_숙소_검색과_같은_결과(q):
    fake = FakePlaces()
    assert fake.search_address(q) == fake.search_lodging(q)


def test_T15_S18_가짜_공급자_API_주소_검색으로도_1건_이름_검색은_0건(mem):
    """GET /places/address-search · /places/lodging-search (가짜 모드, 실제 Google 0). 개수 제한·모양은 기존 테스트 몫."""
    address = mem.client.get("/places/address-search", params={"city_code": "osaka", "q": Q}, headers=bearer(ME))
    lodging = mem.client.get("/places/lodging-search", params={"city_code": "osaka", "q": Q}, headers=bearer(ME))
    assert lodging.status_code == 200 and lodging.json() == []
    assert address.status_code == 200, address.text
    assert address.json() == [HIT]
