"""날 상태 (TASK-010 §B6). 매번 계산하고 저장하지 않는다."""

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

DayState = Literal["planning", "planned", "today", "past"]


def city_today(now: datetime, timezone: str) -> date:
    """도시 시간대의 오늘 (§9 Q18). now는 시간대가 있는 시각."""
    return now.astimezone(ZoneInfo(timezone)).date()


def day_state(day: date, today: date, planned: bool) -> DayState:
    """지난 날 past · 오늘 today(계획 전이어도, Q6) · 앞날은 계획을 골랐으면 planned 아니면 planning."""
    if day < today:
        return "past"
    if day == today:
        return "today"
    return "planned" if planned else "planning"
