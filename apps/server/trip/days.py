"""날 상태 (TASK-010 §B6). 매번 계산하고 저장하지 않는다. 껍데기."""

from datetime import date, datetime
from typing import Literal

DayState = Literal["planning", "planned", "today", "past"]


def city_today(now: datetime, timezone: str) -> date:
    raise NotImplementedError


def day_state(day: date, today: date, planned: bool) -> DayState:
    raise NotImplementedError
