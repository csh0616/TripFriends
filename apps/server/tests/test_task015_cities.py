"""TASK-015 §13 Q2 도시 정보에 center: GET /cities/{city_code} (서버, 제안 계약).

근거: TASK-015 §13 Q2("a2가 같은 규칙(도시 중심 50km)을 앱에서 먼저 검사 ... 같은 중심 값이 필요하므로 여행 만들기 화면이 받는 도시 정보에 center를 넣는다
(지금 앱이 도시 정보를 어디서 받는지 test-writer가 확인 -> 받는 곳이 없으면 GET /cities/{city_code} -> {code, name_ko, center}를 제안.
§9 Q7 'NowView에만'을 이것 하나만 넓힘)") · §9 Q6(center = 도시 팩 seed의 우리 값 lat·lng, 시드 v3 난바역 34.6662, 135.5010, Google 값 아님) ·
§9 Q7(city 모양 {code, center: {lat, lng}}) · TASK-012 §18(서버 도시 이름 표 trip/link.py CITY_NAMES, osaka = 오사카) ·
API-001 §1(인증 Bearer · 404 NOT_FOUND · 공통 오류 형식).

확인한 지금 상태: 앱은 도시 정보를 서버에서 받지 않는다(앱에 고정: apps/mobile/src/trips/api.ts CITY_CODE · create-trip-screen.tsx '오사카').
서버에도 도시 정보 길이 없다 -> 아래 제안 계약 (승인 대기).

계약:
    GET /cities/{city_code} (Bearer 필요 — 질문: /catalog처럼 토큰 없이 둘지)
        200 {"code": "osaka", "name_ko": "오사카", "center": {"lat": float, "lng": float}} (칸은 이 셋, center 칸은 lat·lng 둘)
            name_ko = trip/link.py CITY_NAMES 표 값 (도시 이름. center 장소 이름 "난바역"이 아니다)
            center  = 그 도시 seed의 center.lat·center.lng 그대로 = NowView.city.center와 같은 값. Google 좌표 캐시가 아니다
        모르는 도시 -> 404 NOT_FOUND (공통 오류 형식)
        OpenAPI에 모양이 있어 packages/api-types로 앱 타입이 생긴다
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import server_env
from test_task010_trips import Osaka
from test_task015_city_center import SEED_V3_CENTER, center_of, planned_days, use_v3_center, views

ME = f"user-T15-cities-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def mem(monkeypatch, tmp_path):
    from api.main import app

    server_env(monkeypatch, "memory")
    use_v3_center(monkeypatch, tmp_path)
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


def city(osaka: Osaka, code: str = "osaka"):
    return osaka.client.get(f"/cities/{code}", headers=bearer(ME))


def test_T15_S13_Q2_GET_cities_osaka는_code·name_ko·center_셋(mem):
    response = city(mem)
    assert response.status_code == 200, response.text
    assert response.json() == {"code": "osaka", "name_ko": "오사카", "center": SEED_V3_CENTER}


def test_T15_S13_Q2_center는_lat·lng_두_칸의_숫자(mem):
    center = city(mem).json()["center"]
    assert set(center) == {"lat", "lng"}, center
    assert type(center["lat"]) is float and type(center["lng"]) is float, center


def test_T15_S13_Q2_name_ko는_서버_도시_이름_표의_값이고_center_장소_이름이_아니다(mem):
    from trip.link import CITY_NAMES

    body = city(mem).json()
    assert body["name_ko"] == CITY_NAMES["osaka"]
    assert body["name_ko"] != "난바역"  # 가짜 seed center.name_ko (도시 이름이 아니다)


def test_T15_S13_Q2_center는_NowView의_city_center와_같은_값(mem):
    (day_id, date), _ = planned_days(mem)
    assert city(mem).json()["center"] == center_of(views(mem, day_id, date)["now"])


def test_T15_S13_Q2_center는_Google_좌표_캐시의_값이_아니다(mem):
    city_data = mem.app.state.city
    cached = city_data.cache[city_data.pack["center"]["place_id"]]["location"]
    assert (cached["lat"], cached["lng"]) != (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"]), "시험 자체 확인: 캐시 값과 seed 값이 달라야 구분된다"
    assert city(mem).json()["center"] == SEED_V3_CENTER


def test_T15_S13_Q2_Google_좌표_캐시가_바뀌어도_center는_그대로(mem, monkeypatch):
    before = city(mem).json()["center"]
    city_data = mem.app.state.city
    center_place = city_data.pack["center"]["place_id"]
    monkeypatch.setitem(city_data.cache, center_place, {**city_data.cache[center_place], "location": {"lat": 1.234567, "lng": 2.345678}})
    assert city(mem).json()["center"] == before == SEED_V3_CENTER


def test_T15_S13_Q2_center는_공급자를_부르지_않는다(mem, monkeypatch):
    """도시 팩 값이라 Google 호출이 없다 (가짜 공급자의 어떤 메서드도 불리지 않는다)."""
    provider = mem.app.state.places_provider
    called: list[str] = []
    for name in ("details", "search_lodging", "resolve"):
        if hasattr(provider, name):
            monkeypatch.setattr(provider, name, lambda *a, _n=name, **k: called.append(_n))
    assert city(mem).status_code == 200
    assert called == []


@pytest.mark.parametrize("code", ["tokyo", "OSAKA", "kyoto", "osaka-x"])
def test_T15_S13_Q2_경계_모르는_도시는_404_NOT_FOUND(mem, code):
    response = city(mem, code)
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_T15_S13_Q2_토큰이_없으면_401(mem):
    response = mem.anon.get("/cities/osaka")
    assert response.status_code == 401, response.text  # API-001 §1 (제안: 장소 검색처럼 Bearer — 질문)


def test_T15_S13_Q2_OpenAPI에_cities_길과_응답_모양이_있다():
    """앱 타입(packages/api-types)은 OpenAPI에서 생성한다."""
    from api.main import app

    spec = app.openapi()
    schemas = spec["components"]["schemas"]
    assert "/cities/{city_code}" in spec["paths"], sorted(spec["paths"])
    ok = spec["paths"]["/cities/{city_code}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]

    def resolve(node: dict) -> dict:
        while "$ref" in node:
            node = schemas[node["$ref"].split("/")[-1]]
        return node

    body = resolve(ok)
    assert {"code", "name_ko", "center"} <= set(body["properties"])
    assert {"lat", "lng"} <= set(resolve(body["properties"]["center"])["properties"])
