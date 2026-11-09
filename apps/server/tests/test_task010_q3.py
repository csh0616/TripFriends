"""TASK-010 PM 답 Q3: 돌연변이 보강. 문서에 있는 규칙만 시험한다 (새 규칙을 만들지 않는다).
근거: §A5(캐시를 읽고 쓰기)·§A7(요청 간격 0.1초)·§A3(Serper 결과 링크, 문장은 값만)·§B2(기기마다 따로)·§B3(고정 일정)·§9 Q13(detail.field)·Q15,
DATA-001 A(fixed_events는 재조합 때 절대 지킴), §11 H3(②오늘 일정 장소 ③닫힌 곳 1.5km 안 후보), API-001 §1(오류 형식), TASK-003 §10 Q24(404 = NOT_FOUND).
오류 문장(message)은 고정하지 않는다. 실제 네트워크는 쓰지 않는다 (가짜 전송).
"""

import json
import math
from datetime import timedelta

import httpx
import pytest

from test_task010_places import NOW, FakeClock, Recording, build, fake_places
from auth_helpers import bearer
from test_task010_trips import DEVICE, NOON, at, osaka  # noqa: F401 (픽스처)

# ---------- ① 캐시 파일 읽고 쓰기 (§A5) ----------


def test_T10_Q3_캐시_저장하고_다시_읽으면_같다(tmp_path):
    from places.cache import load_cache, save_cache

    cache = build().cache
    path = tmp_path / "깊은" / "폴더" / "osaka.json"  # 없는 폴더도 만든다
    save_cache(path, cache)
    assert path.is_file()
    assert load_cache(path) == cache


def test_T10_Q3_캐시_파일이_없으면_빈_캐시(tmp_path):
    from places.cache import load_cache

    assert load_cache(tmp_path / "없음.json") == {}


def test_T10_Q3_H1_저장한_파일에도_좌표_fetched_at_Serper_값만(tmp_path):
    from places.cache import save_cache

    path = tmp_path / "osaka.json"
    save_cache(path, build().cache)
    for entry in json.loads(path.read_text(encoding="utf-8")).values():
        assert set(entry) <= {"location", "fetched_at", "serper"}


def test_T10_Q3_A7_좌표_다시_부르기도_요청_간격_0_1초_이상():
    from places.cache import refresh

    result = build()
    clock = FakeClock()
    provider = Recording(fake_places(), clock)
    ids = list(result.cache)[:5]
    refresh(result.cache, ids, provider, now=NOW + timedelta(days=31), clock=clock.time, sleep=clock.sleep)
    times = [t for _, _, t in provider.calls]
    assert len(times) == 5
    assert min(b - a for a, b in zip(times, times[1:])) >= 0.1 - 1e-9


# ---------- ② Serper 가짜 전송 (§A3) ----------


def serper_with(body: dict, status: int = 200):
    from places.serper import SerperSearch

    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(status, json=body)

    return SerperSearch("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler))), sent


ORGANIC = {
    "organic": [
        {"title": "【テスト用の作り話】路地カフェ", "snippet": "営業時間 10:00～19:00", "link": "https://example.invalid/serper/a"},
        {"title": "【テスト用の作り話】別の記事", "snippet": "定休日：火曜日", "link": "https://example.invalid/serper/b"},
    ]
}


def test_T10_Q3_Serper_결과마다_문장과_링크():
    search, _ = serper_with(ORGANIC)
    hits = search.search("なんば 路地カフェ Osaka 営業時間")
    assert [hit["link"] for hit in hits] == ["https://example.invalid/serper/a", "https://example.invalid/serper/b"]
    assert "10:00～19:00" in hits[0]["text"] and "定休日" in hits[1]["text"]
    assert all(set(hit) == {"text", "link"} for hit in hits)


def test_T10_Q3_Serper_결과가_없으면_빈_목록():
    search, _ = serper_with({})
    assert search.search("없는 곳 営業時間") == []


def test_T10_Q3_Serper에_보내는_검색어는_그대로_키는_주소에_없다():
    search, sent = serper_with(ORGANIC)
    search.search("なんば 路地カフェ Osaka 営業時間")
    assert len(sent) == 1
    assert "なんば 路地カフェ Osaka 営業時間" in json.dumps(json.loads(sent[0].content), ensure_ascii=False)
    assert "TEST-ONLY-NOT-A-KEY" not in str(sent[0].url)  # 키는 로그에 남기 쉬운 주소에 싣지 않는다 (§8)


def test_T10_Q3_A3_Serper_결과로_뽑은_값():
    from places.serper import extract_closed_days, extract_hours

    search, _ = serper_with(ORGANIC)
    texts = [hit["text"] for hit in search.search("q")]
    assert extract_hours(texts) == [("10:00", "19:00")]
    assert extract_closed_days(texts) == [1]


# ---------- ③ trips 오류: 상태·code·detail.field (문장은 고정하지 않음) ----------


def error_of(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code and error["message"]
    return error


def test_T10_Q3_B2_다른_기기의_여행은_GET도_404_NOT_FOUND(osaka):  # noqa: F811
    trip = osaka.make_trip()
    error_of(osaka.trip(trip["trip_id"], device="device-B"), 404, "NOT_FOUND")
    error_of(osaka.trip("없는_여행"), 404, "NOT_FOUND")


def test_T10_Q3_B2_여행이_없을_때_current는_404_NOT_FOUND(osaka):  # noqa: F811
    error_of(osaka.current(), 404, "NOT_FOUND")


def test_T10_Q3_B2_다른_기기의_여행에는_고정_일정을_넣을_수_없다(osaka):  # noqa: F811
    trip = osaka.make_trip()
    day = trip["trip_days"][0]
    body = {"trip_day_id": day["day_id"], "title": "남의 여행", "start_at": at(day["date"], "12:00"), "end_at": at(day["date"], "13:00")}
    error_of(osaka.client.post(f"/trips/{trip['trip_id']}/fixed-events", json=body, headers=bearer("device-B")), 404, "NOT_FOUND")
    assert osaka.trip(trip["trip_id"]).json()["trip_days"][0]["fixed_events"] == []


def test_T10_Q3_B2_다른_기기는_고정_일정을_지울_수_없다(osaka):  # noqa: F811
    trip = osaka.make_trip()
    made = osaka.add_fixed(trip, 0, "12:00", "13:00").json()
    error_of(osaka.client.delete(f"/fixed-events/{made['fixed_event_id']}", headers=bearer("device-B")), 404, "NOT_FOUND")
    assert len(osaka.trip(trip["trip_id"]).json()["trip_days"][0]["fixed_events"]) == 1


@pytest.mark.parametrize(
    ("body_of", "field"),
    [
        (lambda b: {**b, "city_code": "tokyo"}, "city_code"),
        (lambda b: {**b, "end_date": "2026-12-30"}, "end_date"),  # 12-11부터 20일
        (lambda b: {**b, "start_date": "2026-11-30", "end_date": "2026-11-30"}, "start_date"),  # 어제
        (lambda b: {**b, "must_visits": [{"date": b["start_date"], "place_id": "없는_장소"}]}, "must_visits"),
    ],
    ids=["도시", "기간", "시작일", "꼭_갈_곳"],
)
def test_T10_Q3_Q13_Q30_여행_만들기_400의_detail_field는_틀린_칸_하나(osaka, body_of, field):  # noqa: F811
    from test_task010_trips import trip_body

    error = error_of(osaka.post_trip(body_of(trip_body())), 400, "VALIDATION_ERROR")
    assert error["detail"] == {"field": field}


def test_T12_B2_토큰이_없으면_400이_아니라_401(osaka):  # noqa: F811
    # TASK-012 B2로 바뀜 (이전: TASK-010 §9 Q16 기기 ID가 없으면 400 detail.field = X-Device-Id)
    response = osaka.anon.get("/trips/current")
    assert response.status_code == 401, response.text
    assert response.json()["error"]["message"]


def test_T10_Q3_Q29_고정_일정_제목_400의_detail_field는_title(osaka):  # noqa: F811
    error = error_of(osaka.add_fixed(osaka.make_trip(), 0, "12:00", "13:00", title="   "), 400, "VALIDATION_ERROR")
    assert error["detail"]["field"] == "title"


@pytest.mark.parametrize("method", ["add", "delete"])
def test_T10_Q3_B3_PLAN_EXISTS의_상태와_code(osaka, method):  # noqa: F811
    trip = osaka.make_trip()
    made = osaka.add_fixed(trip, 0, "12:00", "13:00").json()
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    if method == "add":
        response = osaka.add_fixed(trip, 0, "18:00", "19:00")
    else:
        response = osaka.client.delete(f"/fixed-events/{made['fixed_event_id']}", headers=bearer(DEVICE))
    error_of(response, 409, "PLAN_EXISTS")


# ---------- B3 고정 일정은 계획에서 지킨다 (DATA-001 A) ----------


def fixed_items(osaka, day_id: str) -> list[tuple[str, str]]:  # noqa: F811
    started = osaka.client.post(f"/days/{day_id}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    found = {(item["start"], item["end"]) for option in started.json()["options"] for item in option["items"] if item["is_fixed"]}
    return sorted(found)


def test_T10_Q3_B3_넣은_고정_일정은_그날_코스에_그_시각_그대로(osaka):  # noqa: F811
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "12:00", "13:00").status_code == 201
    assert fixed_items(osaka, trip["trip_days"][0]["day_id"]) == [("12:00", "13:00")]
    assert fixed_items(osaka, trip["trip_days"][1]["day_id"]) == []  # 다른 날에는 없다


def test_T10_Q3_B3_Q15_다른_시간대로_적어도_도시_시각으로_지킨다(osaka):  # noqa: F811
    trip = osaka.make_trip()
    day = trip["trip_days"][0]
    body = {"trip_day_id": day["day_id"], "title": "UTC로 적음", "start_at": f"{day['date']}T03:00:00+00:00", "end_at": f"{day['date']}T04:00:00+00:00"}
    assert osaka.client.post(f"/trips/{trip['trip_id']}/fixed-events", json=body, headers=bearer(DEVICE)).status_code == 201
    assert fixed_items(osaka, day["day_id"]) == [("12:00", "13:00")]  # UTC 03:00 = 도쿄 12:00


def test_T10_Q3_B3_지운_고정_일정은_코스에서도_빠진다(osaka):  # noqa: F811
    trip = osaka.make_trip()
    made = osaka.add_fixed(trip, 0, "12:00", "13:00").json()
    assert osaka.client.delete(f"/fixed-events/{made['fixed_event_id']}", headers=bearer(DEVICE)).status_code == 204
    assert fixed_items(osaka, trip["trip_days"][0]["day_id"]) == []


def test_T10_Q3_B3_고정_일정_두_개는_시각_순서대로(osaka):  # noqa: F811
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "17:00", "18:00", title="둘째").status_code == 201
    assert osaka.add_fixed(trip, 0, "11:00", "12:00", title="첫째").status_code == 201
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"}).json()
    for option in started["options"]:
        assert [(i["start"], i["end"]) for i in option["items"] if i["is_fixed"]] == [("11:00", "12:00"), ("17:00", "18:00")]


# ---------- §11 H3 부르는 곳의 범위 ----------


def haversine_m(a: dict, b: dict) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * 1000 * math.asin(math.sqrt(h))


@pytest.fixture
def details_calls(osaka, monkeypatch):  # noqa: F811
    calls: list[str] = []
    provider = osaka.app.state.places_provider
    real = provider.details

    def details(place_id):
        calls.append(place_id)
        return real(place_id)

    monkeypatch.setattr(provider, "details", details)
    return calls


def test_T10_Q3_H3_3_닫힘_대안은_닫힌_곳에서_1_5km_안_후보만_부른다(osaka, details_calls):  # noqa: F811
    from test_task010_places import FAKE

    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    view = osaka.client.get(f"/days/{day_id}/now", params={"at": "2026-12-01T10:00"}).json()
    closed = view["pins"][0]["place_id"]
    osaka.set_now(NOON + timedelta(hours=1))
    details_calls.clear()
    response = osaka.client.post(f"/places/{closed}/visit-checks", json={"day_id": day_id, "at": "2026-12-01T10:00", "was_open": False})
    assert response.status_code == 200, response.text
    center = FAKE["details"][closed.replace("osaka-fake-", "FAKE-osaka-")]["location"]
    assert details_calls
    for place_id in details_calls:
        assert haversine_m(center, FAKE["details"][place_id]["location"]) <= 1500.0, place_id
        assert place_id != closed.replace("osaka-fake-", "FAKE-osaka-")


def test_T10_Q3_H3_2_여행_중_화면은_고정_일정_장소도_부른다(osaka, details_calls):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    assert osaka.add_fixed(trip, 0, "18:00", "19:00", place_id="osaka-fake-izakaya").status_code == 201
    osaka.plan_and_select(day_id)
    osaka.set_now(NOON + timedelta(hours=1))
    details_calls.clear()
    assert osaka.client.get(f"/days/{day_id}/now", params={"at": "2026-12-01T13:00"}).status_code == 200
    assert "FAKE-osaka-izakaya" in details_calls
