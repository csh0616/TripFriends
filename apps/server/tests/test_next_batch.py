"""다음 묶음. 근거: TASK-002 §3 C 거르기 표, §3 D, AC-5·6, §7 Q2·Q5·Q6·Q8."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_helpers import BASE, MONDAY_EVENING, as_places, north_of, opening, place

from engine.models import Opening, Reactions
from engine.planning import next_batch, score_candidates

NOBODY = Reactions(liked=[], skipped=[])


def batch_of(places, direction=None, shown=(), reactions=NOBODY, k=6):
    return next_batch(places, reactions, direction, list(shown), BASE, MONDAY_EVENING, k=k)


def many(count, start=1, **kw):
    return [place(f"D{i:02d}", **kw) for i in range(start, start + count)]


# ---------- AC-5: 보여 준 곳 제외, 크기, 동점 ----------


def test_AC05_이미_보여준_곳은_다시_나오지_않음():
    places = as_places(*many(10))
    batch = batch_of(places, shown=["D01", "D02", "D03"])
    assert batch.place_ids == ["D04", "D05", "D06", "D07", "D08", "D09"]


def test_AC05_크기는_k를_넘지_않음():
    assert batch_of(as_places(*many(10)), k=5).place_ids == ["D01", "D02", "D03", "D04", "D05"]


def test_AC05_Q2_동점은_id_숫자_순서():
    places = as_places(*[place(pid) for pid in ["P10", "P2", "P1", "P12", "P3", "P11"]])
    assert batch_of(places).place_ids == ["P1", "P2", "P3", "P10", "P11", "P12"]


def test_점수가_높은_곳이_먼저():
    liked = place("H1", "walk", tags=("골목",))
    places = as_places(
        liked, *many(5), place("D06", tags=("골목",))  # D06만 좋아한 태그와 겹침 (+1)
    )
    batch = batch_of(places, shown=["H1"], reactions=Reactions(liked=["H1"], skipped=[]))
    assert batch.place_ids == ["D06", "D01", "D02", "D03", "D04", "D05"]


def test_방향을_안_주면_거르지_않음():
    batch = batch_of(as_places(*many(6)))
    assert batch.direction is None
    assert batch.direction_relaxed is False
    assert batch.exhausted is False


# ---------- §7 Q6: 남은 후보 경계 ----------


@pytest.mark.parametrize(
    "pool, size, exhausted",
    [(0, 0, True), (4, 4, True), (5, 5, False), (6, 6, False), (7, 6, False)],
)
def test_Q6_남은후보_5개_미만이면_exhausted(pool, size, exhausted):
    batch = batch_of(as_places(*many(pool)))
    assert len(batch.place_ids) == size
    assert batch.exhausted is exhausted


def test_Q6_남은후보_5개_미만이면_방향과_상관없이_전부():
    places = as_places(place("D01", crowd=2), *many(3, start=2, crowd=5))
    batch = batch_of(places, direction="quieter")
    assert batch.place_ids == ["D01", "D02", "D03", "D04"]
    assert batch.exhausted is True
    assert batch.direction == "quieter"
    assert batch.direction_relaxed is True


@pytest.mark.parametrize(
    "crowds, direction, relaxed",
    [
        ([1, 1, 1, 1], "quieter", False),
        ([1, 1, 1, 5], "quieter", True),
        ([5, 5, 5, 5], "quieter", True),
        ([], "quieter", False),
        ([5, 5, 5, 5], None, False),
    ],
    ids=["모두_맞음", "하나_안맞음", "모두_안맞음", "남은후보_없음", "방향_없음"],
)
def test_Q39_남은후보_5개_미만이면_안맞는_곳이_섞일때만_relaxed(crowds, direction, relaxed):
    places = as_places(*[place(f"D{i:02d}", crowd=c) for i, c in enumerate(crowds, start=1)])
    batch = batch_of(places, direction=direction)
    assert set(batch.place_ids) == set(places)
    assert batch.exhausted is True
    assert batch.direction == direction
    assert batch.direction_relaxed is relaxed


def test_Q47_남은후보_5개_미만이면_맞는_곳이_id가_뒤여도_먼저():
    places = as_places(*[place(f"D{i:02d}", crowd=c) for i, c in enumerate([5, 5, 1, 1], start=1)])
    assert batch_of(places, direction="quieter").place_ids == ["D03", "D04", "D01", "D02"]


def test_Q47_남은후보_5개_미만이면_맞는_곳_점수순_다음_나머지_점수순():
    # 좋아한 곳: 붐빔 3, 가격 3, 태그 골목. 점수 D01 −0.5, D02 +0.5, D03 0, D04 +1
    liked = place("H1", "walk", crowd=3, tags=("골목",))
    places = as_places(
        liked,
        place("D01", crowd=2),
        place("D02", crowd=2, tags=("골목",)),
        place("D03", crowd=3),
        place("D04", crowd=3, tags=("골목",)),
    )
    batch = batch_of(places, direction="quieter", shown=["H1"], reactions=Reactions(liked=["H1"], skipped=[]))
    assert batch.place_ids == ["D02", "D01", "D04", "D03"]
    assert batch.direction_relaxed is True


@pytest.mark.parametrize("k, allowed", [(4, False), (5, True), (6, True), (7, False)])
def test_Q39_k는_5또는_6만_받음(k, allowed):
    places = as_places(*many(8))
    if allowed:
        assert len(batch_of(places, k=k).place_ids) == k
    else:
        with pytest.raises(ValueError):
            batch_of(places, k=k)


def test_Q24_좋아한_곳이_없으면_different는_맞는_곳이_없어_거르지_않고_채움():
    batch = batch_of(as_places(*many(8)), direction="different")
    assert batch.direction == "different"
    assert batch.direction_relaxed is True
    assert batch.place_ids == ["D01", "D02", "D03", "D04", "D05", "D06"]


# ---------- AC-6, §7 Q6: 방향 결과가 모자랄 때 ----------


def quiet_and_crowded(quiet_count, crowded_count=8):
    """붐비는 곳의 id가 앞. 방향으로 먼저 거른 곳이 앞에 오는지 볼 수 있다."""
    return as_places(
        *many(crowded_count, crowd=5),
        *many(quiet_count, start=crowded_count + 1, crowd=1),
    )


def test_AC06_방향_결과_0개면_무시하고_점수순으로_채움():
    batch = batch_of(quiet_and_crowded(0), direction="quieter")
    assert batch.direction_relaxed is True
    assert batch.direction == "quieter"
    assert batch.place_ids == ["D01", "D02", "D03", "D04", "D05", "D06"]


def test_Q6_방향_결과_4개면_그것부터_넣고_나머지로_채움():
    batch = batch_of(quiet_and_crowded(4), direction="quieter")
    assert batch.direction_relaxed is True
    assert batch.direction == "quieter"
    assert batch.place_ids == ["D09", "D10", "D11", "D12", "D01", "D02"]


def test_Q6_방향_결과_5개면_채우지_않음():
    batch = batch_of(quiet_and_crowded(5), direction="quieter")
    assert batch.direction_relaxed is False
    assert batch.direction == "quieter"
    assert batch.place_ids == ["D09", "D10", "D11", "D12", "D13"]


def test_Q6_방향_결과가_k보다_많으면_k개만():
    batch = batch_of(quiet_and_crowded(7), direction="quieter")
    assert batch.direction_relaxed is False
    assert batch.place_ids == ["D09", "D10", "D11", "D12", "D13", "D14"]


def test_Q6_채워도_남은후보보다_많아지지_않음():
    places = as_places(*many(4, crowd=5), place("D05", crowd=1))
    batch = batch_of(places, direction="quieter")
    assert batch.direction_relaxed is True
    assert batch.place_ids == ["D05", "D01", "D02", "D03", "D04"]


# ---------- §3 C 거르기 표: 기준 양쪽 ----------

MONDAY_ID = 0
TUESDAY_ID = 1

# (방향, 남는 곳 5개, 걸러지는 곳 3개). 걸러지는 곳의 id가 앞이다
FILTER_CASES = {
    "quieter_붐빔2_3": ("quieter", [dict(crowd=2)] * 3 + [dict(crowd=1)] * 2, [dict(crowd=3)] * 3),
    "cheaper_가격2_3": ("cheaper", [dict(price=2)] * 3 + [dict(price=1)] * 2, [dict(price=3)] * 3),
    "closer_1점2km_바로_안쪽과_바깥쪽": (
        "closer",
        [dict(km=1.2 - 1e-6)] * 3 + [dict(km=0.0)] * 2,
        [dict(km=1.2 + 1e-6)] * 3,
    ),
    "photo_사진_감성": (
        "photo",
        [dict(tags=("사진",))] * 3 + [dict(tags=("감성",))] * 2,
        [dict(tags=("실내",))] * 3,
    ),
    "indoor_태그와_종류": (
        "indoor",
        [dict(tags=("실내",)), dict(category="museum"), dict(category="shop"), dict(tags=("실내",)), dict(category="shop")],
        [dict(category="cafe", tags=("사진",))] * 3,
    ),
    "food_종류": ("food", [dict(category="food")] * 5, [dict(category="cafe")] * 3),
    "night_태그와_19시_이후": (
        "night",
        [
            dict(tags=("밤",)),
            dict(tags=("야경",)),
            dict(hours=opening("10:00", "19:01", MONDAY_ID)),
            dict(hours=opening("20:00", "26:00", MONDAY_ID)),
            dict(tags=("야경",), hours=opening("10:00", "12:00", MONDAY_ID)),
        ],
        [
            dict(hours=opening("10:00", "19:00", MONDAY_ID)),
            dict(hours=opening("10:00", "23:00", TUESDAY_ID)),
            dict(hours=None),
        ],
    ),
}


@pytest.mark.parametrize("case", FILTER_CASES.values(), ids=FILTER_CASES.keys())
def test_거르기표_맞는_곳만_남음(case):
    direction, keep, drop = case
    dropped = [place(f"D{i:02d}", **kw) for i, kw in enumerate(drop, start=1)]
    kept = [place(f"D{i:02d}", **kw) for i, kw in enumerate(keep, start=len(drop) + 1)]
    batch = batch_of(as_places(*dropped, *kept), direction=direction)
    assert batch.place_ids == [p.id for p in kept]
    assert batch.direction_relaxed is False


def test_거르기표_different는_좋아한_곳_태그와_하나도_안겹치는_곳():
    liked = place("H1", "walk", tags=("골목", "현지"))
    overlapping = [place(f"D{i:02d}", tags=("골목", "유명")) for i in range(1, 4)]
    fresh = [place(f"D{i:02d}", tags=("자연",)) for i in range(4, 9)]
    batch = batch_of(
        as_places(liked, *overlapping, *fresh),
        direction="different",
        shown=["H1"],
        reactions=Reactions(liked=["H1"], skipped=[]),
    )
    assert batch.place_ids == [p.id for p in fresh]
    assert batch.direction_relaxed is False


def test_거르기표_closer는_넘겨받은_기준점에서_잰다():
    # 기준점을 2km 북쪽으로 옮기면 그 근처 5곳이 남는다
    near_base = many(3, km=0.0)
    near_anchor = many(5, start=4, km=2.0)
    batch = next_batch(as_places(*near_base, *near_anchor), NOBODY, "closer", [], north_of(2.0), MONDAY_EVENING)
    assert batch.place_ids == [p.id for p in near_anchor]


# ---------- §10-4 Q58: places 전부의 영업시간 검사 ----------


@pytest.mark.parametrize(
    "weekday, open_at, close_at",
    [(0, "09:00", "31:00"), (0, "10:00", "10:00"), (7, "09:00", "20:00")],
    ids=["닫는시각_31시", "여닫는_시각_같음", "요일_7"],
)
@pytest.mark.parametrize("shown", [[], ["D09"]], ids=["안_보여준_곳", "이미_보여준_곳"])
def test_S10_4_Q58_places에_잘못된_영업시간이_있으면_ValueError(shown, weekday, open_at, close_at):
    with pytest.raises(ValueError):
        bad = place("D09", hours=[Opening(weekday=weekday, open=open_at, close=close_at)])
        batch_of(as_places(*many(6), bad), shown=shown)


def test_S10_4_Q58_영업시간이_범위_끝이면_정상():
    fine = place("D09", hours=opening("09:00", "29:59", 6))
    assert batch_of(as_places(*many(6), fine)).place_ids == ["D01", "D02", "D03", "D04", "D05", "D06"]


# ---------- AC-5 속성 ----------

DIRECTIONS = ["quieter", "closer", "cheaper", "different", "photo", "indoor", "food", "night", None]
random_place_kwargs = st.fixed_dictionaries(
    {
        "category": st.sampled_from(["cafe", "food", "walk", "museum", "shop"]),
        "km": st.integers(0, 300).map(lambda v: v / 100),
        "crowd": st.integers(1, 5),
        "price": st.integers(1, 4),
        "tags": st.lists(st.sampled_from(["사진", "실내", "밤", "골목"]), unique=True, max_size=2).map(tuple),
    }
)


@settings(max_examples=200, deadline=None)
@given(
    st.lists(random_place_kwargs, min_size=1, max_size=15),
    st.sampled_from(DIRECTIONS),
    st.sampled_from([5, 6]),
    st.data(),
)
def test_AC05_임의_입력에서_묶음_규칙을_지킴(raw, direction, k, data):
    places = as_places(*[place(f"D{i:02d}", **kw) for i, kw in enumerate(raw, start=1)])
    ids = list(places)
    shown = data.draw(st.lists(st.sampled_from(ids), unique=True))
    liked = data.draw(st.lists(st.sampled_from(shown), unique=True, max_size=2)) if shown else []
    reactions = Reactions(liked=liked, skipped=[])
    pool = [i for i in ids if i not in shown]

    batch = batch_of(places, direction=direction, shown=shown, reactions=reactions, k=k)

    assert len(batch.place_ids) == len(set(batch.place_ids))
    assert set(batch.place_ids) <= set(pool)
    assert batch.exhausted is (len(pool) < 5)
    assert batch.direction == direction
    if direction is None:
        assert batch.direction_relaxed is False
    if len(pool) < 5:
        assert set(batch.place_ids) == set(pool)
    else:
        assert len(batch.place_ids) <= k
    if batch.direction_relaxed:
        assert len(batch.place_ids) == min(k, len(pool))
    if direction is None and pool:
        scores = score_candidates(reactions, places, pool)
        expected = sorted(pool, key=lambda pid: (-scores[pid], int(pid[1:])))
        assert batch.place_ids == expected[: len(batch.place_ids)]
