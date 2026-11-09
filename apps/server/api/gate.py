"""요청 한 건의 문지기 (TASK-012 B2·A3). 순수 ASGI 미들웨어.

1. 인증 (B2, §11 Q1): `/health`·`/catalog`(와 FastAPI 문서 길)만 토큰 없이 열린다. 나머지는 `Authorization: Bearer <JWT>`를 확인해
   user_id를 `request.state.user_id`에 둔다. 없거나 틀리면 401 UNAUTHORIZED 공통 형식. 다른 검사(404·400)보다 먼저다.
2. 트랜잭션 (A3): 인증된 요청 하나 = 트랜잭션 하나. 응답이 성공(<400)이면 commit, 4xx·5xx·예외면 rollback.
   응답 시작 직전에 결정하므로 클라이언트가 성공 응답을 받았다면 저장은 끝나 있다.
"""

import logging
from typing import Any

import anyio
import anyio.to_thread
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.auth import AuthError, AuthUnavailable
from api.planning import http_error_response
from store.unit import MEMORY_LOCK, Transaction, activate

log = logging.getLogger(__name__)
PUBLIC_PATHS = frozenset({"/health", "/catalog", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"})  # §11 Q1: 열린 길은 health·catalog(+ 문서 길)뿐


def bearer_token(scope: Scope) -> str:
    for name, value in scope["headers"]:
        if name == b"authorization":
            scheme, _, token = value.decode("latin-1").partition(" ")
            if scheme.lower() == "bearer" and token.strip():
                return token.strip()
            break
    raise AuthError("Bearer 토큰이 없어요")


class UnitOfWork:
    """서버가 켜질 때 한 번 만든다 (app.state.unit). 요청마다 Transaction을 하나 준다."""

    def __init__(self, participants: list[Any], memory: bool):
        self.participants, self.memory = participants, memory

    def new(self) -> Transaction:
        return Transaction(self.participants if self.memory else ())


class Gate:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return
        state = scope["app"].state
        try:
            jwks = getattr(state, "jwks", None)
            if jwks is None:
                raise AuthError("서버에 SUPABASE_URL이 없어요")
            user_id = await anyio.to_thread.run_sync(jwks.verify, bearer_token(scope))
        except AuthUnavailable as error:
            log.warning("공개 키를 받지 못함: %s", type(error.__cause__).__name__)
            await http_error_response(503, "AUTH_UNAVAILABLE", "지금 로그인 확인을 못 해요. 잠시 뒤 다시 해 주세요")(scope, receive, send)
            return
        except AuthError as error:
            log.info("인증 실패: %s", error)
            await http_error_response(401, "UNAUTHORIZED", "로그인 정보를 확인하지 못했어요")(scope, receive, send)
            return
        scope.setdefault("state", {})["user_id"] = user_id
        unit: UnitOfWork | None = getattr(state, "unit", None)
        if unit is None:
            await self.app(scope, receive, send)
            return

        tx = unit.new()
        locked = unit.memory
        if locked:  # 메모리 되돌림은 요청을 한 번에 하나씩 (동시에 들어온 다른 요청의 변경까지 되돌리지 않도록)
            await anyio.to_thread.run_sync(MEMORY_LOCK.acquire)
        finished = False

        async def finish(ok: bool) -> None:
            nonlocal finished
            if not finished:
                finished = True
                await anyio.to_thread.run_sync(tx.finish, ok)

        async def guarded_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                await finish(message["status"] < 400)
            await send(message)

        try:
            tx.begin()
            with activate(tx):
                await self.app(scope, receive, guarded_send)
            await finish(True)
        except BaseException:
            with anyio.CancelScope(shield=True):
                await finish(False)
            raise
        finally:
            if locked:
                MEMORY_LOCK.release()
