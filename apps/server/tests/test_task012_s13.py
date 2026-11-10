"""TASK-012 §13 1·3: 그날 진행 중인 계획 세션을 서버에 묻는다(앱은 세션 ID를 기기에 두지 않음) · 받아 둔 kid는 다시 받지 않고 바로 확인.
근거: TASK-012 §13 1(서버에 "이 날 진행 중인 계획 세션"을 묻고 이어 감, TASK-004 GET 이어 가기 활용, 없을 때만 새로 시작)·3(다시 받기는 모르는 kid일 때만),
TASK-004 §A A1(GET /planning/{id}는 지금 stage의 응답을 다시 줌, 상태·저장소 그대로)·A7(없는 리소스 404 detail.resource),
TASK-012 §11 Q3(남의 날은 404 NOT_FOUND, 있는지 알리지 않음), §12 6(JWKS 다시 받기).

확인한 것: 지금 API(API-001 §2-2, TASK-003 §5)에는 "날 -> 세션"을 묻는 길이 없다 (GET은 /planning/{session_id}뿐). 그래서 새 길을 정한다.

계약 (이 테스트가 정한 이름, 승인 대기):
    GET /days/{day_id}/planning -> 200 = 그날 진행 중인 세션의 GET /planning/{session_id} 응답과 같은 것 (session_id 포함, 상태·저장소 그대로)
        진행 중인 세션이 여럿이면 가장 나중에 시작한 것 (같은 날 [알아서 짜 줘]로 새로 시작한 경우)
        진행 중인 세션이 없으면 404 NOT_FOUND detail.resource = "session" (앱은 그때만 POST /days/{day_id}/planning)
        없는 날·남의 날은 404 NOT_FOUND detail.resource = "day" (둘이 같은 모양: 있는지 알리지 않음)
    끝난 세션(코스를 고른 done)을 진행 중으로 치는지는 문서에 없어 테스트하지 않음 (질문)
"""

import json

import pytest

import api.auth
from api.auth import JwksCache
from auth_helpers import FAKE_JWKS, FAKE_KEY, FAKE_SUPABASE_URL, FakeKey, bearer, make_token, user_id
from test_task010_trips import DEVICE, osaka  # noqa: F401 (osaka = 가짜 오사카 서버 fixture, 기본 헤더 = DEVICE)
from trip_helpers import checkpoints_text, stores

ME, YOU = DEVICE, "user-B"


def by_day(osaka, day_id: str, user: str = ME):
    return osaka.anon.get(f"/days/{day_id}/planning", headers=bearer(user))


def start(osaka, day_id: str, mode: str = "conversation") -> dict:
    response = osaka.client.post(f"/days/{day_id}/planning", json={"mode": mode})
    assert response.status_code == 201, response.text
    return response.json()


def browsing(osaka, day_id: str) -> str:
    """그날 계획 대화를 후보 단계까지 + 한 곳 담기. session_id를 돌려준다."""
    session = start(osaka, day_id)
    sid = session["session_id"]
    first = session["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{sid}/answer", json={"choice_ids": [first]}).json()
    liked = osaka.client.post(f"/planning/{sid}/reactions", json={"place_id": batch["candidates"][0]["place"]["id"], "action": "like"})
    assert liked.status_code == 200, liked.text
    return sid


def not_found(response, resource: str) -> None:
    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert error["detail"]["resource"] == resource


# ---------- §13 1 그날 진행 중인 세션 ----------


def test_T12_S13_1_세션을_시작하지_않은_날은_404_resource_session(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    not_found(by_day(osaka, trip["trip_days"][0]["day_id"]), "session")


@pytest.mark.parametrize("stage", ["asking", "browsing"])
def test_T12_S13_1_진행_중_세션이_있으면_GET_planning과_같은_응답(osaka, stage):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    sid = start(osaka, day_id)["session_id"] if stage == "asking" else browsing(osaka, day_id)
    got = by_day(osaka, day_id)
    assert got.status_code == 200, got.text
    assert got.json() == osaka.client.get(f"/planning/{sid}").json()
    assert got.json()["session_id"] == sid
    assert got.json()["stage"] == stage


def test_T12_S13_1_담은_곳과_후보가_그대로(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    sid = browsing(osaka, day_id)
    got = by_day(osaka, day_id).json()
    assert got["picks_count"] == 1
    assert [c["place"]["id"] for c in got["candidates"]] == [c["place"]["id"] for c in osaka.client.get(f"/planning/{sid}").json()["candidates"]]


def test_T12_S13_1_코스안_단계도_진행_중(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    auto = start(osaka, day_id, "auto")
    got = by_day(osaka, day_id).json()
    assert got["session_id"] == auto["session_id"]
    assert got["stage"] == "composing"


def test_T12_S13_1_같은_날_새로_시작했으면_가장_나중_세션(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    browsing(osaka, day_id)
    later = start(osaka, day_id, "auto")["session_id"]
    assert by_day(osaka, day_id).json()["session_id"] == later


def test_T12_S13_1_다른_날의_세션은_섞이지_않는다(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    first, second = trip["trip_days"][0]["day_id"], trip["trip_days"][1]["day_id"]
    browsing(osaka, first)
    not_found(by_day(osaka, second), "session")


def test_T12_S13_1_읽기만_한다_저장소·체크포인트_그대로(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    browsing(osaka, day_id)
    before, saved = stores(osaka), checkpoints_text(osaka)
    by_day(osaka, day_id)
    by_day(osaka, day_id)
    assert stores(osaka) == before
    assert checkpoints_text(osaka) == saved


def test_T12_S13_1_S11_Q3_남의_날은_없는_날과_같은_404이고_내_대화는_그대로(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    day_id = trip["trip_days"][0]["day_id"]
    sid = browsing(osaka, day_id)
    before = osaka.client.get(f"/planning/{sid}").json()
    theirs = by_day(osaka, day_id, YOU)
    not_found(theirs, "day")
    unknown = by_day(osaka, "00000000-0000-4000-8000-000000000000", YOU)
    not_found(unknown, "day")
    assert set(theirs.json()["error"]) == set(unknown.json()["error"])  # 남의 날과 없는 날이 같은 모양
    assert set(theirs.json()["error"]["detail"]) == set(unknown.json()["error"]["detail"])
    assert osaka.client.get(f"/planning/{sid}").json() == before


def test_T12_S13_1_토큰이_없으면_401(osaka):  # noqa: F811
    trip = osaka.make_trip(device=ME)
    response = osaka.anon.get(f"/days/{trip['trip_days'][0]['day_id']}/planning")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


# ---------- §13 3 받아 둔 kid는 다시 받지 않고 바로 확인 ----------


class Clock:
    def __init__(self, now: float = 1000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def jwks(monkeypatch):
    """calls = 부른 주소, state["down"] = True면 받기 실패."""
    calls: list[str] = []
    state = {"down": False}

    def fetch(url):
        calls.append(url)
        if state["down"]:
            raise OSError("Supabase에 못 붙음 (테스트)")
        return json.loads(json.dumps(FAKE_JWKS))

    monkeypatch.setattr(api.auth, "fetch_jwks", fetch)
    return calls, state


@pytest.mark.parametrize("later", [0.0, 59.999, 60.0, 60.001, 3600.0], ids=["바로", "59.999초", "정각_60초", "60.001초", "1시간"])
def test_T12_S13_3_아는_kid는_시간이_지나도_다시_받지_않고_통과(jwks, later):
    calls, _ = jwks
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    clock.now += later
    assert cache.verify(make_token(user_id("b"))) == user_id("b")
    assert len(calls) == 1


@pytest.mark.parametrize("later", [0.0, 60.0, 3600.0], ids=["바로", "정각_60초", "1시간"])
def test_T12_S13_3_JWKS를_못_받는_때에도_아는_kid는_통과(jwks, later):
    calls, state = jwks
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    state["down"] = True
    clock.now += later
    assert cache.verify(make_token(user_id("b"))) == user_id("b")
    assert len(calls) == 1


def test_T12_S13_3_JWKS를_못_받는_때_아는_kid의_틀린_토큰은_401_쪽_AuthError(jwks):
    from api.auth import AuthError, AuthUnavailable

    calls, state = jwks
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    state["down"] = True
    clock.now += 3600
    for token in (make_token(user_id("a"), key=FakeKey(FAKE_KEY.kid)), make_token(user_id("a"), expires_in=-3600), make_token(user_id("a"), aud="anon")):
        with pytest.raises(AuthError) as caught:
            cache.verify(token)
        assert not isinstance(caught.value, AuthUnavailable)  # 장애가 아니라 틀린 토큰
    assert len(calls) == 1


def test_T12_S13_3_모르는_kid일_때만_다시_받는다(jwks):
    calls, _ = jwks
    clock = Clock()
    cache = JwksCache(FAKE_SUPABASE_URL, clock=clock)
    cache.verify(make_token(user_id("a")))
    clock.now += 60
    cache.verify(make_token(user_id("a")))
    assert len(calls) == 1
    with pytest.raises(Exception):
        cache.verify(make_token(user_id("a"), key=FakeKey("fake-kid-other")))
    assert len(calls) == 2


def test_T12_S13_3_서버에서도_받아_둔_kid면_JWKS가_끊겨도_요청이_된다(monkeypatch, osaka):  # noqa: F811
    assert osaka.current(ME).status_code == 404  # 여기서 공개 키를 받아 둔다

    def down(url):
        raise OSError("Supabase에 못 붙음 (테스트)")

    monkeypatch.setattr(api.auth, "fetch_jwks", down)
    from test_task010_trips import trip_body

    made = osaka.anon.post("/trips", json=trip_body(), headers=bearer(ME))
    assert made.status_code == 201, made.text
