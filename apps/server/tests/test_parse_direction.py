"""방향 해석. 근거: TASK-002 §3 C, AC-4, POC-001 §5-1, ADR-011 B."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from engine.planning import parse_direction

# POC-001 §5-1 동결 표. 위에서부터 먼저
KEYWORDS = [
    ("quieter", ["한적", "조용", "사람 적", "덜 붐", "웨이팅 없", "쉬어"]),
    ("closer", ["가까", "근처", "안 걷", "덜 걷"]),
    ("cheaper", ["싼", "저렴", "돈", "가성비"]),
    ("different", ["다른", "말고", "힙", "레트로", "현지인"]),
    ("photo", ["사진", "인스타", "감성"]),
    ("indoor", ["실내", "비 안", "비 피"]),
    ("food", ["먹", "맛있", "배고"]),
    ("night", ["밤", "야경"]),
]
EACH_KEYWORD = [(direction, word) for direction, words in KEYWORDS for word in words]


@pytest.mark.parametrize("direction, word", EACH_KEYWORD, ids=[w for _, w in EACH_KEYWORD])
def test_AC04_표의_키워드는_그_방향(direction, word):
    assert parse_direction(word) == direction


@pytest.mark.parametrize("direction, word", EACH_KEYWORD, ids=[w for _, w in EACH_KEYWORD])
def test_AC04_키워드가_문장_속에_있어도_그_방향(direction, word):
    assert parse_direction(f"음 {word} 쪽으로 부탁해") == direction


ADJACENT = [
    (KEYWORDS[i][0], KEYWORDS[i][1][0], KEYWORDS[i + 1][1][0]) for i in range(len(KEYWORDS) - 1)
]


@pytest.mark.parametrize("direction, upper, lower", ADJACENT, ids=[d for d, _, _ in ADJACENT])
def test_AC04_여러개면_문장_순서와_상관없이_표에서_위에_있는_방향(direction, upper, lower):
    assert parse_direction(f"{upper} {lower}") == direction
    assert parse_direction(f"{lower} {upper}") == direction


@pytest.mark.parametrize("text", ["", "그냥 아무거나", "오늘 뭐 할까", "비 오면 어쩌지"])
def test_AC04_키워드가_없으면_None(text):
    assert parse_direction(text) is None


def test_알려진_약점_까먹음은_food_그대로():
    assert parse_direction("시간 다 까먹음") == "food"


def first_match(text: str) -> str | None:
    for direction, words in KEYWORDS:
        if any(word in text for word in words):
            return direction
    return None


@settings(max_examples=300, deadline=None)
@given(st.lists(st.sampled_from([w for _, w in EACH_KEYWORD] + ["그냥", "오늘", " ", "어디", "가자"]), max_size=6))
def test_AC04_임의_문장도_표의_순서대로(pieces):
    text = " ".join(pieces)
    assert parse_direction(text) == first_match(text)
