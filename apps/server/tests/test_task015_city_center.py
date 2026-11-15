"""TASK-015 §E ③ 지도 시작 가운데 = 여행 도시의 중심: 응답에 `city.center` (서버).

근거: TASK-015 §E ③("지도 시작 가운데 = 여행 도시의 중심(빈 코스 날 일본 전체 대신 오사카). 응답에 city.center 추가(도시 팩 값, Google 값 아님)") ·
TASK-014 §33("숙소 -> 첫 핀 -> (없으면) 일본 가운데 대신 여행 도시의 중심. 도시 중심 값이 앱에 없으면 서버 응답에 있는지 확인, 없으면 TASK-015로") ·
TASK-014 §29 ④(도시 중심을 숙소인 척 내보내지 않음 — city.center는 숙소가 아니라 따로 둔다) · TASK-010 §9 Q10(숙소가 없으면 도시 중심이 하루 시작점).

계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
    NowView(GET /days/{id}/now · POST /check 실제·연습)에 `city` 칸: {"center": {"lat": float, "lng": float}, ...}  (다른 칸은 이 파일이 정하지 않는다)
    값은 도시 팩에서 온다: 여행·날·숙소 유무·시각과 상관없이 같고, Google 좌표 캐시가 바뀌어도 그대로 (Google 값 아님)
    city.center가 생겨도 day.lodging은 지금 규칙 그대로 (숙소 없으면 null, TASK-014 §29 ④)
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import server_env
from test_task010_trips import Osaka, trip_body

ME = f"user-T15-city-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def mem(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "memory")
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


def planned_days(osaka: Osaka, lodging: str | None = None, offset: int = 7) -> list[tuple[str, str]]:
    """여행 하나의 이틀 모두 계획 완료. [(day_id, date)]."""
    response = osaka.post_trip(trip_body(days=2, offset=offset, lodging=lodging), ME)
    assert response.status_code == 201, response.text
    out = []
    for day in response.json()["trip_days"]:
        started = osaka.client.post(f"/days/{day['day_id']}/planning", json={"mode": "auto"})
        assert started.status_code == 201, started.text
        chosen = osaka.client.post(f"/course-options/{started.json()['options'][0]['option_id']}/select")
        assert chosen.status_code == 200, chosen.text
        out.append((day["day_id"], day["date"]))
    return out


def views(osaka: Osaka, day_id: str, date: str, clock: str = "12:00") -> dict[str, dict]:
    at = f"{date}T{clock}:00"
    got = {
        "now": osaka.client.get(f"/days/{day_id}/now", params={"at": at}),
        "check": osaka.client.post(f"/days/{day_id}/check", json={"at": at}),
        "rehearsal": osaka.client.post(f"/days/{day_id}/check", json={"at": at, "rehearsal": True}),
    }
    for kind, response in got.items():
        assert response.status_code == 200, (kind, response.text)
    return {kind: response.json() for kind, response in got.items()}


def center_of(view: dict) -> dict:
    assert "city" in view, sorted(view)
    center = view["city"]["center"]
    assert set(center) == {"lat", "lng"}, center
    assert type(center["lat"]) is float and type(center["lng"]) is float, center
    return center


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T15_E3_오늘·check·연습_응답에_city_center가_있다(mem, kind):
    (day_id, date), _ = planned_days(mem)
    center_of(views(mem, day_id, date)[kind])


def test_T15_E3_city_center는_날·시각·응답_종류와_상관없이_같다(mem):
    days = planned_days(mem)
    seen = []
    for day_id, date in days:
        for clock in ("00:00", "12:00", "23:59"):
            seen += [center_of(view) for view in views(mem, day_id, date, clock).values()]
    assert all(center == seen[0] for center in seen), seen


def test_T15_E3_숙소가_있든_없든_city_center는_같고_숙소가_아니다(mem):
    hit = mem.client.get("/places/lodging-search", params={"city_code": "osaka", "q": "호텔"}).json()[0]
    (with_day, with_date), _ = planned_days(mem, lodging=hit["place_id"])
    (bare_day, bare_date), _ = planned_days(mem, offset=20)
    with_view, bare_view = views(mem, with_day, with_date)["now"], views(mem, bare_day, bare_date)["now"]
    assert center_of(with_view) == center_of(bare_view)
    assert bare_view["day"]["lodging"] is None  # TASK-014 §29 ④ 그대로: 도시 중심을 숙소 칸에 넣지 않는다
    assert with_view["day"]["lodging"] != center_of(with_view)  # 숙소 칸과 도시 중심 칸은 따로


def test_T15_E3_Google_좌표_캐시가_바뀌어도_city_center는_그대로_도시_팩_값(mem, monkeypatch):
    (day_id, date), _ = planned_days(mem)
    before = center_of(views(mem, day_id, date)["now"])
    city = mem.app.state.city
    center_place = city.pack["center"]["place_id"]
    moved = {**city.cache[center_place], "location": {"lat": 1.234567, "lng": 2.345678}}
    monkeypatch.setitem(city.cache, center_place, moved)  # Google에서 받은 좌표가 바뀐 상황
    after = center_of(views(mem, day_id, date)["now"])
    assert after == before


def test_T15_E3_OpenAPI의_NowView에_city_center_칸():
    """앱 타입(packages/api-types)은 OpenAPI에서 생성한다 -> 스키마에 칸이 있어야 앱이 손 타입 없이 쓴다."""
    from api.main import app

    spec = app.openapi()
    schemas = spec["components"]["schemas"]

    def resolve(node: dict) -> dict:
        while "$ref" in node:
            node = schemas[node["$ref"].split("/")[-1]]
        for key in ("anyOf", "allOf"):
            if key in node:
                found = [resolve(n) for n in node[key] if n.get("type") != "null"]
                if found:
                    return found[0]
        return node

    city = resolve(schemas["NowView"]["properties"]["city"])
    center = resolve(city["properties"]["center"])
    assert {"lat", "lng"} <= set(center["properties"])
