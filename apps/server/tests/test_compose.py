"""compose_screen 테스트. 근거: TASK-001 §4 AC-10~17, §9-1 AC-22·23, SCREEN-001 §4-1·§4-2a·§5, GRAPH-001 §6."""

from datetime import datetime, time, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from catalog import get_catalog
from engine.compose import FixedEvent, OpenEvent, PlanItem, Snapshot, compose_screen


def at(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))


def plus(t: time, minutes: int) -> time:
    return (datetime.combine(datetime(2026, 11, 3), t) + timedelta(minutes=minutes)).time()


def next_item(now: time, starts_in: int, travel_min: int = 10, **kw) -> PlanItem:
    start = plus(now, starts_in)
    return PlanItem(name="다음 장소", start=start, end=plus(start, 60), travel_min=travel_min, **kw)


def snap(now: str = "10:00", **kw) -> Snapshot:
    """아무 신호도 없는 평범한 상황. 다음 일정까지 35분(이동 10분 → 여유 25분, 출발까지 25분)."""
    t = at(now)
    base = dict(
        now=t,
        current_item=PlanItem(name="지금 장소", start=plus(t, -30), end=plus(t, 20)),
        next_item=next_item(t, starts_in=35),
        walked_km=2.0,
        remaining_items=3,
    )
    base.update(kw)
    return Snapshot(**base)


def lunch_signal(now: str = "12:10") -> dict:
    """강한 신호(식사): 식사 시간대 + 이번 끼니 안 먹음 + 식사 아닌 다음 일정까지 80분."""
    return dict(now=now, meal_eaten=False, next_item=next_item(at(now), starts_in=80, is_meal=False))


# ---------- §4-1 우선순위 표 ----------


@pytest.mark.parametrize(
    "extra",
    [
        dict(offline=True),
        dict(fixed_event=FixedEvent(name="공연", leave_by=at("10:05")), open_events=[OpenEvent(kind="delay")]),
        dict(chat_pick="T-09"),
        dict(moving=True, walked_km=12.0, rain_prob_2h=0.9, outdoor_remaining=True),
    ],
    ids=["오프라인", "고정일정_늦어짐", "대화가_고름", "이동중_강한신호"],
)
def test_AC14_안전이면_무조건_SOS(extra):
    screen = compose_screen(snap(safety=True, **extra))
    assert screen.main == "X-01"


def test_순위1_오프라인이면_지금할일과_오프라인띠():
    screen = compose_screen(
        snap(offline=True, fixed_event=FixedEvent(name="공연", leave_by=at("10:05")))
    )
    assert screen.main == "T-01"
    assert "X-02" in screen.subs


def test_AC10_고정일정_12분전이면_늦어짐보다_먼저():
    screen = compose_screen(
        snap(fixed_event=FixedEvent(name="공연", leave_by=at("10:12")), open_events=[OpenEvent(kind="delay")])
    )
    assert screen.main == "T-07"
    assert screen.subs == ["T-02"]


@pytest.mark.parametrize("minutes, expected", [(15, "T-07"), (16, "T-04")])
def test_순위2_고정일정_15분_경계(minutes, expected):
    screen = compose_screen(
        snap(
            fixed_event=FixedEvent(name="공연", leave_by=plus(at("10:00"), minutes)),
            open_events=[OpenEvent(kind="delay")],
        )
    )
    assert screen.main == expected


def test_순위3_늦어짐_고정일정_있으면_보조에_T07():
    screen = compose_screen(
        snap(fixed_event=FixedEvent(name="공연", leave_by=at("13:00")), open_events=[OpenEvent(kind="delay")])
    )
    assert screen.main == "T-04"
    assert screen.subs == ["T-07", "T-03"]


def test_순위3_늦어짐_고정일정_없으면_보조는_남은일정만():
    screen = compose_screen(snap(open_events=[OpenEvent(kind="delay")]))
    assert screen.main == "T-04"
    assert screen.subs == ["T-03"]


def test_순위3이_순위4보다_먼저_늦어짐과_닫힘():
    screen = compose_screen(snap(open_events=[OpenEvent(kind="closed"), OpenEvent(kind="delay")]))
    assert screen.main == "T-04"


def test_순위4_닫힘확인이면_닫힘대안():
    screen = compose_screen(snap(open_events=[OpenEvent(kind="closed")]))
    assert screen.main == "T-06"
    assert screen.subs == ["T-03"]


@pytest.mark.parametrize("hours_checked, subs", [(False, ["T-05", "T-03"]), (True, ["T-03"])])
def test_순위5_이동중이면_다음이동_영업확인전이면_보조에_T05(hours_checked, subs):
    t = at("10:00")
    screen = compose_screen(snap(moving=True, next_item=next_item(t, starts_in=20, hours_checked=hours_checked)))
    assert screen.main == "T-02"
    assert screen.subs == subs


@pytest.mark.parametrize("leave_in, expected", [(10, "T-02"), (11, "T-01")])
def test_순위5_출발_10분전_경계(leave_in, expected):
    t = at("10:00")
    screen = compose_screen(snap(next_item=next_item(t, starts_in=leave_in + 10, travel_min=10)))
    assert screen.main == expected


def test_기본_아무것도_아니면_지금할일_칩없음():
    screen = compose_screen(snap())
    assert screen.main == "T-01"
    assert screen.subs == ["T-02", "T-03"]
    assert screen.chip is None


# ---------- GRAPH-001 §6 순서: 대화가 고른 카드 ----------


def test_AC15_대화가_고른카드가_이동중과_강한신호보다_먼저():
    screen = compose_screen(snap(moving=True, chat_pick="T-09", **lunch_signal()))
    assert screen.main == "T-09"
    assert screen.subs == ["T-02", "T-03"]


def test_AC15_대화가_고른카드가_늦어짐보다_먼저():
    screen = compose_screen(snap(chat_pick="T-09", open_events=[OpenEvent(kind="delay")]))
    assert screen.main == "T-09"


@pytest.mark.parametrize(
    "extra, expected",
    [
        (dict(fixed_event=FixedEvent(name="공연", leave_by=at("10:10"))), "T-07"),
        (dict(offline=True), "T-01"),
    ],
    ids=["고정일정_임박", "오프라인"],
)
def test_AC15_대화가_고른카드도_오프라인과_고정일정_임박보다는_아래(extra, expected):
    screen = compose_screen(snap(chat_pick="T-09", **extra))
    assert screen.main == expected


# ---------- §4-2a 강한 신호 ----------


def test_AC11_점심시간_안먹음_80분_여유면_먹을곳():
    screen = compose_screen(snap(**lunch_signal("12:10")))
    assert screen.main == "T-10"
    assert screen.subs == ["T-02", "T-03"]


@pytest.mark.parametrize("now", ["11:30", "18:00"])
def test_강한신호_식사_시간대_시작_경계(now):
    assert compose_screen(snap(**lunch_signal(now))).main == "T-10"


def test_강한신호_식사_14시면_시간대_밖():
    assert compose_screen(snap(**lunch_signal("14:00"))).main == "T-01"


def test_강한신호_식사_이미_먹었으면_아님():
    assert compose_screen(snap(**{**lunch_signal(), "meal_eaten": True})).main == "T-01"


def test_강한신호_식사_다음일정이_식사면_아님():
    t = at("12:10")
    screen = compose_screen(snap(**{**lunch_signal(), "next_item": next_item(t, starts_in=80, is_meal=True)}))
    assert screen.main != "T-10"


@pytest.mark.parametrize("starts_in, expected", [(45, "T-10"), (44, "T-01")])
def test_강한신호_식사_다음일정까지_45분_경계(starts_in, expected):
    t = at("12:10")
    # 이동 시간을 0으로 두어 출발 시각(순위 5)과 섞이지 않게 한다
    screen = compose_screen(snap(now="12:10", meal_eaten=False, next_item=next_item(t, starts_in=starts_in, travel_min=0)))
    assert screen.main == expected


def test_순위3_늦어짐이_강한신호보다_먼저():
    screen = compose_screen(snap(open_events=[OpenEvent(kind="delay")], **lunch_signal()))
    assert screen.main == "T-04"


def test_순위5_이동중이_강한신호보다_먼저():
    screen = compose_screen(snap(moving=True, **lunch_signal()))
    assert screen.main == "T-02"


@pytest.mark.parametrize("rain, outdoor, expected", [(0.6, True, "T-12"), (0.59, True, "T-01"), (0.9, False, "T-01")])
def test_강한신호_비_60퍼센트_이상_실외일정_남음(rain, outdoor, expected):
    screen = compose_screen(snap(rain_prob_2h=rain, outdoor_remaining=outdoor))
    assert screen.main == expected
    if expected == "T-12":
        assert screen.subs == ["T-03"]


@pytest.mark.parametrize("km, starts_in, expected", [(10.0, 40, "T-09"), (9.9, 40, "T-01"), (10.0, 29, "T-01")])
def test_강한신호_10km_이상_다음일정까지_30분_이상(km, starts_in, expected):
    t = at("15:00")
    screen = compose_screen(snap(now="15:00", walked_km=km, next_item=next_item(t, starts_in=starts_in, travel_min=0)))
    assert screen.main == expected
    if expected == "T-09":
        assert screen.subs == ["T-02", "T-03"]


def test_AC13_남은일정없음_21시면_숙소가는법():
    screen = compose_screen(snap(now="21:00", current_item=None, next_item=None, remaining_items=0))
    assert screen.main == "T-08"
    assert screen.subs == []


# ---------- §4-2a 약한 신호 → 제안 칩 ----------


def test_AC12_9km_여유50분이면_메인은_그대로_쉴곳_칩():
    t = at("14:20")
    screen = compose_screen(snap(now="14:20", walked_km=9.0, next_item=next_item(t, starts_in=60, travel_min=10)))
    assert screen.main == "T-01"
    assert screen.subs == ["T-02", "T-03"]
    assert screen.chip is not None
    assert screen.chip.card == "T-09"


def test_AC13_남은일정없음_16시면_지금할일과_칩():
    screen = compose_screen(snap(now="16:00", current_item=None, next_item=None, remaining_items=0))
    assert screen.main == "T-01"
    assert screen.chip is not None
    assert screen.chip.card == "T-11"  # AC-23: 18시 전 일정 끝 → 여유 시간 제안


@pytest.mark.parametrize("free_min, has_chip", [(30, True), (29, False)])
def test_약한신호_여유_30분_경계(free_min, has_chip):
    t = at("10:00")
    screen = compose_screen(snap(next_item=next_item(t, starts_in=free_min + 10, travel_min=10)))
    assert screen.main == "T-01"
    assert (screen.chip is not None) == has_chip
    if has_chip:
        assert screen.chip.card == "T-11"  # AC-23: 여유 30분 → 여유 시간 제안


def test_약한신호_식사시간대_30분전이면_칩():
    screen = compose_screen(snap(now="11:10"))
    assert screen.main == "T-01"
    assert screen.chip is not None
    assert screen.chip.card == "T-10"  # AC-23: 식사 30분 전 → 근처 먹을 곳


@pytest.mark.parametrize("now", ["11:10", "17:40"])
def test_약한신호_끼니를_이미_먹었으면_식사전_칩_없음(now):
    screen = compose_screen(snap(now=now, meal_eaten=True))
    assert screen.main == "T-01"
    assert screen.chip is None


# ---------- §9-1 AC-22 경계값 ----------


@pytest.mark.parametrize("now, expected", [("13:30", "T-10"), ("13:31", "T-01")])
def test_AC22_강한신호_식사_시간대_끝_13시30분_정각은_포함(now, expected):
    assert compose_screen(snap(**lunch_signal(now))).main == expected


@pytest.mark.parametrize(
    "now, chip_card",
    [("10:59", None), ("11:00", "T-10"), ("11:29", "T-10"), ("17:30", "T-10")],
)
def test_AC22_약한신호_식사_30분전_경계_11시_11시29분(now, chip_card):
    screen = compose_screen(snap(now=now))
    assert screen.main == "T-01"
    assert (screen.chip.card if screen.chip else None) == chip_card


@pytest.mark.parametrize("km, chip_card", [(6.9, None), (7.0, "T-09")])
def test_AC22_약한신호_7km_정각부터_쉴곳_칩(km, chip_card):
    screen = compose_screen(snap(walked_km=km))
    assert screen.main == "T-01"
    assert (screen.chip.card if screen.chip else None) == chip_card


def test_AC22_10km_정각_여유_있으면_메인이_쉴곳이고_칩은_없음():
    t = at("15:00")
    screen = compose_screen(snap(now="15:00", walked_km=10.0, next_item=next_item(t, starts_in=40, travel_min=0)))
    assert screen.main == "T-09"
    assert screen.chip is None


def test_AC22_10km_정각_다음일정까지_30분_안되면_메인은_그대로_칩없음():
    # 약한 신호는 7.0 이상 10.0 미만, 강한 신호는 10.0 이상 (PM 검토 11-03)
    t = at("15:00")
    screen = compose_screen(snap(now="15:00", walked_km=10.0, next_item=next_item(t, starts_in=29, travel_min=0)))
    assert screen.main == "T-01"
    assert screen.chip is None


@pytest.mark.parametrize("starts_in, chip_card", [(30, "T-09"), (29, None)])
def test_약한신호_7_10km는_다음일정까지_30분_이상일때만(starts_in, chip_card):
    t = at("15:00")
    screen = compose_screen(snap(now="15:00", walked_km=8.0, next_item=next_item(t, starts_in=starts_in, travel_min=0)))
    assert screen.main == "T-01"
    assert (screen.chip.card if screen.chip else None) == chip_card


@pytest.mark.parametrize("now, expected", [("17:59", "T-01"), ("18:00", "T-08")])
def test_AC22_남은일정없음_18시_정각부터_숙소가는법(now, expected):
    # 이번 끼니를 먹은 것으로 두어 식사 강한 신호와 섞이지 않게 한다
    screen = compose_screen(snap(now=now, current_item=None, next_item=None, remaining_items=0, meal_eaten=True))
    assert screen.main == expected
    if now == "17:59":
        assert screen.chip is not None
        assert screen.chip.card == "T-11"  # 남은 일정 없음 + 18:00 전


# ---------- §9-1 AC-23 약한 신호가 여러 개면 표 순서로 첫 번째 ----------
# 순서: 7~10km → T-09, 식사 30분 전 → T-10, 여유 30분 → T-11, 18시 전 일정 끝 → T-11


@pytest.mark.parametrize(
    "kw, chip_card",
    [
        (dict(now="11:10", walked_km=8.0), "T-09"),
        (dict(now="11:10", next_item=next_item(at("11:10"), starts_in=50, travel_min=10)), "T-10"),
        (dict(now="15:00", walked_km=8.0, next_item=next_item(at("15:00"), starts_in=50, travel_min=10)), "T-09"),
        (dict(now="17:40", current_item=None, next_item=None, remaining_items=0), "T-10"),
    ],
    ids=["걷기_식사전", "식사전_여유", "걷기_여유", "식사전_일정끝"],
)
def test_AC23_약한신호_여러개면_표_순서로_첫번째_칩(kw, chip_card):
    screen = compose_screen(snap(**kw))
    assert screen.main == "T-01"
    assert screen.chip is not None
    assert screen.chip.card == chip_card


# ---------- 속성 (Hypothesis) ----------

times = st.builds(time, st.integers(0, 23), st.integers(0, 59))

plan_items = st.builds(
    PlanItem,
    name=st.just("장소"),
    start=times,
    end=times,
    travel_min=st.integers(0, 120),
    is_meal=st.booleans(),
    is_outdoor=st.booleans(),
    hours_checked=st.booleans(),
)

snapshots = st.builds(
    Snapshot,
    now=times,
    offline=st.booleans(),
    safety=st.booleans(),
    current_item=st.none() | plan_items,
    next_item=st.none() | plan_items,
    fixed_event=st.none() | st.builds(FixedEvent, name=st.just("고정"), leave_by=times),
    open_events=st.lists(st.builds(OpenEvent, kind=st.sampled_from(["delay", "closed"])), max_size=3),
    walked_km=st.floats(0, 30, allow_nan=False),
    meal_eaten=st.booleans(),
    rain_prob_2h=st.floats(0, 1, allow_nan=False),
    outdoor_remaining=st.booleans(),
    remaining_items=st.integers(0, 10),
    # 대화가 고를 수 있는 카드 (SCREEN-001 §4-3 보기)
    chat_pick=st.none() | st.sampled_from(["T-02", "T-03", "T-04", "T-08", "T-09", "T-10", "T-11", "T-13"]),
    moving=st.booleans(),
    arriving=st.booleans(),
)


@given(snapshots)
def test_AC16_어떤_상황이든_화면_구성_규칙을_지킴(s):
    screen = compose_screen(s)
    catalog_ids = {card.id for card in get_catalog()}
    cards = [screen.main, *screen.subs] + ([screen.chip.card] if screen.chip else [])

    assert isinstance(screen.main, str)
    assert len(screen.subs) <= 3
    assert len([screen.main, *screen.subs]) == len({screen.main, *screen.subs})
    assert set(cards) <= catalog_ids


@given(snapshots)
def test_AC17_같은_입력이면_같은_결과(s):
    assert compose_screen(s) == compose_screen(s.model_copy(deep=True))


# ---------- TASK-002 A: T-05 영업 확인 조건 (SCREEN-001 §4-1 순위 6) ----------


@pytest.mark.parametrize(
    "arriving, hours_checked, expected",
    [(True, False, "T-05"), (True, True, "T-01"), (False, False, "T-01")],
    ids=["도착직전_확인안함", "도착직전_확인함", "도착직전_아님"],
)
def test_TASK002_A_T05는_도착직전이고_영업확인_안했을때만(arriving, hours_checked, expected):
    t = at("10:00")
    screen = compose_screen(
        snap(arriving=arriving, next_item=next_item(t, starts_in=60, travel_min=10, hours_checked=hours_checked))
    )
    assert screen.main == expected
    if expected == "T-05":
        assert screen.subs == ["T-02"]


def test_TASK002_A_T05는_다음_일정이_없으면_아님():
    assert compose_screen(snap(arriving=True, next_item=None)).main == "T-01"


def test_TASK002_A_T02가_T05보다_먼저():
    t = at("10:00")
    screen = compose_screen(snap(moving=True, arriving=True, next_item=next_item(t, starts_in=60)))
    assert screen.main == "T-02"


def test_TASK002_A_T05가_일정끝_T08보다_먼저():
    t = at("21:00")
    screen = compose_screen(snap(now="21:00", arriving=True, remaining_items=0, next_item=next_item(t, starts_in=60)))
    assert screen.main == "T-05"


# ---------- TASK-002 A: 이동 상태 (SCREEN-001 §4-4) ----------


@pytest.mark.parametrize(
    "starts_in, travel_min, events, expected",
    [
        (35, 10, ["delay"], "delayed"),
        (60, 10, ["delay"], "delayed"),
        (None, 0, ["delay"], "delayed"),
        (35, 10, ["closed"], "on_track"),
        (60, 10, ["closed"], "free"),
        (None, 0, [], "free"),
        (40, 10, [], "free"),
        (39, 10, [], "on_track"),
        (5, 10, [], "on_track"),
    ],
    ids=[
        "늦어짐",
        "늦어짐이_여유보다_먼저",
        "늦어짐이_다음일정_없음보다_먼저",
        "닫힘은_늦어짐이_아님_여유적음",
        "닫힘은_늦어짐이_아님_여유많음",
        "다음일정_없음",
        "여유_30분_정각",
        "여유_29분",
        "여유_음수",
    ],
)
def test_TASK002_A_이동상태(starts_in, travel_min, events, expected):
    t = at("10:00")
    item = None if starts_in is None else next_item(t, starts_in=starts_in, travel_min=travel_min)
    screen = compose_screen(snap(next_item=item, open_events=[OpenEvent(kind=kind) for kind in events]))
    assert screen.move_status == expected


# ---------- TASK-002 A: 보조 카드 짝 표 (SCREEN-001 §5). T-14는 §7 Q19로 제외 ----------


FAR_FIXED = FixedEvent(name="공연", leave_by=at("13:00"))


@pytest.mark.parametrize(
    "extra, main, subs",
    [
        (dict(), "T-01", ["T-02", "T-03"]),
        (dict(chat_pick="T-02", next_item=next_item(at("10:00"), starts_in=60)), "T-02", ["T-05", "T-03"]),
        (
            dict(chat_pick="T-02", next_item=next_item(at("10:00"), starts_in=60, hours_checked=True)),
            "T-02",
            ["T-03"],
        ),
        (dict(chat_pick="T-02", next_item=None), "T-02", ["T-03"]),
        (dict(chat_pick="T-04", fixed_event=FAR_FIXED), "T-04", ["T-07", "T-03"]),
        (dict(chat_pick="T-04"), "T-04", ["T-03"]),
        (dict(open_events=[OpenEvent(kind="closed")]), "T-06", ["T-03"]),
        (dict(fixed_event=FixedEvent(name="공연", leave_by=at("10:15"))), "T-07", ["T-02"]),
        (dict(chat_pick="T-08"), "T-08", []),
        (dict(chat_pick="T-09"), "T-09", ["T-02", "T-03"]),
        (dict(chat_pick="T-10"), "T-10", ["T-02", "T-03"]),
        (dict(chat_pick="T-11"), "T-11", ["T-02", "T-03"]),
        (dict(rain_prob_2h=0.6, outdoor_remaining=True), "T-12", ["T-03"]),
        (dict(chat_pick="T-13"), "T-13", ["T-01"]),
        (dict(offline=True), "T-01", ["X-02", "T-02", "T-03"]),
    ],
    ids=[
        "T01",
        "T02_확인전",
        "T02_확인후",
        "T02_다음일정없음",
        "T04_고정있음",
        "T04_고정없음",
        "T06",
        "T07",
        "T08",
        "T09",
        "T10",
        "T11",
        "T12",
        "T13",
        "오프라인",
    ],
)
def test_TASK002_A_짝표_보조카드(extra, main, subs):
    screen = compose_screen(snap(**extra))
    assert screen.main == main
    assert screen.subs == subs


def test_TASK002_Q40_대화가_고른_T03의_보조는_T02():
    screen = compose_screen(snap(chat_pick="T-03"))
    assert screen.main == "T-03"
    assert screen.subs == ["T-02"]


WEAK_SIGNALS = [
    dict(walked_km=8.0),
    dict(now="11:10"),
    dict(next_item=next_item(at("10:00"), starts_in=40, travel_min=10)),
]
WEAK_IDS = ["7_10km", "식사전", "여유30분"]


@pytest.mark.parametrize("kw", WEAK_SIGNALS, ids=WEAK_IDS)
def test_TASK002_Q40_SOS는_보조와_칩이_없음(kw):
    screen = compose_screen(snap(safety=True, **kw))
    assert screen.main == "X-01"
    assert screen.subs == []
    assert screen.chip is None


@pytest.mark.parametrize("kw", WEAK_SIGNALS, ids=WEAK_IDS)
def test_TASK002_Q40_오프라인이면_약한신호가_있어도_칩이_없음(kw):
    screen = compose_screen(snap(offline=True, **kw))
    assert screen.main == "T-01"
    assert screen.subs == ["X-02", "T-02", "T-03"]
    assert screen.chip is None


@pytest.mark.parametrize("pick", ["T-01", "T-05", "T-14", "X-01"])
def test_TASK002_A_대화가_고를수_없는_카드는_무시(pick):
    assert compose_screen(snap(chat_pick=pick)).main == "T-01"


# ---------- TASK-002 A: 시간대 경계 (SCREEN-001 §4-2a) ----------


@pytest.mark.parametrize(
    "now, expected",
    [("11:29", "T-01"), ("17:59", "T-01"), ("20:00", "T-10"), ("20:01", "T-01")],
)
def test_TASK002_A_식사_시간대_양쪽_경계_20시_포함(now, expected):
    assert compose_screen(snap(**lunch_signal(now))).main == expected


@pytest.mark.parametrize("now", ["11:30", "18:00"])
def test_TASK002_A_식사_시간대_시작_정각은_식사전_칩이_아님(now):
    # 다음 일정까지 44분이라 강한 신호는 아니고, 여유 44분이라 둘러볼 곳 칩
    t = at(now)
    screen = compose_screen(snap(now=now, next_item=next_item(t, starts_in=44, travel_min=0)))
    assert screen.main == "T-01"
    assert screen.chip is not None
    assert screen.chip.card == "T-11"


def test_TASK002_A_저녁_시간대_31분전은_칩_없음():
    assert compose_screen(snap(now="17:29")).chip is None


# ---------- TASK-002 A: 기준 값의 나머지 경계 (SCREEN-001 §4-1·§4-2a·§4-4) ----------


def test_TASK002_A_고정일정_출발시각이_지났어도_임박():
    screen = compose_screen(snap(fixed_event=FixedEvent(name="공연", leave_by=at("09:50"))))
    assert screen.main == "T-07"


def test_TASK002_A_출발시각이_지났으면_다음이동():
    t = at("10:00")
    assert compose_screen(snap(next_item=next_item(t, starts_in=5, travel_min=10))).main == "T-02"


def test_TASK002_A_10km_다음일정까지_30분_정각이면_쉴곳():
    t = at("15:00")
    screen = compose_screen(snap(now="15:00", walked_km=10.0, next_item=next_item(t, starts_in=30, travel_min=0)))
    assert screen.main == "T-09"


@pytest.mark.parametrize(
    "kw, main, chip_card",
    [
        (dict(now="12:10"), "T-10", None),
        (dict(now="15:00", walked_km=10.0), "T-09", None),
        (dict(now="15:00", walked_km=8.0), "T-01", "T-09"),
    ],
    ids=["식사", "10km", "7_10km"],
)
def test_TASK002_A_다음일정이_없으면_N분_이상_조건은_참(kw, main, chip_card):
    screen = compose_screen(snap(next_item=None, **kw))
    assert screen.main == main
    assert (screen.chip.card if screen.chip else None) == chip_card


def test_TASK002_A_남은일정이_있으면_21시여도_숙소가는법_아님():
    screen = compose_screen(snap(now="21:00", next_item=None, remaining_items=1))
    assert screen.main == "T-01"
    assert screen.chip is None


def test_TASK002_A_남은일정이_있으면_18시전_일정끝_칩_없음():
    screen = compose_screen(snap(now="15:00", next_item=None, remaining_items=1))
    assert screen.main == "T-01"
    assert screen.chip is None


@pytest.mark.parametrize(
    "kw, card, label",
    [
        (dict(walked_km=8.0), "T-09", "근처 쉴 곳 볼래?"),
        (dict(now="11:10"), "T-10", "근처 먹을 곳 볼래?"),
        (dict(next_item=next_item(at("10:00"), starts_in=40, travel_min=10)), "T-11", "근처 둘러볼 곳 볼래?"),
    ],
    ids=["쉴곳", "먹을곳", "둘러볼곳"],
)
def test_TASK002_A_제안칩_문구(kw, card, label):
    chip = compose_screen(snap(**kw)).chip
    assert chip is not None
    assert (chip.card, chip.label) == (card, label)
