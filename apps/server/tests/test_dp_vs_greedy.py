"""AC-18 DP vs 탐욕법 측정. 근거: TASK-002 §10-3, AC-14, §7 Q17.

함수·키 이름은 문서에 없어 임시로 정했다.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

from planning_helpers import distance_km, expected_travel

from engine.models import Place
from engine.planning import compose_courses, compose_greedy
from evals.dp_vs_greedy import RESULT_PATH, generate_cases, measure

SERVER = Path(__file__).parents[1]
FIXTURE = SERVER / "engine" / "fixtures" / "demo_city.json"
SMALL = 20
KEYS = {
    "cases",
    "dp_places_mean",
    "greedy_places_mean",
    "diff_distribution",
    "dp_more_ratio",
    "dp_fewer_count",
    "dp_travel_mean",
    "greedy_travel_mean",
}


def demo_places() -> dict[str, Place]:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))["places"]
    return {row["id"]: Place.model_validate(row) for row in rows}


def place_counts(plan, picks, places) -> tuple[int, int]:
    """같은 입력에서 (packed 안이 넣은 곳 수, 쉬는 5분 탐욕법이 넣은 곳 수). §7 Q17."""
    result = compose_courses(plan, picks, places)
    assert isinstance(result, list)
    packed = next((o for o in result if o.label == "packed"), result[0])
    greedy = compose_greedy(plan, picks, places, 5)
    return (
        len([i for i in packed.items if not i.is_fixed]),
        len([i for i in greedy if not i.is_fixed]),
    )


def travel_sums(plan, picks, places) -> tuple[int, int, int, int]:
    """(packed 이동, packed 복귀, 탐욕법 이동, 탐욕법 복귀). 복귀는 마지막 장소에서 숙소까지 (§3 F, §7 Q14)."""
    result = compose_courses(plan, picks, places)
    packed = next((o for o in result if o.label == "packed"), result[0])
    greedy = compose_greedy(plan, picks, places, 5)
    last = next((i.place_id for i in reversed(greedy) if i.place_id), None)
    home = 0 if last is None else expected_travel(distance_km((places[last].lat, places[last].lng), plan.lodging))
    return (
        sum(i.travel_min for i in packed.items),
        packed.go_home_min,
        sum(i.travel_min for i in greedy),
        home,
    )


def test_AC18_결과_저장_위치():
    assert RESULT_PATH == SERVER / "evals" / "results" / "dp_vs_greedy.json"


def test_AC18_기본_입력은_1000건():
    assert len(generate_cases()) == 1000


def test_AC18_입력은_가상_도시이고_꼭갈곳과_사용자값이_없음():
    ids = set(demo_places())
    cases = generate_cases(SMALL)
    assert len(cases) == SMALL
    for plan, picks in cases:
        assert plan.must_visit == []
        assert plan.stay_overrides == {}
        assert set(picks) <= ids


def test_AC18_입력은_무작위로_여러_가지():
    cases = generate_cases(SMALL)
    assert len({(plan.model_dump_json(), tuple(picks)) for plan, picks in cases}) > 1


def test_AC18_시드가_고정되어_입력이_두번_모두_같음():
    assert generate_cases(SMALL) == generate_cases(SMALL)


def test_AC18_시드가_고정되어_결과가_두번_모두_같음():
    assert measure(SMALL) == measure(SMALL)


def test_AC18_결과에_문서의_항목이_모두_있고_JSON으로_저장할_수_있음():
    result = measure(SMALL)
    assert KEYS <= set(result)
    assert json.loads(json.dumps(result)) == result


def test_AC18_숫자가_같은_입력을_packed와_탐욕법으로_돌린_값과_같음():
    places = demo_places()
    pairs = [place_counts(plan, picks, places) for plan, picks in generate_cases(SMALL)]
    result = measure(SMALL)

    assert result["cases"] == SMALL
    assert result["dp_places_mean"] == pytest.approx(sum(dp for dp, _ in pairs) / SMALL)
    assert result["greedy_places_mean"] == pytest.approx(sum(g for _, g in pairs) / SMALL)
    expected = Counter(str(dp - g) for dp, g in pairs)
    assert result["diff_distribution"] == dict(expected)
    assert result["dp_more_ratio"] == pytest.approx(sum(dp > g for dp, g in pairs) / SMALL)
    assert result["dp_fewer_count"] == sum(dp < g for dp, g in pairs)

    # §10-4 Q61: 이동 합은 DP·탐욕법 모두 숙소 복귀 포함
    sums = [travel_sums(plan, picks, places) for plan, picks in generate_cases(SMALL)]
    assert result["dp_travel_mean"] == pytest.approx(sum(legs + home for legs, home, _, _ in sums) / SMALL)
    assert result["greedy_travel_mean"] == pytest.approx(sum(legs + home for _, _, legs, home in sums) / SMALL)


def test_AC18_Q61_이동_합_평균은_복귀를_뺀_값이_아님():
    places = demo_places()
    sums = [travel_sums(plan, picks, places) for plan, picks in generate_cases(SMALL)]
    result = measure(SMALL)
    # 입력 20건에 복귀가 있으면 복귀를 뺀 평균과 달라야 한다
    assert sum(home for _, home, _, _ in sums) > 0
    assert sum(home for _, _, _, home in sums) > 0
    assert result["dp_travel_mean"] > sum(legs for legs, _, _, _ in sums) / SMALL
    assert result["greedy_travel_mean"] > sum(legs for _, _, legs, _ in sums) / SMALL


@pytest.mark.slow
def test_AC18_AC14_1000건에서_DP가_탐욕법보다_적게_넣은_경우_0건():
    result = measure()
    distribution = result["diff_distribution"]
    assert result["cases"] == 1000
    assert sum(distribution.values()) == 1000
    assert result["dp_fewer_count"] == 0
    assert all(int(diff) >= 0 for diff in distribution)
