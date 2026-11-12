"""TASK-013 §A A5 · §9 Q7 키 검사 — `git ls-files` 전체에서 키처럼 보이는 값 0 (AC-4를 사람 대신 매번).
근거: TASK-013 §A A5 · §B B1(비밀값 0) · §9 Q7(pytest 테스트로, 패턴 목록·허용 목록·"값은 출력하지 않고 파일:줄만").
CI의 A5 작업은 이 파일만 돌린다 (§9 Q7). 네트워크 0, `.env`는 git에 없으므로 읽지 않는다.

패턴 (§9 Q7 그대로. "긴"의 길이는 문서에 숫자가 없어 이 테스트가 정함 — 승인 대기)
    google        AIza + 35자 [0-9A-Za-z_-]
    sk_key        sk- 로 시작하는 긴 키: 앞이 글자·숫자가 아니고, sk- 뒤 20자 이상 [A-Za-z0-9_-]
    supabase_secret  sb_secret_ + 1자 이상 [A-Za-z0-9_-]
    service_role_jwt eyJ… JWT 중 몸(payload)의 role이 service_role (길이와 무관)
    jwt           긴 eyJ… JWT: 머리·몸·서명 세 조각, 각 10자 이상
    private_key   -----BEGIN … PRIVATE KEY-----
    postgres_password postgres(ql)://user:pass@host — 허용: user:pass가 postgres:postgres이고 host가 127.0.0.1·localhost
허용
    파일 이름이 .env.example 인 파일에서 값이 비었거나 자리표시(<…>, […], your-…, x·*·. 만으로 된 값)인 줄
"""

import base64
import json
import re
import subprocess
from pathlib import Path

import pytest

REPO = next(d for d in Path(__file__).resolve().parents if (d / "docs" / "tasks").is_dir())

# 패턴 글자를 그대로 쓰면 다른 스캐너·이 파일 자신에 걸릴 수 있어 조각을 이어 붙인다
_DASHES = "-" * 5
PATTERNS: dict[str, re.Pattern[str]] = {
    "google": re.compile("AI" + "za" + r"[0-9A-Za-z_\-]{35}"),
    "sk_key": re.compile(r"(?<![A-Za-z0-9])" + "s" + "k-" + r"[A-Za-z0-9_\-]{20,}"),
    "supabase_secret": re.compile("sb_" + "secret_" + r"[A-Za-z0-9_\-]+"),
    "private_key": re.compile(_DASHES + "BEGIN " + r"[A-Z0-9 ]*" + "PRIVATE KEY" + _DASHES),
}
JWT = re.compile(r"eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*")
POSTGRES = re.compile(r"postgres(?:ql)?://([^\s:/@'\"`]+):([^\s@'\"`]+)@([^\s/:'\"`?]+)")
LOCAL_HOSTS = {"127.0.0.1", "localhost"}
JWT_MIN_PART = 10
PLACEHOLDER = re.compile(r"^(<[^>]*>|\[[^\]]*\]|your[-_].*|[xX*.]+)$", re.IGNORECASE)


def _payload(token: str) -> dict:
    body = token.split(".")[1]
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def find_in_line(line: str) -> list[str]:
    """한 줄에서 걸린 패턴 이름들 (값은 돌려주지 않는다)."""
    found = [name for name, pattern in PATTERNS.items() if pattern.search(line)]
    for match in JWT.finditer(line):
        parts = match.group(0).split(".")
        if _payload(match.group(0)).get("role") == "service_role":
            found.append("service_role_jwt")
        elif len(parts) == 3 and all(len(part) >= JWT_MIN_PART for part in parts):
            found.append("jwt")
    for match in POSTGRES.finditer(line):
        user, password, host = match.groups()
        if not (user == "postgres" and password == "postgres" and host in LOCAL_HOSTS):
            found.append("postgres_password")
    return found


def allowed(path: str, line: str) -> bool:
    """§9 Q7: .env.example의 빈 값·자리표시."""
    if Path(path).name != ".env.example":
        return False
    if "=" not in line:
        return False
    value = line.split("=", 1)[1].strip().strip("'\"")
    return value == "" or bool(PLACEHOLDER.match(value))


def scan_text(path: str, text: str) -> list[str]:
    """걸린 곳을 `파일:줄 [패턴]`으로. 값은 담지 않는다."""
    hits = []
    for number, line in enumerate(text.splitlines(), 1):
        names = find_in_line(line)
        if names and not allowed(path, line):
            hits.append(f"{path}:{number} [{','.join(sorted(set(names)))}]")
    return hits


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, check=True).stdout
    return [name for name in out.decode("utf-8").split("\0") if name]


# ---------- 저장소 전체 ----------


def test_T13_A5_git_ls_files가_비어_있지_않다():
    files = tracked_files()
    assert len(files) > 100, len(files)
    assert "apps/server/pyproject.toml" in files


def test_T13_A5_저장소에_키처럼_보이는_값이_없다():
    hits = []
    for name in tracked_files():
        path = REPO / name
        if not path.is_file():  # 지운 채 커밋 전인 파일
            continue
        data = path.read_bytes()
        if b"\0" in data:  # 그림 같은 이진 파일
            continue
        hits += scan_text(name, data.decode("utf-8", errors="replace"))
    # 값은 출력하지 않는다: 파일:줄과 패턴 이름만
    assert hits == [], "키처럼 보이는 값 (값은 숨김):\n" + "\n".join(hits)


# ---------- 패턴이 실제로 잡는지 (가짜 값은 실행 중에 이어 붙여 만든다) ----------


def _jwt(payload: dict, signature: str = "s" * 20) -> str:
    def part(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return part({"alg": "HS256", "typ": "JWT"}) + "." + part(payload) + "." + signature


GOOGLE = "AI" + "za" + "A" * 35
SK = "s" + "k-" + "proj" + "Q" * 24
SB = "sb_" + "secret_" + "Z" * 20
PEM = _DASHES + "BEGIN " + "EC " + "PRIVATE KEY" + _DASHES
SERVICE = _jwt({"role": "service" + "_role", "iss": "supabase"}, signature="")
LONG_JWT = _jwt({"sub": "1234567890", "role": "authenticated"})
CLOUD_DB = "postgresql://" + "postgres.abcd" + ":" + "Hunter2pass" + "@" + "aws-0.pooler.supabase.com:6543/postgres"
REMOTE_PG = "postgres://" + "postgres" + ":" + "postgres" + "@" + "db.example.com:5432/postgres"


@pytest.mark.parametrize(
    ("line", "name"),
    [
        (f'KEY = "{GOOGLE}"', "google"),
        (f"OPENAI={SK}", "sk_key"),
        (f"x {SB} y", "supabase_secret"),
        (PEM, "private_key"),
        (f"Authorization: Bearer {SERVICE}", "service_role_jwt"),
        (f"token={LONG_JWT}", "jwt"),
        (f"DATABASE_URL={CLOUD_DB}", "postgres_password"),
        (f"DATABASE_URL={REMOTE_PG}", "postgres_password"),
    ],
    ids=["google", "sk", "sb_secret", "private_key", "service_role_jwt", "긴_jwt", "클라우드_비밀번호_주소", "로컬_아닌_postgres_postgres"],
)
def test_T13_A5_패턴이_잡는다(line, name):
    assert name in find_in_line(line)


def test_T13_A5_Google_키는_35자_정각이면_잡고_34자면_안_잡는다():
    assert "google" in find_in_line("AI" + "za" + "b" * 35)
    assert "google" not in find_in_line("AI" + "za" + "b" * 34)


def test_T13_A5_sk_키는_20자부터_잡고_19자는_안_잡는다():
    assert "sk_key" in find_in_line("s" + "k-" + "c" * 20)
    assert "sk_key" not in find_in_line("s" + "k-" + "c" * 19)


def test_T13_A5_sk_앞에_글자가_붙은_단어는_키가_아니다():
    assert find_in_line("ta" + "sk-" + "c" * 30) == []  # task-… 같은 이름


def test_T13_A5_JWT_조각이_10자면_잡고_9자면_안_잡는다():
    head = "eyJ" + "a" * 7  # 10자
    assert "jwt" in find_in_line(head + ".eyJ" + "b" * 7 + "." + "c" * 10)
    assert "jwt" not in find_in_line(head + ".eyJ" + "b" * 7 + "." + "c" * 9)


@pytest.mark.parametrize(
    "line",
    [
        "postgresql://" + "postgres:postgres" + "@127.0.0.1:54322/postgres",
        "postgresql://" + "postgres:postgres" + "@localhost:54322/postgres",
        "postgres://" + "postgres:postgres" + "@127.0.0.1/postgres",
    ],
    ids=["127", "localhost", "postgres_스킴"],
)
def test_T13_A5_로컬_테스트_DB_주소는_허용(line):
    assert find_in_line(line) == []


@pytest.mark.parametrize(
    "line",
    [
        "postgresql://" + "app:postgres" + "@127.0.0.1:54322/postgres",
        "postgresql://" + "postgres:secret1" + "@localhost:54322/postgres",
    ],
    ids=["사용자가_다름", "비밀번호가_다름"],
)
def test_T13_A5_로컬이라도_postgres_postgres가_아니면_잡는다(line):
    assert "postgres_password" in find_in_line(line)


@pytest.mark.parametrize(
    "line",
    ["SERPER_API_KEY=", "SERPER_API_KEY=<your-key>", "DATABASE_URL=[YOUR-URL]", "GOOGLE_PLACES_API_KEY=your-key", "AI_KEY=xxxx"],
    ids=["빈_값", "꺾쇠", "대괄호", "your", "xxxx"],
)
def test_T13_A5_env_example의_빈_값_자리표시는_허용(line):
    assert allowed("apps/server/.env.example", line)


def test_T13_A5_env_example이라도_진짜처럼_보이는_값은_잡는다():
    assert scan_text("apps/server/.env.example", f"GOOGLE_PLACES_API_KEY={GOOGLE}") != []


def test_T13_A5_env_example이_아닌_파일은_자리표시_허용이_없다():
    assert not allowed("apps/server/settings.txt", "KEY=<your-key>")


def test_T13_A5_보고에는_값이_없고_파일_줄만_있다():
    hits = scan_text("a/b.txt", f"ok\nKEY={GOOGLE}\n")
    assert hits == ["a/b.txt:2 [google]"]
    assert GOOGLE not in "".join(hits)
