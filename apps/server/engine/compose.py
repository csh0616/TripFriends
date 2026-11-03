"""화면 조합 함수 (GRAPH-001 §6, SCREEN-001 §4~§5). 순수 함수, TDD 대상."""

from datetime import time
from typing import Literal

from pydantic import BaseModel, Field


class PlanItem(BaseModel):
    """오늘 코스의 일정 한 개."""

    name: str
    start: time
    end: time
    travel_min: int = 0  # 이 일정으로 가는 이동 시간. 출발 시각 = start - travel_min
    is_meal: bool = False
    is_outdoor: bool = False
    hours_checked: bool = False  # 영업 확인을 했는지 (SCREEN-001 §4-1 순위 6, §5 T-02 짝)


class FixedEvent(BaseModel):
    """예약·공연 같은 고정 일정."""

    name: str
    leave_by: time  # 늦지 않으려면 출발해야 하는 시각


class OpenEvent(BaseModel):
    """열린 사건. delay = 미응답 대안이 있는 늦어짐, closed = 닫힘 확인됨."""

    kind: Literal["delay", "closed"]


class Snapshot(BaseModel):
    """compose_screen 입력: 지금 상황 (TASK-001 §2 engine/compose.py)."""

    now: time
    offline: bool = False
    safety: bool = False  # 안전 말 또는 SOS 누름
    current_item: PlanItem | None = None
    next_item: PlanItem | None = None
    fixed_event: FixedEvent | None = None
    open_events: list[OpenEvent] = Field(default_factory=list)
    walked_km: float = 0.0
    meal_eaten: bool = False  # 이번 끼니 먹음
    rain_prob_2h: float = 0.0  # 0~1
    outdoor_remaining: bool = False
    remaining_items: int = 0
    chat_pick: str | None = None  # 대화(G3)가 고른 메인 카드 ID
    moving: bool = False  # 다음 장소로 이동 중
    arriving: bool = False  # 다음 장소 도착 직전


class SuggestionChip(BaseModel):
    card: str  # 누르면 메인으로 올라갈 카드 ID
    label: str


class Screen(BaseModel):
    """compose_screen 출력."""

    main: str
    subs: list[str] = Field(default_factory=list)  # 최대 3장
    chip: SuggestionChip | None = None  # 0~1개
    move_status: Literal["on_track", "delayed", "free"]
    reason: str  # 바뀐 이유 한 줄 (대본 틀)


# ---------- 기준 값 (SCREEN-001 §4-1·§4-2a) ----------

FIXED_SOON_MIN = 15  # §4-1 순위 2: 고정 일정 출발까지 15분 이하
LEAVE_SOON_MIN = 10  # §4-1 순위 5: 다음 장소 출발 10분 전
MEAL_WINDOWS = ((time(11, 30), time(13, 30)), (time(18, 0), time(20, 0)))
MEAL_GAP_MIN = 45  # 강한 신호: 다음 일정(식사 아님)까지 45분 이상
RAIN_PROB = 0.6  # 강한 신호: 2시간 안 비 예보 60% 이상
LONG_WALK_KM = 10.0  # 강한 신호: 10km 이상
LONG_WALK_GAP_MIN = 30  # 강한 신호: 다음 일정까지 30분 이상
EVENING = time(18, 0)  # 남은 일정 없음 + 18:00 이후 / 전
WEAK_FREE_MIN = 30  # 약한 신호: 여유(이동 제외) 30분 이상
WEAK_WALK_KM = 7.0  # 약한 신호: 7~10km
WEAK_MEAL_BEFORE_MIN = 30  # 약한 신호: 식사 시간대 30분 전

# §4-3: 대화(G3)가 메인으로 고를 수 있는 카드
CHAT_PICKS = frozenset({"T-02", "T-03", "T-04", "T-08", "T-09", "T-10", "T-11", "T-13"})

# 친구 한마디 자리의 제안 칩 (§4-2a 예시 문장)
REST_CHIP = SuggestionChip(card="T-09", label="근처 쉴 곳 볼래?")

# 바뀐 이유 한 줄 (대본 틀, §6: LLM이 쓰지 않는다)
REASONS = {
    "X-01": "안전 요청이 있어 SOS를 먼저 보여 줘요",
    "offline": "오프라인이라 저장된 일정만 보여 줘요",
    "T-07": "고정 일정 출발까지 15분 이하예요",
    "chat": "말한 걸 보여 줘요",
    "T-04": "일정이 늦어지고 있어요",
    "T-06": "가려던 곳이 닫혔어요",
    "T-02": "곧 다음 장소로 출발할 때예요",
    "T-05": "다음 장소에 거의 왔어요, 열었는지 확인해 봐요",
    "T-08": "오늘 일정이 끝났어요",
    "T-10": "식사 시간인데 아직 안 먹었어요",
    "T-12": "곧 비가 올 수 있고 실외 일정이 남았어요",
    "T-09": "오늘 많이 걸었어요",
    "T-01": "지금 일정대로 가는 중이에요",
}


def _min(t: time) -> int:
    return t.hour * 60 + t.minute


def _until(now: time, t: time) -> int:
    """now부터 t까지 분 (지났으면 음수)."""
    return _min(t) - _min(now)


def _in_meal_window(now: time) -> bool:
    return any(start <= now <= end for start, end in MEAL_WINDOWS)


def _before_meal_window(now: time) -> bool:
    return any(0 < _until(now, start) <= WEAK_MEAL_BEFORE_MIN for start, _ in MEAL_WINDOWS)


def _starts_in(s: Snapshot) -> int | None:
    """다음 일정 시작까지 분. 다음 일정이 없으면 None."""
    return _until(s.now, s.next_item.start) if s.next_item else None


def _free_min(s: Snapshot) -> int | None:
    """여유(이동 제외) = 출발 시각까지 분 = 시작 - 이동 시간 - 지금."""
    return _starts_in(s) - s.next_item.travel_min if s.next_item else None


def _gap_at_least(s: Snapshot, minutes: int) -> bool:
    """다음 일정까지 minutes분 이상. 다음 일정이 없으면 제한 없음으로 본다."""
    starts_in = _starts_in(s)
    return starts_in is None or starts_in >= minutes


def _pairs(main: str, s: Snapshot) -> list[str]:
    """§5 보조 카드 짝 표."""
    if main == "T-01":
        return ["T-02", "T-03"]
    if main == "T-02":
        need_check = s.next_item is not None and not s.next_item.hours_checked
        return (["T-05"] if need_check else []) + ["T-03"]
    if main == "T-04":
        return (["T-07"] if s.fixed_event else []) + ["T-03"]
    if main in ("T-05", "T-07"):
        return ["T-02"]
    if main in ("T-06", "T-12"):
        return ["T-03"]
    if main in ("T-09", "T-10", "T-11"):
        return ["T-02", "T-03"]
    if main in ("T-13", "T-14"):
        return ["T-01"]
    return []  # T-08, X-01 등 짝 없음


def _move_status(s: Snapshot) -> Literal["on_track", "delayed", "free"]:
    if any(e.kind == "delay" for e in s.open_events):
        return "delayed"
    free = _free_min(s)
    if free is None or free >= WEAK_FREE_MIN:
        return "free"
    return "on_track"


def _pick_main(s: Snapshot) -> tuple[str, str]:
    """GRAPH-001 §6 순서로 메인 카드와 이유 키를 고른다."""
    # 1. 안전·오프라인
    if s.safety:
        return "X-01", "X-01"
    if s.offline:
        return "T-01", "offline"
    # 2. 고정 일정 임박
    if s.fixed_event and _until(s.now, s.fixed_event.leave_by) <= FIXED_SOON_MIN:
        return "T-07", "T-07"
    # 3. 대화가 고른 메인 카드
    if s.chat_pick in CHAT_PICKS:
        return s.chat_pick, "chat"
    # 4. §4-1 나머지 순위
    kinds = {e.kind for e in s.open_events}
    if "delay" in kinds:
        return "T-04", "T-04"
    if "closed" in kinds:
        return "T-06", "T-06"
    free = _free_min(s)
    if s.moving or (free is not None and free <= LEAVE_SOON_MIN):
        return "T-02", "T-02"
    if s.arriving and s.next_item and not s.next_item.hours_checked:
        return "T-05", "T-05"
    # 순위 7은 §4-2a 강한 신호 "남은 일정 없음 + 18:00 이후"로 판정 (18:00 전은 약한 신호)
    if s.remaining_items == 0 and s.now >= EVENING:
        return "T-08", "T-08"
    # 5. §4-2a 강한 신호
    next_is_meal = s.next_item is not None and s.next_item.is_meal
    if _in_meal_window(s.now) and not s.meal_eaten and not next_is_meal and _gap_at_least(s, MEAL_GAP_MIN):
        return "T-10", "T-10"
    if s.rain_prob_2h >= RAIN_PROB and s.outdoor_remaining:
        return "T-12", "T-12"
    if s.walked_km >= LONG_WALK_KM and _gap_at_least(s, LONG_WALK_GAP_MIN):
        return "T-09", "T-09"
    return "T-01", "T-01"


def _weak_signal(s: Snapshot) -> bool:
    """§4-2a 약한 신호: 하나라도 맞으면 제안 칩."""
    free = _free_min(s)
    return (
        (free is not None and free >= WEAK_FREE_MIN)
        or WEAK_WALK_KM <= s.walked_km < LONG_WALK_KM
        or _before_meal_window(s.now)
        or (s.remaining_items == 0 and s.now < EVENING)
    )


def compose_screen(snapshot: Snapshot) -> Screen:
    s = snapshot
    main, reason_key = _pick_main(s)
    subs = _pairs(main, s)
    if reason_key == "offline":
        subs = ["X-02", *subs]
    chip = REST_CHIP if reason_key == "T-01" and _weak_signal(s) else None
    # TODO: 깜빡임 규칙 (조작 후 30초, 직전 변경 후 3분 안의 순위 5~8 변경, SCREEN-001 §6)
    return Screen(
        main=main,
        subs=[c for c in subs if c != main][:3],
        chip=chip,
        move_status=_move_status(s),
        reason=REASONS[reason_key],
    )
