"""TASK-012 2단계 서버: 계정 연결 규칙 (§C C2·C4·C6, AC-5). 어떤 경우에도 여행은 지워지지 않는다 (archived만).
근거: TASK-012 §C C2·C4·C6·§6 "Google 연결 실패·취소"·§7 AC-1·AC-3·AC-5·§8 "여행 삭제(보관만)"·§9 3·6, ADR-016 §3-1(연결 규칙)·§3-3(Bearer),
API-001 §1(오류 형식·401 UNAUTHORIZED), TASK-012 §10 Q2(ES256 JWKS)·§11 Q3(남의 것 404)·§12 3(지금 여행 = active이면서 데모 아님),
PM 안(결정권자 전달 11-11: 이미 있는 계정은 그 Google 계정으로 로그인한 뒤 서버 `POST /account/claim`, 두 JWT 모두 확인).

계약 (이 테스트가 정한 이름, 승인 대기):
    새 계정 연결(C2) = Supabase linkIdentity라 같은 user_id(sub). 서버는 따로 할 일이 없다: is_anonymous가 false가 된 같은 sub의
        토큰으로 익명 때 여행이 그대로 보인다
    POST /account/claim   헤더 Bearer = 이미 있던 계정(Google로 로그인한 쪽)의 토큰, 본문 {"anonymous_token": 연결 전 익명 세션의 access token}
        서버는 두 토큰을 모두 확인한다 (같은 JWKS·ES256·aud·만료 10초). 본문 토큰은 is_anonymous가 true여야 한다
        §16: "여행이 있음" = 보관·데모가 아닌 여행(지금 여행)이 있음
        200 {"result": "moved"}  : 계정 쪽에 지금 여행이 없다 -> 익명 쪽 여행을 계정으로 옮긴다 (보관 여행도 상태 그대로, 데모는 익명에 남김, §16 Q1)
            익명 쪽에 옮길 것이 없어도 "moved" (§16 Q4)
        200 {"result": "choose", "choices": [기기 칸, 계정 칸]} : 양쪽 모두 지금 여행이 있다 -> 아무것도 바꾸지 않고 두 요약만 준다
            칸 = {"origin": "device"|"account", "trip_id", "name", "start_date", "end_date", "planned_days", "total_days"} (API-001 §2-1)
            name은 날짜 목록 머리와 같은 계산 ("오사카 2박 3일", 하루면 "오사카 당일 여행"), planned_days = 고른 코스가 있는 날 수 (§9 6)
    POST /account/claim/choose  같은 헤더, 본문 {"anonymous_token", "trip_id": 고른 여행}
        200 Trip (고른 여행, active) -> 계정의 지금 여행. 고르지 않은 쪽은 archived (지우지 않음). 기기 여행이 고르지 않은 쪽이면
            계정으로 옮겨 archived (§16 Q2). 두 토큰을 다시 확인한다. 두 여행이 아닌 trip_id = 404 NOT_FOUND (§16 Q3)
    본문 토큰이 틀림·만료·모르는 키 = 401 UNAUTHORIZED (API-001). 익명이 아닌 본문 토큰 = 400 NOT_ANONYMOUS_TOKEN,
    헤더 토큰이 익명 = 400 ACCOUNT_REQUIRED, 두 토큰이 같은 사용자 = 400 SAME_USER (§16 Q3·Q5). 거절된 요청은 아무것도 바꾸지 않는다
    A3: 요청 하나 = 트랜잭션 하나 -> claim/choose 중간에 예외면 500 INTERNAL_ERROR, 두 사용자의 여행이 요청 전과 같다
    메모리·Postgres 두 구현에 같은 테스트 (Postgres는 `db` 표시, TEST_DATABASE_URL 없으면 건너뜀)
    §15 S3·§16 Q4: 옮김(moved, 옮길 것이 없었어도)·고르기(choose 완료)로 처리된 익명 사용자는 다시 claim·choose 하면 409 ALREADY_CLAIMED.
        "choose"만 돌려받은 것은 처리 아님 (다시 부르면 같은 choose)
    §15 S4: 토큰은 로그·오류 응답에 남지 않는다 · S6: 계정 이메일은 서버 저장소에 복사하지 않는다
"""

import inspect
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from auth_helpers import OTHER_KEY, STRANGER_KEY, make_token, user_id
from storage_helpers import KINDS, server_env
from test_task010_trips import Osaka

CLAIM, CHOOSE = "/account/claim", "/account/claim/choose"
EMAIL = "seunghyun@gmail.com"


# ---------- 도우미 (판단 로직 없음) ----------


def names() -> tuple[str, str]:
    """테스트마다 새 사용자 두 명 (DB를 비우지 않으므로 겹치지 않게)."""
    tag = uuid.uuid4().hex[:8]
    return f"anon-{tag}", f"google-{tag}"


def anon_token(name: str, **claims) -> str:
    return make_token(user_id(name), **{"is_anonymous": True, **claims})


def account_headers(name: str, **claims) -> dict[str, str]:
    """이미 있던 계정(Google로 로그인한 쪽)의 요청 헤더. Supabase 토큰처럼 is_anonymous false + email."""
    return {"Authorization": f"Bearer {make_token(user_id(name), **{'is_anonymous': False, 'email': EMAIL, **claims})}"}


def anon_headers(name: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {anon_token(name)}"}


def open_server(app, raise_errors: bool = True) -> TestClient:
    return TestClient(app, raise_server_exceptions=raise_errors)


def make_trip(osaka: Osaka, name: str, days: int = 2, offset: int = 10) -> dict:
    return osaka.make_trip(days=days, offset=offset, device=name)


def plan_day(client: TestClient, day_id: str, headers: dict) -> None:
    """그날 코스를 고른 날로 (자동 모드 -> 첫 안 고르기, TASK-003 §5)."""
    started = client.post(f"/days/{day_id}/planning", json={"mode": "auto"}, headers=headers)
    assert started.status_code == 201, started.text
    chosen = client.post(f"/course-options/{started.json()['options'][0]['option_id']}/select", headers=headers)
    assert chosen.status_code == 200, chosen.text


def claim(client: TestClient, anon: str, account: str, token: str | None = None, headers: dict | None = None):
    return client.post(CLAIM, json={"anonymous_token": token if token is not None else anon_token(anon)}, headers=headers or account_headers(account))


def choose(client: TestClient, anon: str, account: str, trip_id: str, token: str | None = None):
    body = {"anonymous_token": token if token is not None else anon_token(anon), "trip_id": trip_id}
    return client.post(CHOOSE, json=body, headers=account_headers(account))


def current_id(client: TestClient, headers: dict) -> str | None:
    response = client.get("/trips/current", headers=headers)
    if response.status_code == 404:
        return None
    assert response.status_code == 200, response.text
    return response.json()["trip_id"]


def read_trip(client: TestClient, trip_id: str, *who: dict) -> dict | None:
    """이 여행을 읽을 수 있는 쪽의 응답 (여러 헤더 중 처음 200). 아무도 못 읽으면 None = 사라짐."""
    for headers in who:
        response = client.get(f"/trips/{trip_id}", headers=headers)
        if response.status_code == 200:
            return response.json()
    return None


def picture(client: TestClient, anon: str, account: str, trip_ids: list[str]) -> dict:
    """두 사용자에게 보이는 것 전부: 지금 여행 + 각 여행을 누가 어떤 상태로 읽나."""
    a, g = anon_headers(anon), account_headers(account)
    seen = {}
    for tid in trip_ids:
        by_anon = client.get(f"/trips/{tid}", headers=a)
        by_account = client.get(f"/trips/{tid}", headers=g)
        seen[tid] = (by_anon.status_code, by_anon.json().get("status"), by_account.status_code, by_account.json().get("status"))
    return {"anon_current": current_id(client, a), "account_current": current_id(client, g), "trips": seen}


def assert_common(response, status: int, code: str | None = None) -> dict:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert isinstance(error["code"], str) and error["message"]
    if code is not None:
        assert error["code"] == code
    return error


@pytest.fixture(params=KINDS)
def kind(request) -> str:
    return request.param


@pytest.fixture
def world(monkeypatch, kind):
    """서버를 켜고 (메모리 또는 Postgres) 새 사용자 두 명을 준다."""
    from api.main import app

    server_env(monkeypatch, kind)
    with open_server(app) as client:
        anon, account = names()
        yield client, Osaka(client, app), anon, account


# ---------- C6 규칙 1: 새 계정에 연결 = 같은 user_id, 여행 그대로 ----------


def test_T12_C2_C6_새_계정_연결은_같은_user_id라_익명_때_여행이_그대로_보인다(world):
    client, osaka, anon, _ = world
    trip = make_trip(osaka, anon)
    linked = {"Authorization": f"Bearer {make_token(user_id(anon), is_anonymous=False, email=EMAIL)}"}  # linkIdentity 뒤 같은 sub
    assert current_id(client, linked) == trip["trip_id"]
    assert client.get(f"/trips/{trip['trip_id']}", headers=linked).json() == trip


# ---------- C6 규칙 2: 이미 있는 계정 ----------


def test_T12_C4_계정에_여행이_없으면_익명_여행을_계정으로_옮긴다(world):
    client, osaka, anon, account = world
    trip = make_trip(osaka, anon)
    day_id = trip["trip_days"][0]["day_id"]
    plan_day(client, day_id, anon_headers(anon))
    chosen = client.get(f"/days/{day_id}/course", headers=anon_headers(anon)).json()

    response = claim(client, anon, account)
    assert response.status_code == 200, response.text
    assert response.json()["result"] == "moved"
    assert current_id(client, account_headers(account)) == trip["trip_id"]
    assert current_id(client, anon_headers(anon)) is None  # 옮겼다 (둘이 같이 갖지 않는다)
    assert client.get(f"/days/{day_id}/course", headers=account_headers(account)).json() == chosen  # 고른 코스도 따라온다
    assert client.get(f"/trips/{trip['trip_id']}", headers=anon_headers(anon)).status_code == 404  # 이제 남의 것 (§11 Q3)


def test_T12_C4_옮길_때_보관된_여행도_상태_그대로_함께_옮긴다(world):
    client, osaka, anon, account = world
    old = make_trip(osaka, anon, offset=10)
    new = make_trip(osaka, anon, offset=20)  # old는 archived (TASK-010 B2)
    assert claim(client, anon, account).json()["result"] == "moved"
    assert read_trip(client, old["trip_id"], account_headers(account))["status"] == "archived"
    assert read_trip(client, new["trip_id"], account_headers(account))["status"] == "active"
    assert current_id(client, account_headers(account)) == new["trip_id"]


def test_T12_C4_양쪽_다_여행이_있으면_choose만_돌려주고_아무것도_바꾸지_않는다(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    before = picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]])

    response = claim(client, anon, account)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"] == "choose"
    assert [(c["origin"], c["trip_id"]) for c in body["choices"]] == [("device", mine["trip_id"]), ("account", theirs["trip_id"])]
    assert picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]]) == before


def test_T12_Q6_어느_여행_칸_요약은_이름·날짜·n일_중_k일(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon, days=3)
    plan_day(client, mine["trip_days"][0]["day_id"], anon_headers(anon))
    theirs = make_trip(osaka, account, days=1, offset=40)  # 하루 = "당일 여행" (날짜 목록 머리와 같은 계산)
    device, acct = claim(client, anon, account).json()["choices"]
    assert device == {
        "origin": "device", "trip_id": mine["trip_id"], "name": "오사카 2박 3일",
        "start_date": mine["start_date"], "end_date": mine["end_date"], "planned_days": 1, "total_days": 3,
    }
    assert acct == {
        "origin": "account", "trip_id": theirs["trip_id"], "name": "오사카 당일 여행",
        "start_date": theirs["start_date"], "end_date": theirs["end_date"], "planned_days": 0, "total_days": 1,
    }


def test_T12_C4_기기_여행을_고르면_그것이_계정의_지금_여행_계정_여행은_archived(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    response = choose(client, anon, account, mine["trip_id"])
    assert response.status_code == 200, response.text
    assert response.json()["trip_id"] == mine["trip_id"] and response.json()["status"] == "active"
    assert current_id(client, account_headers(account)) == mine["trip_id"]
    assert read_trip(client, theirs["trip_id"], account_headers(account))["status"] == "archived"  # 지우지 않고 보관
    assert current_id(client, anon_headers(anon)) is None


def test_T12_C4_계정_여행을_고르면_기기_여행은_archived로_남는다(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    response = choose(client, anon, account, theirs["trip_id"])
    assert response.status_code == 200, response.text
    assert response.json()["trip_id"] == theirs["trip_id"]
    assert current_id(client, account_headers(account)) == theirs["trip_id"]
    kept = read_trip(client, mine["trip_id"], account_headers(account))
    assert kept is not None and kept["status"] == "archived"  # §16 Q2: 계정으로 옮겨 보관 (익명 사용자는 다시 닿을 수 없다)
    assert client.get(f"/trips/{mine['trip_id']}", headers=anon_headers(anon)).status_code == 404


def test_T12_C4_익명_쪽에_여행이_없으면_계정은_그대로(world):
    client, osaka, anon, account = world
    theirs = make_trip(osaka, account, offset=40)
    response = claim(client, anon, account)
    assert response.status_code == 200, response.text
    assert response.json()["result"] == "moved"  # §16 Q4: 옮길 것이 없어도 moved
    assert current_id(client, account_headers(account)) == theirs["trip_id"]
    assert read_trip(client, theirs["trip_id"], account_headers(account))["status"] == "active"


def test_T12_C4_choose의_trip_id가_두_여행이_아니면_거절하고_아무것도_바뀌지_않는다(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    stranger, _ = names()
    other = make_trip(osaka, stranger, offset=60)
    assert claim(client, anon, account).json()["result"] == "choose"  # 고르기 상황인지 먼저 (길이 없으면 여기서 실패)
    before = picture(client, anon, account, [mine["trip_id"], theirs["trip_id"], other["trip_id"]])
    for wrong in (other["trip_id"], str(uuid.uuid4()), "not-a-uuid"):
        response = choose(client, anon, account, wrong)
        assert_common(response, 404, "NOT_FOUND")  # §16 Q3: 남의 것 규칙과 같게
    assert picture(client, anon, account, [mine["trip_id"], theirs["trip_id"], other["trip_id"]]) == before
    assert current_id(client, anon_headers(stranger)) == other["trip_id"]


# ---------- 두 토큰 확인: 거절하면 아무것도 바뀌지 않는다 ----------


def _bad_anon_tokens(anon: str) -> list[tuple[str, str]]:
    now = int(time.time())
    return [
        ("만료_1시간_전", anon_token(anon, exp=now - 3600)),
        ("만료_정각_더하기_10초", anon_token(anon, exp=now - 10)),  # §11 작은 질문: 정각 exp + 10초는 거절
        ("서명이_틀림", anon_token(anon, key=OTHER_KEY)),
        ("모르는_키", anon_token(anon, key=STRANGER_KEY)),
        ("aud가_다름", anon_token(anon, aud="anon")),
        ("JWT가_아님", "not-a-jwt"),
        ("빈_값", ""),
    ]


@pytest.mark.parametrize("case", range(7), ids=[name for name, _ in _bad_anon_tokens("x")])
def test_T12_C4_본문의_익명_토큰이_틀리거나_만료면_401_UNAUTHORIZED_아무것도_안_바뀜(world, case):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    _, token = _bad_anon_tokens(anon)[case]
    before = picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]])
    assert_common(claim(client, anon, account, token=token), 401, "UNAUTHORIZED")
    assert_common(choose(client, anon, account, mine["trip_id"], token=token), 401, "UNAUTHORIZED")
    assert picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]]) == before


def test_T12_C4_익명_토큰_만료_여유_안이면_받아들인다(world):
    # §10 Q2: 만료 여유 10초. exp + 9초는 아직 된다 (정각 10초는 위 테스트에서 거절)
    client, osaka, anon, account = world
    make_trip(osaka, anon)
    response = claim(client, anon, account, token=anon_token(anon, exp=int(time.time()) - 9))
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("value", [False, None, "true", 1], ids=["false", "없음(null)", "글자_true", "숫자_1"])
def test_T12_C4_본문_토큰이_익명_계정이_아니면_거절_아무것도_안_바뀜(world, value):
    # PM 안: 익명 쪽은 is_anonymous가 true여야. 남의 연결된 계정 여행을 끌어오지 못하게
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    before = picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]])
    token = make_token(user_id(anon), is_anonymous=value, email=EMAIL)
    for response in (claim(client, anon, account, token=token), choose(client, anon, account, mine["trip_id"], token=token)):
        assert_common(response, 400, "NOT_ANONYMOUS_TOKEN")  # §16 Q3
    assert picture(client, anon, account, [mine["trip_id"], theirs["trip_id"]]) == before


@pytest.mark.parametrize("path", [CLAIM, CHOOSE])
def test_T12_C4_헤더_토큰이_없으면_401(world, path):
    client, osaka, anon, _ = world
    mine = make_trip(osaka, anon)
    response = client.post(path, json={"anonymous_token": anon_token(anon), "trip_id": mine["trip_id"]})
    assert_common(response, 401, "UNAUTHORIZED")
    assert current_id(client, anon_headers(anon)) == mine["trip_id"]


def test_T12_C4_헤더_토큰이_만료면_401_아무것도_안_바뀜(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    expired = account_headers(account, exp=int(time.time()) - 3600)
    assert_common(claim(client, anon, account, headers=expired), 401, "UNAUTHORIZED")
    assert current_id(client, anon_headers(anon)) == mine["trip_id"]
    assert current_id(client, account_headers(account)) is None


# ---------- A3·AC-3 중간 실패 -> 둘 다 요청 전과 같다 ----------

_STORE_READS = {"get_trip", "trip_of_day", "active_trip", "day_owner", "fixed_for_day", "get_fixed"}
_NEVER_WRAP = {"snapshot", "capture", "restore"}  # 되돌림 자체는 막지 않는다


def fail_after_first_change(patch, app) -> dict:
    """여행 저장소(app.state.trip_store)에서 읽기가 아닌 메서드가 한 번 끝나면, 그 뒤 저장소·계획 저장소의 어느 메서드든 예외.
    메서드 이름을 정하지 않는다 (구현이 여러 번 나눠 바꾸든, 한 번에 바꾸고 응답을 만들려고 읽든 그 자리에서 실패)."""
    state = {"changed": False, "raised": False}

    def wrap(cls, counts_change: bool) -> None:
        for name, fn in inspect.getmembers(cls, inspect.isfunction):
            if name.startswith("_") or name in _NEVER_WRAP:
                continue

            def wrapped(self, *args, __fn=fn, __name=name, **kwargs):
                if state["changed"]:
                    state["raised"] = True
                    raise RuntimeError("계정 연결 중간 실패 (테스트가 일부러 낸 예외)")
                result = __fn(self, *args, **kwargs)
                if counts_change and __name not in _STORE_READS:
                    state["changed"] = True
                return result

            patch.setattr(cls, name, wrapped)

    wrap(type(app.state.trip_store), counts_change=True)
    wrap(type(app.state.planning_repo), counts_change=False)
    return state


@pytest.mark.parametrize("pick", ["device", "account"])
def test_T12_A3_AC3_choose_중간에_예외면_500이고_두_사용자의_여행이_요청_전과_같다(monkeypatch, kind, pick):
    from api.main import app

    server_env(monkeypatch, kind)
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        anon, account = names()
        mine = make_trip(osaka, anon)
        theirs = make_trip(osaka, account, offset=40)
        ids = [mine["trip_id"], theirs["trip_id"]]
        before = picture(client, anon, account, ids)
        with monkeypatch.context() as patch:
            state = fail_after_first_change(patch, app)
            response = choose(client, anon, account, mine["trip_id"] if pick == "device" else theirs["trip_id"])
        assert state["raised"], "저장을 바꾼 뒤 실패를 낼 자리가 없었다 (choose가 저장소를 바꾸지 않았거나 응답을 저장소 없이 만들었다)"
        assert_common(response, 500, "INTERNAL_ERROR")
        assert picture(client, anon, account, ids) == before


def test_T12_A3_AC3_claim_옮기기_중간에_예외면_500이고_익명_여행이_그대로(monkeypatch, kind):
    # 보관된 여행 + 지금 여행 두 개를 옮긴다 -> 바꾸기가 둘 이상이거나, 한 번에 바꾼 뒤 무언가 읽으면 그 자리에서 실패
    from api.main import app

    server_env(monkeypatch, kind)
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        anon, account = names()
        old = make_trip(osaka, anon, offset=10)
        new = make_trip(osaka, anon, offset=20)
        ids = [old["trip_id"], new["trip_id"]]
        before = picture(client, anon, account, ids)
        with monkeypatch.context() as patch:
            state = fail_after_first_change(patch, app)
            response = claim(client, anon, account)
        if not state["raised"]:
            assert response.status_code == 200, response.text  # 길이 없거나 실패한 것은 건너뛰지 않는다
            pytest.skip("구현이 한 번에 옮기고 그 뒤 저장소를 읽지 않아 중간 실패를 낼 자리가 없음 (choose 쪽 테스트가 트랜잭션을 본다)")
        assert_common(response, 500, "INTERNAL_ERROR")
        assert picture(client, anon, account, ids) == before


# ---------- AC-5 어떤 경우에도 여행 삭제 0건 (속성) ----------


@settings(max_examples=12, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow])
@given(device_trips=st.integers(0, 3), account_trips=st.integers(0, 3), pick=st.sampled_from(["device", "account"]))
def test_T12_AC5_속성_어떤_조합이든_연결_뒤_모든_여행이_남고_계정에_지금_여행이_있다(monkeypatch, device_trips, account_trips, pick):
    from api.main import app

    server_env(monkeypatch, "memory")
    with open_server(app) as client:
        osaka = Osaka(client, app)
        anon, account = names()
        mine = [make_trip(osaka, anon, offset=10 + i)["trip_id"] for i in range(device_trips)]
        theirs = [make_trip(osaka, account, offset=40 + i)["trip_id"] for i in range(account_trips)]
        everyone = (anon_headers(anon), account_headers(account))

        response = claim(client, anon, account)
        assert response.status_code == 200, response.text
        if response.json()["result"] == "choose":
            assert device_trips > 0 and account_trips > 0
            keep = mine[-1] if pick == "device" else theirs[-1]
            assert choose(client, anon, account, keep).status_code == 200
            assert current_id(client, account_headers(account)) == keep
        else:
            assert device_trips == 0 or account_trips == 0

        found = {tid: read_trip(client, tid, *everyone) for tid in mine + theirs}
        assert [tid for tid, trip in found.items() if trip is None] == []  # 삭제 0건
        if device_trips > 0:  # §16 Q1·Q2: 익명 여행은 고르든 안 고르든 모두 계정으로 (데모 아님)
            assert [tid for tid in mine if read_trip(client, tid, account_headers(account)) is None] == []
        if device_trips + account_trips > 0:
            assert current_id(client, account_headers(account)) is not None
        actives = [tid for tid, trip in found.items() if trip["status"] == "active" and read_trip(client, tid, account_headers(account))]
        assert len(actives) <= 1  # R1은 지금 여행 하나
        snapshot = app.state.trip_store.snapshot()
        assert set(mine + theirs) <= set(snapshot["trips"])  # 메모리 저장소에도 그대로


# ---------- §15 2단계 보안 규칙 (11-11) ----------


def test_T12_S15_S3_옮긴_익명_사용자는_다시_claim하면_409_아무것도_안_바뀜(world):
    client, osaka, anon, account = world
    trip = make_trip(osaka, anon)
    assert claim(client, anon, account).json()["result"] == "moved"
    before = picture(client, anon, account, [trip["trip_id"]])
    assert_common(claim(client, anon, account), 409, "ALREADY_CLAIMED")
    other, _ = names()
    assert_common(claim(client, anon, other), 409, "ALREADY_CLAIMED")  # 다른 계정으로도 다시 못 가져간다
    assert picture(client, anon, account, [trip["trip_id"]]) == before


def test_T12_S15_S3_고르기를_마친_익명_사용자는_claim·choose_모두_409(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    assert claim(client, anon, account).json()["result"] == "choose"
    assert choose(client, anon, account, mine["trip_id"]).status_code == 200
    ids = [mine["trip_id"], theirs["trip_id"]]
    before = picture(client, anon, account, ids)
    assert_common(claim(client, anon, account), 409, "ALREADY_CLAIMED")
    assert_common(choose(client, anon, account, theirs["trip_id"]), 409, "ALREADY_CLAIMED")
    assert picture(client, anon, account, ids) == before


def test_T12_S15_S3_choose를_돌려받기만_한_것은_처리가_아니다_choose는_된다(world):
    # claim이 "choose"만 돌려주면 아무것도 바뀌지 않았다 -> 같은 claim을 다시 해도 같은 choose, 그 뒤 고르기도 된다
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    make_trip(osaka, account, offset=40)
    assert claim(client, anon, account).json()["result"] == "choose"
    assert claim(client, anon, account).json()["result"] == "choose"
    assert choose(client, anon, account, mine["trip_id"]).status_code == 200


def test_T12_S15_S4_토큰은_로그·오류_응답에_남지_않는다(world, caplog):
    client, osaka, anon, account = world
    make_trip(osaka, anon)
    good = anon_token(anon)
    bad = anon_token(anon, key=OTHER_KEY)
    header = account_headers(account)
    caplog.set_level("DEBUG")
    rejected = claim(client, anon, account, token=bad, headers=header)
    accepted = claim(client, anon, account, token=good, headers=header)
    assert rejected.status_code == 401 and accepted.status_code == 200
    secrets = [good, bad, header["Authorization"].split(" ", 1)[1]]
    for text in [rejected.text, accepted.text, *(record.getMessage() for record in caplog.records)]:
        for secret in secrets:
            for piece in secret.split("."):  # 토큰 전체도, 머리·몸·서명 한 조각도
                assert piece not in text


def test_T12_S15_S6_계정_이메일은_저장소에_복사하지_않는다(monkeypatch):
    # Supabase Auth에만 있다. 서버 저장소(메모리) 어디에도 이메일 글자가 없다
    from api.main import app

    from trip_helpers import stores

    server_env(monkeypatch, "memory")
    with open_server(app) as client:
        osaka = Osaka(client, app)
        anon, account = names()
        mine = make_trip(osaka, anon)
        make_trip(osaka, account, offset=40)
        assert claim(client, anon, account).json()["result"] == "choose"
        assert choose(client, anon, account, mine["trip_id"]).status_code == 200
        assert EMAIL not in repr(stores(osaka))


# ---------- §16 답 (11-11) ----------


def seed_demo(client: TestClient, name: str) -> str:
    seeded = client.post("/debug/seed-demo", json={}, headers=anon_headers(name))  # 지금 여행을 바꾸지 않는 데모 (§11 Q2)
    assert seeded.status_code == 201, seeded.text
    return seeded.json()["trip_id"]


def test_T12_S16_Q1_데모_여행은_옮기지_않고_익명_사용자에게_남긴다(world):
    client, osaka, anon, account = world
    trip = make_trip(osaka, anon)
    demo = seed_demo(client, anon)
    assert claim(client, anon, account).json()["result"] == "moved"
    assert current_id(client, account_headers(account)) == trip["trip_id"]
    assert client.get(f"/trips/{demo}", headers=anon_headers(anon)).status_code == 200
    assert client.get(f"/trips/{demo}", headers=account_headers(account)).status_code == 404


def test_T12_S16_Q1_계정_쪽에_데모만_있으면_여행_없음_익명_여행을_옮겨_지금_여행으로(world):
    # "보관 여행만" 있는 계정은 API로 만들 길이 없다 (보관은 새 여행을 만들 때만) -> 계약 테스트 몫 (보고의 질문)
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    demo = seed_demo(client, account)
    assert current_id(client, account_headers(account)) is None
    response = claim(client, anon, account)
    assert response.status_code == 200, response.text
    assert response.json()["result"] == "moved"
    assert current_id(client, account_headers(account)) == mine["trip_id"]
    assert read_trip(client, demo, account_headers(account)) is not None  # 계정 쪽 데모도 그대로


def test_T12_S16_Q3_본문이_빠지면_400_공통_형식(world):
    client, _, _, account = world
    for path in (CLAIM, CHOOSE):
        response = client.post(path, json={}, headers=account_headers(account))
        error = assert_common(response, 400)
        assert error["code"] in {"VALIDATION_ERROR", "INVALID_REQUEST"}  # "서버에 이미 있는 본문 검증 오류 code 그대로"


def test_T12_S16_Q5_헤더_토큰이_익명이면_400_ACCOUNT_REQUIRED_아무것도_안_바뀜(world):
    client, osaka, anon, account = world
    mine = make_trip(osaka, anon)
    theirs = make_trip(osaka, account, offset=40)
    ids = [mine["trip_id"], theirs["trip_id"]]
    before = picture(client, anon, account, ids)
    anonymous_header = {"Authorization": f"Bearer {anon_token(account)}"}
    assert_common(claim(client, anon, account, headers=anonymous_header), 400, "ACCOUNT_REQUIRED")
    body = {"anonymous_token": anon_token(anon), "trip_id": mine["trip_id"]}
    assert_common(client.post(CHOOSE, json=body, headers=anonymous_header), 400, "ACCOUNT_REQUIRED")
    assert picture(client, anon, account, ids) == before


def test_T12_S16_Q5_두_토큰이_같은_사용자면_400_SAME_USER(world):
    client, osaka, anon, _ = world
    mine = make_trip(osaka, anon)
    linked = account_headers(anon)  # 같은 sub, 연결된 토큰 (앱이 연결 성공 뒤 claim을 부르면 버그)
    assert_common(claim(client, anon, anon, headers=linked), 400, "SAME_USER")
    body = {"anonymous_token": anon_token(anon), "trip_id": mine["trip_id"]}
    assert_common(client.post(CHOOSE, json=body, headers=linked), 400, "SAME_USER")
    assert current_id(client, linked) == mine["trip_id"]


def test_T12_S16_Q4_옮길_것이_없던_moved도_처리됨_다시_claim하면_409(world):
    client, osaka, anon, account = world
    make_trip(osaka, account, offset=40)
    assert claim(client, anon, account).json()["result"] == "moved"
    assert_common(claim(client, anon, account), 409, "ALREADY_CLAIMED")


# ---------- API-001 §1·TASK-012 §12 6: 본문 익명 토큰을 확인하다 공개 키(JWKS)를 못 받으면 503 AUTH_UNAVAILABLE ----------


@pytest.mark.parametrize("path", [CLAIM, CHOOSE])
def test_T12_S12_6_본문_토큰_확인에_JWKS를_못_받으면_503_AUTH_UNAVAILABLE_아무것도_안_바뀜(monkeypatch, path):
    # 헤더 토큰은 받아 둔 키로 확인된다. 본문 토큰은 모르는 키 ID라 다시 받기가 필요한데 그 받기가 실패한다 (Supabase 장애 = 401 아님)
    import api.auth
    from api.auth import JwksCache
    from api.main import app
    from auth_helpers import FAKE_SUPABASE_URL

    server_env(monkeypatch, "memory")
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        anon, account = names()
        mine = make_trip(osaka, anon)
        theirs = make_trip(osaka, account, offset=40)
        ids = [mine["trip_id"], theirs["trip_id"]]
        before = picture(client, anon, account, ids)
        now = [0.0]
        app.state.jwks = JwksCache(FAKE_SUPABASE_URL, clock=lambda: now[0])
        assert current_id(client, account_headers(account)) == theirs["trip_id"]  # 처음 받기 (헤더 키는 이제 받아 둠)
        now[0] = 1000.0  # 다시 받기가 허용되는 때 (60초 넘음)

        def down(_url):
            raise RuntimeError("JWKS 못 받음 (테스트가 일부러)")

        monkeypatch.setattr(api.auth, "fetch_jwks", down)
        body = {"anonymous_token": anon_token(anon, key=STRANGER_KEY), "trip_id": mine["trip_id"]}
        response = client.post(path, json=body, headers=account_headers(account))
        assert_common(response, 503, "AUTH_UNAVAILABLE")
        assert picture(client, anon, account, ids) == before
