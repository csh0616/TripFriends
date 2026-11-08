"""TASK-010 §A 도시 데이터. 근거: TASK-010 §A1~§A8·§S·§6·§7 AC-1·AC-2·AC-3·§8, ADR-015 §3-1~§3-3.

테스트는 실제 Google·Serper를 부르지 않는다 (AC-1, conftest의 네트워크 차단). 공급자는 손으로 만든 가짜뿐:
    testdata/cities/osaka-fake.json      가짜 공급자 응답 (place_id는 모두 FAKE-, 링크는 example.invalid)
    testdata/cities/osaka-seed-fake.yaml 가짜 seed (§S 모양, 17줄: 지역 3곳·카테고리 8종 + 일부러 넣은 실패 4줄)

계약 (이 테스트가 정한 이름, 승인 대기):
    places/provider.py  PlacesProvider(ABC): resolve(query, area) -> place_id | ResolveError(reason="not_found"|"ambiguous")
                        details(place_id) -> {location{lat,lng}, opening_hours([{weekday,open,close}]|None), website, maps_url,
                                              business_status("OPERATIONAL"|"CLOSED_TEMPORARILY"|"CLOSED_PERMANENTLY")}
                        search_lodging(q) -> [{place_id, name, address_short}]
                        FakePlaces(path) · GooglePlaces(api_key, client: httpx.Client)
    places/serper.py    extract_hours(texts) -> ("HH:MM", "HH:MM") | None · FakeSerper(path).search(q) -> [{text, link}]
    places/seed.py      load_seed(path) -> [row]
    places/build.py     build_city(city_code, rows, places, serper, *, now, clock, sleep) -> BuildResult(pack, cache, report)
                        pack = {city_code, timezone, places: [seed 줄 + place_id]} · cache = {place_id: {..., fetched_at(ISO)}}
                        report = {excluded: [{id, reason}], calls: {google, serper}, stopped: bool}
                        reason: not_found · ambiguous · closed_permanently
    places/cache.py     is_stale(entry, "location"|"opening_hours", now) · refresh(cache, place_ids, provider, *, now, clock, sleep)
                        -> (새 캐시, {calls: {google}, failed: [place_id], stopped})
    places/pack.py      facts_for(row, entry) -> [{field, value, status, source_type, source_url, checked_at}]
                        engine_places(pack, cache) -> {우리 id: engine.models.Place}
"""

import json
import logging
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from engine.models import Place

REPO = next(d for d in Path(__file__).resolve().parents if (d / "testdata" / "cities" / "osaka-fake.json").is_file())
FAKE_JSON = REPO / "testdata" / "cities" / "osaka-fake.json"
FAKE_SEED = REPO / "testdata" / "cities" / "osaka-seed-fake.yaml"
FAKE = json.loads(FAKE_JSON.read_text(encoding="utf-8"))

NOW = datetime(2026, 11, 10, 3, 0, tzinfo=UTC)
CATEGORIES = {"cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"}
AREAS = {"namba", "shinsaibashi", "umeda"}
SEED_KEYS = {"id", "name_ko", "aliases", "query", "area", "category", "stay", "crowd_level", "price_level", "mood_tags"}
# Google에서 온 값 (ADR-015 §3-1: 캐시만, git 밖)
GOOGLE_KEYS = {"location", "lat", "lng", "opening_hours", "hours", "website", "maps_url", "business_status", "fetched_at"}
SOURCE_TYPES = {"google", "serper", "user", "curated", "demo"}  # ADR-015 §3-5
EXCLUDED = {
    "osaka-fake-not-found": "not_found",
    "osaka-fake-ambiguous": "ambiguous",
    "osaka-fake-closed-shop": "closed_permanently",
}
NO_GOOGLE_HOURS = ["osaka-fake-dotonbori", "osaka-fake-alley-cafe", "osaka-fake-comedy", "osaka-fake-amemura"]
SNIPPET_MARK = "作り話"  # 가짜 Serper 문장마다 들어 있는 낱말 (문장이 어딘가 남았는지 찾는 표시)


# ---------- 도우미 ----------


class FakeClock:
    """sleep만큼만 시간이 간다. 실제로 기다리지 않는다."""

    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += max(0.0, seconds)


class Recording:
    """공급자 감싸기: 부른 이름·인자·시각을 적는다."""

    def __init__(self, inner, clock: FakeClock):
        self.inner, self.clock = inner, clock
        self.calls: list[tuple[str, tuple, float]] = []

    def _call(self, name, *args):
        self.calls.append((name, args, self.clock.time()))
        return getattr(self.inner, name)(*args)

    def resolve(self, query, area):
        return self._call("resolve", query, area)

    def details(self, place_id):
        return self._call("details", place_id)

    def search_lodging(self, q):
        return self._call("search_lodging", q)

    def search(self, q):
        return self._call("search", q)

    def names(self, name: str) -> list[tuple]:
        return [args for called, args, _ in self.calls if called == name]


def fake_places():
    from places.provider import FakePlaces

    return FakePlaces(FAKE_JSON)


def fake_serper():
    from places.serper import FakeSerper

    return FakeSerper(FAKE_JSON)


def seed_rows() -> list[dict]:
    from places.seed import load_seed

    return load_seed(FAKE_SEED)


def build(rows=None, places=None, serper=None, clock: FakeClock | None = None, now: datetime = NOW):
    from places.build import build_city

    clock = clock or FakeClock()
    return build_city(
        "osaka",
        seed_rows() if rows is None else rows,
        places or fake_places(),
        serper or fake_serper(),
        now=now,
        clock=clock.time,
        sleep=clock.sleep,
    )


def row_of(pack: dict, our_id: str) -> dict:
    return next(row for row in pack["places"] if row["id"] == our_id)


def hours_fact(row: dict, entry: dict | None) -> dict:
    from places.pack import facts_for

    return next(f for f in facts_for(row, entry) if f["field"] == "opening_hours")


def keys_anywhere(node) -> set[str]:
    if isinstance(node, dict):
        return set(node) | {k for v in node.values() for k in keys_anywhere(v)}
    if isinstance(node, list):
        return {k for v in node for k in keys_anywhere(v)}
    return set()


# ---------- 가짜 데이터 자체 (AC-2: 테스트 데이터도 손으로 만든 가짜) ----------


def test_T10_AC2_가짜_공급자_데이터는_모두_지어낸_값이다():
    ids = set(FAKE["details"]) | {pid for found in FAKE["resolve"].values() for pid in found} | {h["place_id"] for h in FAKE["lodging"]}
    assert ids and all(pid.startswith("FAKE-") for pid in ids)
    links = [d["website"] for d in FAKE["details"].values() if d["website"]] + [d["maps_url"] for d in FAKE["details"].values()]
    links += [hit["link"] for hits in FAKE["serper"].values() for hit in hits]
    assert links and all(httpx.URL(link).host.endswith("example.invalid") for link in links)
    assert all(SNIPPET_MARK in hit["text"] for hits in FAKE["serper"].values() for hit in hits)


def test_T10_S_가짜_seed는_지역_3곳_카테고리_8종을_모두_담는다():
    rows = seed_rows()
    assert {row["area"] for row in rows} == AREAS
    assert {row["category"] for row in rows} == CATEGORIES
    for row in rows:
        assert set(row) == SEED_KEYS, row["id"]
        assert set(row["stay"]) == {"min", "typical", "max"}
        assert 1 <= row["crowd_level"] <= 5 and 1 <= row["price_level"] <= 4


# ---------- A1 공급자 인터페이스 ----------


def test_T10_A1_가짜_공급자는_PlacesProvider다():
    from places.provider import FakePlaces, GooglePlaces, PlacesProvider

    assert issubclass(FakePlaces, PlacesProvider) and issubclass(GooglePlaces, PlacesProvider)
    assert isinstance(fake_places(), PlacesProvider)


def test_T10_A1_resolve_한_곳이면_place_id():
    assert fake_places().resolve("道頓堀 Osaka", "namba") == "FAKE-osaka-dotonbori"


@pytest.mark.parametrize(
    ("query", "area", "reason"),
    [("存在しない食堂 Osaka", "namba", "not_found"), ("梅田 よくある食堂 Osaka", "umeda", "ambiguous")],
    ids=["0곳", "여러_곳"],
)
def test_T10_A1_resolve_0곳_여러_곳이면_ResolveError(query, area, reason):
    from places.provider import ResolveError

    with pytest.raises(ResolveError) as caught:
        fake_places().resolve(query, area)
    assert caught.value.reason == reason


def test_T10_A1_details는_다섯_값만():
    found = fake_places().details("FAKE-osaka-kuromon")
    assert set(found) == {"location", "opening_hours", "website", "maps_url", "business_status"}
    assert set(found["location"]) == {"lat", "lng"}
    assert found["opening_hours"][0] == {"weekday": 0, "open": "09:00", "close": "18:00"}


def test_T10_A1_details_영업시간_없음은_None():
    assert fake_places().details("FAKE-osaka-dotonbori")["opening_hours"] is None


def test_T10_A1_숙소_검색은_place_id_이름_짧은_주소():
    found = fake_places().search_lodging("호텔")
    assert found
    for hit in found:
        assert set(hit) == {"place_id", "name", "address_short"}


def test_T10_A1_구글_공급자는_필드_마스크로_필요한_필드만_부른다():
    """실제 Google을 부르지 않는다: 가짜 전송이 요청만 받아 적는다. 응답 모양은 시험하지 않는다 (Google 형식은 문서 밖)."""
    from places.provider import GooglePlaces

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    provider = GooglePlaces("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler)))
    for call in (lambda: provider.resolve("道頓堀 Osaka", "namba"), lambda: provider.details("FAKE-x"), lambda: provider.search_lodging("호텔")):
        before = len(seen)
        try:
            call()
        except NotImplementedError:
            raise
        except Exception:
            pass  # 빈 응답을 어떻게 다룰지는 이 테스트가 보지 않는다
        assert len(seen) > before, "요청을 보내지 않았다"
    for request in seen:
        mask = request.headers.get("X-Goog-FieldMask", "")
        assert mask and mask.strip() != "*", request.url
        assert "*" not in mask
        for banned in ("reviews", "photos"):  # §8: 리뷰·사진 가져오기 금지
            assert banned not in mask.lower(), mask


# ---------- A2 만들기: 팩(git) / 캐시(git 밖) ----------


def test_T10_A2_팩은_seed_값_더하기_place_id만():
    result = build()
    seeds = {row["id"]: row for row in seed_rows()}
    assert result.pack["city_code"] == "osaka"
    assert {row["id"] for row in result.pack["places"]} == set(seeds) - set(EXCLUDED)
    for row in result.pack["places"]:
        assert set(row) == SEED_KEYS | {"place_id"}, row["id"]
        assert {k: v for k, v in row.items() if k != "place_id"} == seeds[row["id"]]
        assert row["place_id"].startswith("FAKE-osaka-")


def test_T10_A8_팩에_시간대_Asia_Tokyo():
    assert build().pack["timezone"] == "Asia/Tokyo"


def test_T10_A2_AC2_팩에_Google_값이_하나도_없다():
    pack = build().pack
    assert not keys_anywhere(pack) & GOOGLE_KEYS
    text = json.dumps(pack, ensure_ascii=False)
    assert "example.invalid" not in text  # 사이트·지도 링크
    for detail in FAKE["details"].values():
        assert str(detail["location"]["lat"]) not in text


def test_T10_A2_팩에_8종_3지역이_남는다():
    pack = build().pack
    assert {row["category"] for row in pack["places"]} == CATEGORIES
    assert {row["area"] for row in pack["places"]} == AREAS


def test_T10_A2_캐시는_팩의_place_id마다_Google_값과_fetched_at():
    result = build()
    assert set(result.cache) == {row["place_id"] for row in result.pack["places"]}
    for place_id, entry in result.cache.items():
        assert datetime.fromisoformat(entry["fetched_at"]) == NOW, place_id
    assert result.cache["FAKE-osaka-kuromon"]["location"] == FAKE["details"]["FAKE-osaka-kuromon"]["location"]


def test_T10_A2_A4_검색_실패_여러_곳_영구_폐업은_빼고_이유를_보고():
    report = build().report
    assert {(row["id"], row["reason"]) for row in report["excluded"]} == set(EXCLUDED.items())


def test_T10_A2_호출_수를_보고한다():
    clock = FakeClock()
    places, serper = Recording(fake_places(), clock), Recording(fake_serper(), clock)
    report = build(places=places, serper=serper, clock=clock).report
    assert report["calls"]["google"] == len(places.calls)
    assert report["calls"]["serper"] == len(serper.calls)
    assert report["stopped"] is False


# ---------- A3 Serper 보완 ----------


def test_T10_A3_Serper는_Google_영업시간이_없는_곳만_한_번씩_営業時間_검색():
    clock = FakeClock()
    serper = Recording(fake_serper(), clock)
    build(serper=serper, clock=clock)
    queries = {row["id"]: row["query"] for row in seed_rows()}
    assert sorted(args[0] for args in serper.names("search")) == sorted(f"{queries[i]} 営業時間" for i in NO_GOOGLE_HOURS)


def test_T10_A3_값이_하나로_맞으면_serper_미확인_결과_링크():
    result = build()
    row = row_of(result.pack, "osaka-fake-alley-cafe")
    fact = hours_fact(row, result.cache[row["place_id"]])
    assert (fact["source_type"], fact["status"]) == ("serper", "unverified")
    assert fact["source_url"] in {hit["link"] for hit in FAKE["serper"]["なんば 路地カフェ Osaka 営業時間"]}
    assert "10:00" in str(fact["value"]) and "19:00" in str(fact["value"])


@pytest.mark.parametrize("our_id", ["osaka-fake-comedy", "osaka-fake-dotonbori", "osaka-fake-amemura"], ids=["엇갈림", "결과_없음", "시각_없음"])
def test_T10_A3_못_뽑거나_엇갈리면_모름(our_id):
    result = build()
    row = row_of(result.pack, our_id)
    assert hours_fact(row, result.cache[row["place_id"]])["status"] == "unknown"


def test_T10_A3_Google_영업시간은_출처_google():
    result = build()
    row = row_of(result.pack, "osaka-fake-kuromon")
    fact = hours_fact(row, result.cache[row["place_id"]])
    assert fact["source_type"] == "google"
    assert fact["status"] in {"confirmed", "unverified"}  # Google 값의 status는 문서에 없다 (질문)


def test_T10_A3_AC3_검색_결과_문장은_팩_캐시_보고_로그_어디에도_없다(caplog):
    caplog.set_level(logging.DEBUG)
    result = build()
    for part in (result.pack, result.cache, result.report):
        assert SNIPPET_MARK not in json.dumps(part, ensure_ascii=False)
    assert all(SNIPPET_MARK not in record.getMessage() for record in caplog.records)


# AC-3 시각 뽑기 표 (손으로 만든 예). 기대값 None = 못 뽑음·엇갈림 -> unknown
H = ("11:00", "22:00")
EXTRACT_CASES = [
    ("일본어 물결 ～(U+FF5E)", ["営業時間 11:00～22:00"], H),
    ("일본어 물결 〜(U+301C)", ["営業時間：11:00〜22:00"], H),
    ("ASCII 물결", ["11:00~22:00"], H),
    ("붙임표", ["11:00-22:00"], H),
    ("물결 앞뒤 띄어쓰기", ["営業時間 11:00 ～ 22:00"], H),
    ("한 자리 시", ["9:00～18:00"], ("09:00", "18:00")),
    ("30분 단위", ["10:30～20:30"], ("10:30", "20:30")),
    ("두 결과가 같은 값", ["営業時間 11:00～22:00", "11:00～22:00 営業"], H),
    ("같은 값 + 덧붙인 말", ["営業時間 11:00～22:00", "営業時間 11:00～22:00（変更の場合あり）"], H),
    ("다른 결과는 시각 없음", ["営業時間 11:00～22:00", "アクセス 難波駅から徒歩5分"], H),
    ("빈 문장 + 값", ["", "営業時間 10:00～19:00"], ("10:00", "19:00")),
    ("이름 붙은 구간 하나", ["ランチ 11:00～14:00"], ("11:00", "14:00")),
    ("定休日만", ["定休日：水曜日"], None),
    ("定休日なし만", ["定休日なし"], None),
    ("빈 문장", [""], None),
    ("결과 없음", [], None),
    ("시각 없는 문장", ["大阪の人気スポット"], None),
    ("결과끼리 엇갈림", ["11:00～22:00", "10:00～21:00"], None),
    ("닫는 시각만 다름", ["営業時間 11:00～22:00", "営業時間 11:00～23:00"], None),
    ("전화번호는 시각이 아님", ["電話 06-1234-5678"], None),
    ("날짜는 시각이 아님", ["2026年11月9日 更新"], None),
    ("시각 하나뿐 (구간 아님)", ["開店 11:00"], None),
]
# 문서에 기대값이 없는 줄 (질문 목록). 표에는 남기되 돌리지 않는다
EXTRACT_PENDING = [
    ("전각 숫자", ["営業時間 １１:００～２２:００"], "Q 전각 숫자"),
    ("전각 쌍점", ["営業時間 11：00～22：00"], "Q 전각 숫자"),
    ("時 표기", ["11時～22時"], "Q 時 표기"),
    ("자정 넘김 翌", ["18:00～翌2:00"], "Q 자정 넘김"),
    ("닫는 시각 < 여는 시각", ["22:00～02:00"], "Q 자정 넘김"),
    ("L.O. 덧붙음", ["11:00～22:00（L.O.21:30）"], "Q L.O."),
    ("하루 두 구간", ["11:00～14:00 17:00～22:00"], "Q 하루 두 구간"),
    ("시각 + 定休日", ["営業時間 11:00～22:00 定休日 水曜日"], "Q 定休日"),
    ("24時間", ["24時間営業"], "Q 24시간"),
]


def test_T10_AC3_시각_뽑기_표는_20개_이상이고_네_종류를_모두_담는다():
    assert len(EXTRACT_CASES) >= 20
    names = " ".join(name for name, _, _ in EXTRACT_CASES + [(n, t, None) for n, t, _ in EXTRACT_PENDING])
    texts = " ".join(t for _, ts, _ in EXTRACT_CASES for t in ts)
    assert "11:00～22:00" in texts and "定休日" in texts
    assert "엇갈림" in names and "없음" in names


@pytest.mark.parametrize(("name", "texts", "expected"), EXTRACT_CASES, ids=[c[0] for c in EXTRACT_CASES])
def test_T10_A3_AC3_시각_뽑기_표(name, texts, expected):
    from places.serper import extract_hours

    assert extract_hours(texts) == expected


@pytest.mark.parametrize(("name", "texts", "question"), EXTRACT_PENDING, ids=[c[0] for c in EXTRACT_PENDING])
def test_T10_A3_AC3_시각_뽑기_문서에_기대값_없음(name, texts, question):
    pytest.skip(f"문서에 기대값 없음 ({question})")


# ---------- A4 폐업 ----------


def test_T10_A4_임시_휴업은_팩에_넣고_영업시간_모름():
    result = build()
    row = row_of(result.pack, "osaka-fake-gallery")
    assert hours_fact(row, result.cache[row["place_id"]])["status"] == "unknown"


# ---------- A5 캐시 수명 ----------


def entry_at(age: timedelta) -> dict:
    result = build()
    entry = dict(result.cache["FAKE-osaka-kuromon"])
    entry["fetched_at"] = (NOW - age).isoformat()
    return entry


@pytest.mark.parametrize(
    ("field", "age", "stale"),
    [
        ("location", timedelta(days=30) - timedelta(seconds=1), False),
        ("location", timedelta(days=30) + timedelta(seconds=1), True),
        ("location", timedelta(days=1), False),
        ("opening_hours", timedelta(hours=24) - timedelta(seconds=1), False),
        ("opening_hours", timedelta(hours=24) + timedelta(seconds=1), True),
        ("opening_hours", timedelta(hours=1), False),
    ],
    ids=["좌표_30일_1초_전", "좌표_30일_1초_뒤", "좌표_1일", "영업시간_24시간_1초_전", "영업시간_24시간_1초_뒤", "영업시간_1시간"],
)
def test_T10_A5_캐시_수명_좌표_30일_영업시간_24시간(field, age, stale):
    from places.cache import is_stale

    assert is_stale(entry_at(age), field, NOW) is stale


@pytest.mark.parametrize("field, age", [("location", timedelta(days=30)), ("opening_hours", timedelta(hours=24))], ids=["좌표_정각_30일", "영업시간_정각_24시간"])
def test_T10_A5_캐시_수명_정각(field, age):
    pytest.skip("정각(정확히 30일·24시간)이 오래된 것인지 문서에 없음 (질문)")


def refresh(cache, ids, provider, now, clock: FakeClock | None = None):
    from places.cache import refresh as target

    clock = clock or FakeClock()
    return target(cache, ids, provider, now=now, clock=clock.time, sleep=clock.sleep)


def test_T10_A5_다시_부르기는_요청한_후보_중_오래된_것만():
    result = build()
    clock = FakeClock()
    provider = Recording(fake_places(), clock)
    cache = dict(result.cache)
    cache["FAKE-osaka-kuromon"] = {**cache["FAKE-osaka-kuromon"], "fetched_at": (NOW - timedelta(hours=25)).isoformat()}
    cache["FAKE-osaka-sky"] = {**cache["FAKE-osaka-sky"], "fetched_at": (NOW - timedelta(hours=25)).isoformat()}  # 오래됐지만 요청 밖
    _, report = refresh(cache, ["FAKE-osaka-kuromon", "FAKE-osaka-ramen"], provider, NOW, clock)
    assert provider.names("details") == [("FAKE-osaka-kuromon",)]
    assert report["calls"]["google"] == 1


def test_T10_A5_새것이면_다시_부르지_않는다():
    result = build()
    provider = Recording(fake_places(), FakeClock())
    refresh(result.cache, list(result.cache), provider, NOW + timedelta(hours=1))
    assert provider.calls == []


class Broken:
    def resolve(self, query, area):
        raise RuntimeError("공급자 실패 (테스트)")

    def details(self, place_id):
        raise RuntimeError("공급자 실패 (테스트)")

    def search_lodging(self, q):
        raise RuntimeError("공급자 실패 (테스트)")


def test_T10_A5_다시_부르기_실패면_이전_값을_쓰되_미확인으로_내린다():
    result = build()
    row = row_of(result.pack, "osaka-fake-kuromon")
    before = hours_fact(row, result.cache[row["place_id"]])
    later = NOW + timedelta(hours=25)
    cache, report = refresh(result.cache, [row["place_id"]], Broken(), later)
    after = hours_fact(row, cache[row["place_id"]])
    assert after["value"] == before["value"]
    assert after["status"] == "unverified"
    assert cache[row["place_id"]]["location"] == result.cache[row["place_id"]]["location"]
    assert report["failed"] == [row["place_id"]]


# ---------- A7 호출 상한·간격 ----------


class Synthetic:
    """줄 수만큼 장소를 지어내는 공급자. hours=False면 영업시간 없음."""

    def __init__(self, hours: bool = True):
        self.hours = hours

    def resolve(self, query, area):
        return f"FAKE-syn-{query}"

    def details(self, place_id):
        hours = [{"weekday": d, "open": "10:00", "close": "18:00"} for d in range(7)] if self.hours else None
        return {"location": {"lat": 34.67, "lng": 135.50}, "opening_hours": hours, "website": None, "maps_url": None, "business_status": "OPERATIONAL"}

    def search_lodging(self, q):
        return []


class SyntheticSerper:
    def search(self, q):
        return []


def synthetic_rows(count: int) -> list[dict]:
    base = seed_rows()[0]
    return [{**base, "id": f"osaka-syn-{n}", "query": f"syn {n} Osaka", "aliases": []} for n in range(count)]


@pytest.mark.parametrize(("rows", "stopped"), [(150, False), (151, True)], ids=["Google_300회_딱", "Google_301회_필요"])
def test_T10_A7_만들기_Google_300회_넘으면_멈추고_보고(rows, stopped):
    clock = FakeClock()
    places = Recording(Synthetic(), clock)  # 한 줄 = resolve 1 + details 1
    report = build(rows=synthetic_rows(rows), places=places, serper=Recording(SyntheticSerper(), clock), clock=clock).report
    assert len(places.calls) <= 300
    assert report["stopped"] is stopped
    assert report["calls"]["google"] == len(places.calls)


@pytest.mark.parametrize(("rows", "stopped"), [(100, False), (101, True)], ids=["Serper_100회_딱", "Serper_101회_필요"])
def test_T10_A7_만들기_Serper_100회_넘으면_멈추고_보고(rows, stopped):
    clock = FakeClock()
    serper = Recording(SyntheticSerper(), clock)
    report = build(rows=synthetic_rows(rows), places=Recording(Synthetic(hours=False), clock), serper=serper, clock=clock).report
    assert len(serper.calls) <= 100
    assert report["stopped"] is stopped


@pytest.mark.parametrize(("count", "stopped"), [(30, False), (31, True)], ids=["다시_30회_딱", "다시_31회_필요"])
def test_T10_A7_다시_부르기_Google_30회_넘으면_멈추고_보고(count, stopped):
    result = build(rows=synthetic_rows(count), places=Synthetic(), serper=SyntheticSerper())
    clock = FakeClock()
    provider = Recording(Synthetic(), clock)
    _, report = refresh(result.cache, list(result.cache), provider, NOW + timedelta(days=31), clock)
    assert len(provider.calls) <= 30
    assert report["stopped"] is stopped


def test_T10_A7_요청_간격_0_1초_이상():
    clock = FakeClock()
    places, serper = Recording(fake_places(), clock), Recording(fake_serper(), clock)
    build(places=places, serper=serper, clock=clock)
    for recorder in (places, serper):
        times = [t for _, _, t in recorder.calls]
        gaps = [b - a for a, b in zip(times, times[1:])]
        assert gaps and min(gaps) >= 0.1 - 1e-9, gaps


# ---------- A8 엔진에는 demo_city.json과 같은 모양으로 ----------


def test_T10_A8_엔진_장소는_demo_city와_같은_모양():
    from places.pack import engine_places

    result = build()
    found = engine_places(result.pack, result.cache)
    assert set(found) == {row["id"] for row in result.pack["places"]}
    demo = json.loads((Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json").read_text(encoding="utf-8"))["places"][0]
    for our_id, place in found.items():
        assert isinstance(place, Place) and place.id == our_id
        assert set(place.model_dump()) == set(demo)
        Place.model_validate(json.loads(place.model_dump_json()))  # 같은 파일 모양으로 왕복


def test_T10_A8_엔진_장소_값은_seed와_캐시에서():
    from places.pack import engine_places

    result = build()
    place = engine_places(result.pack, result.cache)["osaka-fake-kuromon"]
    seed = next(row for row in seed_rows() if row["id"] == "osaka-fake-kuromon")
    detail = FAKE["details"]["FAKE-osaka-kuromon"]
    assert (place.name, place.category, place.crowd_level, place.price_level, place.mood_tags) == (
        seed["name_ko"], seed["category"], seed["crowd_level"], seed["price_level"], seed["mood_tags"],
    )
    assert place.stay is not None and place.stay.model_dump() == seed["stay"]
    assert (place.lat, place.lng) == (detail["location"]["lat"], detail["location"]["lng"])
    assert [o.model_dump() for o in place.hours or []] == detail["opening_hours"]


@pytest.mark.parametrize(
    ("our_id", "status"),
    [("osaka-fake-alley-cafe", "unverified"), ("osaka-fake-dotonbori", "unknown"), ("osaka-fake-gallery", "unknown")],
    ids=["Serper_미확인", "모름", "임시_휴업"],
)
def test_T10_A8_엔진_장소의_영업시간_상태(our_id, status):
    from places.pack import engine_places

    result = build()
    assert engine_places(result.pack, result.cache)[our_id].hours_status == status


# ---------- B7 출처 ----------


def test_T10_B7_모든_fact에_ADR_015_출처_머무는_시간은_curated():
    from places.pack import facts_for

    result = build()
    for row in result.pack["places"]:
        facts = facts_for(row, result.cache[row["place_id"]])
        assert facts, row["id"]
        for fact in facts:
            assert {"field", "value", "status", "source_type", "source_url", "checked_at"} <= set(fact)
            assert fact["source_type"] in SOURCE_TYPES, fact
        stay = [f for f in facts if f["field"] == "stay_min"]
        assert stay and all(f["source_type"] == "curated" for f in stay), row["id"]


# ---------- AC-2 저장소 검사 ----------


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)


def test_T10_AC2_캐시_폴더는_gitignore():
    assert git("check-ignore", "-q", "apps/server/.cache/places/osaka.json").returncode == 0


def test_T10_AC2_도시_팩은_git에_올린다():
    assert git("check-ignore", "-q", "apps/server/places/packs/osaka.json").returncode == 1


def test_T10_AC2_저장소의_도시_팩에_Google_값이_없다():
    packs = sorted((REPO / "apps" / "server" / "places" / "packs").glob("*.json"))
    if not packs:
        pytest.skip("도시 팩이 아직 없음 (§A2를 실제 키로 돌린 뒤 생김, §0 순서 4)")
    for path in packs:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert not keys_anywhere(data) & GOOGLE_KEYS, path.name
