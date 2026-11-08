"""TASK-010 v1.4 §12 (서버). 근거: §12 오사카 목록·답 1~5, §S, ADR-015 §3-1, API-001 §1(ISO 8601 시간대 포함), TASK-003 §10 Q24(404 = NOT_FOUND).

계약 (이 테스트가 정한 이름, 승인 대기):
    GooglePlaces(api_key, client=..., sleep=...)  429면 sleep(1)·sleep(2)·sleep(4) 뒤 다시 (3번까지), 그래도 429면 ProviderAuthError(멈춤)
    GET /days/{day_id}/course (헤더 X-Device-Id) -> 200 고른 코스안 (POST /days/{id}/planning auto 응답의 options 한 칸과 같은 모양·값) | 404 NOT_FOUND
    places.cache.refresh 한 번에 Google 100회까지 (§12 답 5: 서버 시작 때 좌표 다시 부르기 상한)
"""

import json
from collections import Counter
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
import yaml

from test_task010_places import NOW, SEED_KEYS, CATEGORIES, GOOGLE_KEYS, FakeClock, Recording, Synthetic, SyntheticSerper, build, synthetic_rows
from test_task010_trips import DEVICE, at, osaka  # noqa: F401 (픽스처)

REPO = next(d for d in Path(__file__).resolve().parents if (d / "docs" / "tasks").is_dir())
SEED = REPO / "docs" / "data" / "osaka-seed.yaml"  # 정본 (읽기만)


# ---------- 정본 오사카 목록 (§12, §S) ----------


@pytest.fixture(scope="module")
def raw():
    return yaml.safe_load(SEED.read_text(encoding="utf-8"))


def test_T10_S12_정본_목록은_58곳_지역_4곳_카테고리_8종(raw):
    places = raw["places"]
    assert len(places) == 58
    assert [a["id"] for a in raw["areas"]] == ["namba", "shinsaibashi", "umeda", "osakajo"]
    assert Counter(p["area"] for p in places) == {"namba": 21, "shinsaibashi": 11, "umeda": 21, "osakajo": 5}
    assert {p["category"] for p in places} == CATEGORIES


def test_T10_S12_정본_목록의_줄은_S_모양이고_id는_겹치지_않는다(raw):
    ids = [p["id"] for p in raw["places"]]
    assert len(ids) == len(set(ids))
    areas = {a["id"] for a in raw["areas"]}
    for row in raw["places"]:
        assert set(row) == SEED_KEYS, row["id"]
        assert row["area"] in areas and row["category"] in CATEGORIES
        assert row["stay"]["min"] <= row["stay"]["typical"] <= row["stay"]["max"], row["id"]
        assert 1 <= row["crowd_level"] <= 5 and 1 <= row["price_level"] <= 4, row["id"]
        assert row["query"].strip() and isinstance(row["aliases"], list)


def test_T10_S12_정본_목록_머리는_center와_areas(raw):
    assert (raw["city_code"], raw["timezone"]) == ("osaka", "Asia/Tokyo")
    assert set(raw["center"]) == {"name_ko", "query"}
    assert all(set(a) == {"id", "name_ko", "query"} for a in raw["areas"])


def test_T10_S12_AC2_정본_목록에_Google_값이_없다(raw):
    def keys(node):
        if isinstance(node, dict):
            return set(node) | {k for v in node.values() for k in keys(v)}
        if isinstance(node, list):
            return {k for v in node for k in keys(v)}
        return set()

    assert not keys(raw) & (GOOGLE_KEYS | {"place_id"})


def test_T10_S12_서버의_seed_읽기가_정본_4지역_목록을_받는다():
    from places.seed import load_seed

    data = load_seed(SEED)
    assert len(data["places"]) == 58
    assert {a["id"] for a in data["areas"]} == {"namba", "shinsaibashi", "umeda", "osakajo"}


# ---------- §12 답 2: 429는 1·2·4초 기다려 3번까지 다시, 403은 바로 멈춤 ----------


FOUND = {"places": [{"id": "FAKE-google-one"}]}


def google_with(*steps):
    from places.provider import GooglePlaces

    sent: list[httpx.Request] = []
    queue = list(steps)
    waits: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        step = queue.pop(0)
        return httpx.Response(200, json=step) if isinstance(step, dict) else httpx.Response(step, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return GooglePlaces("TEST-ONLY-NOT-A-KEY", client=client, sleep=waits.append), sent, waits


@pytest.mark.parametrize(
    ("steps", "waits"),
    [((429, FOUND), [1]), ((429, 429, FOUND), [1, 2]), ((429, 429, 429, FOUND), [1, 2, 4])],
    ids=["한_번_뒤", "두_번_뒤", "세_번_뒤"],
)
def test_T10_S12_429는_1_2_4초_기다려_다시_시도해서_되면_그_값(steps, waits):
    provider, sent, slept = google_with(*steps)
    assert provider.resolve("Dotonbori Osaka", "namba") == "FAKE-google-one"
    assert slept == waits and len(sent) == len(steps)


def test_T10_S12_429가_3번_다시_시도해도_계속이면_멈춘다():
    from places.provider import ProviderAuthError

    provider, sent, slept = google_with(429, 429, 429, 429, FOUND)
    with pytest.raises(ProviderAuthError):
        provider.resolve("Dotonbori Osaka", "namba")
    assert slept == [1, 2, 4] and len(sent) == 4


def test_T10_S12_403은_기다리지_않고_바로_멈춘다():
    from places.provider import ProviderAuthError

    provider, sent, slept = google_with(403, FOUND)
    with pytest.raises(ProviderAuthError):
        provider.resolve("Dotonbori Osaka", "namba")
    assert slept == [] and len(sent) == 1


def test_T10_S12_429_뒤_details도_같은_규칙():
    provider, sent, slept = google_with(429, {"id": "FAKE-google-one", "location": {"latitude": 34.6, "longitude": 135.5}, "businessStatus": "OPERATIONAL"})
    assert provider.details("FAKE-google-one")["location"] == {"lat": 34.6, "lng": 135.5}
    assert slept == [1] and len(sent) == 2


# ---------- §12 답 5: 서버 시작 때 좌표 다시 부르기 상한 100 ----------


@pytest.mark.parametrize(("count", "stopped"), [(100, False), (101, True)], ids=["100곳_딱", "101곳"])
def test_T10_S12_좌표_다시_부르기는_한_번에_100회까지(count, stopped):
    from places.cache import refresh

    result = build(rows=synthetic_rows(count), places=Synthetic(), serper=SyntheticSerper())
    ids = [row["place_id"] for row in result.pack["places"]]
    assert len(ids) == count
    clock = FakeClock()
    provider = Recording(Synthetic(), clock)
    _, report = refresh(result.cache, ids, provider, now=NOW + timedelta(days=31), clock=clock.time, sleep=clock.sleep)
    assert len(provider.calls) <= 100
    assert report["stopped"] is stopped
    assert report["calls"]["google"] == len(provider.calls)


# ---------- §12 답 3: GET /days/{day_id}/course ----------


def course_of(osaka, day_id: str, device: str = DEVICE):  # noqa: F811
    return osaka.client.get(f"/days/{day_id}/course", headers={"X-Device-Id": device})


def not_found(response) -> None:
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_T10_S12_고른_코스는_코스안_카드와_같은_모양_같은_값(osaka):  # noqa: F811
    trip = osaka.make_trip()
    day_id = trip["trip_days"][0]["day_id"]
    started = osaka.client.post(f"/days/{day_id}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    option = started.json()["options"][-1]
    assert osaka.client.post(f"/course-options/{option['option_id']}/select").status_code == 200
    response = course_of(osaka, day_id)
    assert response.status_code == 200, response.text
    assert response.json() == option


def test_T10_S12_코스를_고르지_않은_날은_404(osaka):  # noqa: F811
    trip = osaka.make_trip()
    not_found(course_of(osaka, trip["trip_days"][0]["day_id"]))


def test_T10_S12_다른_기기의_날과_없는_날은_404(osaka):  # noqa: F811
    trip = osaka.make_trip()
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    not_found(course_of(osaka, day_id, device="device-B"))
    not_found(course_of(osaka, "없는_날"))


def test_T10_S12_지난_날도_고른_코스를_읽는다(osaka):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    osaka.set_now(osaka.app.state.clock() + timedelta(days=2))
    assert osaka.current().json()["trip_days"][0]["state"] == "past"
    assert course_of(osaka, day_id).status_code == 200


# ---------- §12 답 4: 고정 일정 ----------


def post_fixed(osaka, trip_id: str, body: dict, device: str = DEVICE):  # noqa: F811
    return osaka.client.post(f"/trips/{trip_id}/fixed-events", json=body, headers={"X-Device-Id": device})


def test_T10_S12_팩에_없는_place_id는_400_place_id(osaka):  # noqa: F811
    for place_id in ("없는_장소", "D01", "osaka-fake-closed-shop"):
        response = osaka.add_fixed(osaka.make_trip(), 0, "12:00", "13:00", place_id=place_id)
        assert response.status_code == 400, response.text
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR" and error["detail"]["field"] == "place_id"


def test_T10_S12_팩에_있는_place_id는_된다(osaka):  # noqa: F811
    assert osaka.add_fixed(osaka.make_trip(), 0, "12:00", "13:00", place_id="osaka-fake-kuromon").status_code == 201


def test_T10_S12_다른_여행의_날로는_404(osaka):  # noqa: F811
    first = osaka.make_trip(offset=10)
    second = osaka.make_trip(offset=20)  # 같은 기기의 다른 여행 (first는 보관됨)
    day = second["trip_days"][0]
    body = {"trip_day_id": day["day_id"], "title": "섞인 날", "start_at": at(day["date"], "12:00"), "end_at": at(day["date"], "13:00")}
    not_found(post_fixed(osaka, first["trip_id"], body))


@pytest.mark.parametrize(
    ("start", "end", "field"),
    [("12:00:00", "13:00:00+09:00", "start_at"), ("12:00:00+09:00", "13:00:00", "end_at")],
    ids=["시작에_시간대_없음", "끝에_시간대_없음"],
)
def test_T10_S12_시간대_없는_시각은_400(osaka, start, end, field):  # noqa: F811
    trip = osaka.make_trip()
    day = trip["trip_days"][0]
    body = {"trip_day_id": day["day_id"], "title": "시간대 없음", "start_at": f"{day['date']}T{start}", "end_at": f"{day['date']}T{end}"}
    response = post_fixed(osaka, trip["trip_id"], body)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR" and error["detail"]["field"] == field
