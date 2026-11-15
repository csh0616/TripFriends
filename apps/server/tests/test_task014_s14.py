"""TASK-014 §14 reviewer 재점검 답: Q1 거짓 늦어짐 하루 중간(실제 모드) · Q3 개발용 seed-demo의 past_days 최대 = 여행 일수.

근거: TASK-014 §14 Q1("하루 중간도 다 고친다", A2 — 다음 일정이 위치 없는 고정 일정이면 그 구간 delay_min = None, 위치 있는 장소의 기존 동작 그대로)·
§13 5(위치 없는 고정 일정은 이동 시간으로 늦어짐을 판단하지 않고 시각으로만, 실제 모드로 재현)·Q3("past_days 최대를 여행 일수까지(전부 지난 = 끝난 여행)"),
TASK-007 §A A2·B-4(check 본문)·B-5(status delayed), TASK-010 §13 답 1·§14 답 1(past_days = 데모 시계를 N일 뒤로, 상태까지 확인).
"""

import pytest
from fastapi.testclient import TestClient

from auth_helpers import bearer
from storage_helpers import KINDS, new_id, server_env
from test_task010_trips import Osaka, states
from trip_helpers import at_place, at_time, fixed_at, item, plant, spot

# =====================================================================
# Q1 거짓 늦어짐 — 하루 중간에 위치 없는 고정 일정 (실제 모드, 연습도 같은 계산)
# =====================================================================

P01, P03 = at_place(1.0), at_place(3.0)


def lunch_mid_day(env) -> str:
    """하루 중간에 [+ 일정]으로 넣은 것 같은 위치 없는 고정 일정 "점심" 12:30~13:30 (TASK-010 §B2, 장소 없음).
    1번 P01 10:12~12:00 · 2번 점심(장소 없음, 이동 0) · 3번 P03 14:00~15:00(이동 30) · 4번 P04 15:30~17:00(이동 30 -> 3번 예정 출발 15:00)."""
    places = {"P01": spot("P01", 1.0), "P03": spot("P03", 3.0), "P04": spot("P04", 4.0)}
    items = [
        item(1, "P01", "10:12", "12:00", 12),
        item(2, None, "12:30", "13:30", 0, fixed=True),
        item(3, "P03", "14:00", "15:00", 30),
        item(4, "P04", "15:30", "17:00", 30),
    ]
    return plant(env, items, places, fixed=(fixed_at(None, "12:30", "13:30", title="점심"),))


def check(env, day_id: str, clock: str, position, rehearsal: bool = False) -> dict:
    body = {"at": at_time(clock), "lat": position[0], "lng": position[1]}
    if rehearsal:
        body["rehearsal"] = True
    response = env.client.post(f"/days/{day_id}/check", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def card_types(view: dict) -> list[str]:
    return [card["type"] for card in [view["main"], *view["subs"]]]


def test_T14_S14_Q1_시험_자체_확인_점심은_코스_가운데에_있고_핀이_없다(env):
    day_id = lunch_mid_day(env)
    view = env.client.get(f"/days/{day_id}/now", params={"at": at_time("11:00")}).json()
    assert [pin["seq"] for pin in view["pins"]] == [1, 3, 4]  # 장소 없는 고정 일정은 핀이 아니다 (TASK-006 §11 Q6)


@pytest.mark.parametrize("rehearsal", [False, True], ids=["실제", "연습"])
@pytest.mark.parametrize("clock", ["12:40", "12:50", "13:00", "13:29", "13:30"])
def test_T14_S14_Q1_점심_중_앞_장소_근처에_있어도_늦어짐이_아니다(env, rehearsal, clock):
    # 점심 가게가 앞 장소 근처일 수 있다. 다음 일정이 위치 없는 고정 일정이면 그 구간은 delay_min = None (§14 Q1 A2)
    day_id = lunch_mid_day(env)
    view = check(env, day_id, clock, P01, rehearsal=rehearsal)
    assert view["event"] is None, view["event"]
    assert view["status"] != "delayed", view["status_text"]
    assert "T-04" not in card_types(view)


@pytest.mark.parametrize("rehearsal", [False, True], ids=["실제", "연습"])
def test_T14_S14_Q1_실제와_연습이_같다_점심_중_거짓_늦어짐_없음(env, rehearsal):
    # §13 5: 연습 문제가 아니라 늦어짐 감지의 버그 -> 실제·연습 둘 다 사건 없음. 실제를 먼저 보내도 그 뒤 연습이 사건을 만들지 않는다
    day_id = lunch_mid_day(env)
    first = check(env, day_id, "12:45", P01)
    second = check(env, day_id, "13:15", P01, rehearsal=rehearsal)
    assert (first["event"], second["event"]) == (None, None)


def test_T14_S14_Q1_경계_점심_뒤_위치_있는_장소_사이는_지금처럼_감지한다(env):
    # 위치 있는 장소(3번 -> 4번)는 TASK-007 A2·A4 그대로: 3번 예정 출발 15:00, 15:20이면 20분 늦음(높음)
    day_id = lunch_mid_day(env)
    assert check(env, day_id, "15:09", P03)["event"] is None  # 9분: 문턱 아래 (A3)
    view = check(env, day_id, "15:20", P03)
    assert view["event"] is not None
    assert (view["event"]["delay_min"], view["event"]["severity"]) == (20, "high")
    assert view["status"] == "delayed"


# §15 Q1: 점심(F)이 끝난 뒤에는 F를 건너뛰고 다음 위치 있는 장소(3번 P03) 기준.
# leave = 3번 시작 14:00 - P01에서 P03까지 이동 분 30(코스의 3번 travel_min, 엔진은 F 뒤에도 자리를 P01로 둔다) = 13:30 = F 끝


@pytest.mark.parametrize("rehearsal", [False, True], ids=["실제", "연습"])
@pytest.mark.parametrize("clock", ["13:31", "13:39"], ids=["F_끝_1분_뒤_1분", "9분"])
def test_T14_S15_Q1_점심_뒤_다음_장소_출발_10분_전까지는_늦어짐이_아니다(env, rehearsal, clock):
    day_id = lunch_mid_day(env)
    view = check(env, day_id, clock, P01, rehearsal=rehearsal)
    assert view["event"] is None, view["event"]
    assert view["status"] != "delayed", view["status_text"]


@pytest.mark.parametrize("rehearsal", [False, True], ids=["실제", "연습"])
@pytest.mark.parametrize("clock, delay", [("13:40", 10), ("13:45", 15)], ids=["10분_경계", "13시45분"])
def test_T14_S15_Q1_점심이_끝났는데_앞_장소에_있으면_P03에_늦는_걸_감지한다(env, rehearsal, clock, delay):
    # §15 Q1: "13:45에 아직 앞 장소에 있으면 P03에 늦는 걸 감지한다". 실제·연습 둘 다 (같은 계산, §C3)
    day_id = lunch_mid_day(env)
    view = check(env, day_id, clock, P01, rehearsal=rehearsal)
    assert view["event"] is not None
    assert (view["event"]["type"], view["event"]["delay_min"], view["event"]["severity"]) == ("delay", delay, "low")  # 20분 미만, 뒤 고정 일정 없음 (A4)
    assert view["status"] == "delayed"


def test_T14_S15_Q1_점심_뒤_늦어짐은_실제와_연습의_응답이_같다(env):
    day_id = lunch_mid_day(env)
    rehearsal = check(env, day_id, "13:45", P01, rehearsal=True)
    real = check(env, day_id, "13:45", P01)
    assert (rehearsal["status"], rehearsal["status_text"], card_types(rehearsal)) == (real["status"], real["status_text"], card_types(real))
    assert (rehearsal["event"]["delay_min"], rehearsal["event"]["severity"]) == (real["event"]["delay_min"], real["event"]["severity"])


# =====================================================================
# Q3 개발용 seed-demo: past_days 최대 = 여행 일수 (데모 여행 3일)
# =====================================================================

DEMO_DAYS = 3


def seed(client, body: dict, user: str):
    return client.post("/debug/seed-demo", json=body, headers=bearer(user))


def test_T14_S14_Q3_past_days가_여행_일수면_201이고_모든_날이_지난_날(env):
    response = env.client.post("/debug/seed-demo", json={"past_days": DEMO_DAYS})
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["day_ids"]) == DEMO_DAYS  # 시험 자체 확인: 데모는 3일
    assert [day["day_id"] for day in body["trip_days"]] == body["day_ids"]
    assert [day["state"] for day in body["trip_days"]] == ["past"] * DEMO_DAYS  # 끝난 여행


def test_T14_S14_Q3_경계_여행_일수_하나_전이면_마지막_날만_남는다(env):
    response = env.client.post("/debug/seed-demo", json={"past_days": DEMO_DAYS - 1})
    assert response.status_code == 201, response.text
    got = [day["state"] for day in response.json()["trip_days"]]
    assert got[: DEMO_DAYS - 1] == ["past"] * (DEMO_DAYS - 1)
    assert got[-1] != "past"


def test_T14_S14_Q3_경계_past_days_0이면_201이고_지난_날이_없다(env):
    # 아래쪽 경계: 0은 허용(지난 날 0개). ge=0 -> ge=1 돌연변이를 잡는다
    response = env.client.post("/debug/seed-demo", json={"past_days": 0})
    assert response.status_code == 201, response.text
    got = [day["state"] for day in response.json()["trip_days"]]
    assert len(got) == DEMO_DAYS
    assert "past" not in got


@pytest.mark.parametrize("n", [DEMO_DAYS + 1, DEMO_DAYS + 10], ids=["일수_더하기_1", "일수_더하기_10"])
def test_T14_S14_Q3_여행_일수를_넘으면_지금과_같은_오류(env, n):
    # "일수 초과는 지금과 같은 오류": 지금(le=2)의 초과 응답 = 422, detail[0].loc = ["body", "past_days"] (FastAPI 본문 검증)
    response = env.client.post("/debug/seed-demo", json={"past_days": n})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["body", "past_days"]


def test_T14_S14_Q3_음수는_그대로_오류(env):
    response = env.client.post("/debug/seed-demo", json={"past_days": -1})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["body", "past_days"]


@pytest.mark.parametrize("kind", KINDS)
def test_T14_S14_Q3_끝난_데모_여행은_두_저장소에서_같게_모든_날이_지난_날(monkeypatch, kind):
    # D6 스크린샷(reviewer가 as_current로 직접 부름): 그 사용자 소유의 데모 여행 GET /trips/{id}에서 날 상태가 모두 past
    from api.main import app

    server_env(monkeypatch, kind)
    me = f"user-T14-s14-{kind}"
    with TestClient(app, headers=bearer(me)) as client:
        seeded = seed(client, {"past_days": DEMO_DAYS, "as_current": True}, me)
        assert seeded.status_code == 201, seeded.text
        trip = Osaka(client, app).trip(seeded.json()["trip_id"], me)
        assert trip.status_code == 200, trip.text
        assert [day["day_id"] for day in trip.json()["trip_days"]] == seeded.json()["day_ids"]
        assert states(trip.json()) == ["past"] * DEMO_DAYS


@pytest.mark.parametrize("kind", KINDS)
def test_T14_S15_Q3_끝난_데모_여행은_지금_여행으로_그대로_나온다(monkeypatch, kind):
    # §15 Q3: "지금 여행으로 그대로 보여 준다 (새 여행을 만들 때만 보관 — 지금 규칙)". D6 화면의 서버 쪽.
    # 앱 쪽(모든 날 지난 줄 + 주 버튼 없음 -> end-note "여행이 끝났어" + [새 여행 만들기])은 TASK-011 테스트가 이미 덮는다
    from api.main import app

    server_env(monkeypatch, kind)
    me = f"user-T14-s15-{kind}-{new_id()}"  # 실행마다 새 이름 (§12)
    with TestClient(app, headers=bearer(me)) as client:
        seeded = seed(client, {"past_days": DEMO_DAYS, "as_current": True}, me)
        assert seeded.status_code == 201, seeded.text
        current = Osaka(client, app).current(me)
        assert current.status_code == 200, current.text
        body = current.json()
        assert body["trip_id"] == seeded.json()["trip_id"]
        assert body["status"] == "active"  # 끝났다고 보관(archived)하지 않는다
        assert [day["day_id"] for day in body["trip_days"]] == seeded.json()["day_ids"]
        assert states(body) == ["past"] * DEMO_DAYS
