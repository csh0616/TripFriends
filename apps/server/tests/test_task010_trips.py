"""TASK-010 §B 여행 API. 근거: TASK-010 §B1~§B7·§6·§7 AC-4·AC-5·AC-8, API-001 §2-1(11-09), SRS-001 FR-01·FR-13,
DESIGN-001 §4-9(R1은 여행 하나), TASK-005 A3(하루 꼭 갈 곳 5).

서버는 가짜 오사카로 켠다 (`PLACES_PROVIDER=fake`, §D). Google·Serper 키는 지운다 (실제 호출 0, AC-1).

계약 (이 테스트가 정한 이름, 승인 대기):
    PLACES_PROVIDER=fake -> app.state.places_provider 는 FakePlaces, 도시 팩은 testdata/cities/osaka-seed-fake.yaml + FakePlaces로 시작 때 만든다
    app.state.clock: () -> 시간대 있는 datetime. 테스트는 서버 시작 뒤 바꿔 넣는다 (도시 시간대 오늘은 이 값으로)
    Trip = {trip_id, city_code, start_date, end_date, lodging_place_id, status(active|archived, §9 Q2),
            trip_days: [{day_id, date, state, chosen_option_id(없으면 null, §9 Q6), fixed_events: [FixedEvent]}]}  (§9 Q12 승인)
    FixedEvent = {fixed_event_id, trip_day_id, title, start_at, end_at, place_id}
    오류는 공통 형식 {"error": {code, message, detail}} (API-001 §1).
        400 = VALIDATION_ERROR + detail.field(틀린 칸 이름) (§9 Q13) · 409 = PLAN_EXISTS (§B3) · 숙소 검색 실패 503 PROVIDER_UNAVAILABLE (§9 Q13)
    trip/days.py  city_today(now, timezone) -> date · day_state(day, today, planned) -> planning|planned|today|past
"""

import logging
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# 2026-12-01 12:00 JST (도시 시간대 오늘 = 12-01)
NOON = datetime(2026, 12, 1, 3, 0, tzinfo=UTC)
TODAY = date(2026, 12, 1)
DEVICE = "device-A"
PACK_IDS = {
    "osaka-fake-dotonbori", "osaka-fake-kuromon", "osaka-fake-ramen", "osaka-fake-hozenji", "osaka-fake-alley-cafe",
    "osaka-fake-comedy", "osaka-fake-shotengai", "osaka-fake-amemura", "osaka-fake-gallery", "osaka-fake-sky",
    "osaka-fake-ferris", "osaka-fake-museum", "osaka-fake-izakaya", "osaka-fake-kissa",
}  # 가짜 seed 17줄 - 뺀 3줄 (test_task010_places EXCLUDED)
SIX = sorted(PACK_IDS)[:6]
STATES = {"planning", "planned", "today", "past"}
SOURCE_TYPES = {"google", "serper", "user", "curated", "estimate", "demo"}  # §9 Q3


class Osaka:
    def __init__(self, client: TestClient, app):
        self.client, self.app = client, app
        self.set_now(NOON)

    def set_now(self, when: datetime) -> None:
        self.app.state.clock = lambda: when

    def post_trip(self, body: dict, device: str = DEVICE):
        return self.client.post("/trips", json=body, headers={"X-Device-Id": device})

    def make_trip(self, days: int = 3, offset: int = 10, device: str = DEVICE, **extra) -> dict:
        response = self.post_trip(trip_body(days, offset, **extra), device)
        assert response.status_code == 201, response.text
        return response.json()

    def current(self, device: str = DEVICE):
        return self.client.get("/trips/current", headers={"X-Device-Id": device})

    def trip(self, trip_id: str, device: str = DEVICE):
        return self.client.get(f"/trips/{trip_id}", headers={"X-Device-Id": device})

    def add_fixed(self, trip: dict, day_index: int, start: str, end: str, title: str = "저녁 예약", **extra):
        day = trip["trip_days"][day_index]
        body = {"trip_day_id": day["day_id"], "title": title, "start_at": at(day["date"], start), "end_at": at(day["date"], end), **extra}
        return self.client.post(f"/trips/{trip['trip_id']}/fixed-events", json=body, headers={"X-Device-Id": DEVICE})

    def plan_and_select(self, day_id: str) -> None:
        """계획을 고른 날로 만든다: 자동 모드로 코스안 -> 첫 안 고르기 (TASK-003 §5)."""
        started = self.client.post(f"/days/{day_id}/planning", json={"mode": "auto"})
        assert started.status_code == 201, started.text
        options = started.json()["options"]
        chosen = self.client.post(f"/course-options/{options[0]['option_id']}/select")
        assert chosen.status_code == 200, chosen.text


@pytest.fixture
def osaka(monkeypatch):
    from api.main import app

    for name in ("AI_GATEWAY_API_KEY", "APP_ENV", "GOOGLE_PLACES_API_KEY", "SERPER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    with TestClient(app) as client:
        yield Osaka(client, app)


def iso(day: date) -> str:
    return day.isoformat()


def at(day: str, hhmm: str) -> str:
    return f"{day}T{hhmm}:00+09:00"


def trip_body(days: int = 3, offset: int = 10, must: list[tuple[int, str]] = (), lodging: str | None = None, city: str = "osaka") -> dict:
    start = TODAY + timedelta(days=offset)
    end = start + timedelta(days=days - 1)
    body = {
        "city_code": city,
        "start_date": iso(start),
        "end_date": iso(end),
        "must_visits": [{"date": iso(start + timedelta(days=d)), "place_id": pid} for d, pid in must],
    }
    if lodging is not None:
        body["lodging_place_id"] = lodging
    return body


def assert_400(response, *fields: str) -> None:
    """§9 Q13: 400 VALIDATION_ERROR, detail.field = 틀린 칸 이름 (fields를 주면 그 중 하나)."""
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR" and error["message"]
    assert isinstance(error["detail"], dict) and error["detail"].get("field"), error
    if fields:
        assert error["detail"]["field"] in fields, error


def states(trip: dict) -> list[str]:
    return [day["state"] for day in trip["trip_days"]]


# ---------- B1 POST /trips ----------


def test_T10_B1_AC4_201_Trip과_날짜별_trip_days(osaka):
    trip = osaka.make_trip(days=3, offset=10)
    assert trip["city_code"] == "osaka"
    assert (trip["start_date"], trip["end_date"]) == (iso(TODAY + timedelta(days=10)), iso(TODAY + timedelta(days=12)))
    assert [day["date"] for day in trip["trip_days"]] == [iso(TODAY + timedelta(days=10 + n)) for n in range(3)]
    assert len({day["day_id"] for day in trip["trip_days"]}) == 3
    assert set(states(trip)) <= STATES
    assert trip["status"] == "active"  # §9 Q2
    assert all(day["chosen_option_id"] is None for day in trip["trip_days"])  # §9 Q6


@pytest.mark.parametrize(("days", "ok"), [(0, False), (1, True), (7, True), (8, False)], ids=["0일", "1일", "7일", "8일"])
def test_T10_B1_AC4_기간_1일에서_7일(osaka, days, ok):
    start = TODAY + timedelta(days=10)
    body = {"city_code": "osaka", "start_date": iso(start), "end_date": iso(start + timedelta(days=days - 1)), "must_visits": []}
    response = osaka.post_trip(body)
    if ok:
        assert response.status_code == 201, response.text
        assert len(response.json()["trip_days"]) == days
    else:
        assert_400(response, "end_date")  # §10 Q30


@pytest.mark.parametrize(("offset", "ok"), [(-1, False), (0, True), (180, True), (181, False)], ids=["어제", "오늘", "180일_뒤", "181일_뒤"])
def test_T10_B1_AC4_시작일은_오늘부터_180일_뒤까지(osaka, offset, ok):
    response = osaka.post_trip(trip_body(days=1, offset=offset))
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "start_date")


@pytest.mark.parametrize(
    ("now", "start", "ok"),
    [
        (datetime(2026, 11, 30, 14, 59, 59, tzinfo=UTC), date(2026, 11, 30), True),  # JST 11-30 23:59:59
        (datetime(2026, 11, 30, 15, 0, 0, tzinfo=UTC), date(2026, 11, 30), False),  # JST 12-01 00:00 (UTC로는 아직 11-30)
        (datetime(2026, 11, 30, 15, 0, 0, tzinfo=UTC), date(2026, 12, 1), True),
    ],
    ids=["자정_1초_전_오늘", "자정_지나면_어제", "자정_지나면_새_오늘"],
)
def test_T10_B1_AC5_오늘은_도시_시간대_기준(osaka, now, start, ok):
    osaka.set_now(now)
    body = {"city_code": "osaka", "start_date": iso(start), "end_date": iso(start), "must_visits": []}
    response = osaka.post_trip(body)
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response)


@pytest.mark.parametrize("city", ["demo", "tokyo", ""], ids=["데모", "다른_도시", "빈_값"])
def test_T10_B1_도시는_osaka만(osaka, city):
    assert_400(osaka.post_trip(trip_body(city=city)), "city_code")


@pytest.mark.parametrize(("count", "ok"), [(5, True), (6, False)], ids=["하루_5곳", "하루_6곳"])
def test_T10_B1_AC4_하루_꼭_갈_곳_5곳까지(osaka, count, ok):
    response = osaka.post_trip(trip_body(must=[(0, pid) for pid in SIX[:count]]))
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "must_visits")


def test_T10_B1_꼭_갈_곳은_날마다_세서_두_날_5곳씩은_된다(osaka):
    must = [(0, pid) for pid in SIX[:5]] + [(1, pid) for pid in sorted(PACK_IDS)[6:11]]  # §11 D1: 날끼리 겹치지 않게
    assert osaka.post_trip(trip_body(days=2, must=must)).status_code == 201


@pytest.mark.parametrize(
    "must",
    [[(0, "osaka-fake-kuromon"), (1, "osaka-fake-kuromon")], [(0, "osaka-fake-kuromon"), (2, "osaka-fake-kuromon"), (1, "osaka-fake-sky")]],
    ids=["이틀에_같은_곳", "첫날과_셋째_날에_같은_곳"],
)
def test_T10_D1_같은_장소를_다른_날에_또_넣으면_400(osaka, must):
    assert_400(osaka.post_trip(trip_body(days=3, must=must)), "must_visits")


def test_T10_D1_다른_날_다른_장소는_된다(osaka):
    assert osaka.post_trip(trip_body(days=3, must=[(0, "osaka-fake-kuromon"), (1, "osaka-fake-sky"), (2, "osaka-fake-ramen")])).status_code == 201


@pytest.mark.parametrize(
    "must",
    [[(0, "osaka-fake-closed-shop")], [(0, "osaka-fake-not-found")], [(0, "D01")], [(0, "없는_장소")]],
    ids=["팩에서_뺀_폐업", "팩에서_뺀_검색_실패", "데모_장소", "없는_id"],
)
def test_T10_B1_팩에_없는_장소는_400(osaka, must):
    assert_400(osaka.post_trip(trip_body(must=must)), "must_visits")


@pytest.mark.parametrize("day_offset", [-1, 3], ids=["시작_전날", "끝_다음날"])
def test_T10_B1_꼭_갈_곳_날짜가_여행_밖이면_400(osaka, day_offset):
    assert_400(osaka.post_trip(trip_body(days=3, must=[(day_offset, "osaka-fake-kuromon")])), "must_visits")


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(days=st.integers(min_value=-1, max_value=10), offset=st.integers(min_value=-3, max_value=183))
def test_T10_B1_속성_기간과_시작일이_둘_다_맞을_때만_201(osaka, days, offset):
    start = TODAY + timedelta(days=offset)
    body = {"city_code": "osaka", "start_date": iso(start), "end_date": iso(start + timedelta(days=days - 1)), "must_visits": []}
    response = osaka.post_trip(body, device=f"prop-{days}-{offset}")
    assert response.status_code == (201 if 1 <= days <= 7 and 0 <= offset <= 180 else 400), response.text


# ---------- B2 여행 하나만 ----------


@pytest.mark.parametrize("call", ["post", "current"], ids=["POST_trips", "GET_current"])
def test_T10_B2_Q16_X_Device_Id가_없으면_400(osaka, call):
    if call == "post":
        response = osaka.client.post("/trips", json=trip_body())
    else:
        response = osaka.client.get("/trips/current")
    assert_400(response, "X-Device-Id")


def test_T10_B2_여행이_없으면_current_404(osaka):
    assert osaka.current().status_code == 404


def test_T10_B2_만든_여행이_current(osaka):
    trip = osaka.make_trip()
    current = osaka.current()
    assert current.status_code == 200
    assert current.json()["trip_id"] == trip["trip_id"]


def test_T10_B2_새로_만들면_이전_여행은_지우지_않고_archived(osaka):
    first = osaka.make_trip(offset=10)
    second = osaka.make_trip(offset=20)
    assert osaka.current().json()["trip_id"] == second["trip_id"]
    old = osaka.trip(first["trip_id"])
    assert old.status_code == 200
    assert old.json()["status"] == "archived"
    assert osaka.trip(second["trip_id"]).json()["status"] == "active"


def test_T10_B2_다른_기기의_여행은_보이지_않는다(osaka):
    osaka.make_trip(device="device-A")
    assert osaka.current(device="device-B").status_code == 404


def test_T10_B2_다른_기기가_만들어도_내_여행은_archived가_안_된다(osaka):
    mine = osaka.make_trip(device="device-A")
    osaka.make_trip(device="device-B")
    assert osaka.current(device="device-A").json()["trip_id"] == mine["trip_id"]


def test_T10_6_400이면_아무것도_바뀌지_않는다_이전_여행은_그대로(osaka):
    first = osaka.make_trip()
    assert_400(osaka.post_trip(trip_body(days=8)))
    assert osaka.current().json()["trip_id"] == first["trip_id"]
    assert osaka.trip(first["trip_id"]).json()["status"] != "archived"


# ---------- B3 고정 일정 ----------


def test_T10_B3_고정_일정_201과_날_줄에_보인다(osaka):
    trip = osaka.make_trip()
    response = osaka.add_fixed(trip, 0, "18:30", "19:30")
    assert response.status_code == 201, response.text
    made = response.json()
    assert {"fixed_event_id", "trip_day_id", "title", "start_at", "end_at", "place_id"} <= set(made)
    assert made["trip_day_id"] == trip["trip_days"][0]["day_id"] and made["title"] == "저녁 예약"
    day = osaka.trip(trip["trip_id"]).json()["trip_days"][0]
    assert [e["fixed_event_id"] for e in day["fixed_events"]] == [made["fixed_event_id"]]


@pytest.mark.parametrize(
    ("start", "end", "ok"),
    [("12:00", "12:00", False), ("12:00", "12:01", True), ("12:00", "11:59", False)],
    ids=["끝_같음", "끝_1분_뒤", "끝이_앞"],
)
def test_T10_B3_AC4_끝은_시작보다_뒤(osaka, start, end, ok):
    response = osaka.add_fixed(osaka.make_trip(), 0, start, end)
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "start_at", "end_at")


def fixed_at(osaka, trip: dict, start_at: str, end_at: str):
    body = {"trip_day_id": trip["trip_days"][0]["day_id"], "title": "경계", "start_at": start_at, "end_at": end_at}
    return osaka.client.post(f"/trips/{trip['trip_id']}/fixed-events", json=body, headers={"X-Device-Id": DEVICE})


def test_T10_B3_Q15_그날_00시부터_24시까지는_된다(osaka):
    trip = osaka.make_trip()
    day, nxt = trip["trip_days"][0]["date"], trip["trip_days"][1]["date"]
    assert fixed_at(osaka, trip, at(day, "00:00"), at(day, "01:00")).status_code == 201
    assert fixed_at(osaka, trip, at(day, "23:00"), at(nxt, "00:00")).status_code == 201  # 끝 = 24:00


def test_T10_B3_Q15_24시를_1분_넘거나_00시_전에_시작하면_400(osaka):
    trip = osaka.make_trip()
    day, nxt = trip["trip_days"][0]["date"], trip["trip_days"][1]["date"]
    prev = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    assert_400(fixed_at(osaka, trip, at(day, "23:00"), at(nxt, "00:01")), "start_at", "end_at")
    assert_400(fixed_at(osaka, trip, at(prev, "23:59"), at(day, "01:00")), "start_at", "end_at")


def test_T10_B3_Q15_그날은_도시_시간대로_센다(osaka):
    trip = osaka.make_trip()
    day = trip["trip_days"][0]["date"]
    # UTC로 쓴 같은 순간: JST 그날 10:00~11:00 = UTC 01:00~02:00
    assert fixed_at(osaka, trip, f"{day}T01:00:00+00:00", f"{day}T02:00:00+00:00").status_code == 201
    # UTC 그날 20:00 = JST 다음 날 05:00 -> 그날 밖
    assert_400(fixed_at(osaka, trip, f"{day}T20:00:00+00:00", f"{day}T21:00:00+00:00"), "start_at", "end_at")


def test_T10_B3_그날_밖의_시각은_400(osaka):
    trip = osaka.make_trip()
    day = trip["trip_days"][0]
    other = trip["trip_days"][1]["date"]
    body = {"trip_day_id": day["day_id"], "title": "다른 날", "start_at": at(other, "12:00"), "end_at": at(other, "13:00")}
    assert_400(osaka.client.post(f"/trips/{trip['trip_id']}/fixed-events", json=body, headers={"X-Device-Id": DEVICE}), "start_at", "end_at")


@pytest.mark.parametrize(
    ("second", "ok"),
    [(("12:30", "13:30"), False), (("11:00", "12:01"), False), (("11:30", "14:00"), False), (("13:00", "14:00"), True), (("11:00", "12:00"), True)],
    ids=["뒤쪽_겹침", "앞쪽_1분_겹침", "감쌈", "끝에_맞닿음", "시작에_맞닿음"],
)
def test_T10_B3_AC4_같은_날_겹치면_400_맞닿으면_된다(osaka, second, ok):
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "12:00", "13:00").status_code == 201
    response = osaka.add_fixed(trip, 0, *second, title="두 번째")
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "start_at", "end_at")


def test_T10_B3_다른_날이면_같은_시각이어도_된다(osaka):
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "12:00", "13:00").status_code == 201
    assert osaka.add_fixed(trip, 1, "12:00", "13:00").status_code == 201


@pytest.mark.parametrize(("length", "ok"), [(0, False), (1, True), (30, True), (31, False)], ids=["0자", "1자", "30자", "31자"])
def test_T10_B3_AC4_제목은_1자에서_30자(osaka, length, ok):
    response = osaka.add_fixed(osaka.make_trip(), 0, "12:00", "13:00", title="가" * length)
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "title")


@pytest.mark.parametrize(("title", "ok"), [("   ", False), ("  가  ", True), (" " + "가" * 30 + " ", True), ("가" * 31, False)], ids=["공백만", "공백_빼면_1자", "공백_빼면_30자", "31자"])
def test_T10_B3_Q29_제목은_앞뒤_공백을_지우고_센다(osaka, title, ok):
    response = osaka.add_fixed(osaka.make_trip(), 0, "12:00", "13:00", title=title)
    if ok:
        assert response.status_code == 201, response.text
    else:
        assert_400(response, "title")


def test_T10_B3_AC4_계획을_고른_날이면_409_PLAN_EXISTS_일정은_그대로(osaka):
    trip = osaka.make_trip()
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    before = osaka.trip(trip["trip_id"]).json()
    response = osaka.add_fixed(trip, 0, "18:30", "19:30")
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "PLAN_EXISTS"
    assert osaka.trip(trip["trip_id"]).json() == before  # 고른 코스를 몰래 바꾸지 않는다 (FR-13)


def test_T10_B3_계획_고르지_않은_다른_날은_고정_일정을_넣을_수_있다(osaka):
    trip = osaka.make_trip()
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    assert osaka.add_fixed(trip, 1, "18:30", "19:30").status_code == 201


def test_T10_B3_지우면_사라지고_같은_시각에_다시_넣을_수_있다(osaka):
    trip = osaka.make_trip()
    made = osaka.add_fixed(trip, 0, "12:00", "13:00").json()
    deleted = osaka.client.delete(f"/fixed-events/{made['fixed_event_id']}", headers={"X-Device-Id": DEVICE})
    assert deleted.status_code == 204, deleted.text  # §9 Q15
    assert osaka.trip(trip["trip_id"]).json()["trip_days"][0]["fixed_events"] == []
    assert osaka.add_fixed(trip, 0, "12:00", "13:00").status_code == 201


def test_T10_B3_Q15_계획을_고른_날의_고정_일정_지우기도_409(osaka):
    trip = osaka.make_trip()
    made = osaka.add_fixed(trip, 0, "12:00", "13:00").json()
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    before = osaka.trip(trip["trip_id"]).json()
    deleted = osaka.client.delete(f"/fixed-events/{made['fixed_event_id']}", headers={"X-Device-Id": DEVICE})
    assert deleted.status_code == 409, deleted.text
    assert deleted.json()["error"]["code"] == "PLAN_EXISTS"
    assert osaka.trip(trip["trip_id"]).json() == before


def test_T10_B3_없는_고정_일정_지우기는_404(osaka):
    assert osaka.client.delete("/fixed-events/없는_id", headers={"X-Device-Id": DEVICE}).status_code == 404


# ---------- B4 장소 검색 (꼭 갈 곳, 팩 안) ----------


def search(osaka, q: str, city: str = "osaka"):
    return osaka.client.get("/places/search", params={"city_code": city, "q": q})


def found_ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [place["id"] for place in response.json()]


def test_T10_B4_이름_부분_일치(osaka):
    assert "osaka-fake-dotonbori" in found_ids(search(osaka, "톤보"))


def test_T10_B4_별칭_부분_일치(osaka):
    assert found_ids(search(osaka, "아메무라")) == ["osaka-fake-amemura"]


def test_T10_B4_한_글자부터_검색(osaka):
    assert "osaka-fake-dotonbori" in found_ids(search(osaka, "도"))


@pytest.mark.parametrize("q", ["", "   "], ids=["빈_글", "공백만"])
def test_T10_B4_Q14_비거나_공백뿐이면_200_빈_목록(osaka, q):
    assert found_ids(search(osaka, q)) == []


def test_T10_B4_Q14_앞뒤_공백은_지우고_찾는다(osaka):
    assert found_ids(search(osaka, "  아메무라  ")) == ["osaka-fake-amemura"]


def test_T10_B4_최대_10개(osaka):
    ids = found_ids(search(osaka, "오사카"))  # 가짜 seed는 모든 줄 별칭에 "오사카"가 있다 (팩 14곳)
    assert len(ids) == 10 and set(ids) <= PACK_IDS


@pytest.mark.parametrize("q", ["문 닫은", "찾을 수 없는", "여러 개인"], ids=["폐업", "검색_실패", "여러_곳"])
def test_T10_B4_팩에서_뺀_곳은_검색되지_않는다(osaka, q):
    assert found_ids(search(osaka, q)) == []


def test_T10_B4_오사카_밖_도시는_400(osaka):
    assert_400(search(osaka, "도", city="tokyo"))


def test_T10_B4_B7_결과는_facts_형식과_카테고리_그림(osaka):
    response = search(osaka, "오사카")
    for place in response.json():
        assert {"id", "name", "category", "facts", "image"} <= set(place)
        assert place["image"] == {"category": place["category"]}  # §9 Q20: 카테고리만, URL 없음
        for fact in place["facts"]:
            assert {"field", "value", "status", "source_type", "source_url", "checked_at"} <= set(fact)
            assert fact["source_type"] in SOURCE_TYPES
        stay = [f for f in place["facts"] if f["field"] == "stay_min"]
        assert stay and all(f["source_type"] == "curated" for f in stay)


def test_T10_B4_이름은_우리가_정한_한국어_이름(osaka):
    response = search(osaka, "구로몬")
    assert response.status_code == 200, response.text
    place = response.json()[0]
    assert place["name"] == "구로몬 시장"


# ---------- B5 숙소 검색 (팩 밖, 가짜 공급자) ----------


def lodging(osaka, q: str):
    return osaka.client.get("/places/lodging-search", params={"city_code": "osaka", "q": q})


def test_T10_B5_두_글자부터_결과_5개(osaka):
    response = lodging(osaka, "호텔")
    assert response.status_code == 200, response.text
    hits = response.json()
    assert len(hits) == 5  # 가짜 데이터에 "호텔"이 7곳
    for hit in hits:
        assert set(hit) == {"place_id", "name", "address_short"}


@pytest.mark.parametrize("q", ["호", " 호 ", "", "  "], ids=["한_글자", "공백_지우면_한_글자", "빈_글", "공백만"])
def test_T10_B5_Q14_두_글자_미만은_200_빈_목록(osaka, q):
    response = lodging(osaka, q)
    assert (response.status_code, response.json()) == (200, [])


def test_T10_B5_Q14_앞뒤_공백은_지우고_두_글자(osaka):
    response = lodging(osaka, "  호텔  ")
    assert response.status_code == 200 and len(response.json()) == 5


def test_T10_B5_Q13_숙소_검색_공급자_실패는_503_PROVIDER_UNAVAILABLE(osaka, monkeypatch):
    def broken(q):
        raise RuntimeError("공급자 실패 (테스트)")

    monkeypatch.setattr(osaka.app.state.places_provider, "search_lodging", broken)
    response = lodging(osaka, "호텔")
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


@pytest.mark.slow
def test_T10_B5_Q13_숙소_검색_3초_넘으면_503(osaka, monkeypatch):
    import time

    def slow(q):
        time.sleep(4)
        return []

    monkeypatch.setattr(osaka.app.state.places_provider, "search_lodging", slow)
    began = time.monotonic()
    response = lodging(osaka, "호텔")
    assert response.status_code == 503 and response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert time.monotonic() - began < 3.8


def test_T10_B5_고른_숙소는_place_id만_여행에_저장(osaka):
    hit = lodging(osaka, "호텔").json()[0]
    trip = osaka.make_trip(lodging=hit["place_id"])
    assert trip["lodging_place_id"] == hit["place_id"]
    assert not {"lodging_lat", "lodging_lng", "lodging", "lodging_location"} & set(trip)


# ---------- §K·§6 키 없음 = 가짜 공급자 + 경고 한 줄 ----------


def test_T10_K_키가_없으면_가짜_공급자로_켜지고_경고(monkeypatch, caplog):
    from api.main import app
    from places.provider import FakePlaces

    for name in ("AI_GATEWAY_API_KEY", "APP_ENV", "GOOGLE_PLACES_API_KEY", "SERPER_API_KEY", "PLACES_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    caplog.set_level(logging.WARNING)
    with TestClient(app):
        assert isinstance(app.state.places_provider, FakePlaces)
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert sum("가짜 장소 공급자 사용 중" in m for m in warnings) == 1  # §9 Q5: 경고 한 줄


def test_T10_Q5_가짜_모드로_켜도_경고_한_줄(monkeypatch, caplog):
    from api.main import app

    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    caplog.set_level(logging.WARNING)
    with TestClient(app):
        pass
    assert sum("가짜 장소 공급자 사용 중" in r.getMessage() for r in caplog.records) == 1


def test_T10_Q5_가짜_공급자의_영업시간_출처는_google(osaka):
    # §11 H3: Google 영업시간은 부르는 때(계획 세션 시작 등)에만 온다. 계획 후보에서 본다
    trip = osaka.make_trip(days=1, offset=10)
    session = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"}).json()
    first = session["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{session['session_id']}/answer", json={"choice_ids": [first]}).json()
    sources = {f["source_type"] for c in batch["candidates"] for f in c["place"]["facts"] if f["field"] == "opening_hours"}
    assert "google" in sources


def test_T10_Q11_가짜_모드는_팩을_메모리에서_만들고_파일을_쓰지_않는다(monkeypatch):
    from pathlib import Path

    from api.main import app

    server = Path(__file__).resolve().parents[1]
    watched = [server / "places" / "packs" / "osaka.json", server / ".cache" / "places" / "osaka.json"]
    before = {p: (p.exists(), p.stat().st_mtime_ns if p.exists() else None) for p in watched}
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    with TestClient(app) as client:
        assert client.get("/places/search", params={"city_code": "osaka", "q": "구로몬"}).json()
    assert {p: (p.exists(), p.stat().st_mtime_ns if p.exists() else None) for p in watched} == before


def test_T10_K_키_값은_로그에_찍지_않는다(monkeypatch, caplog):
    from api.main import app

    secret_google, secret_serper = "TEST-ONLY-GOOGLE-NOT-A-KEY-1234", "TEST-ONLY-SERPER-NOT-A-KEY-5678"
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", secret_google)
    monkeypatch.setenv("SERPER_API_KEY", secret_serper)
    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    caplog.set_level(logging.DEBUG)
    with TestClient(app) as client:
        client.get("/places/lodging-search", params={"city_code": "osaka", "q": "호텔"})
    for record in caplog.records:
        assert secret_google not in record.getMessage() and secret_serper not in record.getMessage()


# ---------- B6 날 상태 (매번 계산, 도시 시간대) ----------


@pytest.mark.parametrize(
    ("offset", "planned", "state"),
    [(-1, False, "past"), (-1, True, "past"), (0, True, "today"), (1, False, "planning"), (1, True, "planned")],
    ids=["어제_계획_전", "어제_계획_완료", "오늘_계획_완료", "내일_계획_전", "내일_계획_완료"],
)
def test_T10_B6_날_상태_네_가지(offset, planned, state):
    from trip.days import day_state

    assert day_state(TODAY + timedelta(days=offset), TODAY, planned) == state


def test_T10_B6_Q6_오늘인데_계획_전이어도_today():
    from trip.days import day_state

    assert day_state(TODAY, TODAY, False) == "today"


@given(gap=st.integers(min_value=-400, max_value=400), planned=st.booleans())
def test_T10_B6_속성_지난_날은_past_오늘은_today_앞날은_계획_여부대로(gap, planned):
    from trip.days import day_state

    found = day_state(TODAY + timedelta(days=gap), TODAY, planned)
    assert found == ("past" if gap < 0 else "today" if gap == 0 else "planned" if planned else "planning")


@pytest.mark.parametrize(
    ("now", "today"),
    [
        (datetime(2026, 11, 30, 14, 59, 59, tzinfo=UTC), date(2026, 11, 30)),
        (datetime(2026, 11, 30, 15, 0, 0, tzinfo=UTC), date(2026, 12, 1)),
        (datetime(2026, 12, 1, 0, 0, 0, tzinfo=UTC), date(2026, 12, 1)),
    ],
    ids=["JST_자정_1초_전", "JST_자정", "UTC_자정은_JST_9시"],
)
def test_T10_B6_AC5_도시_시간대_오늘(now, today):
    from trip.days import city_today

    assert city_today(now, "Asia/Tokyo") == today


def test_T10_B6_AC5_API_오늘부터_시작한_여행(osaka):
    osaka.make_trip(days=3, offset=0)
    trip = osaka.current().json()
    assert states(trip) == ["today", "planning", "planning"]  # §9 Q6
    assert trip["trip_days"][0]["chosen_option_id"] is None  # 앱은 이 값으로 계획 대화부터 (DESIGN-001 §4-9)


def test_T10_B6_AC5_자정이_지나면_다시_계산한다_저장하지_않는다(osaka):
    trip = osaka.make_trip(days=3, offset=0)
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    osaka.set_now(datetime(2026, 12, 1, 14, 59, 59, tzinfo=UTC))  # JST 12-01 23:59:59
    assert states(osaka.current().json()) == ["today", "planning", "planning"]
    osaka.set_now(datetime(2026, 12, 1, 15, 0, 0, tzinfo=UTC))  # JST 12-02 00:00
    assert states(osaka.current().json())[0] == "past"
    osaka.set_now(datetime(2026, 12, 4, 15, 0, 0, tzinfo=UTC))  # 여행 끝 다음 날
    assert states(osaka.current().json()) == ["past", "past", "past"]


def test_T10_B6_계획을_고르면_planned(osaka):
    trip = osaka.make_trip(days=2, offset=10)
    osaka.plan_and_select(trip["trip_days"][1]["day_id"])
    days = osaka.current().json()["trip_days"]
    assert [d["state"] for d in days] == ["planning", "planned"]
    assert days[0]["chosen_option_id"] is None and days[1]["chosen_option_id"]


# ---------- AC-8 만든 여행의 첫날 계획 대화에 오사카 장소 ----------


def test_T10_AC8_첫날_계획_대화_후보는_오사카_팩_장소(osaka):
    trip = osaka.make_trip(days=2, offset=10)
    day_id = trip["trip_days"][0]["day_id"]
    started = osaka.client.post(f"/days/{day_id}/planning", json={"mode": "conversation"})
    assert started.status_code == 201, started.text
    session = started.json()
    first = session["question"]["choices"][0]["id"]
    batch = osaka.client.post(f"/planning/{session['session_id']}/answer", json={"choice_ids": [first]})
    assert batch.status_code == 200, batch.text
    ids = {c["place"]["id"] for c in batch.json()["candidates"]}
    assert ids and ids <= PACK_IDS


def test_T10_AC8_꼭_갈_곳은_그날_코스에_들어간다(osaka):
    trip = osaka.make_trip(days=2, offset=10, must=[(0, "osaka-fake-kuromon")])
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    for option in started.json()["options"]:
        assert "osaka-fake-kuromon" in {item["place_id"] for item in option["items"]}
    other = osaka.client.post(f"/days/{trip['trip_days'][1]['day_id']}/planning", json={"mode": "auto"})
    assert other.status_code == 201, other.text


# ---------- §9 Q10 숙소가 없으면 시작점 = 도시 center, 끝은 마지막 장소 ----------


def test_T10_Q10_숙소가_없어도_계획이_된다_숙소로_돌아가기_없음(osaka):
    trip = osaka.make_trip(days=1, offset=10)
    assert trip["lodging_place_id"] is None
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    for option in started.json()["options"]:
        assert option["items"]
        assert option["go_home_min"] is None  # §10 Q27


def test_T10_Q10_하루_시각은_데모와_같은_기본값(osaka):
    trip = osaka.make_trip(days=1, offset=10)
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "conversation"})
    assert started.status_code == 201, started.text
    day = started.json()["day"]
    assert (day["start"], day["end"]) == ("10:00", "20:00")  # planning/seed.py DAY_START, DAY_END
