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


@pytest.mark.parametrize("clock", ["12:59", "13:00", "13:10", "13:30", "13:59", "14:00"])
def test_A2_S14_Q1_다음이_장소_없는_고정_일정이면_그_구간은_None(clock):
    # TASK-014 §14 Q1 (승인된 변경, 전: 13:10에 delay_min 10): 다음 일정(k+1)이 위치 없는 고정 일정이면 그 구간은 delay_min = None.
    # 그 일정은 T-07이 시각으로 알린다 (§13 5 원칙: 위치 없는 고정 일정은 이동 시간으로 늦어짐을 판단하지 않음).
    # §15 Q1 (승인된 변경, 전: 12:59~14:30 모두 None): None은 F(2번)가 끝날 때(14:00)까지. 14:30은 아래 "F 끝난 뒤" 테스트로 옮겼다
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, clock, AT1) is None


@pytest.mark.parametrize("travel", [0, 15], ids=["이동_0", "이동_15"])
def test_A2_S14_Q1_다음이_장소_없는_고정_일정이면_이동_분_값과_상관없이_None(travel):
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", travel, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, "13:20", AT1) is None


# §15 Q1: F가 끝난 뒤에는 F를 건너뛰고 다음 위치 있는 장소 기준. leave = 다음 장소 시작 - 지금 장소에서 그 장소까지 이동 분.
# 코스 데이터에서 "지금 장소 -> 다음 위치 있는 장소" 이동 분 = 그 장소의 travel_min (엔진 값).
# 엔진은 위치 없는 고정 일정 뒤에도 자리를 앞 장소로 둔다 (engine/planning.py simulate·trip/retime.py: here = slot.coord or here)
# -> F 다음 장소의 travel_min은 F 앞 장소에서 오는 이동 분이다. F의 travel_min은 쓰지 않는다


@pytest.mark.parametrize("f_travel", [0, 15], ids=["F_이동_0", "F_이동_15"])
@pytest.mark.parametrize(
    "clock, expected",
    [("14:01", None), ("14:10", None), ("14:19", None), ("14:19:59", None), ("14:20", 10), ("14:30", 20)],
    ids=["F_끝_1분_뒤_아직_출발_전", "다음_장소_출발_정각", "9분", "9분_59초", "10분", "20분"],
)
def test_A2_S15_Q1_F가_끝난_뒤에는_다음_위치_있는_장소_기준(f_travel, clock, expected):
    # F 13:00~14:00, 3번 14:30 시작·이동 20 -> leave = 14:10. 1번에 아직 있으면 1번(k=1) 기준으로 늦음
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", f_travel, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    result = detect(c, clock, AT1)
    assert (result.delay_min if result else None) == expected
    if result:
        assert (result.k, result.dedupe_key) == (1, f"delay:{DAY_ID}:1")


def test_A2_S15_Q1_F_뒤_20분_늦으면_높음():
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", 20, km=3.0))
    assert detect(c, "14:30", AT1).severity == "high"  # A4 20분 규칙 그대로


@pytest.mark.parametrize("next_travel, clock, expected", [(20, "14:20", 10), (40, "14:20", 30), (40, "13:59", None)], ids=["이동_20", "이동_40", "이동_40_F_안"])
def test_A2_S15_Q1_다음_장소의_이동_분이_leave를_정한다(next_travel, clock, expected):
    # 3번 14:30 시작: 이동 20 -> leave 14:10, 이동 40 -> leave 13:50. F 안(13:59)은 leave가 지났어도 None
    c = course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:30", "15:00", next_travel, km=3.0))
    result = detect(c, clock, AT1)
    assert (result.delay_min if result else None) == expected


def f_end_after_leave():
    """F 13:00~14:00, 3번 14:10 시작·이동 20 -> leave 13:50 (F가 끝나기 전에 이미 출발했어야 함). F 끝 바로 전·후를 가른다."""
    return course(stop(1, "10:00", "12:00", 10, km=1.0), stop(2, "13:00", "14:00", 0, km=None, fixed=True), stop(3, "14:10", "15:00", 20, km=3.0))


@pytest.mark.parametrize(
    "clock, expected", [("13:59", None), ("14:00", None), ("14:01", 11), ("14:05", 15)], ids=["F_끝_1분_전", "F_끝_정각", "F_끝_1분_뒤", "F_끝_5분_뒤"]
)
def test_A2_S15_Q1_경계_F_끝_바로_전후(clock, expected):
    # F의 시간(시작~끝) 동안 None: 끝 정각(14:00)은 F 안. 1분 뒤부터 다음 장소 기준(14:01 - 13:50 = 11분)
    result = detect(f_end_after_leave(), clock, AT1)
    assert (result.delay_min if result else None) == expected
    if result:
        assert result.k == 1


# §16 Q3: 위치 없는 고정 일정이 연달아 있으면 다음 위치 있는 장소까지 모두 건너뛴다.
# 연달은 묶음의 첫 시작부터 마지막 끝까지(사이 빈 시간 포함) None, 그 뒤는 다음 위치 있는 장소 기준.
# 묶음 끝 정각은 묶음 안(None) — §16 "F 끝 정각은 F 안"과 같은 규칙을 묶음 끝에 적용. 다음 장소 이동 분 = 그 장소의 travel_min (§16 정한 것)


def two_fixed_no_gap():
    """F1 13:00~13:30, F2 13:30~14:00 (빈 시간 0), 4번 14:10 시작·이동 20 -> leave 13:50 (묶음이 끝나기 전)."""
    return course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "13:00", "13:30", 0, km=None, fixed=True),
        stop(3, "13:30", "14:00", 0, km=None, fixed=True),
        stop(4, "14:10", "15:00", 20, km=4.0),
    )


@pytest.mark.parametrize(
    "clock, expected",
    [("13:00", None), ("13:29", None), ("13:30", None), ("13:31", None), ("13:59", None), ("14:00", None), ("14:01", 11), ("14:05", 15)],
    ids=["F1_시작", "F1_끝_1분_전", "F1_끝_정각_F2_시작", "F1_끝_1분_뒤_F2_안", "묶음_끝_1분_전", "묶음_끝_정각", "묶음_끝_1분_뒤", "묶음_끝_5분_뒤"],
)
def test_A2_S16_Q3_연달은_고정_일정_빈_시간_0_묶음_끝까지_None_뒤는_다음_장소_기준(clock, expected):
    # leave = 4번 시작 14:10 - 이동 20 = 13:50. 묶음(13:00~14:00) 안은 leave가 지났어도 None. 14:01 - 13:50 = 11분
    result = detect(two_fixed_no_gap(), clock, AT1)
    assert (result.delay_min if result else None) == expected
    if result:
        assert (result.k, result.dedupe_key) == (1, f"delay:{DAY_ID}:1")


def two_fixed_gap_30():
    """F1 13:00~13:30, 빈 시간 30분, F2 14:00~14:30, 4번 14:40 시작·이동 70 -> leave 13:30 (빈 시간이 시작될 때 이미 출발했어야 함)."""
    return course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "13:00", "13:30", 0, km=None, fixed=True),
        stop(3, "14:00", "14:30", 0, km=None, fixed=True),
        stop(4, "14:40", "15:30", 70, km=4.0),
    )


@pytest.mark.parametrize(
    "clock, expected",
    [("13:30", None), ("13:31", None), ("13:40", None), ("13:59", None), ("14:00", None), ("14:29", None), ("14:30", None), ("14:31", 61)],
    ids=["F1_끝_정각", "빈_시간_1분", "빈_시간_10분", "빈_시간_끝_1분_전", "F2_시작", "묶음_끝_1분_전", "묶음_끝_정각", "묶음_끝_1분_뒤"],
)
def test_A2_S16_Q3_연달은_고정_일정_사이_30분_빈_시간도_묶음_끝까지_None(clock, expected):
    # §16 Q3 "사이 빈 시간 포함": F1이 끝난 빈 시간(13:30~14:00)에도 F1 하나만 보고 다음 장소 기준으로 판단하지 않는다
    # (그러면 13:40에 10분 늦음이 된다). 묶음 끝(14:30) 1분 뒤부터 4번 기준: 14:31 - 13:30 = 61분
    result = detect(two_fixed_gap_30(), clock, AT1)
    assert (result.delay_min if result else None) == expected
    if result:
        assert (result.k, result.dedupe_key) == (1, f"delay:{DAY_ID}:1")


def test_A2_S16_Q3_묶음_뒤_늦어짐의_심각도는_A4_그대로():
    # 61분 >= 20 -> 높음 (A4 20분 규칙). 빈 시간 0 묶음의 11분은 뒤 고정 일정이 없으니 낮음 (이미 끝난 F는 심각도에 세지 않음, §16)
    assert detect(two_fixed_gap_30(), "14:31", AT1).severity == "high"
    assert detect(two_fixed_no_gap(), "14:01", AT1).severity == "low"


def test_A2_S14_Q1_경계_장소_없는_고정_일정_뒤의_장소_사이는_그대로_감지한다():
    # 위치 있는 장소 사이(3번 -> 4번)는 TASK-007 A2 그대로: 4번 예정 출발 = 16:00 - 30 = 15:30
    c = course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "13:00", "14:00", 0, km=None, fixed=True),
        stop(3, "14:30", "15:00", 20, km=3.0),
        stop(4, "16:00", "17:00", 30, km=4.0),
    )
    assert detect(c, "15:39", AT3) is None
    found = detect(c, "15:40", AT3)
    assert (found.k, found.delay_min) == (3, 10)


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


def placeless_after_next(travel: int):
    """2번(장소) 다음 3번이 위치 없는 고정 일정 13:10. 1번 예정 출발 12:00.
    늦은 만큼 2번을 밀면 2번 끝 = 13:00 + 늦은 분. 이동 시간 없이 시작 시각만으로 보면 10분 늦음까지 13:10에 딱 맞고, 11분이면 1분 늦는다."""
    return course(
        stop(1, "10:00", "12:00", 10, km=1.0),
        stop(2, "12:30", "13:00", 30, km=2.0),
        stop(3, "13:10", "14:00", travel, km=None, fixed=True),
        stop(4, "14:30", "15:00", 20, km=3.0),
    )


@pytest.mark.parametrize("travel", [0, 15], ids=["이동_0", "이동_15"])
@pytest.mark.parametrize("clock, severity", [("12:10", "low"), ("12:11", "high")], ids=["10분_딱_맞음", "11분_1분_늦음"])
def test_A4_S14_Q1_장소_없는_고정_일정도_고정_일정이고_이동_시간_없이_시작_시각만으로(travel, clock, severity):
    # TASK-014 §14 Q1 (승인된 변경, 전: k+1이 장소 없는 고정 일정인 코스로 13:10 높음): A4 — 위치 없는 고정 일정은 이동 시간 없이
    # 시작 시각만으로 "늦음"(§11 Q2처럼 차례로 밀어서, 앞 일정 끝이 그 시작을 넘으면). 이동 분 값이 있어도 더하지 않는다 (이동_15)
    result = detect(placeless_after_next(travel), clock, AT1)
    assert result.delay_min < 20  # 시험 자체 확인: 20분 규칙이 아니라 고정 일정 규칙으로 갈린다
    assert (result.k, result.severity) == (1, severity)


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
