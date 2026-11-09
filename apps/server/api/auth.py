"""TASK-012 B2: `Authorization: Bearer <Supabase JWT>`를 확인해 user_id를 꺼낸다 (빈 껍데기, test-writer).

X-Device-Id를 대체한다 (ADR-016 §3-3). 확인 값은 apps/server/.env의 JWT_SECRET_ENV 이름 환경 변수 (값은 출력하지 않는다).
"""

JWT_SECRET_ENV = "SUPABASE_JWT_SECRET"  # 이름 제안 (승인 대기)


class AuthError(Exception):
    """토큰이 없거나 틀림·만료 -> 401 공통 형식."""


def verify_token(token: str, secret: str) -> str:
    """서명·만료를 확인하고 user_id(= JWT `sub`)를 돌려준다. 틀리면 AuthError."""
    raise NotImplementedError
