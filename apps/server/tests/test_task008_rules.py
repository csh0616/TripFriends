"""TASK-008 규칙 순수 함수 (돌연변이 대상, AC-1). 근거: TASK-008 §A A1·A2, §B B2, §6 "장소 좌표 없음", §8 AC-2·AC-4.

계약 (보고서 ④, test-writer가 정한 이름 — 아직 없는 모듈이라 테스트 함수 안에서 import한다):
    trip/visit.py
        in_check_window(leave_min: int, start_min: int, now_min: int) -> bool
            A2: leave − 30 ≤ now < start (분 단위, 0시 기준)
        needs_check(status: str, checked_today: bool) -> bool
            A1·A6: 영업 사실 상태가 unverified·unknown이고 그날 확인 기록이 없을 때만 True
        closed_candidates(closed: Place, places: Mapping[str, Place], exclude: Collection[str], weekday: int, arrive_min: int) -> list[Candidate]
            B2: 같은 category, exclude(코스에 있는 곳 + 그날 닫힘 확인 기록) 밖, arrive_min에 영업 중
            (fact confirmed·unverified, 영업시간 모름(unknown) 제외. 영업시간이 있으면 hours_status와 무관 §11 Q20), 닫힌 곳에서 1.5km 안(정각 포함, §11 Q5), 가까운 순 최대 3곳.
            영업 중 = 여는 시각 ≤ 도착 < 닫는 시각 (§11 Q6).
            좌표가 없는 장소는 뺀다 (§6). Candidate는 .place_id(str), .distance_m(int, 닫힌 곳에서 직선거리 m)
"""

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_api_helpers import week_hours
from planning_helpers import north_of, place

from engine.models import Opening, Place, StayRange

WEDNESDAY = 2  # 2026-12-02
STAY = StayRange(min=30, typical=60, max=120)
NOON = 12 * 60


def visit():
    import trip.visit as module  # 아직 없는 모듈: 수집이 깨지지 않게 함수 안에서

    return module


# ---------- A2 시각 창: leave − 30 ≤ at < start ----------


@pytest.mark.parametrize(
    "now_min, expected",
    [
        (12 * 60 - 31, False),  # 출발 31분 전
        (12 * 60 - 30, True),  # 출발 30분 전 정각
        (12 * 60 - 29, True),
        (12 * 60 - 10, True),
        (12 * 60, True),  # 출발 정각
        (12 * 60 + 19, True),  # 도착 1분 전
        (12 * 60 + 20, False),  # 도착 정각
        (12 * 60 + 21, False),
    ],
    ids=["31분_전", "30분_전_정각", "29분_전", "10분_전", "출발_정각", "도착_1분_전", "도착_정각", "도착_뒤"],
)
def test_T8_A2_시각_창은_출발_30분_전부터_도착_전까지(now_min, expected):
    # 출발 12:00(시작 12:20 − 이동 20), 시작 12:20
    assert visit().in_check_window(12 * 60, 12 * 60 + 20, now_min) is expected


@settings(max_examples=300)
@given(
    leave=st.integers(min_value=0, max_value=23 * 60),
    travel=st.integers(min_value=0, max_value=120),
    now=st.integers(min_value=0, max_value=24 * 60 + 120),
)
def test_T8_A2_속성_시각_창은_식_그대로(leave, travel, now):
    start = leave + travel
    assert visit().in_check_window(leave, start, now) is (leave - 30 <= now < start)


# ---------- A1·A6 대상 ----------


@pytest.mark.parametrize(
    "status, checked, expected",
    [
        ("unverified", False, True),
        ("unknown", False, True),
        ("confirmed", False, False),
        ("unverified", True, False),
        ("unknown", True, False),
        ("confirmed", True, False),
    ],
)
def test_T8_A1_A6_대상은_미확인_모름이고_그날_확인_기록이_없을_때만(status, checked, expected):
    assert visit().needs_check(status, checked) is expected


# ---------- B2 대안 후보 ----------


def cafe(pid: str, east_km: float, *, category: str = "cafe", hours=None, status: str | None = None, km: float = 2.0) -> Place:
    """닫힌 곳(북쪽 2.0km) 기준 동쪽 east_km. 기본은 매일 08:00~22:00 영업, 확인됨."""
    return place(pid, category=category, km=km, east_km=east_km, hours=hours if hours is not None else week_hours("08:00", "22:00"), status=status, stay=STAY)


CLOSED = cafe("C00", 0.0)


def ids(found) -> list[str]:
    return [c.place_id for c in found]


def pick(places: list[Place], exclude=(), arrive_min: int = NOON, weekday: int = WEDNESDAY, closed: Place = CLOSED):
    pool = {p.id: p for p in [closed, *places]}
    return visit().closed_candidates(closed, pool, set(exclude) | {closed.id}, weekday, arrive_min)


@pytest.mark.parametrize("east, inside", [(1.49, True), (1.51, False)], ids=["1.49km_안", "1.51km_밖"])
def test_T8_B2_AC4_닫힌_곳에서_1_5km_안만(east, inside):
    assert ids(pick([cafe("A01", east)])) == (["A01"] if inside else [])


def test_T8_B2_AC4_Q5_1_5km_정각은_안():
    # §11 Q5: 1.5km 정각은 포함. 닫힌 곳(북 2.0km)에서 정북 1.5km (계산 거리 1500.0000000002m, 부동소수 오차만큼 넘음)
    exact = cafe("A01", 0.0, km=3.5)
    assert ids(pick([exact])) == ["A01"]
    assert abs(pick([exact])[0].distance_m - 1500) <= 1


def test_T8_B2_AC4_같은_종류만():
    found = pick([cafe("F01", 0.1, category="food"), cafe("A01", 0.5), cafe("M01", 0.2, category="museum")])
    assert ids(found) == ["A01"]


def test_T8_B2_AC4_영업시간_모름_unknown은_뺀다():
    unknown = place("U01", category="cafe", km=2.0, east_km=0.1, hours=None, stay=STAY)
    assert unknown.hours_status == "unknown"  # 시험 자체 확인
    assert ids(pick([unknown, cafe("A01", 0.5)])) == ["A01"]


@pytest.mark.parametrize("status", ["confirmed", "unverified"])
def test_T8_B2_확인됨과_미확인은_후보(status):
    assert ids(pick([cafe("A01", 0.5, status=status)])) == ["A01"]


def test_T8_B2_Q20_영업시간이_있으면_hours_status가_unknown이어도_후보():
    # §11 Q20: 화면 사실 기준(영업시간 있음 → unverified, TASK-003 Q9·10)으로 넣는다. 빼는 것은 영업시간 자체가 없는 곳
    odd = cafe("A01", 0.5, status="unknown")
    assert (odd.hours is not None, odd.hours_status) == (True, "unknown")  # 시험 자체 확인
    assert ids(pick([odd])) == ["A01"]


def test_T8_B2_코스에_있는_곳은_뺀다():
    assert ids(pick([cafe("A01", 0.2), cafe("A02", 0.5)], exclude={"A01"})) == ["A02"]


def test_T8_B2_그날_닫힘_확인_기록이_있는_곳은_뺀다():
    # exclude는 코스 장소 + 그날 닫혔다고 확인된 곳 (부르는 쪽이 합쳐 넘긴다)
    assert ids(pick([cafe("A01", 0.2), cafe("A02", 0.5)], exclude={"A02"})) == ["A01"]


def test_T8_B2_닫힌_곳_자신은_후보가_아니다():
    pool = {CLOSED.id: CLOSED, "A01": cafe("A01", 0.5)}
    assert ids(visit().closed_candidates(CLOSED, pool, set(), WEDNESDAY, NOON)) == ["A01"]


def test_T8_B2_가까운_순_최대_3곳():
    found = pick([cafe("A04", 1.2), cafe("A02", 0.6), cafe("A05", 1.4), cafe("A01", 0.3), cafe("A03", 0.9)])
    assert ids(found) == ["A01", "A02", "A03"]


def test_T8_B2_distance_m은_닫힌_곳에서_직선거리_미터():
    found = pick([cafe("A01", 0.3), cafe("A02", 1.2)])
    assert [type(c.distance_m) for c in found] == [int, int]
    assert abs(found[0].distance_m - 300) <= 1
    assert abs(found[1].distance_m - 1200) <= 1


def hours_on(weekday: int, open_at: str, close_at: str) -> list[Opening]:
    return [Opening(weekday=weekday, open=open_at, close=close_at)]


@pytest.mark.parametrize(
    "open_at, close_at, inside",
    [
        ("12:00", "20:00", True),  # 도착 시각에 막 연다
        ("12:01", "20:00", False),  # 도착 1분 뒤에 연다
        ("08:00", "12:01", True),  # 도착 1분 뒤에 닫는다
        ("08:00", "12:00", False),  # 도착 시각에 닫는다 (§11 Q6: 도착 < 닫는 시각)
        ("08:00", "11:59", False),  # 도착 1분 전에 닫았다
    ],
    ids=["여는_정각", "여는_1분_전", "닫기_1분_전", "닫는_정각", "닫은_1분_뒤"],
)
def test_T8_B2_AC4_Q6_예정_도착_시각에_영업_중인_곳만(open_at, close_at, inside):
    # §11 Q6: 영업 중 = 여는 시각 ≤ 도착 < 닫는 시각
    alt = cafe("A01", 0.5, hours=hours_on(WEDNESDAY, open_at, close_at))
    assert ids(pick([alt], arrive_min=NOON)) == (["A01"] if inside else [])


def test_T8_B2_그날_요일의_영업시간만_본다():
    alt = cafe("A01", 0.5, hours=hours_on(WEDNESDAY + 1, "08:00", "22:00"))  # 목요일만 연다
    assert ids(pick([alt], weekday=WEDNESDAY)) == []
    assert ids(pick([alt], weekday=WEDNESDAY + 1)) == ["A01"]


def test_T8_S6_좌표가_없는_장소는_후보에서_뺀다():
    good = cafe("A02", 0.5)
    no_lat = Place.model_construct(**{**cafe("A01", 0.1).model_dump(), "lat": None})
    no_lng = Place.model_construct(**{**cafe("A03", 0.1).model_dump(), "lng": None})
    assert ids(pick([no_lat, no_lng, good])) == ["A02"]


def test_T8_B2_순수_함수_같은_입력은_같은_결과이고_입력을_바꾸지_않는다():
    places = [cafe("A01", 0.3), cafe("A02", 0.6)]
    pool = {p.id: p for p in [CLOSED, *places]}
    before = {pid: p.model_dump() for pid, p in pool.items()}
    one = ids(visit().closed_candidates(CLOSED, pool, {CLOSED.id}, WEDNESDAY, NOON))
    two = ids(visit().closed_candidates(CLOSED, pool, {CLOSED.id}, WEDNESDAY, NOON))
    assert one == two
    assert {pid: p.model_dump() for pid, p in pool.items()} == before


# ---------- B2 속성 ----------

CATEGORIES = ["cafe", "food", "walk"]


def _distance_m(a: Place, b: Place) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * 1000 * math.asin(math.sqrt(h))


candidate = st.fixed_dictionaries(
    {
        "east": st.floats(min_value=-2.0, max_value=2.0, allow_nan=False),
        "north": st.floats(min_value=-2.0, max_value=2.0, allow_nan=False),
        "category": st.sampled_from(CATEGORIES),
        "open_h": st.integers(min_value=6, max_value=14),
        "close_h": st.integers(min_value=10, max_value=23),
        "known": st.booleans(),
        "status": st.sampled_from(["confirmed", "unverified"]),
        "in_course": st.booleans(),
    }
)


def _build(specs) -> tuple[list[Place], set[str]]:
    places, exclude = [], set()
    for number, spec in enumerate(specs, start=1):
        pid = f"X{number:02d}"
        hours = week_hours(f"{spec['open_h']:02d}:00", f"{spec['close_h']:02d}:00") if spec["known"] else None
        places.append(
            place(pid, category=spec["category"], km=2.0 + spec["north"], east_km=spec["east"], hours=hours, status=spec["status"] if spec["known"] else None, stay=STAY)
        )
        if spec["in_course"]:
            exclude.add(pid)
    return places, exclude


def _eligible(p: Place, exclude: set[str], arrive: int) -> bool:
    if p.id in exclude or p.id == CLOSED.id or p.category != CLOSED.category or p.hours is None:
        return False
    within = _distance_m(CLOSED, p) < 1500 - 1  # 1.5km 정각 근처(±1m)는 정각 테스트가 따로 본다 (§11 Q5)
    is_open = any(o.weekday == WEDNESDAY and int(o.open[:2]) * 60 + int(o.open[3:]) <= arrive < int(o.close[:2]) * 60 + int(o.close[3:]) for o in p.hours)
    return within and is_open


@settings(max_examples=150, deadline=None)
@given(specs=st.lists(candidate, min_size=0, max_size=8), arrive=st.integers(min_value=8 * 60, max_value=20 * 60))
def test_T8_B2_속성_결과는_규칙을_지키고_가까운_순_최대_3곳(specs, arrive):
    places, exclude = _build(specs)
    found = pick(places, exclude=exclude, arrive_min=arrive)
    by_id = {p.id: p for p in places}
    assert len(found) <= 3
    assert len(set(ids(found))) == len(found)
    distances = [_distance_m(CLOSED, by_id[c.place_id]) for c in found]
    assert distances == sorted(distances)
    for c in found:
        p = by_id[c.place_id]
        assert p.category == CLOSED.category
        assert p.id not in exclude
        assert p.hours is not None  # unknown 제외
        assert _distance_m(CLOSED, p) <= 1500 + 1
        # 영업 중: 여는 시각 ≤ 도착 < 닫는 시각 (§11 Q6)
        assert any(o.weekday == WEDNESDAY and int(o.open[:2]) * 60 <= arrive < int(o.close[:2]) * 60 for o in p.hours)
    # 빠뜨리지 않는다: 조건을 확실히 만족하는데 결과에 없으면, 결과가 이미 3곳이고 모두 그보다 가깝다
    for p in places:
        if _eligible(p, exclude, arrive) and p.id not in ids(found):
            assert len(found) == 3
            assert max(distances) <= _distance_m(CLOSED, p) + 1e-6
