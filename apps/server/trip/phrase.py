"""TASK-008 §17: 닫힘 제안의 이유 문장. 이름과 시각 말고는 끼워 넣지 않는다 (LLM 없음)."""


def with_ro(name: str) -> str:
    """'{이름}으로/로'. 한글 끝 글자가 받침 없음 또는 ㄹ받침이면 '로', 그 밖(겹받침 포함)은 '으로'.
    한글이 아닌 끝 글자(영문·숫자)는 '로' (문서 예시 '골목 카페 E로'). 조사 전체 규칙은 TASK-009 H4."""
    code = ord(name[-1]) - 0xAC00
    if 0 <= code <= 0xD7A3 - 0xAC00 and code % 28 not in (0, 8):
        return f"{name}으로"
    return f"{name}로"


def swap_reason(alternative_name: str) -> str:
    """자리에 넣은 대안."""
    return f"{with_ro(alternative_name)} 대신 가기"


def reorder_reason(start: str) -> str:
    """순서를 다시 짠 대안. start = 코스 항목 안 대안 줄의 시작 시각 HH:MM."""
    return f"순서를 바꿔야 들어가 · {start}에 들러"


def skip_reason(closed_name: str, was_must: bool) -> str:
    """[빼고 가기]."""
    base = f"{closed_name} 빼고 가기"
    return f"{base} · 꼭 갈 곳이었어" if was_must else base
