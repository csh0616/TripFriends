"""TASK-010 데모 시드를 기기 여행으로 붙이기 (승현 결정 11-09, 점검 Maestro·reviewer 전용) + TASK-012 §11 (데모도 Bearer, 붙이기는 as_current일 때만).
근거: 승현 결정(11-09) "개발에서만, 운영 404 그대로 / 붙일 때 그 기기의 이전 여행은 B2처럼 archived (지우지 않음)",
TASK-010 §B2(여행 하나만, archived)·§13 답 1·§14 답 1(past_days)·§15(점검 전용 동작),
TASK-012 B2(X-Device-Id 대신 Bearer)·§11 Q1(토큰 없이 열린 길 0, 주인 없는 여행 없음)·Q2(데모는 그 사용자 소유, 지금 여행을 바꾸지 않음, as_current: true일 때만 붙임).

계약 (TASK-012 §11로 바뀜, 승인 대기):
    POST /debug/seed-demo + Bearer + 본문 as_current: true -> 그 사용자의 GET /trips/current = 시드 응답의 trip_id (status active),
        trip_days의 day_id 순서 = 시드 응답 day_ids, 날 상태는 그 여행의 데모 시계(past_days만큼 뒤)로 계산, 이전 여행은 archived
    as_current가 없으면: 데모 여행은 그 사용자 소유(GET /trips/{id} 200, is_demo true)지만 /trips/current와 기존 여행 status는 그대로
    토큰이 없으면 401 UNAUTHORIZED
"""

import importlib

from fastapi.testclient import TestClient

from auth_helpers import bearer, install_fake_jwks
from test_task010_trips import osaka, states  # noqa: F401  (osaka = 가짜 오사카 서버 fixture)

DEVICE = "device-A"
OTHER = "device-B"


def seed(osaka, body: dict | None = None, device: str | None = None, as_current: bool = True):
    """device가 있으면 그 사용자 토큰으로. as_current(기본 True = 점검 전용 붙이기)면 본문에 as_current: true."""
    client = osaka.client if device else osaka.anon
    headers = bearer(device) if device else {}
    payload = {**(body or {}), **({"as_current": True} if as_current else {})}
    if not payload:
        return client.post("/debug/seed-demo", headers=headers)
    return client.post("/debug/seed-demo", json=payload, headers=headers)


# ---------- (1) Bearer + as_current + past_days -> 그 사용자의 지금 여행 ----------


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


# ---------- (3) TASK-012 §11 Q2: as_current 없이 토큰과 부르면 데모는 내 것이지만 지금 여행은 그대로 ----------


def test_T12_S11_Q2_as_current_없이_본문도_없으면_응답_모양은_trip_id_day_ids_그대로(osaka):
    plain = seed(osaka, device=DEVICE, as_current=False)
    assert plain.status_code == 201, plain.text
    assert set(plain.json()) == {"trip_id", "day_ids"}


def test_T12_S11_Q2_as_current_없이_부르면_지금_여행과_status가_그대로(osaka):
    mine = osaka.make_trip(device=DEVICE)
    seed(osaka, device=DEVICE, as_current=False)
    seed(osaka, {"past_days": 1}, DEVICE, as_current=False)
    assert osaka.current(DEVICE).json()["trip_id"] == mine["trip_id"]
    assert osaka.trip(mine["trip_id"], DEVICE).json()["status"] == "active"
    assert osaka.current(OTHER).status_code == 404


def test_T12_S11_Q2_as_current_없이_부르면_여행이_없던_사용자의_current도_404(osaka):
    seed(osaka, {"chosen": True}, DEVICE, as_current=False)
    assert osaka.current(DEVICE).status_code == 404


def test_T12_S11_Q1_Q2_데모_여행은_그_사용자_소유_is_demo_true_남에게는_404(osaka):
    seeded = seed(osaka, device=DEVICE, as_current=False).json()
    got = osaka.trip(seeded["trip_id"], DEVICE)
    assert got.status_code == 200, got.text
    assert got.json()["is_demo"] is True
    assert osaka.trip(seeded["trip_id"], OTHER).status_code == 404


def test_T12_S11_Q1_토큰_없이_시드하면_401(osaka):
    response = seed(osaka, as_current=False)
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert seed(osaka, {"past_days": 1}).status_code == 401  # as_current가 있어도


# ---------- (4) 운영은 헤더가 있어도 404 ----------


def test_T10_시드_운영에서는_헤더가_있어도_404(monkeypatch):
    import api.main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    install_fake_jwks(monkeypatch)
    try:
        with TestClient(importlib.reload(api.main).app) as client:
            for body in (None, {"past_days": 1}, {"as_current": True}):
                kwargs = {"json": body} if body is not None else {}
                response = client.post("/debug/seed-demo", headers=bearer(DEVICE), **kwargs)
                assert response.status_code == 404
            assert client.get("/trips/current", headers=bearer(DEVICE)).status_code != 200
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)
