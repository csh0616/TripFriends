"""계획 엔진 공개 함수 (TASK-002 §3 B~F, §7~§9). LLM 없는 순수 함수: 같은 입력 -> 같은 출력."""

import math
import re
from collections import Counter
from datetime import datetime
from typing import NamedTuple

from engine.models import (
    Batch,
    CourseItem,
    CourseOption,
    DayPlan,
    Direction,
    Dropped,
    Infeasible,
    Place,
    PlaceId,
    Reactions,
)


class Limits(NamedTuple):
    """기준 값. mutmut이 바꿔 볼 수 있도록 모듈 상수가 아니라 함수 안에 둔다."""

    earth_km: float  # §8 Q26 하버사인
    walk_max_km: float  # 도보 상한 1.2km
    walk_kmh: float
    transit_base_min: int
    transit_kmh: float
    relaxed_buffer_min: int  # 쉬는 시간 (§3 F)
    packed_buffer_min: int
    step_min: int  # 남는 시간 나누기 단위 (§8 Q31)
    user_stay_low: int  # 사용자 값 자르기 (§7 Q16)
    user_stay_high: int
    last_minute: int  # "29:59" (§7 Q12)
    crowd_avg: float  # 방향 버튼 규칙 1 (§3 E)
    far_avg_km: float
    price_avg: float
    enough_remaining: int  # 규칙 2: 남은 후보 3곳 이상
    min_pool: int  # 묶음 최소 크기 (§7 Q6)
    quiet_crowd: int  # 거르기 표 (§3 C)
    near_km: float
    cheap_price: int
    night_after_min: int  # 19:00
    batch_sizes: tuple[int, ...]  # §8 Q39


def _limits() -> Limits:
    return Limits(
        earth_km=6371.0,
        walk_max_km=1.2,
        walk_kmh=4.5,
        transit_base_min=10,
        transit_kmh=20.0,
        relaxed_buffer_min=15,
        packed_buffer_min=5,
        step_min=5,
        user_stay_low=15,
        user_stay_high=300,
        last_minute=29 * 60 + 59,
        crowd_avg=3,
        far_avg_km=1.0,
        price_avg=3,
        enough_remaining=3,
        min_pool=5,
        quiet_crowd=2,
        near_km=1.2,
        cheap_price=2,
        night_after_min=19 * 60,
        batch_sizes=(5, 6),
    )


# ---------- 공통 도우미 ----------


def _to_min(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _id_key(pid: PlaceId) -> tuple[int, str]:
    """동점은 id의 숫자 부분 오름차순 (§7 Q2)."""
    digits = re.search(r"\d+", pid)
    return (int(digits.group()) if digits else -1, pid)


def _distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * _limits().earth_km * math.asin(math.sqrt(h))


def _travel_min(km: float) -> int:
    lim = _limits()
    if km <= lim.walk_max_km:
        return math.ceil(km / lim.walk_kmh * 60)
    return lim.transit_base_min + math.ceil(km / lim.transit_kmh * 60)


# ---------- B. 후보 점수 ----------


def score_candidates(
    reactions: Reactions, places: dict[PlaceId, Place], candidate_ids: list[PlaceId]
) -> dict[PlaceId, float]:
    """POC-001 §7-1 고정식. 붐빔·가격은 절댓값 (§8 B6)."""
    liked = [places[i] for i in reactions.liked if i in places]
    skipped = [places[i] for i in reactions.skipped if i in places]
    weights: Counter[str] = Counter()
    for p in liked:
        for tag in p.mood_tags:
            weights[tag] += 1
    for p in skipped:
        for tag in p.mood_tags:
            weights[tag] -= 1
    liked_categories = {p.category for p in liked}
    skipped_categories = {p.category for p in skipped}
    avg_crowd = sum(p.crowd_level for p in liked) / len(liked) if liked else 0.0
    avg_price = sum(p.price_level for p in liked) / len(liked) if liked else 0.0

    scores: dict[PlaceId, float] = {}
    for cid in candidate_ids:
        p = places[cid]
        score = float(sum(weights[tag] for tag in p.mood_tags))
        if p.category in liked_categories:
            score += 1
        elif p.category in skipped_categories:
            score -= 0.5
        if liked:
            score += -0.5 * abs(p.crowd_level - avg_crowd)
            score += -0.5 * abs(p.price_level - avg_price)
        scores[cid] = score
    return scores


# ---------- C. 방향 해석 ----------


def parse_direction(text: str) -> Direction | None:
    """POC-001 §5-1 동결 표. 위에서부터 먼저."""
    table: list[tuple[Direction, tuple[str, ...]]] = [
        ("quieter", ("한적", "조용", "사람 적", "덜 붐", "웨이팅 없", "쉬어")),
        ("closer", ("가까", "근처", "안 걷", "덜 걷")),
        ("cheaper", ("싼", "저렴", "돈", "가성비")),
        ("different", ("다른", "말고", "힙", "레트로", "현지인")),
        ("photo", ("사진", "인스타", "감성")),
        ("indoor", ("실내", "비 안", "비 피")),
        ("food", ("먹", "맛있", "배고")),
        ("night", ("밤", "야경")),
    ]
    for direction, words in table:
        if any(word in text for word in words):
            return direction
    return None


def _liked_tags(reactions: Reactions, places: dict[PlaceId, Place]) -> set[str]:
    return {tag for i in reactions.liked if i in places for tag in places[i].mood_tags}


def _matches(
    direction: Direction,
    p: Place,
    liked_tags: set[str],
    has_liked: bool,
    anchor: tuple[float, float],
    at: datetime,
) -> bool:
    """§3 C 거르기 표."""
    lim = _limits()
    if direction == "quieter":
        return p.crowd_level <= lim.quiet_crowd
    if direction == "closer":
        return _distance_km(anchor, (p.lat, p.lng)) <= lim.near_km
    if direction == "cheaper":
        return p.price_level <= lim.cheap_price
    if direction == "different":
        # §8 Q24: 좋아한 곳이 없으면 맞는 곳 없음
        return has_liked and not (set(p.mood_tags) & liked_tags)
    if direction == "photo":
        return "사진" in p.mood_tags or "감성" in p.mood_tags
    if direction == "indoor":
        return "실내" in p.mood_tags or p.category in ("museum", "shop")
    if direction == "food":
        return p.category == "food"
    # night: 태그, 또는 그 요일에 19:00보다 늦게 닫는 영업 구간 (§7 Q5)
    if "밤" in p.mood_tags or "야경" in p.mood_tags:
        return True
    weekday = at.weekday()
    return any(o.weekday == weekday and _to_min(o.close) > lim.night_after_min for o in p.hours or [])


# ---------- D. 다음 묶음 ----------


def next_batch(
    places: dict[PlaceId, Place],
    reactions: Reactions,
    direction: Direction | None,
    shown: list[PlaceId],
    anchor: tuple[float, float],
    at: datetime,
    k: int = 6,
) -> Batch:
    lim = _limits()
    if k not in lim.batch_sizes:
        raise ValueError(f"k는 {lim.batch_sizes}만 받는다: {k}")
    shown_set = set(shown)
    pool = [pid for pid in places if pid not in shown_set]
    scores = score_candidates(reactions, places, pool)
    ranked = sorted(pool, key=lambda pid: (-scores[pid], _id_key(pid)))

    if direction is None:
        matching = ranked
    else:
        liked_tags = _liked_tags(reactions, places)
        has_liked = any(i in places for i in reactions.liked)
        matching = [pid for pid in ranked if _matches(direction, places[pid], liked_tags, has_liked, anchor, at)]
    rest = [pid for pid in ranked if pid not in set(matching)]

    if len(pool) < lim.min_pool:
        # §8 Q39·§9 Q47: 있는 만큼 전부, 맞는 곳 먼저
        return Batch(
            place_ids=matching + rest,
            direction=direction,
            exhausted=True,
            direction_relaxed=bool(rest),
        )
    if len(matching) >= lim.min_pool:
        return Batch(place_ids=matching[:k], direction=direction, exhausted=False, direction_relaxed=False)
    # §7 Q6: 방향 결과가 모자라면 나머지를 점수순으로 채운다
    return Batch(
        place_ids=(matching + rest)[: min(k, len(pool))],
        direction=direction,
        exhausted=False,
        direction_relaxed=True,
    )


# ---------- E. 방향 버튼 고르기 ----------


def pick_directions(
    batch: list[Place],
    remaining: list[Place],
    reactions: Reactions,
    places: dict[PlaceId, Place],
    last_direction: Direction | None,
    anchor: tuple[float, float],
    at: datetime,
) -> list[Direction]:
    lim = _limits()
    if not batch:
        return []  # §8 Q37
    count = len(batch)
    rule1: list[Direction] = []
    if sum(p.crowd_level for p in batch) / count >= lim.crowd_avg:
        rule1.append("quieter")
    if sum(_distance_km(anchor, (p.lat, p.lng)) for p in batch) / count > lim.far_avg_km:
        rule1.append("closer")
    if sum(p.price_level for p in batch) / count >= lim.price_avg:
        rule1.append("cheaper")

    # §8 Q25: 직전 방향을 먼저 빼고 채운다
    chosen: list[Direction] = [d for d in rule1 if d != last_direction]

    liked_tags = _liked_tags(reactions, places)
    has_liked = any(i in places for i in reactions.liked)
    rule2: list[Direction] = ["different", "photo", "indoor", "food", "night"]
    fits = {
        d: sum(1 for p in remaining if _matches(d, p, liked_tags, has_liked, anchor, at)) for d in rule2
    }
    # 규칙 2: 남은 후보 3곳 이상, 그다음 1곳 이상 (§7 Q7, §9 Q41: 3개가 될 때까지)
    for need in (lim.enough_remaining, 1):
        for d in rule2:
            if len(chosen) >= 3:
                break
            if d != last_direction and d not in chosen and fits[d] >= need:
                chosen.append(d)
    return chosen


def compose_courses(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place]
) -> list[CourseOption] | Infeasible:
    raise NotImplementedError


def compose_greedy(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place], buffer_min: int
) -> list[CourseItem]:
    raise NotImplementedError
