"""TASK-013 §B5 CI 워크플로 검사 — `.github/workflows/ci.yml`을 **정적으로** 읽어 확인한다 (네트워크·키 0).
근거: TASK-013 §A A6(바뀐 파일만: 폴더 표) · §B B1(비밀값 0) · B3(`permissions: contents: read`) · B5(검사 테스트 하나).

고른 방법
    위치: 서버 pytest (apps/server/tests). 이유 — PyYAML이 이미 서버 의존성이고, 워크플로 파일이 바뀌면 A6에 따라
        모든 작업(서버 포함)이 돌고 main push도 항상 전부라 이 검사가 빠지지 않는다. 앱(Jest)에는 YAML 읽기 도구가 없다.
    A6 폴더 표: 테스트 안에 상수로 둔다 (아래 SERVER_PATHS·MOBILE_PATHS). 이유 — 문서 문장 모양에 테스트가 묶이지 않고,
        실패 메시지가 "어느 경로가 빠졌나"로 바로 읽힌다. 문서가 바뀌었는데 상수만 남는 일을 막으려고
        문서 A6 줄의 백틱 경로 묶음과 상수 합이 같은지도 한 번 본다 (test_T13_B5_상수가_문서_A6_줄과_같다).

계약 (이 테스트가 정한 것, 승인 대기 — 문서에 워크플로 안 모양은 정해져 있지 않다)
    1. 바뀐 폴더 판정은 job `changes` 하나가 한다. 그 job의 `env`에 경로 목록을 둔다 (공백·줄바꿈으로 나눈 glob):
         SERVER_PATHS  = 서버·slow·DB 작업을 깨우는 경로 (A6 첫째 묶음)
         MOBILE_PATHS  = 앱 작업을 깨우는 경로 (A6 둘째 묶음)
         ALL_PATHS     = 바뀌면 전부 도는 경로. `.github/workflows/ci.yml`을 담는다 (A6 "워크플로 파일 자체가 바뀌면 전부")
    2. 트리거는 `pull_request`(main)과 `push`(main)만. `pull_request_target` 없음
    3. 맨 위 `permissions`는 정확히 {contents: read}. job 단위 `permissions`에도 write 없음. 파일 어디에도 `secrets.` 없음
"""

import re
from pathlib import Path

import pytest
import yaml

REPO = next(d for d in Path(__file__).resolve().parents if (d / "docs" / "tasks").is_dir())
WORKFLOW = REPO / ".github" / "workflows" / "ci.yml"
TASK = REPO / "docs" / "tasks" / "TASK-013_CI.md"

# TASK-013 §A A6 (결정권자 11-13) 그대로
SERVER_PATHS = {"apps/server/**", "supabase/**", "packages/**", "testdata/**"}
MOBILE_PATHS = {"apps/mobile/**", "packages/**", "package.json", "pnpm-lock.yaml", ".npmrc"}
WORKFLOW_SELF = ".github/workflows/ci.yml"


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
    assert value is not None, "경로 목록이 비어 있다"
    if isinstance(value, list):
        return {str(item).strip() for item in value if str(item).strip()}
    return set(str(value).split())


def _changes_env() -> dict:
    jobs = _workflow().get("jobs") or {}
    assert "changes" in jobs, "jobs.changes가 없다 (계약 1: 바뀐 폴더 판정 job)"
    env = jobs["changes"].get("env") or {}
    return env


# ---------- B1·B3·B5 비밀값·권한 ----------


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


# ---------- A6 폴더 표와 워크플로 경로 목록 ----------


def test_T13_B5_상수가_문서_A6_줄과_같다():
    row = next((line for line in TASK.read_text(encoding="utf-8").splitlines() if line.startswith("| A6")), None)
    assert row is not None, "TASK-013 §A에 A6 줄이 없다"
    # A6 줄의 `docs/`는 "docs만 바뀐 PR은 키 검사만"의 예외 경로라 작업을 깨우는 목록에서 뺀다
    in_doc = set(re.findall(r"`([^`]+)`", row)) - {"docs/"}
    assert in_doc == SERVER_PATHS | MOBILE_PATHS, in_doc ^ (SERVER_PATHS | MOBILE_PATHS)


@pytest.mark.parametrize(
    ("key", "expected"),
    [("SERVER_PATHS", SERVER_PATHS), ("MOBILE_PATHS", MOBILE_PATHS)],
    ids=["서버_slow_DB", "앱"],
)
def test_T13_B5_워크플로_경로_목록이_A6_표와_같다(key, expected):
    env = _changes_env()
    assert key in env, f"jobs.changes.env.{key}가 없다 (계약 1)"
    got = _paths(env[key])
    assert got == expected, f"{key}: 빠짐 {sorted(expected - got)} · 더 있음 {sorted(got - expected)} (TASK-013 A6)"


def test_T13_B5_워크플로_파일이_바뀌면_전부():
    env = _changes_env()
    assert "ALL_PATHS" in env, "jobs.changes.env.ALL_PATHS가 없다 (계약 1)"
    assert WORKFLOW_SELF in _paths(env["ALL_PATHS"]), "A6: 워크플로 파일 자체가 바뀌면 전부"


def test_T13_B5_docs는_어느_작업도_깨우지_않는다():
    """A6: `docs/`만 바뀐 PR은 키 검사만. 경로 목록에 docs가 들어가면 안 된다."""
    env = _changes_env()
    for key in ("SERVER_PATHS", "MOBILE_PATHS", "ALL_PATHS"):
        assert not [p for p in _paths(env.get(key, "")) if p.startswith("docs")], key
