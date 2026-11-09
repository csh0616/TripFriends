"""TASK-012 B2: `Authorization: Bearer <Supabase JWT>`를 확인해 user_id를 꺼낸다.

X-Device-Id를 대체한다 (ADR-016 §3-3). §10 Q2: 비대칭 키(ES256, ECC P-256) — `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`의
공개 키로 확인하고 캐시한다. `aud` = "authenticated", 만료 여유 10초.
서버는 공개 키를 **반드시 이 모듈의 `fetch_jwks`로** 받는다 (테스트가 가짜 JWKS로 바꿔 끼운다, 네트워크 0).
"""

import threading
import time
from collections.abc import Callable
from typing import Any

import httpx
import jwt

JWKS_PATH = "/auth/v1/.well-known/jwks.json"
AUDIENCE = "authenticated"
LEEWAY_SECONDS = 10
ALGORITHM = "ES256"
REFETCH_MIN_SECONDS = 60.0  # 같은 모르는 kid로 계속 두드려도 Supabase를 이 간격보다 자주 부르지 않는다
FETCH_TIMEOUT = 5.0  # 초: JWKS를 받는 시간 제한. 넘으면 이번 요청은 확인하지 못한 것(401)이다


class AuthError(Exception):
    """토큰이 없거나 틀림·만료 -> 401 UNAUTHORIZED 공통 형식 (API-001)."""


def fetch_jwks(url: str) -> dict:
    """JWKS 문서 `{"keys": [...]}`를 받아 온다 (서버 쪽 캐시는 이 함수 밖에서)."""
    response = httpx.get(url, timeout=FETCH_TIMEOUT)
    response.raise_for_status()
    return response.json()


def verify_token(token: str, jwks: dict, now: float | None = None) -> str:
    """서명(ES256, kid로 고른 키)·aud·만료(여유 LEEWAY_SECONDS)를 확인하고 user_id(= JWT `sub`)를 돌려준다. 틀리면 AuthError.

    now: 확인 시각(유닉스 초). 없으면 지금."""
    checked_at = time.time() if now is None else now
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != ALGORITHM:  # none·HS256 바꿔치기를 여기서 막는다
            raise AuthError("지원하지 않는 서명 방식")
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid") and header.get("kid")), None)
        if key is None:
            raise AuthError("알 수 없는 키")
        claims = jwt.decode(
            token,
            jwt.PyJWK(key, ALGORITHM).key,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            options={"verify_exp": False, "require": ["aud", "exp", "sub"]},  # 만료는 아래에서 now로 직접 본다
        )
    except AuthError:
        raise
    except Exception as error:  # 모양이 틀린 토큰·서명 불일치·aud 불일치 모두 같은 거절
        raise AuthError("토큰을 확인하지 못했어요") from error
    exp = claims["exp"]
    if isinstance(exp, bool) or not isinstance(exp, int | float):
        raise AuthError("exp가 올바르지 않아요")
    if checked_at >= exp + LEEWAY_SECONDS:  # 정각 exp + 10초는 거절
        raise AuthError("만료된 토큰")
    sub = claims["sub"]
    if not isinstance(sub, str) or not sub:
        raise AuthError("sub가 올바르지 않아요")
    return sub


class AuthUnavailable(Exception):
    """공개 키(JWKS)를 못 받음 -> 503 AUTH_UNAVAILABLE. Supabase 장애를 '로그인 틀림'(401)으로 보이지 않게 한다 (§12 6). 원인 주소는 담지 않는다."""


class JwksCache:
    """공개 키를 받아 두고 쓴다 (요청마다 부르지 않음). 모르는 kid가 나오면 마지막으로 받은 뒤 60초가 지났을 때만 다시 받는다 (키 교체 대비, §12 6).
    처음 받기·다시 받기가 실패하면 AuthUnavailable (받아 둔 키가 있어도 다시 받기 실패는 같다: 장애를 로그인 틀림으로 보이지 않게, 진행 담당 판단)."""

    def __init__(self, supabase_url: str, clock: Callable[[], float] = time.monotonic):
        self.url = supabase_url.rstrip("/") + JWKS_PATH
        self._clock = clock
        self._jwks: dict[str, Any] | None = None
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def verify(self, token: str) -> str:
        jwks = self._get()
        try:
            return verify_token(token, jwks)
        except AuthError:
            if self._known_kid(token, jwks) or not self._refresh_allowed():
                raise
            return verify_token(token, self._get(force=True))

    @staticmethod
    def _known_kid(token: str, jwks: dict) -> bool:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except Exception:
            return True  # JWT가 아니면 다시 받아도 소용없다
        return any(k.get("kid") == kid for k in jwks.get("keys", []))

    def _refresh_allowed(self) -> bool:
        return self._clock() - self._fetched_at >= REFETCH_MIN_SECONDS

    def _get(self, force: bool = False) -> dict:
        with self._lock:
            if self._jwks is None or force:
                try:
                    self._jwks = fetch_jwks(self.url)
                except Exception as error:
                    raise AuthUnavailable("공개 키를 받지 못했어요") from error
                self._fetched_at = self._clock()
            return self._jwks
