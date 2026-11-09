"""TASK-012 A1 스키마 · A5 is_demo · A6 위치 열 0 — 마이그레이션 SQL을 **정적으로** 읽어 확인한다 (DB 없이도 늘 돈다).
근거: TASK-012 §A A1·A5·A6·§7 AC-4("DB에 위치 열 0")·§8(위치 저장 금지), DATA-001 §1·§3 A·C·D·E(R1 테이블)·§4(저장하지 않는 것),
ADR-015 §3-1·§3-2(장소 팩·Google 값은 DB에 넣지 않음), DATA-001 B place_facts(사용자 확인 `user`만 DB에, A1).

고른 방법: 정적 검사. 이유 — 실제 표 모양의 원본은 마이그레이션 파일이고, DB가 없어도(§T) 매번 돌아 회귀를 바로 잡는다.
    마이그레이션을 실제로 적용하는 것은 db 테스트(test_task012_contract·test_task012_db_api)가 `supabase start` 뒤에 확인한다.

계약 (이 테스트가 정한 것, 승인 대기):
    마이그레이션 위치 = 저장소 루트의 supabase/migrations/*.sql (Supabase CLI 기본, 파일 이름 순서대로 적용)
    표 이름은 DATA-001 그대로 (public 스키마). CREATE TABLE · ALTER TABLE … ADD COLUMN 으로 만든 열을 모두 센다
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / "supabase" / "migrations"

R1_TABLES = {
    # A. 사용자·여행
    "profiles", "trips", "trip_days", "fixed_events", "must_visits",
    # C. 계획 대화
    "planning_sessions", "candidate_batches", "reactions", "direction_inputs", "preference_states",
    # D. 코스
    "course_options", "course_items",
    # E. 여행 중
    "trip_events", "recompose_proposals", "visit_checks",
    # B 중 사용자 확인만 (A1)
    "place_facts",
    # F 중 R1이 이미 쓰는 판단 기록 (§10 Q10)
    "decision_logs",
}
# 위치 열 이름 (api/main.py 위치 가리기 _POSITION_QUERY와 같은 이름 + 좌표·위치 뜻의 이름)
LOCATION_NAME = re.compile(r"(^|_)(lat|lng|lon|latitude|longitude|location|position|coords?|coordinates|geom|geog|geometry|geography|point)($|_)")
LOCATION_TYPE = re.compile(r"\b(geography|geometry|point|box|polygon|circle)\b")
OTHER_SOURCES = ["google", "serper", "curated", "estimate", "demo", "official", "api", "collected"]  # DATA-001 B source_type 중 user 아닌 것


def _sql() -> str:
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, f"마이그레이션이 없다: {MIGRATIONS.relative_to(REPO)}/*.sql (TASK-012 A1)"
    text = "\n".join(path.read_text(encoding="utf-8") for path in files)
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"--[^\n]*", " ", text)
    return text.lower()


def _body_after(text: str, start: int) -> str:
    """start가 가리키는 '(' 부터 짝이 맞는 ')' 까지의 안쪽."""
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index]
    raise AssertionError("괄호 짝이 맞지 않는 CREATE TABLE")


def _split_top(body: str) -> list[str]:
    parts, depth, current = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if "".join(current).strip():
        parts.append("".join(current).strip())
    return parts


NAME = r'(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?'
CONSTRAINT_WORDS = ("constraint", "primary", "foreign", "unique", "check", "exclude", "like")


def schema() -> dict[str, dict]:
    """표 이름 -> {"columns": {열 이름: 타입 글자}, "text": 그 표에 대한 정의 글자 전부}."""
    text = _sql()
    tables: dict[str, dict] = {}
    for match in re.finditer(rf"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?{NAME}\s*\(", text):
        name = match.group(1)
        body = _body_after(text, match.end() - 1)
        entry = tables.setdefault(name, {"columns": {}, "text": ""})
        entry["text"] += body
        for part in _split_top(body):
            words = part.split()
            if not words or words[0] in CONSTRAINT_WORDS:
                continue
            entry["columns"][words[0].strip('"')] = " ".join(words[1:])
    for match in re.finditer(rf"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?{NAME}\s+([^;]*);", text):
        name, rest = match.group(1), match.group(2)
        entry = tables.setdefault(name, {"columns": {}, "text": ""})
        entry["text"] += rest
        for add in re.finditer(r'add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+([^,]+)', rest):
            if add.group(1) not in CONSTRAINT_WORDS:
                entry["columns"][add.group(1)] = add.group(2)
    return tables


# ---------- A1 R1 표 ----------


def test_T12_A1_마이그레이션_파일이_supabase_migrations에_있다():
    assert sorted(MIGRATIONS.glob("*.sql")), "supabase/migrations/*.sql 없음"


@pytest.mark.parametrize("table", sorted(R1_TABLES))
def test_T12_A1_DATA_001_R1_표가_있다(table):
    assert table in schema(), f"{table} 표가 마이그레이션에 없다 (DATA-001 §3)"


@pytest.mark.parametrize(
    ("table", "columns"),
    [
        ("trips", {"owner_id", "city_code", "start_date", "end_date", "lodging_place_id", "status"}),
        ("trip_days", {"trip_id", "day", "start_time", "end_time", "chosen_option_id"}),
        ("fixed_events", {"trip_day_id", "place_id", "title", "start_at", "end_at"}),
        ("must_visits", {"trip_id", "place_id"}),
        ("place_facts", {"place_id", "field", "value", "status", "source_type", "source_url", "checked_at"}),
        ("reactions", {"session_id", "place_id", "action"}),
        ("course_items", {"option_id", "seq", "place_id", "start_at", "end_at", "travel_min", "is_fixed", "stay_source"}),
        ("trip_events", {"trip_day_id", "type", "severity", "evidence", "dedupe_key"}),
        ("recompose_proposals", {"event_id", "option_id", "reason", "user_choice"}),
        ("visit_checks", {"place_id", "trip_day_id", "was_open", "checked_at"}),
    ],
)
def test_T12_A1_핵심_열이_DATA_001과_같다(table, columns):
    found = schema().get(table, {"columns": {}})["columns"]
    assert columns <= set(found), f"{table}에 없는 열: {sorted(columns - set(found))}"


def test_T12_A1_trips_status는_active·archived():  # TASK-010 §9 Q2
    text = schema()["trips"]["text"]
    assert "'active'" in text and "'archived'" in text


# ---------- A1·ADR-015 장소 팩·Google 값 표 없음 ----------


def test_T12_A1_ADR_015_장소_팩_표가_없다():
    tables = schema()
    assert "places" not in tables, "places(장소 팩)는 git의 도시 팩에 둔다 (ADR-015 §3-1)"
    assert not [name for name in tables if "google" in name or "pack" in name], sorted(tables)


@pytest.mark.parametrize("word", OTHER_SOURCES)
def test_T12_A1_place_facts는_user_출처만_다른_출처_글자가_없다(word):
    text = schema()["place_facts"]["text"]
    assert f"'{word}'" not in text, f"place_facts에 '{word}' 출처가 허용돼 있다 (A1: user만)"


def test_T12_A1_place_facts의_source_type은_user만_받는_제약():
    text = schema()["place_facts"]["text"]
    assert re.search(r"source_type[^,]*'user'", text) or re.search(r"check\s*\([^;]*source_type[^;]*'user'", text), "source_type = 'user' 제약이 없다"


# ---------- A5 데모 표시 ----------


def test_T12_A5_trips에_is_demo_열():
    columns = schema()["trips"]["columns"]
    assert "is_demo" in columns
    assert "bool" in columns["is_demo"]


def test_T12_Q5_trips_owner_id가_비는_것은_데모_여행일_때만():
    # §10 Q5: 로그인 없는 데모 여행만 주인이 비어도 된다. 표의 제약으로 고정: owner_id가 null이면 is_demo가 true여야 한다
    text = schema()["trips"]["text"]
    assert "owner_id" in schema()["trips"]["columns"]
    assert re.search(r"check\s*\([^;]*owner_id\s+is\s+not\s+null[^;]*is_demo|check\s*\([^;]*is_demo[^;]*owner_id\s+is\s+not\s+null", text), (
        "trips에 'owner_id is not null or is_demo' 같은 제약이 없다 (§10 Q5)"
    )


# ---------- A6 위치 열 0 (AC-4) ----------


def test_T12_A6_AC4_어느_표에도_위치_열이_없다():
    found = [
        f"{table}.{column} {kind}".strip()
        for table, entry in schema().items()
        for column, kind in entry["columns"].items()
        if LOCATION_NAME.search(column) or LOCATION_TYPE.search(kind)
    ]
    assert found == [], found


def test_T12_A6_마이그레이션에_PostGIS를_켜지_않는다():
    assert not re.search(r"create\s+extension[^;]*postgis", _sql())


# 검사 도구 자신의 경계 (가짜 SQL로 위치 열을 잡는지)
@pytest.mark.parametrize(
    ("column", "caught"),
    [("lat", True), ("lodging_lng", True), ("latitude", True), ("geom", True), ("last_seen", False), ("place_id", False), ("plan", False), ("long_name", False), ("lon", True)],
)
def test_T12_A6_위치_열_이름_검사의_경계(column, caught):
    assert bool(LOCATION_NAME.search(column)) is caught
