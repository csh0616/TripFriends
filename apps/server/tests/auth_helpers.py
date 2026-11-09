"""TASK-012 B2 테스트용 JWT. 판단 로직 없이 토큰을 만들기만 한다.

비밀값은 이 파일 안의 **가짜 값**이다 (실제 Supabase 키 아님, .env를 읽지 않는다).
Supabase 로그인 토큰 모양을 따른다: HS256, sub = 사용자 ID(uuid), aud·role = "authenticated", 익명이면 is_anonymous = true.
"""

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

from api.auth import JWT_SECRET_ENV

FAKE_JWT_SECRET = "tripfriends-test-only-not-a-real-secret-0000000000"  # 테스트 전용 가짜
OTHER_SECRET = "tripfriends-test-only-some-other-secret-1111111111"  # 다른 프로젝트 키처럼 틀린 비밀값

__all__ = ["FAKE_JWT_SECRET", "JWT_SECRET_ENV", "OTHER_SECRET", "bearer", "make_token", "user_id"]


def user_id(name: str) -> str:
    """테스트 사용자 이름("device-A" 등) -> 늘 같은 uuid (profiles.id = Supabase Auth 사용자 ID, DATA-001 A)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tripfriends-test/{name}"))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(
    sub: str | None,
    *,
    secret: str = FAKE_JWT_SECRET,
    expires_in: int = 3600,
    alg: str = "HS256",
    **claims: Any,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {"aud": "authenticated", "role": "authenticated", "is_anonymous": True, "iat": now, "exp": now + expires_in, **claims}
    if sub is not None:
        payload["sub"] = sub
    head = _b64(json.dumps({"alg": alg, "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    if alg == "none":
        return f"{head}.{body}."
    signature = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(signature)}"


def bearer(name: str, **kwargs: Any) -> dict[str, str]:
    """이 테스트 사용자의 요청 헤더. 부를 때마다 iat가 같을 수 있지만 sub는 늘 같다."""
    return {"Authorization": f"Bearer {make_token(user_id(name), **kwargs)}"}
