"""TASK-010 reviewer 결과에 대한 PM 답 (11-09, 결정권자 승인). 근거:
    3 지도 링크: place_id가 있으면 place_id로 (§11 H5), 데모 장소만 좌표 (TASK-006 A-1 T-02·TASK-008 A4는 데모 그대로)
    4 계획 시작 때 좌표 다시 부르기는 30일 지난 것만(§A5, §9 Q7 같으면 오래된 것)·상한 100(§12 답 5), 캐시가 살아 있으면 0회.
      영업시간은 그날 후보·상한 80 (§11 H3 ①·H6)
    작은 것: 가짜 숙소에 좌표 (testdata/cities/osaka-fake.json details) -> 숙소를 고른 흐름을 가짜 공급자로 재현 (§B5, §10 Q27)

계약 (이 테스트가 정한 것, 승인 대기):
    T-05 map_url (실제 여행) = places.pack.maps_url(Google place_id)  (§11 H5, 지금 코드에 있는 place_id 링크 그대로)
    T-02 map_url (실제 여행) = 구글 지도 길찾기(/maps/dir/, travelmode=transit, TASK-006) 이고 쿼리 값 하나가 그 장소의 Google place_id
    좌표 다시 부르기와 영업시간 부르기는 둘 다 provider.details를 쓴다 -> 후보가 아닌 도시 중심(center, 난바역)의 호출로 좌표 다시 부르기를 구분한다
"""

from collections import Counter
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from test_task010_places import FAKE
from test_task010_trips import NOON, osaka  # noqa: F401 (픽스처)

CENTER = "FAKE-osaka-center-station"  # 가짜 팩의 center (계획 후보가 아니다)


def google_id(osaka, our_id: str) -> str:  # noqa: F811
    return osaka.app.state.city.row(our_id)["place_id"]


def cards(view: dict) -> list[dict]:
    return [view["main"], *view["subs"]]


def views_through_day(osaka, day_id: str, day: str) -> list[dict]:  # noqa: F811
    """그날 09:00~21:00을 10분마다 여행 중 화면으로 본다."""
    found = []
    for minute in range(9 * 60, 21 * 60 + 1, 10):
        response = osaka.client.get(f"/days/{day_id}/now", params={"at": f"{day}T{minute // 60:02d}:{minute % 60:02d}"})
        assert response.status_code == 200, response.text
        found.append(response.json())
    return found


@pytest.fixture
def details_calls(osaka, monkeypatch):  # noqa: F811
    """가짜 공급자 details 호출 기록 (좌표·영업시간 모두 여기로 온다)."""
    calls: list[str] = []
    provider = osaka.app.state.places_provider
    real = provider.details

    def details(place_id):
        calls.append(place_id)
        return real(place_id)

    monkeypatch.setattr(provider, "details", details)
    return calls


# ---------- PM 답 3: 지도 링크는 place_id로 (§11 H5) ----------


@pytest.fixture
def today_with_unknown(osaka):  # noqa: F811
    """오늘(12-01) 여행. 영업시간을 모르는 곳(가짜 seed의 comedy: Google 없음 + Serper 엇갈림 = unknown)을 꼭 갈 곳으로."""
    trip = osaka.make_trip(days=1, offset=0, must=[(0, "osaka-fake-comedy")])
    day = trip["trip_days"][0]
    osaka.plan_and_select(day["day_id"])
    return day["day_id"], day["date"]


def test_T10_PM3_H5_실제_여행의_영업_확인_카드_지도_링크는_place_id로(osaka, today_with_unknown):  # noqa: F811
    from places.pack import maps_url

    day_id, day = today_with_unknown
    found = [c for v in views_through_day(osaka, day_id, day) for c in cards(v) if c["type"] == "T-05"]
    assert found, "모르는 곳을 꼭 갈 곳으로 넣었으니 그 장소 출발 30분 전부터 T-05가 나온다 (TASK-008 A1·A2)"
    for card in found:
        place = card["place"]["place_id"]
        assert card["map_url"] == maps_url(google_id(osaka, place)), card


def test_T10_PM3_H5_실제_여행의_다음_이동_카드_지도_링크는_place_id로(osaka, today_with_unknown):  # noqa: F811
    day_id, day = today_with_unknown
    found = [c for v in views_through_day(osaka, day_id, day) for c in cards(v) if c["type"] == "T-02" and c["next_item"]["place_id"]]
    assert found
    for card in found:
        url = urlparse(card["map_url"])
        assert (url.scheme, url.netloc, url.path) == ("https", "www.google.com", "/maps/dir/")  # TASK-006 A-1 길찾기
        query = parse_qs(url.query)
        assert query.get("travelmode") == ["transit"]
        values = {value for values in query.values() for value in values}
        assert google_id(osaka, card["next_item"]["place_id"]) in values, card["map_url"]


def test_T10_PM3_H5_place_id_링크에_좌표가_새지_않는다_영업_확인(osaka, today_with_unknown):  # noqa: F811
    day_id, day = today_with_unknown
    found = [c for v in views_through_day(osaka, day_id, day) for c in cards(v) if c["type"] == "T-05"]
    assert found
    for card in found:
        location = FAKE["details"][google_id(osaka, card["place"]["place_id"])]["location"]
        assert f"{location['lat']},{location['lng']}" not in card["map_url"]


# ---------- PM 답 4: 계획 시작 때 좌표 다시 부르기 ----------


def age_cache(osaka, place_id: str, age: timedelta) -> None:  # noqa: F811
    city = osaka.app.state.city
    city.cache[place_id] = {**city.cache[place_id], "fetched_at": (NOON - age).isoformat()}


def start_planning(osaka, trip: dict, index: int = 0) -> None:  # noqa: F811
    response = osaka.client.post(f"/days/{trip['trip_days'][index]['day_id']}/planning", json={"mode": "conversation"})
    assert response.status_code == 201, response.text


def test_T10_PM4_캐시가_살아_있으면_좌표_다시_부르기_0회(osaka, details_calls):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=10)
    for place_id in list(osaka.app.state.city.cache):
        age_cache(osaka, place_id, timedelta(days=1))
    details_calls.clear()
    start_planning(osaka, trip)
    assert CENTER not in details_calls
    assert all(n == 1 for n in Counter(details_calls).values()), Counter(details_calls)  # 영업시간만, 한 곳에 한 번
    assert len(details_calls) <= 80  # §11 H6


@pytest.mark.parametrize(
    ("age", "called"),
    [(timedelta(days=30), True), (timedelta(days=30) - timedelta(seconds=1), False), (timedelta(days=30) + timedelta(seconds=1), True)],
    ids=["정각_30일_부름", "30일_1초_전_안_부름", "30일_1초_뒤_부름"],
)
def test_T10_PM4_Q7_계획_시작_때_30일_지난_좌표만_부른다(osaka, details_calls, age, called):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=10)
    age_cache(osaka, CENTER, age)
    details_calls.clear()
    start_planning(osaka, trip)
    assert details_calls.count(CENTER) == (1 if called else 0)


def test_T10_PM4_오래된_것만_부르고_나머지_좌표는_다시_안_부른다(osaka, details_calls):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=10)
    city = osaka.app.state.city
    for place_id in list(city.cache):
        age_cache(osaka, place_id, timedelta(days=1))
    age_cache(osaka, CENTER, timedelta(days=31))
    details_calls.clear()
    start_planning(osaka, trip)
    assert details_calls.count(CENTER) == 1
    others = Counter(p for p in details_calls if p != CENTER)
    assert all(n == 1 for n in others.values()), others  # 살아 있는 좌표는 다시 부르지 않는다 (영업시간 한 번뿐)
    assert city.cache[CENTER]["fetched_at"] == NOON.isoformat()  # 받은 좌표는 지금 시각으로


def test_T10_PM4_한_번_다시_부른_좌표는_다음_계획_시작에_또_부르지_않는다(osaka, details_calls):  # noqa: F811
    trip = osaka.make_trip(days=2, offset=10)
    age_cache(osaka, CENTER, timedelta(days=31))
    start_planning(osaka, trip, 0)
    osaka.set_now(NOON + timedelta(hours=2))  # 영업시간 메모리(1시간)는 지났다
    details_calls.clear()
    start_planning(osaka, trip, 1)
    assert CENTER not in details_calls


# ---------- 작은 것: 가짜 숙소 좌표 (숙소를 고른 흐름) ----------


def test_T10_PM_가짜_숙소는_모두_details에_좌표가_있다():
    for hit in FAKE["lodging"]:
        location = FAKE["details"][hit["place_id"]]["location"]
        assert set(location) == {"lat", "lng"}


def test_T10_PM_B5_숙소를_고르면_좌표가_캐시에_들어가고_집으로_돌아가는_시간이_생긴다(osaka):  # noqa: F811
    hit = osaka.client.get("/places/lodging-search", params={"city_code": "osaka", "q": "호텔"}).json()[0]
    trip = osaka.make_trip(days=1, offset=10, lodging=hit["place_id"])
    assert osaka.app.state.city.cache[hit["place_id"]]["location"] == FAKE["details"][hit["place_id"]]["location"]
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    for option in started.json()["options"]:
        assert isinstance(option["go_home_min"], int) and option["go_home_min"] >= 0  # §10 Q27: 숙소가 있으면 null이 아니다
