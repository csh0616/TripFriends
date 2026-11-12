"""TASK-013 §B5 CI 워크플로 검사 — `.github/workflows/ci.yml`을 **정적으로** 읽어 확인한다 (네트워크·키 0).
근거: TASK-013 §A A6(바뀐 파일만: 폴더 표) · §B B1(비밀값 0) · B3(`permissions: contents: read`) · B5(검사 테스트 하나)
      · §9 Q2(테스트가 실제로 읽는 docs 경로를 목록에) · Q3(자기 폴더 밖을 읽으면 그 경로가 목록에, B5로 고정)
      · Q5(Python을 맥과 같은 버전으로 고정) · Q8(계약 승인).

고른 방법
    위치: 서버 pytest. PyYAML이 이미 서버 의존성이고, 워크플로 파일이 바뀌면 전부 돌고 main push도 전부라 빠지지 않는다.
    경로 목록: 테스트 안 상수 (SERVER_PATHS·MOBILE_PATHS). 문서 A6 줄은 "기본 묶음"으로만 읽고(§9로 늘어난 경로는
        A6 줄에 없다), 기본 묶음 밖의 경로는 모두 아래 OUTSIDE_READS(테스트가 실제로 읽는 바깥 파일)로 설명돼야 한다.
    Q3 바깥 읽기: "알려진 목록 대조 + 새 파일 감지". 경로를 코드에서 완전히 뽑기는 어렵다(join·템플릿 문자열·반복으로 만든다).
        대신 바깥을 가리키는 표시(서버: "docs"·"testdata"·"supabase"·"packages"·"apps"·".github" 글자, 앱: REPO_ROOT)가
        있는 파일 집합이 OUTSIDE_READS의 키와 정확히 같은지 본다. 새 파일이 바깥을 읽기 시작하면 여기서 빨강이 되고,
        그때 사람이 읽는 경로를 OUTSIDE_READS와 목록에 넣는다. 각 경로가 목록(glob)에 덮이는지는 자동으로 본다.

계약 (§9 Q8 승인)
    1. job `changes`의 `env`에 경로 목록 (공백·줄바꿈으로 나눈 glob. `dir/**`는 그 아래 전부, 나머지는 정확한 파일):
         SERVER_PATHS · MOBILE_PATHS = 아래 상수와 같은 집합 / ALL_PATHS = `.github/workflows/ci.yml` 포함
    2. 트리거는 `pull_request`(main)·`push`(main)만. `pull_request_target` 없음
    3. 맨 위 `permissions`는 정확히 {contents: read}. job 단위에도 write 없음. 파일 어디에도 `secrets.` 없음
    4. `apps/server/.python-version` = 맥 `uv run python --version` 값 3.15.2 (§9 Q5)
"""

import platform
import re
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = next(d for d in Path(__file__).resolve().parents if (d / "docs" / "tasks").is_dir())
WORKFLOW = REPO / ".github" / "workflows" / "ci.yml"
TASK = REPO / "docs" / "tasks" / "TASK-013_CI.md"
WORKFLOW_SELF = ".github/workflows/ci.yml"
MAC_PYTHON = "3.15.2"  # §9 Q5: 맥 `uv run python --version` (11-13)

# 문서 A6 줄의 기본 묶음 (§A A6)
A6_SERVER = {"apps/server/**", "supabase/**", "packages/**", "testdata/**"}
A6_MOBILE = {"apps/mobile/**", "packages/**", "package.json", "pnpm-lock.yaml", ".npmrc"}

PLACE_KINDS = ["cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"]  # task-011-planning-card §9 Q13

# 자기 폴더 밖을 읽는 파일 -> 읽는 경로 (§9 Q2·Q3). 빈 집합 = 표시는 있지만 바깥 파일을 읽지 않음(이유 주석)
OUTSIDE_READS: dict[str, set[str]] = {
    # ---- 서버 (apps/server) ----
    "apps/server/places/__main__.py": set(),  # docs/data/osaka-seed.yaml은 명령줄 기본값뿐. 테스트는 --seed로 testdata를 준다
    "apps/server/places/provider.py": {"testdata/cities/**"},
    "apps/server/places/serper.py": set(),  # 설명 글에 testdata 이름만
    "apps/server/tests/test_planning_api.py": {"packages/api-types/**"},
    "apps/server/tests/test_planning_screens_api.py": {"packages/api-types/**"},
    "apps/server/tests/test_score_candidates.py": {"docs/poc/poc_c.json"},
    "apps/server/tests/test_secret_scan.py": set(),  # git ls-files 전체를 읽는다. A5 작업이 항상 돌리므로 경로 목록과 무관 (§9 Q7)
    "apps/server/tests/test_task009_polish.py": {"testdata/particles.json"},
    "apps/server/tests/test_task010_places.py": {"testdata/cities/osaka-fake.json", "testdata/cities/osaka-seed-fake.yaml"},
    "apps/server/tests/test_task010_v14.py": {"docs/data/osaka-seed.yaml"},
    "apps/server/tests/test_task012_schema.py": {"supabase/migrations/**"},
    "apps/server/tests/test_task013_ci.py": {"docs/tasks/TASK-013_CI.md", WORKFLOW_SELF},  # §12: A5 작업에서도 항상 돈다
    # ---- 앱 (apps/mobile) ----
    "apps/mobile/__tests__/design-tokens.test.ts": {"packages/design-tokens/**"},
    "apps/mobile/__tests__/guardrails.test.tsx": {
        "packages/design-tokens/tokens.json", "docs/DESIGN-001_Brand-Tokens.md", "docs/design/logo-ink.png",
    },
    "apps/mobile/__tests__/particle.test.ts": {"testdata/particles.json"},
    "apps/mobile/__tests__/planning-flow.test.tsx": {"packages/api-types/openapi.json"},
    "apps/mobile/__tests__/planning-lib.test.ts": {"packages/api-types/openapi.json"},
    "apps/mobile/__tests__/task-006-design.test.tsx": {
        "docs/design/google-map-style.json", "docs/design/app-icon-1024.png", "docs/design/logo-ink.png",
    },
    "apps/mobile/__tests__/task-009-select.test.tsx": {"testdata/particles.json"},
    "apps/mobile/__tests__/task-011-planning-card.test.tsx": {f"docs/design/place-images/{kind}.svg" for kind in PLACE_KINDS},
    "apps/mobile/__tests__/task-012-city-names.test.ts": {"apps/server/trip/link.py"},
    "apps/mobile/__tests__/task-012-g-logo.test.tsx": {
        "docs/design/google/g-logo.png", "docs/design/google/g-logo@2x.png", "docs/design/google/g-logo@3x.png",
    },
    "apps/mobile/__tests__/task-012-link-lib.test.ts": set(),  # REPO_ROOT를 가져오기만 하고 쓰지 않는다
    "apps/mobile/__tests__/task-013-toolchain.test.ts": {".node-version", "pnpm-workspace.yaml", "package.json"},
}


def _reads(prefix: str) -> set[str]:
    return set().union(*(paths for name, paths in OUTSIDE_READS.items() if name.startswith(prefix)))


def _own(path: str, folder: str) -> bool:
    return path.startswith(folder + "/")


# 최종 목록 = 기본 묶음 + 바깥 읽기 중 기본 묶음에 안 덮이는 것 (§9 Q2·Q3)
def _covered(path: str, patterns: set[str]) -> bool:
    for pattern in patterns:
        if pattern.endswith("/**") and path.startswith(pattern[:-2]):
            return True
        if path == pattern:
            return True
    return False


SERVER_PATHS = A6_SERVER | {
    "docs/poc/poc_c.json", "docs/data/osaka-seed.yaml", "docs/tasks/TASK-013_CI.md",
}
MOBILE_PATHS = A6_MOBILE | {
    "testdata/particles.json", "apps/server/trip/link.py",
    ".node-version", "pnpm-workspace.yaml",
    "docs/DESIGN-001_Brand-Tokens.md",
    "docs/design/logo-ink.png", "docs/design/app-icon-1024.png", "docs/design/google-map-style.json",
    "docs/design/google/g-logo.png", "docs/design/google/g-logo@2x.png", "docs/design/google/g-logo@3x.png",
} | {f"docs/design/place-images/{kind}.svg" for kind in PLACE_KINDS}
ALL_PATHS_REQUIRED = {WORKFLOW_SELF}


def _text() -> str:
    assert WORKFLOW.is_file(), f"워크플로 파일이 없다: {WORKFLOW.relative_to(REPO)} (TASK-013 §0 2단계 backend)"
    return WORKFLOW.read_text(encoding="utf-8")


def _workflow() -> dict:
    data = yaml.safe_load(_text())
    assert isinstance(data, dict), "ci.yml이 YAML 사전이 아니다"
    return data


def _triggers(data: dict) -> dict:
    # PyYAML(YAML 1.1)은 맨 위 `on:` 키를 True로 읽는다
    triggers = data.get("on", data.get(True))
    assert triggers is not None, "ci.yml에 on: 트리거가 없다"
    if isinstance(triggers, str):
        return {triggers: None}
    if isinstance(triggers, list):
        return {name: None for name in triggers}
    return triggers


def _paths(value) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, list):
        return {str(item).strip() for item in value if str(item).strip()}
    return set(str(value).split())


def _changes_env() -> dict:
    jobs = _workflow().get("jobs") or {}
    assert "changes" in jobs, "jobs.changes가 없다 (계약 1: 바뀐 폴더 판정 job)"
    return jobs["changes"].get("env") or {}


def _tracked(*patterns: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z", "--", *patterns], cwd=REPO, capture_output=True, check=True).stdout
    return [name for name in out.decode("utf-8").split("\0") if name]


# ---------- B1·B3·B5 비밀값·권한·트리거 ----------


def test_T13_B5_워크플로에_secrets_참조가_없다():
    hits = [n for n, line in enumerate(_text().splitlines(), 1) if "secrets." in line]
    assert hits == [], f"ci.yml {hits}번째 줄에 secrets. (TASK-013 B1·B5: GitHub Secrets 0)"


def test_T13_B5_pull_request_target을_쓰지_않는다():
    assert "pull_request_target" not in _text()
    assert "pull_request_target" not in _triggers(_workflow())


def test_T13_B5_트리거는_main으로_가는_PR과_main_push():
    triggers = _triggers(_workflow())
    assert set(triggers) == {"pull_request", "push"}, set(triggers)
    for name in ("pull_request", "push"):
        branches = (triggers[name] or {}).get("branches")
        assert branches == ["main"], f"{name}.branches = {branches!r} (TASK-013 §A 언제: PR(→ main)·main push)"


def test_T13_B3_맨_위_권한은_contents_read_하나():
    assert _workflow().get("permissions") == {"contents": "read"}


def _permission_values(value) -> list[str]:
    if isinstance(value, dict):
        return [str(v) for v in value.values()]
    return [str(value)] if value is not None else []


def test_T13_B5_어느_권한에도_write가_없다():
    data = _workflow()
    found = _permission_values(data.get("permissions"))
    for name, job in (data.get("jobs") or {}).items():
        found += [f"{name}:{v}" for v in _permission_values((job or {}).get("permissions"))]
    assert [v for v in found if "write" in v] == [], found
    assert not re.search(r"^\s*permissions:\s*write-all\s*$", _text(), re.MULTILINE)


# ---------- A6·§9 Q2·Q3 경로 목록 (상수끼리·문서와: 지금 초록이어야 한다) ----------


def test_T13_B5_문서_A6_줄의_기본_묶음이_상수와_같다():
    """§9로 늘어난 경로는 A6 줄에 없다. 그래서 A6 줄 = 기본 묶음만 본다 (`docs/`는 "docs만 바뀐 PR" 설명의 예외 경로)."""
    row = next((line for line in TASK.read_text(encoding="utf-8").splitlines() if line.startswith("| A6")), None)
    assert row is not None, "TASK-013 §A에 A6 줄이 없다"
    in_doc = set(re.findall(r"`([^`]+)`", row)) - {"docs/"}
    assert in_doc == A6_SERVER | A6_MOBILE, in_doc ^ (A6_SERVER | A6_MOBILE)


@pytest.mark.parametrize(
    ("paths", "base", "folder"),
    [(SERVER_PATHS, A6_SERVER, "apps/server"), (MOBILE_PATHS, A6_MOBILE, "apps/mobile")],
    ids=["서버", "앱"],
)
def test_T13_Q2_Q3_기본_묶음_밖의_경로는_모두_테스트가_실제로_읽는_파일(paths, base, folder):
    extra = paths - base
    reads = _reads(folder + "/")
    assert sorted(p for p in extra if p not in reads) == [], "목록에 있지만 읽는 테스트가 없는 경로"


@pytest.mark.parametrize(
    ("paths", "folder"),
    [(SERVER_PATHS | ALL_PATHS_REQUIRED, "apps/server"), (MOBILE_PATHS, "apps/mobile")],
    ids=["서버", "앱"],
)
def test_T13_Q3_자기_폴더_밖에서_읽는_경로는_목록에_덮인다(paths, folder):
    reads = _reads(folder + "/")
    assert sorted(p for p in reads if not _own(p, folder) and not _covered(p, paths)) == []


def test_T13_Q2_docs_경로는_정확한_파일만이고_실제로_있다():
    for path in SERVER_PATHS | MOBILE_PATHS:
        if path.startswith("docs"):
            assert "*" not in path, f"{path}: docs는 테스트가 읽는 파일만 (§9 Q2)"
            assert (REPO / path).is_file(), f"{path}가 없다"


def test_T13_Q3_바깥을_가리키는_파일_집합이_OUTSIDE_READS와_같다():
    """새 파일이 바깥 경로를 읽기 시작하면 여기서 멈춘다 → 읽는 경로를 OUTSIDE_READS와 목록에 넣는다."""
    server_mark = re.compile(r"[\"'](docs|testdata|supabase|packages|apps|\.github)[\"'/]")
    found = set()
    for name in _tracked("apps/server/*.py"):
        if server_mark.search((REPO / name).read_text(encoding="utf-8")):
            found.add(name)
    for name in _tracked("apps/mobile/*.ts", "apps/mobile/*.tsx", "apps/mobile/*.js"):
        if name == "apps/mobile/test-support/source-files.ts":  # REPO_ROOT를 정의하는 곳
            continue
        if "REPO_ROOT" in (REPO / name).read_text(encoding="utf-8"):
            found.add(name)
    assert found == set(OUTSIDE_READS), {"표에 없음": sorted(found - set(OUTSIDE_READS)), "표에만 있음": sorted(set(OUTSIDE_READS) - found)}


# ---------- 워크플로의 경로 목록 (backend 몫: 지금 빨강) ----------


@pytest.mark.parametrize(
    ("key", "expected"),
    [("SERVER_PATHS", SERVER_PATHS), ("MOBILE_PATHS", MOBILE_PATHS)],
    ids=["서버_slow_DB", "앱"],
)
def test_T13_B5_워크플로_경로_목록이_A6_표와_같다(key, expected):
    env = _changes_env()
    assert key in env, f"jobs.changes.env.{key}가 없다 (계약 1)"
    got = _paths(env[key])
    assert got == expected, f"{key}: 빠짐 {sorted(expected - got)} · 더 있음 {sorted(got - expected)} (TASK-013 A6·§9 Q2·Q3)"


def test_T13_B5_워크플로_파일이_바뀌면_전부():
    env = _changes_env()
    assert "ALL_PATHS" in env, "jobs.changes.env.ALL_PATHS가 없다 (계약 1)"
    assert WORKFLOW_SELF in _paths(env["ALL_PATHS"]), "A6: 워크플로 파일 자체가 바뀌면 전부"


def test_T13_Q2_워크플로의_docs_경로는_테스트가_읽는_파일뿐():
    """docs만 바뀐 PR은 그 파일을 읽는 테스트가 있을 때만 작업을 깨운다 (§9 Q2). docs/** 같은 넓은 경로 금지."""
    env = _changes_env()
    reads = _reads("apps/")
    for key in ("SERVER_PATHS", "MOBILE_PATHS", "ALL_PATHS"):
        wide = [p for p in _paths(env.get(key)) if p.startswith("docs") and p not in reads]
        assert wide == [], f"{key}: {wide}"


# ---------- §12 항상 도는 키 검사 작업이 이 검사도 함께 돌린다 ----------

ALWAYS_TESTS = ("tests/test_secret_scan.py", "tests/test_task013_ci.py")  # §9 Q7 · §12 질문 답


def test_T13_S12_키_검사_작업은_항상_돌고_키_검사와_워크플로_검사를_함께_돌린다():
    """§12: test_task013_ci.py(워크플로 검사 + 바깥 읽기 검사)를 키 검사 작업(항상 돎)에서 함께 돌린다.
    OUTSIDE_READS의 test_secret_scan.py 주석("A5 작업이 항상 돌리므로")도 이 작업이 조건 없이 돈다는 전제다."""
    job = (_workflow().get("jobs") or {}).get("secret-scan")
    assert job is not None, "jobs.secret-scan이 없다 (A5)"
    assert "if" not in job, f"secret-scan에 if: {job.get('if')!r} — 항상 돌아야 한다 (A6 키 검사 ← 항상)"
    runs = [str(step.get("run", "")) for step in job.get("steps") or [] if isinstance(step, dict)]
    pytest_runs = [run for run in runs if "pytest" in run]
    for name in ALWAYS_TESTS:
        assert any(name in run.split() for run in pytest_runs), f"secret-scan의 pytest 명령에 {name}이 없다: {pytest_runs}"
    # 조건 없는 작업이라도 그 단계가 조건으로 빠지면 안 된다
    for step in job.get("steps") or []:
        if isinstance(step, dict) and "pytest" in str(step.get("run", "")):
            assert "if" not in step, f"pytest 단계에 if: {step.get('if')!r}"


# ---------- §9 Q5 Python 고정 (파일은 backend가 만든다) ----------

PYTHON_VERSION_FILE = REPO / "apps" / "server" / ".python-version"


def test_T13_Q5_python_version_파일이_맥_값과_같다():
    assert PYTHON_VERSION_FILE.is_file(), "apps/server/.python-version이 없다 (§9 Q5)"
    assert PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip() == MAC_PYTHON


def test_T13_Q5_테스트를_돌리는_Python이_고정한_버전이다():
    assert PYTHON_VERSION_FILE.is_file(), "apps/server/.python-version이 없다 (§9 Q5)"
    assert platform.python_version() == PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
