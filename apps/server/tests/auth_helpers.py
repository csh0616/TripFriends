"""TASK-012 B2 테스트용 JWT (§10 Q2: Supabase 비대칭 키 ES256 = ECC P-256 + JWKS). 판단 로직 없이 토큰을 만들기만 한다.

키쌍은 **이 파일이 실행 중에 만든 가짜 P-256 키**다 (실제 Supabase 키 아님, .env를 읽지 않는다, 네트워크 0).
암호 라이브러리를 새로 넣지 않으려고 P-256 서명을 여기서 직접 계산한다 (테스트 전용, 느려도 됨). 맞는지는 test_task012_auth의 자기 점검이 본다.
토큰 모양은 Supabase 로그인 토큰을 따른다: 머리 {alg: ES256, kid}, 몸 {sub(사용자 uuid), aud·role = "authenticated", is_anonymous, iat, exp}.

서버가 공개 키를 받는 곳(`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)은 `install_fake_jwks`가 api.auth.fetch_jwks를 바꿔 끼워
가짜 JWKS를 돌려준다. 부른 주소는 돌려받은 목록에 쌓인다 (캐시 확인용).
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Any

# ---------- P-256 (NIST, SEC 2) ----------
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296, 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)
Point = tuple[int, int] | None


def _add(p1: Point, p2: Point) -> Point:
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        slope = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        slope = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (slope * slope - x1 - x2) % P
    return x3, (slope * (x1 - x3) - y1) % P


def mul(k: int, point: Point = G) -> Point:
    result: Point = None
    while k:
        if k & 1:
            result = _add(result, point)
        point = _add(point, point)
        k >>= 1
    return result


def on_curve(point: Point) -> bool:
    if point is None:
        return False
    x, y = point
    return (y * y - (x * x * x + A * x + B)) % P == 0


def _digest(message: bytes) -> int:
    return int.from_bytes(hashlib.sha256(message).digest(), "big")


def es256_sign(private: int, message: bytes) -> bytes:
    e = _digest(message)
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = mul(k)[0] % N  # type: ignore[index]
        s = pow(k, -1, N) * (e + r * private) % N
        if r and s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def es256_verify(public: Point, message: bytes, signature: bytes) -> bool:
    r, s = int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
    if not (0 < r < N and 0 < s < N):
        return False
    w = pow(s, -1, N)
    point = _add(mul(_digest(message) * w % N), mul(r * w % N, public))
    return point is not None and point[0] % N == r


class FakeKey:
    """가짜 P-256 키쌍. kid는 JWKS에서 이 키를 찾는 이름."""

    def __init__(self, kid: str):
        self.kid = kid
        self.private = secrets.randbelow(N - 1) + 1
        self.public = mul(self.private)

    def jwk(self) -> dict[str, str]:
        x, y = self.public  # type: ignore[misc]
        return {"kty": "EC", "crv": "P-256", "x": _b64(x.to_bytes(32, "big")), "y": _b64(y.to_bytes(32, "big")), "kid": self.kid, "alg": "ES256", "use": "sig"}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


FAKE_KEY = FakeKey("fake-kid-1")  # 가짜 JWKS에 들어 있는 키
OTHER_KEY = FakeKey("fake-kid-1")  # 같은 kid, 다른 키 (서명이 틀림)
STRANGER_KEY = FakeKey("fake-kid-unknown")  # JWKS에 없는 kid
FAKE_JWKS = {"keys": [FAKE_KEY.jwk()]}
FAKE_SUPABASE_URL = "https://fake-project.supabase.test"  # 테스트 전용, 이 주소로 나가는 연결은 conftest가 막는다
JWKS_URL = f"{FAKE_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
TESTER = "tester"  # 사용자를 따로 정하지 않은 테스트(계획·여행 중 등)의 사용자

__all__ = ["FAKE_JWKS", "FAKE_KEY", "FAKE_SUPABASE_URL", "JWKS_URL", "OTHER_KEY", "STRANGER_KEY", "TESTER", "bearer", "install_fake_jwks", "make_token", "user_id"]


def user_id(name: str) -> str:
    """테스트 사용자 이름("device-A" 등) -> 늘 같은 uuid (profiles.id = Supabase Auth 사용자 ID, DATA-001 A)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tripfriends-test/{name}"))


def make_token(
    sub: str | None,
    *,
    key: FakeKey = FAKE_KEY,
    alg: str = "ES256",
    exp: int | None = None,
    expires_in: int = 3600,
    aud: str | None = "authenticated",
    **claims: Any,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {"role": "authenticated", "is_anonymous": True, "iat": now, "exp": exp if exp is not None else now + expires_in, **claims}
    if aud is not None:
        payload["aud"] = aud
    if sub is not None:
        payload["sub"] = sub
    head = _b64(json.dumps({"alg": alg, "typ": "JWT", "kid": key.kid}, separators=(",", ":")).encode())
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signing = f"{head}.{body}".encode()
    if alg == "none":
        return f"{head}.{body}."
    if alg == "HS256":  # 알고리즘 바꿔치기: 공개 키 x 값을 HMAC 비밀값처럼 쓴 토큰
        return f"{head}.{body}.{_b64(hmac.new(FAKE_KEY.jwk()['x'].encode(), signing, hashlib.sha256).digest())}"
    return f"{head}.{body}.{_b64(es256_sign(key.private, signing))}"


def bearer(name: str, **kwargs: Any) -> dict[str, str]:
    """이 테스트 사용자의 요청 헤더. sub는 이름마다 늘 같다."""
    return {"Authorization": f"Bearer {make_token(user_id(name), **kwargs)}"}


def install_fake_jwks(monkeypatch) -> list[str]:
    """서버가 가짜 JWKS를 받게 한다. 돌려준 목록 = fetch_jwks를 부른 주소들."""
    import api.auth

    calls: list[str] = []

    def fetch(url: str) -> dict:
        calls.append(url)
        return json.loads(json.dumps(FAKE_JWKS))

    monkeypatch.setenv("SUPABASE_URL", FAKE_SUPABASE_URL)
    monkeypatch.setattr(api.auth, "fetch_jwks", fetch)
    return calls
