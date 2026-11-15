"""TASK-015 §11 Q9 숙소 칸 옮기기 마이그레이션: trips.lodging_place_id -> trips.lodging (서버 · DB).

근거: TASK-015 §11 Q9("옮기고 지운다: 새 마이그레이션이 기존 값을 lodging = {kind: "place", place_id, …}로 채운 뒤 칸을 지움.
같은 뜻이 두 곳이면 어긋난다. 마이그레이션 테스트: 기존 여행의 숙소가 그대로(여행은 지우지 않는다 규칙)") ·
§9 모양(lodging 6칸 늘 있음 또는 null) · §A(trips.lodging jsonb 한 칸) · TASK-012 A1(마이그레이션 = supabase/migrations/*.sql, 파일 이름 순서).

계약:
    새 마이그레이션 파일 하나 = supabase/migrations/ 에서 20261111000000_task012_account_claims.sql 뒤 이름이고,
        lodging_place_id를 읽어 trips.lodging(jsonb)을 채운 뒤 `drop column lodging_place_id`.
        이 파일은 trips 숙소 옮기기만 한다 (DB 테스트가 이 파일을 옛 모양의 trips 위에서 트랜잭션 안에 다시 돌리고 되돌린다).
        lodging 열을 이 파일에서 만들어도, 앞 파일에서 만들어도 된다. 파일 안에 begin·commit·rollback 없음
    옮긴 값: lodging_place_id = X -> lodging = {"kind": "place", "place_id": X, "address_text": null, "lat": null, "lng": null, "label": null}
             lodging_place_id = null -> lodging = null
    여행·날 줄은 하나도 지우지 않고, 숙소 밖의 칸(주인·도시·날짜·상태·데모)은 그대로
"""

import os
import re
import uuid

import pytest

from conftest import TEST_DB_ENV
from test_task012_schema import MIGRATIONS, schema

LAST_BEFORE = "20261111000000_task012_account_claims.sql"
_RUN = uuid.uuid4().hex[:8]


def _plain(path) -> str:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"--[^\n]*", " ", text).lower()


def move_migration():
    """옮기기 마이그레이션 파일 (하나여야 한다)."""
    found = [
        path
        for path in sorted(MIGRATIONS.glob("*.sql"))
        if path.name > LAST_BEFORE and "lodging_place_id" in _plain(path) and re.search(r"drop\s+column\s+(if\s+exists\s+)?\"?lodging_place_id", _plain(path))
    ]
    assert len(found) == 1, f"lodging_place_id를 옮기고 지우는 새 마이그레이션이 하나여야 한다: {[p.name for p in found]}"
    return found[0]


# ---------- 정적 (DB 없이 늘 돈다) ----------


def test_T15_S11_Q9_새_마이그레이션이_lodging_place_id를_옮기고_지운다():
    text = _plain(move_migration())
    assert re.search(r"update\s+(public\.)?\"?trips\"?", text), "기존 값을 lodging으로 채우는 update가 없다"
    assert "'place'" in text, "옮긴 값의 kind = 'place'"


def test_T15_S11_Q9_모든_마이그레이션_뒤_trips에_lodging만_있고_lodging_place_id는_없다():
    columns = schema()["trips"]["columns"]
    assert "lodging" in columns and "lodging_place_id" not in columns, sorted(columns)


@pytest.mark.parametrize(
    "pattern",
    [r"delete\s+from", r"truncate", r"drop\s+table", r"drop\s+schema"],
    ids=["delete", "truncate", "drop_table", "drop_schema"],
)
def test_T15_S11_Q9_옮기기_마이그레이션은_여행을_지우지_않는다(pattern):
    assert not re.search(pattern, _plain(move_migration())), pattern


@pytest.mark.parametrize("pattern", [r"\bbegin\b\s*;", r"\bcommit\b", r"\brollback\b"], ids=["begin", "commit", "rollback"])
def test_T15_S11_Q9_옮기기_마이그레이션은_스스로_트랜잭션을_열고_닫지_않는다(pattern):
    """Supabase CLI가 파일마다 트랜잭션으로 감싼다. 파일 안 commit은 DB 테스트의 되돌리기도 깬다."""
    assert not re.search(pattern, _plain(move_migration())), pattern


# ---------- DB (로컬 Postgres, `-m db`) ----------

PLACE_X = f"FAKE-T15-mig-place-{_RUN}"
PLACE_Y = f"FAKE-T15-mig-place-y-{_RUN}"


def as_place(place_id: str) -> dict:
    return {"kind": "place", "place_id": place_id, "address_text": None, "lat": None, "lng": None, "label": None}


@pytest.mark.db
def test_T15_S11_Q9_DB_기존_여행의_숙소가_그대로_옮겨지고_여행·날은_지우지_않는다():
    """옛 모양(lodging 없음 · lodging_place_id 있음)의 trips를 트랜잭션 안에 만들고 새 마이그레이션을 돌린 뒤 되돌린다 (DB에 남는 것 0)."""
    import psycopg

    sql = move_migration().read_text(encoding="utf-8")
    assert not re.search(r"\bcommit\b|\brollback\b", _plain(move_migration())), "파일 안 commit/rollback이 있으면 되돌릴 수 없어 돌리지 않는다"
    owner = uuid.uuid4()
    rows = [  # (trip id, lodging_place_id, status, is_demo)
        (uuid.uuid4(), PLACE_X, "active", False),
        (uuid.uuid4(), None, "active", False),
        (uuid.uuid4(), PLACE_Y, "archived", False),
        (uuid.uuid4(), PLACE_X, "active", True),
    ]
    day_id = uuid.uuid4()
    with psycopg.connect(os.environ[TEST_DB_ENV]) as conn:
        try:
            with conn.cursor() as cur:
                # 마이그레이션 전 모양으로 되돌린다 (이 트랜잭션 안에서만). lodging 열을 이 파일이 만들면 지우고, 앞 파일이 만들었으면 둔다
                if re.search(r"add\s+(column\s+)?(if\s+not\s+exists\s+)?\"?lodging\"?\s", _plain(move_migration())):
                    cur.execute("alter table public.trips drop column if exists lodging")
                cur.execute("alter table public.trips add column if not exists lodging_place_id text")
                cur.execute("insert into public.profiles (id) values (%s)", (owner,))
                for trip_id, lodging_place_id, status, is_demo in rows:
                    cur.execute(
                        "insert into public.trips (id, owner_id, city_code, start_date, end_date, lodging_place_id, status, is_demo)"
                        " values (%s, %s, 'osaka', '2026-12-01', '2026-12-03', %s, %s, %s)",
                        (trip_id, owner, lodging_place_id, status, is_demo),
                    )
                cur.execute(
                    "insert into public.trip_days (id, trip_id, day, day_number, start_time, end_time) values (%s, %s, '2026-12-01', 1, '09:00', '21:00')",
                    (day_id, rows[0][0]),
                )
                cur.execute("select count(*) from public.trips")
                trips_before = cur.fetchone()[0]
                cur.execute("select count(*) from public.trip_days")
                days_before = cur.fetchone()[0]

                cur.execute(sql)

                cur.execute("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'trips'")
                columns = {row[0] for row in cur.fetchall()}
                assert "lodging" in columns and "lodging_place_id" not in columns, sorted(columns)

                cur.execute("select count(*) from public.trips")
                assert cur.fetchone()[0] == trips_before  # 여행은 지우지 않는다
                cur.execute("select count(*) from public.trip_days")
                assert cur.fetchone()[0] == days_before
                cur.execute("select trip_id from public.trip_days where id = %s", (day_id,))
                assert cur.fetchone()[0] == rows[0][0]

                for trip_id, lodging_place_id, status, is_demo in rows:
                    cur.execute("select owner_id, city_code, start_date::text, end_date::text, status, is_demo, lodging from public.trips where id = %s", (trip_id,))
                    found = cur.fetchone()
                    assert found is not None, trip_id
                    assert found[:6] == (owner, "osaka", "2026-12-01", "2026-12-03", status, is_demo)
                    assert found[6] == (as_place(lodging_place_id) if lodging_place_id else None), (lodging_place_id, found[6])
        finally:
            conn.rollback()
