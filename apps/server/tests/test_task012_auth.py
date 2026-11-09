"""TASK-012 B2 서버 인증 + §6 DB 연결 실패.
근거: TASK-012 §B B2·B4·§6 실패 표("DB 연결 실패" 503, "익명 로그인 실패" 데모는 로그인 없이)·§8, ADR-016 §3-3(Bearer, X-Device-Id 대체),
API-001 공통(인증)·§1 오류 형식, TASK-010 §B2(다른 기기의 여행은 없는 것과 같다 -> 다른 사용자).

계약 (이 테스트가 정한 이름, 승인 대기):
    api.auth.verify_token(token, secret) -> user_id(= JWT sub). 틀리면 api.auth.AuthError
    서버는 환경 변수 SUPABASE_JWT_SECRET(api.auth.JWT_SECRET_ENV)의 값으로 HS256 서명을 확인한다
    여행 API(지금 X-Device-Id를 받던 길 6개)는 토큰이 없거나 틀리면 401 공통 형식 {"error": {code, message, detail}}. code 값은 질문으로 남김
    DB에 못 붙으면(DATABASE_URL이 닿지 않는 곳) 서버는 켜지고, 저장소를 쓰는 요청은 503 공통 형식. code 값은 질문으로 남김
테스트 비밀값은 auth_helpers의 가짜 값 (실제 키 금지).
"""

import string

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from api.auth import AuthError, verify_token
from auth_helpers import FAKE_JWT_SECRET, OTHER_SECRET, bearer, make_token, user_id
from storage_helpers import server_env
from test_task010_trips import at, osaka, trip_body  # noqa: F401 (osaka = 가짜 오사카 서버 fixture)

ME, YOU = "user-A", "user-B"


def assert_401(response) -> None:
    assert response.status_code == 401, response.text
    error = response.json()["error"]
    assert isinstance(error["code"], str) and error["code"] and error["message"]


def routes(osaka, trip: dict | None = None) -> dict:
    """지금 X-Device-Id를 받던 여행 API 6개 (api/trips.py). 헤더만 바꿔 보낸다."""
    trip = trip or {"trip_id": "없는_여행", "trip_days": [{"day_id": "없는_날", "date": "2026-12-11"}]}
    day = trip["trip_days"][0]
    fixed = {"trip_day_id": day["day_id"], "title": "저녁", "start_at": at(day["date"], "18:00"), "end_at": at(day["date"], "19:00")}
    c = osaka.client
    return {
        "POST_trips": lambda h: c.post("/trips", json=trip_body(), headers=h),
        "GET_current": lambda h: c.get("/trips/current", headers=h),
        "GET_trip": lambda h: c.get(f"/trips/{trip['trip_id']}", headers=h),
        "POST_fixed": lambda h: c.post(f"/trips/{trip['trip_id']}/fixed-events", json=fixed, headers=h),
        "DELETE_fixed": lambda h: c.delete("/fixed-events/없는_일정", headers=h),
        "GET_course": lambda h: c.get(f"/days/{day['day_id']}/course", headers=h),
    }


ROUTES = ["POST_trips", "GET_current", "GET_trip", "POST_fixed", "DELETE_fixed", "GET_course"]

BAD = {
    "헤더_없음": {},
    "Bearer만": {"Authorization": "Bearer "},
    "JWT_아님": {"Authorization": "Bearer not-a-jwt"},
    "다른_비밀값으로_서명": {"Authorization": f"Bearer {make_token(user_id(ME), secret=OTHER_SECRET)}"},
    "만료(1시간_전)": {"Authorization": f"Bearer {make_token(user_id(ME), expires_in=-3600)}"},
    "서명_없음(alg_none)": {"Authorization": f"Bearer {make_token(user_id(ME), alg='none')}"},
    "sub_없음": {"Authorization": f"Bearer {make_token(None)}"},
    "Bearer가_아닌_방식": {"Authorization": f"Basic {make_token(user_id(ME))}"},
    "X_Device_Id만(옛_방식)": {"X-Device-Id": "device-A"},
}


# ---------- B2 토큰이 없거나 틀리면 401 ----------


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("case", list(BAD))
def test_T12_B2_토큰이_없거나_틀리면_401_공통_형식(osaka, route, case):  # noqa: F811
    assert_401(routes(osaka)[route](BAD[case]))


def test_T12_B2_틀린_토큰으로는_아무것도_만들지_않는다(osaka):  # noqa: F811
    for headers in BAD.values():
        osaka.client.post("/trips", json=trip_body(), headers=headers)
    assert osaka.current(ME).status_code == 404


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(token=st.text(alphabet=string.ascii_letters + string.digits + "-_.", min_size=1, max_size=200))
def test_T12_B2_속성_아무_글자_토큰은_500이_아니라_401(osaka, token):  # noqa: F811
    assert_401(osaka.client.get("/trips/current", headers={"Authorization": f"Bearer {token}"}))


# ---------- B2 맞는 토큰이면 user_id로 구분 ----------


def test_T12_B2_맞는_토큰이면_그_사용자의_여행(osaka):  # noqa: F811
    made = osaka.make_trip(device=ME)
    assert osaka.current(ME).json()["trip_id"] == made["trip_id"]


def test_T12_B2_B4_토큰을_새로_받아도_sub가_같으면_같은_사용자(osaka):  # noqa: F811
    made = osaka.make_trip(device=ME)
    renewed = {"Authorization": f"Bearer {make_token(user_id(ME), expires_in=7200, session_id='새로_받은_세션')}"}
    assert osaka.client.get("/trips/current", headers=renewed).json()["trip_id"] == made["trip_id"]


def test_T12_B2_다른_사용자의_여행은_보이지도_바뀌지도_않는다(osaka):  # noqa: F811
    mine = osaka.make_trip(device=ME)
    day = mine["trip_days"][0]
    made = osaka.add_fixed(mine, 0, "12:00", "13:00").json()
    osaka.plan_and_select(mine["trip_days"][1]["day_id"])
    theirs = bearer(YOU)
    c = osaka.client
    assert c.get("/trips/current", headers=theirs).status_code == 404
    assert c.get(f"/trips/{mine['trip_id']}", headers=theirs).status_code == 404
    assert c.get(f"/days/{mine['trip_days'][1]['day_id']}/course", headers=theirs).status_code == 404
    fixed = {"trip_day_id": day["day_id"], "title": "남의 여행", "start_at": at(day["date"], "15:00"), "end_at": at(day["date"], "16:00")}
    assert c.post(f"/trips/{mine['trip_id']}/fixed-events", json=fixed, headers=theirs).status_code == 404
    assert c.delete(f"/fixed-events/{made['fixed_event_id']}", headers=theirs).status_code == 404
    after = osaka.trip(mine["trip_id"], ME).json()
    assert [e["fixed_event_id"] for e in after["trip_days"][0]["fixed_events"]] == [made["fixed_event_id"]]
    assert after["status"] == "active"


def test_T12_B2_다른_사용자가_여행을_만들어도_내_여행은_보관되지_않는다(osaka):  # noqa: F811
    mine = osaka.make_trip(device=ME)
    osaka.make_trip(device=YOU)
    assert osaka.current(ME).json()["trip_id"] == mine["trip_id"]
    assert osaka.trip(mine["trip_id"], ME).json()["status"] == "active"


def test_T12_B2_X_Device_Id를_같이_보내도_Bearer의_사용자로_구분(osaka):  # noqa: F811
    mine = osaka.make_trip(device=ME)
    mixed = {**bearer(YOU), "X-Device-Id": "device-A"}
    assert osaka.client.get("/trips/current", headers=mixed).status_code == 404
    assert osaka.current(ME).json()["trip_id"] == mine["trip_id"]


def test_T12_S6_데모는_로그인_없이_만들어진다(osaka):  # noqa: F811
    seeded = osaka.client.post("/debug/seed-demo")
    assert seeded.status_code == 201, seeded.text


# ---------- verify_token (단위) ----------


def test_T12_B2_verify_token은_맞는_토큰의_sub를_돌려준다():
    uid = user_id(ME)
    assert verify_token(make_token(uid), FAKE_JWT_SECRET) == uid


@pytest.mark.parametrize(
    "token",
    [
        make_token(user_id(ME), secret=OTHER_SECRET),
        make_token(user_id(ME), expires_in=-3600),
        make_token(user_id(ME), alg="none"),
        make_token(None),
        "not-a-jwt",
        "",
    ],
    ids=["다른_비밀값", "만료", "alg_none", "sub_없음", "JWT_아님", "빈_글자"],
)
def test_T12_B2_verify_token은_틀린_토큰에_AuthError(token):
    with pytest.raises(AuthError):
        verify_token(token, FAKE_JWT_SECRET)


@settings(max_examples=50, deadline=None)
@given(sub=st.uuids().map(str), wrong=st.text(min_size=8, max_size=40).filter(lambda s: s != FAKE_JWT_SECRET))
def test_T12_B2_속성_서명한_비밀값이_다르면_언제나_AuthError(sub, wrong):
    with pytest.raises(AuthError):
        verify_token(make_token(sub, secret=wrong), FAKE_JWT_SECRET)


# ---------- §6 DB 연결 실패 -> 503 공통 형식 ----------

# 닿지 않는 DB: 없는 폴더의 유닉스 소켓 (네트워크를 쓰지 않아 conftest의 차단과 상관없다)
UNREACHABLE_DB = "postgresql://postgres@/postgres?host=/nonexistent-tripfriends-test-socket"


@pytest.mark.parametrize("route", ["POST_trips", "GET_current"])
def test_T12_S6_DB에_못_붙으면_503_공통_형식(monkeypatch, route):
    from api.main import app
    from test_task010_trips import Osaka

    server_env(monkeypatch, "memory")
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE_DB)
    with TestClient(app, raise_server_exceptions=False) as client:
        osaka = Osaka(client, app)
        response = routes(osaka)[route](bearer(ME))
        assert response.status_code == 503, response.text
        error = response.json()["error"]
        assert isinstance(error["code"], str) and error["code"] and error["message"]
        assert "nonexistent-tripfriends-test-socket" not in response.text  # 원인(주소)은 응답에 담지 않는다 (TASK-003 R11과 같음)
