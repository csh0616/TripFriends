"""TASK-010 PM 답 (결정권자 전달, 11-09) Q1·Q2.
Q1: 여행 중 화면 카드(T-05 등)·코스 항목의 facts 출처는 장소 facts의 실제 source_type. 데모 여행은 그대로 demo.
Q2: Google resolve는 한 곳만(pageSize=1) 유지. 찾은 곳 좌표가 seed 지역(area) 중심에서 3km 밖이면 ambiguous로 빼고 보고.
    인증·요금 오류는 만들기 전체를 멈춘다. 일시 오류(5xx·시간 초과)는 한 번 다시 시도, 그래도 실패면 그 줄만 빼고 이유 provider_error.

계약 (이 테스트가 정한 것, 승인 대기):
    seed 맨 위 areas = {지역: {name_ko, query}} (center와 같은 방식: query로 resolve, 좌표는 캐시에만). 팩 areas = {지역: {name_ko, place_id}}
    거리는 지역 중심 좌표와 details 좌표 사이 (가짜 데이터: 梅田駅에서 2.9km = 넣음, 3.1km = 뺌, 약 4km = 뺌)
    인증·요금 오류 = Google 응답 상태 401·403·429 -> places.provider.ProviderAuthError (다시 시도하지 않음), build_pack 밖으로 그대로 나간다
    일시 오류 = 상태 500 이상 또는 httpx 시간 초과 -> 한 번 다시 시도, 그래도 실패면 places.provider.ProviderTransientError
"""

import json

import httpx
import pytest

from test_task010_places import EXCLUDED, FAKE_SEED, FakeClock, Recording, build, fake_places, seed_rows
from test_task010_trips import osaka  # noqa: F401 (픽스처)


# ---------- Q2 지역 중심 3km ----------


def test_T10_Q2_팩에_지역_중심은_이름과_place_id만_좌표는_캐시에():
    result = build()
    assert set(result.pack["areas"]) == {"namba", "shinsaibashi", "umeda"}
    for area in result.pack["areas"].values():
        assert set(area) == {"name_ko", "place_id"}
        assert "location" in result.cache[area["place_id"]]
    assert result.pack["areas"]["umeda"]["place_id"] == "FAKE-osaka-area-umeda"


@pytest.mark.parametrize(
    ("our_id", "kept"),
    [("osaka-fake-edge-in", True), ("osaka-fake-edge-out", False), ("osaka-fake-far-umeda", False)],
    ids=["중심에서_2_9km_넣음", "중심에서_3_1km_뺌", "다른_지역_약_4km_뺌"],
)
def test_T10_Q2_찾은_곳이_지역_중심에서_3km_밖이면_ambiguous로_빼고_보고(our_id, kept):
    result = build()
    in_pack = {row["id"] for row in result.pack["places"]}
    excluded = {row["id"]: row["reason"] for row in result.report["excluded"]}
    assert (our_id in in_pack) is kept
    if not kept:
        assert excluded[our_id] == "ambiguous"


def test_T10_Q2_원래_장소들은_모두_지역_중심_3km_안이라_그대로():
    result = build()
    assert {row["id"] for row in result.pack["places"]} == {row["id"] for row in seed_rows()} - set(EXCLUDED)


# ---------- Q2 GooglePlaces 오류 구분 (가짜 전송만) ----------


def google(handler):
    from places.provider import GooglePlaces

    return GooglePlaces("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler)))


def replies(*steps):
    """차례로 돌려줄 응답. 숫자 = 그 상태 코드(본문 없음), "timeout" = 시간 초과, dict = 200 본문."""
    sent: list[httpx.Request] = []
    queue = list(steps)

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        step = queue.pop(0) if queue else 500
        if step == "timeout":
            raise httpx.ReadTimeout("가짜 시간 초과", request=request)
        if isinstance(step, dict):
            return httpx.Response(200, json=step)
        return httpx.Response(step, json={})

    return handler, sent


FOUND = {"places": [{"id": "FAKE-google-one"}]}


@pytest.mark.parametrize("status", [401, 403, 429], ids=["401", "403", "429"])
def test_T10_Q2_인증_요금_오류는_ProviderAuthError_다시_시도하지_않는다(status):
    from places.provider import ProviderAuthError

    handler, sent = replies(status, FOUND)
    with pytest.raises(ProviderAuthError):
        google(handler).resolve("道頓堀 Osaka", "namba")
    assert len(sent) == 1


@pytest.mark.parametrize("first", [500, 503, "timeout"], ids=["500", "503", "시간_초과"])
def test_T10_Q2_일시_오류는_한_번_다시_시도해서_되면_그_값(first):
    handler, sent = replies(first, FOUND)
    assert google(handler).resolve("道頓堀 Osaka", "namba") == "FAKE-google-one"
    assert len(sent) == 2


@pytest.mark.parametrize("steps", [(500, 502), ("timeout", "timeout"), (503, "timeout")], ids=["5xx_두_번", "시간_초과_두_번", "섞임"])
def test_T10_Q2_다시_시도해도_실패면_ProviderTransientError(steps):
    from places.provider import ProviderTransientError

    handler, sent = replies(*steps)
    with pytest.raises(ProviderTransientError):
        google(handler).resolve("道頓堀 Osaka", "namba")
    assert len(sent) == 2


def test_T10_Q2_details도_일시_오류면_한_번_다시_시도():
    handler, sent = replies(503, {"id": "FAKE-google-one", "location": {"latitude": 34.6, "longitude": 135.5}, "businessStatus": "OPERATIONAL"})
    found = google(handler).details("FAKE-google-one")
    assert found["location"] == {"lat": 34.6, "lng": 135.5}
    assert len(sent) == 2


def test_T10_Q2_resolve는_한_곳만_받는다_pageSize_1():
    handler, sent = replies(FOUND)
    google(handler).resolve("道頓堀 Osaka", "namba")
    assert json.loads(sent[0].content)["pageSize"] == 1


# ---------- Q2 만들기에서의 처리 ----------


class Failing:
    """가짜 공급자 감싸기: 정한 query·place_id에서 정한 오류를 낸다."""

    def __init__(self, error_for: dict[str, type[Exception]]):
        self.inner = fake_places()
        self.error_for = error_for

    def resolve(self, query, area):
        if query in self.error_for:
            raise self.error_for[query]("가짜 오류 (테스트)")
        return self.inner.resolve(query, area)

    def details(self, place_id):
        if place_id in self.error_for:
            raise self.error_for[place_id]("가짜 오류 (테스트)")
        return self.inner.details(place_id)

    def search_lodging(self, q):
        return self.inner.search_lodging(q)


def test_T10_Q2_일시_오류가_남은_줄만_provider_error로_빼고_나머지는_만든다():
    from places.provider import ProviderTransientError

    result = build(places=Failing({"黒門市場 Osaka": ProviderTransientError, "FAKE-osaka-sky": ProviderTransientError}))
    excluded = {row["id"]: row["reason"] for row in result.report["excluded"]}
    assert excluded["osaka-fake-kuromon"] == "provider_error"  # resolve 실패
    assert excluded["osaka-fake-sky"] == "provider_error"  # details 실패
    assert result.report["stopped"] is False
    assert {row["id"] for row in result.pack["places"]} == {row["id"] for row in seed_rows()} - set(EXCLUDED) - {"osaka-fake-kuromon", "osaka-fake-sky"}


def test_T10_Q2_인증_요금_오류면_만들기_전체를_멈춘다():
    from places.provider import ProviderAuthError

    clock = FakeClock()
    places = Recording(Failing({"黒門市場 Osaka": ProviderAuthError}), clock)
    with pytest.raises(ProviderAuthError):
        build(places=places, clock=clock)
    after = [args for name, args, _ in places.calls if name == "resolve"]
    assert after[-1][0] == "黒門市場 Osaka"  # 그 뒤로는 부르지 않는다


def test_T10_Q2_명령은_인증_요금_오류면_0이_아닌_코드로_끝나고_파일을_쓰지_않는다(tmp_path, monkeypatch):
    import places.__main__ as command
    from places.provider import ProviderAuthError

    def broken(*args, **kwargs):
        raise ProviderAuthError("가짜 인증 오류 (테스트)")

    monkeypatch.setenv("PLACES_PROVIDER", "fake")
    monkeypatch.setattr("places.provider.FakePlaces.resolve", broken)

    code = command.main(["build", "osaka", "--seed", str(FAKE_SEED), "--pack-dir", str(tmp_path / "packs"), "--cache-dir", str(tmp_path / "cache")])
    assert code != 0
    assert not (tmp_path / "packs" / "osaka.json").exists() and not (tmp_path / "cache" / "osaka.json").exists()


# ---------- Q1 여행 중 화면 facts 출처 ----------


def sources_in(node) -> set[str]:
    if isinstance(node, dict):
        found = {node["source_type"]} if isinstance(node.get("source_type"), str) else set()
        return found | {s for v in node.values() for s in sources_in(v)}
    if isinstance(node, list):
        return {s for v in node for s in sources_in(v)}
    return set()


def test_T10_Q1_실제_여행의_여행_중_화면_facts는_장소의_실제_출처(osaka):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    view = osaka.client.get(f"/days/{day_id}/now", params={"at": "2026-12-01T10:00"})
    assert view.status_code == 200, view.text
    found = sources_in(view.json())
    assert found, "facts가 있다"
    assert "demo" not in found
    assert found <= {"google", "serper", "curated", "user", "estimate"}


def test_T10_Q1_실제_여행의_닫힘_확인_카드도_실제_출처(osaka):  # noqa: F811
    trip = osaka.make_trip(days=1, offset=0)
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    view = osaka.client.get(f"/days/{day_id}/now", params={"at": "2026-12-01T10:00"}).json()
    place_id = view["pins"][0]["place_id"]
    response = osaka.client.post(f"/places/{place_id}/visit-checks", json={"day_id": day_id, "at": "2026-12-01T10:00", "was_open": False})
    assert response.status_code == 200, response.text
    assert "demo" not in sources_in(response.json())


def test_T10_Q1_데모_여행은_그대로_demo(env):
    seeded = env.client.post("/debug/seed-demo", json={"chosen": True})
    assert seeded.status_code == 201, seeded.text
    day_id = seeded.json()["day"]["day_id"]
    view = env.client.get(f"/days/{day_id}/now", params={"at": "2026-12-02T10:00"})
    assert view.status_code == 200, view.text
    found = sources_in(view.json())
    assert "demo" in found and not found & {"google", "serper"}
