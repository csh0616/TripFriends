from collections.abc import Callable, Mapping
from typing import Any

from deciders.base import Decision

Rule = Callable[[str, Mapping[str, str], Mapping[str, Any] | None], str | None]


class RuleDecider:
    """규칙으로 고르는 판단기. 규칙이 None을 돌려주면 되묻기."""

    def __init__(self, rule: Rule, *, reason: str = "규칙") -> None:
        self._rule = rule
        self._reason = reason

    def decide(
        self,
        question: str,
        options: Mapping[str, str],
        context: Mapping[str, Any] | None = None,
    ) -> Decision:
        pick = self._rule(question, options, context)
        if pick is not None and pick not in options:
            raise ValueError(f"규칙이 보기에 없는 키를 골랐습니다: {pick}")
        return Decision(pick=pick, source="rule", reason=self._reason)
