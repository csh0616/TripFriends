"""TASK-015 §E ③ 지도 시작 가운데 = 여행 도시의 중심: 응답에 `city.center` (서버).

근거: TASK-015 §E ③("지도 시작 가운데 = 여행 도시의 중심(빈 코스 날 일본 전체 대신 오사카). 응답에 city.center 추가(도시 팩 값, Google 값 아님)") ·
TASK-014 §33("숙소 -> 첫 핀 -> (없으면) 일본 가운데 대신 여행 도시의 중심. 도시 중심 값이 앱에 없으면 서버 응답에 있는지 확인, 없으면 TASK-015로") ·
TASK-014 §29 ④(도시 중심을 숙소인 척 내보내지 않음 — city.center는 숙소가 아니라 따로 둔다) · TASK-010 §9 Q10(숙소가 없으면 도시 중심이 하루 시작점) ·
TASK-015 §9 Q6(도시 팩 center에 우리 값 lat·lng, docs/data/osaka-seed.yaml v3 난바역 34.6662, 135.5010 — 시드 규칙 "center는 name_ko·query만"은 이 두 값만 예외.
서버 내부의 숙소 없는 계산은 바꾸지 않는다) · §9 Q7(NowView에만, 모양 {code, center: {lat, lng}}) · API-001 2-4 `NowView.city`.

계약 (§9 Q6·Q7 반영):
    NowView(GET /days/{id}/now · POST /check 실제·연습)의 `city` = {"code": "osaka", "center": {"lat": float, "lng": float}} (칸은 이 둘뿐)
    center 값 = 그 도시 seed의 center.lat·center.lng 그대로 (Google 좌표 캐시가 아님). 여행·날·숙소 유무·시각과 상관없이 같다
    seed의 center는 {name_ko, query, lat, lng}를 받는다 (lat·lng는 Q6 예외 두 값)
    이 파일은 가짜 seed(testdata/cities/osaka-seed-fake.yaml)에 정본 v3의 center lat·lng를 더한 임시 사본으로 서버를 켠다 (places.city.FAKE_SEED를 바꿔 끼움)
    city.center가 생겨도 day.lodging은 지금 규칙 그대로 (숙소 없으면 null, TASK-014 §29 ④)
"""

import uuid
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import server_env
from test_task010_trips import Osaka, trip_body

ME = f"user-T15-city-{uuid.uuid4().hex[:8]}"

REPO = next(d for d in Path(__file__).resolve().parents if (d / "docs" / "tasks").is_dir())
DOC_SEED = REPO / "docs" / "data" / "osaka-seed.yaml"  # 정본 (읽기만)
FAKE_SEED = REPO / "testdata" / "cities" / "osaka-seed-fake.yaml"
SEED_V3_CENTER = {"lat": 34.6662, "lng": 135.5010}  # TASK-015 §9 Q6 (PM이 정한 대략값)


def use_v3_center(monkeypatch, tmp_path: Path) -> dict:
    """가짜 seed 사본의 center에 정본 v3의 lat·lng를 더해 서버가 그것으로 켜지게 한다. 더한 center를 돌려준다.
    (가짜 seed 파일 자체는 고치지 않는다 — 이 사본은 tmp_path에만 있다)"""
    import places.city

    doc_center = yaml.safe_load(DOC_SEED.read_text(encoding="utf-8"))["center"]
    data = yaml.safe_load(FAKE_SEED.read_text(encoding="utf-8"))
    data["center"] = {**data["center"], "lat": doc_center["lat"], "lng": doc_center["lng"]}
    copy = tmp_path / "osaka-seed-fake-v3.yaml"
    copy.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    monkeypatch.setattr(places.city, "FAKE_SEED", copy)
    return {"lat": doc_center["lat"], "lng": doc_center["lng"]}


@pytest.fixture
def mem(monkeypatch, tmp_path):
    from api.main import app

    server_env(monkeypatch, "memory")
    use_v3_center(monkeypatch, tmp_path)
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
    assert set(view["city"]) == {"code", "center"}, view["city"]  # §9 Q7
    center = view["city"]["center"]
    assert set(center) == {"lat", "lng"}, center
    assert type(center["lat"]) is float and type(center["lng"]) is float, center
    return center


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T15_E3_오늘·check·연습_응답에_city_center가_있다(mem, kind):
    (day_id, date), _ = planned_days(mem)
    center_of(views(mem, day_id, date)[kind])


def test_T15_Q6_정본_seed_v3의_center는_난바역_우리_값_lat·lng를_가진다():
    """데이터 자체 확인 (PM이 넣은 값). 이 값이 city.center의 출처다."""
    center = yaml.safe_load(DOC_SEED.read_text(encoding="utf-8"))["center"]
    assert (center["lat"], center["lng"]) == (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"])


def test_T15_Q6_seed는_center의_lat·lng를_받는다(tmp_path, monkeypatch):
    """§9 Q6: "center는 name_ko·query만" 규칙의 예외는 lat·lng 두 값뿐."""
    from places.seed import load_seed

    use_v3_center(monkeypatch, tmp_path)
    import places.city

    seed = load_seed(places.city.FAKE_SEED)
    assert (seed["center"]["lat"], seed["center"]["lng"]) == (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"])


@pytest.mark.parametrize("extra", [{"place_id": "FAKE-x"}, {"address": "가짜", "lat": 34.6662, "lng": 135.501}], ids=["place_id", "lat·lng에_address까지"])
def test_T15_Q6_경계_center에_lat·lng_말고_다른_칸이_있으면_지금처럼_거절(tmp_path, extra):
    """예외는 lat·lng 두 값만이다. 다른 칸은 지금 규칙대로 ValueError."""
    from places.seed import load_seed

    data = yaml.safe_load(FAKE_SEED.read_text(encoding="utf-8"))
    data["center"] = {"name_ko": data["center"]["name_ko"], "query": data["center"]["query"], **extra}
    copy = tmp_path / "bad-center.yaml"
    copy.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    with pytest.raises(ValueError):
        load_seed(copy)


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T15_Q7_city는_code와_seed_center의_우리_값(mem, kind):
    (day_id, date), _ = planned_days(mem)
    assert views(mem, day_id, date)[kind]["city"] == {"code": "osaka", "center": SEED_V3_CENTER}


def test_T15_Q7_city_center는_Google_좌표_캐시의_center_값이_아니다(mem):
    """가짜 공급자가 준 center 좌표(캐시)와 seed 값이 다르다 -> 응답은 seed 값."""
    (day_id, date), _ = planned_days(mem)
    city = mem.app.state.city
    cached = city.cache[city.pack["center"]["place_id"]]["location"]
    assert (cached["lat"], cached["lng"]) != (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"]), "시험 자체 확인: 캐시 값과 seed 값이 달라야 구분된다"
    assert center_of(views(mem, day_id, date)["now"]) == SEED_V3_CENTER


def test_T15_Q6_서버_내부의_숙소_없는_시작점은_지금처럼_캐시_값(mem):
    """§9 Q6: 이번엔 응답 city.center에만. 숙소 없는 계산(city.center())은 place_id 캐시를 그대로 쓴다."""
    city = mem.app.state.city
    cached = city.cache[city.pack["center"]["place_id"]]["location"]
    assert city.center() == (cached["lat"], cached["lng"])


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
