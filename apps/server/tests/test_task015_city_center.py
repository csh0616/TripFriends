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


# ---------- §15 Q1 ③ city_center()는 Google 좌표 캐시로 되돌아가지 않는다 ----------
# 계약 (§15 Q1 ③ 제안): CityData.city_center()는 팩 center의 우리 값 lat·lng만 쓴다.
#   팩 center에 lat·lng(둘 다)가 없으면 ValueError (캐시에 center 좌표가 있어도 쓰지 않는다, 공급자도 부르지 않는다).
#   서버 내부의 숙소 없는 시작점 CityData.center()는 §9 Q6대로 그대로 캐시 값 (위 test_T15_Q6_서버_내부의_숙소_없는_시작점은_지금처럼_캐시_값).


def city_with_center(center: dict):
    """팩 center만 바꾼 CityData. 캐시에는 Google에서 받은 것으로 치는 center 좌표가 있다 (가짜 공급자 값)."""
    from places.city import CityData, fake_city

    base = fake_city()
    pack = {**base.pack, "center": center}
    return CityData(pack, dict(base.cache), base.provider)


def _cached_center(city) -> dict:
    return city.cache[city.pack["center"]["place_id"]]["location"]


@pytest.mark.parametrize(
    "extra",
    [
        pytest.param({}, id="lat·lng_없음"),
        pytest.param({"lat": 34.6662}, id="lat만"),
        pytest.param({"lng": 135.5010}, id="lng만"),
    ],
)
def test_T15_S15_Q1_팩에_우리_lat·lng가_없으면_city_center는_ValueError이고_캐시로_되돌아가지_않는다(extra, monkeypatch):
    from places.city import fake_city

    base_center = fake_city().pack["center"]
    city = city_with_center({"name_ko": base_center["name_ko"], "place_id": base_center["place_id"], **extra})
    assert _cached_center(city), "시험 자체 확인: 캐시에 center 좌표가 있어야 '되돌아가지 않음'을 가린다"
    called: list[str] = []
    for name in ("details", "resolve", "search_lodging", "search_address"):
        if hasattr(city.provider, name):
            monkeypatch.setattr(city.provider, name, lambda *a, _n=name, **k: called.append(_n))
    with pytest.raises(ValueError):
        city.city_center()
    assert called == []  # 공급자(Google)도 부르지 않는다


def test_T15_S15_Q1_경계_팩에_우리_lat·lng가_있으면_캐시와_달라도_그_값(monkeypatch):
    from places.city import fake_city

    base_center = fake_city().pack["center"]
    city = city_with_center({**base_center, **SEED_V3_CENTER})
    cached = _cached_center(city)
    assert (cached["lat"], cached["lng"]) != (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"]), "시험 자체 확인"
    assert city.city_center() == (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"])


def test_T15_S15_Q1_경계_city_center가_오류여도_숙소_없는_시작점_center는_그대로_캐시_값():
    """§9 Q6: 서버 내부의 숙소 없는 계산은 바꾸지 않는다."""
    from places.city import fake_city

    base_center = fake_city().pack["center"]
    city = city_with_center({"name_ko": base_center["name_ko"], "place_id": base_center["place_id"]})
    cached = _cached_center(city)
    assert city.center() == (cached["lat"], cached["lng"])


# ---------- §17 Q-B 실제 모드에서 팩에 우리 좌표가 없으면 서버 시작 때 멈춘다 ----------
# 계약 (§17 Q-B, 이 테스트가 제안):
#   places.city.open_city(env)가 실제 모드(가짜 아님)에서 팩 center에 lat·lng(둘 다)가 없으면 places.city.CityConfigError(RuntimeError)를 낸다
#     = 설정 오류. 메시지는 한 줄(줄바꿈 없음)이고 center 좌표가 없다는 이유를 담는다. 키 값은 담지 않는다
#   그래서 서버 lifespan(api.main)이 시작하지 못한다 (TestClient(app)를 여는 순간 실패) — 요청마다 500이 되기 전에 찾는다
#   팩 center에 lat·lng가 둘 다 있으면 지금처럼 켜진다. 가짜 모드는 이 검사와 상관없이 지금처럼 (가짜 seed에 v3 값이 있다, §16 Q-A)
#   시험은 실제 Google을 부르지 않는다: make_providers를 "가짜 공급자인데 실제 모드"로 바꿔 끼우고, 팩·캐시는 tmp_path에 쓴다

TEST_ONLY_KEY = "TEST-ONLY-NOT-A-KEY"


def real_mode_with_pack(monkeypatch, tmp_path: Path, center_extra: dict | None) -> None:
    """실제 모드 흉내: 팩 파일(가짜 팩의 center에서 lat·lng를 빼고 center_extra를 더함)과 캐시 파일을 tmp_path에 두고 open_city가 그것을 읽게 한다."""
    import json as _json

    import places.city
    from places.cache import save_cache
    from places.factory import NullSerper
    from places.provider import FakePlaces

    base = places.city.fake_city()
    center = {k: v for k, v in base.pack["center"].items() if k not in ("lat", "lng")}
    pack = {**base.pack, "center": {**center, **(center_extra or {})}}
    pack_path, cache_path = tmp_path / "packs" / "osaka.json", tmp_path / "cache" / "osaka.json"
    pack_path.parent.mkdir(parents=True)
    pack_path.write_text(_json.dumps(pack, ensure_ascii=False), encoding="utf-8")
    save_cache(cache_path, dict(base.cache))
    monkeypatch.setattr(places.city, "PACK_PATH", pack_path)
    monkeypatch.setattr(places.city, "CACHE_PATH", cache_path)
    monkeypatch.setattr(places.city, "make_providers", lambda env=None: (FakePlaces(), NullSerper(), False))


NO_CENTER = [
    pytest.param({}, id="lat·lng_없음"),
    pytest.param({"lat": SEED_V3_CENTER["lat"]}, id="lat만"),
    pytest.param({"lng": SEED_V3_CENTER["lng"]}, id="lng만"),
]


@pytest.mark.parametrize("extra", NO_CENTER)
def test_T15_S17_QB_실제_모드에서_팩에_우리_좌표가_없으면_open_city가_설정_오류로_멈춘다(monkeypatch, tmp_path, extra):
    import places.city

    real_mode_with_pack(monkeypatch, tmp_path, extra)
    error_type = getattr(places.city, "CityConfigError")
    assert issubclass(error_type, RuntimeError)
    with pytest.raises(error_type) as caught:
        places.city.open_city({"GOOGLE_PLACES_API_KEY": TEST_ONLY_KEY})
    reason = str(caught.value)
    assert reason.strip() and "\n" not in reason.strip(), reason  # 이유 한 줄
    assert "center" in reason, reason
    assert TEST_ONLY_KEY not in reason


@pytest.mark.parametrize("extra", NO_CENTER)
def test_T15_S17_QB_실제_모드에서_좌표_없는_팩으로는_서버가_시작하지_않는다(monkeypatch, tmp_path, extra):
    import places.city
    from api.main import app

    server_env(monkeypatch, "memory")
    real_mode_with_pack(monkeypatch, tmp_path, extra)
    with pytest.raises(getattr(places.city, "CityConfigError")):
        with TestClient(app, headers=bearer(ME)):
            pass


def test_T15_S17_QB_경계_실제_모드에서_팩에_우리_좌표가_둘_다_있으면_켜진다(monkeypatch, tmp_path):
    import places.city

    real_mode_with_pack(monkeypatch, tmp_path, dict(SEED_V3_CENTER))
    city, fake = places.city.open_city({"GOOGLE_PLACES_API_KEY": TEST_ONLY_KEY})
    assert fake is False
    assert city.city_center() == (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"])


def test_T15_S17_QB_경계_실제_모드_서버는_좌표_있는_팩이면_시작해서_city_center를_준다(monkeypatch, tmp_path):
    from api.main import app

    server_env(monkeypatch, "memory")
    real_mode_with_pack(monkeypatch, tmp_path, dict(SEED_V3_CENTER))
    with TestClient(app, headers=bearer(ME)) as client:
        osaka = Osaka(client, app)
        (day_id, date), _ = planned_days(osaka)
        assert views(osaka, day_id, date)["now"]["city"] == {"code": "osaka", "center": SEED_V3_CENTER}


def test_T15_S17_QB_경계_가짜_모드는_지금처럼_켜지고_center는_가짜_seed의_v3_값():
    import places.city

    city, fake = places.city.open_city({"PLACES_PROVIDER": "fake"})
    assert fake is True
    assert city.city_center() == (SEED_V3_CENTER["lat"], SEED_V3_CENTER["lng"])
