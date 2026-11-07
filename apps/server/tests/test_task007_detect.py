"""TASK-007 §A 감지 규칙 `detect_delay` (순수 함수). 근거: TASK-007 §A A1~A5, §8 AC-5, §7 "하루 끝" 줄.

계약 (이 테스트가 정한 모양, 보고서 ④):
    trip/detect.py
    DelayStop(seq, lat, lng, start, end, travel_min, is_fixed)   # 장소 없는 고정 일정은 lat·lng None, travel_min = 앞에서 오는 이동 분
    DelayCourse(day_id, stops)                                   # stops는 코스 순서
    DelayFinding(k, delay_min, severity, dedupe_key)              # k = at_place의 seq, severity "low" | "high"
    detect_delay(course, at: datetime, position: tuple[lat, lng] | None) -> DelayFinding | None

§11 답:
    - "150m 안"은 150m를 포함한다 (Q1, 추천안 승인). 150m 정각은 부동소수점 때문에 149.9999…m로 계산된다
    - A4 "일정을 delay_min만큼 미뤘을 때"는 뒤 일정을 차례로 민다. 사이의 빈 시간이 먼저 흡수하고, 흡수하지 못한 만큼만 다음으로 넘어간다 (Q2):
      다음 시작 = max(원래 시작, 앞 끝 + 이동). 그 결과 고정 일정 시작에 늦으면 높음
"""

from datetime import datetime, timedelta

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from planning_helpers import north_of

DAY_ID = "day-7"


def _detect():
    from trip import detect  # 아직 없는 모듈이라 테스트마다 불러온다 (수집이 깨지지 않게)

    return detect


def stop(seq: int, start: str, end: str, travel: int, km: float | None = None, fixed: bool = False):
    lat, lng = north_of(km) if km is not None else (None, None)
    return _detect().DelayStop(seq=seq, lat=lat, lng=lng, start=start, end=end, travel_min=travel, is_fixed=fixed)


def course(*stops, day_id: str = DAY_ID):
    return _detect().DelayCourse(day_id=day_id, stops=list(stops))


def at(clock: str) -> datetime:
    parts = [int(p) for p in clock.split(":")]
    return datetime(2026, 12, 2, parts[0], parts[1], parts[2] if len(parts) == 3 else 0)


def detect(c, clock: str | datetime, position):
    when = at(clock) if isinstance(clock, str) else clock
    return _detect().detect_delay(c, when, position)


def plain():
    """1번 끝 12:00, 2번 12:20 시작·이동 20 → 1번 예정 출발 12:00. 3번이 마지막."""
    return course(
        stop(1, "10:12", "12:00", 12, km=1.0),
        stop(2, "12:20", "14:00", 20, km=2.0),
        stop(3, "14:30", "19:00", 30, km=3.0),
    )


AT1 = north_of(1.0)
AT2 = north_of(2.0)
AT3 = north_of(3.0)
FAR = north_of(1.5)  # 1번·2번 모두 500m


# ---------- A1 어디 있나 ----------


def test_A1_위치가_없으면_None():
    assert detect(plain(), "12:30", None) is None


def test_A1_150m_안에_코스_장소가_없으면_이동_중이라_None():
    assert detect(plain(), "12:30", FAR) is None


@pytest.mark.parametrize("meters, found", [(149, True), (150, True), (151, False)], ids=["149m", "150m", "151m"])
def test_A1_AC5_150m_경계(meters, found):
    position = north_of(1.0 + meters / 1000)
    result = detect(plain(), "12:15", position)
    if found:
        assert result is not None and result.k == 1
    else:
        assert result is None


@pytest.mark.parametrize("meters", [149, 150, 151], ids=["149m", "150m", "151m"])
def test_A1_AC5_150m_경계_동쪽으로도(meters):
    # 위도선이 아니라 경도 방향으로 떨어져도 같은 거리 규칙 (거리는 하버사인, TASK-002 §8 Q26와 같은 지구 반지름)
    position = north_of(1.0, east_km=meters / 1000)
    result = detect(plain(), "12:15", position)
    assert (result is not None) is (meters < 151)


def two_close():
    """1번(1.0km)과 2번(1.1km)은 100m 떨어져 있다. 11:30이면 1번 예정 출발(11:00)이 지났고 2번 예정 출발(12:10)은 아직."""
    return course(
        stop(1, "10:00", "11:00", 10, km=1.0),
        stop(2, "11:05", "12:00", 5, km=1.1),
        stop(3, "12:30", "13:00", 20, km=3.0),
    )


def test_A1_150m_안에_둘이면_가장_가까운_곳이_at_place():
    result = detect(two_close(), "11:30", north_of(1.03))  # 1번 30m, 2번 70m
    assert result is not None
    assert (result.k, result.delay_min) == (1, 30)


def test_A1_더_가까운_곳이_2번이면_2번_기준이라_아직_안_늦었다():
    assert detect(two_close(), "11:30", north_of(1.08)) is None  # 1번 80m, 2번 20m


def test_A1_장소_없는_고정_일정은_위치_비교에서_뺀다():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, "13:30", FAR) is None


# ---------- A2 얼마나 늦었나 ----------


@pytest.mark.parametrize(
    "clock, expected",
    [("11:30", None), ("12:00", None), ("12:00:59", None), ("12:01", None), ("12:09", None), ("12:09:59", None), ("12:10", 10), ("12:10:59", 10), ("12:19", 19), ("12:20", 20), ("12:47", 47)],
    ids=["출발_전", "출발_정각", "출발_정각_59초", "1분", "9분", "9분_59초", "10분", "10분_59초", "19분", "20분", "47분"],
)
def test_A2_A3_AC5_delay_min은_분_내림이고_10분_미만이면_None(clock, expected):
    result = detect(plain(), clock, AT1)
    assert (result.delay_min if result else None) == expected


def test_A2_예정_출발은_다음_시작_빼기_다음_이동():
    c = course(stop(1, "10:00", "11:00", 10, km=1.0), stop(2, "12:00", "13:00", 45, km=2.0), stop(3, "13:30", "14:00", 20, km=3.0))
    # 1번 예정 출발 = 12:00 − 45 = 11:15 (1번 끝 11:00이 아니다)
    assert detect(c, "11:24", AT1) is None
    assert detect(c, "11:25", AT1).delay_min == 10


def test_A2_다음이_장소_없는_고정_일정이어도_그_시작과_이동으로():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, "13:10", AT1).delay_min == 10


def test_A2_2번에서_늦으면_2번_기준():
    result = detect(plain(), "14:12", AT2)  # 2번 예정 출발 = 14:30 − 30 = 14:00
    assert (result.k, result.delay_min) == (2, 12)


@pytest.mark.parametrize("clock", ["19:00", "20:30", "23:59"])
def test_A2_S7_마지막_장소에서는_지킬_다음_일정이_없어_None(clock):
    assert detect(plain(), clock, AT3) is None


def test_A2_일정_안에_있으면_늦지_않았다():
    assert detect(plain(), "11:00", AT1) is None


# ---------- A4 심각도 ----------


@pytest.mark.parametrize("clock, severity", [("12:10", "low"), ("12:19", "low"), ("12:20", "high"), ("12:30", "high")], ids=["10분", "19분", "20분", "30분"])
def test_A4_AC5_고정_일정이_없으면_20분부터_높음(clock, severity):
    assert detect(plain(), clock, AT1).severity == severity


def slack_one_gap():
    """고정 일정 앞 빈 시간이 15분: 2번 끝 13:30 + 이동 15 = 13:45, 고정 14:00."""
    return course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "12:30", "13:30", 30, km=2.0),
        stop(3, "14:00", "15:00", 15, km=3.0, fixed=True),
        stop(4, "15:20", "16:00", 20, km=4.0),
    )


def slack_two_gaps():
    """빈 시간이 5분(3번 앞) + 10분(고정 앞) = 15분."""
    return course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "12:30", "13:00", 30, km=2.0),
        stop(3, "13:20", "13:40", 15, km=3.0),
        stop(4, "14:00", "15:00", 10, km=4.0, fixed=True),
    )


@pytest.mark.parametrize("make", [slack_one_gap, slack_two_gaps], ids=["빈_시간_한_곳", "빈_시간_두_곳"])
@pytest.mark.parametrize("clock, severity", [("12:14", "low"), ("12:15", "low"), ("12:16", "high")], ids=["14분_빈시간_안", "15분_딱_맞음", "16분_1분_늦음"])
def test_A4_AC5_고정_일정_1분_차(make, clock, severity):
    result = detect(make(), clock, AT1)
    assert result.delay_min < 20  # 시험 자체 확인: 20분 규칙이 아니라 고정 일정 규칙으로 갈린다
    assert result.severity == severity


def test_A4_다음_일정이_고정이면_10분만_늦어도_높음():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 30, km=2.0, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    result = detect(c, "12:40", AT1)
    assert (result.delay_min, result.severity) == (10, "high")


def test_A4_장소_없는_고정_일정도_고정_일정이다():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, "13:10", AT1).severity == "high"


def test_A4_빈_시간이_넉넉한_고정_일정은_낮음():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "12:30", "13:00", 30, km=2.0), stop(3, "16:00", "17:00", 20, km=3.0, fixed=True))
    assert detect(c, "12:15", AT1).severity == "low"


def test_A4_이미_지난_고정_일정은_세지_않는다():
    c = course(
        stop(1, "09:00", "10:00", 10, km=0.5, fixed=True),
        stop(2, "10:20", "12:00", 10, km=1.0),
        stop(3, "12:30", "13:30", 30, km=2.0),
        stop(4, "13:40", "14:00", 10, km=3.0),
    )
    assert detect(c, "12:12", AT1).severity == "low"


def test_A4_앞_고정_일정에서_늦음이_흡수되면_뒤_고정_일정도_지켜_낮음():
    c = course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "12:30", "13:00", 30, km=2.0),
        stop(3, "15:00", "15:30", 10, km=3.0, fixed=True),  # 빈 시간 넉넉
        stop(4, "15:45", "16:30", 15, km=4.0, fixed=True),  # 15:30 + 15 = 15:45, 빈 시간 0
    )
    # 3번 고정 앞에서 늦음이 다 흡수되면 4번은 원래대로다. 3번이 원래 시각을 지키므로 4번도 지킨다
    assert detect(c, "12:12", AT1).severity == "low"


def test_A4_빈_시간_없는_고정_일정_사슬은_높음():
    c = course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "12:30", "13:00", 30, km=2.0),
        stop(3, "13:10", "15:30", 10, km=3.0),  # 빈 시간 0
        stop(4, "15:45", "16:30", 15, km=4.0, fixed=True),  # 빈 시간 0
    )
    assert detect(c, "12:12", AT1).severity == "high"


# ---------- A5 dedupe_key ----------


def test_A5_dedupe_key는_delay_day_k():
    assert detect(plain(), "12:15", AT1).dedupe_key == f"delay:{DAY_ID}:1"
    assert detect(plain(), "14:15", AT2).dedupe_key == f"delay:{DAY_ID}:2"


def test_A5_같은_장소에서_더_늦어져도_같은_키():
    assert detect(plain(), "12:10", AT1).dedupe_key == detect(plain(), "12:45", AT1).dedupe_key


def test_A5_다른_날이면_다른_키():
    other = course(*plain().stops, day_id="day-8")
    assert detect(other, "12:15", AT1).dedupe_key == "delay:day-8:1"


# ---------- 속성 ----------

leg = st.tuples(st.integers(min_value=15, max_value=120), st.integers(min_value=5, max_value=40), st.integers(min_value=0, max_value=30), st.booleans())


def build(legs) -> tuple:
    stops, clock = [], 10 * 60
    for number, (stay, travel, rest, fixed) in enumerate(legs, start=1):
        start = clock + travel + rest
        stops.append(stop(number, f"{start // 60:02d}:{start % 60:02d}", f"{(start + stay) // 60:02d}:{(start + stay) % 60:02d}", travel, km=float(number), fixed=fixed and number > 1))
        clock = start + stay
    return course(*stops), stops


SETTINGS = settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])


@SETTINGS
@given(legs=st.lists(leg, min_size=2, max_size=5), k=st.integers(min_value=1, max_value=5), late=st.integers(min_value=-30, max_value=120))
def test_AC5_속성_결과는_None이거나_10분_이상이고_20분_이상이면_높음(legs, k, late):
    c, stops = build(legs)
    k = min(k, len(stops))
    here = north_of(float(k))
    if k == len(stops):
        assert detect(c, at("10:00") + timedelta(minutes=600), here) is None
        return
    nxt = stops[k]
    leave = int(nxt.start[:2]) * 60 + int(nxt.start[3:]) - nxt.travel_min
    when = datetime(2026, 12, 2) + timedelta(minutes=leave + late)
    if when.date() != datetime(2026, 12, 2).date():
        return
    result = detect(c, when, here)
    if late < 10:
        assert result is None
        return
    assert result is not None
    assert (result.k, result.delay_min) == (k, late)
    assert result.severity in {"low", "high"}
    if late >= 20:
        assert result.severity == "high"
    assert result.dedupe_key == f"delay:{DAY_ID}:{k}"


@SETTINGS
@given(legs=st.lists(leg, min_size=2, max_size=5), first=st.integers(min_value=10, max_value=60), more=st.integers(min_value=0, max_value=60))
def test_AC5_속성_같은_장소에서_시간이_가면_늦음은_줄지_않고_높음은_낮음으로_돌아가지_않는다(legs, first, more):
    c, stops = build(legs)
    leave = int(stops[1].start[:2]) * 60 + int(stops[1].start[3:]) - stops[1].travel_min
    base = datetime(2026, 12, 2) + timedelta(minutes=leave)
    early = detect(c, base + timedelta(minutes=first), AT1)
    late = detect(c, base + timedelta(minutes=first + more), AT1)
    assert early is not None and late is not None
    assert late.delay_min >= early.delay_min
    if early.severity == "high":
        assert late.severity == "high"
    assert late.dedupe_key == early.dedupe_key


@SETTINGS
@given(legs=st.lists(leg, min_size=2, max_size=5), minute=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_A_속성_같은_입력은_같은_결과_위치가_멀면_None(legs, minute):
    c, _ = build(legs)
    when = datetime(2026, 12, 2) + timedelta(minutes=minute)
    assert detect(c, when, AT1) == detect(c, when, AT1)
    assert detect(c, when, north_of(0.5, east_km=5.0)) is None
    assert detect(c, when, None) is None
