"""계획 엔진 공개 함수 껍데기 (TASK-002 §3 B~F, §7). 구현은 코드 세션에서."""

from datetime import datetime

from engine.models import (
    Batch,
    CourseItem,
    CourseOption,
    DayPlan,
    Direction,
    Infeasible,
    Place,
    PlaceId,
    Reactions,
)


def score_candidates(
    reactions: Reactions, places: dict[PlaceId, Place], candidate_ids: list[PlaceId]
) -> dict[PlaceId, float]:
    raise NotImplementedError


def parse_direction(text: str) -> Direction | None:
    raise NotImplementedError


def next_batch(
    places: dict[PlaceId, Place],
    reactions: Reactions,
    direction: Direction | None,
    shown: list[PlaceId],
    anchor: tuple[float, float],
    at: datetime,
    k: int = 6,
) -> Batch:
    raise NotImplementedError


def pick_directions(
    batch: list[Place],
    remaining: list[Place],
    reactions: Reactions,
    places: dict[PlaceId, Place],
    last_direction: Direction | None,
    anchor: tuple[float, float],
    at: datetime,
) -> list[Direction]:
    raise NotImplementedError


def compose_courses(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place]
) -> list[CourseOption] | Infeasible:
    raise NotImplementedError


def compose_greedy(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place], buffer_min: int
) -> list[CourseItem]:
    raise NotImplementedError
