"""방향 버튼 고르기. 근거: TASK-002 §3 E, AC-7, §7 Q5·Q7·Q8."""

from datetime import datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_helpers import BASE, MONDAY_EVENING, as_places, north_of, opening, place

from engine.models import Reactions
from engine.planning import pick_directions

NOBODY = Reactions(liked=[], skipped=[])
ALL = {"quieter", "closer", "cheaper", "different", "photo", "indoor", "food", "night"}


def calm(pid="B1", **kw):
    """규칙 1에 걸리지 않는 묶음 장소 (한적, 쌈, 숙소 앞)."""
    defaults = dict(crowd=1, price=1, km=0.0, category="walk")
    return place(pid, **{**defaults, **kw})


def only(direction, count, start=1):
    """남은 후보 중 한 방향에만 맞는 곳 count개."""
    kw = {
        "photo": dict(category="walk", tags=("사진",)),
        "indoor": dict(category="walk", tags=("실내",)),
        "food": dict(category="food"),
        "night": dict(category="walk", tags=("야경",)),
    }[direction]
    return [place(f"{direction}{i}", **kw) for i in range(start, start + count)]


def pick(batch, remaining=(), last=None, reactions=NOBODY, anchor=BASE, at=MONDAY_EVENING, known=()):
    """§8 Q22·Q23: batch·remaining은 Place 목록, places에는 이전 묶음의 장소(known)까지 들어 있다."""
    places = as_places(*batch, *remaining, *known)
    return pick_directions(list(batch), list(remaining), reactions, places, last, anchor, at)


# ---------- 규칙 1: 묶음 평균 (기준 양쪽) ----------


@pytest.mark.parametrize(
    "crowds, expected",
    [([3, 3, 3], ["quieter"]), ([2, 3, 4], ["quieter"]), ([3, 3, 2], [])],
    ids=["모두3", "평균이_정확히3", "평균_3미만"],
)
def test_AC07_규칙1_평균_붐빔_3_이상이면_quieter(crowds, expected):
    batch = [calm(f"B{i}", crowd=c) for i, c in enumerate(crowds)]
    assert pick(batch) == expected


@pytest.mark.parametrize(
    "prices, expected",
    [([3, 3, 3], ["cheaper"]), ([2, 3, 4], ["cheaper"]), ([3, 3, 2], [])],
    ids=["모두3", "평균이_정확히3", "평균_3미만"],
)
def test_AC07_규칙1_평균_가격_3_이상이면_cheaper(prices, expected):
    batch = [calm(f"B{i}", price=p) for i, p in enumerate(prices)]
    assert pick(batch) == expected


@pytest.mark.parametrize(
    "distances, expected",
    [
        ([1.0 + 1e-6, 1.0 + 1e-6], ["closer"]),
        ([0.4, 1.7], ["closer"]),
        ([1.0 - 1e-6, 1.0 - 1e-6], []),
        ([0.3, 1.6], []),
    ],
    ids=["1km_바로_바깥", "평균1점05", "1km_바로_안쪽", "평균0점95"],
)
def test_AC07_규칙1_평균_거리_1km_넘으면_closer(distances, expected):
    batch = [calm(f"B{i}", km=km) for i, km in enumerate(distances)]
    assert pick(batch) == expected


def test_Q5_거리는_넘겨받은_기준점에서_잰다():
    batch = [calm("B1", km=1.5), calm("B2", km=1.5)]
    assert pick(batch, anchor=north_of(1.5)) == []


def test_AC07_규칙1_순서는_quieter_closer_cheaper():
    batch = [calm("B1", crowd=4, price=4, km=2.0)]
    assert pick(batch) == ["quieter", "closer", "cheaper"]


# ---------- 규칙 2: 남은 후보 3곳 이상 ----------


def test_AC07_규칙1이_셋이면_규칙2를_보지_않음():
    batch = [calm("B1", crowd=4, price=4, km=2.0)]
    remaining = only("photo", 3)
    assert pick(batch, remaining) == ["quieter", "closer", "cheaper"]


def test_AC07_규칙1_다음에_규칙2로_채움():
    batch = [calm("B1", crowd=4)]
    remaining = only("night", 3) + only("indoor", 3) + only("photo", 3)
    assert pick(batch, remaining, last="different") == ["quieter", "photo", "indoor"]


def test_AC07_규칙2_순서는_photo_indoor_food_night_최대3개():
    remaining = only("night", 3) + only("food", 3) + only("indoor", 3) + only("photo", 3)
    assert pick([calm()], remaining, last="different") == ["photo", "indoor", "food"]


@pytest.mark.parametrize("count, expected", [(2, ["quieter", "closer"]), (3, ["quieter", "closer", "photo"])])
def test_AC07_규칙2_남은후보_3곳_경계(count, expected):
    batch = [calm("B1", crowd=4, km=2.0)]
    assert pick(batch, only("photo", count), last="different") == expected


def test_AC07_규칙2는_묶음이_아니라_남은_후보를_센다():
    batch = [calm(f"B{i}", tags=("사진",)) for i in range(6)]
    assert pick(batch, [], last="different") == []


@pytest.mark.parametrize(
    "at, close_at, expected",
    [
        (MONDAY_EVENING, "19:01", ["night"]),
        (MONDAY_EVENING, "26:00", ["night"]),
        (MONDAY_EVENING, "19:00", []),
        (datetime(2026, 11, 10, 18, 0), "19:01", []),
    ],
    ids=["19시01분", "26시", "19시_정각", "그_요일_아님"],
)
def test_Q5_night는_그_요일에_19시보다_늦게_닫는_구간(at, close_at, expected):
    remaining = [place(f"N{i}", "walk", hours=opening("10:00", close_at, 0)) for i in range(3)]
    assert pick([calm()], remaining, last="different", at=at) == expected


def test_different는_묶음에서_좋아한_곳_태그와_겹치면_세지_않음():
    liked = calm("B1", tags=("골목",))
    reactions = Reactions(liked=["B1"], skipped=[])
    overlapping = [place(f"O{i}", "walk", tags=("골목",)) for i in range(3)]
    fresh = [place(f"F{i}", "walk", tags=("자연",)) for i in range(3)]
    assert "different" not in pick([liked], overlapping, reactions=reactions)
    assert "different" in pick([liked], fresh, reactions=reactions)


def test_Q23_different는_이전_묶음에서_좋아한_곳도_places에서_찾아_따짐():
    liked = place("H1", "walk", tags=("골목",))  # batch·remaining에는 없고 places에만 있음
    reactions = Reactions(liked=["H1"], skipped=[])
    overlapping = [place(f"O{i}", "walk", tags=("골목",)) for i in range(3)]
    fresh = [place(f"F{i}", "walk", tags=("자연",)) for i in range(3)]
    assert "different" not in pick([calm()], overlapping, reactions=reactions, known=[liked])
    assert "different" in pick([calm()], fresh, reactions=reactions, known=[liked])


def test_Q24_좋아한_곳이_없으면_different에_맞는_곳_없음():
    remaining = [place(f"R{i}", "walk") for i in range(3)]
    assert pick([calm()], remaining) == []


@pytest.mark.parametrize(
    "count, expected",
    [(2, ["quieter", "closer"]), (3, ["quieter", "closer", "different"])],
)
def test_Q24_different도_규칙2_남은후보_3곳_경계(count, expected):
    liked = place("H1", "walk", tags=("골목",))
    reactions = Reactions(liked=["H1"], skipped=[])
    remaining = [place(f"F{i}", "walk", tags=("자연",)) for i in range(count)]
    batch = [calm("B1", crowd=4, km=2.0)]
    assert pick(batch, remaining, reactions=reactions, known=[liked]) == expected


def test_Q24_규칙2에서_different가_photo보다_먼저():
    liked = place("H1", "walk", tags=("골목",))
    reactions = Reactions(liked=["H1"], skipped=[])
    # 사진 태그 3곳은 좋아한 태그와 안 겹쳐 different에도 photo에도 맞는다
    result = pick([calm()], only("photo", 3), reactions=reactions, known=[liked])
    assert result == ["different", "photo"]


@pytest.mark.parametrize(
    "remaining",
    [[], only("photo", 3)],
    ids=["남은후보_없음", "남은후보_있음"],
)
def test_Q37_빈_묶음이면_빈_목록(remaining):
    assert pick([], remaining, last="different") == []


# ---------- §7 Q7: 그래도 2개 미만이면 1곳 이상으로 ----------


def test_Q7_0개면_1곳_이상인_방향을_순서대로_채움():
    remaining = only("photo", 1) + only("food", 1) + only("night", 1)
    # 2개에서 멈추는지 3개까지 채우는지는 남은 질문 Q41. 둘 다 허용
    assert pick([calm()], remaining, last="different") in (["photo", "food"], ["photo", "food", "night"])


def test_Q7_규칙2로_1개면_1곳_이상으로_채움():
    remaining = only("photo", 3) + only("indoor", 1) + only("food", 1)
    # 남은 질문 Q41. 둘 다 허용
    assert pick([calm()], remaining, last="different") in (["photo", "indoor"], ["photo", "indoor", "food"])


def test_Q7_규칙1로_1개면_1곳_이상으로_하나_더():
    batch = [calm("B1", crowd=4)]
    assert pick(batch, only("photo", 1), last="different") == ["quieter", "photo"]


def test_Q7_모자라면_있는_만큼_1개():
    assert pick([calm()], only("photo", 1), last="different") == ["photo"]


def test_Q7_맞는_방향이_없으면_빈_목록():
    assert pick([calm()], [], last="different") == []


def test_Q7_채울_때_규칙1의_방향은_쓰지_않음():
    # 남은 후보가 한적·쌈·가까움이어도 규칙 2 순서의 방향만 채운다
    remaining = [place("R1", "walk", crowd=1, price=1, km=0.0)]
    assert pick([calm()], remaining, last="different") == []


# ---------- 직전 방향 ----------


@pytest.mark.parametrize(
    "last, batch_kw, expected",
    [
        ("quieter", dict(crowd=4), []),
        ("closer", dict(km=2.0), []),
        ("cheaper", dict(price=4), []),
    ],
)
def test_AC07_직전_방향은_규칙1에서_빠짐(last, batch_kw, expected):
    assert pick([calm("B1", **batch_kw)], last=last) == expected


@pytest.mark.parametrize(
    "last, expected",
    [
        ("photo", ["indoor", "food", "night"]),
        ("indoor", ["photo", "food", "night"]),
        ("food", ["photo", "indoor", "night"]),
    ],
)
def test_AC07_직전_방향은_규칙2에서_빠지고_다음_방향으로_3개(last, expected):
    remaining = only("photo", 3) + only("indoor", 3) + only("food", 3) + only("night", 3)
    assert pick([calm()], remaining, last=last) == expected


def test_AC07_규칙1이_셋이고_하나가_직전이면_나머지는_순서대로_남음():
    batch = [calm("B1", crowd=4, price=4, km=2.0)]
    assert pick(batch, last="quieter") == ["closer", "cheaper"]


def test_Q25_직전을_먼저_빼고_모자란_자리를_규칙2로_채움():
    batch = [calm("B1", crowd=4, price=4, km=2.0)]
    assert pick(batch, only("photo", 3), last="quieter") == ["closer", "cheaper", "photo"]


# ---------- 속성 ----------

kwargs = st.fixed_dictionaries(
    {
        "category": st.sampled_from(["walk", "food", "museum", "cafe"]),
        "km": st.integers(0, 300).map(lambda v: v / 100),
        "crowd": st.integers(1, 5),
        "price": st.integers(1, 4),
        "tags": st.lists(st.sampled_from(["사진", "실내", "야경", "골목"]), unique=True, max_size=2).map(tuple),
    }
)


@settings(max_examples=200, deadline=None)
@given(
    st.lists(kwargs, min_size=1, max_size=6),
    st.lists(kwargs, max_size=12),
    st.none() | st.sampled_from(sorted(ALL)),
)
def test_AC07_임의_입력에서_최대3개_중복없음_직전없음(batch_raw, remaining_raw, last):
    batch = [place(f"B{i}", **kw) for i, kw in enumerate(batch_raw)]
    remaining = [place(f"R{i}", **kw) for i, kw in enumerate(remaining_raw)]

    result = pick(batch, remaining, last=last)

    assert len(result) <= 3
    assert len(result) == len(set(result))
    assert set(result) <= ALL
    assert last not in result
    assert result == pick(batch, remaining, last=last)
