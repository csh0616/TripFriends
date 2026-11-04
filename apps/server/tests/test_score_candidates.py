"""후보 점수. 근거: TASK-002 §3 B, AC-3, §7 Q1·Q2·Q3·Q4, POC-001 §7-1, docs/poc/poc_c.json."""

import json
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from planning_helpers import as_places, place

from engine.models import Place, Reactions
from engine.planning import score_candidates

POC = json.loads((Path(__file__).parents[3] / "docs" / "poc" / "poc_c.json").read_text(encoding="utf-8"))


def poc_place(raw: dict) -> Place:
    return Place(
        id=raw["id"],
        name=raw["name"],
        category=raw["category"],
        lat=0.0,
        lng=0.0,
        crowd_level=raw["crowd_level"],
        price_level=raw["price_level"],
        mood_tags=raw["mood_tags"],
        hours=None,
        hours_status="unknown",
        stay=None,
    )


def number_of(pid: str) -> int:
    return int(pid[1:])


@pytest.mark.parametrize("traveler", ["S1", "S2", "S3", "S4", "S5", "S6"])
def test_AC03_측정때_규칙_상위3곳을_순서까지_재현(traveler):
    all_places = {**POC["history_places"], **POC["candidates"]}
    places = {pid: poc_place(raw) for pid, raw in all_places.items()}
    who = POC["travelers"][traveler]
    reactions = Reactions(liked=who["liked"], skipped=who["skipped"])

    scores = score_candidates(reactions, places, list(POC["candidates"]))

    top3 = sorted(scores, key=lambda pid: (-scores[pid], number_of(pid)))[:3]
    assert top3 == POC["rule_top3_measured"][traveler]


def score_of(candidate: Place, liked=(), skipped=()) -> float:
    places = as_places(candidate, *liked, *skipped)
    reactions = Reactions(liked=[p.id for p in liked], skipped=[p.id for p in skipped])
    return score_candidates(reactions, places, [candidate.id])[candidate.id]


def test_점수는_후보_목록에_있는_곳만_돌려줌():
    liked = place("H1")
    places = as_places(liked, place("P1"), place("P2"), place("P3"))
    scores = score_candidates(Reactions(liked=["H1"], skipped=[]), places, ["P1", "P3"])
    assert set(scores) == {"P1", "P3"}


def test_좋아한_곳_태그가_겹치면_더함():
    liked = [place("H1", "walk", tags=("골목",)), place("H2", "walk", tags=("골목",))]
    assert score_of(place("P1", "cafe", tags=("골목",)), liked=liked) == pytest.approx(2.0)


def test_넘긴_곳_태그는_빼고_좋아한_곳과_겹치면_합산():
    liked = [place("H1", "walk", tags=("골목",))]
    skipped = [place("H2", "walk", tags=("골목", "유명"))]
    assert score_of(place("P1", "cafe", tags=("골목",)), liked, skipped) == pytest.approx(0.0)
    assert score_of(place("P2", "cafe", tags=("유명",)), liked, skipped) == pytest.approx(-1.0)


@pytest.mark.parametrize(
    "liked_category, skipped_category, expected",
    [
        ("cafe", "walk", 1.0),
        ("cafe", "cafe", 1.0),
        ("walk", "cafe", -0.5),
        ("walk", "shop", 0.0),
    ],
    ids=["좋아한_종류", "좋아함과_넘김_둘다", "넘긴_종류만", "어느쪽도_아님"],
)
def test_Q4_종류_점수(liked_category, skipped_category, expected):
    liked = [place("H1", liked_category)]
    skipped = [place("H2", skipped_category)]
    assert score_of(place("P1", "cafe"), liked, skipped) == pytest.approx(expected)


@pytest.mark.parametrize(
    "crowd, price, expected",
    [(3, 3, 0.0), (5, 3, -1.0), (1, 3, -1.0), (3, 4, -0.5), (3, 2, -0.5), (5, 1, -2.0)],
    ids=["차이없음", "붐빔_더높음", "붐빔_더낮음", "가격_더높음", "가격_더낮음", "둘다"],
)
def test_붐빔_가격은_평균과의_차이에_마이너스_0점5(crowd, price, expected):
    liked = [place("H1", "walk", crowd=3, price=3)]
    assert score_of(place("P1", "cafe", crowd=crowd, price=price), liked) == pytest.approx(expected)


def test_붐빔_가격_기준은_좋아한_곳들의_평균():
    liked = [place("H1", "walk", crowd=2, price=1), place("H2", "walk", crowd=3, price=2)]
    # 평균 붐빔 2.5, 평균 가격 1.5 → (0.5 + 0.5) × −0.5
    assert score_of(place("P1", "cafe", crowd=3, price=2), liked) == pytest.approx(-0.5)


def test_좋아한_곳이_없으면_붐빔_가격_항은_0():
    skipped = [place("H1", "cafe", tags=("유명",))]
    candidate = place("P1", "cafe", crowd=5, price=4, tags=("유명",))
    assert score_of(candidate, skipped=skipped) == pytest.approx(-1.5)  # 태그 −1, 종류 −0.5


def test_반응이_하나도_없으면_0점():
    assert score_of(place("P1", "cafe", crowd=5, price=4, tags=("유명",))) == pytest.approx(0.0)


TAGS = ["골목", "조용함", "유명", "실내"]
CATEGORIES = ["cafe", "food", "walk", "shop"]
scored_places = st.builds(
    place,
    pid=st.just("X"),
    category=st.sampled_from(CATEGORIES),
    crowd=st.integers(1, 5),
    price=st.integers(1, 4),
    tags=st.lists(st.sampled_from(TAGS), unique=True, max_size=3).map(tuple),
)


@settings(max_examples=100, deadline=None)
@given(st.lists(scored_places, min_size=3, max_size=8), st.data())
def test_같은_입력이면_같은_점수이고_후보마다_하나씩(raw, data):
    places = {f"P{i}": p.model_copy(update={"id": f"P{i}"}) for i, p in enumerate(raw)}
    ids = list(places)
    liked = data.draw(st.lists(st.sampled_from(ids), unique=True, max_size=2))
    skipped = data.draw(st.lists(st.sampled_from([i for i in ids if i not in liked]), unique=True, max_size=2))
    candidates = [i for i in ids if i not in liked and i not in skipped]
    reactions = Reactions(liked=liked, skipped=skipped)

    first = score_candidates(reactions, places, candidates)

    assert set(first) == set(candidates)
    assert first == score_candidates(reactions.model_copy(deep=True), dict(places), list(candidates))
