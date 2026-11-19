"""TASK-015 §18 `REASONS` 문구 두 줄. 근거: TASK-015 §18 "디자이너 V130" 말투(이번 TASK에서 바꾼다 — 서버 REASONS 문구만):
T-02 -> "이제 다음 장소로 갈 차례야"(이동 중에도 맞음), T-07 -> "늦으면 안 되는 일정이 곧이야"(규칙 숫자 15분 빼기) ·
task-014-design §14-4(추천 B · B) · §14-1(T-08 숙소 있음 "오늘 일정이 끝났어"는 그대로 — §18 "이유 줄 '오늘 일정이 끝났어'는 그대로").
말투 규칙(…요·…니다 마디 없음)은 test_task014_s19_reasons가 모든 줄에 그대로 건다.
"""

import re

import pytest

from engine.compose import REASONS


def test_T15_S18_T02_이유는_이제_다음_장소로_갈_차례야():
    assert REASONS["T-02"] == "이제 다음 장소로 갈 차례야"


def test_T15_S18_T07_이유는_늦으면_안_되는_일정이_곧이야():
    assert REASONS["T-07"] == "늦으면 안 되는 일정이 곧이야"


def test_T15_S18_T07_이유에는_규칙_숫자가_없다():
    """§18: 규칙 숫자 15분을 뺀다 (화면에 'N분 뒤에 출발해'가 이미 있다)."""
    assert re.search(r"\d", REASONS["T-07"]) is None


@pytest.mark.parametrize(
    ("key", "text"),
    [("T-01", "지금 일정대로 가는 중이야"), ("T-08", "오늘 일정이 끝났어")],
)
def test_T15_S18_경계_T01·T08_이유는_그대로(key, text):
    assert REASONS[key] == text
