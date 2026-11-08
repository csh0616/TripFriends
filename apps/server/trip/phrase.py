"""TASK-008 §17: 닫힘 제안의 이유 문장. 이름과 시각 말고는 끼워 넣지 않는다 (LLM 없음)."""


_PAIRS = {"이/가": ("이", "가"), "은/는": ("은", "는"), "을/를": ("을", "를"), "으로/로": ("으로", "로")}
_RIEUL = 8  # 종성 번호 ㄹ


def _final_sound(last: str) -> str:
    """끝 글자의 받침 종류: 'none' / 'rieul' / 'batchim'. 숫자·영문은 읽는 소리 (TASK-009 §9 Q7).
    일본어·기호는 받침 없음 (Q3). 영문 소문자 l·m·n·r은 문서에 없어 대문자와 같은 소리로 본다."""
    code = ord(last) - 0xAC00
    if 0 <= code <= 0xD7A3 - 0xAC00:
        jong = code % 28
        return "none" if jong == 0 else ("rieul" if jong == _RIEUL else "batchim")
    if last in "178LlRr":  # 일·칠·팔·엘·알
        return "rieul"
    if last in "036MmNn":  # 영·삼·육·엠·엔
        return "batchim"
    return "none"


def with_particle(word: str, pair: str) -> str:
    """'{word}{조사}'. 받침 없음 -> 가·는·를·로, ㄹ -> 이·은·을 + '로', 그 밖 -> 이·은·을·으로. 빈 문자열은 받침 없음 (Q1)."""
    with_batchim, without = _PAIRS[pair]
    kind = _final_sound(word[-1]) if word else "none"
    if kind == "none":
        return word + without
    if kind == "rieul" and pair == "으로/로":
        return word + without
    return word + with_batchim


def swap_reason(alternative_name: str) -> str:
    """자리에 넣은 대안."""
    return f"{with_particle(alternative_name, '으로/로')} 대신 가기"


def reorder_reason(start: str) -> str:
    """순서를 다시 짠 대안. start = 코스 항목 안 대안 줄의 시작 시각 HH:MM."""
    return f"순서를 바꿔야 들어가 · {start}에 들러"


def skip_reason(closed_name: str, was_must: bool) -> str:
    """[빼고 가기]."""
    base = f"{closed_name} 빼고 가기"
    return f"{base} · 꼭 갈 곳이었어" if was_must else base
