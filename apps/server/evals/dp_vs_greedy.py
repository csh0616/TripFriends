"""AC-18 DP vs 탐욕법 측정 (TASK-002 §10-3, §10-4 Q61). 평가 코드이며 결과를 evals/results/에 저장한다.

실행: `cd apps/server && uv run python -m evals.dp_vs_greedy`
"""

import json
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from engine.models import DayPlan, Place, PlaceId, PlanFixed
from engine.planning import _distance_km, _travel_min, compose_courses, compose_greedy

RESULT_PATH = Path(__file__).parent / "results" / "dp_vs_greedy.json"
FIXTURE_PATH = Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json"
SEED = 20261105  # 시드 고정: 같은 입력, 같은 결과
BUFFER_MIN = 5  # packed 조건 (§7 Q17): 쉬는 5분, 최소 머무는 시간

# 생성 입력 범위 (측정 결과를 좋게 만들려고 조정하지 않는다):
# - 장소: demo_city.json 30곳 (영업시간 모름·미확인 포함, 반경 3km)
# - 날짜: 2026-11-09(월)부터 7일 중 무작위 (요일별 휴무 반영)
# - 하루: 시작 08:00~11:00 (30분 단위), 끝 19:00~22:00 (30분 단위), 숙소는 도시 중심 (35.0, 135.0)
# - 담은 곳: 3~12곳 무작위. 꼭 갈 곳·사용자 값은 없음
# - 고정 일정: 1/3은 없음, 1/3은 장소 없음, 1/3은 장소 있음(담은 곳 밖 무작위 한 곳).
#   시작 13:00~15:00 (30분 단위), 길이 30~120분
START_CHOICES = list(range(8 * 60, 11 * 60 + 1, 30))
END_CHOICES = list(range(19 * 60, 22 * 60 + 1, 30))
FIRST_DAY = date(2026, 11, 9)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _demo_places() -> dict[PlaceId, Place]:
    rows = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["places"]
    return {row["id"]: Place.model_validate(row) for row in rows}


def generate_cases(count: int = 1000) -> list[tuple[DayPlan, list[PlaceId]]]:
    """가상 도시 입력을 고정 시드로 만든다. 꼭 갈 곳·사용자 값 없음."""
    rng = random.Random(SEED)
    places = _demo_places()
    ids = sorted(places)
    cases: list[tuple[DayPlan, list[PlaceId]]] = []
    for _ in range(count):
        picks = sorted(rng.sample(ids, rng.randint(3, 12)))
        fixed: list[PlanFixed] = []
        kind = rng.choice(["none", "free", "venue"])
        if kind != "none":
            start = rng.choice(range(13 * 60, 15 * 60 + 1, 30))
            end = start + rng.choice(range(30, 121, 30))
            venue = places[rng.choice([i for i in ids if i not in picks])] if kind == "venue" else None
            fixed.append(
                PlanFixed(
                    id="F1",
                    title="고정 일정",
                    start=_hhmm(start),
                    end=_hhmm(end),
                    place_id=venue.id if venue else None,
                    lat=venue.lat if venue else None,
                    lng=venue.lng if venue else None,
                )
            )
        plan = DayPlan(
            date=FIRST_DAY + timedelta(days=rng.randint(0, 6)),
            start=_hhmm(rng.choice(START_CHOICES)),
            end=_hhmm(rng.choice(END_CHOICES)),
            lodging=(35.0, 135.0),
            fixed=fixed,
            must_visit=[],
            stay_overrides={},
        )
        cases.append((plan, picks))
    return cases


def measure(count: int = 1000) -> dict:
    """generate_cases(count)를 packed 조건으로 돌려 JSON으로 저장할 결과를 돌려준다."""
    places = _demo_places()
    dp_counts: list[int] = []
    greedy_counts: list[int] = []
    dp_travel: list[int] = []
    greedy_travel: list[int] = []
    for plan, picks in generate_cases(count):
        result = compose_courses(plan, picks, places)
        assert isinstance(result, list), f"입력이 Infeasible: {result}"
        packed = next((o for o in result if o.label == "packed"), result[0])
        greedy = compose_greedy(plan, picks, places, BUFFER_MIN)
        dp_counts.append(len([i for i in packed.items if not i.is_fixed]))
        greedy_counts.append(len([i for i in greedy if not i.is_fixed]))
        dp_travel.append(packed.total_travel_min)  # 숙소 복귀 포함 (§10-4 Q61)
        last = next((i.place_id for i in reversed(greedy) if i.place_id), None)
        home = 0
        if last is not None:  # 탐욕법 복귀는 측정 코드에서 더한다 (Q61)
            home = _travel_min(_distance_km((places[last].lat, places[last].lng), plan.lodging))
        greedy_travel.append(sum(i.travel_min for i in greedy) + home)

    diffs = Counter(str(d - g) for d, g in zip(dp_counts, greedy_counts))
    return {
        "cases": count,
        "dp_places_mean": round(sum(dp_counts) / count, 6),
        "greedy_places_mean": round(sum(greedy_counts) / count, 6),
        "diff_distribution": dict(sorted(diffs.items(), key=lambda kv: int(kv[0]))),
        "dp_more_ratio": round(sum(d > g for d, g in zip(dp_counts, greedy_counts)) / count, 6),
        "dp_fewer_count": sum(d < g for d, g in zip(dp_counts, greedy_counts)),
        "dp_travel_mean": round(sum(dp_travel) / count, 6),
        "greedy_travel_mean": round(sum(greedy_travel) / count, 6),
    }


def main() -> None:
    result = measure()
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
