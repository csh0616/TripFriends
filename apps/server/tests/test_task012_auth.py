"""TASK-012 B2 서버 인증 + §6 DB 연결 실패 + §10 Q2~Q5·Q11.
근거: TASK-012 §B B2·B4·§6 실패 표·§8·§10(Q2 JWKS·aud·여유 10초, Q3 오류 code, Q4 인증 범위, Q5 데모 주인, Q11 is_demo),
ADR-016 §3-3(Bearer, X-Device-Id 대체), ADR-017 §2 겹 1(사용자 데이터 API + 장소·숙소 검색에 Bearer), API-001 §1 오류 형식·인증 줄,
TASK-010 §B2(다른 기기의 여행은 없는 것과 같다 -> 다른 사용자).

계약 (승인 + 이 테스트가 정한 것):
    api.auth.verify_token(token, jwks, now=None) -> user_id(= JWT sub). 틀리면 api.auth.AuthError
        ES256(P-256), 머리 kid로 JWKS의 키를 고른다. aud == "authenticated". 만료 여유 10초:
        now < exp + 10 이면 받고, now >= exp + 10 이면 거절 (정각 exp + 10은 거절 쪽 — test-writer가 정한 경계, 승인 대기)
    서버는 공개 키를 api.auth.fetch_jwks(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")로 받아 캐시한다 (요청마다 부르지 않음)
    Bearer가 필요한 길(없거나 틀리면 401 UNAUTHORIZED): 여행·날·고정 일정·계획·여행 중(now·check·accept·dismiss)·영업 확인·장소 검색·숙소 검색·데모 시드
        §11 Q1: 토큰 없이 열린 길은 /health·/catalog 둘뿐 (app.routes 전부를 훑어 확인). FastAPI 문서 길(include_in_schema=False)은 세지 않음
    §11 Q3: 남의 여행·날·계획 세션·코스안·고정 일정·사건·제안은 404 NOT_FOUND (있는지 알리지 않음), 상대 데이터는 그대로
        인증은 다른 검사(없는 리소스 404, 본문 400)보다 먼저
    데모 시드: 토큰 필요, 데모는 그 사용자 소유·지금 여행은 그대로. as_current: true일 때만 지금 여행으로 붙임 (test_task010_seed_device)
    DB에 못 붙으면(DATABASE_URL이 닿지 않는 곳) 서버는 켜지고, 저장소를 쓰는 요청은 503 STORAGE_UNAVAILABLE (응답에 DB 주소 없음)
    여행 응답 Trip에 is_demo (Q11)
테스트 키는 auth_helpers의 가짜 P-256 키 (실제 키 금지, 네트워크 0).
"""

import string

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from api.auth import AuthError, verify_token
from auth_helpers import (
    FAKE_JWKS,
    FAKE_KEY,
    G,
    JWKS_URL,
    N,
    OTHER_KEY,
    STRANGER_KEY,
    FakeKey,
    bearer,
    es256_sign,
    es256_verify,
    install_fake_jwks,
    make_token,
    mul,
    on_curve,
    user_id,
)
from storage_helpers import server_env
from test_task010_trips import DEVICE, at, osaka, trip_body  # noqa: F401 (osaka = 가짜 오사카 서버 fixture)

ME, YOU = DEVICE, "user-B"  # ME = osaka 기본 헤더의 사용자 (계획 요청도 ME)
ID = "00000000-0000-4000-8000-000000000000"  # 없는 리소스 (인증이 먼저라 401)


def assert_401(response) -> None:
    assert response.status_code == 401, response.text
    error = response.json()["error"]
    assert error["code"] == "UNAUTHORIZED" and error["message"]


def routes(client: TestClient) -> dict:
    """Bearer가 필요한 길 전부 (§10 Q4). 본문은 모양이 맞는 값이라 인증만 걸린다."""
    fixed = {"trip_day_id": ID, "title": "저녁", "start_at": at("2026-12-11", "18:00"), "end_at": at("2026-12-11", "19:00")}
    q = {"city_code": "osaka", "q": "구로몬"}
    return {
        "POST_trips": lambda h: client.post("/trips", json=trip_body(), headers=h),
        "GET_current": lambda h: client.get("/trips/current", headers=h),
        "GET_trip": lambda h: client.get(f"/trips/{ID}", headers=h),
        "POST_fixed": lambda h: client.post(f"/trips/{ID}/fixed-events", json=fixed, headers=h),
        "DELETE_fixed": lambda h: client.delete(f"/fixed-events/{ID}", headers=h),
        "GET_course": lambda h: client.get(f"/days/{ID}/course", headers=h),
        "POST_planning": lambda h: client.post(f"/days/{ID}/planning", json={"mode": "conversation"}, headers=h),
        "GET_planning": lambda h: client.get(f"/planning/{ID}", headers=h),
        "POST_answer": lambda h: client.post(f"/planning/{ID}/answer", json={"choice_ids": []}, headers=h),
        "POST_reactions": lambda h: client.post(f"/planning/{ID}/reactions", json={"place_id": "osaka-fake-kuromon", "action": "like"}, headers=h),
        "POST_next": lambda h: client.post(f"/planning/{ID}/next", json={}, headers=h),
        "POST_compose": lambda h: client.post(f"/planning/{ID}/compose", headers=h),
        "POST_adjust": lambda h: client.post(f"/planning/{ID}/adjust", json={"option_id": ID, "place_id": "osaka-fake-kuromon", "delta": 15}, headers=h),
        "POST_back": lambda h: client.post(f"/planning/{ID}/back", headers=h),
        "POST_select": lambda h: client.post(f"/course-options/{ID}/select", headers=h),
        "GET_now": lambda h: client.get(f"/days/{ID}/now", params={"at": "2026-12-11T12:00:00"}, headers=h),
        "POST_check": lambda h: client.post(f"/days/{ID}/check", json={"at": "2026-12-11T12:00:00"}, headers=h),
        "POST_accept": lambda h: client.post(f"/proposals/{ID}/accept", headers=h),
        "POST_dismiss": lambda h: client.post(f"/events/{ID}/dismiss", headers=h),
        "POST_visit_check": lambda h: client.post("/places/osaka-fake-kuromon/visit-checks", json={"day_id": ID, "at": "2026-12-11T12:00:00", "was_open": True}, headers=h),
        "GET_places_search": lambda h: client.get("/places/search", params=q, headers=h),
        "GET_lodging_search": lambda h: client.get("/places/lodging-search", params={**q, "q": "호텔 닛코"}, headers=h),
        "POST_seed_demo": lambda h: client.post("/debug/seed-demo", headers=h),  # §11 Q1
    }


ROUTES = list(routes(None))  # type: ignore[arg-type]  (이름만, 부르지 않는다)

BAD = {
    "헤더_없음": {},
    "Bearer만": {"Authorization": "Bearer "},
    "JWT_아님": {"Authorization": "Bearer not-a-jwt"},
    "다른_키로_서명(같은_kid)": {"Authorization": f"Bearer {make_token(user_id(ME), key=OTHER_KEY)}"},
    "JWKS에_없는_kid": {"Authorization": f"Bearer {make_token(user_id(ME), key=STRANGER_KEY)}"},
    "만료(1시간_전)": {"Authorization": f"Bearer {make_token(user_id(ME), expires_in=-3600)}"},
    "aud가_다름": {"Authorization": f"Bearer {make_token(user_id(ME), aud='anon')}"},
    "aud_없음": {"Authorization": f"Bearer {make_token(user_id(ME), aud=None)}"},
    "서명_없음(alg_none)": {"Authorization": f"Bearer {make_token(user_id(ME), alg='none')}"},
    "알고리즘_바꿔치기(HS256)": {"Authorization": f"Bearer {make_token(user_id(ME), alg='HS256')}"},
    "sub_없음": {"Authorization": f"Bearer {make_token(None)}"},
    "Bearer가_아닌_방식": {"Authorization": f"Basic {make_token(user_id(ME))}"},
    "X_Device_Id만(옛_방식)": {"X-Device-Id": "device-A"},
}


# ---------- 테스트 도구 자기 점검 (암호 라이브러리 없이 만든 가짜 P-256 서명이 맞는지) ----------


def test_T12_도구_P256_기준점은_곡선_위에_있고_차수_N():
    assert on_curve(G)
    assert mul(N) is None
    assert on_curve(FAKE_KEY.public)


def test_T12_도구_서명은_같은_키로만_확인되고_글자가_바뀌면_틀린다():
    signature = es256_sign(FAKE_KEY.private, b"tripfriends")
    assert es256_verify(FAKE_KEY.public, b"tripfriends", signature)
    assert not es256_verify(OTHER_KEY.public, b"tripfriends", signature)
    assert not es256_verify(FAKE_KEY.public, b"tripfriendz", signature)


# ---------- B2·Q4 Bearer가 필요한 길: 없거나 틀리면 401 UNAUTHORIZED ----------


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("case", list(BAD))
def test_T12_B2_Q3_Q4_토큰이_없거나_틀리면_401_UNAUTHORIZED(osaka, route, case):  # noqa: F811
    assert_401(routes(osaka.anon)[route](BAD[case]))


@pytest.mark.parametrize("route", ["GET_places_search", "GET_lodging_search", "GET_current"])
def test_T12_Q4_맞는_토큰이면_검색·지금_여행이_401이_아니다(osaka, route):  # noqa: F811
    assert routes(osaka.anon)[route](bearer(ME)).status_code != 401


@pytest.mark.parametrize("path", ["/health", "/catalog"])
def test_T12_Q4_health·catalog는_토큰_없이_된다(osaka, path):  # noqa: F811
    assert osaka.anon.get(path).status_code == 200


PUBLIC = {("GET", "/health"), ("GET", "/catalog")}


def test_T12_S11_Q1_토큰_없이_열린_길은_health·catalog_둘뿐(osaka):  # noqa: F811
    # app의 모든 길(메서드마다)을 토큰 없이 부른다. 경로 칸은 없는 ID, 본문은 빈 JSON. 인증이 먼저라 401이어야 한다
    import re

    from fastapi.routing import APIRoute

    opened = []
    for route in osaka.app.routes:
        if not isinstance(route, APIRoute) or not route.include_in_schema:
            continue
        path = re.sub(r"\{[^}]+\}", ID, route.path)
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            if (method, route.path) in PUBLIC:
                continue
            kwargs = {} if method in ("GET", "DELETE") else {"json": {}}
            response = osaka.anon.request(method, path, **kwargs)
            if response.status_code != 401:
                opened.append(f"{method} {route.path} -> {response.status_code}")
    assert opened == []


def test_T12_B2_틀린_토큰으로는_아무것도_만들지_않는다(osaka):  # noqa: F811
    for headers in BAD.values():
        osaka.anon.post("/trips", json=trip_body(), headers=headers)
    assert osaka.current(ME).status_code == 404


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(token=st.text(alphabet=string.ascii_letters + string.digits + "-_.", min_size=1, max_size=200))
def test_T12_B2_속성_아무_글자_토큰은_500이_아니라_401(osaka, token):  # noqa: F811
    assert_401(osaka.anon.get("/trips/current", headers={"Authorization": f"Bearer {token}"}))


# ---------- Q2 공개 키는 JWKS 주소에서 받아 캐시 ----------


def test_T12_Q2_공개_키는_SUPABASE_URL의_JWKS에서_받고_요청마다_부르지_않는다(monkeypatch):
    from api.main import app
    from test_task010_trips import Osaka

    server_env(monkeypatch, "memory")
    calls = install_fake_jwks(monkeypatch)
    with TestClient(app) as client:
        osaka = Osaka(client, app)
        for _ in range(5):
            assert osaka.current(ME).status_code == 404
    assert calls and set(calls) == {JWKS_URL}
    assert len(calls) == 1


# ---------- B2 맞는 토큰이면 user_id로 구분 ----------


def test_T12_B2_맞는_토큰이면_그_사용자의_여행(osaka):  # noqa: F811
    made = osaka.make_trip(device=ME)
    assert osaka.current(ME).json()["trip_id"] == made["trip_id"]


def test_T12_B2_B4_토큰을_새로_받아도_sub가_같으면_같은_사용자(osaka):  # noqa: F811
    made = osaka.make_trip(device=ME)
    renewed = {"Authorization": f"Bearer {make_token(user_id(ME), expires_in=7200, session_id='새로_받은_세션')}"}
    assert osaka.anon.get("/trips/current", headers=renewed).json()["trip_id"] == made["trip_id"]


def _mine(osaka):
    """ME의 여행: 0일째 계획 대화(후보 단계), 1일째 고른 코스 + 열린 사건·제안, 고정 일정 하나."""
    from test_task012_contract import event, proposal

    mine = osaka.make_trip(device=ME)
    day0, day1 = mine["trip_days"][0]["day_id"], mine["trip_days"][1]["day_id"]
    fixed = osaka.add_fixed(mine, 0, "12:00", "13:00").json()
    started = osaka.client.post(f"/days/{day0}/planning", json={"mode": "conversation"}).json()
    sid = started["session_id"]
    first = started["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{sid}/answer", json={"choice_ids": [first]}).json()
    auto = osaka.client.post(f"/days/{day1}/planning", json={"mode": "auto"}).json()
    option_id = auto["options"][0]["option_id"]
    other_option = auto["options"][-1]["option_id"]
    osaka.client.post(f"/course-options/{option_id}/select")
    record = event(day1)
    osaka.app.state.trip_repo.put_event(record)
    made = proposal(record.event_id)
    osaka.app.state.trip_repo.put_proposals(record.event_id, [made])
    place = batch["candidates"][0]["place"]["id"]
    return {"trip": mine, "day0": day0, "day1": day1, "fixed": fixed, "sid": sid, "option": option_id, "other_option": other_option,
            "event": record.event_id, "proposal": made.proposal_id, "place": place, "auto_sid": auto["session_id"]}


def theirs_calls(m: dict) -> dict:
    day = m["trip"]["trip_days"][0]
    fixed = {"trip_day_id": day["day_id"], "title": "남의 여행", "start_at": at(day["date"], "15:00"), "end_at": at(day["date"], "16:00")}
    at_day1 = f"{m['trip']['trip_days'][1]['date']}T12:00:00"
    return {
        "GET_trip": ("get", f"/trips/{m['trip']['trip_id']}", None),
        "POST_fixed": ("post", f"/trips/{m['trip']['trip_id']}/fixed-events", fixed),
        "DELETE_fixed": ("delete", f"/fixed-events/{m['fixed']['fixed_event_id']}", None),
        "GET_course": ("get", f"/days/{m['day1']}/course", None),
        "POST_planning_start": ("post", f"/days/{m['day0']}/planning", {"mode": "conversation"}),
        "GET_planning": ("get", f"/planning/{m['sid']}", None),
        "POST_answer": ("post", f"/planning/{m['sid']}/answer", {"choice_ids": []}),
        "POST_reactions": ("post", f"/planning/{m['sid']}/reactions", {"place_id": m["place"], "action": "like"}),
        "POST_next": ("post", f"/planning/{m['sid']}/next", {}),
        "POST_compose": ("post", f"/planning/{m['sid']}/compose", None),
        "POST_back": ("post", f"/planning/{m['sid']}/back", None),
        "POST_adjust": ("post", f"/planning/{m['auto_sid']}/adjust", {"option_id": m["other_option"], "place_id": m["place"], "delta": 15}),
        "POST_select": ("post", f"/course-options/{m['other_option']}/select", None),
        "GET_now": ("get", f"/days/{m['day1']}/now?at={at_day1}", None),
        "POST_check": ("post", f"/days/{m['day1']}/check", {"at": at_day1}),
        "POST_accept": ("post", f"/proposals/{m['proposal']}/accept", None),
        "POST_dismiss": ("post", f"/events/{m['event']}/dismiss", None),
        "POST_visit_check": ("post", f"/places/{m['place']}/visit-checks", {"day_id": m["day1"], "at": at_day1, "was_open": False}),
    }


THEIRS = ["GET_trip", "POST_fixed", "DELETE_fixed", "GET_course", "POST_planning_start", "GET_planning", "POST_answer", "POST_reactions",
          "POST_next", "POST_compose", "POST_back", "POST_adjust", "POST_select", "GET_now", "POST_check", "POST_accept", "POST_dismiss",
          "POST_visit_check"]


@pytest.mark.parametrize("call", THEIRS)
def test_T12_S11_Q3_남의_것을_읽거나_바꾸면_404_NOT_FOUND이고_상대_데이터는_그대로(osaka, call):  # noqa: F811
    from trip_helpers import stores

    m = _mine(osaka)
    before = stores(osaka)
    planning_before = osaka.client.get(f"/planning/{m['sid']}").json()
    trip_before = osaka.trip(m["trip"]["trip_id"], ME).json()
    method, path, body = theirs_calls(m)[call]
    kwargs = {"json": body} if body is not None else {}
    response = getattr(osaka.anon, method)(path, headers=bearer(YOU), **kwargs)
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert stores(osaka) == before
    assert osaka.client.get(f"/planning/{m['sid']}").json() == planning_before
    assert osaka.trip(m["trip"]["trip_id"], ME).json() == trip_before


def test_T12_S11_Q3_남의_여행이_있어도_내_지금_여행은_404(osaka):  # noqa: F811
    _mine(osaka)
    assert osaka.anon.get("/trips/current", headers=bearer(YOU)).status_code == 404


def test_T12_B2_다른_사용자가_여행을_만들어도_내_여행은_보관되지_않는다(osaka):  # noqa: F811
    mine = osaka.make_trip(device=ME)
    osaka.make_trip(device=YOU)
    assert osaka.current(ME).json()["trip_id"] == mine["trip_id"]
    assert osaka.trip(mine["trip_id"], ME).json()["status"] == "active"


def test_T12_B2_X_Device_Id를_같이_보내도_Bearer의_사용자로_구분(osaka):  # noqa: F811
    mine = osaka.make_trip(device=ME)
    mixed = {**bearer(YOU), "X-Device-Id": "device-A"}
    assert osaka.anon.get("/trips/current", headers=mixed).status_code == 404
    assert osaka.current(ME).json()["trip_id"] == mine["trip_id"]


# ---------- Q11 여행 응답의 is_demo · §6 데모는 로그인 없이 ----------


def test_T12_Q11_직접_만든_여행은_is_demo_false(osaka):  # noqa: F811
    made = osaka.make_trip(device=ME)
    assert made["is_demo"] is False
    assert osaka.current(ME).json()["is_demo"] is False


def test_T12_Q11_S11_as_current로_시드하면_그_사용자의_지금_여행이_데모_is_demo_true(osaka):  # noqa: F811
    seeded = osaka.anon.post("/debug/seed-demo", json={"as_current": True}, headers=bearer(ME))
    assert seeded.status_code == 201, seeded.text
    current = osaka.current(ME).json()
    assert current["trip_id"] == seeded.json()["trip_id"]
    assert current["is_demo"] is True


# ---------- verify_token (단위): ES256 · aud · 만료 여유 10초 ----------


def test_T12_B2_verify_token은_맞는_토큰의_sub를_돌려준다():
    uid = user_id(ME)
    assert verify_token(make_token(uid), FAKE_JWKS) == uid


@pytest.mark.parametrize(
    "token",
    [
        make_token(user_id(ME), key=OTHER_KEY),
        make_token(user_id(ME), key=STRANGER_KEY),
        make_token(user_id(ME), expires_in=-3600),
        make_token(user_id(ME), aud="anon"),
        make_token(user_id(ME), aud=None),
        make_token(user_id(ME), alg="none"),
        make_token(user_id(ME), alg="HS256"),
        make_token(None),
        "not-a-jwt",
        "",
    ],
    ids=["다른_키", "없는_kid", "만료", "aud_다름", "aud_없음", "alg_none", "HS256_바꿔치기", "sub_없음", "JWT_아님", "빈_글자"],
)
def test_T12_B2_verify_token은_틀린_토큰에_AuthError(token):
    with pytest.raises(AuthError):
        verify_token(token, FAKE_JWKS)


EXP = 2_000_000_000


@pytest.mark.parametrize(
    ("offset", "ok"),
    [(-1, True), (0, True), (9, True), (9.999, True), (10, False), (11, False)],
    ids=["만료_1초_전", "만료_정각", "여유_안_9초", "여유_끝_직전", "여유_10초_정각", "여유_넘음_11초"],
)
def test_T12_Q2_만료_여유_10초의_경계(offset, ok):
    token = make_token(user_id(ME), exp=EXP)
    if ok:
        assert verify_token(token, FAKE_JWKS, now=EXP + offset) == user_id(ME)
    else:
        with pytest.raises(AuthError):
            verify_token(token, FAKE_JWKS, now=EXP + offset)


@settings(max_examples=15, deadline=None)
@given(sub=st.uuids().map(str))
def test_T12_B2_속성_JWKS에_없는_키로_서명하면_언제나_AuthError(sub):
    with pytest.raises(AuthError):
        verify_token(make_token(sub, key=FakeKey(FAKE_KEY.kid)), FAKE_JWKS)


# ---------- §6·Q3 DB 연결 실패 -> 503 STORAGE_UNAVAILABLE ----------

# 닿지 않는 DB: 없는 폴더의 유닉스 소켓 (네트워크를 쓰지 않아 conftest의 차단과 상관없다)
UNREACHABLE_DB = "postgresql://postgres@/postgres?host=/nonexistent-tripfriends-test-socket"


@pytest.mark.parametrize("route", ["POST_trips", "GET_current"])
def test_T12_S6_Q3_DB에_못_붙으면_503_STORAGE_UNAVAILABLE(monkeypatch, route):
    from api.main import app

    server_env(monkeypatch, "memory")
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE_DB)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = routes(client)[route](bearer(ME))
        assert response.status_code == 503, response.text
        error = response.json()["error"]
        assert error["code"] == "STORAGE_UNAVAILABLE" and error["message"]
        assert "nonexistent-tripfriends-test-socket" not in response.text  # 응답에 DB 주소 없음 (API-001)
