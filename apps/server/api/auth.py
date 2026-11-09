"""TASK-012 B2: `Authorization: Bearer <Supabase JWT>`를 확인해 user_id를 꺼낸다 (빈 껍데기, test-writer).

X-Device-Id를 대체한다 (ADR-016 §3-3). §10 Q2: 비대칭 키(ES256, ECC P-256) — `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`의
공개 키로 확인하고 캐시한다. `aud` = "authenticated", 만료 여유 10초.
서버는 공개 키를 **반드시 이 모듈의 `fetch_jwks`로** 받는다 (테스트가 가짜 JWKS로 바꿔 끼운다, 네트워크 0).
"""

JWKS_PATH = "/auth/v1/.well-known/jwks.json"
AUDIENCE = "authenticated"
LEEWAY_SECONDS = 10


class AuthError(Exception):
    """토큰이 없거나 틀림·만료 -> 401 UNAUTHORIZED 공통 형식 (API-001)."""


def fetch_jwks(url: str) -> dict:
    """JWKS 문서 `{"keys": [...]}`를 받아 온다 (서버 쪽 캐시는 이 함수 밖에서)."""
    raise NotImplementedError


def verify_token(token: str, jwks: dict, now: float | None = None) -> str:
    """서명(ES256, kid로 고른 키)·aud·만료(여유 LEEWAY_SECONDS)를 확인하고 user_id(= JWT `sub`)를 돌려준다. 틀리면 AuthError.

    now: 확인 시각(유닉스 초). 없으면 지금."""
    raise NotImplementedError
