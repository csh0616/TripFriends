"""AC-18 DP vs 탐욕법 측정 껍데기 (TASK-002 §10-3). 구현과 결과 저장은 코드 세션에서."""

from pathlib import Path

from engine.models import DayPlan, PlaceId

RESULT_PATH = Path(__file__).parent / "results" / "dp_vs_greedy.json"


def generate_cases(count: int = 1000) -> list[tuple[DayPlan, list[PlaceId]]]:
    """가상 도시 입력을 고정 시드로 만든다. 꼭 갈 곳·사용자 값 없음."""
    raise NotImplementedError


def measure(count: int = 1000) -> dict:
    """generate_cases(count)를 packed 조건으로 돌려 JSON으로 저장할 결과를 돌려준다."""
    raise NotImplementedError
