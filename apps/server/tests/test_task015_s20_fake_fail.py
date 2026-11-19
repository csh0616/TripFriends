"""TASK-015 §20 #7 가짜 공급자(FakePlaces)의 실패 스위치: 정해 둔 검색 글이면 숙소(이름) 검색 · 주소 검색이 공급자 실패 -> 503.
reviewer a3 ② 스크린샷("지금 주소로 못 찾았어" + [지도에서 찍기])과 Maestro가 실제 서버(가짜 모드)로 띄우게 한다.

근거: TASK-015 §20 표 #7("가짜 공급자에 실패 스위치(정해 둔 검색어면 503) -> a3 ② 스크린샷") ·
§6 표("주소 검색 공급자 실패 -> '지금 주소로 못 찾았어' + [지도에서 찍기]") · §18 Q2(이름 검색 실패 뒤 같은 글로 주소 검색, 둘 다 실패하면 a3 ②) ·
§A "실패"(주소 검색 실패 503 PROVIDER_UNAVAILABLE, 숙소 검색과 같은 공통 오류) · TASK-010 §9 Q13(숙소 검색 공급자 실패 503 PROVIDER_UNAVAILABLE) ·
TASK-010 §9 Q5(가짜 공급자 = 손으로 만든 가짜 값).

데이터 (testdata/cities/osaka-fake.json, test-writer가 정한 값 — 문서에 검색 글이 없어 정함):
    provider_fail: ["공급자 실패 연습"]   (숙소 이름 · 주소 표 어디에도 없는 글)

계약 (backend가 FakePlaces에 넣는다):
    FakePlaces.search_lodging(q) · search_address(q): q가 provider_fail 목록의 글과 **정확히 같으면** ProviderTransientError
        (Google 5xx · 시간 초과를 다시 시도해도 계속될 때와 같은 예외 — GooglePlaces._send가 내는 것)
    그 밖의 글(앞뒤 · 일부만 같은 글 포함): 지금 그대로
    API: GET /places/lodging-search · /places/address-search 는 이미 공급자 예외를 503 PROVIDER_UNAVAILABLE로 바꾼다(api/trips.py _search).
        API는 앞뒤 공백을 잘라 공급자에 넘기므로 " 공급자 실패 연습 "도 503
"""

import json

import pytest

from auth_helpers import bearer
from places.provider import FAKE_PLACES_PATH, FakePlaces, ProviderTransientError
from test_task015_lodging import ME, mem  # noqa: F401 (픽스처)

FAIL_Q = "공급자 실패 연습"
PATHS = ["/places/lodging-search", "/places/address-search"]
METHODS = ["search_lodging", "search_address"]


def _data() -> dict:
    return json.loads(FAKE_PLACES_PATH.read_text(encoding="utf-8"))


# ---------- 데이터 자체 (초록이어야 함: test-writer가 넣었다) ----------


def test_T15_S20_7_가짜_데이터_실패_스위치_글이_하나_있다():
    assert _data()["provider_fail"] == [FAIL_Q]


def test_T15_S20_7_가짜_데이터_실패_글은_숙소_이름·주소_검색_글_어디에도_없다():
    data = _data()
    assert all(FAIL_Q not in row["name"] for row in data["lodging"])
    assert all(FAIL_Q != row["query"] and FAIL_Q not in row["name"] for row in data.get("address", []))


def test_T15_S20_7_가짜_데이터_실패_글은_검색_최소_글자_수_이상이고_앞뒤_공백이_없다():
    from api.trips import LODGING_MIN_CHARS

    assert FAIL_Q == FAIL_Q.strip()
    assert len(FAIL_Q) >= LODGING_MIN_CHARS


# ---------- 가짜 공급자 동작 (backend 구현 전 빨강) ----------


@pytest.mark.parametrize("method", METHODS)
def test_T15_S20_7_가짜_공급자_실패_글이면_ProviderTransientError(method):
    with pytest.raises(ProviderTransientError):
        getattr(FakePlaces(), method)(FAIL_Q)


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize("q", ["공급자 실패", "공급자 실패 연습1", "공급자 실패 연습 ", " 공급자 실패 연습", "실패 연습", "난바", "난바 주소 1-1"])
def test_T15_S20_7_가짜_공급자_경계_정확히_같지_않은_글은_실패하지_않는다(method, q):
    fake = FakePlaces()
    expected = fake.search_lodging(q) if method == "search_lodging" else fake.search_address(q)
    assert getattr(fake, method)(q) == expected  # 예외 없이 지금 결과 그대로
    if q == "난바 주소 1-1":
        assert fake.search_address(q) != []  # 시험 자체 확인: §18 주소 결과는 그대로


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("q", [FAIL_Q, f"  {FAIL_Q}  "])
def test_T15_S20_7_API_실패_글이면_503_PROVIDER_UNAVAILABLE(mem, path, q):  # noqa: F811
    response = mem.client.get(path, params={"city_code": "osaka", "q": q}, headers=bearer(ME))
    assert response.status_code == 503, response.text
    body = response.json()
    assert body["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert body["error"]["detail"] is None
    assert "ProviderTransientError" not in response.text  # 원인 문장은 담지 않는다 (숙소 검색과 같게)


@pytest.mark.parametrize("path", PATHS)
def test_T15_S20_7_API_경계_비슷한_글은_200(mem, path):  # noqa: F811
    response = mem.client.get(path, params={"city_code": "osaka", "q": "공급자 실패"}, headers=bearer(ME))
    assert response.status_code == 200, response.text


# ---------- 실패 스위치는 가짜 공급자에만 (결정권자 11-16) ----------


@pytest.mark.parametrize("method", METHODS)
def test_T15_S20_7_실제_Google_공급자는_실패_글이어도_실패하지_않고_그대로_보낸다(method):
    """실제 Google을 부르지 않는다: 가짜 전송이 요청을 받아 결과 한 줄을 돌려준다. 실패 글이어도 예외 없이 그 결과 그대로, 검색 글도 그대로 보낸다."""
    import httpx

    from places.provider import GooglePlaces

    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"places": [{"id": "FAKE-google-1", "displayName": {"text": "가짜 이름"}, "shortFormattedAddress": "가짜 주소"}]})

    provider = GooglePlaces("TEST-ONLY-NOT-A-KEY", client=httpx.Client(transport=httpx.MockTransport(handler)))
    found = getattr(provider, method)(FAIL_Q)
    assert found == [{"place_id": "FAKE-google-1", "name": "가짜 이름", "address_short": "가짜 주소"}]
    assert len(sent) == 1 and sent[0]["textQuery"] == FAIL_Q


def test_T15_S20_7_같은_실패_글에서_이름_검색과_주소_검색_둘_다_503(mem):  # noqa: F811
    """앱 a3 ②: 이름 검색 실패 뒤 같은 글로 주소 검색(§18 Q2) -> 둘 다 실패해야 "지금 주소로 못 찾았어"."""
    codes = [mem.client.get(path, params={"city_code": "osaka", "q": FAIL_Q}, headers=bearer(ME)).status_code for path in PATHS]
    assert codes == [503, 503]
