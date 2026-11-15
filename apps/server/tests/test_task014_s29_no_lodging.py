"""TASK-014 §29 ④ 숙소 없는 여행 (서버): 응답 `day.lodging`은 null, T-08 "숙소 가는 길"은 나오지 않는다.

근거: TASK-014 §29 표 ④("오늘·연습 응답에서 day.lodging: null — 도시 중심을 숙소인 척 내보내지 않음. 서버 내부 계산에 도시 중심을 쓰는 건 그대로 가능.
숙소가 없으면 T-08 숨김") · API-001 §2-3 (11-15 TASK-014 §29) `NowView.day.lodging` 줄("숙소를 입력하지 않은 여행이면 null") ·
§29 원인 ③(서버가 도시 중심을 숙소로 써서 day.lodging도 도시 중심) · TASK-010 §9 Q10(숙소가 없으면 도시 중심이 하루 시작점)·§10 Q27(lodging_known).

계약 (이 테스트가 정한 것, 승인 대기):
    "숙소 없는 여행" = POST /trips에 lodging_place_id를 주지 않은 여행 (저장소의 DayRecord.lodging_known = False)
        -> GET /days/{id}/now · POST /days/{id}/check(실제) · POST /days/{id}/check(본문 rehearsal: true) 응답의 day.lodging = null
        -> 그날 어느 시각이든 main·subs 어디에도 type "T-08" 카드가 없다 (마지막 장소 뒤 시각 포함). 대신 무엇이 나오는지는 정하지 않는다 (질문)
    "숙소 있는 여행" = 숙소 검색(가짜 공급자) 첫 결과의 place_id로 만든 여행 -> day.lodging = 그 숙소 좌표 {lat, lng} (지금 그대로), 마지막 장소 뒤 T-08 그대로
    OpenAPI: NowView.day의 lodging 칸은 null을 받는다 (required 칸으로 남아도 되고, 값으로 null 허용)
    도시 중심을 서버 안 계산(출발점)에 쓰는 것은 그대로 둔다 — 이 파일은 응답의 day.lodging과 카드만 본다
    저장소에 바로 심은 하루(trip_helpers.plant)는 lodging_known=False로 다시 저장해 "숙소 없음"을 만든다 (제품 코드에 테스트 길 0)
"""

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from auth_helpers import bearer
from storage_helpers import server_env
from test_task010_trips import Osaka
from trip_helpers import at_time, plain_day

ME = "user-T14-s29"
OFFSET = 7  # 계획 완료 날 = 오늘(2026-12-01) + 7


# ---------- 도우미 ----------


@pytest.fixture
def mem(monkeypatch):
    """메모리 저장소 서버 하나 (ME의 Bearer가 기본 헤더). 가짜 오사카 (실제 Google·Serper 0)."""
    from api.main import app

    server_env(monkeypatch, "memory")
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


def lodging_hit(osaka: Osaka) -> dict:
    response = osaka.client.get("/places/lodging-search", params={"city_code": "osaka", "q": "호텔"})
    assert response.status_code == 200, response.text
    return response.json()[0]


def planned_day(osaka: Osaka, lodging: str | None) -> tuple[str, str]:
    """계획 완료(코스를 고른) 날 하나. lodging=None이면 숙소 없이 만든 여행. (day_id, 'YYYY-MM-DD')."""
    extra = {"lodging": lodging} if lodging is not None else {}
    trip = osaka.make_trip(days=2, offset=OFFSET, device=ME, **extra)
    assert trip["lodging_place_id"] == lodging
    day = trip["trip_days"][0]
    started = osaka.client.post(f"/days/{day['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    option = started.json()["options"][0]["option_id"]
    chosen = osaka.client.post(f"/course-options/{option}/select")
    assert chosen.status_code == 200, chosen.text
    return day["day_id"], day["date"]


def at_of(date: str, hhmm: str) -> str:
    return f"{date}T{hhmm}:00"


def get_now(osaka: Osaka, day_id: str, at: str) -> dict:
    response = osaka.client.get(f"/days/{day_id}/now", params={"at": at})
    assert response.status_code == 200, response.text
    return response.json()


def post_check(osaka: Osaka, day_id: str, at: str, rehearsal: bool = False, position: tuple[float, float] | None = None) -> dict:
    body: dict = {"at": at}
    if position is not None:
        body["lat"], body["lng"] = position
    if rehearsal:
        body["rehearsal"] = True
    response = osaka.client.post(f"/days/{day_id}/check", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def card_types(view: dict) -> list[str]:
    return [view["main"]["type"], *[card["type"] for card in view["subs"]]]


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def to_min(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:5])


def every_view(osaka: Osaka, day_id: str, at: str) -> dict[str, dict]:
    """같은 시각의 세 응답: GET /now · 실제 check · 연습 check"""
    return {
        "now": get_now(osaka, day_id, at),
        "check": post_check(osaka, day_id, at),
        "rehearsal": post_check(osaka, day_id, at, rehearsal=True),
    }


def last_end(view: dict) -> int:
    return max(to_min(pin["end"]) for pin in view["pins"])


def first_start(view: dict) -> int:
    return min(to_min(pin["start"]) for pin in view["pins"])


def interesting_times(view: dict) -> list[str]:
    """첫 일정 전 · 첫 시작 정각 · 하루 중간 · 마지막 끝 1분 전 · 끝 정각 · 끝 1분 뒤 · 그날 마지막 분"""
    first, last = first_start(view), last_end(view)
    picks = {0, max(0, first - 1), first, (first + last) // 2, last - 1, last, min(last + 1, 23 * 60 + 59), 23 * 60 + 59}
    return [hhmm(m) for m in sorted(picks)]


# =====================================================================
# ④ day.lodging = null (숙소 없이 만든 여행)
# =====================================================================


def test_T14_S29_4_숙소_없는_여행의_GET_now_day_lodging은_null(mem):
    day_id, date = planned_day(mem, lodging=None)
    view = get_now(mem, day_id, at_of(date, "12:00"))
    assert "lodging" in view["day"]  # 칸은 남는다 (API-001: 값이 null)
    assert view["day"]["lodging"] is None


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T14_S29_4_숙소_없는_여행은_now·실제_check·연습_check_모두_어느_시각이든_day_lodging이_null(mem, kind):
    day_id, date = planned_day(mem, lodging=None)
    sample = get_now(mem, day_id, at_of(date, "12:00"))
    for clock in interesting_times(sample):
        view = every_view(mem, day_id, at_of(date, clock))[kind]
        assert view["day"]["lodging"] is None, (kind, clock, view["day"]["lodging"])


def test_T14_S29_4_숙소_없는_여행_연습_check에_위치를_실어도_day_lodging은_null(mem):
    day_id, date = planned_day(mem, lodging=None)
    pin = get_now(mem, day_id, at_of(date, "12:00"))["pins"][0]
    view = post_check(mem, day_id, at_of(date, pin["start"]), rehearsal=True, position=(pin["lat"], pin["lng"]))
    assert view["day"]["lodging"] is None


def test_T14_S29_4_숙소_없는_여행의_day_lodging은_도시_중심_좌표가_아니다(mem):
    """§29 원인 ③: 도시 중심을 숙소인 척 내보내던 것. 서버 안 계산엔 써도 되지만 day.lodging에는 없다."""
    day_id, date = planned_day(mem, lodging=None)
    lat, lng = mem.app.state.city.center()
    for kind, view in every_view(mem, day_id, at_of(date, "12:00")).items():
        assert view["day"]["lodging"] != {"lat": lat, "lng": lng}, kind


# =====================================================================
# ④ 숙소 있는 여행은 지금 그대로 (경계: 다른 쪽)
# =====================================================================


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T14_S29_4_경계_숙소_있는_여행은_day_lodging이_그_숙소_좌표(mem, kind):
    hit = lodging_hit(mem)
    day_id, date = planned_day(mem, lodging=hit["place_id"])
    lat, lng = mem.app.state.city.lodging_location(hit["place_id"], mem.app.state.clock())
    view = every_view(mem, day_id, at_of(date, "12:00"))[kind]
    assert view["day"]["lodging"] == {"lat": lat, "lng": lng}
    assert type(view["day"]["lodging"]["lat"]) is float and type(view["day"]["lodging"]["lng"]) is float


# =====================================================================
# ④ T-08 숨김
# =====================================================================


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T14_S29_4_숙소_없는_여행은_어느_시각에도_T_08이_main·subs에_없다_마지막_장소_뒤_포함(mem, kind):
    day_id, date = planned_day(mem, lodging=None)
    sample = get_now(mem, day_id, at_of(date, "12:00"))
    for clock in interesting_times(sample):
        view = every_view(mem, day_id, at_of(date, clock))[kind]
        assert "T-08" not in card_types(view), (kind, clock, card_types(view))


def test_T14_S29_4_숙소_없는_여행_마지막_장소_끝_정각·1분_뒤·그날_끝에도_T_08이_없다(mem):
    day_id, date = planned_day(mem, lodging=None)
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for minutes in (end, end + 1, end + 30, 23 * 60 + 59):
        for kind, view in every_view(mem, day_id, at_of(date, hhmm(min(minutes, 23 * 60 + 59)))).items():
            assert "T-08" not in card_types(view), (kind, hhmm(minutes))


def test_T14_S29_4_경계_숙소_있는_여행은_마지막_장소_뒤_T_08이_그대로_main이고_숙소_좌표(mem):
    hit = lodging_hit(mem)
    day_id, date = planned_day(mem, lodging=hit["place_id"])
    lat, lng = mem.app.state.city.lodging_location(hit["place_id"], mem.app.state.clock())
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for kind, view in every_view(mem, day_id, at_of(date, hhmm(end + 1))).items():
        assert view["main"]["type"] == "T-08", kind  # TASK-006 Q1·F2: 마지막 일정이 끝나면 T-08
        assert view["main"]["lodging"] == {"lat": lat, "lng": lng}, kind


def test_T14_S29_4_숙소_없는_여행도_마지막_장소_뒤_응답은_200이고_main이_있다(mem):
    """T-08을 빼도 화면은 깨지지 않는다 (무슨 카드가 main인지는 문서에 없어 정하지 않음 — 질문)."""
    day_id, date = planned_day(mem, lodging=None)
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for kind, view in every_view(mem, day_id, at_of(date, hhmm(end + 1))).items():
        assert isinstance(view["main"], dict) and isinstance(view["main"].get("type"), str), kind


# =====================================================================
# 심은 하루(lodging_known=False)로 같은 규칙 — 속성
# =====================================================================


def without_lodging(env, day_id: str) -> None:
    """저장소에 심은 날을 '숙소 모름'으로 다시 저장 (lodging은 도시 중심 같은 출발점일 뿐, TASK-010 §10 Q27)."""
    record = env.repo.get_day(day_id)
    env.repo.save_day(day_id, record.plan, record.places, record.day_number, lodging_known=False, sources=record.sources)


@pytest.fixture
def no_lodging_day(env):
    day_id = plain_day(env)  # 1번 10:12~12:00 · 2번 12:20~14:00 · 3번 14:30~19:00
    without_lodging(env, day_id)
    return env, day_id


def env_views(env, day_id: str, clock: str) -> dict[str, dict]:
    out = {}
    response = env.client.get(f"/days/{day_id}/now", params={"at": at_time(clock)})
    assert response.status_code == 200, response.text
    out["now"] = response.json()
    for name, extra in (("check", {}), ("rehearsal", {"rehearsal": True})):
        response = env.client.post(f"/days/{day_id}/check", json={"at": at_time(clock), **extra})  # 위치 없음: 늦어짐 감지(T-04)가 섞이지 않게
        assert response.status_code == 200, response.text
        out[name] = response.json()
    return out


def test_T14_S29_4_심은_하루_lodging_known_False면_19시_1분에_T_08이_없고_lodging_null(no_lodging_day):
    env, day_id = no_lodging_day
    for kind, view in env_views(env, day_id, "19:01").items():
        assert view["day"]["lodging"] is None, kind
        assert "T-08" not in card_types(view), kind


def test_T14_S29_4_경계_심은_하루_lodging_known_True면_19시_1분에_T_08(env):
    day_id = plain_day(env)
    for kind, view in env_views(env, day_id, "19:01").items():
        assert view["main"]["type"] == "T-08", kind
        assert view["day"]["lodging"] == {"lat": 35.0, "lng": 135.0}, kind  # trip_helpers: 숙소(35.0, 135.0)


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(minutes=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_T14_S29_4_속성_숙소_모름이면_어느_분이든_T_08_없음·lodging_null(no_lodging_day, minutes):
    env, day_id = no_lodging_day
    for kind, view in env_views(env, day_id, hhmm(minutes)).items():
        assert view["day"]["lodging"] is None, (kind, hhmm(minutes))
        assert "T-08" not in card_types(view), (kind, hhmm(minutes))


# =====================================================================
# OpenAPI: NowView.day.lodging은 null을 받는다
# =====================================================================


def resolve(spec: dict, schema: dict) -> dict:
    while "$ref" in schema:
        schema = spec["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def allows_null(spec: dict, schema: dict) -> bool:
    schema = resolve(spec, schema)
    if schema.get("type") == "null" or schema.get("nullable") is True:
        return True
    if isinstance(schema.get("type"), list) and "null" in schema["type"]:
        return True
    return any(allows_null(spec, option) for option in schema.get("anyOf", []) + schema.get("oneOf", []))


def lat_lng_option(spec: dict, schema: dict) -> bool:
    schema = resolve(spec, schema)
    if set(schema.get("properties", {})) == {"lat", "lng"}:
        return True
    return any(lat_lng_option(spec, option) for option in schema.get("anyOf", []) + schema.get("oneOf", []))


def test_T14_S29_API_001_OpenAPI의_NowView_day_lodging은_null을_받고_좌표_모양도_그대로():
    from api.main import app

    spec = app.openapi()
    day = resolve(spec, spec["components"]["schemas"]["NowView"]["properties"]["day"])
    lodging = day["properties"]["lodging"]
    assert allows_null(spec, lodging)
    assert lat_lng_option(spec, lodging)  # 숙소가 있으면 지금처럼 {lat, lng}
