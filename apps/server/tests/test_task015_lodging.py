"""TASK-015 §A 숙소 입력 세 단계(이름 -> 주소 -> 지도 찍기) · trip.lodging 모양 · 저장 규칙(Google 값 0, 사용자 값만) (서버).

근거: TASK-015 §A 표(① 이름 = 지금 lodging-search, 장소 ID · ② 주소 = Google 주소 검색 "종류 제한 없이", 장소 ID(있으면) + 입력한 주소 글자 ·
③ 지도 찍기 = Google 호출 없음, 찍은 좌표 + 이름표(선택)) · §A "약관·저장 규칙"(Google 좌표 30일 규칙 그대로, Google 이름·주소 문구 저장 안 함,
사용자 주소 글자·찍은 좌표는 여행 데이터로 저장, 숙소는 places에 넣지 않고 trip.lodging에만) · §A "데이터 모양"(test-writer 제안 -> PM 승인) ·
§A "엔진"(하루 첫·마지막 이동, T-08, 지도 집 표시가 세 종류 모두 같은 값 · kind pin의 T-08 길 안내는 좌표로) · §A "실패"(주소 검색 실패 503 PROVIDER_UNAVAILABLE) ·
§6(이름·주소 둘 다 못 찾음 -> 지도 찍기, 숙소 없이도 지금처럼) · §7 AC-2 · 결정권자 확인 Q1(주소 글자·찍은 좌표 저장, 실시간 위치는 여전히 0, 두 값을 섞지 않는다) ·
TASK-014 §30 Q6(모르는 숙소 = 없는 숙소, day.lodging null) · TASK-014 §B B2·B3(DB·로그에 위치 0) · TASK-010 §B5(숙소 검색)·§6 · ADR-015(Google 약관) ·
TASK-015 §9(11-16 PM 답: 모양 승인, Q1 주소 검색 규칙 = 숙소 검색과 같은 상수, Q2 응답에서 lodging_place_id 뺌, Q4 place·address에 좌표 = 400 INVALID_LODGING,
Q5 label 모든 kind·앞뒤 공백 자르고 30자·빈 글 null, pin이 city.center에서 50km 밖 = 400) · API-001 2-1(11-16)
TASK-015 §11(11-16 PM 답: Q1 INVALID_LODGING + reason too_far·coords_not_allowed·label_too_long·missing_field, Q2 label 31자 이상 = 400 자르지 않음).

계약 (§9 승인·반영):
    주소 검색 = GET /places/address-search?city_code&q (Bearer 필요) -> [{place_id, name, address_short}] (숙소 검색과 같은 모양)
        공급자 메서드 PlacesProvider.search_address(q) -> [{place_id, name, address_short}]. GooglePlaces는 includedType 없이(종류 제한 없음), 필드 마스크 필수
        공급자 실패·시간 초과 -> 503 PROVIDER_UNAVAILABLE (숙소 검색과 같은 공통 오류)
        글자 수·개수·시간 제한은 숙소 검색과 **같은 상수** api.trips.LODGING_MIN_CHARS(2) · LODGING_LIMIT(5) · LODGING_TIMEOUT(3초) — 앞뒤 공백을 지우고 센다 (Q1)
    trip.lodging (POST /trips 본문 `lodging`, 응답 Trip.lodging) = null 또는 여섯 칸이 늘 있는 객체
        {"kind": "place"|"address"|"pin", "place_id": str|null, "address_text": str|null, "lat": float|null, "lng": float|null, "label": str|null}
        place   : place_id 필수. address_text·lat·lng null
        address : address_text 필수(빈 글 안 됨). place_id는 있으면. lat·lng null (좌표는 쓰는 순간 place_id로 불러온다)
        pin     : lat·lng 필수. place_id·address_text null. 서버가 좌표를 그대로 가지는 것은 pin뿐. city.center(도시 팩 우리 값)에서 50km 밖이면 400 (Q5)
        label   : 모든 kind 선택. 앞뒤 공백을 자르고 30자까지(31자 이상 = 400 label_too_long, §11 Q2), 자른 뒤 빈 글이면 null (Q5)
        숙소 문제는 한 코드 400 INVALID_LODGING, 이유는 error.detail.reason (§11 Q1, API-001 오류 형식 {error: {code, message, detail}}):
            "coords_not_allowed" = place·address에 lat·lng (Q4)
            "too_far"            = pin이 city.center에서 50km 밖 (Q5)
            "label_too_long"     = 앞뒤 공백을 자른 label이 31자 이상 (§11 Q2: 자르지 않는다)
            "missing_field"      = kind·그 kind의 필수 칸이 없음 (null·빈 글 포함)
        모르는 kind는 400 이고 아무것도 저장하지 않는다 (코드는 문서에 없음 — 질문)
        옛 필드 lodging_place_id만 오면 {"kind": "place", "place_id": 그 값, 나머지 null}로 받는다 (요청에서만)
    Trip 응답(POST /trips · GET /trips/{id} · /trips/current)에 lodging_place_id 칸이 없다 (Q2: 같은 뜻의 값이 두 곳이면 어긋난다)
    place·address 여행의 응답·저장소에 좌표가 없다 (place_id로 그때 불러옴). address인데 place_id가 없거나 좌표를 못 구하면 숙소 없음과 같다(§30 Q6)
    저장: Postgres는 trips.lodging(jsonb) 한 칸. 사용자 주소 글자·찍은 좌표는 그 칸에만. Google 이름·주소 문구는 어느 표·체크포인트·로그·캐시 파일에도 없다
    Google 좌표: 여행 표·사건·체크포인트·로그에 없다 (좌표 캐시 파일의 30일 규칙은 지금 그대로 — 이 파일은 캐시 파일에 이름·주소·찍은 좌표가 없는지만 본다)
    메모리 계획 저장소(planning_repo)는 그날 계산용 숙소 좌표를 지금처럼 들고 있다 (Postgres는 trips에서 되살린다) -> 메모리에서는 trip_store·trip_repo·체크포인트만 본다
"""

import json
import logging
import re
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from conftest import TEST_DB_ENV
from storage_helpers import KINDS, server_env
from test_task010_trips import Osaka, trip_body
from trip_helpers import checkpoints_text, stores

_RUN = uuid.uuid4().hex[:8]
ME = f"user-T15-lodging-{_RUN}"
OFFSET = 7

# 가짜 공급자 FakePlaces의 숙소 검색 첫 결과 (testdata/cities/osaka-fake.json, 손으로 지어낸 가짜 값)
GOOGLE_LODGING_ID = "FAKE-lodging-1"
GOOGLE_LODGING_NAME = "난바 테스트 호텔 1"
GOOGLE_LODGING_ADDRESS = "가짜구 테스트동 1"
GOOGLE_LODGING_AT = (34.6656, 135.4996)

# 이 파일이 가짜로 끼우는 주소 검색 결과 (Google이 준 것으로 친다)
ADDR_ID = "FAKE-T15-address-1"
ADDR_NAME = "가짜_구글이_준_주소_장소_이름"
ADDR_SHORT = "가짜_구글이_준_짧은_주소_문구"
ADDR_AT = (34.661237, 135.512349)
# 사용자가 친 글 (① 이름으로 못 찾아 ②에서 같은 글을 주소로 다시 찾는다 — 사용자가 다시 치지 않는다)
TYPED = "大阪市浪速区テスト町9-8-7"
# 사용자가 지도에서 찍은 좌표 (다른 어느 값과도 겹치지 않는 소수 자리)
PIN = (34.657913, 135.506271)
LABEL = "친구 집"
# 실시간 위치 (TASK-014: 저장 0) — 찍은 좌표와 섞이지 않는지 본다
LIVE = (34.668713, 135.501327)

FIELDS = {"kind", "place_id", "address_text", "lat", "lng", "label"}


# ---------- 도우미 ----------


def full(kind: str, **values) -> dict:
    return {"kind": kind, "place_id": None, "address_text": None, "lat": None, "lng": None, "label": None, **values}


def pin_body(at=PIN, label: str | None = None) -> dict:
    body = {"kind": "pin", "lat": at[0], "lng": at[1]}
    if label is not None:
        body["label"] = label
    return body


def texts_of(value: float) -> list[str]:
    """좌표 한 값이 글자로 찍힐 수 있는 모양들 (TASK-014 B2·B3 검사와 같은 생각)."""
    return [repr(value), str(value), f"{value:.6f}", f"{value:.5f}"]


def leaks(text: str, position: tuple[float, float]) -> list[str]:
    return [t for v in position for t in texts_of(v) if t in text]


CLIENT_LOGGERS = ("httpx", "httpx2")  # 테스트 클라이언트 자신의 요청 기록 (서버 로그가 아니다)


def server_messages(caplog) -> list[str]:
    out = []
    for record in caplog.records:
        if record.name.split(".")[0] in CLIENT_LOGGERS:
            continue
        out.append(record.getMessage())
        if record.exc_info:
            out.append(logging.Formatter().formatException(record.exc_info))
    return out


def db_tables() -> dict[str, list[str]]:
    """Postgres public 스키마의 모든 표 -> 줄 글자 (TASK-014 test_task014_location_rehearsal.db_tables와 같은 방식)."""
    import os

    import psycopg

    with psycopg.connect(os.environ[TEST_DB_ENV]) as conn, conn.cursor() as cur:
        cur.execute("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
        names = [row[0] for row in cur.fetchall()]
        out = {}
        for name in names:
            cur.execute(f'select * from public."{name}"')  # noqa: S608 (표 이름은 DB가 준 목록)
            out[name] = sorted(repr(row) for row in cur.fetchall())
        return out


def install_address_search(monkeypatch, osaka: Osaka, hits: list[dict] | None = None, broken: bool = False) -> list[str]:
    """주소 검색 공급자를 가짜로 끼운다 (실제 Google 0). 받은 검색어 목록을 돌려준다.
    ADDR_ID의 details도 같이 가짜로: 좌표 = ADDR_AT (Google이 준 좌표로 친다)."""
    provider = osaka.app.state.places_provider
    asked: list[str] = []
    found = [{"place_id": ADDR_ID, "name": ADDR_NAME, "address_short": ADDR_SHORT}] if hits is None else hits

    def search_address(q):
        asked.append(q)
        if broken:
            raise RuntimeError("주소 검색 공급자 실패 (테스트)")
        return [dict(hit) for hit in found]

    inner_details = provider.details

    def details(place_id):
        if place_id == ADDR_ID:
            return {"location": {"lat": ADDR_AT[0], "lng": ADDR_AT[1]}, "opening_hours": None, "website": None, "maps_url": None, "business_status": "OPERATIONAL"}
        return inner_details(place_id)

    monkeypatch.setattr(provider, "search_address", search_address, raising=False)
    monkeypatch.setattr(provider, "details", details)
    return asked


def address_search(osaka: Osaka, q: str, headers: dict | None = None):
    return osaka.client.get("/places/address-search", params={"city_code": "osaka", "q": q}, headers=headers or bearer(ME))


def lodging_search(osaka: Osaka, q: str = "호텔"):
    return osaka.client.get("/places/lodging-search", params={"city_code": "osaka", "q": q}, headers=bearer(ME))


def post_trip(osaka: Osaka, lodging=..., **extra):
    """lodging=...(생략)이면 칸을 아예 넣지 않는다."""
    body = trip_body(days=2, offset=OFFSET, **extra)
    if lodging is not ...:
        body["lodging"] = lodging
    return osaka.post_trip(body, ME)


def made(osaka: Osaka, lodging=..., **extra) -> dict:
    response = post_trip(osaka, lodging, **extra)
    assert response.status_code == 201, response.text
    return response.json()


def plan(osaka: Osaka, day_id: str) -> dict:
    started = osaka.client.post(f"/days/{day_id}/planning", json={"mode": "auto"}, headers=bearer(ME))
    assert started.status_code == 201, started.text
    return started.json()


def planned(osaka: Osaka, lodging=..., **extra) -> tuple[dict, str, str, dict]:
    """계획 완료 날 하나 (자동 계획 -> 첫 안 고르기). (trip, day_id, date, 계획 응답)."""
    trip = made(osaka, lodging, **extra)
    day = trip["trip_days"][0]
    started = plan(osaka, day["day_id"])
    chosen = osaka.client.post(f"/course-options/{started['options'][0]['option_id']}/select", headers=bearer(ME))
    assert chosen.status_code == 200, chosen.text
    return trip, day["day_id"], day["date"], started


def at_of(date: str, hhmm: str) -> str:
    return f"{date}T{hhmm}:00"


def get_now(osaka: Osaka, day_id: str, at: str) -> dict:
    response = osaka.client.get(f"/days/{day_id}/now", params={"at": at}, headers=bearer(ME))
    assert response.status_code == 200, response.text
    return response.json()


def post_check(osaka: Osaka, day_id: str, at: str, rehearsal: bool = False, position=None) -> dict:
    body: dict = {"at": at}
    if position is not None:
        body["lat"], body["lng"] = position
    if rehearsal:
        body["rehearsal"] = True
    response = osaka.client.post(f"/days/{day_id}/check", json=body, headers=bearer(ME))
    assert response.status_code == 200, response.text
    return response.json()


def every_view(osaka: Osaka, day_id: str, at: str) -> dict[str, dict]:
    return {"now": get_now(osaka, day_id, at), "check": post_check(osaka, day_id, at), "rehearsal": post_check(osaka, day_id, at, rehearsal=True)}


def latlng(at: tuple[float, float]) -> dict:
    return {"lat": at[0], "lng": at[1]}


def without_ids(value):
    """새로 만든 id(option_id·session_id 등)는 비교에서 뺀다. place_id는 남긴다."""
    if isinstance(value, dict):
        return {k: without_ids(v) for k, v in value.items() if not (k.endswith("_id") and k != "place_id")}
    if isinstance(value, list):
        return [without_ids(v) for v in value]
    return value


def t08_at_day_end(osaka: Osaka, day_id: str, date: str) -> dict:
    """그날 마지막 분: 마지막 일정이 끝나 main = T-08 (TASK-007 Q1·F2)."""
    view = get_now(osaka, day_id, at_of(date, "23:59"))
    assert view["main"]["type"] == "T-08", view["main"]
    return view["main"]


@pytest.fixture
def mem(monkeypatch):
    """메모리 저장소 서버 하나 (ME의 Bearer가 기본 헤더). 가짜 오사카 (실제 Google·Serper 0)."""
    from api.main import app

    server_env(monkeypatch, "memory")
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


@pytest.fixture
def world(monkeypatch, request):
    """kind = memory | postgres (postgres는 로컬 TEST_DATABASE_URL이 있을 때만)."""
    from api.main import app

    server_env(monkeypatch, request.param)
    with TestClient(app, headers=bearer(ME)) as client:
        yield request.param, Osaka(client, app)


WORLDS = pytest.mark.parametrize("world", KINDS, indirect=True)


def saved_text(osaka: Osaka, kind: str, skip: tuple[str, ...] = ()) -> str:
    """저장된 모든 것의 글자: app.state 저장소 snapshot(skip 이름 빼고) + 체크포인트 + (Postgres) 모든 표."""
    parts = [repr(v) for name, v in stores(osaka).items() if name not in skip]
    parts.append(checkpoints_text(osaka))
    if kind == "postgres":
        parts.append(repr(db_tables()))
    return "\n".join(parts)


# =====================================================================
# ② 주소 검색 (Google, 종류 제한 없이)
# =====================================================================


def test_T15_A2_주소_검색은_공급자의_주소_검색_결과를_숙소_검색과_같은_모양으로(mem, monkeypatch):
    asked = install_address_search(monkeypatch, mem)
    response = address_search(mem, TYPED)
    assert response.status_code == 200, response.text
    assert response.json() == [{"place_id": ADDR_ID, "name": ADDR_NAME, "address_short": ADDR_SHORT}]
    assert asked == [TYPED]  # ①에서 친 같은 글을 그대로 주소로 (§A ②: 사용자가 다시 치지 않는다)


def test_T15_A2_주소_검색은_숙소_검색을_부르지_않는다(mem, monkeypatch):
    install_address_search(monkeypatch, mem)
    called: list[str] = []
    monkeypatch.setattr(mem.app.state.places_provider, "search_lodging", lambda q: called.append(q) or [])
    assert address_search(mem, TYPED).status_code == 200
    assert called == []


def test_T15_A2_주소_검색_공급자_실패는_503_PROVIDER_UNAVAILABLE(mem, monkeypatch):
    install_address_search(monkeypatch, mem, broken=True)
    response = address_search(mem, TYPED)
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert "RuntimeError" not in response.text and "주소 검색 공급자 실패" not in response.text  # 원인 문장은 담지 않는다 (숙소 검색과 같게)


def test_T15_A2_주소_검색도_로그인_토큰이_필요하다(mem, monkeypatch):
    install_address_search(monkeypatch, mem)
    response = mem.anon.get("/places/address-search", params={"city_code": "osaka", "q": TYPED})
    assert response.status_code == 401, response.text  # API-001 §1: 장소·숙소 검색은 Bearer


# ---------- Q1 글자 수·개수·시간 제한 = 숙소 검색과 같은 상수 ----------


@pytest.mark.parametrize("q", ["大", " 大 ", "", "   "], ids=["한_글자", "공백_지우면_한_글자", "빈_글", "공백만"])
def test_T15_Q1_주소_검색_두_글자_미만은_200_빈_목록이고_공급자를_부르지_않는다(mem, monkeypatch, q):
    asked = install_address_search(monkeypatch, mem)
    response = address_search(mem, q)
    assert (response.status_code, response.json()) == (200, [])
    assert asked == []


def test_T15_Q1_경계_주소_검색_두_글자면_부르고_앞뒤_공백은_지운다(mem, monkeypatch):
    asked = install_address_search(monkeypatch, mem)
    response = address_search(mem, "  大阪  ")
    assert response.status_code == 200 and len(response.json()) == 1
    assert asked == ["大阪"]


def many_hits(n: int) -> list[dict]:
    return [{"place_id": f"FAKE-T15-addr-{i}", "name": f"가짜_주소_이름_{i}", "address_short": f"가짜_주소_{i}"} for i in range(n)]


@pytest.mark.parametrize(("found", "shown"), [(7, 5), (5, 5), (4, 4)], ids=["7곳이면_5", "5곳이면_5", "4곳이면_4"])
def test_T15_Q1_주소_검색은_다섯_개까지(mem, monkeypatch, found, shown):
    install_address_search(monkeypatch, mem, hits=many_hits(found))
    response = address_search(mem, TYPED)
    assert [hit["place_id"] for hit in response.json()] == [f"FAKE-T15-addr-{i}" for i in range(shown)]


def test_T15_Q1_주소_검색의_글자_수·개수는_숙소_검색과_같은_상수를_쓴다(mem, monkeypatch):
    """상수를 바꾸면 두 검색이 같이 바뀐다 (한 검색창에서 이어지므로 따로 정하지 않는다, §9 Q1)."""
    import api.trips

    monkeypatch.setattr(api.trips, "LODGING_MIN_CHARS", 4)
    monkeypatch.setattr(api.trips, "LODGING_LIMIT", 2)
    asked = install_address_search(monkeypatch, mem, hits=many_hits(4))
    assert address_search(mem, "大阪市").json() == [] and asked == []  # 3글자 < 4
    assert len(address_search(mem, "大阪市浪").json()) == 2
    assert lodging_search(mem, "호텔").json() == []  # 시험 자체 확인: 숙소 검색도 같은 상수로 바뀐다
    assert len(lodging_search(mem, "난바 테스트").json()) <= 2


def test_T15_Q1_주소_검색_시간_제한은_숙소_검색과_같은_상수_넘으면_503(mem, monkeypatch):
    import time

    import api.trips

    monkeypatch.setattr(api.trips, "LODGING_TIMEOUT", 0.2)
    provider = mem.app.state.places_provider

    def slow(q):
        time.sleep(1.0)
        return many_hits(1)

    monkeypatch.setattr(provider, "search_address", slow, raising=False)
    began = time.monotonic()
    response = address_search(mem, TYPED)
    assert response.status_code == 503 and response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE", response.text
    assert time.monotonic() - began < 0.9


def test_T15_Q1_경계_시간_제한_안이면_결과를_준다(mem, monkeypatch):
    import time

    import api.trips

    monkeypatch.setattr(api.trips, "LODGING_TIMEOUT", 1.0)

    def quick(q):
        time.sleep(0.05)
        return many_hits(1)

    monkeypatch.setattr(mem.app.state.places_provider, "search_address", quick, raising=False)
    response = address_search(mem, TYPED)
    assert response.status_code == 200 and len(response.json()) == 1


def test_T15_A2_Google_주소_검색은_종류_제한_없이_textQuery로_필드_마스크를_붙여_부른다():
    """실제 Google을 부르지 않는다: 가짜 전송이 요청만 받아 적는다."""
    from places.provider import GooglePlaces

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"places": [{"id": "FAKE-g-1", "displayName": {"text": "가짜_이름"}, "shortFormattedAddress": "가짜_주소"}]})

    provider = GooglePlaces("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler)))
    found = provider.search_address(TYPED)
    assert found == [{"place_id": "FAKE-g-1", "name": "가짜_이름", "address_short": "가짜_주소"}]
    assert len(seen) == 1
    sent = json.loads(seen[0].content)
    assert sent["textQuery"] == TYPED
    assert "includedType" not in sent, sent  # §A ②: 종류 제한 없이 (에어비앤비·지인 집 주소도 나오게)
    mask = seen[0].headers.get("X-Goog-FieldMask", "")
    assert mask and "*" not in mask
    for banned in ("reviews", "photos"):
        assert banned not in mask.lower(), mask


def test_T15_A2_경계_숙소_검색은_지금처럼_lodging_종류로만():
    from places.provider import GooglePlaces

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"places": []})

    GooglePlaces("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler))).search_lodging("호텔")
    assert json.loads(seen[0].content)["includedType"] == "lodging"


# =====================================================================
# trip.lodging 모양 (세 경로 모두 여행이 만들어진다, AC-2)
# =====================================================================

SHAPES = [
    pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID}, full("place", place_id=GOOGLE_LODGING_ID), id="①이름_place"),
    pytest.param({"kind": "address", "address_text": TYPED, "place_id": ADDR_ID}, full("address", address_text=TYPED, place_id=ADDR_ID), id="②주소_장소ID있음"),
    pytest.param({"kind": "address", "address_text": TYPED}, full("address", address_text=TYPED), id="②주소_장소ID없음"),
    pytest.param(pin_body(), full("pin", lat=PIN[0], lng=PIN[1]), id="③찍기_이름표없음"),
    pytest.param(pin_body(label=LABEL), full("pin", lat=PIN[0], lng=PIN[1], label=LABEL), id="③찍기_이름표있음"),
]


@pytest.mark.parametrize(("sent", "expected"), SHAPES)
def test_T15_A_세_경로_모두_여행이_만들어지고_응답_lodging은_여섯_칸_모양(mem, monkeypatch, sent, expected):
    install_address_search(monkeypatch, mem)
    trip = made(mem, sent)
    assert trip["lodging"] == expected
    assert set(trip["lodging"]) == FIELDS


@pytest.mark.parametrize(("sent", "expected"), SHAPES)
def test_T15_A_GET_trip과_current도_같은_lodging(mem, monkeypatch, sent, expected):
    install_address_search(monkeypatch, mem)
    trip = made(mem, sent)
    assert mem.trip(trip["trip_id"], ME).json()["lodging"] == expected
    assert mem.current(ME).json()["lodging"] == expected


@WORLDS
def test_T15_Q1_찍은_좌표와_주소_글자는_저장소를_거쳐도_그대로(world, monkeypatch):
    """Postgres면 다른 연결로 다시 읽어도 같은 값 (trips.lodging). 소수 자리까지."""
    _kind, osaka = world
    install_address_search(monkeypatch, osaka)
    pinned = made(osaka, pin_body(label=LABEL))
    assert osaka.trip(pinned["trip_id"], ME).json()["lodging"] == full("pin", lat=PIN[0], lng=PIN[1], label=LABEL)
    typed = made(osaka, {"kind": "address", "address_text": TYPED, "place_id": ADDR_ID})
    assert osaka.trip(typed["trip_id"], ME).json()["lodging"] == full("address", address_text=TYPED, place_id=ADDR_ID)


def test_T15_A_옛_필드_lodging_place_id는_kind_place로_받는다(mem):
    body = trip_body(days=2, offset=OFFSET, lodging=GOOGLE_LODGING_ID)  # 옛 칸 lodging_place_id
    response = mem.post_trip(body, ME)
    assert response.status_code == 201, response.text
    assert response.json()["lodging"] == full("place", place_id=GOOGLE_LODGING_ID)


@pytest.mark.parametrize("sent", [..., None], ids=["칸_없음", "null"])
def test_T15_S6_숙소_없이도_지금처럼_만들어지고_lodging은_null(mem, sent):
    trip = made(mem, sent)
    assert "lodging" in trip and trip["lodging"] is None


MISSING = [
    pytest.param({"kind": "pin", "lng": PIN[1]}, id="pin_lat_없음"),
    pytest.param({"kind": "pin", "lat": PIN[0]}, id="pin_lng_없음"),
    pytest.param({"kind": "pin", "lat": None, "lng": None}, id="pin_좌표_null"),
    pytest.param({"kind": "place"}, id="place_장소ID_없음"),
    pytest.param({"kind": "address"}, id="address_글_없음"),
    pytest.param({"kind": "address", "address_text": "   "}, id="address_빈_글"),
    pytest.param({"place_id": GOOGLE_LODGING_ID}, id="kind_없음"),
]


def lodging_reason(response) -> str | None:
    """400 INVALID_LODGING의 이유 (§11 Q1). 다른 코드면 None."""
    error = response.json().get("error", {})
    return (error.get("detail") or {}).get("reason") if error.get("code") == "INVALID_LODGING" else None


@pytest.mark.parametrize("sent", MISSING)
def test_T15_S11_Q1_필수_칸이_빠진_lodging은_400_INVALID_LODGING_missing_field이고_아무것도_저장하지_않는다(mem, sent):
    """§11 Q1: 숙소 문제는 한 코드, 이유는 reason (이전: 400 VALIDATION_ERROR · detail.field = "lodging")."""
    before = stores(mem)
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "missing_field", response.json()
    assert stores(mem) == before


def test_T15_A_모르는_kind는_400이고_아무것도_저장하지_않는다(mem):
    """모르는 kind의 코드·reason은 §11 Q1 목록에 없다(질문) -> 400과 저장 0만 본다."""
    before = stores(mem)
    response = post_trip(mem, {"kind": "house", "place_id": GOOGLE_LODGING_ID})
    assert response.status_code == 400, response.text
    assert stores(mem) == before


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID, "lat": PIN[0], "lng": PIN[1]}, id="place"),
        pytest.param({"kind": "address", "address_text": TYPED, "place_id": ADDR_ID, "lat": PIN[0], "lng": PIN[1]}, id="address"),
    ],
)
def test_T15_Q4_place·address에_좌표를_실어_보내면_400_INVALID_LODGING이고_아무것도_저장하지_않는다(mem, monkeypatch, sent):
    """§9 Q4: 조용히 버리면 앱이 Google 좌표를 보내는 실수를 못 찾는다 -> 거절 (이전 "400이든 버리고 받든" 단언을 바꿈)."""
    install_address_search(monkeypatch, mem)
    before = stores(mem)
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "coords_not_allowed", response.json()  # §11 Q1
    assert stores(mem) == before
    assert not leaks(repr(stores(mem)["trip_store"]), PIN)


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID, "lat": PIN[0]}, id="place_lat만"),
        pytest.param({"kind": "address", "address_text": TYPED, "lng": PIN[1]}, id="address_lng만"),
    ],
)
def test_T15_Q4_경계_좌표_한쪽만_실어도_400_INVALID_LODGING(mem, monkeypatch, sent):
    install_address_search(monkeypatch, mem)
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "coords_not_allowed", response.json()  # §11 Q1


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID, "lat": None, "lng": None}, id="place"),
        pytest.param({"kind": "address", "address_text": TYPED, "place_id": ADDR_ID, "lat": None, "lng": None}, id="address"),
    ],
)
def test_T15_Q4_경계_lat·lng가_null이면_좌표가_온_것이_아니다(mem, monkeypatch, sent):
    """6칸 늘 있는 모양(§9)이라 앱이 null을 채워 보낼 수 있다 -> 그대로 받는다."""
    install_address_search(monkeypatch, mem)
    response = post_trip(mem, sent)
    assert response.status_code == 201, response.text
    assert response.json()["lodging"]["lat"] is None and response.json()["lodging"]["lng"] is None


# ---------- Q5 label ----------

LABEL_30 = "가" * 30


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID, "label": "에어비앤비 난바"}, id="place"),
        pytest.param({"kind": "address", "address_text": TYPED, "place_id": ADDR_ID, "label": "에어비앤비 난바"}, id="address"),
        pytest.param({**pin_body(), "label": "에어비앤비 난바"}, id="pin"),
    ],
)
def test_T15_Q5_label은_모든_kind에_받고_저장소를_거쳐도_그대로(mem, monkeypatch, sent):
    install_address_search(monkeypatch, mem)
    trip = made(mem, sent)
    assert trip["lodging"]["label"] == "에어비앤비 난바"
    assert mem.trip(trip["trip_id"], ME).json()["lodging"]["label"] == "에어비앤비 난바"


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        pytest.param("  친구 집  ", "친구 집", id="앞뒤_공백_자름"),
        pytest.param("친구  집", "친구  집", id="가운데_공백은_그대로"),
        pytest.param(LABEL_30, LABEL_30, id="30자_그대로"),
        pytest.param(f"   {LABEL_30}   ", LABEL_30, id="자른_뒤_30자면_받는다"),
        pytest.param("", None, id="빈_글은_null"),
        pytest.param("   ", None, id="공백만은_null"),
        pytest.param(None, None, id="null은_null"),
    ],
)
def test_T15_Q5_label은_앞뒤_공백을_자르고_빈_글은_null(mem, label, expected):
    trip = made(mem, {**pin_body(), "label": label})
    assert trip["lodging"]["label"] == expected


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({**pin_body(), "label": "가" * 31}, id="pin_31자"),
        pytest.param({**pin_body(), "label": f"  {'가' * 31}  "}, id="pin_자른_뒤_31자"),
        pytest.param({**pin_body(), "label": "가" * 200}, id="pin_200자"),
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID, "label": "가" * 31}, id="place_31자"),
        pytest.param({"kind": "address", "address_text": TYPED, "place_id": ADDR_ID, "label": "가" * 31}, id="address_31자"),
    ],
)
def test_T15_S11_Q2_경계_label_31자_이상은_400_label_too_long이고_자르지_않고_저장하지_않는다(mem, monkeypatch, sent):
    """§11 Q2: 조용히 자르지 않는다 (이전 단언: "400이든 30자로 자르든 31자가 저장되지 않는다")."""
    install_address_search(monkeypatch, mem)
    before = stores(mem)
    response = post_trip(mem, sent)
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "label_too_long", response.json()
    assert stores(mem) == before


# ---------- Q5 pin은 city.center에서 50km 안 ----------

CENTER_V3 = (34.6662, 135.5010)  # TASK-015 §9 Q6, docs/data/osaka-seed.yaml v3
KM_PER_LAT_DEG = 6371.0 * 3.141592653589793 / 180  # 경도가 같으면 거리 = 위도 차 x 이 값 (지구 반지름 6371km)


def north_of_center(km: float) -> tuple[float, float]:
    return (CENTER_V3[0] + km / KM_PER_LAT_DEG, CENTER_V3[1])


def south_of_center(km: float) -> tuple[float, float]:
    return (CENTER_V3[0] - km / KM_PER_LAT_DEG, CENTER_V3[1])


@pytest.fixture
def mem_v3(monkeypatch, tmp_path):
    """city.center = 정본 v3 값으로 켠 서버 (test_task015_city_center.use_v3_center)."""
    from api.main import app
    from test_task015_city_center import use_v3_center

    server_env(monkeypatch, "memory")
    use_v3_center(monkeypatch, tmp_path)
    with TestClient(app, headers=bearer(ME)) as client:
        yield Osaka(client, app)


@pytest.mark.parametrize(
    "at",
    [
        pytest.param(north_of_center(49.5), id="북쪽_49_5km"),
        pytest.param(south_of_center(49.5), id="남쪽_49_5km"),
        pytest.param((34.9858, 135.7588), id="교토역_약_42km"),  # §9 Q5: 오사카 여행에 교토 숙소 정도는 들어오게
        pytest.param(CENTER_V3, id="도시_중심_그_자리"),
    ],
)
def test_T15_Q5_city_center에서_50km_안의_pin은_받는다(mem_v3, at):
    trip = made(mem_v3, pin_body(at))
    assert (trip["lodging"]["lat"], trip["lodging"]["lng"]) == at


@pytest.mark.parametrize(
    "at",
    [
        pytest.param(north_of_center(50.5), id="북쪽_50_5km"),
        pytest.param(south_of_center(50.5), id="남쪽_50_5km"),
        pytest.param((35.6812, 139.7671), id="도쿄역"),
    ],
)
def test_T15_Q5_city_center에서_50km_밖의_pin은_400이고_아무것도_저장하지_않는다(mem_v3, at):
    before = stores(mem_v3)
    response = post_trip(mem_v3, pin_body(at))
    assert response.status_code == 400, response.text
    assert lodging_reason(response) == "too_far", response.json()  # §11 Q1 (앱은 이 이유로 a2 안내)
    assert stores(mem_v3) == before


# ---------- Q2 응답에 lodging_place_id 없음 ----------


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param({"kind": "place", "place_id": GOOGLE_LODGING_ID}, id="place"),
        pytest.param(pin_body(), id="pin"),
        pytest.param(None, id="숙소_없음"),
    ],
)
def test_T15_Q2_Trip_응답_세_곳_모두_lodging_place_id_칸이_없다(mem, sent):
    trip = made(mem, sent)
    assert "lodging_place_id" not in trip, sorted(trip)
    assert "lodging_place_id" not in mem.trip(trip["trip_id"], ME).json()
    assert "lodging_place_id" not in mem.current(ME).json()


def test_T15_Q2_옛_필드로_보내도_응답엔_lodging만(mem):
    body = trip_body(days=2, offset=OFFSET, lodging=GOOGLE_LODGING_ID)  # 요청의 옛 칸 lodging_place_id
    trip = mem.post_trip(body, ME).json()
    assert "lodging_place_id" not in trip
    assert trip["lodging"]["place_id"] == GOOGLE_LODGING_ID


def test_T15_Q2_OpenAPI의_Trip에_lodging_place_id가_없다():
    """앱 타입은 OpenAPI에서 생성한다 (packages/api-types)."""
    from api.main import app

    trip = app.openapi()["components"]["schemas"]["Trip"]
    assert "lodging" in trip["properties"] and "lodging_place_id" not in trip["properties"], sorted(trip["properties"])


# =====================================================================
# 엔진: 숙소 좌표를 쓰는 곳이 세 종류 모두 같은 값을 받는다
# =====================================================================


@pytest.mark.parametrize("kind", ["now", "check", "rehearsal"])
def test_T15_A_pin이면_오늘·실제_check·연습_응답의_day_lodging이_찍은_좌표(mem, kind):
    _trip, day_id, date, _started = planned(mem, pin_body())
    view = every_view(mem, day_id, at_of(date, "12:00"))[kind]
    assert view["day"]["lodging"] == latlng(PIN)


def test_T15_A_pin이면_계획_응답의_day_lodging이_찍은_좌표(mem):
    _trip, _day_id, _date, started = planned(mem, pin_body())
    assert started["day"]["lodging"] == latlng(PIN)


def test_T15_A_pin의_T_08은_찍은_좌표로_길_안내를_연다(mem):
    _trip, day_id, date, _started = planned(mem, pin_body(label=LABEL))
    card = t08_at_day_end(mem, day_id, date)
    assert card["lodging"] == latlng(PIN)
    assert card["map_url"] and f"destination={PIN[0]},{PIN[1]}" in card["map_url"]
    assert "destination_place_id" not in card["map_url"]  # 찍은 곳은 장소 ID가 없다
    assert card["go_home_min"] is not None  # 돌아갈 숙소가 있다 (§10 Q27의 반대쪽)


def test_T15_A_pin의_계획은_숙소로_돌아가기가_있다(mem):
    _trip, _day_id, _date, started = planned(mem, pin_body())
    assert all(option["go_home_min"] is not None for option in started["options"])


def test_T15_A_address는_장소_ID로_그때_불러온_좌표를_모든_곳이_쓴다(mem, monkeypatch):
    install_address_search(monkeypatch, mem)
    _trip, day_id, date, started = planned(mem, {"kind": "address", "address_text": TYPED, "place_id": ADDR_ID})
    assert started["day"]["lodging"] == latlng(ADDR_AT)
    for kind, view in every_view(mem, day_id, at_of(date, "12:00")).items():
        assert view["day"]["lodging"] == latlng(ADDR_AT), kind
    assert t08_at_day_end(mem, day_id, date)["lodging"] == latlng(ADDR_AT)


def test_T15_A_장소_ID_없는_address는_숙소_없음과_같다(mem):
    """TASK-014 §30 Q6: 모르는 숙소 = 없는 숙소. 도시 중심을 숙소인 척 내보내지 않는다."""
    _trip, day_id, date, started = planned(mem, {"kind": "address", "address_text": TYPED})
    assert all(option["go_home_min"] is None for option in started["options"])
    for kind, view in every_view(mem, day_id, at_of(date, "12:00")).items():
        assert view["day"]["lodging"] is None, kind
    card = t08_at_day_end(mem, day_id, date)
    assert card["lodging"] is None and card["map_url"] is None and card["go_home_min"] is None


SAME_PLACE = [
    pytest.param({"kind": "address", "address_text": TYPED, "place_id": GOOGLE_LODGING_ID}, id="address"),
    pytest.param(pin_body(GOOGLE_LODGING_AT), id="pin"),
]


@pytest.mark.parametrize("other", SAME_PLACE)
def test_T15_A_같은_자리면_세_종류의_계획·첫_이동·돌아가기·T_08·집_표시가_같다(mem, other):
    """①로 고른 숙소와 같은 자리를 ②(같은 장소 ID)나 ③(같은 좌표)으로 넣으면 엔진 결과가 같다."""
    _t1, day_a, date_a, plan_a = planned(mem, {"kind": "place", "place_id": GOOGLE_LODGING_ID})
    _t2, day_b, date_b, plan_b = planned(mem, other)
    assert plan_a["day"]["lodging"] == plan_b["day"]["lodging"] == latlng(GOOGLE_LODGING_AT)
    assert without_ids(plan_a["options"]) == without_ids(plan_b["options"])  # 하루 첫 이동·마지막 돌아가기 포함
    for clock in ("09:00", "12:00", "23:59"):
        a, b = get_now(mem, day_a, at_of(date_a, clock)), get_now(mem, day_b, at_of(date_b, clock))
        assert a["day"]["lodging"] == b["day"]["lodging"], clock
        assert a["route"] == b["route"], clock  # 지도 경로 선의 숙소 끝
    card_a, card_b = t08_at_day_end(mem, day_a, date_a), t08_at_day_end(mem, day_b, date_b)
    assert (card_a["lodging"], card_a["go_home_min"]) == (card_b["lodging"], card_b["go_home_min"])


# =====================================================================
# 저장 규칙 (AC-2 · Q1): Google 이름·주소·좌표 0, 사용자 주소 글자·찍은 좌표는 trip.lodging에만
# =====================================================================


def three_paths(osaka: Osaka, monkeypatch) -> list[tuple[str, str]]:
    """① 이름 검색 -> place, ② 주소 검색 -> address(장소 ID), ③ 지도 찍기 -> pin. 각각 계획·오늘·check·연습까지. [(day_id, date)]."""
    install_address_search(monkeypatch, osaka)
    hit = lodging_search(osaka).json()[0]
    assert (hit["place_id"], hit["name"], hit["address_short"]) == (GOOGLE_LODGING_ID, GOOGLE_LODGING_NAME, GOOGLE_LODGING_ADDRESS)  # 시험 자체 확인
    found = address_search(osaka, TYPED)
    assert found.status_code == 200, found.text
    days = []
    for lodging in (
        {"kind": "place", "place_id": hit["place_id"]},
        {"kind": "address", "address_text": TYPED, "place_id": found.json()[0]["place_id"]},
        pin_body(label=LABEL),
    ):
        _trip, day_id, date, _started = planned(osaka, lodging)
        every_view(osaka, day_id, at_of(date, "12:00"))
        get_now(osaka, day_id, at_of(date, "23:59"))
        days.append((day_id, date))
    return days


@WORLDS
def test_T15_AC2_Google_이름·주소_문구는_저장소·체크포인트·DB_어디에도_없다(world, monkeypatch):
    kind, osaka = world
    three_paths(osaka, monkeypatch)
    text = saved_text(osaka, kind)
    for google_text in (GOOGLE_LODGING_NAME, GOOGLE_LODGING_ADDRESS, ADDR_NAME, ADDR_SHORT):
        assert google_text not in text, google_text
    assert TYPED in text  # 시험 자체 확인 + Q1: 사용자가 친 주소 글자는 여행 데이터로 남는다


@WORLDS
def test_T15_AC2_Google_좌표는_여행·사건·체크포인트·DB에_없다(world, monkeypatch):
    """메모리 계획 저장소(planning_repo)는 그날 계산용 좌표를 들고 있어 뺀다 (Postgres는 trips에서 되살리고 표에 좌표를 두지 않는다)."""
    kind, osaka = world
    three_paths(osaka, monkeypatch)
    text = saved_text(osaka, kind, skip=("planning_repo",))
    assert not leaks(text, GOOGLE_LODGING_AT)
    assert not leaks(text, ADDR_AT)


@WORLDS
def test_T15_Q1_찍은_좌표는_trip_lodging에만_있다(world, monkeypatch):
    kind, osaka = world
    three_paths(osaka, monkeypatch)
    every = stores(osaka)
    assert leaks(repr(every["trip_store"]), PIN), "시험 자체 확인: 찍은 좌표가 여행에 저장돼 있다 (Q1)"
    assert not leaks(repr(every["trip_repo"]), PIN)  # 사건·제안·영업 확인
    assert not leaks(checkpoints_text(osaka), PIN)
    if kind == "postgres":
        tables = db_tables()
        assert leaks(repr(tables["trips"]), PIN)
        others = {name: rows for name, rows in tables.items() if name != "trips"}
        assert not leaks(repr(others), PIN), [name for name, rows in others.items() if leaks(repr(rows), PIN)]


@WORLDS
def test_T15_Q1_찍은_좌표_여행에서도_실시간_위치는_어디에도_저장되지_않는다(world, monkeypatch):
    """두 값을 섞지 않는다: 숙소 좌표는 저장, 실시간 위치(check 본문)는 저장 0 (TASK-014 B2)."""
    kind, osaka = world
    _trip, day_id, date, _started = planned(osaka, pin_body())
    for clock in ("11:00", "12:00", "15:00"):
        post_check(osaka, day_id, at_of(date, clock), position=LIVE)
        post_check(osaka, day_id, at_of(date, clock), rehearsal=True, position=LIVE)
    assert not leaks(saved_text(osaka, kind, skip=()), LIVE)


@WORLDS
def test_T15_AC2_Q1_서버_로그·경고에_Google_이름·주소·좌표와_찍은_좌표가_없다(world, monkeypatch, caplog):
    _kind, osaka = world
    caplog.set_level(logging.DEBUG)
    three_paths(osaka, monkeypatch)
    texts = "\n".join(server_messages(caplog))
    for google_text in (GOOGLE_LODGING_NAME, GOOGLE_LODGING_ADDRESS, ADDR_NAME, ADDR_SHORT):
        assert google_text not in texts, google_text
    for at in (GOOGLE_LODGING_AT, ADDR_AT, PIN):
        assert not leaks(texts, at), at


def test_T15_AC2_주소_검색_실패의_로그에도_검색_글자·Google_값이_없다(mem, monkeypatch, caplog):
    install_address_search(monkeypatch, mem, broken=True)
    caplog.set_level(logging.DEBUG)
    assert address_search(mem, TYPED).status_code == 503
    texts = "\n".join(server_messages(caplog))
    assert ADDR_NAME not in texts and ADDR_SHORT not in texts


def test_T15_AC2_디스크의_좌표_캐시_파일에_Google_이름·주소와_찍은_좌표가_없다(mem, monkeypatch, tmp_path):
    """실제 모드의 좌표 캐시(.cache/places, 30일 규칙)는 place_id·좌표만 둔다. 가짜 모드는 파일을 쓰지 않으므로 쓰는 자리를 tmp로 바꿔 본다."""
    cache_file = tmp_path / "places" / "osaka.json"
    cache_file.parent.mkdir(parents=True)
    monkeypatch.setattr(mem.app.state.city, "_cache_path", cache_file)
    three_paths(mem, monkeypatch)
    written = "\n".join(path.read_text(encoding="utf-8") for path in tmp_path.rglob("*") if path.is_file())
    assert written, "시험 자체 확인: 계획 시작 때 좌표 캐시를 썼다 (TripBook.refresh_hours planning)"
    for text in (GOOGLE_LODGING_NAME, GOOGLE_LODGING_ADDRESS, ADDR_NAME, ADDR_SHORT, TYPED, LABEL):
        assert text not in written, text
    assert not leaks(written, PIN)


def test_T15_A_숙소는_우리_장소_목록에_들어가지_않는다(mem, monkeypatch):
    """§A: 숙소는 places(도시 팩)에 넣지 않는다. 장소 검색에 숙소 이름·주소 검색 결과·찍은 이름표가 나오지 않는다."""
    three_paths(mem, monkeypatch)
    pack_ids = {row["place_id"] for row in mem.app.state.city.pack["places"]}
    assert GOOGLE_LODGING_ID not in pack_ids and ADDR_ID not in pack_ids
    for q in (GOOGLE_LODGING_NAME, ADDR_NAME, LABEL):
        response = mem.client.get("/places/search", params={"city_code": "osaka", "q": q}, headers=bearer(ME))
        assert response.status_code == 200 and response.json() == [], q


# ---------- 스키마 (정적 검사, TASK-012 A6 도구 그대로) ----------


def test_T15_A_trips에_lodging_jsonb_열이_있다():
    from test_task012_schema import schema

    columns = schema()["trips"]["columns"]
    assert "lodging" in columns, sorted(columns)
    assert "jsonb" in columns["lodging"], columns["lodging"]


def test_T15_A_경계_새_마이그레이션에도_좌표_이름의_열은_없다():
    """찍은 좌표는 trips.lodging 한 칸 안에만. lodging_lat 같은 열로 펼치지 않는다 (TASK-012 A6·TASK-014 B2 검사가 그대로 통과)."""
    from test_task012_schema import LOCATION_NAME, LOCATION_TYPE, schema

    found = [f"{t}.{c}" for t, entry in schema().items() for c, k in entry["columns"].items() if LOCATION_NAME.search(c) or LOCATION_TYPE.search(k)]
    assert found == []


# ---------- §6 실패: 주소 검색이 안 돼도 막히지 않는다 ----------


def test_T15_S6_주소_검색이_503이어도_바로_지도_찍기로_여행을_만든다(mem, monkeypatch):
    install_address_search(monkeypatch, mem, broken=True)
    assert address_search(mem, TYPED).status_code == 503
    trip = made(mem, pin_body())
    assert trip["lodging"] == full("pin", lat=PIN[0], lng=PIN[1])


def test_T15_S6_찍기는_Google을_부르지_않는다(mem, monkeypatch):
    """§A ③: Google 호출 없음. 여행 만들기·계획·오늘 화면까지 숙소 때문에 공급자를 부르지 않는다 (영업시간 부르기는 장소 id만)."""
    provider = mem.app.state.places_provider
    asked: list[str] = []
    inner = provider.details
    monkeypatch.setattr(provider, "details", lambda place_id: asked.append(place_id) or inner(place_id))
    monkeypatch.setattr(provider, "search_lodging", lambda q: pytest.fail("숙소 검색을 불렀다"))
    monkeypatch.setattr(provider, "search_address", lambda q: pytest.fail("주소 검색을 불렀다"), raising=False)
    _trip, day_id, date, _started = planned(mem, pin_body())
    get_now(mem, day_id, at_of(date, "23:59"))
    pack_ids = {row["place_id"] for row in mem.app.state.city.pack["places"]} | {mem.app.state.city.pack["center"]["place_id"]}
    assert set(asked) <= pack_ids, set(asked) - pack_ids
