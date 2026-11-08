"""TASK-010 v1.5 §13 (서버). 근거: §13 O1~O3·질문 답 1, ADR-015(측정 결과), docs/data/osaka-seed.yaml v2, TASK-006(데모 시드), TASK-008(T-05).

계약 (이 테스트가 정한 것, 승인 대기):
    늘 열림(open_space) 영업시간 = 7개 요일 모두 00:00~24:00 (엔진 Opening, §9 Q8 "24時間 = 00:00~24:00"과 같은 표기).
        fact value = "00:00-24:00" (앱은 이 값 + curated로 "늘 열려 있어"를 쓴다)
    curated_hours [{days: all, open, close}] = 7개 요일 모두 그 구간
    facts_for(row, entry, live): §13 O3 순서. live fresh -> google·confirmed / open_space·curated_hours -> curated·confirmed /
        live 메모리(fresh False) -> google·unverified / Serper -> serper·unverified / unknown
    POST /debug/seed-demo {"past_days": N} -> 201, 응답 trip_days[:N].state == "past" (PM 답 11-09: 데모 시계를 N일 뒤로). 선택값이 없으면 N=0과 같다
"""

from datetime import date

import pytest
import yaml

from engine.models import DayPlan
from test_task010_places import NOW, build, row_of
from test_task010_v14 import SEED

ALL_DAY = [{"weekday": d, "open": "00:00", "close": "24:00"} for d in range(7)]
NIGHT = [{"weekday": d, "open": "17:00", "close": "24:00"} for d in range(7)]


def live_value(place_id: str, fresh: bool = True) -> dict:
    from places.live import LiveHours
    from test_task010_places import fake_places

    found = LiveHours(fake_places()).fetch([place_id], now=NOW, cap=80)[place_id]
    assert found is not None
    return {**found, "fresh": fresh}


def hours_fact(our_id: str, live=None) -> dict:
    from places.pack import facts_for

    result = build()
    row = row_of(result.pack, our_id)
    return next(f for f in facts_for(row, result.cache[row["place_id"]], live) if f["field"] == "opening_hours")


def engine_place(our_id: str, live=None):
    from places.pack import engine_places

    result = build()
    pid = row_of(result.pack, our_id)["place_id"]
    return engine_places(result.pack, result.cache, {pid: live})[our_id]


# ---------- 정본 seed v2 ----------


@pytest.fixture(scope="module")
def raw():
    return yaml.safe_load(SEED.read_text(encoding="utf-8"))


def test_T10_S13_정본_seed_v2(raw):
    assert raw["version"] == 2
    assert len(raw["places"]) == 58


def test_T10_S13_O1_정본의_open_space는_문서의_10곳(raw):
    names = {p["name_ko"] for p in raw["places"] if p.get("open_space") is True}
    expected = ["도톤보리", "글리코 간판", "호젠지 요코초", "신세카이", "아메리카무라", "우츠보 공원", "나카자키초", "우메키타 공원", "나카노시마 공원", "오사카성 공원"]
    assert len(names) == 10
    assert names == set(expected)


def test_T10_S13_O2_정본의_curated_hours는_밤거리_5곳_17시_24시(raw):
    rows = [p for p in raw["places"] if "curated_hours" in p]
    assert {p["id"] for p in rows} == {"osaka-ura-namba", "osaka-soemoncho", "osaka-ohatsutenjin-urasando", "osaka-hankyu-higashi-dori", "osaka-kitashinchi"}
    for row in rows:
        assert row["curated_hours"] == [{"days": "all", "open": "17:00", "close": "24:00"}], row["id"]
        assert not row.get("open_space")


def test_T10_S13_정본_v2를_서버가_읽고_두_값을_줄에_남긴다():
    from places.seed import load_seed

    rows = {row["id"]: row for row in load_seed(SEED)["places"]}
    assert rows["osaka-dotonbori"]["open_space"] is True
    assert rows["osaka-ura-namba"]["curated_hours"] == [{"days": "all", "open": "17:00", "close": "24:00"}]


def test_T10_S13_두_값은_우리가_정한_값이라_팩에_남는다():
    pack = build().pack
    assert row_of(pack, "osaka-fake-park")["open_space"] is True
    assert row_of(pack, "osaka-fake-night-street")["curated_hours"] == [{"days": "all", "open": "17:00", "close": "24:00"}]


# ---------- O1 늘 열림 ----------


def test_T10_S13_O1_늘_열림은_curated_confirmed_00시_24시():
    fact = hours_fact("osaka-fake-park")
    assert (fact["source_type"], fact["status"]) == ("curated", "confirmed")
    assert fact["value"] == "00:00-24:00"


def test_T10_S13_O1_엔진에는_하루_종일_열림_확인됨():
    place = engine_place("osaka-fake-park")
    assert sorted((o.model_dump() for o in place.hours or []), key=lambda o: (o["weekday"], o["open"], o["close"])) == sorted(ALL_DAY, key=lambda o: o["weekday"])
    assert place.hours_status == "confirmed"  # 영업 확인(T-05)은 확인됨이 아닌 곳에만 (TASK-008)


def test_T10_S13_O1_O3_Google_값이_있으면_Google이_먼저():
    fact = hours_fact("osaka-fake-park-google", live_value("FAKE-osaka-park-google"))
    assert (fact["source_type"], fact["status"]) == ("google", "confirmed")
    assert fact["value"] == "06:00-22:00"


def test_T10_S13_O1_Google_값을_못_받았으면_늘_열림():
    fact = hours_fact("osaka-fake-park-google", None)
    assert (fact["source_type"], fact["status"], fact["value"]) == ("curated", "confirmed", "00:00-24:00")


# ---------- O2 밤거리 시간대 ----------


def test_T10_S13_O2_curated_hours는_그_시간대를_curated_confirmed로():
    fact = hours_fact("osaka-fake-night-street")
    assert (fact["source_type"], fact["status"]) == ("curated", "confirmed")
    assert fact["value"] == "17:00-24:00"
    place = engine_place("osaka-fake-night-street")
    assert sorted((o.model_dump() for o in place.hours or []), key=lambda o: (o["weekday"], o["open"], o["close"])) == sorted(NIGHT, key=lambda o: o["weekday"])
    assert place.hours_status == "confirmed"


def test_T10_S13_O2_낮_하루에는_코스에_들어가지_않는다():
    from engine.planning import compose_courses as compose

    place = engine_place("osaka-fake-night-street")
    other = engine_place("osaka-fake-park")
    places = {place.id: place, other.id: other}
    plan = DayPlan(date=date(2026, 12, 2), start="10:00", end="16:00", lodging=(other.lat, other.lng), fixed=[], must_visit=[], stay_overrides={})
    result = compose(plan, [place.id, other.id], places)
    for option in getattr(result, "options", result):
        assert place.id not in {item.place_id for item in option.items}
        assert place.id in {d.place_id for d in option.dropped}


def test_T10_S13_O2_저녁_하루에는_들어간다():
    from engine.planning import compose_courses as compose

    place = engine_place("osaka-fake-night-street")
    plan = DayPlan(date=date(2026, 12, 2), start="17:00", end="22:00", lodging=(place.lat, place.lng), fixed=[], must_visit=[], stay_overrides={})
    result = compose(plan, [place.id], {place.id: place})
    for option in getattr(result, "options", result):
        assert place.id in {item.place_id for item in option.items}


# ---------- O3 고르는 순서 ----------


def test_T10_S13_O3_curated가_Serper보다_먼저():
    fact = hours_fact("osaka-fake-night-street", None)  # Serper에는 18:00~23:00이 있다
    assert fact["source_type"] == "curated" and fact["value"] == "17:00-24:00"


def test_T10_S13_O3_curated가_메모리_값보다_먼저():
    stale = {"opening_hours": [{"weekday": d, "open": "12:00", "close": "13:00"} for d in range(7)], "business_status": "OPERATIONAL", "checked_at": NOW.isoformat(), "fresh": False}
    fact = hours_fact("osaka-fake-night-street", stale)
    assert (fact["source_type"], fact["status"]) == ("curated", "confirmed")


def test_T10_S13_O3_curated가_없으면_메모리_Serper_모름_순서_그대로():
    stale = live_value("FAKE-osaka-kuromon", fresh=False)
    assert (hours_fact("osaka-fake-kuromon", stale)["source_type"], hours_fact("osaka-fake-kuromon", stale)["status"]) == ("google", "unverified")
    serper = hours_fact("osaka-fake-alley-cafe", None)
    assert (serper["source_type"], serper["status"]) == ("serper", "unverified")
    assert hours_fact("osaka-fake-kuromon", None)["status"] == "unknown"


def test_T10_S13_O3_그_자리에서_받은_Google이_curated보다_먼저():
    fresh = {"opening_hours": [{"weekday": d, "open": "18:00", "close": "23:30"} for d in range(7)], "business_status": "OPERATIONAL", "checked_at": NOW.isoformat(), "fresh": True}
    fact = hours_fact("osaka-fake-night-street", fresh)
    assert (fact["source_type"], fact["status"], fact["value"]) == ("google", "confirmed", "18:00-23:30")


# ---------- 질문 답 1: 데모의 지난 날 ----------


DAY_STATES = {"planning", "planned", "today", "past"}  # §B6


def seeded_states(body: dict) -> list[str]:
    """PM 답 (11-09) 1: 데모 시계를 past_days만큼 뒤로 -> 날 상태를 응답에서 본다.
    계약 (이 테스트가 정한 것, 승인 대기): 응답 trip_days = [{day_id, date, state}] (Trip.trip_days와 같은 이름, §9 Q12), day_ids와 같은 순서."""
    days = body["trip_days"]
    assert [day["day_id"] for day in days] == body["day_ids"]
    states = [day["state"] for day in days]
    assert set(states) <= DAY_STATES
    return states


@pytest.mark.parametrize("n", [0, 1, 2], ids=["0일", "1일", "2일"])
def test_T10_S13_Q1_seed_demo_past_days_N이면_첫_N일이_지난_날(env, n):
    response = env.client.post("/debug/seed-demo", json={"past_days": n})
    assert response.status_code == 201, response.text
    assert len(response.json()["day_ids"]) == 3
    states = seeded_states(response.json())
    assert states[:n] == ["past"] * n
    assert "past" not in states[n:]


def test_T10_S13_Q1_선택값이_없으면_지금_그대로(env):
    plain = env.client.post("/debug/seed-demo")
    assert plain.status_code == 201
    assert {"trip_id", "day_ids"} <= set(plain.json())
    assert "past" not in seeded_states(plain.json())  # N=0과 같다


def test_T10_S13_Q1_past_days_0과_선택값_없음은_같은_상태(env):
    zero = seeded_states(env.client.post("/debug/seed-demo", json={"past_days": 0}).json())
    plain = seeded_states(env.client.post("/debug/seed-demo").json())
    assert zero == plain


def test_T10_S13_Q1_운영에서는_past_days를_줘도_404(monkeypatch):
    import importlib

    from fastapi.testclient import TestClient

    import api.main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    try:
        with TestClient(importlib.reload(api.main).app) as client:
            assert client.post("/debug/seed-demo", json={"past_days": 1}).status_code == 404
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)
