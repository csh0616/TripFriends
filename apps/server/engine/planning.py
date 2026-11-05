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

    earth_km: float  # TASK-002 §8 Q26 하버사인
    walk_max_km: float  # 도보 상한 1.2km
    walk_kmh: float
    transit_base_min: int
    transit_kmh: float
    relaxed_buffer_min: int  # 쉬는 시간 (§3 F)
    packed_buffer_min: int
    step_min: int  # 남는 시간 나누기 단위 (TASK-002 §8 Q31)
    user_stay_low: int  # 사용자 값 자르기 (TASK-002 §7 Q16)
    user_stay_high: int
    last_minute: int  # "29:59" (TASK-002 §7 Q12)
    crowd_avg: float  # 방향 버튼 규칙 1 (§3 E)
    far_avg_km: float
    price_avg: float
    enough_remaining: int  # 규칙 2: 남은 후보 3곳 이상
    min_pool: int  # 묶음 최소 크기 (TASK-002 §7 Q6)
    quiet_crowd: int  # 거르기 표 (§3 C)
    near_km: float
    cheap_price: int
    night_after_min: int  # 19:00
    batch_sizes: tuple[int, ...]  # TASK-002 §8 Q39


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
    """동점은 id의 숫자 부분 오름차순 (TASK-002 §7 Q2)."""
    digits = re.search(r"\d+", pid)
    return (int(digits.group()) if digits else -1, pid)


def _distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * _limits().earth_km * math.asin(math.sqrt(h))


def _check_hours(places: dict[PlaceId, Place]) -> None:
    """TASK-002 §10 #5, §10-4 Q58: 넘어온 places 전부의 영업시간 검사. 잘못된 값이면 ValueError."""
    last = _limits().last_minute
    for p in places.values():
        for o in p.hours or []:
            if not 0 <= o.weekday <= 6:
                raise ValueError(f"영업시간 요일이 잘못됨: {p.id} {o.weekday}")
            if not 0 <= _to_min(o.open) < _to_min(o.close) <= last:
                raise ValueError(f"영업시간이 잘못됨: {p.id} {o.open}~{o.close}")


def _check_ids(plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place]) -> None:
    """TASK-002 §10 #9, §10-4 Q59: 담은 곳·꼭 갈 곳·고정 일정 장소가 places에 없으면 ValueError.
    stay_overrides의 없는 id는 검사하지 않고 무시한다 (TASK-002 §9 Q43)."""
    for pid in [*picks, *plan.must_visit, *(f.place_id for f in plan.fixed if f.place_id)]:
        if pid not in places:
            raise ValueError(f"없는 장소 id: {pid}")


def _travel_min(km: float) -> int:
    lim = _limits()
    if km <= lim.walk_max_km:
        return math.ceil(km / lim.walk_kmh * 60)
    return lim.transit_base_min + math.ceil(km / lim.transit_kmh * 60)


# ---------- B. 후보 점수 ----------


def score_candidates(
    reactions: Reactions, places: dict[PlaceId, Place], candidate_ids: list[PlaceId]
) -> dict[PlaceId, float]:
    """POC-001 §7-1 고정식. 붐빔·가격은 절댓값 (TASK-002 §8 B6)."""
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
        # TASK-002 §8 Q24: 좋아한 곳이 없으면 맞는 곳 없음
        return has_liked and not (set(p.mood_tags) & liked_tags)
    if direction == "photo":
        return "사진" in p.mood_tags or "감성" in p.mood_tags
    if direction == "indoor":
        return "실내" in p.mood_tags or p.category in ("museum", "shop")
    if direction == "food":
        return p.category == "food"
    # night: 태그, 또는 그 요일에 19:00보다 늦게 닫는 영업 구간 (TASK-002 §7 Q5)
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
    _check_hours(places)  # TASK-002 §10-4 Q58: 이미 보여 준 곳까지 places 전부
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
        # TASK-002 §8 Q39·§9 Q47: 있는 만큼 전부, 맞는 곳 먼저
        return Batch(
            place_ids=matching + rest,
            direction=direction,
            exhausted=True,
            direction_relaxed=bool(rest),
        )
    if len(matching) >= lim.min_pool:
        return Batch(place_ids=matching[:k], direction=direction, exhausted=False, direction_relaxed=False)
    # TASK-002 §7 Q6: 방향 결과가 모자라면 나머지를 점수순으로 채운다
    return Batch(
        place_ids=(matching + rest)[: min(k, len(pool))],
        direction=direction,
        exhausted=False,
        direction_relaxed=True,
    )


# ---------- E. 방향 버튼 고르기 ----------


def first_batch(
    places: dict[PlaceId, Place],
    categories: list[str],
    direction: Direction | None,
    anchor: tuple[float, float],
    at: datetime,
    k: int = 6,
) -> Batch:
    """TASK-003 §4-1 첫 묶음. 껍데기."""
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
    lim = _limits()
    if not batch:
        return []  # TASK-002 §8 Q37
    count = len(batch)
    rule1: list[Direction] = []
    if sum(p.crowd_level for p in batch) / count >= lim.crowd_avg:
        rule1.append("quieter")
    if sum(_distance_km(anchor, (p.lat, p.lng)) for p in batch) / count > lim.far_avg_km:
        rule1.append("closer")
    if sum(p.price_level for p in batch) / count >= lim.price_avg:
        rule1.append("cheaper")

    # TASK-002 §8 Q25: 직전 방향을 먼저 빼고 채운다
    chosen: list[Direction] = [d for d in rule1 if d != last_direction]

    liked_tags = _liked_tags(reactions, places)
    has_liked = any(i in places for i in reactions.liked)
    rule2: list[Direction] = ["different", "photo", "indoor", "food", "night"]
    fits = {
        d: sum(1 for p in remaining if _matches(d, p, liked_tags, has_liked, anchor, at)) for d in rule2
    }
    # 규칙 2: 남은 후보 3곳 이상, 그다음 1곳 이상 (TASK-002 §7 Q7, §9 Q41: 3개가 될 때까지)
    for need in (lim.enough_remaining, 1):
        for d in rule2:
            if len(chosen) >= 3:
                break
            if d != last_direction and d not in chosen and fits[d] >= need:
                chosen.append(d)
    return chosen


# ---------- F. 코스 계산 ----------


def _default_stay(category: str) -> tuple[int, int, int]:
    """SCREEN-001 §2 종류별 기본 (최소, 보통, 최대) (TASK-002 §7 Q9)."""
    table = {
        "cafe": (30, 60, 90),
        "food": (45, 60, 90),
        "walk": (30, 60, 120),
        "museum": (60, 90, 150),
        "landmark": (60, 120, 180),
        "shop": (30, 60, 120),
        "experience": (60, 90, 150),
        "night": (60, 90, 150),
    }
    return table[category]


def _hours_status(p: Place) -> str:
    """TASK-002 §7 Q13."""
    if p.hours is None:
        return "unknown"
    return "unverified" if p.hours_status == "unknown" else p.hours_status


class _Stay(NamedTuple):
    low: int
    typical: int
    high: int
    user: int | None  # 사용자 값 (자른 뒤)
    eff_low: int  # 사용자 값이 최소보다 짧으면 그 값 (Infeasible 이유 가르기용)


class _Fixed(NamedTuple):
    id: str
    start: int
    end: int
    place_id: PlaceId | None
    coord: tuple[float, float] | None


class _Day:
    """하루 틀. 입력 검사(ValueError)와 영업 구간."""

    def __init__(self, plan: DayPlan, places: dict[PlaceId, Place]):
        lim = _limits()
        self.places = places
        self.start = _to_min(plan.start)
        self.end = _to_min(plan.end)
        self.weekday = plan.date.weekday()
        self.lodging = plan.lodging
        # TASK-002 §9 Q45 ③: 시작 >= 끝이거나 29:59를 넘는 시각은 ValueError
        # TASK-002 §10-5 Q53: DayPlan의 start·end에서 분이 60 이상인 시각("10:75")은 ValueError
        # TASK-003 §0·§10 Q29: 고정 일정(PlanFixed)·영업시간(Opening)의 형식과 분 60 이상은 모델이 거부한다 (engine/models.py).
        # DayPlan의 start·end는 이번 범위 밖이라 위 검사 그대로. 좌표·붐빔·가격 범위는 검사하지 않음 (문서에 답 없음)
        if any(int(value.split(":")[1]) >= 60 for value in (plan.start, plan.end)):
            raise ValueError(f"하루 시각의 분이 60 이상: {plan.start}~{plan.end}")
        _check_ids_fixed = [f.place_id for f in plan.fixed if f.place_id and f.place_id not in places]
        if _check_ids_fixed:
            raise ValueError(f"없는 장소 id: {_check_ids_fixed[0]}")  # TASK-002 §10 #9
        _check_hours(places)  # TASK-002 §10 #5, §10-4 Q58
        if not self.start < self.end <= lim.last_minute:
            raise ValueError(f"하루 범위가 잘못됨: {plan.start}~{plan.end}")
        events = []
        for ev in plan.fixed:
            fs, fe = _to_min(ev.start), _to_min(ev.end)
            if not fs < fe <= lim.last_minute:
                raise ValueError(f"고정 일정 시각이 잘못됨: {ev.id}")
            if fs < self.start or fe > self.end:
                raise ValueError(f"고정 일정이 하루 밖: {ev.id}")
            if ev.place_id is None:
                coord = None
            elif ev.lat is not None and ev.lng is not None:
                coord = (ev.lat, ev.lng)
            else:
                coord = (places[ev.place_id].lat, places[ev.place_id].lng)
            events.append(_Fixed(ev.id, fs, fe, ev.place_id, coord))
        events.sort(key=lambda e: (e.start, e.end))
        for a, b in zip(events, events[1:]):
            if a.end > b.start:
                raise ValueError(f"고정 일정끼리 겹침: {a.id}, {b.id}")
        self.fixed = events

    def intervals(self, p: Place) -> list[tuple[int, int]]:
        """그날 영업 구간. 영업시간 모름이면 하루 전체."""
        if p.hours is None:
            return [(0, 10**6)]
        return sorted((_to_min(o.open), _to_min(o.close)) for o in p.hours if o.weekday == self.weekday)

    def fits(self, p: Place, minutes: int, with_fixed: bool) -> bool:
        """하루 범위(이동 제외) 안 영업 구간 하나에 minutes분이 들어가는가. with_fixed면 고정 일정 시간대는 뺀다."""
        for lo, hi in self.intervals(p):
            pieces = [(max(lo, self.start), min(hi, self.end))]
            if with_fixed:
                for ev in self.fixed:
                    pieces = [
                        piece
                        for a, b in pieces
                        for piece in ((a, min(b, ev.start)), (max(a, ev.end), b))
                    ]
            if any(b - a >= minutes for a, b in pieces):
                return True
        return False

    def drop_reason(self, p: Place, minutes: int) -> str:
        """TASK-002 §10-1 + §8 Q29: 하루가 짧음(no_time) -> 닫힘 -> fixed_conflict -> no_time."""
        if minutes > self.end - self.start:  # TASK-002 §10-1 #1
            return "no_time"
        if not self.fits(p, minutes, with_fixed=False):
            return "closed_at_time" if p.hours is not None else "no_time"
        if not self.fits(p, minutes, with_fixed=True):
            return "fixed_conflict"
        return "no_time"


class _Model:
    """고를 후보 목록 하나에 대한 이동·시간 표와 비트마스크 DP."""

    def __init__(self, day: _Day, ids: list[PlaceId], stays: dict[PlaceId, _Stay], buffer_min: int, eff: bool = False):
        self.day = day
        self.ids = ids
        self.buffer = buffer_min
        n = len(ids)
        fixed = day.fixed
        self.n, self.F = n, len(fixed)
        self.P = n + 1 + self.F
        self.stay_info = [stays[pid] for pid in ids]
        self.stays = [(s.eff_low if eff else (s.user if s.user is not None else s.low)) for s in self.stay_info]
        self.rank_base = n + 2

        places = day.places
        coords: list[tuple[float, float] | None] = [(places[pid].lat, places[pid].lng) for pid in ids]
        # TASK-002 §7 Q14: 하루는 숙소에서 출발. 장소 없는 고정 일정은 좌표가 없어 직전 위치 그대로 (이동 0분, 아래 tf)
        coords.append(day.lodging)
        coords.extend(ev.coord for ev in fixed)
        P = self.P
        self.dist = [[0.0] * n for _ in range(P)]
        self.tv = [[0] * n for _ in range(P)]  # 위치 p -> 후보 i
        self.tf = [[0] * self.F for _ in range(P)]  # 위치 p -> 고정 일정 f (TASK-002 §7 Q14: 장소 없으면 0분, 그 자리 그대로)
        self.home = [0] * P
        for p in range(P):
            here = coords[p]
            if here is None:
                continue
            for i in range(n):
                km = _distance_km(here, coords[i])
                self.dist[p][i] = km
                self.tv[p][i] = _travel_min(km)
            for f in range(self.F):
                there = coords[n + 1 + f]
                self.tf[p][f] = _travel_min(_distance_km(here, there)) if there else 0
            self.home[p] = _travel_min(_distance_km(here, day.lodging))
        self.fixed_pos = [n + 1 + f if fixed[f].coord else None for f in range(self.F)]
        # 후보 i를 f번째 고정 일정 앞에 넣을 때 끝나야 하는 시각 (f == F면 숙소 복귀 기준)
        self.deadline = [
            [(fixed[f].start - self.tf[i][f]) if f < self.F else day.end - self.home[i] for i in range(n)]
            for f in range(self.F + 1)
        ]
        self.intervals = [day.intervals(places[pid]) for pid in ids]

    def earliest(self, i: int, ready: int, stay: int) -> int | None:
        best = None
        for lo, hi in self.intervals[i]:
            start = ready if ready > lo else lo
            if start + stay <= hi and (best is None or start < best):
                best = start
        return best

    # ---- 시뮬레이션: 방문 순서(고정 일정 지나기 포함)를 시각표로 ----

    def simulate(self, tokens: list[int], stays: list[int]):
        """tokens: 0 = 다음 고정 일정을 지남, k > 0 = 후보 k-1 방문. 규칙에 어긋나면 None."""
        n, P, F = self.n, self.P, self.F
        fixed = self.day.fixed
        t, last, f = self.day.start, n + P, 0  # last >= P: 쉬는 시간 없음 (하루 시작, 고정 일정 뒤)
        entries = []
        for token in tokens:
            pos = last if last < P else last - P
            if token == 0:
                if f >= F:
                    return None
                tt = self.tf[pos][f]
                if t + tt > fixed[f].start:
                    return None
                entries.append(("f", f, fixed[f].start, fixed[f].end, tt, 0))
                t = fixed[f].end
                last = (self.fixed_pos[f] if self.fixed_pos[f] is not None else pos) + P
                f += 1
            else:
                i = token - 1
                tt = self.tv[pos][i]
                # TASK-002 §8 Q28: 쉬는 시간은 앞 항목이 방문일 때만 (하루 시작·고정 일정 뒤에는 이동 시간만)
                ready = t + tt + (self.buffer if last < n else 0)
                start = self.earliest(i, ready, stays[i])
                if start is None or start + stays[i] > self.deadline[f][i]:
                    return None
                entries.append(("v", i, start, start + stays[i], tt, start - ready))
                t, last = start + stays[i], i
        pos = last if last < P else last - P
        if f != F or t + self.home[pos] > self.day.end:
            return None
        return entries, self.home[pos]

    # ---- 비트마스크 DP ----

    def solve(self, required: int):
        """꼭 갈 곳(required 비트)을 포함하며 가장 많이, 같으면 이동 합 작게, 같으면 id 순. 없으면 None."""
        n, P, F = self.n, self.P, self.F
        fixed = self.day.fixed
        base = self.rank_base
        buf = self.buffer
        stays = self.stays
        full = (1 << n) - 1
        layers: list[list[dict[int, list[tuple[int, int, int]]]] | None] = [None] * (full + 1)

        def put(mask: int, f: int, last: int, label: tuple[int, int, int]) -> None:
            slot = layers[mask]
            if slot is None:
                slot = layers[mask] = [{} for _ in range(F + 1)]
            cur = slot[f].get(last)
            if cur is None:
                slot[f][last] = [label]
                return
            t, trv, key = label
            for t2, trv2, key2 in cur:
                if t2 <= t and (trv2 < trv or (trv2 == trv and key2 <= key)):
                    return
            cur[:] = [x for x in cur if not (t <= x[0] and (trv < x[1] or (trv == x[1] and key <= x[2])))]
            cur.append(label)

        put(0, 0, n + P, (self.day.start, 0, 0))
        for mask in range(full + 1):
            slot = layers[mask]
            if slot is None:
                continue
            for f in range(F + 1):
                deadline_f = self.deadline[f]
                for last, labels in list(slot[f].items()):
                    pos = last if last < P else last - P
                    gap = buf if last < n else 0  # TASK-002 §8 Q28: 고정 일정 앞뒤·하루 시작에는 쉬는 시간 없음
                    tvp = self.tv[pos]
                    for t, trv, key in labels:
                        for i in range(n):
                            if mask >> i & 1:
                                continue
                            tt = tvp[i]
                            start = self.earliest(i, t + tt + gap, stays[i])
                            if start is None:
                                continue
                            end = start + stays[i]
                            if end > deadline_f[i]:
                                continue
                            put(mask | 1 << i, f, i, (end, trv + tt, key * base + i + 1))
                        if f < F:
                            # TASK-002 §10-3: 이동 합까지 같으면 고정 일정을 먼저 지나는 쪽(key의 0)이 뽑힌다. R1에서는 그대로 둔다
                            tt = self.tf[pos][f]
                            if t + tt <= fixed[f].start:
                                new_pos = self.fixed_pos[f] if self.fixed_pos[f] is not None else pos
                                put(mask, f + 1, new_pos + P, (fixed[f].end, trv + tt, key * base))

        best = None
        for mask in range(full + 1):
            slot = layers[mask]
            if slot is None or mask & required != required:
                continue
            count = bin(mask).count("1")
            for last, labels in slot[F].items():
                pos = last if last < P else last - P
                home = self.home[pos]
                for t, trv, key in labels:
                    if t + home > self.day.end:
                        continue
                    rank = (-count, trv + home, key)
                    if best is None or rank < best:
                        best = rank
        if best is None:
            return None
        count = -best[0] + F
        key, tokens = best[2], []
        for _ in range(count):
            key, digit = divmod(key, base)
            tokens.append(digit)
        tokens.reverse()
        return tokens


class _Wanted(NamedTuple):
    ids: list[PlaceId]  # 꼭 갈 곳 + 담은 곳, id 순
    infos: dict[PlaceId, _Stay]
    closed: set[PlaceId]  # 하루는 충분한데 영업 구간 어디에도 필요 시간이 안 들어감 (TASK-002 §10-1 #2)
    short: set[PlaceId]  # 필요 시간이 하루 길이보다 김 (TASK-002 §10-1 #1)
    mandatory: set[PlaceId]  # 꼭 갈 곳 + 사용자 값을 지켜야 하는 담은 곳 (TASK-002 §8 Q32)


def _wanted(plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place], day: _Day) -> _Wanted:
    lim = _limits()
    # TASK-002 §10 #7, §10-4 Q60: 고정 일정으로 가는 장소는 한 번만 방문 -> 담은 곳·꼭 갈 곳에서 뺀다
    # TASK-002 §10-5 Q64: 고정 일정 장소가 그날 휴무여도 정상 코스 (고정 일정은 사용자가 확인한 예약으로 본다).
    #   꼭 갈 곳이어도 Infeasible로 보지 않는다 (Q60: 고정 일정 방문으로 채운 것, 영업은 Q54처럼 안 봄)
    fixed_places = {ev.place_id for ev in day.fixed if ev.place_id}
    ids = sorted((set(picks) | set(plan.must_visit)) - fixed_places, key=_id_key)
    day_len = day.end - day.start
    infos: dict[PlaceId, _Stay] = {}
    closed: set[PlaceId] = set()
    short: set[PlaceId] = set()
    for pid in ids:
        p = places[pid]
        low, typical, high = (p.stay.min, p.stay.typical, p.stay.max) if p.stay else _default_stay(p.category)
        user = None
        if pid in plan.stay_overrides:  # TASK-002 §9 Q43: 담은 곳·꼭 갈 곳이 아니면 무시 (ids에 없으면 여기 안 옴)
            user = min(lim.user_stay_high, max(lim.user_stay_low, plan.stay_overrides[pid]))
        # TASK-002 §10-2 #6: 사용자 값이 최소보다 짧으면 그 값이 필요 시간 (eff_low)
        # TASK-002 §10-5 Q62: 영업 20분, 최소 30, 사용자 21분처럼 사용자 값도 영업 구간에 안 들어가면 "닫힘"으로 본다
        #   (사용자 값 때문에만 안 들어가는 경우가 아니라 TASK-002 §10-4의 user_stay_conflict 대상이 아님)
        # TASK-002 §10-5 Q63: 최소가 하루보다 긴데 사용자 값은 들어가면 사용자 값으로 들어감 (사용자 값이 더 짧아 들어가면 존중, #6).
        #   최소·사용자 값이 모두 하루보다 길면 하루가 짧음(TASK-002 §10-1 #1)
        info = _Stay(low, typical, high, user, low if user is None else min(user, low))
        infos[pid] = info
        if info.eff_low > day_len:  # TASK-002 §10-1 #1: m > L 이면 하루가 짧음 (닫힘보다 먼저)
            short.add(pid)
        elif p.hours is not None and not day.fits(p, info.eff_low, with_fixed=False):  # TASK-002 §10-1 #2
            closed.add(pid)
    must = set(plan.must_visit) - fixed_places
    # TASK-002 §10-1 #1: 담은 곳이 하루보다 길면 Infeasible이 아니라 dropped(no_time)이라 꼭 지킬 대상에서 뺀다
    mandatory = (must | {pid for pid in ids if infos[pid].user is not None}) - closed - (short - must)
    return _Wanted(ids, infos, closed, short, mandatory)


def _mask(ids: list[PlaceId], chosen: set[PlaceId]) -> int:
    return sum(1 << i for i, pid in enumerate(ids) if pid in chosen)


def _chain_check(day: _Day) -> Infeasible | None:
    """TASK-002 §8 Q30·§9 Q45: 고정 일정만으로 하루가 이어지는가."""
    t, pos = day.start, day.lodging
    for ev in day.fixed:
        target = ev.coord or pos
        if t + _travel_min(_distance_km(pos, target)) > ev.start:
            return Infeasible(reason="fixed_unreachable", blocking=[ev.id], suggest_drop=[])
        t, pos = ev.end, target
    if t + _travel_min(_distance_km(pos, day.lodging)) > day.end:
        return Infeasible(reason="fixed_unreachable", blocking=[day.fixed[-1].id], suggest_drop=[])
    return None


def _build_option(
    model: _Model, tokens: list[int], label: str, targets_high: bool, plan_day: _Day, expand: bool = True
) -> CourseOption:
    lim = _limits()
    stays = list(model.stays)
    order = [t - 1 for t in tokens if t > 0]
    grow = [i for i in order if model.stay_info[i].user is None]  # 사용자 값은 늘리지 않음 (TASK-002 §8 Q31)
    stages = [lambda s: s.typical] + ([lambda s: s.high] if targets_high else [])
    if not expand:
        stages = []
    for target in stages:
        progress = True
        while progress:  # TASK-002 §8 Q31: 방문 순서대로 돌아가며 5분씩
            progress = False
            for i in grow:
                goal = target(model.stay_info[i])
                if stays[i] >= goal:
                    continue
                before = stays[i]
                if before + lim.step_min > goal:  # TASK-002 §10 #8: 5분 단위만, 목표를 넘으면 늘리지 않음
                    continue
                stays[i] = before + lim.step_min
                if model.simulate(tokens, stays) is None:
                    stays[i] = before
                else:
                    progress = True
    entries, go_home = model.simulate(tokens, stays)
    places = plan_day.places
    items: list[CourseItem] = []
    for seq, (kind, idx, start, end, tt, wait) in enumerate(entries, start=1):
        if kind == "v":
            p = places[model.ids[idx]]
            info = model.stay_info[idx]
            items.append(
                CourseItem(
                    seq=seq, place_id=p.id, start=_hhmm(start), end=_hhmm(end), stay_min=stays[idx],
                    stay_source="user" if info.user is not None else "auto", travel_min=tt, wait_min=wait,
                    is_fixed=False, hours_status=_hours_status(p),
                )
            )
        else:
            ev = plan_day.fixed[idx]
            # TASK-002 §10-3 주석 지정: 고정 일정은 시각 그대로라 기다림이 없다 -> wait_min=0 (TASK-002 §7 Q12, §8 Q28)
            # TASK-002 §10-5 Q54: 장소 있는 고정 일정이 영업시간 밖이어도 그대로 둔다 (시각 그대로가 우선, 영업은 검사하지 않음)
            items.append(
                CourseItem(
                    seq=seq, place_id=ev.place_id, start=_hhmm(start), end=_hhmm(end), stay_min=end - start,
                    stay_source=None, travel_min=tt, wait_min=0, is_fixed=True,
                    hours_status=_hours_status(places[ev.place_id]) if ev.place_id else None,
                )
            )
    return CourseOption(
        label=label,  # type: ignore[arg-type]
        items=items,
        dropped=[],
        go_home_min=go_home,
        total_travel_min=sum(i.travel_min for i in items) + go_home,
    )


def compose_courses(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place]
) -> list[CourseOption] | Infeasible:
    lim = _limits()
    day = _Day(plan, places)
    _check_ids(plan, picks, places)
    unreachable = _chain_check(day)
    if unreachable:
        return unreachable

    want = _wanted(plan, picks, places, day)
    closed_must = sorted((pid for pid in plan.must_visit if pid in want.closed), key=_id_key)
    if closed_must:  # TASK-002 §7 Q15, §10-1 #2 (하루가 짧은 꼭 갈 곳은 아래 overflow)
        return Infeasible(reason="must_visit_closed", blocking=closed_must, suggest_drop=[])

    # 닫힌 곳과 하루보다 긴 담은 곳은 넣을 수 없으니 후보에서 뺀다 (dropped로 간다)
    candidates = [pid for pid in want.ids if pid not in want.closed and (pid not in want.short or pid in want.mandatory)]
    required = _mask(candidates, want.mandatory)
    # TASK-002 §7 Q10: 안마다 쉬는 시간을 넣은 채로 DP 고르기를 따로 한다 (packed 5분, relaxed 15분)
    packed_model = _Model(day, candidates, want.infos, lim.packed_buffer_min)
    packed = packed_model.solve(required)
    if packed is None:
        return _why_infeasible(day, plan, picks, want, candidates)
    relaxed_model = _Model(day, candidates, want.infos, lim.relaxed_buffer_min)
    relaxed = relaxed_model.solve(required)

    def finish(model: _Model, tokens: list[int], label: str, high: bool) -> CourseOption:
        option = _build_option(model, tokens, label, high, day)
        visited = {model.ids[t - 1] for t in tokens if t > 0}
        dropped = [
            Dropped(place_id=pid, reason=day.drop_reason(places[pid], want.infos[pid].eff_low))  # type: ignore[arg-type]
            for pid in want.ids
            if pid not in visited
        ]
        return option.model_copy(update={"dropped": dropped})

    packed_option = finish(packed_model, packed, "packed", False)
    if relaxed is None:  # TASK-002 §9 Q42 (TASK-002 §10-5 Q48: 바꾼 곳이 packed에만 들어갈 때도 같은 규칙으로 packed 1안)
        return [packed_option]
    relaxed_option = finish(relaxed_model, relaxed, "relaxed", True)
    same = packed_option.model_copy(update={"label": "relaxed"}) == relaxed_option
    return [relaxed_option] if same else [relaxed_option, packed_option]  # TASK-002 §8 Q35


def _why_infeasible(day: _Day, plan: DayPlan, picks: list[PlaceId], want: _Wanted, candidates: list[PlaceId]) -> Infeasible:
    """TASK-002 §9 Q44 ③: must_visit_closed(앞에서 처리) -> must_visit_overflow -> user_stay_conflict."""
    lim = _limits()
    mandatory = sorted(want.mandatory, key=_id_key)
    # TASK-002 §10 #2: 형식은 "꼭 갈 곳" 수로 가른다 (사용자 값을 지켜야 하는 담은 곳은 세지 않음)
    musts = sorted((pid for pid in mandatory if pid in set(plan.must_visit)), key=_id_key)

    def feasible(ids: list[PlaceId], needed: list[PlaceId]) -> bool:
        # 사용자 값 대신 필요 시간의 최소(eff)로 본다: 최소로도 안 들어가는지 가르기 위해
        model = _Model(day, ids, want.infos, lim.packed_buffer_min, eff=True)
        return model.solve(_mask(ids, set(needed))) is not None

    # TASK-002 §10 #4, §10-4 Q57: overflow는 꼭 갈 곳끼리의 문제일 때만. 바꾼 담은 곳은 최소로도 안 들어가도 아래 user_stay_conflict
    # TASK-002 §10-5 Q65: 바꾼 곳이 이동·고정 일정 때문에 못 들어가는 경우(예: 이동 포함 53분)도 user_stay_conflict
    if musts and not feasible(candidates, musts):
        # TASK-002 §10-5 Q50: 이동·고정 일정 때문에 못 들어가는 경우도 must_visit_overflow
        if len(musts) >= 2:
            # TASK-002 §10 #2 (§8 Q33 형식): 꼭 갈 곳이 둘 이상이면 blocking은 전부, suggest_drop은 빼면 나머지가 들어가는 곳
            suggest = [
                pid
                for pid in musts
                if feasible([q for q in musts if q != pid], [q for q in musts if q != pid])
            ]
            return Infeasible(reason="must_visit_overflow", blocking=musts, suggest_drop=suggest)
        # TASK-002 §9 Q44 ②, §10 #2: 꼭 갈 곳 1곳이 혼자서도 안 들어감 (바꾼 담은 곳이 있어도) -> blocking=[그 곳], suggest_drop=[]
        return Infeasible(reason="must_visit_overflow", blocking=musts, suggest_drop=[])

    # TASK-002 §10 #3·#4, §10-4 Q55~Q57: 사용자 값(또는 바꾼 담은 곳)이 걸린 문제는 항상 user_stay_conflict.
    # 꼭 갈 곳이 있든 없든, 하나든 여럿이든 같다. blocking은 바꾼 곳 전부 (Q57)
    # TASK-002 §10-5 Q52: 꼭 갈 곳끼리는 들어가는데 바꾼 담은 곳과 함께 최소로 못 들어가면 (꼭 갈 곳 수와 상관없이)
    #   overflow가 아니라 user_stay_conflict, blocking은 바꾼 곳만 (꼭 갈 곳은 넣지 않음)
    changed = [pid for pid in mandatory if want.infos[pid].user is not None]
    fixed_places = {ev.place_id for ev in day.fixed if ev.place_id}
    others = [pid for pid in picks if pid not in set(plan.must_visit) and pid not in fixed_places]
    # TASK-002 §9 Q44 ④, §10 #3: suggest_drop에 바꾼 곳 자신 포함 (되돌리거나 빼는 선택지)
    # TASK-002 §10 #7: 고정 일정 장소는 담은 곳에서 빠졌으므로 제안에도 넣지 않음
    # TASK-002 §10-5 Q52: 나머지는 꼭 갈 곳이 아닌 담은 곳 전부 (도움이 되는 곳만 가리지 않음)
    suggest = sorted(set(others) | set(changed), key=_id_key)
    return Infeasible(reason="user_stay_conflict", blocking=changed, suggest_drop=suggest)


def compose_greedy(
    plan: DayPlan, picks: list[PlaceId], places: dict[PlaceId, Place], buffer_min: int
) -> list[CourseItem]:
    """비교용 탐욕법 (TASK-002 §7 Q17): 숙소에서 시작해 들어갈 수 있는 곳 중 가장 가까운 곳, 최소 머무는 시간."""
    day = _Day(plan, places)
    _check_ids(plan, picks, places)  # TASK-002 §10-4 Q59
    want = _wanted(plan, picks, places, day)
    infos = {pid: info._replace(user=None) for pid, info in want.infos.items()}
    model = _Model(day, want.ids, infos, buffer_min)
    n, P, F = model.n, model.P, model.F
    tokens: list[int] = []
    t, last, f = day.start, n + P, 0
    used: set[int] = set()
    while True:
        pos = last if last < P else last - P
        best = None
        for i in range(n):
            if i in used:
                continue
            tt = model.tv[pos][i]
            start = model.earliest(i, t + tt + (buffer_min if last < n else 0), model.stays[i])
            if start is None or start + model.stays[i] > model.deadline[f][i]:
                continue
            rank = (model.dist[pos][i], i)
            if best is None or rank < best[0]:
                best = (rank, i, start + model.stays[i])
        if best is not None:
            _, i, t = best
            tokens.append(i + 1)
            used.add(i)
            last = i
        elif f < F and t + model.tf[pos][f] <= day.fixed[f].start:
            tokens.append(0)
            t = day.fixed[f].end
            last = (model.fixed_pos[f] if model.fixed_pos[f] is not None else pos) + P
            f += 1
        else:
            break
    while f < F:  # 남은 고정 일정은 그대로 둔다 (닿을 수 있는 만큼)
        if model.simulate(tokens + [0], model.stays) is None:
            break
        tokens.append(0)
        f += 1
    result = model.simulate(tokens, model.stays)
    if result is None:  # 마지막 숙소 복귀가 하루 끝을 넘는 경우 등 시간표가 안 만들어지면 빈 목록을 돌려준다
        return []
    option = _build_option(model, tokens, "packed", False, day, expand=False)
    return option.items
