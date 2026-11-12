"""TASK-014 §B 위치 보호(NFR-10) · §C 연습 모드("이 날 미리 걸어 보기") · §6 실패 표 (서버).

근거: TASK-014 §B B1~B3·§C C3·C5·§6·§7 AC-2·AC-3, SRS NFR-10·FR-11, TASK-007 B-4(check 본문 {at, lat, lng})·§6·§11 Q7(오래됨 = 그날 마지막 check의 at),
TASK-006 §11 Q9(접근 로그에 위치가 남는 문제), TASK-012 A3(요청 하나 = 트랜잭션 하나)·S4(로그·오류 응답에 값 0 검사 방식)·§T(DB 테스트는 로컬만).
B4(앱 기기 저장소)는 앱 테스트(apps/mobile/__tests__/task-014-location.test.tsx).

계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
    연습 요청 = 같은 길 POST /days/{day_id}/check, **본문**에 "rehearsal": true (TASK-014 C3 표기를 본문 칸으로 읽음. 주소창에 두지 않음)
        응답은 실제 check와 같은 NowView. 사건·제안의 id(event_id·proposal_id)는 새로 만든 값이라 비교에서 자리 이름으로 바꾼다
        rehearsal을 빼거나 false면 지금과 같은 실제 check
    B1: check 주소창(쿼리)에 lat 또는 lng 칸이 있으면(값이 비어도) 400 공통 오류 형식 {"error": {code, message, detail}}. code 값은 정하지 않는다
    "DB가 같다" = app.state의 snapshot() 가진 저장소 전부(trip_helpers.stores) + 그래프 체크포인트 글자(checkpoints_text) + (Postgres) public 스키마의 모든 표 내용
    실제 여행 = POST /trips로 만든 오사카 여행(가짜 장소), 계획 완료 날 = 자동 계획 -> 첫 안 고르기 (Osaka.plan_and_select)
"""

import logging
import os
import re
import warnings
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from auth_helpers import bearer
from conftest import TEST_DB_ENV
from storage_helpers import KINDS, server_env
from test_task010_trips import Osaka
from trip_helpers import P01, checkpoints_text, plain_day, stores

ME, YOU = "user-A", "user-B"
NEAR_OFFSET, FAR_OFFSET = 7, 7 + 7 * 24  # FAR = 같은 요일, 168일 뒤 (만들 수 있는 최대 180일 안)
# 장소 좌표와 겹치지 않는 자리: 장소에서 북쪽 약 24m·동쪽 약 31m (감지 반경 150m 안, TASK-007 A1). 소수 자리가 장소 좌표와 다르다
D_LAT, D_LNG = 0.000213, 0.000341
FAR_AWAY = (34.123457, 135.987653)  # 어느 장소에서도 먼 자리 (이동 중으로 본다)


# ---------- 도우미 ----------


def open_server(app, user: str = ME, raise_errors: bool = True) -> TestClient:
    return TestClient(app, raise_server_exceptions=raise_errors, headers=bearer(user))


def planned_day(osaka: Osaka, offset: int = NEAR_OFFSET, user: str = ME) -> tuple[str, str]:
    """계획 완료(코스를 고른) 날 하나: 자동 계획 -> 첫 안 고르기 (Osaka.plan_and_select와 같고 사용자만 정한다). (day_id, 'YYYY-MM-DD')."""
    trip = osaka.make_trip(days=2, offset=offset, device=user)
    day = trip["trip_days"][0]
    started = osaka.client.post(f"/days/{day['day_id']}/planning", json={"mode": "auto"}, headers=bearer(user))
    assert started.status_code == 201, started.text
    option = started.json()["options"][0]["option_id"]
    chosen = osaka.client.post(f"/course-options/{option}/select", headers=bearer(user))
    assert chosen.status_code == 200, chosen.text
    return day["day_id"], day["date"]


def hhmm_plus(value: str, minutes: int) -> str:
    total = int(value[:2]) * 60 + int(value[3:5]) + minutes
    return f"{total // 60:02d}:{total % 60:02d}"


def at_of(date: str, hhmm: str) -> str:
    return f"{date}T{hhmm}:00"


def now_view(client: TestClient, day_id: str, date: str, hhmm: str = "12:00", user: str = ME) -> dict:
    response = client.get(f"/days/{day_id}/now", params={"at": at_of(date, hhmm)}, headers=bearer(user))
    assert response.status_code == 200, response.text
    return response.json()


def late_input(client: TestClient, day_id: str, date: str, late_min: int = 20, user: str = ME) -> tuple[str, tuple[float, float]]:
    """다음 장소가 있는 첫 장소에 머문 채로, 다음 장소로 떠날 예정 시각(다음 시작 - 이동)보다 late_min분 늦은 시각과 그 위치.
    TASK-007 A3·A4: 10분 이상 늦으면 사건(낮음), 20분 이상이면 높음(대안·interrupt)."""
    pins = now_view(client, day_id, date, user=user)["pins"]
    assert len(pins) >= 2, "시험 자체 확인: 코스에 장소가 둘 이상"
    here, following = pins[0], pins[1]
    leave = hhmm_plus(following["start"], -following["travel_min"])
    return at_of(date, hhmm_plus(leave, late_min)), (round(here["lat"] + D_LAT, 6), round(here["lng"] + D_LNG, 6))


def body(at: str, position: tuple[float, float] | None, rehearsal: bool | None = None) -> dict:
    out: dict = {"at": at}
    if position is not None:
        out["lat"], out["lng"] = position
    if rehearsal is not None:
        out["rehearsal"] = rehearsal
    return out


def check(client: TestClient, day_id: str, at: str, position=None, rehearsal: bool | None = None, query: str = "", user: str = ME):
    return client.post(f"/days/{day_id}/check{query}", json=body(at, position, rehearsal), headers=bearer(user))


def rehearse(client: TestClient, day_id: str, at: str, position=None, user: str = ME) -> dict:
    response = check(client, day_id, at, position, rehearsal=True, user=user)
    assert response.status_code == 200, response.text
    return response.json()


def real(client: TestClient, day_id: str, at: str, position=None, user: str = ME) -> dict:
    response = check(client, day_id, at, position, user=user)
    assert response.status_code == 200, response.text
    return response.json()


ID_KEYS = ("event_id", "proposal_id")


def same_shape(view: dict) -> dict:
    """사건·제안 id는 새로 만든 uuid라 나온 순서대로 자리 이름(id-0, id-1 ...)으로 바꾼다. 나머지는 글자 그대로."""
    names: dict[str, str] = {}

    def walk(value):
        if isinstance(value, dict):
            return {k: (names.setdefault(v, f"id-{len(names)}") if k in ID_KEYS and isinstance(v, str) else walk(v)) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    return walk(view)


def db_tables() -> dict[str, list[str]]:
    """Postgres public 스키마의 모든 표 -> 줄 글자(정렬). 연습 전후 비교용 (TASK-014 C3 "모든 표")."""
    import psycopg

    url = os.environ[TEST_DB_ENV]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
        names = [row[0] for row in cur.fetchall()]
        out = {}
        for name in names:
            cur.execute(f'select * from public."{name}"')  # noqa: S608 (표 이름은 DB가 준 목록)
            out[name] = sorted(repr(row) for row in cur.fetchall())
        return out


def everything(osaka: Osaka, kind: str) -> dict:
    found = {"stores": stores(osaka), "checkpoints": checkpoints_text(osaka)}
    if kind == "postgres":
        found["tables"] = db_tables()
    return found


def texts_of(value: float) -> list[str]:
    """좌표 한 값이 글자로 찍힐 수 있는 모양들 (TASK-007 AC-9 has_position과 같은 생각)."""
    return [repr(value), str(value), f"{value:.6f}", f"{value:.5f}"]


def leaks(text: str, position: tuple[float, float]) -> list[str]:
    return [t for v in position for t in texts_of(v) if t in text]


@pytest.fixture
def world(monkeypatch, request):
    """kind = memory | postgres. 서버를 켜고 ME의 Osaka 도우미를 준다."""
    from api.main import app

    kind = request.param
    server_env(monkeypatch, kind)
    with open_server(app) as client:
        yield kind, client, Osaka(client, app)


WORLDS = pytest.mark.parametrize("world", KINDS, indirect=True)


@pytest.fixture
def mem(monkeypatch):
    """메모리 저장소 서버 하나 (ME의 Bearer가 기본 헤더)."""
    from api.main import app

    server_env(monkeypatch, "memory")
    with open_server(app) as client:
        yield Osaka(client, app)


# =====================================================================
# §B1 위치는 본문으로만: 주소창(쿼리)에 lat·lng가 오면 400
# =====================================================================

QUERIES = [
    ("?lat=34.987654&lng=135.123457", "lat_lng_둘_다"),
    ("?lat=34.987654", "lat만"),
    ("?lng=135.123457", "lng만"),
    ("?lat=", "lat_빈_값"),
    ("?at=2026-12-08T12:00:00&lat=34.987654&lng=135.123457", "다른_칸과_함께"),
]


@WORLDS
@pytest.mark.parametrize("query", [q for q, _ in QUERIES], ids=[i for _, i in QUERIES])
@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_B1_check_주소창에_lat·lng가_오면_400_공통_오류이고_저장소는_그대로(world, query, rehearsal):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    before = everything(osaka, kind)
    response = check(client, day_id, at, position, rehearsal=rehearsal, query=query)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert isinstance(error["code"], str) and error["message"]
    assert not leaks(response.text, (34.987654, 135.123457)), "오류 응답에 쿼리 좌표가 실렸다 (B3)"
    assert everything(osaka, kind) == before, "400인데 무언가 저장됐다"


@WORLDS
def test_T14_B1_경계_본문의_위치는_그대로_200(world):
    # 같은 위치를 본문으로만 보내면 지금처럼 된다 (TASK-007 B-4). B1이 본문 위치까지 막으면 안 된다
    _kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    view = real(client, day_id, at, position)
    assert view["position"] == {"lat": position[0], "lng": position[1]}


def test_T14_B1_경계_lat·lng가_아닌_쿼리_칸은_400이_아니다(mem):
    # B1은 lat·lng 칸만 말한다. 아무 칸이나 막지는 않는다 (문서에 없는 규칙을 만들지 않으려고 최소만 고정)
    day_id, date = planned_day(mem)
    response = check(mem.client, day_id, at_of(date, "12:00"), None, query="?debug=1")
    assert response.status_code == 200, response.text


# =====================================================================
# §B2 DB에 위치 0: 위치 열·표 없음 + trip_events에도 좌표 없음 (결과만)
# =====================================================================


def test_T14_B2_마이그레이션_어느_표에도_위치_열이_없다_TASK_014_뒤에도():
    # TASK-012 A6 검사 도구를 그대로 쓴다: TASK-014가 새 마이그레이션을 더해도 이 검사가 함께 읽는다
    from test_task012_schema import LOCATION_NAME, LOCATION_TYPE, schema

    found = [
        f"{table}.{column}"
        for table, entry in schema().items()
        for column, kind in entry["columns"].items()
        if LOCATION_NAME.search(column) or LOCATION_TYPE.search(kind)
    ]
    assert found == []


def test_T14_B2_위치_뜻의_표가_없다():
    from test_task012_schema import schema

    names = sorted(schema())
    assert not [n for n in names if re.search(r"(^|_)(location|locations|position|positions|track|tracks|trace|traces|route_log|gps)($|_)", n)], names


def test_T14_B2_trip_events_열에_좌표가_없다():
    from test_task012_schema import LOCATION_NAME, schema

    columns = schema()["trip_events"]["columns"]
    assert not [c for c in columns if LOCATION_NAME.search(c)], sorted(columns)


@WORLDS
def test_T14_B2_늦어짐_사건을_만들어도_저장소·체크포인트·DB_어디에도_보낸_좌표가_없다(world):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    view = real(client, day_id, at, position)
    assert view["event"] is not None and view["event"]["state"] == "awaiting"  # 시험 자체 확인: 위치로 사건이 생겼다
    real(client, day_id, at_of(date, hhmm_plus(at[11:16], 5)), position)
    found = everything(osaka, kind)
    assert found["stores"]["trip_repo"], "시험 자체 확인: 사건 저장소가 비어 있지 않다"
    assert not leaks(repr(found), position)


@WORLDS
def test_T14_B2_사건에는_결과만_남는다_delay_min은_있고_좌표는_없다(world):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    view = real(client, day_id, at, position)
    events = repr(stores(osaka)["trip_repo"])
    assert str(view["event"]["delay_min"]) in events  # 결과(늦은 분)는 남는다
    assert not leaks(events, position)


# =====================================================================
# §B3 로그·오류 응답·개발 경고에 좌표 0 (TASK-012 S4와 같은 방식: 모든 기록의 글자를 훑는다)
# =====================================================================

CLIENT_LOGGERS = ("httpx", "httpx2")  # 테스트 클라이언트 자신의 요청 기록 (서버 로그가 아니다)


def server_messages(caplog) -> list[str]:
    out = []
    for record in caplog.records:
        if record.name.split(".")[0] in CLIENT_LOGGERS:
            continue
        out.append(record.getMessage())
        if record.exc_info:
            out.append(logging.Formatter().formatException(record.exc_info))
    return out


@WORLDS
@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_B3_정상_check의_서버_로그·경고에_좌표가_없다(world, caplog, rehearsal):
    _kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    caplog.set_level(logging.DEBUG)
    with warnings.catch_warnings(record=True) as warned:
        warnings.simplefilter("always")
        for minutes in (0, 5, 30):
            response = check(client, day_id, at_of(date, hhmm_plus(at[11:16], minutes)), position, rehearsal=rehearsal)
            assert response.status_code == 200, response.text
    texts = server_messages(caplog) + [str(w.message) for w in warned]
    assert not [t for t in texts if leaks(t, position)]


BAD_BODIES = [
    ({"at": "아무말", "lat": 34.987654, "lng": 135.123457}, "at_형식_오류"),
    ({"at": "2026-12-08T12:00:00", "lat": 90.123457, "lng": 135.123457}, "위도_범위_밖"),
    ({"at": "2026-12-08T12:00:00", "lat": 34.987654, "lng": 180.123457}, "경도_범위_밖"),
    ({"at": "2026-12-08T12:00:00", "lat": 34.987654}, "lng_없음"),
    ({"at": "2030-01-01T12:00:00", "lat": 34.987654, "lng": 135.123457}, "그날이_아닌_at"),
]


@WORLDS
@pytest.mark.parametrize("payload", [b for b, _ in BAD_BODIES], ids=[i for _, i in BAD_BODIES])
@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_B3_오류_응답과_로그에_보낸_좌표가_없다(world, caplog, payload, rehearsal):
    _kind, client, osaka = world
    day_id, _date = planned_day(osaka)
    sent = dict(payload)
    if rehearsal:
        sent["rehearsal"] = True
    caplog.set_level(logging.DEBUG)
    response = client.post(f"/days/{day_id}/check", json=sent)
    assert response.status_code == 400, response.text
    values = tuple(v for k, v in sent.items() if k in ("lat", "lng"))
    texts = [response.text, *server_messages(caplog)]
    assert not [t for t in texts if leaks(t, values)]  # type: ignore[arg-type]


@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_B3_없는_날_404의_응답·로그에_좌표가_없다(mem, caplog, rehearsal):
    caplog.set_level(logging.DEBUG)
    position = (34.987654, 135.123457)
    response = check(mem.client, "day-없음", "2026-12-08T12:00:00", position, rehearsal=rehearsal)
    assert response.status_code == 404, response.text
    assert not [t for t in [response.text, *server_messages(caplog)] if leaks(t, position)]


@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_B3_대안_계산_중_예외_500의_응답·로그·예외_기록에_좌표가_없다(monkeypatch, caplog, rehearsal):
    from api.main import app

    server_env(monkeypatch, "memory")
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        day_id, date = planned_day(osaka)
        at, position = late_input(client, day_id, date)
        before = everything(osaka, "memory")

        def boom(*_a, **_k):
            raise RuntimeError("대안 계산 강제 예외 (시험)")

        monkeypatch.setattr("graphs.trip.compose_courses", boom)  # TASK-007 계약: 예외 주입 자리
        caplog.set_level(logging.DEBUG)
        response = check(client, day_id, at, position, rehearsal=rehearsal)
        assert response.status_code == 500, response.text
        assert not [t for t in [response.text, *server_messages(caplog)] if leaks(t, position)]
        assert everything(osaka, "memory") == before  # §6 (TASK-007): 요청 전 그대로


# =====================================================================
# §C3 연습 = 같은 계산 + 트랜잭션 되돌리기 (AC-3)
# =====================================================================


@WORLDS
def test_T14_C3_AC3_연습으로_늦어짐_사건·대안이_생겨도_연습_전후_DB가_같다(world):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    before = everything(osaka, kind)
    view = rehearse(client, day_id, at, position)
    assert view["event"] is not None and view["event"]["state"] == "awaiting" and view["event"]["proposals"]  # 시험 자체 확인: 쓰는 일이 있었다
    assert everything(osaka, kind) == before


@WORLDS
def test_T14_C3_AC3_연습을_여러_번_해도_DB가_같다_낮음·높음·위치_없음·먼_곳(world):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    late, position = late_input(client, day_id, date, late_min=20)
    low, _ = late_input(client, day_id, date, late_min=10)
    before = everything(osaka, kind)
    for at, where in [(low, position), (late, position), (late, None), (late, FAR_AWAY), (at_of(date, hhmm_plus(late[11:16], 30)), position)]:
        rehearse(client, day_id, at, where)
    assert everything(osaka, kind) == before


@WORLDS
@pytest.mark.parametrize("case", ["높음", "낮음", "위치_없음", "먼_곳", "아침"])
def test_T14_C3_AC3_같은_시각·위치면_연습과_실제의_응답이_같다(world, case):
    _kind, client, osaka = world
    day_id, date = planned_day(osaka)
    late, position = late_input(client, day_id, date, late_min=20)
    low, _ = late_input(client, day_id, date, late_min=10)
    at, where = {
        "높음": (late, position),
        "낮음": (low, position),
        "위치_없음": (late, None),
        "먼_곳": (late, FAR_AWAY),
        "아침": (at_of(date, "09:00"), position),
    }[case]
    practiced = rehearse(client, day_id, at, where)
    actual = real(client, day_id, at, where)
    assert same_shape(practiced) == same_shape(actual)


@WORLDS
def test_T14_C3_연습이_남긴_사건이_없어서_뒤의_실제_check는_처음부터_계산한다(world):
    # 연습(20분 늦음 -> awaiting)이 저장됐다면 그 뒤 실제 10분 늦음 check는 awaiting 그대로다 (TASK-007 상태 표).
    # 되돌렸다면 실제 check는 처음 보는 사건이라 open_low (같은 날에 연습 없이 한 것과 같다)
    _kind, client, osaka = world
    day_id, date = planned_day(osaka)
    late, position = late_input(client, day_id, date, late_min=20)
    low, _ = late_input(client, day_id, date, late_min=10)
    rehearse(client, day_id, late, position)
    after = real(client, day_id, low, position)
    assert after["event"] is not None
    assert after["event"]["state"] == "open_low"


def test_T14_C3_연습은_오래됨_기준인_그날_마지막_check_시각도_바꾸지_않는다(env):
    # TASK-007 §11 Q7: 오래됨 15분의 기준 = 그날 마지막 check의 at. 연습 check가 이 값을 바꾸면 실제 제안이 409 stale이 된다
    day_id = plain_day(env)
    first = env.client.post(f"/days/{day_id}/check", json={"at": "2026-12-02T12:20:00", "lat": P01[0], "lng": P01[1]})
    assert first.status_code == 200 and first.json()["event"]["state"] == "awaiting", first.text
    later = env.client.post(f"/days/{day_id}/check", json={"at": "2026-12-02T12:40:00", "lat": P01[0], "lng": P01[1], "rehearsal": True})
    assert later.status_code == 200, later.text
    accepted = env.client.post(f"/proposals/{first.json()['event']['proposals'][0]['proposal_id']}/accept")
    assert accepted.status_code == 200, accepted.text  # 연습의 12:40이 기준이었다면 20분 지남 -> 409 stale


@WORLDS
def test_T14_C3_rehearsal_false는_실제_check와_같다_저장된다(world):
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    before = everything(osaka, kind)
    response = check(client, day_id, at, position, rehearsal=False)
    assert response.status_code == 200, response.text
    assert everything(osaka, kind) != before  # 경계: 연습이 아니면 사건이 남는다


def test_T14_C3_속성_어느_시각·위치로_연습해도_저장소는_그대로(mem):
    osaka = mem
    day_id, date = planned_day(osaka)
    pins = now_view(osaka.client, day_id, date)["pins"]
    spots = [None, FAR_AWAY, *[(round(p["lat"] + D_LAT, 6), round(p["lng"] + D_LNG, 6)) for p in pins]]
    before = everything(osaka, "memory")

    @settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(minute=st.integers(min_value=0, max_value=23 * 60 + 59), spot=st.sampled_from(spots))
    def run(minute: int, spot):
        rehearse(osaka.client, day_id, at_of(date, f"{minute // 60:02d}:{minute % 60:02d}"), spot)
        assert everything(osaka, "memory") == before

    run()


# =====================================================================
# §C5 영업시간은 그 요일 값, 먼 미래여도 같음. 출처·확인 상태도 실제와 같게
# =====================================================================


def facts_by_place(view: dict) -> dict[str, list]:
    out: dict[str, list] = {}

    def walk(value):
        if isinstance(value, dict):
            if value.get("place_id") and "facts" in value:
                out.setdefault(value["place_id"], value["facts"])
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(view)
    return out


@WORLDS
def test_T14_C5_연습_응답의_장소_facts는_실제와_같다_값·출처·확인_상태(world):
    _kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at = at_of(date, "11:00")
    practiced = facts_by_place(rehearse(client, day_id, at))
    actual = facts_by_place(real(client, day_id, at))
    assert practiced, "시험 자체 확인: 장소 facts가 있다"
    assert practiced == actual
    for facts in practiced.values():
        for fact in facts:
            assert fact["status"] in {"confirmed", "unverified", "unknown"}  # 확인 상태 필수 (절대 규칙 2)
            assert fact["source_type"]


def test_T14_C5_같은_요일이면_먼_미래_날의_연습도_영업시간이_같다(monkeypatch):
    from api.main import app

    server_env(monkeypatch, "memory")
    with open_server(app) as client:
        osaka = Osaka(client, app)
        near_id, near_date = planned_day(osaka, NEAR_OFFSET, ME)
        far_id, far_date = planned_day(osaka, FAR_OFFSET, YOU)
        assert datetime.fromisoformat(near_date).weekday() == datetime.fromisoformat(far_date).weekday()  # 시험 자체 확인
        assert (datetime.fromisoformat(far_date) - datetime.fromisoformat(near_date)) >= timedelta(days=150)
        near = facts_by_place(rehearse(client, near_id, at_of(near_date, "11:00"), user=ME))
        far = facts_by_place(rehearse(client, far_id, at_of(far_date, "11:00"), user=YOU))
        common = sorted(set(near) & set(far))
        assert common, "시험 자체 확인: 두 날에 같은 장소가 있다"
        hours = lambda facts: [(f["field"], f["value"], f["status"], f["source_type"]) for f in facts if f["field"] == "opening_hours"]  # noqa: E731
        assert {p: hours(near[p]) for p in common} == {p: hours(far[p]) for p in common}


# =====================================================================
# §6 실패 표
# =====================================================================


@pytest.mark.parametrize("rehearsal", [None, True], ids=["실제", "연습"])
def test_T14_S6_연습_중_서버_실패면_500이고_실제_여행은_그대로(monkeypatch, rehearsal):
    # §6 "연습 중 서버 실패 -> 실제 여행은 그대로". 실제 check의 같은 실패(TASK-007 §6)와 함께 둔다
    from api.main import app

    server_env(monkeypatch, "memory")
    with open_server(app, raise_errors=False) as client:
        osaka = Osaka(client, app)
        day_id, date = planned_day(osaka)
        at, position = late_input(client, day_id, date)
        before = everything(osaka, "memory")
        def boom(*_a, **_k):
            raise RuntimeError("대안 계산 강제 예외 (시험)")

        monkeypatch.setattr("graphs.trip.compose_courses", boom)
        response = check(client, day_id, at, position, rehearsal=rehearsal)
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "INTERNAL_ERROR"
        assert everything(osaka, "memory") == before


@WORLDS
def test_T14_S6_연습이_실수로_저장하려_해도_되돌린다_저장소를_직접_쓰는_길까지(world, monkeypatch):
    # §6 "연습 요청이 실수로 저장하려 함 -> 트랜잭션 되돌림". 연습 계산 중에 저장소에 사건을 하나 더 쓰게 끼워 넣어도 남지 않는다
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    repo_type = type(osaka.app.state.trip_repo)
    original = repo_type.put_event
    calls: list[int] = []

    def put_twice(self, record):
        calls.append(1)
        original(self, record)
        original(self, record)

    monkeypatch.setattr(repo_type, "put_event", put_twice)
    before = everything(osaka, kind)
    rehearse(client, day_id, at, position)
    assert calls, "시험 자체 확인: 연습 계산이 저장소 쓰기를 불렀다 (같은 계산)"
    assert everything(osaka, kind) == before


@WORLDS
def test_T14_S6_연습이_만든_제안_id로는_실제_반영할_수_없다(world):
    # 연습이 되돌려졌다면 그 제안은 실제 저장소에 없다 -> 404 proposal (TASK-007 B-4 실패). 실제 일정은 그대로
    kind, client, osaka = world
    day_id, date = planned_day(osaka)
    at, position = late_input(client, day_id, date)
    view = rehearse(client, day_id, at, position)
    before = everything(osaka, kind)
    proposal = view["event"]["proposals"][0]["proposal_id"]
    response = client.post(f"/proposals/{proposal}/accept")
    assert response.status_code == 404, response.text
    assert everything(osaka, kind) == before


# =====================================================================
# §10 Q2 B1 모든 길: 주소창에 lat·lng가 있으면 어느 길이든 400 (서버 앞단 한 곳)
# =====================================================================

QUERY_COORDS = (34.987654, 135.123457)
COORD_QUERY = f"lat={QUERY_COORDS[0]}&lng={QUERY_COORDS[1]}"
BODY_CODES = {"VALIDATION_ERROR", "INVALID_REQUEST"}  # §10 Q3: 서버에 이미 있는 본문 검증 400 code (새 code 없음)


def routes(osaka: Osaka) -> list[tuple[str, str, dict | None]]:
    """(메서드, 경로(쿼리 없이), 본문). 계획 완료 날 하나를 만들어 그 날·여행의 길을 고른다."""
    day_id, date = planned_day(osaka)
    trip_id = osaka.client.get("/trips/current").json()["trip_id"]
    return [
        ("GET", f"/days/{day_id}/now?at={at_of(date, '12:00')}&", None),
        ("POST", f"/days/{day_id}/check?", {"at": at_of(date, "12:00")}),
        ("GET", f"/days/{day_id}/course?", None),
        ("GET", "/trips/current?", None),
        ("GET", f"/trips/{trip_id}?", None),
        ("POST", "/places/osaka-fake-castle/visit-checks?", {"day_id": day_id, "at": at_of(date, "12:00"), "was_open": True}),
        ("GET", "/health?", None),
        ("GET", "/없는-길?", None),
    ]


ROUTE_IDS = ["GET_now", "POST_check", "GET_course", "GET_trips_current", "GET_trip", "POST_visit_checks", "GET_health", "없는_경로"]


def send(client: TestClient, method: str, path: str, payload):
    return client.request(method, path, json=payload) if payload is not None else client.request(method, path)


@pytest.mark.parametrize("index", range(len(ROUTE_IDS)), ids=ROUTE_IDS)
@pytest.mark.parametrize("query", [COORD_QUERY, f"lat={QUERY_COORDS[0]}", f"lng={QUERY_COORDS[1]}", "lat=&lng="], ids=["둘_다", "lat만", "lng만", "빈_값"])
def test_T14_Q2_B1_어느_길이든_주소창에_lat·lng가_있으면_400이고_저장은_0(mem, index, query):
    method, path, payload = routes(mem)[index]
    before = everything(mem, "memory")
    response = send(mem.client, method, path + query, payload)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] in BODY_CODES and error["message"]
    assert not leaks(response.text, QUERY_COORDS)
    assert everything(mem, "memory") == before


def test_T14_Q2_B1_400_code는_모든_길에서_하나다(mem):
    # "서버 앞단 한 곳에서" (§10 Q2) -> 길마다 다른 code가 나오지 않는다
    codes = {send(mem.client, m, p + COORD_QUERY, b).json()["error"]["code"] for m, p, b in routes(mem)}
    assert len(codes) == 1 and codes <= BODY_CODES, codes


@pytest.mark.parametrize("index", range(len(ROUTE_IDS) - 1), ids=ROUTE_IDS[:-1])
def test_T14_Q2_B1_경계_lat·lng가_없으면_같은_길은_400이_아니다(mem, index):
    method, path, payload = routes(mem)[index]
    response = send(mem.client, method, path.rstrip("?&"), payload)
    assert response.status_code != 400, response.text


# =====================================================================
# §10 Q2-1 접근 로그(uvicorn 요청 줄)에 쿼리 좌표 0
# 고른 방법: TestClient는 uvicorn을 거치지 않아 요청 줄이 찍히지 않는다. uvicorn은 요청 줄을 `uvicorn.access` 로거에
# '%s - "%s %s HTTP/%s" %d' (클라이언트, 메서드, 경로+쿼리, 판, 상태) 모양으로 남긴다 -> 서버가 켜진 뒤(lifespan) 그 로거에
# 같은 모양으로 남겨 서버가 단 거르개를 검사한다 (test_task010_carry E5와 같은 방식, 400 응답 줄·여러 모양으로 넓힘).
# 실제 줄 모양은 test-writer가 8010에 서버를 잠깐 띄워 한 번 확인했다 (커밋하지 않음, 보고서에 적음).
# =====================================================================

ACCESS_PATHS = [
    (f"/days/d1/now?at=2026-12-08T12:00:00&{COORD_QUERY}", "GET_now"),
    (f"/days/d1/check?{COORD_QUERY}", "POST_check_쿼리"),
    (f"/health?{COORD_QUERY}", "health"),
    (f"/없는-길?{COORD_QUERY}", "없는_경로"),
    (f"/trips/current?LAT={QUERY_COORDS[0]}&Lng={QUERY_COORDS[1]}", "대소문자"),
    (f"/trips/current?lat={QUERY_COORDS[0]}&lat={QUERY_COORDS[0]}&lng={QUERY_COORDS[1]}", "같은_칸_두_번"),
    (f"/trips/current?x=1&lng={QUERY_COORDS[1]}&lat={QUERY_COORDS[0]}#frag", "순서_바뀜"),
]


@pytest.mark.parametrize("path", [p for p, _ in ACCESS_PATHS], ids=[i for _, i in ACCESS_PATHS])
@pytest.mark.parametrize("status", [400, 200, 404])
def test_T14_Q2_1_접근_로그_요청_줄에_쿼리_좌표가_없다(mem, caplog, path, status):
    caplog.set_level(logging.DEBUG)
    method = "POST" if "check" in path else "GET"
    logging.getLogger("uvicorn.access").info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:50000", method, path, "1.1", status)
    lines = [r.getMessage() for r in caplog.records if r.name == "uvicorn.access"]
    assert lines, "시험 자체 확인: 요청 줄은 남는다"
    assert path.split("?")[0] in lines[0]  # 경로는 남고
    assert not [line for line in lines if leaks(line, QUERY_COORDS)]  # 좌표 값만 없다


def test_T14_Q2_1_실제_요청의_400도_서버_로그에_쿼리_좌표가_없다(mem, caplog):
    # TestClient 길로 갈 수 있는 서버 로그 전부(앱 로거). 테스트 클라이언트 자신의 기록(httpx)은 서버 로그가 아니라 뺀다
    caplog.set_level(logging.DEBUG)
    for method, path, payload in routes(mem):
        send(mem.client, method, path + COORD_QUERY, payload)
    assert not [t for t in server_messages(caplog) if leaks(t, QUERY_COORDS)]


# =====================================================================
# §10 Q5 [닫혔어] 뒤 대안 계산도 연습이면 되돌린다: POST /places/{place_id}/visit-checks 본문 rehearsal: true
# =====================================================================


def closed_rehearsal(env, rehearsal: bool | None):
    """닫혔어 한 번 (rehearsal None = 칸 없음)."""
    from test_task008_visit import ALTS, visit_check, visit_day

    day_id = visit_day(env, extra=ALTS)
    extra = {} if rehearsal is None else {"rehearsal": rehearsal}
    return day_id, visit_check(env, day_id, "P02", "11:40", False, **extra)


def test_T14_Q5_연습의_닫혔어는_대안을_계산하고_전후_저장소가_같다(env):
    from test_task008_visit import ALTS, visit_check, visit_day

    day_id = visit_day(env, extra=ALTS)
    before = everything(env, "memory")
    response = visit_check(env, day_id, "P02", "11:40", False, rehearsal=True)
    assert response.status_code == 200, response.text
    assert response.json()["main"]["type"] == "T-06"  # 같은 계산: 닫힘 대안이 나온다
    assert everything(env, "memory") == before
    assert env.app.state.trip_repo.get_visit_check(day_id, "P02") is None  # 사용자 확인(영업 사실)도 남지 않는다


def test_T14_Q5_같은_입력이면_연습과_실제의_닫혔어_응답이_같다(env):
    from test_task008_visit import ALTS, visit_check, visit_day

    day_id = visit_day(env, extra=ALTS)
    practiced = visit_check(env, day_id, "P02", "11:40", False, rehearsal=True)
    actual = visit_check(env, day_id, "P02", "11:40", False)
    assert practiced.status_code == 200 and actual.status_code == 200
    assert same_shape(practiced.json()) == same_shape(actual.json())


def test_T14_Q5_경계_rehearsal_없는_닫혔어는_저장된다(env):
    day_id, response = closed_rehearsal(env, None)
    assert response.status_code == 200, response.text
    assert env.app.state.trip_repo.get_visit_check(day_id, "P02") is not None


def test_T14_Q5_연습의_닫혔어_대안_계산이_실패해도_500이고_그대로(quiet_visit_env, monkeypatch):
    from test_task008_visit import ALTS, visit_check, visit_day

    env = quiet_visit_env
    day_id = visit_day(env, extra=ALTS)
    before = everything(env, "memory")

    def boom(*_a, **_k):
        raise RuntimeError("대안 계산 강제 예외 (시험)")

    monkeypatch.setattr("trip.service.TripService.visit_check", boom)
    response = visit_check(env, day_id, "P02", "11:40", False, rehearsal=True)
    assert response.status_code == 500
    assert everything(env, "memory") == before


@pytest.fixture
def quiet_visit_env(env):
    from auth_helpers import TESTER

    env.client = TestClient(env.app, headers=bearer(TESTER), raise_server_exceptions=False)
    return env
