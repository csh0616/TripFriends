"""요청 하나 = 트랜잭션 하나 (TASK-012 A3, TASK-003 R12의 알려진 한계 해결).

- Postgres: 요청이 처음 DB를 쓸 때 연결을 열고(lazy), 성공(2xx·3xx)이면 commit, 실패(4xx·5xx·예외)면 rollback.
  체크포인터(계획 대화)도 같은 연결을 쓴다 -> 저장소와 대화 상태가 함께 되돌아간다.
- 메모리: 요청이 시작될 때 저장소들의 상태를 떠 두고(`capture`), 실패하면 되돌린다(`restore`) (§10 Q8). 메모리 되돌림은 요청을
  한 번에 하나씩만 하게 한다(`MEMORY_LOCK`): 동시에 들어온 다른 요청의 변경까지 되돌리지 않으려고.
- 요청 밖(계약 테스트가 저장소를 직접 부를 때)에서는 호출마다 짧은 연결·commit을 쓴다.

연결 주소는 오류·로그·응답에 담지 않는다.
"""

import contextvars
import logging
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger(__name__)
CONNECT_TIMEOUT = 5  # 초
MEMORY_LOCK = threading.Lock()


class StorageUnavailable(Exception):
    """DB에 못 붙음 -> 503 STORAGE_UNAVAILABLE. 메시지에 연결 주소를 넣지 않는다."""


class Participant(Protocol):
    """메모리 저장소: 요청 전 상태를 떠 두고 되돌릴 수 있다."""

    def capture(self) -> Any: ...

    def restore(self, saved: Any) -> None: ...


def connect(url: str) -> "psycopg.Connection[Any]":
    try:
        # prepare_threshold=None: Supabase 연결 풀러(트랜잭션 모드)는 준비된 문장을 못 쓴다
        return psycopg.connect(url, row_factory=dict_row, prepare_threshold=None, connect_timeout=CONNECT_TIMEOUT)
    except psycopg.OperationalError as error:
        log.warning("DB 연결 실패: %s", type(error).__name__)  # 주소·원문은 남기지 않는다
        raise StorageUnavailable("저장소에 붙지 못했어요") from None


class Transaction:
    def __init__(self, participants: Sequence[Participant] = ()):
        self._participants = list(participants)
        self._saved: list[Any] = []
        self._connections: dict[str, psycopg.Connection[Any]] = {}
        self._lock = threading.Lock()

    def begin(self) -> None:
        self._saved = [p.capture() for p in self._participants]

    def connection(self, url: str) -> "psycopg.Connection[Any]":
        with self._lock:
            found = self._connections.get(url)
            if found is None:
                found = self._connections[url] = connect(url)
            return found

    def finish(self, ok: bool) -> None:
        """ok면 commit, 아니면 rollback (메모리 저장소도 되돌린다)."""
        connections, self._connections = list(self._connections.values()), {}
        try:
            for conn in connections:
                try:
                    conn.commit() if ok else conn.rollback()
                finally:
                    conn.close()
        except BaseException:
            self._restore()  # commit이 실패하면 메모리 쪽도 같이 되돌린다
            raise
        if not ok:
            self._restore()

    def _restore(self) -> None:
        for participant, saved in zip(self._participants, self._saved, strict=True):
            participant.restore(saved)


_current: contextvars.ContextVar[Transaction | None] = contextvars.ContextVar("tripfriends_transaction", default=None)


@contextmanager
def activate(tx: Transaction) -> Iterator[Transaction]:
    token = _current.set(tx)
    try:
        yield tx
    finally:
        _current.reset(token)


class Database:
    """저장소가 쓰는 DB 입구. 요청 안이면 그 요청의 연결, 밖이면 호출마다 짧은 연결."""

    def __init__(self, url: str):
        self.url = url

    @contextmanager
    def cursor(self) -> Iterator["psycopg.Cursor[Any]"]:
        tx = _current.get()
        if tx is not None:
            with tx.connection(self.url).cursor() as cur:
                yield cur
            return
        conn = connect(self.url)
        try:
            with conn.cursor() as cur:
                yield cur
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()


# ---------- LangGraph 메모리 체크포인터도 같이 되돌린다 ----------


class SaverParticipant:
    def __init__(self, saver: Any):
        self.saver = saver

    def capture(self) -> Any:
        s = self.saver
        return ({t: {ns: dict(c) for ns, c in nss.items()} for t, nss in s.storage.items()}, {k: dict(v) for k, v in s.writes.items()}, dict(s.blobs))

    def restore(self, saved: Any) -> None:
        storage, writes, blobs = saved
        s = self.saver
        s.storage.clear()
        for thread, nss in storage.items():
            for ns, checkpoints in nss.items():
                s.storage[thread][ns] = dict(checkpoints)
        s.writes.clear()
        s.writes.update({k: dict(v) for k, v in writes.items()})
        s.blobs.clear()
        s.blobs.update(blobs)
