"""TASK-012 A2: 메모리 저장소와 같은 인터페이스의 Postgres 구현.

계약 테스트(tests/test_task012_contract.py)가 메모리·Postgres 두 구현에 같은 테스트를 돌린다.
연결 주소는 생성자 인자 `url` (서버는 환경 변수 DATABASE_URL, 테스트는 TEST_DATABASE_URL에서 읽는다).
§10 Q1: DB에는 place_id(와 우리 장소 id)만 둔다. 읽을 때 장소·좌표는 도시 데이터(city: 팩 + 좌표 캐시 + 영업시간 메모리)에서
`clock()` 시각으로 되살린다 -> 계획 저장소 생성자가 city·clock을 받는다.
예외: 개발용 데모 여행의 가상 장소(도시 팩에 없음, source demo)는 그 날 행의 `demo` 칸에 둔다 (실제 Google 값 아님).

표 모양은 supabase/migrations/. 요청 안에서는 그 요청의 트랜잭션을 쓴다 (store.unit).
"""

import json
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.types.json import Jsonb

from engine.models import CourseItem, CourseOption, DayPlan, Dropped, Place, PlaceId, PlanFixed, Reactions
from places.city import CityData
from planning.repo import DayRecord, OptionRecord, PlanningRepo, ReactionAction, _apply_reaction
from store.unit import Database
from trip.repo import ClosedInfo, EventRecord, ProposalRecord, TripRepo
from trip.store import FixedRow, TripRow, TripStore
from trip.visit import VisitCheckRecord


def _uid(value: Any) -> str | None:
    """uuid 모양이 아니면 None (DB가 형식 오류를 내지 않고 '없음'이 되게)."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def _jsonb_text(value: Any) -> Jsonb:
    """사용자가 쓴 글이 들어갈 수 있는 JSON. Postgres jsonb는 NUL 글자(\\u0000)를 못 받아 뺀다."""
    return Jsonb(value, dumps=lambda obj: json.dumps(obj, ensure_ascii=False).replace("\\u0000", ""))


def _dump_table(cur: Any, table: str, order: str) -> list[dict[str, Any]]:
    cur.execute(f"select to_jsonb(t) as r from {table} t order by {order}")  # noqa: S608 (표 이름은 이 파일의 고정 값)
    return [row["r"] for row in cur.fetchall()]


class PostgresPlanningRepo(PlanningRepo):
    def __init__(self, url: str, city: CityData, clock: Callable[[], datetime]) -> None:
        self._db = Database(url)
        self._city = city
        self._clock = clock
        self._pack_ids = {row["id"] for row in city.pack["places"]}

    # ---- 하루·여행 ----

    def save_day(
        self,
        day_id: str,
        plan: DayPlan,
        places: dict[PlaceId, Place],
        day_number: int = 1,
        *,
        lodging_known: bool = True,
        sources: dict[PlaceId, str] | None = None,
    ) -> None:
        did = _uid(day_id)
        if did is None:
            raise ValueError("day_id는 uuid여야 해요")
        demo = None
        if any(pid not in self._pack_ids for pid in places):  # 도시 팩에 없는 장소 = 데모의 가상 장소
            demo = {"places": {pid: p.model_dump(mode="json") for pid, p in places.items()}, "lodging": list(plan.lodging)}
        fixed = [{"id": f.id, "title": f.title, "start": f.start, "end": f.end, "place_id": f.place_id} for f in plan.fixed]  # 좌표는 두지 않는다
        with self._db.cursor() as cur:
            cur.execute(
                """insert into trip_days (id, day, day_number, start_time, end_time, lodging_known, place_ids, sources_known, plan_fixed, stay_overrides, demo)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (id) do update set day = excluded.day, day_number = excluded.day_number, start_time = excluded.start_time,
                       end_time = excluded.end_time, lodging_known = excluded.lodging_known, place_ids = excluded.place_ids,
                       sources_known = excluded.sources_known, plan_fixed = excluded.plan_fixed, stay_overrides = excluded.stay_overrides,
                       demo = excluded.demo""",
                (did, plan.date, day_number, plan.start, plan.end, lodging_known, Jsonb(list(places)), sources is not None, Jsonb(fixed),
                 Jsonb(dict(plan.stay_overrides)), Jsonb(demo) if demo is not None else None),
            )
            self._write_must(cur, did, plan.must_visit)

    @staticmethod
    def _write_must(cur: Any, day_id: str, must: list[PlaceId]) -> None:
        cur.execute("delete from must_visits where trip_day_id = %s", (day_id,))
        for slot, place_id in enumerate(must):
            cur.execute(
                "insert into must_visits (trip_day_id, slot, trip_id, place_id) select %s, %s, trip_id, %s from trip_days where id = %s",
                (day_id, slot, place_id, day_id),
            )

    def get_day(self, day_id: str) -> DayRecord | None:
        did = _uid(day_id)
        if did is None:
            return None
        with self._db.cursor() as cur:
            cur.execute(
                "select td.*, t.lodging_place_id from trip_days td left join trips t on t.id = td.trip_id where td.id = %s", (did,)
            )
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute("select place_id from must_visits where trip_day_id = %s order by slot", (did,))
            must = [r["place_id"] for r in cur.fetchall()]
        return self._record(row, must)

    def _record(self, row: dict[str, Any], must: list[PlaceId]) -> DayRecord:
        now = self._clock()
        demo = row["demo"]
        sources: dict[PlaceId, str] | None = None
        if demo is not None:
            places = {pid: Place.model_validate(p) for pid, p in demo["places"].items()}
            lodging = (float(demo["lodging"][0]), float(demo["lodging"][1]))
        else:
            all_places, all_sources = self._city.places_now(now)
            ids = row["place_ids"]
            places = {pid: all_places[pid] for pid in ids if pid in all_places}
            if row["sources_known"]:
                sources = {pid: all_sources[pid] for pid in ids if pid in all_sources}
            lodging = self._lodging(row, now)
        fixed = [
            PlanFixed(
                id=f["id"], title=f["title"], start=f["start"], end=f["end"], place_id=f["place_id"],
                lat=places[f["place_id"]].lat if f["place_id"] in places else None,
                lng=places[f["place_id"]].lng if f["place_id"] in places else None,
            )
            for f in row["plan_fixed"]
        ]
        plan = DayPlan(
            date=row["day"], start=row["start_time"], end=row["end_time"], lodging=lodging, fixed=fixed, must_visit=must,
            stay_overrides={k: int(v) for k, v in row["stay_overrides"].items()},
        )
        return DayRecord(plan, places, row["day_number"], row["lodging_known"], sources)

    def _lodging(self, row: dict[str, Any], now: datetime) -> tuple[float, float]:
        """숙소 좌표는 좌표 캐시(30일)에서. 숙소가 없거나 못 구하면 도시 중심 (TASK-010 §9 Q10)."""
        if row["lodging_known"] and row["lodging_place_id"]:
            found = self._city.lodging_location(row["lodging_place_id"], now)
            if found is not None:
                return found
        return self._city.center()

    def replace_must_visit(self, day_id: str, old: PlaceId, new: PlaceId) -> None:
        did = _uid(day_id)
        with self._db.cursor() as cur:
            cur.execute("select 1 from trip_days where id = %s", (did,))
            if did is None or cur.fetchone() is None:
                raise KeyError(day_id)
            cur.execute("select place_id from must_visits where trip_day_id = %s order by slot", (did,))
            must = [new if r["place_id"] == old else r["place_id"] for r in cur.fetchall()]
            self._write_must(cur, did, list(dict.fromkeys(must)))

    def save_trip(self, trip_id: str, day_ids: list[str]) -> None:
        """날들을 여행에 붙인다. 여행 행(주인이 있는)이 아직 없으면 붙일 것이 없다 (여행 행은 TripStore.add_trip이 날을 붙이며 만든다)."""
        tid = _uid(trip_id)
        ids = [d for d in (_uid(x) for x in day_ids) if d is not None]
        if tid is None or not ids:
            return
        with self._db.cursor() as cur:
            cur.execute("update trip_days set trip_id = %s where id = any(%s::uuid[]) and exists (select 1 from trips where id = %s)", (tid, ids, tid))
            cur.execute("update must_visits set trip_id = %s where trip_day_id = any(%s::uuid[]) and exists (select 1 from trips where id = %s)", (tid, ids, tid))

    # ---- 세션 ----

    def create_session(self, session_id: str, day_id: str) -> None:
        sid, did = _uid(session_id), _uid(day_id)
        if sid is None or did is None:
            raise ValueError("session_id·day_id는 uuid여야 해요")
        with self._db.cursor() as cur:
            cur.execute(
                """insert into planning_sessions (id, trip_day_id) values (%s, %s)
                   on conflict (id) do update set trip_day_id = excluded.trip_day_id, batch_relaxed = false, batch_first = false, stay_overrides = '{}'""",
                (sid, did),
            )
            cur.execute("delete from reactions where session_id = %s", (sid,))

    def session_day(self, session_id: str) -> str | None:
        sid = _uid(session_id)
        if sid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select trip_day_id from planning_sessions where id = %s", (sid,))
            row = cur.fetchone()
        return str(row["trip_day_id"]) if row else None

    # ---- 반응 ----

    def _lists(self, session_id: str) -> tuple[list[PlaceId], list[PlaceId], list[PlaceId]]:
        sid = _uid(session_id)
        found: dict[str, list[PlaceId]] = {"like": [], "skip": [], "unlike": []}
        if sid is not None:
            with self._db.cursor() as cur:
                cur.execute("select place_id, action from reactions where session_id = %s order by seq", (sid,))
                for row in cur.fetchall():
                    found[row["action"]].append(row["place_id"])
        return found["like"], found["skip"], found["unlike"]

    def _store_lists(self, session_id: str, liked: list[PlaceId], skipped: list[PlaceId], unliked: list[PlaceId]) -> None:
        sid = _uid(session_id)
        with self._db.cursor() as cur:
            cur.execute("delete from reactions where session_id = %s", (sid,))
            for action, items in (("like", liked), ("skip", skipped), ("unlike", unliked)):
                for seq, place_id in enumerate(items):
                    cur.execute("insert into reactions (session_id, place_id, action, seq) values (%s, %s, %s, %s)", (sid, place_id, action, seq))

    def reactions(self, session_id: str) -> Reactions:
        liked, skipped, _ = self._lists(session_id)
        return Reactions(liked=liked, skipped=skipped)

    def reactions_after_react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> Reactions:
        liked, skipped, _ = _apply_reaction(*self._lists(session_id), place_id, action)
        return Reactions(liked=liked, skipped=skipped)

    def react(self, session_id: str, place_id: PlaceId, action: ReactionAction) -> None:
        self._store_lists(session_id, *_apply_reaction(*self._lists(session_id), place_id, action))

    @staticmethod
    def _unreacted(lists: tuple[list[PlaceId], list[PlaceId], list[PlaceId]], batch: list[PlaceId]) -> list[PlaceId]:
        reacted = {*lists[0], *lists[1], *lists[2]}
        return [place_id for place_id in batch if place_id not in reacted]

    def reactions_after_skip(self, session_id: str, batch: list[PlaceId]) -> Reactions:
        lists = self._lists(session_id)
        return Reactions(liked=lists[0], skipped=[*lists[1], *self._unreacted(lists, batch)])

    def skip_unreacted(self, session_id: str, batch: list[PlaceId]) -> None:
        liked, skipped, unliked = self._lists(session_id)
        skipped = [*skipped, *self._unreacted((liked, skipped, unliked), batch)]
        self._store_lists(session_id, liked, skipped, unliked)

    # ---- 묶음의 성질 ----

    def _set_session(self, session_id: str, column: str, value: Any) -> None:
        sid = _uid(session_id)
        with self._db.cursor() as cur:
            cur.execute(f"update planning_sessions set {column} = %s where id = %s", (value, sid))  # noqa: S608 (열 이름은 이 파일의 고정 값)

    def _get_session(self, session_id: str, column: str, default: Any) -> Any:
        sid = _uid(session_id)
        if sid is None:
            return default
        with self._db.cursor() as cur:
            cur.execute(f"select {column} as v from planning_sessions where id = %s", (sid,))  # noqa: S608
            row = cur.fetchone()
        return row["v"] if row else default

    def save_batch_relaxed(self, session_id: str, relaxed: bool) -> None:
        self._set_session(session_id, "batch_relaxed", relaxed)

    def batch_relaxed(self, session_id: str) -> bool:
        return bool(self._get_session(session_id, "batch_relaxed", False))

    def save_batch_first(self, session_id: str, first: bool) -> None:
        self._set_session(session_id, "batch_first", first)

    def batch_first(self, session_id: str) -> bool:
        return bool(self._get_session(session_id, "batch_first", False))

    # ---- 머무는 시간 ----

    def stay_overrides(self, session_id: str) -> dict[PlaceId, int]:
        return {k: int(v) for k, v in self._get_session(session_id, "stay_overrides", {}).items()}

    def set_stay_override(self, session_id: str, place_id: PlaceId, minutes: int) -> None:
        sid = _uid(session_id)
        with self._db.cursor() as cur:
            cur.execute(
                "update planning_sessions set stay_overrides = stay_overrides || jsonb_build_object(%s::text, %s::int) where id = %s",
                (place_id, minutes, sid),
            )

    # ---- 코스안과 선택 ----

    def save_options(self, records: list[OptionRecord]) -> None:
        with self._db.cursor() as cur:
            for record in records:
                oid, sid = _uid(record.option_id), _uid(record.session_id)
                course = record.course
                cur.execute(
                    """insert into course_options (id, session_id, label, picks, dropped, go_home_min, total_travel_min)
                       values (%s, %s, %s, %s, %s, %s, %s)
                       on conflict (id) do update set session_id = excluded.session_id, label = excluded.label, picks = excluded.picks,
                           dropped = excluded.dropped, go_home_min = excluded.go_home_min, total_travel_min = excluded.total_travel_min""",
                    (oid, sid, course.label, Jsonb(list(record.picks)), Jsonb([d.model_dump() for d in course.dropped]), course.go_home_min, course.total_travel_min),
                )
                cur.execute("delete from course_items where option_id = %s", (oid,))
                for item in course.items:
                    cur.execute(
                        """insert into course_items (option_id, seq, place_id, start_at, end_at, stay_min, stay_source, travel_min, wait_min, is_fixed, hours_status)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (oid, item.seq, item.place_id, item.start, item.end, item.stay_min, item.stay_source, item.travel_min, item.wait_min, item.is_fixed, item.hours_status),
                    )

    def get_option(self, option_id: str) -> OptionRecord | None:
        oid = _uid(option_id)
        if oid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from course_options where id = %s", (oid,))
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute("select * from course_items where option_id = %s order by seq", (oid,))
            items = cur.fetchall()
        course = CourseOption(
            label=row["label"],
            items=[
                CourseItem(
                    seq=i["seq"], place_id=i["place_id"], start=i["start_at"], end=i["end_at"], stay_min=i["stay_min"],
                    stay_source=i["stay_source"], travel_min=i["travel_min"], wait_min=i["wait_min"], is_fixed=i["is_fixed"],
                    hours_status=i["hours_status"],
                )
                for i in items
            ],
            dropped=[Dropped(**d) for d in row["dropped"]],
            go_home_min=row["go_home_min"],
            total_travel_min=row["total_travel_min"],
        )
        return OptionRecord(str(row["id"]), str(row["session_id"]), list(row["picks"]), course)

    def choose_option(self, day_id: str, option_id: str) -> None:
        with self._db.cursor() as cur:
            cur.execute("update trip_days set chosen_option_id = %s where id = %s", (_uid(option_id), _uid(day_id)))

    def chosen_option(self, day_id: str) -> str | None:
        did = _uid(day_id)
        if did is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select chosen_option_id from trip_days where id = %s", (did,))
            row = cur.fetchone()
        return str(row["chosen_option_id"]) if row and row["chosen_option_id"] else None

    # ---- 판단 기록 ----

    def log_decision(self, kind: str, model: str, output: dict[str, Any]) -> None:
        with self._db.cursor() as cur:
            cur.execute("insert into decision_logs (kind, model, output) values (%s, %s, %s)", (kind, model, _jsonb_text(output)))

    def decision_logs(self) -> list[dict[str, Any]]:
        with self._db.cursor() as cur:
            cur.execute("select message_id, kind, model, output, latency_ms, cost_usd from decision_logs order by id")
            rows = cur.fetchall()
        return [
            {
                "message_id": str(r["message_id"]) if r["message_id"] else None,
                "kind": r["kind"],
                "model": r["model"],
                "output": r["output"],
                "latency_ms": r["latency_ms"],
                "cost_usd": float(r["cost_usd"]) if r["cost_usd"] is not None else None,
            }
            for r in rows
        ]

    def snapshot(self) -> dict[str, Any]:
        with self._db.cursor() as cur:
            return {
                "days": _dump_table(cur, "trip_days", "id"),
                "must_visits": _dump_table(cur, "must_visits", "trip_day_id, slot"),
                "sessions": _dump_table(cur, "planning_sessions", "id"),
                "reactions": _dump_table(cur, "reactions", "session_id, action, seq"),
                "options": _dump_table(cur, "course_options", "id"),
                "items": _dump_table(cur, "course_items", "option_id, seq"),
                "logs": _dump_table(cur, "decision_logs", "id"),
            }


# ---------- 사건·제안·영업 확인 ----------


class PostgresTripRepo(TripRepo):
    def __init__(self, url: str) -> None:
        self._db = Database(url)

    @staticmethod
    def _event(row: dict[str, Any]) -> EventRecord:
        evidence = row["evidence"]
        return EventRecord(
            event_id=str(row["id"]),
            day_id=str(row["trip_day_id"]),
            dedupe_key=row["dedupe_key"],
            k=evidence["k"],
            severity=row["severity"],
            delay_min=evidence["delay_min"],
            state=row["state"],
            at=datetime.fromisoformat(evidence["at"]),
            user_choice=row["user_choice"],
        )

    def put_event(self, record: EventRecord) -> None:
        evidence = {"k": record.k, "delay_min": record.delay_min, "at": record.at.isoformat()}
        with self._db.cursor() as cur:
            cur.execute(
                """insert into trip_events (id, trip_day_id, type, severity, evidence, dedupe_key, state, user_choice)
                   values (%s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (id) do update set trip_day_id = excluded.trip_day_id, type = excluded.type, severity = excluded.severity,
                       evidence = excluded.evidence, dedupe_key = excluded.dedupe_key, state = excluded.state, user_choice = excluded.user_choice""",
                (_uid(record.event_id), _uid(record.day_id), record.type, record.severity, Jsonb(evidence), record.dedupe_key, record.state, record.user_choice),
            )

    def _one(self, sql: str, args: tuple[Any, ...]) -> EventRecord | None:
        with self._db.cursor() as cur:
            cur.execute(sql, args)
            row = cur.fetchone()
        return self._event(row) if row else None

    def get_event(self, event_id: str) -> EventRecord | None:
        eid = _uid(event_id)
        return self._one("select * from trip_events where id = %s", (eid,)) if eid else None

    def event_by_key(self, day_id: str, dedupe_key: str) -> EventRecord | None:
        did = _uid(day_id)
        return self._one("select * from trip_events where trip_day_id = %s and dedupe_key = %s order by seq limit 1", (did, dedupe_key)) if did else None

    def open_event(self, day_id: str, kind: Any = "delay") -> EventRecord | None:
        did = _uid(day_id)
        return self._one("select * from trip_events where trip_day_id = %s and state <> 'resolved' and type = %s order by seq limit 1", (did, kind)) if did else None

    def open_events(self, day_id: str) -> list[EventRecord]:
        did = _uid(day_id)
        if did is None:
            return []
        with self._db.cursor() as cur:
            cur.execute("select * from trip_events where trip_day_id = %s and state <> 'resolved' order by seq", (did,))
            return [self._event(r) for r in cur.fetchall()]

    def put_visit_check(self, record: VisitCheckRecord) -> None:
        with self._db.cursor() as cur:
            cur.execute(
                """insert into visit_checks (trip_day_id, place_id, was_open, checked_at) values (%s, %s, %s, %s)
                   on conflict (trip_day_id, place_id) do update set was_open = excluded.was_open, checked_at = excluded.checked_at""",
                (_uid(record.day_id), record.place_id, record.was_open, record.checked_at),
            )

    @staticmethod
    def _check(row: dict[str, Any]) -> VisitCheckRecord:
        return VisitCheckRecord(row["place_id"], str(row["trip_day_id"]), row["was_open"], row["checked_at"])

    def get_visit_check(self, day_id: str, place_id: str) -> VisitCheckRecord | None:
        did = _uid(day_id)
        if did is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from visit_checks where trip_day_id = %s and place_id = %s", (did, place_id))
            row = cur.fetchone()
        return self._check(row) if row else None

    def visit_checks(self, day_id: str) -> dict[str, VisitCheckRecord]:
        did = _uid(day_id)
        if did is None:
            return {}
        with self._db.cursor() as cur:
            cur.execute("select * from visit_checks where trip_day_id = %s order by place_id", (did,))
            return {r["place_id"]: self._check(r) for r in cur.fetchall()}

    def put_proposals(self, event_id: str, records: list[ProposalRecord]) -> None:
        eid = _uid(event_id)
        with self._db.cursor() as cur:
            cur.execute("update recompose_proposals set superseded = true where event_id = %s", (eid,))
            for r in records:
                closed = None
                if r.closed is not None:
                    closed = {
                        "closed_place_id": r.closed.closed_place_id, "alternative": r.closed.alternative, "distance_m": r.closed.distance_m,
                        "travel_change_min": r.closed.travel_change_min, "reordered": r.closed.reordered,
                    }
                cur.execute(
                    """insert into recompose_proposals (id, event_id, label, reason, dropped, keeps_fixed, first_leave_at, course, from_index,
                           created_at, base_delay_min, superseded, closed)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (_uid(r.proposal_id), eid, r.label, r.reason, Jsonb(list(r.dropped)), r.keeps_fixed, r.first_leave_at, Jsonb(r.course.model_dump()),
                     r.from_index, r.created_at, r.base_delay_min, r.superseded, Jsonb(closed) if closed is not None else None),
                )

    @staticmethod
    def _proposal(row: dict[str, Any]) -> ProposalRecord:
        closed = ClosedInfo(**row["closed"]) if row["closed"] is not None else None
        return ProposalRecord(
            proposal_id=str(row["id"]), event_id=str(row["event_id"]), label=row["label"], reason=row["reason"], dropped=tuple(row["dropped"]),
            keeps_fixed=row["keeps_fixed"], first_leave_at=row["first_leave_at"], course=CourseOption.model_validate(row["course"]),
            from_index=row["from_index"], created_at=row["created_at"], base_delay_min=row["base_delay_min"], superseded=row["superseded"], closed=closed,
        )

    def get_proposal(self, proposal_id: str) -> ProposalRecord | None:
        pid = _uid(proposal_id)
        if pid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from recompose_proposals where id = %s", (pid,))
            row = cur.fetchone()
        return self._proposal(row) if row else None

    def current_proposals(self, event_id: str) -> list[ProposalRecord]:
        eid = _uid(event_id)
        if eid is None:
            return []
        with self._db.cursor() as cur:
            cur.execute("select * from recompose_proposals where event_id = %s and not superseded order by seq", (eid,))
            return [self._proposal(r) for r in cur.fetchall()]

    def snapshot(self) -> dict[str, Any]:
        with self._db.cursor() as cur:
            return {
                "events": _dump_table(cur, "trip_events", "id"),
                "proposals": _dump_table(cur, "recompose_proposals", "id"),
                "visit_checks": _dump_table(cur, "visit_checks", "trip_day_id, place_id"),
            }


# ---------- 여행·고정 일정 ----------


class PostgresTripStore(TripStore):
    def __init__(self, url: str) -> None:
        self._db = Database(url)

    @staticmethod
    def _trip(row: dict[str, Any], day_ids: list[str]) -> TripRow:
        return TripRow(
            str(row["id"]), str(row["owner_id"]), row["city_code"], row["start_date"], row["end_date"], row["lodging_place_id"],
            day_ids, row["status"], row["is_demo"], row["demo_today"],
        )

    def _load(self, cur: Any, row: dict[str, Any] | None) -> TripRow | None:
        if row is None:
            return None
        cur.execute("select id from trip_days where trip_id = %s order by day_number, day", (row["id"],))
        return self._trip(row, [str(r["id"]) for r in cur.fetchall()])

    def add_trip(self, row: TripRow, archive_active: bool = True) -> None:
        with self._db.cursor() as cur:
            cur.execute("insert into profiles (id) values (%s) on conflict (id) do nothing", (_uid(row.owner_id),))
            if archive_active:
                cur.execute("update trips set status = 'archived' where owner_id = %s and status = 'active'", (_uid(row.owner_id),))
            cur.execute(
                """insert into trips (id, owner_id, city_code, start_date, end_date, lodging_place_id, status, is_demo, demo_today)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (_uid(row.trip_id), _uid(row.owner_id), row.city_code, row.start_date, row.end_date, row.lodging_place_id, row.status, row.is_demo, row.demo_today),
            )
            ids = [_uid(d) for d in row.day_ids]
            cur.execute("update trip_days set trip_id = %s where id = any(%s::uuid[])", (_uid(row.trip_id), ids))
            cur.execute("update must_visits set trip_id = %s where trip_day_id = any(%s::uuid[])", (_uid(row.trip_id), ids))

    def get_trip(self, trip_id: str) -> TripRow | None:
        tid = _uid(trip_id)
        if tid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from trips where id = %s", (tid,))
            return self._load(cur, cur.fetchone())

    def trip_of_day(self, day_id: str) -> TripRow | None:
        did = _uid(day_id)
        if did is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select t.* from trips t join trip_days d on d.trip_id = t.id where d.id = %s", (did,))
            return self._load(cur, cur.fetchone())

    def active_trip(self, owner_id: str) -> TripRow | None:
        oid = _uid(owner_id)
        if oid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from trips where owner_id = %s and status = 'active' order by seq desc limit 1", (oid,))
            return self._load(cur, cur.fetchone())

    def day_owner(self, day_id: str) -> str | None:
        did = _uid(day_id)
        if did is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select t.owner_id from trips t join trip_days d on d.trip_id = t.id where d.id = %s", (did,))
            row = cur.fetchone()
        return str(row["owner_id"]) if row else None

    def own_days(self, owner_id: str, day_ids: list[str]) -> None:
        """테스트·점검 전용: 날을 담은 보관된 데모 여행 하나를 만들어 이 사용자 것으로 둔다 (지금 여행에 끼지 않음)."""
        ids = [d for d in (_uid(x) for x in day_ids) if d is not None]
        if not ids:
            return
        with self._db.cursor() as cur:
            cur.execute("select min(day) as first, max(day) as last from trip_days where id = any(%s::uuid[])", (ids,))
            span = cur.fetchone()
        if span is None or span["first"] is None:
            return
        self.add_trip(TripRow(str(uuid.uuid4()), owner_id, "osaka", span["first"], span["last"], None, ids, "archived", True), archive_active=False)

    @staticmethod
    def _fixed(row: dict[str, Any]) -> FixedRow:
        return FixedRow(str(row["id"]), str(row["trip_id"]), str(row["trip_day_id"]), row["title"], row["start_at"], row["end_at"], row["place_id"])

    def fixed_for_day(self, day_id: str) -> list[FixedRow]:
        did = _uid(day_id)
        if did is None:
            return []
        with self._db.cursor() as cur:
            cur.execute("select * from fixed_events where trip_day_id = %s order by start_at", (did,))
            return [self._fixed(r) for r in cur.fetchall()]

    def get_fixed(self, fixed_event_id: str) -> FixedRow | None:
        fid = _uid(fixed_event_id)
        if fid is None:
            return None
        with self._db.cursor() as cur:
            cur.execute("select * from fixed_events where id = %s", (fid,))
            row = cur.fetchone()
        return self._fixed(row) if row else None

    def add_fixed(self, row: FixedRow) -> None:
        with self._db.cursor() as cur:
            cur.execute(
                "insert into fixed_events (id, trip_id, trip_day_id, place_id, title, start_at, end_at) values (%s, %s, %s, %s, %s, %s, %s)",
                (_uid(row.fixed_event_id), _uid(row.trip_id), _uid(row.trip_day_id), row.place_id, row.title, row.start_at, row.end_at),
            )

    def delete_fixed(self, fixed_event_id: str) -> None:
        with self._db.cursor() as cur:
            cur.execute("delete from fixed_events where id = %s", (_uid(fixed_event_id),))

    def snapshot(self) -> dict[str, Any]:
        with self._db.cursor() as cur:
            return {"trips": _dump_table(cur, "trips", "id"), "fixed": _dump_table(cur, "fixed_events", "id"), "profiles": _dump_table(cur, "profiles", "id")}


# ---------- A4 계획 그래프 체크포인터 ----------


class PostgresCheckpointer(PostgresSaver):
    """LangGraph Postgres 체크포인터. 요청 안에서는 그 요청의 트랜잭션을 쓴다 (저장소와 대화 상태가 함께 commit·rollback).
    표는 supabase/migrations에서 만들어 두므로 `setup()`을 부르지 않는다."""

    def __init__(self, url: str) -> None:
        super().__init__(None)  # type: ignore[arg-type]  (연결은 아래 _cursor가 요청마다 고른다)
        self._database = Database(url)

    @contextmanager
    def _cursor(self, *, pipeline: bool = False) -> Iterator[Any]:  # type: ignore[override]
        with self._database.cursor() as cur:
            yield cur
