from collections.abc import Mapping
from typing import Any

from deciders.base import Decision


class RuleDecider:
    def decide(
        self,
        question: str,
        options: Mapping[str, str],
        context: Mapping[str, Any] | None = None,
    ) -> Decision:
        raise NotImplementedError
