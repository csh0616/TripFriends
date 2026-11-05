"""시각 형식 검사. 근거: TASK-003 §0, AC-2, TASK-002 §7 Q12, §9 Q45, §10 #5, §10-4 Q58."""

import pytest
from planning_helpers import BASE, MONDAY_EVENING, as_places, day_plan, fixed_event, place

from engine.models import Batch, Opening, Reactions
from engine.planning import compose_courses, next_batch

NOBODY = Reactions(liked=[], skipped=[])

BAD_TIMES = [
    pytest.param("10:75", id="분_75"),
    pytest.param("10:60", id="분_60_경계"),
    pytest.param("29:60", id="최대시각_분_60"),
    pytest.param("10:-5", id="음수_분"),
    pytest.param("-1:30", id="음수_시"),
    pytest.param("9:59", id="시_한자리"),
    pytest.param("10:5", id="분_한자리"),
    pytest.param("100:00", id="시_세자리"),
    pytest.param("1000", id="콜론_없음"),
    pytest.param("10-00", id="콜론_대신_빼기"),
    pytest.param("aa:bb", id="글자"),
    pytest.param("", id="빈_문자열"),
    pytest.param("10:00:00", id="초까지"),
    pytest.param(" 10:00", id="앞_공백"),
]


def _with_opening(open_at: str, close_at: str):
    return as_places(place("P1", hours=[Opening(weekday=0, open=open_at, close=close_at)]))


def _compose_with_opening(open_at, close_at):
    return compose_courses(day_plan(), ["P1"], _with_opening(open_at, close_at))


def _next_batch_with_opening(open_at, close_at):
    return next_batch(_with_opening(open_at, close_at), NOBODY, None, [], BASE, MONDAY_EVENING)


@pytest.mark.parametrize("bad", BAD_TIMES)
@pytest.mark.parametrize("call", [_compose_with_opening, _next_batch_with_opening], ids=["compose_courses", "next_batch"])
def test_Z01_AC02_Opening_open이_잘못되면_ValueError(call, bad):
    with pytest.raises(ValueError):
        call(bad, "18:00")


@pytest.mark.parametrize("bad", BAD_TIMES)
@pytest.mark.parametrize("call", [_compose_with_opening, _next_batch_with_opening], ids=["compose_courses", "next_batch"])
def test_Z02_AC02_Opening_close가_잘못되면_ValueError(call, bad):
    with pytest.raises(ValueError):
        call("08:00", bad)


@pytest.mark.parametrize("bad", BAD_TIMES)
def test_Z03_AC02_PlanFixed_start가_잘못되면_ValueError(bad):
    with pytest.raises(ValueError):
        compose_courses(day_plan(fixed=(fixed_event(bad, "12:00"),)), [], {})


@pytest.mark.parametrize("bad", BAD_TIMES)
def test_Z04_AC02_PlanFixed_end가_잘못되면_ValueError(bad):
    with pytest.raises(ValueError):
        compose_courses(day_plan(fixed=(fixed_event("09:00", bad),)), [], {})


@pytest.mark.parametrize(
    ("open_at", "close_at"),
    [("09:59", "10:59"), ("00:00", "09:59"), ("18:00", "29:59")],
    ids=["분_59_양쪽", "자정_시작", "최대시각_29시59분"],
)
def test_Z05_AC02_Opening_경계의_정상값은_통과(open_at, close_at):
    assert isinstance(_compose_with_opening(open_at, close_at), list)
    assert isinstance(_next_batch_with_opening(open_at, close_at), Batch)


@pytest.mark.parametrize(
    ("start", "end"),
    [("09:59", "10:59"), ("10:00", "10:59")],
    ids=["09시59분_시작", "10시59분_끝"],
)
def test_Z06_AC02_PlanFixed_경계의_정상값은_통과(start, end):
    assert isinstance(compose_courses(day_plan(fixed=(fixed_event(start, end),)), [], {}), list)
