"""TASK-014 §19 `REASONS` 말투 통일. 근거: TASK-014 §19("…에요 -> 앱 말투(…어·…야)로 모두 통일, '가는 중이야' 등"),
task-014-design §9-4(이유 문구 말투: "가는 중이야"), SCREEN-001 §3-2(바뀐 이유 = 코드 `REASONS` 대본 한 줄).

문서에 정확한 문장이 있는 것은 T-01 하나뿐이다. 나머지는 지어내지 않고 규칙(존댓말 "요"·"니다"로 끝나는 말 마디가 없다, §20 Q1)으로만 본다.
"""

import re

import pytest

from engine.compose import REASONS

# 말 마디 끝의 존댓말 "요"·"니다" (문장 끝·쉼표 앞·띄어쓰기 앞). "…해요, …봐요"처럼 가운데 마디도 잡는다 (TASK-014 §20 Q1)
# "…줘·…봐·…할게·…어·…야"는 앱 말투로 허용
POLITE_END = re.compile(r"(?:요|니다)(?=[\s,.!?…]|$)")


def test_t14_s19_reasons_표가_비어_있지_않다():
    assert REASONS
    for key, value in REASONS.items():
        assert isinstance(value, str) and value.strip(), key


@pytest.mark.parametrize("key", sorted(REASONS))
def test_t14_s19_reasons_모든_문장은_요·니다로_끝나는_마디가_없다(key):
    assert POLITE_END.search(REASONS[key]) is None, f"{key}: {REASONS[key]}"


def test_t14_s19_t01_이유는_지금_일정대로_가는_중이야():
    assert REASONS["T-01"] == "지금 일정대로 가는 중이야"


@pytest.mark.parametrize(
    ("text", "caught"),
    [
        ("지금 일정대로 가는 중이에요", True),
        ("다음 장소에 거의 왔어요, 열었는지 확인해 봐요", True),
        ("다음 장소에 거의 왔어요, 열었는지 확인해 봐", True),  # 가운데 마디만 "요"
        ("지금 일정대로 가는 중이야", False),
        ("오늘 많이 걸었어", False),
        ("필요한 걸 보여 줘", False),  # 마디 끝이 아닌 "요"는 잡지 않는다
        ("일정이 늦어지고 있습니다", True),  # §20 Q1: "니다"도 존댓말
        ("가려던 곳이 닫혔습니다, 다른 곳을 볼래", True),  # 가운데 마디만 "니다"
        ("열었는지 확인해 봐", False),  # §20 Q1 허용: 봐
        ("바꾼 일정으로 안내할게", False),  # 허용: 할게
        ("니다", True),
    ],
)
def test_t14_s19_도구_검사_요·니다_마디_규칙(text, caught):
    assert (POLITE_END.search(text) is not None) is caught
