"""그래프 상태·저장소 -> §6 응답 모양. 값과 문구는 **응답을 만드는 그때의 상태로 매번 새로 계산**한다 (TASK-003 §10 원칙 2).

사실 값(영업시간·확인 상태)은 장소 데이터에서만 가져오고, 문구는 §6의 고정 대본만 쓴다 (LLM 없음).
"""

from engine.models import Direction, Place as EnginePlace, PlaceId
from engine.planning import fits_direction, next_batch, pick_directions
from graphs.planning import DEFAULT_CLARIFY, Outcome, PlanningState, candidates, day_start
from planning.repo import DayRecord, PlanningRepo
from planning.schemas import (
    Candidate,
    CandidateBatch,
    Choice,
    CourseResult,
    CourseResultOption,
    DirectionChoice,
    Fact,
    Picks,
    Place,
    Question,
)

# TASK-003 §6 방향 이름표 (고정)
DIRECTION_LABELS: dict[Direction, str] = {
    "quieter": "좀 더 한적한 데",
    "closer": "숙소랑 가까운 데",
    "cheaper": "좀 더 저렴한 데",
    "different": "완전 다른 느낌",
    "photo": "사진 예쁜 데",
    "indoor": "실내로",
    "food": "먹을 데",
    "night": "밤에 갈 데",
}
# TASK-003 §10 Q4: 칩 ID와 보내는 순서
CHOICES = [
    Choice(id="walk_alley", label="골목 산책"),
    Choice(id="food_tour", label="맛집 투어"),
    Choice(id="shopping", label="쇼핑"),
    Choice(id="night_view", label="야경"),
    Choice(id="cafe", label="카페"),
    Choice(id="museum_experience", label="전시·체험"),
]
# TASK-003 §6 message·why 대본 (고정)
MSG_FIRST = "이런 곳들 어때? 마음에 들면 담아 줘"
MSG_NO_DIRECTION = "다른 곳들도 찾아봤어"
MSG_CLARIFY = "이 중에 있어?"
MSG_EXHAUSTED = "더 보여 줄 곳이 거의 없어. 이제 코스 짜 볼까?"
WHY_NONE = "이런 곳도 있어요"
QUESTION_TAIL = " 어떤 하루면 좋겠어? 끌리는 거 다 골라 줘!"
DAY_WORDS = {1: "첫째 날은", 2: "둘째 날은", 3: "셋째 날은", 4: "넷째 날은", 5: "다섯째 날은"}  # TASK-003 §10 Q5


def question(day_number: int) -> Question:
    """TASK-003 §10 Q5·Q36: 첫째~다섯째 날, 6일째부터 "{n}일째"."""
    return Question(
        text=DAY_WORDS.get(day_number, f"{day_number}일째는") + QUESTION_TAIL,
        choices=list(CHOICES),
        allow_text=True,
        allow_auto=True,
    )


def _opening_fact(place: EnginePlace, weekday: int) -> Fact:
    """TASK-003 §6, §10 Q9·Q10 정리: 상태는 **장소 단위**로 먼저 정리하고 요일 값을 만든다.

    - 영업시간 모름(None)이면 값 null, 상태 unknown
    - 영업 구간이 하루라도 있는데 상태가 unknown이면 모든 요일에서 unverified (같은 장소의 상태가 요일마다 달라지지 않게)
    - 그날 휴무(구간 없음)면 값 null, 상태는 위에서 정리한 그대로 (미확인을 확인됨으로 내보내지 않는다)
    """
    if place.hours is None:
        return Fact(field="opening_hours", value=None, status="unknown", source_type="demo", checked_at=None)
    status = place.hours_status
    if status == "unknown" and place.hours:
        status = "unverified"
    today = sorted((o for o in place.hours if o.weekday == weekday), key=lambda o: (o.open, o.close))
    value = ",".join(f"{o.open}-{o.close}" for o in today) or None
    return Fact(field="opening_hours", value=value, status=status, source_type="demo", checked_at=None)


def place_view(place: EnginePlace, weekday: int) -> Place:
    return Place(
        id=place.id,
        name=place.name,
        category=place.category,
        lat=place.lat,
        lng=place.lng,
        crowd_level=place.crowd_level,
        price_level=place.price_level,
        mood_tags=list(place.mood_tags),
        facts=[_opening_fact(place, weekday)],
    )


def _choices(directions: list[Direction]) -> list[DirectionChoice]:
    return [DirectionChoice(id=d, label=DIRECTION_LABELS[d]) for d in directions]


def batch_response(state: PlanningState, repo: PlanningRepo, outcome: Outcome, day: DayRecord) -> CandidateBatch:
    """§6 CandidateBatch. 되묻기도 같은 모양이고 값은 지금 상태로 계산한다 (§10 Q30)."""
    cand = candidates(day)
    reactions = repo.reactions(state.session_id)
    anchor, at, weekday = day.plan.lodging, day_start(day), day.plan.date.weekday()
    shown = set(state.shown)
    batch = [cand[pid] for pid in state.batch]
    remaining = [p for pid, p in cand.items() if pid not in shown]
    directions = pick_directions(batch, remaining, reactions, cand, state.last_direction, anchor, at)

    exhausted = outcome.exhausted
    if outcome.clarify:
        # §10 Q37: 되묻기의 exhausted는 지금 안 보여 준 곳이 5곳 미만인지 (엔진의 next_batch 정의 그대로)
        exhausted = next_batch(cand, reactions, None, state.shown, anchor, at).exhausted
    # §10-10 R4: direction_relaxed는 묶음을 만들 때의 값 그대로 (묶음의 성질). 되묻기에서도 바뀌지 않는다
    relaxed = repo.batch_relaxed(state.session_id)

    # §10 Q6: 되묻기 > exhausted > 첫 묶음 > 방향 있음 > 방향 없음
    if outcome.clarify:
        message = MSG_CLARIFY
    elif exhausted:
        message = MSG_EXHAUSTED
    elif outcome.first:
        message = MSG_FIRST
    elif state.last_direction:
        message = f"{DIRECTION_LABELS[state.last_direction]} 쪽으로 다시 찾아봤어!"
    else:
        message = MSG_NO_DIRECTION

    candidates_out = []
    for p in batch:
        # §10-10 R9: 겹침은 자기를 뺀 좋아한 곳과 본다
        liked_tags = {tag for pid in reactions.liked if pid in cand and pid != p.id for tag in cand[pid].mood_tags}
        overlap = next((tag for tag in p.mood_tags if tag in liked_tags), None)  # §10 Q8: 후보의 mood_tags 순서
        if overlap:
            why = f"{overlap} 좋아해서 골랐어요"
        elif state.last_direction and fits_direction(state.last_direction, p, reactions, cand, anchor, at):
            why = f"{DIRECTION_LABELS[state.last_direction]} 쪽이에요"  # §10 Q7: 방향을 못 지켜 채운 곳은 기본 문장
        else:
            why = WHY_NONE
        candidates_out.append(Candidate(place=place_view(p, weekday), why=why))

    clarify = None
    if outcome.clarify:
        clarify = _choices(directions or DEFAULT_CLARIFY)  # §4-3: 0개면 기본 3개

    return CandidateBatch(
        session_id=state.session_id,
        stage=state.stage,
        round=state.round,
        message=message,
        candidates=candidates_out,
        directions=_choices(directions),
        clarify=clarify,
        picks_count=len(reactions.liked),
        exhausted=exhausted,
        direction_relaxed=relaxed,
    )


def picks_response(state: PlanningState, repo: PlanningRepo) -> Picks:
    liked: list[PlaceId] = repo.reactions(state.session_id).liked
    return Picks(picks=liked, picks_count=len(liked))


def course_response(state: PlanningState, repo: PlanningRepo) -> CourseResult:
    options = []
    for option_id in state.option_ids:
        record = repo.get_option(option_id)
        assert record is not None
        course = record.course
        options.append(
            CourseResultOption(
                option_id=option_id,
                label=course.label,
                items=course.items,
                dropped=course.dropped,
                go_home_min=course.go_home_min,
                total_travel_min=course.total_travel_min,
            )
        )
    return CourseResult(session_id=state.session_id, stage=state.stage, options=options)
