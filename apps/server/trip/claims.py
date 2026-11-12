"""처리된 익명 사용자 기록 (TASK-012 §15 S3). 한 번 처리(moved·choose 완료)된 익명 사용자는 다시 claim할 수 없다 (409).

사용자 id만 둔다: 토큰·이메일은 저장하지 않는다 (§15 S4·S6). 메모리 구현은 요청이 실패하면 되돌린다. Postgres 구현은 `store.postgres.PostgresClaims`.
"""

import threading
from abc import ABC, abstractmethod


class ClaimStore(ABC):
    @abstractmethod
    def is_claimed(self, anonymous_id: str) -> bool: ...

    @abstractmethod
    def mark(self, anonymous_id: str, account_id: str) -> bool:
        """처리됨으로 적는다. 이미 적혀 있으면 False (동시에 들어온 두 번째 claim을 막는다)."""


class MemoryClaims(ClaimStore):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._claimed: dict[str, str] = {}

    def is_claimed(self, anonymous_id: str) -> bool:
        with self._lock:
            return anonymous_id in self._claimed

    def mark(self, anonymous_id: str, account_id: str) -> bool:
        with self._lock:
            if anonymous_id in self._claimed:
                return False
            self._claimed[anonymous_id] = account_id
            return True

    def capture(self) -> dict[str, str]:
        with self._lock:
            return dict(self._claimed)

    def restore(self, saved: dict[str, str]) -> None:
        with self._lock:
            self._claimed = saved
