"""그래프 상태·저장소 -> §6 응답 모양. 값과 문구는 **응답을 만드는 그때의 상태로 매번 새로 계산**한다 (TASK-003 §10 원칙 2).

사실 값(영업시간·확인 상태)은 장소 데이터에서만 가져오고, 문구는 §6의 고정 대본만 쓴다 (LLM 없음).
"""

from engine.models import Direction, Place as EnginePlace, PlaceId, Reactions
from engine.planning import fits_direction, next_batch, pick_directions
from planning.repo import DayRecord, OptionRecord
from planning.state import DEFAULT_CLARIFY, PlanningState, candidates, day_start
from planning.schemas import (
    Candidate,
    CandidateBatch,
    Choice,
    CourseItemView,
    CourseResult,
    CourseResultOption,
    DayFixed,
    DayMustVisit,
    DaySummary,
    DirectionChoice,
    DroppedView,
    Fact,
    LatLng,
    Picks,
    Place,
    PlanningDone,
    PlanningSession,
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


DEFAULT_MUST_STAY_MIN = 60  # TASK-006 Q19: 바꾼 값도 typical도 없을 때


def must_stay_min(place: EnginePlace, overrides: dict[PlaceId, int]) -> int:
    """TASK-006 §11 Q19: 바꾼 머문 시간 > typical > 60."""
    if place.id in overrides:
        return overrides[place.id]
    return place.stay.typical if place.stay else DEFAULT_MUST_STAY_MIN


def day_summary(day_id: str, day: DayRecord, overrides: dict[PlaceId, int] | None = None) -> DaySummary:
    """TASK-004 A2: 저장소의 하루 데이터 그대로. 고정 일정 name = 장소 이름, 장소가 없으면 저장된 title (§12-1 Q1).

    overrides = 세션에서 ±15로 바꾼 머문 시간 (TASK-006 R5). 하루 데이터의 stay_overrides 위에 얹는다.
    """
    plan = day.plan
    stays = {**plan.stay_overrides, **(overrides or {})}
    return DaySummary(
        day_id=day_id,
        day_number=day.day_number,
        date=plan.date,
        start=plan.start,
        end=plan.end,
        lodging=LatLng(lat=plan.lodging[0], lng=plan.lodging[1]),
        must_visits=[DayMustVisit(place_id=pid, name=day.places[pid].name, stay_min=must_stay_min(day.places[pid], stays)) for pid in plan.must_visit],
        fixed=[
            DayFixed(
                place_id=f.place_id,
                name=day.places[f.place_id].name if f.place_id else f.title,
                start=f.start,
                end=f.end,
            )
            for f in plan.fixed
        ],
    )


def session_response(state: PlanningState, day: DayRecord, overrides: dict[PlaceId, int] | None = None) -> PlanningSession:
    """TASK-003 §6 PlanningSession (첫 질문). 시작 응답과 GET(asking)이 함께 쓴다."""
    return PlanningSession(
        session_id=state.session_id,
        stage="asking",
        question=question(day.day_number),
        day=day_summary(state.day_id, day, overrides),
    )


def _opening_fact(place: EnginePlace, weekday: int, source: str = "demo") -> Fact:
    """TASK-003 §6, §10 Q9·Q10 정리: 상태는 **장소 단위**로 먼저 정리하고 요일 값을 만든다.

    - 영업시간 모름(None)이면 값 null, 상태 unknown
    - 영업 구간이 하루라도 있는데 상태가 unknown이면 모든 요일에서 unverified (같은 장소의 상태가 요일마다 달라지지 않게)
    - 그날 휴무(구간 없음)면 값 null, 상태는 위에서 정리한 그대로 (미확인을 확인됨으로 내보내지 않는다)
    """
    if place.hours is None:
        return Fact(field="opening_hours", value=None, status="unknown", source_type=source, checked_at=None)
    status = place.hours_status
    if status == "unknown" and place.hours:
        status = "unverified"
    today = sorted((o for o in place.hours if o.weekday == weekday), key=lambda o: (o.open, o.close))
    value = ",".join(f"{o.open}-{o.close}" for o in today) or None
    return Fact(field="opening_hours", value=value, status=status, source_type=source, checked_at=None)


def place_view(place: EnginePlace, weekday: int, source: str = "demo") -> Place:
    return Place(
        id=place.id,
        name=place.name,
        category=place.category,
        lat=place.lat,
        lng=place.lng,
        crowd_level=place.crowd_level,
        price_level=place.price_level,
        mood_tags=list(place.mood_tags),
        facts=[_opening_fact(place, weekday, source)],
    )


def _choices(directions: list[Direction]) -> list[DirectionChoice]:
    return [DirectionChoice(id=d, label=DIRECTION_LABELS[d]) for d in directions]


def batch_response(
    state: PlanningState,
    reactions: Reactions,
    relaxed: bool,
    day: DayRecord,
    *,
    first: bool,
    clarify: bool,
    exhausted: bool,
    overrides: dict[PlaceId, int] | None = None,
) -> CandidateBatch:
    """§6 CandidateBatch. 되묻기도 같은 모양이고 값은 **넘겨 받은 새 상태·반응**으로 계산한다 (§10 Q30).

    TASK-003 §10-11 R12: 그래프가 상태·저장소를 바꾸기 전에 호출된다. 그래서 저장소를 읽지 않고 값을 인자로 받는다.
    """
    cand = candidates(day)
    anchor, at, weekday = day.plan.lodging, day_start(day), day.plan.date.weekday()
    shown = set(state.shown)
    batch = [cand[pid] for pid in state.batch]
    remaining = [p for pid, p in cand.items() if pid not in shown]
    directions = pick_directions(batch, remaining, reactions, cand, state.last_direction, anchor, at)

    if clarify:
        # §10 Q37: 되묻기의 exhausted는 지금 안 보여 준 곳이 5곳 미만인지 (엔진의 next_batch 정의 그대로)
        exhausted = next_batch(cand, reactions, None, state.shown, anchor, at).exhausted
    # relaxed(§10-10 R4)는 묶음을 만들 때의 값 그대로 (묶음의 성질). 되묻기에서도 바뀌지 않는다

    # §10 Q6: 되묻기 > exhausted > 첫 묶음 > 방향 있음 > 방향 없음
    if clarify:
        message = MSG_CLARIFY
    elif exhausted:
        message = MSG_EXHAUSTED
    elif first:
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
        candidates_out.append(Candidate(place=place_view(p, weekday, (day.sources or {}).get(p.id, "demo")), why=why))

    return CandidateBatch(
        session_id=state.session_id,
        stage=state.stage,
        round=state.round,
        message=message,
        candidates=candidates_out,
        directions=_choices(directions),
        clarify=_choices(directions or DEFAULT_CLARIFY) if clarify else None,  # §4-3: 0개면 기본 3개
        picks_count=len(reactions.liked),
        exhausted=exhausted,
        direction_relaxed=relaxed,
        day=day_summary(state.day_id, day, overrides),
        picks=list(reactions.liked),  # TASK-004 §12-1 A6: 담은 순서. 인자로 받은 반응이라 저장 전 시점이 유지된다
    )


def batch_now(
    state: PlanningState,
    reactions: Reactions,
    relaxed: bool,
    first: bool,
    day: DayRecord,
    overrides: dict[PlaceId, int] | None = None,
) -> CandidateBatch:
    """TASK-004 A1: 지금 묶음을 **지금 상태로 다시 계산**한 응답 (GET). 아무것도 저장하지 않는다.

    TASK-004 §12-1 Q2·Q3: exhausted는 지금 안 보여 준 곳이 5곳 미만인지 다시 계산(소진이면 소진 문장),
    clarify_count가 1이면 되묻기 칩과 "이 중에 있어?"를 다시 준다. POST와 같은 `batch_response`를 쓴다.
    `first`(첫 묶음 대본 여부)와 `relaxed`는 묶음을 만들 때의 값이라 저장소에서 읽어 온다 (§10-10 R4).
    """
    cand = candidates(day)
    exhausted = next_batch(cand, reactions, None, state.shown, day.plan.lodging, day_start(day)).exhausted
    return batch_response(
        state, reactions, relaxed, day, first=first, clarify=state.clarify_count == 1, exhausted=exhausted, overrides=overrides
    )


def done_response(state: PlanningState, option_id: str) -> PlanningDone:
    return PlanningDone(day_id=state.day_id, option_id=option_id, stage="done")


def picks_response(reactions: Reactions) -> Picks:
    liked: list[PlaceId] = list(reactions.liked)
    return Picks(picks=liked, picks_count=len(liked))


def option_view(record: OptionRecord, day: DayRecord) -> CourseResultOption:
    """코스안 한 칸의 응답 모양. 코스안 카드(POST planning)와 고른 코스 읽기(GET /days/{id}/course)가 함께 쓴다."""
    titles = [f.title for f in sorted((f for f in day.plan.fixed if f.place_id is None), key=lambda f: (f.start, f.end))]
    untitled = iter(titles)
    weekday = day.plan.date.weekday()
    items = [
        CourseItemView(
            **item.model_dump(),
            name=day.places[item.place_id].name if item.place_id else next(untitled),
            lat=day.places[item.place_id].lat if item.place_id else None,
            lng=day.places[item.place_id].lng if item.place_id else None,
            facts=[_opening_fact(day.places[item.place_id], weekday, (day.sources or {}).get(item.place_id, "demo"))] if item.place_id else [],
        )
        for item in record.course.items
    ]
    dropped = [DroppedView(**d.model_dump(), name=day.places[d.place_id].name) for d in record.course.dropped]
    return CourseResultOption(
        option_id=record.option_id,
        label=record.course.label,
        items=items,
        dropped=dropped,
        go_home_min=record.course.go_home_min if day.lodging_known else None,  # §10 Q27: 돌아갈 숙소가 없으면 null
        total_travel_min=record.course.total_travel_min,
    )


def course_response(
    state: PlanningState, records: list[OptionRecord], day: DayRecord, overrides: dict[PlaceId, int] | None = None
) -> CourseResult:
    """TASK-003 §6 CourseResult + TASK-004 A2(day)·A3(name).

    항목 name: 장소가 있으면 장소 이름(고정 일정 포함, §12-1 Q1). 장소가 없는 고정 일정은 저장된 title.
    # TASK-004 미정: 장소 없는 고정 일정 항목과 title을 잇는 방법(문서에 없음)
    장소 없는 고정 일정은 서로 겹치지 않아 시각순으로 정렬한 title과 코스의 해당 항목을 순서대로 짝짓는다.
    """
    options = [option_view(record, day) for record in records]
    return CourseResult(session_id=state.session_id, stage=state.stage, options=options, day=day_summary(state.day_id, day, overrides))
