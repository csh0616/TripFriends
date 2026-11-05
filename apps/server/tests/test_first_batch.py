"""첫 묶음. 근거: TASK-003 §4-1, AC-3, §10 Q11·Q12·Q13, TASK-002 §3 C 거르기 표, §7 Q2·Q5, §8 Q21·Q24."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_api_helpers import CHIP_CATEGORIES, demo_places, ids
from planning_helpers import BASE, MONDAY_EVENING, as_places, opening, place

from engine.models import Batch, Opening
from engine.planning import first_batch

CATEGORIES = ["cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"]


def run(places, categories=(), direction=None, k=6):
    return first_batch(places, list(categories), direction, BASE, MONDAY_EVENING, k=k)


def cat_places(start, count, category):
    return [place(f"P{i}", category=category) for i in range(start, start + count)]


def number(pid: str) -> int:
    return int(pid[1:])


# ---------- 칩 대응표 (§4-1 칩 줄마다, 가상 도시로) ----------

DEMO_EXPECTED = {
    "골목 산책": ["D09", "D10", "D11", "D12", "D01", "D02"],
    "맛집 투어": ["D05", "D06", "D07", "D08", "D01", "D02"],
    "쇼핑": ["D17", "D18", "D19", "D20", "D01", "D02"],
    "야경": ["D28", "D29", "D30", "D01", "D02", "D03"],
    "카페": ["D01", "D02", "D03", "D04", "D05", "D06"],
    "전시·체험": ["D13", "D14", "D15", "D16", "D21", "D22"],
}


@pytest.mark.parametrize("label", DEMO_EXPECTED)
def test_A01_AC03_칩_대응표_종류로_첫_묶음(label):
    batch = run(demo_places(), CHIP_CATEGORIES[label])
    assert batch.place_ids == DEMO_EXPECTED[label]


def test_A02_AC03_칩_여러개는_고른_종류를_합친다():
    assert run(demo_places(), ["shop", "cafe"]).place_ids == ["D01", "D02", "D03", "D04", "D17", "D18"]


def test_A03_AC03_칩을_안_고르면_거르지_않는다():
    assert run(demo_places(), []).place_ids == ["D01", "D02", "D03", "D04", "D05", "D06"]


# ---------- 개수 경계 ----------


@pytest.mark.parametrize(
    ("match", "others", "expected_size"),
    [(7, 3, 6), (6, 3, 6), (5, 3, 5), (4, 3, 6), (1, 9, 6), (0, 9, 6)],
    ids=["맞는곳_7", "맞는곳_6_정각", "맞는곳_5_채우지않음", "맞는곳_4_채움", "맞는곳_1_채움", "맞는곳_0_전부_채움"],
)
def test_A04_AC03_고른_종류_개수_경계(match, others, expected_size):
    # 맞는 곳은 뒤 번호, 나머지는 앞 번호: 채우지 않으면 앞 번호가 나오면 안 된다
    fill = cat_places(1, others, "food")
    wanted = cat_places(100, match, "cafe")
    result = run(as_places(*fill, *wanted), ["cafe"]).place_ids
    assert len(result) == expected_size
    expected = [p.id for p in wanted][:6]
    if match < 5:
        expected += [p.id for p in fill][: 6 - match]
    assert result == expected


@pytest.mark.parametrize("total", [0, 1, 4, 5, 6])
def test_A05_AC03_장소가_6곳_이하면_있는_만큼(total):
    assert run(as_places(*cat_places(1, total, "food")), ["cafe"]).place_ids == [f"P{i}" for i in range(1, total + 1)]


def test_A06_AC03_k가_5면_5곳까지():
    assert run(as_places(*cat_places(1, 9, "cafe")), ["cafe"], k=5).place_ids == [f"P{i}" for i in range(1, 6)]


def test_A07_AC03_동점은_id_숫자순_P2가_P10보다_먼저():
    places = as_places(place("P10"), place("P9"), place("P2"), place("P100"), place("P1"), place("P20"), place("P3"))
    assert run(places).place_ids == ["P1", "P2", "P3", "P9", "P10", "P20"]


def test_A08_AC03_돌려주는_모양은_Batch():
    assert isinstance(run(as_places(place("P1"))), Batch)


# ---------- 방향 (§4-1 text → parse_direction 결과가 direction으로) ----------


def direction_pool(matching, other):
    """맞는 곳은 뒤 번호 6곳, 안 맞는 곳은 앞 번호 6곳."""
    bad = [place(f"P{i}", **other) for i in range(1, 7)]
    good = [place(f"P{i}", **matching) for i in range(101, 107)]
    return as_places(*bad, *good), [p.id for p in good]


DIRECTION_FILTERS = [
    pytest.param("quieter", {"crowd": 2}, {"crowd": 3}, id="quieter_붐빔2와3"),
    pytest.param("closer", {"km": 1.19}, {"km": 1.21}, id="closer_1.2km_양쪽"),
    pytest.param("cheaper", {"price": 2}, {"price": 3}, id="cheaper_가격2와3"),
    pytest.param("photo", {"tags": ("사진",)}, {"tags": ("맛집",)}, id="photo_사진태그"),
    pytest.param("photo", {"tags": ("감성",)}, {"tags": ("맛집",)}, id="photo_감성태그"),
    pytest.param("indoor", {"tags": ("실내",)}, {"tags": ("맛집",)}, id="indoor_실내태그"),
    pytest.param("indoor", {"category": "museum"}, {"category": "cafe"}, id="indoor_museum"),
    pytest.param("indoor", {"category": "shop"}, {"category": "cafe"}, id="indoor_shop"),
    pytest.param("food", {"category": "food"}, {"category": "cafe"}, id="food_종류"),
    pytest.param("night", {"tags": ("밤",)}, {"tags": ("맛집",)}, id="night_밤태그"),
    pytest.param("night", {"tags": ("야경",)}, {"tags": ("맛집",)}, id="night_야경태그"),
    pytest.param(
        "night",
        {"hours": opening("10:00", "19:01")},
        {"hours": opening("10:00", "19:00")},
        id="night_닫는시각_19시_양쪽",
    ),
    pytest.param(
        "night",
        {"hours": opening("10:00", "22:00", weekday=0)},
        {"hours": opening("10:00", "22:00", weekday=1)},
        id="night_요일_at_기준_월요일",
    ),
]


@pytest.mark.parametrize(("direction", "matching", "other"), DIRECTION_FILTERS)
def test_A09_AC03_방향으로_거른다(direction, matching, other):
    places, good = direction_pool(matching, other)
    assert run(places, direction=direction).place_ids == good


def test_A10_AC03_방향_맞는곳이_5곳_미만이면_거르지_않은_장소에서_채운다():
    quiet = [place(f"P{i}", crowd=1) for i in (101, 102, 103)]
    busy = [place(f"P{i}", crowd=5) for i in range(1, 7)]
    assert run(as_places(*busy, *quiet), direction="quieter").place_ids == ["P101", "P102", "P103", "P1", "P2", "P3"]


def test_A11_AC03_different는_좋아한_곳이_없어_맞는_곳이_없으니_전부_채움():
    places = as_places(*cat_places(1, 8, "cafe"))
    assert run(places, direction="different").place_ids == [f"P{i}" for i in range(1, 7)]


def test_A12_AC03_칩과_방향을_함께_거른다():
    both = [place(f"P{i}", category="cafe", crowd=1) for i in range(101, 107)]
    cafe_busy = [place(f"P{i}", category="cafe", crowd=5) for i in range(1, 4)]
    food_quiet = [place(f"P{i}", category="food", crowd=1) for i in range(4, 7)]
    places = as_places(*cafe_busy, *food_quiet, *both)
    assert run(places, ["cafe"], "quieter").place_ids == [p.id for p in both]


def test_A13_AC03_칩과_방향_둘다_맞는_곳이_5곳_미만이면_그_곳들이_먼저고_6곳까지_채움():
    both = [place(f"P{i}", category="cafe", crowd=1) for i in (101, 102)]
    rest = [place(f"P{i}", category="food", crowd=5) for i in range(1, 8)]
    result = run(as_places(*rest, *both), ["cafe"], "quieter").place_ids
    assert result == ["P101", "P102", "P1", "P2", "P3", "P4"]


def test_A14_칩과_방향_함께_채우는_순서는_둘다_칩만_방향만_나머지():
    # 번호는 일부러 기대 순서의 반대로 둔다 (id순이면 실패)
    neither = [place(f"P{i}", category="food", crowd=5) for i in (1, 2)]
    only_quiet = [place(f"P{i}", category="food", crowd=1) for i in (3, 4)]
    only_cafe = [place(f"P{i}", category="cafe", crowd=5) for i in (5, 10)]
    both = [place("P20", category="cafe", crowd=1)]
    result = run(as_places(*neither, *only_quiet, *only_cafe, *both), ["cafe"], "quieter").place_ids
    assert result == ["P20", "P5", "P10", "P3", "P4", "P1"]


def crowd_places(quiet, busy):
    return [place(f"P{i}", crowd=1) for i in range(1, quiet + 1)] + [
        place(f"P{i}", crowd=5) for i in range(quiet + 1, quiet + busy + 1)
    ]


@pytest.mark.parametrize(
    ("places", "categories", "direction", "exhausted", "relaxed"),
    [
        ([], [], None, True, False),
        (cat_places(1, 3, "cafe"), [], None, True, False),
        (cat_places(1, 4, "cafe"), ["cafe"], None, True, False),
        (cat_places(1, 5, "cafe"), ["cafe"], None, False, False),
        (cat_places(1, 4, "cafe") + cat_places(5, 4, "food"), ["cafe"], None, False, True),
        (cat_places(1, 5, "cafe") + cat_places(6, 4, "food"), ["cafe"], None, False, False),
        (crowd_places(4, 0), [], "quieter", True, False),
        (crowd_places(2, 2), [], "quieter", True, True),
        (crowd_places(4, 4), [], "quieter", False, True),
        (crowd_places(5, 3), [], "quieter", False, False),
    ],
    ids=[
        "전체_0곳",
        "칩없음_전체_3곳",
        "전체_4곳",
        "전체_5곳",
        "칩_4곳_채움",
        "칩_5곳_안채움",
        "방향_전체_4곳_모두_맞음",
        "방향_전체_4곳_일부만_맞음",
        "방향_4곳_채움",
        "방향_5곳_안채움",
    ],
)
def test_A15_첫_묶음의_표시값(places, categories, direction, exhausted, relaxed):
    batch = run(as_places(*places), categories, direction)
    assert (batch.exhausted, batch.direction_relaxed, batch.direction) == (exhausted, relaxed, direction)


@pytest.mark.parametrize("k", [4, 7])
def test_A16_k가_5나_6이_아니면_ValueError(k):
    with pytest.raises(ValueError):
        run(as_places(place("P1")), k=k)


@pytest.mark.parametrize(
    ("weekday", "open_at", "close_at"),
    [(0, "10:75", "18:00"), (0, "31:00", "32:00"), (0, "18:00", "10:00"), (7, "10:00", "18:00")],
    ids=["분_75", "시각_범위_밖", "여는시각이_더_늦음", "요일_범위_밖"],
)
def test_A24_Q13_영업시간이_잘못되면_next_batch처럼_ValueError(weekday, open_at, close_at):
    with pytest.raises(ValueError):
        hours = [Opening(weekday=weekday, open=open_at, close=close_at)]
        run(as_places(place("P1", hours=hours)))


def test_A25_Q12_둘_다_맞는_곳이_5곳이면_채우지_않는다():
    both = [place(f"P{i}", category="cafe", crowd=1) for i in range(101, 106)]
    only_cafe = [place(f"P{i}", category="cafe", crowd=5) for i in range(1, 4)]
    assert run(as_places(*only_cafe, *both), ["cafe"], "quieter").place_ids == [p.id for p in both]


# ---------- Hypothesis ----------

places_strategy = st.dictionaries(
    st.integers(min_value=1, max_value=200).map(lambda n: f"P{n}"),
    st.tuples(
        st.sampled_from(CATEGORIES),
        st.integers(1, 5),
        st.integers(1, 4),
        st.lists(st.sampled_from(["사진", "감성", "실내", "밤", "야경", "골목"]), max_size=2, unique=True),
        st.sampled_from([0.0, 0.5, 2.0]),
    ),
    max_size=30,
).map(
    lambda raw: {
        pid: place(pid, category=c, crowd=crowd, price=price, tags=tuple(tags), km=km)
        for pid, (c, crowd, price, tags, km) in raw.items()
    }
)
categories_strategy = st.lists(st.sampled_from(CATEGORIES), max_size=3, unique=True)
direction_strategy = st.sampled_from(["quieter", "closer", "cheaper", "different", "photo", "indoor", "food", "night", None])
k_strategy = st.sampled_from([5, 6])


@settings(max_examples=200, deadline=None)
@given(places_strategy, categories_strategy, k_strategy)
def test_A17_AC03_방향_없으면_S4_1_규칙과_정확히_같다(places, categories, k):
    in_order = sorted(places, key=number)
    wanted = [p for p in in_order if not categories or places[p].category in categories]
    expected = wanted[:k]
    if len(wanted) < 5:
        expected += [p for p in in_order if p not in wanted][: k - len(wanted)]
    assert run(places, categories, None, k).place_ids == expected


@settings(max_examples=200, deadline=None)
@given(places_strategy, categories_strategy, direction_strategy, k_strategy)
def test_A18_AC03_크기_중복없음_있는_장소만(places, categories, direction, k):
    result = run(places, categories, direction, k).place_ids
    assert len(result) <= k
    assert len(result) == len(set(result))
    assert set(result) <= set(places)
    assert len(result) >= min(5, len(places))  # 5곳 미만이면 채우므로 장소가 있으면 모자라지 않음


@settings(max_examples=200, deadline=None)
@given(places_strategy, categories_strategy, direction_strategy, k_strategy)
def test_A19_AC03_결정적_같은_입력은_같은_결과_넣은_순서가_달라도(places, categories, direction, k):
    first = run(places, categories, direction, k)
    assert run(places, categories, direction, k) == first
    assert run(dict(reversed(list(places.items()))), categories, direction, k) == first


@settings(max_examples=200, deadline=None)
@given(places_strategy, categories_strategy, k_strategy)
def test_A26_Q12_칩과_방향이_있으면_채우는_순서까지_규칙과_같다(places, categories, k):
    in_order = sorted(places, key=number)

    def chip(p):
        return not categories or places[p].category in categories

    def quiet(p):
        return places[p].crowd_level <= 2

    both = [p for p in in_order if chip(p) and quiet(p)]
    expected = both[:k]
    if len(both) < 5:
        chip_only = [p for p in in_order if chip(p) and not quiet(p)]
        quiet_only = [p for p in in_order if quiet(p) and not chip(p)]
        neither = [p for p in in_order if not chip(p) and not quiet(p)]
        expected = (both + chip_only + quiet_only + neither)[:k]
    assert run(places, categories, "quieter", k).place_ids == expected


# ---------- API에서 칩·글이 첫 묶음으로 이어지는지 (§4-1) ----------


@pytest.mark.parametrize("label", DEMO_EXPECTED)
def test_A20_AC03_API_칩_대응표(env, label):
    sid, batch = env.browse(env.plant_day(demo_places()), [label])
    assert ids(batch) == DEMO_EXPECTED[label]
    assert set(env.values(sid)["categories"]) == CHIP_CATEGORIES[label]


def test_A21_AC03_API_칩_안_고르면_거르지_않음(env):
    sid, batch = env.browse(env.plant_day(demo_places()), [])
    assert ids(batch) == DEMO_EXPECTED["카페"]
    assert env.values(sid)["categories"] == []


def test_A22_AC03_API_글에서_방향이_나오면_그_방향으로_거름(env):
    places = as_places(*[place(f"P{i}", crowd=5) for i in range(1, 7)], *[place(f"P{i}", crowd=1) for i in range(101, 107)])
    _, batch = env.browse(env.plant_day(places), [], "조용한 데")
    assert ids(batch) == [f"P{i}" for i in range(101, 107)]


def test_A23_AC03_API_글을_못_알아들으면_무시하고_진행_되묻지_않음(env):
    places = as_places(*cat_places(1, 8, "cafe"))
    sid, batch = env.browse(env.plant_day(places), ["카페"], "그냥 아무거나")
    assert ids(batch) == [f"P{i}" for i in range(1, 7)]
    assert batch["clarify"] is None
    assert env.stage(sid) == "browsing"
    assert env.values(sid)["clarify_count"] == 0
