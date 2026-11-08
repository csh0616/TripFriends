"""TASK-010 §11 H2~H7: Google 영업시간은 필요할 때 불러 메모리에만 (1시간), 동시에 부르고 전체 2초 상한, 늦거나 실패하면 대체.
근거: TASK-010 §11 H2·H3·H4·H6·H7, ADR-015 v1.1 §3-1·§3-2, NFR-02. 실제 Google은 부르지 않는다 (가짜 공급자, AC-1).

계약 (이 테스트가 정한 이름, 승인 대기):
    places/live.py
        CAPS = {"planning": 80, "now": 20, "alternatives": 20}       (§11 H6)
        LiveHours(provider, *, deadline: float = 2.0)                  deadline = 한 번 부르기 전체 상한(초, H4)
        LiveHours.fetch(place_ids, *, now, cap) -> {place_id: 값 | None}
            값 = {"opening_hours": [{weekday, open, close}] | None, "business_status": str, "checked_at": ISO, "fresh": bool}
            - 메모리 값의 나이 < 1시간이면 부르지 않고 그 값 (fresh True). 나이 = 1시간이면 오래된 것 (H2, Q7 방식)
            - 여러 곳을 동시에 부른다. 부르는 곳은 cap 개까지 (place_ids 순서대로)
            - 늦거나(deadline) 실패하거나 cap 밖이면: 메모리 값이 있으면 그 값 + fresh False(= unverified), 없으면 None
    facts_for(row, entry, live): live fresh -> google·confirmed / fresh False -> google·unverified / None -> Serper 값(unverified) -> unknown
    서버: app.state.places_provider.details 가 부르는 곳 (H3 ① 계획 세션 시작 ② 여행 중 화면 ③ 닫힘 대안). 시계는 app.state.clock
"""

import threading
import time
from datetime import UTC, datetime, timedelta

import pytest

from test_task010_places import FAKE_JSON, build, row_of
from test_task010_trips import DEVICE, NOON, PACK_IDS, osaka  # noqa: F401 (픽스처)

NOW = datetime(2026, 11, 10, 3, 0, tzinfo=UTC)
KUROMON = "FAKE-osaka-kuromon"
PACK_PLACE_IDS = {pid.replace("osaka-fake-", "FAKE-osaka-") for pid in PACK_IDS}


class Counting:
    """FakePlaces 감싸기: details 부른 place_id를 적고, 늦추기·실패를 넣을 수 있다."""

    def __init__(self, delay: float = 0.0, fail: set[str] = frozenset(), slow: dict[str, float] | None = None):
        from places.provider import FakePlaces

        self.inner = FakePlaces(FAKE_JSON)
        self.delay, self.fail, self.slow = delay, set(fail), slow or {}
        self.called: list[str] = []
        self.active = 0
        self.peak = 0
        self._lock = threading.Lock()

    def details(self, place_id):
        with self._lock:
            self.called.append(place_id)
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            time.sleep(self.slow.get(place_id, self.delay))
            if place_id in self.fail:
                raise RuntimeError("공급자 실패 (테스트)")
            return self.inner.details(place_id)
        finally:
            with self._lock:
                self.active -= 1

    def resolve(self, query, area):
        return self.inner.resolve(query, area)

    def search_lodging(self, q):
        return self.inner.search_lodging(q)


def live(provider, deadline: float | None = None):
    from places.live import LiveHours

    return LiveHours(provider) if deadline is None else LiveHours(provider, deadline=deadline)


IDS = ["FAKE-osaka-kuromon", "FAKE-osaka-ramen", "FAKE-osaka-hozenji", "FAKE-osaka-sky", "FAKE-osaka-museum"]


# ---------- H2 메모리 1시간 ----------


def test_T10_H6_상한_계획_80_여행_중_20_대안_20():
    from places.live import CAPS

    assert CAPS == {"planning": 80, "now": 20, "alternatives": 20}


def test_T10_H4_전체_상한_기본_2초():
    assert live(Counting()).deadline == 2.0


def test_T10_H2_처음_부르면_그_자리에서_받은_값():
    provider = Counting()
    found = live(provider).fetch([KUROMON], now=NOW, cap=80)[KUROMON]
    assert provider.called == [KUROMON]
    assert found["fresh"] is True
    assert datetime.fromisoformat(found["checked_at"]) == NOW
    assert found["opening_hours"][0] == {"weekday": 0, "open": "09:00", "close": "18:00"}


@pytest.mark.parametrize(
    ("age", "calls_again"),
    [(timedelta(minutes=59, seconds=59), False), (timedelta(hours=1), True), (timedelta(hours=1, seconds=1), True)],
    ids=["59분_59초_뒤", "정각_1시간_뒤", "1시간_1초_뒤"],
)
def test_T10_H2_Q7_메모리_수명_1시간_같으면_오래된_것(age, calls_again):
    provider = Counting()
    hours = live(provider)
    hours.fetch([KUROMON], now=NOW, cap=80)
    found = hours.fetch([KUROMON], now=NOW + age, cap=80)[KUROMON]
    assert provider.called == ([KUROMON, KUROMON] if calls_again else [KUROMON])
    assert found["fresh"] is True
    assert datetime.fromisoformat(found["checked_at"]) == (NOW + age if calls_again else NOW)


def test_T10_H2_새로_켜면_메모리는_비어_있다():
    provider = Counting()
    live(provider).fetch([KUROMON], now=NOW, cap=80)
    live(provider).fetch([KUROMON], now=NOW + timedelta(minutes=1), cap=80)  # 새 LiveHours = 서버를 다시 켠 것
    assert provider.called == [KUROMON, KUROMON]


# ---------- H4 동시에, 2초 상한, 늦거나 실패하면 대체 ----------


def test_T10_H4_여러_곳은_동시에_부른다():
    provider = Counting(delay=0.3)
    began = time.monotonic()
    found = live(provider).fetch(IDS, now=NOW, cap=80)
    elapsed = time.monotonic() - began
    assert set(provider.called) == set(IDS)
    assert provider.peak >= 2
    assert elapsed < 0.3 * len(IDS) * 0.6, elapsed  # 차례로 부르면 1.5초
    assert all(found[pid] and found[pid]["fresh"] for pid in IDS)


def test_T10_H4_상한을_넘긴_곳은_기다리지_않고_대체_메모리_없으면_None():
    provider = Counting(slow={"FAKE-osaka-sky": 1.5})
    began = time.monotonic()
    found = live(provider, deadline=0.3).fetch(IDS, now=NOW, cap=80)
    assert time.monotonic() - began < 1.0
    assert found["FAKE-osaka-sky"] is None
    assert found[KUROMON]["fresh"] is True


def test_T10_H4_상한을_넘긴_곳은_메모리_값이_있으면_그_값_미확인():
    provider = Counting()
    hours = live(provider, deadline=0.3)
    first = hours.fetch(["FAKE-osaka-sky"], now=NOW, cap=80)["FAKE-osaka-sky"]
    provider.slow = {"FAKE-osaka-sky": 1.5}
    found = hours.fetch(["FAKE-osaka-sky"], now=NOW + timedelta(hours=2), cap=80)["FAKE-osaka-sky"]
    assert found["fresh"] is False
    assert found["opening_hours"] == first["opening_hours"] and found["checked_at"] == first["checked_at"]


def test_T10_H4_실패한_곳만_대체_나머지는_그대로():
    provider = Counting(fail={"FAKE-osaka-ramen"})
    found = live(provider).fetch(IDS, now=NOW, cap=80)
    assert found["FAKE-osaka-ramen"] is None
    assert all(found[pid]["fresh"] for pid in IDS if pid != "FAKE-osaka-ramen")


def test_T10_H4_실패해도_메모리_값이_있으면_그_값_미확인():
    provider = Counting()
    hours = live(provider)
    hours.fetch([KUROMON], now=NOW, cap=80)
    provider.fail = {KUROMON}
    found = hours.fetch([KUROMON], now=NOW + timedelta(hours=2), cap=80)[KUROMON]
    assert found["fresh"] is False and found["opening_hours"]


@pytest.mark.parametrize(("cap", "called"), [(5, 5), (3, 3)], ids=["상한_딱", "상한_모자람"])
def test_T10_H6_cap_개까지만_부르고_남은_곳은_대체(cap, called):
    provider = Counting()
    found = live(provider).fetch(IDS, now=NOW, cap=cap)
    assert sorted(provider.called) == sorted(IDS[:called])
    assert all(found[pid] is None for pid in IDS[called:])


def test_T10_H6_메모리에서_꺼낸_곳은_상한에_세지_않는다():
    provider = Counting()
    hours = live(provider)
    hours.fetch(IDS[:3], now=NOW, cap=80)
    provider.called.clear()
    found = hours.fetch(IDS, now=NOW + timedelta(minutes=5), cap=2)
    assert sorted(provider.called) == sorted(IDS[3:])
    assert all(found[pid]["fresh"] for pid in IDS)


# ---------- H4·H7 fact로 바꿀 때의 대체 순서 ----------


def hours_fact(our_id: str, value) -> dict:
    from places.pack import facts_for

    result = build()
    row = row_of(result.pack, our_id)
    return next(f for f in facts_for(row, result.cache[row["place_id"]], value) if f["field"] == "opening_hours")


def test_T10_H4_대체_순서_그_자리_값_메모리_값_Serper_모름():
    fresh = live(Counting()).fetch([KUROMON], now=NOW, cap=80)[KUROMON]
    assert (hours_fact("osaka-fake-kuromon", fresh)["source_type"], hours_fact("osaka-fake-kuromon", fresh)["status"]) == ("google", "confirmed")
    stale = {**fresh, "fresh": False}
    assert (hours_fact("osaka-fake-kuromon", stale)["source_type"], hours_fact("osaka-fake-kuromon", stale)["status"]) == ("google", "unverified")
    serper = hours_fact("osaka-fake-alley-cafe", None)
    assert (serper["source_type"], serper["status"]) == ("serper", "unverified")
    assert hours_fact("osaka-fake-kuromon", None)["status"] == "unknown"


# ---------- H3 부르는 때 (API) ----------


@pytest.fixture
def counting(osaka, monkeypatch):  # noqa: F811
    calls: list[str] = []
    provider = osaka.app.state.places_provider
    real = provider.details

    def details(place_id):
        calls.append(place_id)
        return real(place_id)

    monkeypatch.setattr(provider, "details", details)
    return calls


def test_T10_H3_1_계획_세션_시작에_그날_후보를_부르고_1시간_안에는_다시_안_부른다(osaka, counting):  # noqa: F811
    trip = osaka.make_trip(days=2, offset=10)
    counting.clear()
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"})
    assert started.status_code == 201, started.text
    first = list(counting)
    assert first and len(first) <= 80 and set(first) <= PACK_PLACE_IDS
    counting.clear()
    osaka.set_now(NOON + timedelta(minutes=59))
    assert osaka.client.post(f"/days/{trip['trip_days'][1]['day_id']}/planning", json={"mode": "conversation"}).status_code == 201
    assert not set(counting) & set(first)
    counting.clear()
    osaka.set_now(NOON + timedelta(hours=1))
    assert osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"}).status_code == 201
    assert counting


def test_T10_H3_1_H7_계획_후보의_Google_영업시간은_확인됨(osaka):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=10)
    session = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"}).json()
    first = session["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{session['session_id']}/answer", json={"choice_ids": [first]}).json()
    hours = [f for c in batch["candidates"] for f in c["place"]["facts"] if f["field"] == "opening_hours" and f["source_type"] == "google"]
    assert hours and all(f["status"] in ("confirmed", "unknown") for f in hours)
    assert any(f["status"] == "confirmed" for f in hours)


def test_T10_H4_계획_세션은_공급자가_모두_실패해도_멈추지_않는다(osaka, monkeypatch):  # noqa: F811
    def broken(place_id):
        raise RuntimeError("공급자 실패 (테스트)")

    trip = osaka.make_trip(days=1, offset=10)
    monkeypatch.setattr(osaka.app.state.places_provider, "details", broken)
    session = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"})
    assert session.status_code == 201, session.text
    first = session.json()["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{session.json()['session_id']}/answer", json={"choice_ids": [first]})
    assert batch.status_code == 200, batch.text
    for c in batch.json()["candidates"]:
        fact = next(f for f in c["place"]["facts"] if f["field"] == "opening_hours")
        assert fact["status"] in ("unverified", "unknown")  # 받은 값이 없으니 확인됨은 없다


def today_course(osaka) -> tuple[dict, str]:  # noqa: F811
    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    return trip, day_id


def test_T10_H3_2_여행_중_화면은_오늘_장소를_1시간에_한_번(osaka, counting):  # noqa: F811
    _, day_id = today_course(osaka)
    osaka.set_now(NOON + timedelta(hours=1))  # 계획 때 받은 값이 오래되게
    counting.clear()
    at = {"at": "2026-12-01T13:00"}
    assert osaka.client.get(f"/days/{day_id}/now", params=at).status_code == 200
    first = list(counting)
    assert first and len(first) <= 20
    counting.clear()
    osaka.set_now(NOON + timedelta(hours=1, minutes=30))
    assert osaka.client.get(f"/days/{day_id}/now", params=at).status_code == 200
    assert counting == []
    osaka.set_now(NOON + timedelta(hours=2))
    assert osaka.client.get(f"/days/{day_id}/now", params=at).status_code == 200
    assert counting


def test_T10_H3_3_닫힘_대안은_근처_후보를_그_자리에서_부른다(osaka, counting):  # noqa: F811
    _, day_id = today_course(osaka)
    view = osaka.client.get(f"/days/{day_id}/now", params={"at": "2026-12-01T10:00"}).json()
    course = [pin["place_id"] for pin in view["pins"]]
    assert course
    osaka.set_now(NOON + timedelta(hours=1))  # 계획 때 받은 값이 오래되게 (1시간 안이면 메모리를 쓰는지는 질문)
    counting.clear()
    response = osaka.client.post(f"/places/{course[0]}/visit-checks", json={"day_id": day_id, "at": "2026-12-01T10:00", "was_open": False})
    assert response.status_code == 200, response.text
    assert len(counting) <= 20
    assert set(counting) <= PACK_PLACE_IDS
    in_course = {pid.replace("osaka-fake-", "FAKE-osaka-") for pid in course}
    assert set(counting) - in_course, "대안 후보(코스 밖)를 불렀다"
