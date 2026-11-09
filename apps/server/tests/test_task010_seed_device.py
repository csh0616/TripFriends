"""TASK-010 데모 시드를 기기 여행으로 붙이기 (승현 결정 11-09, 점검 Maestro·reviewer 전용).
근거: 승현 결정(11-09) "개발에서만, 운영 404 그대로 / 앱의 기존 데모 버튼 동작은 바꾸지 마 /
X-Device-Id로 기기 여행에 붙이는 건 점검에서만 (TASK-012 B2: X-Device-Id 대신 Authorization: Bearer의 사용자에게 붙인다) / 붙일 때 그 기기의 이전 여행은 B2처럼 archived (지우지 않음)",
TASK-010 §B2(여행 하나만, archived), §13 질문 답 1·§14 답 1(past_days = 데모 시계를 n일 뒤로 -> 첫날 state=past).

계약 (이 테스트가 정한 것, 승인 대기):
    POST /debug/seed-demo + 헤더 Authorization: Bearer (이전 X-Device-Id) -> 그 기기의 GET /trips/current = 시드 응답의 trip_id (status active),
        trip_days의 day_id 순서 = 시드 응답 day_ids, 날 상태는 그 여행의 데모 시계(past_days만큼 뒤)로 계산
    헤더가 없으면 지금과 같다: 본문 없으면 응답 키 {trip_id, day_ids}, 어떤 기기의 지금 여행도 바뀌지 않는다
"""

import importlib

from fastapi.testclient import TestClient

from auth_helpers import bearer
from test_task010_trips import osaka, states  # noqa: F401  (osaka = 가짜 오사카 서버 fixture)

DEVICE = "device-A"
OTHER = "device-B"


def seed(osaka, body: dict | None = None, device: str | None = None):
    client = osaka.client if device else osaka.anon  # TASK-012: 토큰 없는 시드 = 기본 헤더 없는 클라이언트
    headers = bearer(device) if device else {}
    if body is None:
        return client.post("/debug/seed-demo", headers=headers)
    return client.post("/debug/seed-demo", json=body, headers=headers)


# ---------- (1) 헤더 + past_days -> 그 기기의 지금 여행 ----------


def test_T10_시드_헤더와_past_days_1이면_그_기기의_current가_데모_여행이고_첫날이_지난_날(osaka):
    seeded = seed(osaka, {"past_days": 1}, DEVICE)
    assert seeded.status_code == 201, seeded.text
    current = osaka.current(DEVICE)
    assert current.status_code == 200, current.text
    trip = current.json()
    assert trip["trip_id"] == seeded.json()["trip_id"]
    assert trip["status"] == "active"
    assert [day["day_id"] for day in trip["trip_days"]] == seeded.json()["day_ids"]
    got = states(trip)
    assert got[0] == "past"
    assert "past" not in got[1:]


def test_T10_시드_헤더만_주면_그_기기의_current가_데모_여행이고_지난_날이_없다(osaka):
    seeded = seed(osaka, device=DEVICE)
    assert seeded.status_code == 201, seeded.text
    trip = osaka.current(DEVICE).json()
    assert trip["trip_id"] == seeded.json()["trip_id"]
    assert "past" not in states(trip)


def test_T10_시드_헤더만_주면_날_상태는_past_days_0과_같다_첫날_오늘_나머지_계획_전(osaka):
    # PM 답 (11-09): past_days 없는 데모의 날 상태를 직접 본다.
    # 근거: seed.py·§14 답 1 "데모 시계 = 첫날 + past_days" (값이 없으면 0과 같다, test_T10_S13_Q1_past_days_0과_선택값_없음은_같은_상태),
    # §B6·§9 Q6 날 상태 (오늘 = today, 계획 전이어도) · 본문 없는 시드는 chosen이 아니라 고른 코스가 없다 -> 앞날은 planning
    plain = seed(osaka, device=DEVICE)
    zero = seed(osaka, {"past_days": 0}, OTHER)
    assert plain.status_code == 201 and zero.status_code == 201, (plain.text, zero.text)
    got = states(osaka.current(DEVICE).json())
    assert got == ["today", "planning", "planning"]
    assert got == states(osaka.current(OTHER).json())
    assert got == [day["state"] for day in zero.json()["trip_days"]]


def test_T10_시드_헤더로_붙여도_다른_기기에는_여행이_생기지_않는다(osaka):
    seed(osaka, {"past_days": 1}, DEVICE)
    assert osaka.current(OTHER).status_code == 404


# ---------- (2) 이전 여행은 archived로 남는다 (B2 확인 방식 그대로) ----------


def test_T10_시드_헤더로_붙이면_그_기기의_이전_여행은_지우지_않고_archived(osaka):
    first = osaka.make_trip(device=DEVICE)
    seeded = seed(osaka, {"past_days": 1}, DEVICE)
    assert seeded.status_code == 201, seeded.text
    assert osaka.current(DEVICE).json()["trip_id"] == seeded.json()["trip_id"]
    old = osaka.trip(first["trip_id"], DEVICE)
    assert old.status_code == 200
    assert old.json()["status"] == "archived"


def test_T10_시드_헤더로_붙여도_다른_기기의_여행은_archived가_안_된다(osaka):
    theirs = osaka.make_trip(device=OTHER)
    seed(osaka, {"past_days": 1}, DEVICE)
    assert osaka.current(OTHER).json()["trip_id"] == theirs["trip_id"]
    assert osaka.trip(theirs["trip_id"], OTHER).json()["status"] == "active"


# ---------- (3) 헤더 없이 부르면 지금과 같다 ----------


def test_T10_시드_헤더_없이_본문도_없으면_응답_모양은_trip_id_day_ids_그대로(osaka):
    plain = seed(osaka)
    assert plain.status_code == 201, plain.text
    assert set(plain.json()) == {"trip_id", "day_ids"}


def test_T10_시드_헤더_없이_부르면_어떤_기기의_여행도_바뀌지_않는다(osaka):
    mine = osaka.make_trip(device=DEVICE)
    seed(osaka)
    seed(osaka, {"past_days": 1})
    assert osaka.current(DEVICE).json()["trip_id"] == mine["trip_id"]
    assert osaka.trip(mine["trip_id"], DEVICE).json()["status"] == "active"
    assert osaka.current(OTHER).status_code == 404


# ---------- (4) 운영은 헤더가 있어도 404 ----------


def test_T10_시드_운영에서는_헤더가_있어도_404(monkeypatch):
    import api.main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    try:
        with TestClient(importlib.reload(api.main).app) as client:
            for body in (None, {"past_days": 1}):
                kwargs = {"json": body} if body is not None else {}
                response = client.post("/debug/seed-demo", headers=bearer(DEVICE), **kwargs)
                assert response.status_code == 404
            assert client.get("/trips/current", headers=bearer(DEVICE)).status_code != 200
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)
