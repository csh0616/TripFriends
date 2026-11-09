"""TASK-012 A2 계약 테스트: 지금 메모리 저장소의 인터페이스(PlanningRepo·TripRepo)에 **같은 테스트**를 메모리·Postgres 두 구현에 돌린다.
근거: TASK-012 §A A2·§7 AC-1·AC-2, 포트폴리오 포인트 1, DATA-001 C·D·E, planning/repo.py·trip/repo.py 독스트링(지금 동작이 계약).

계약 (이 테스트가 정한 이름, 승인 대기):
    store.postgres.PostgresPlanningRepo(url) · PostgresTripRepo(url) — 인터페이스는 지금 그대로 (메서드 이름·인자·돌려주는 값)
    Postgres 쪽은 `db` 표시. TEST_DATABASE_URL이 없거나 붙지 못하면 건너뛴다 (§T)
    get_day의 장소 좌표·숙소 좌표는 비교하지 않는다: A6(위치 열 0)·ADR-015(Google 값은 DB에 안 넣음)와 부딪쳐 질문으로 남김
        -> plan은 lodging·fixed[].lat/lng를 뺀 값, places는 키(장소 ID)만 비교
    시각(EventRecord.at 등)은 지금처럼 시간대 없는 도시 현지 시각 그대로 돌아온다
"""

from datetime import datetime

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from engine.models import CourseOption
from planning.repo import OptionRecord, _apply_reaction
from planning_helpers import day_plan, fixed_event, place
from storage_helpers import KINDS, new_id, planning_repo, trip_repo
from trip.repo import ClosedInfo, EventRecord, ProposalRecord
from trip.visit import VisitCheckRecord
from trip_helpers import item

PLAN_COORDS = {"lodging": True, "fixed": {"__all__": {"lat", "lng"}}}
PLACES = {pid: place(pid, km=n + 1.0) for n, pid in enumerate(["P1", "P2", "P3", "P4", "P5"])}


@pytest.fixture(params=KINDS)
def kind(request) -> str:
    return request.param


@pytest.fixture
def repo(kind):
    return planning_repo(kind)


def seeded_day(repo, must=("P1", "P2"), number: int = 2, lodging_known: bool = False, sources=None) -> tuple[str, object]:
    """여행 만들기와 같은 순서: 날 저장 -> 여행 저장 (trip/trips.py TripBook.create, planning/seed.py)."""
    day_id = new_id()
    plan = day_plan(must=must, fixed=(fixed_event("12:00", "13:00", PLACES["P3"], fid=new_id()),), overrides={"P1": 45})
    repo.save_day(day_id, plan, PLACES, number, lodging_known=lodging_known, sources=sources if sources is not None else {"P1": "google", "P2": "demo"})
    repo.save_trip(new_id(), [day_id])
    return day_id, plan


def session_on(repo) -> tuple[str, str]:
    day_id, _ = seeded_day(repo)
    session_id = new_id()
    repo.create_session(session_id, day_id)
    return day_id, session_id


def course(label: str = "relaxed") -> CourseOption:
    items = [item(1, "P1", "10:12", "12:00", 12), item(2, "P2", "12:20", "14:00", 20)]
    return CourseOption(label=label, items=items, dropped=[], go_home_min=25, total_travel_min=32)


# ---------- 하루·여행 ----------


def test_T12_A2_save_day_get_day는_같은_값을_돌려준다(repo):
    day_id, plan = seeded_day(repo, number=3, lodging_known=False, sources={"P1": "google", "P2": "user"})
    record = repo.get_day(day_id)
    assert record is not None
    assert record.plan.model_dump(exclude=PLAN_COORDS) == plan.model_dump(exclude=PLAN_COORDS)
    assert set(record.places) == set(PLACES)
    assert record.day_number == 3
    assert record.lodging_known is False
    assert record.sources == {"P1": "google", "P2": "user"}


@pytest.mark.parametrize("lodging_known", [True, False])
def test_T12_A2_lodging_known_양쪽_값이_그대로(repo, lodging_known):
    day_id, _ = seeded_day(repo, lodging_known=lodging_known)
    assert repo.get_day(day_id).lodging_known is lodging_known


def test_T12_A2_없는_날은_None(repo):
    assert repo.get_day(new_id()) is None


def test_T12_A2_같은_날을_다시_저장하면_새_값(repo):
    day_id, _ = seeded_day(repo, must=("P1",))
    record = repo.get_day(day_id)
    repo.save_day(day_id, record.plan.model_copy(update={"must_visit": ["P4", "P5"]}), PLACES, record.day_number, lodging_known=True, sources=record.sources)
    again = repo.get_day(day_id)
    assert again.plan.must_visit == ["P4", "P5"]
    assert again.lodging_known is True


def test_T12_A2_저장한_뒤_넘긴_값을_바꿔도_저장된_값은_그대로(repo):
    day_id = new_id()
    plan = day_plan(must=("P1",))
    repo.save_day(day_id, plan, PLACES, 1)
    repo.save_trip(new_id(), [day_id])
    plan.must_visit.append("P2")
    assert repo.get_day(day_id).plan.must_visit == ["P1"]


@pytest.mark.parametrize(
    ("must", "old", "new", "expected"),
    [
        (("P1", "P2"), "P1", "P3", ["P3", "P2"]),  # 자리 그대로
        (("P1", "P2"), "P1", "P2", ["P2"]),  # 이미 있는 곳으로 바꾸면 하나만 (순서 유지)
        (("P1", "P2"), "P4", "P3", ["P1", "P2"]),  # 없는 곳이면 그대로
    ],
    ids=["바꾸기", "겹치면_하나", "없으면_그대로"],
)
def test_T12_A2_replace_must_visit(repo, must, old, new, expected):
    day_id, plan = seeded_day(repo, must=must)
    repo.replace_must_visit(day_id, old, new)
    record = repo.get_day(day_id)
    assert record.plan.must_visit == expected
    assert record.plan.model_dump(exclude={**PLAN_COORDS, "must_visit": True}) == plan.model_dump(exclude={**PLAN_COORDS, "must_visit": True})


# ---------- 세션·반응 ----------


def test_T12_A2_세션은_그날을_가리키고_없는_세션은_None(repo):
    day_id, session_id = session_on(repo)
    assert repo.session_day(session_id) == day_id
    assert repo.session_day(new_id()) is None


def test_T12_A2_새_세션은_반응·묶음_성질·머무는_시간이_비어_있다(repo):
    _, sid = session_on(repo)
    reactions = repo.reactions(sid)
    assert (reactions.liked, reactions.skipped) == ([], [])
    assert repo.batch_relaxed(sid) is False
    assert repo.batch_first(sid) is False
    assert repo.stay_overrides(sid) == {}


ACTIONS = st.lists(st.tuples(st.sampled_from(["P1", "P2", "P3", "P4"]), st.sampled_from(["like", "skip", "unlike"])), max_size=12)


@settings(max_examples=30, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(steps=ACTIONS)
def test_T12_A2_속성_반응을_어떤_순서로_넣어도_규칙_한_곳_apply_reaction과_같은_결과(repo, steps):
    _, sid = session_on(repo)
    liked, skipped, unliked = [], [], []
    for place_id, action in steps:
        repo.react(sid, place_id, action)
        liked, skipped, unliked = _apply_reaction(liked, skipped, unliked, place_id, action)
    got = repo.reactions(sid)
    assert (got.liked, got.skipped) == (liked, skipped)


def test_T12_A2_reactions_after_react는_저장하지_않는다(repo):
    _, sid = session_on(repo)
    repo.react(sid, "P1", "like")
    preview = repo.reactions_after_react(sid, "P2", "like")
    assert preview.liked == ["P1", "P2"]
    assert repo.reactions(sid).liked == ["P1"]


def test_T12_A2_skip_unreacted는_반응_없는_곳만_묶음_순서대로_넘김(repo):
    _, sid = session_on(repo)
    repo.react(sid, "P2", "like")
    repo.react(sid, "P3", "like")
    repo.react(sid, "P3", "unlike")  # 좋아했다가 취소한 곳은 반응이 있었던 곳 (TASK-003 §10 Q17)
    preview = repo.reactions_after_skip(sid, ["P4", "P1", "P2", "P3"])
    assert preview.skipped == ["P4", "P1"]
    assert repo.reactions(sid).skipped == []  # 미리 보기는 저장하지 않는다
    repo.skip_unreacted(sid, ["P4", "P1", "P2", "P3"])
    got = repo.reactions(sid)
    assert (got.liked, got.skipped) == (["P2"], ["P4", "P1"])


@pytest.mark.parametrize("value", [True, False])
def test_T12_A2_묶음_성질_relaxed·first_양쪽_값(repo, value):
    _, sid = session_on(repo)
    repo.save_batch_relaxed(sid, value)
    repo.save_batch_first(sid, not value)
    assert repo.batch_relaxed(sid) is value
    assert repo.batch_first(sid) is (not value)


def test_T12_A2_머무는_시간은_장소별로_덮어쓰고_돌려준_값을_바꿔도_그대로(repo):
    _, sid = session_on(repo)
    repo.set_stay_override(sid, "P1", 45)
    repo.set_stay_override(sid, "P2", 90)
    repo.set_stay_override(sid, "P1", 60)
    got = repo.stay_overrides(sid)
    assert got == {"P1": 60, "P2": 90}
    got["P3"] = 15
    assert repo.stay_overrides(sid) == {"P1": 60, "P2": 90}


# ---------- 코스안·선택 ----------


def test_T12_A2_코스안을_저장하면_같은_값으로_읽히고_옛_코스안도_남는다(repo):
    day_id, sid = session_on(repo)
    first = [OptionRecord(new_id(), sid, ["P1", "P2"], course("relaxed")), OptionRecord(new_id(), sid, ["P1", "P2"], course("packed"))]
    repo.save_options(first)
    later = [OptionRecord(new_id(), sid, ["P2"], course("relaxed"))]
    repo.save_options(later)
    for record in [*first, *later]:
        got = repo.get_option(record.option_id)
        assert got is not None
        assert (got.option_id, got.session_id, got.picks) == (record.option_id, record.session_id, record.picks)
        assert got.course.model_dump() == record.course.model_dump()
    assert repo.get_option(new_id()) is None


def test_T12_A2_고른_코스안은_날마다_하나_다시_고르면_바뀐다(repo):
    day_id, sid = session_on(repo)
    a, b = OptionRecord(new_id(), sid, ["P1"], course("relaxed")), OptionRecord(new_id(), sid, ["P1"], course("packed"))
    repo.save_options([a, b])
    assert repo.chosen_option(day_id) is None
    repo.choose_option(day_id, a.option_id)
    assert repo.chosen_option(day_id) == a.option_id
    repo.choose_option(day_id, b.option_id)
    assert repo.chosen_option(day_id) == b.option_id
    assert repo.chosen_option(new_id()) is None


# ---------- 판단 기록 ----------


def test_T12_A2_판단_기록은_DATA_001_decision_logs_모양(repo):
    mark = new_id()
    repo.log_decision("parser", "rule", {"direction": "quieter", "mark": mark})
    mine = [row for row in repo.decision_logs() if row["output"].get("mark") == mark]
    assert mine == [{"message_id": None, "kind": "parser", "model": "rule", "output": {"direction": "quieter", "mark": mark}, "latency_ms": None, "cost_usd": None}]


# ---------- 스냅숏 ----------


def test_T12_A2_읽기만_하면_snapshot이_바뀌지_않는다(repo):
    day_id, sid = session_on(repo)
    before = repo.snapshot()
    repo.get_day(day_id)
    repo.session_day(sid)
    repo.reactions(sid)
    repo.reactions_after_react(sid, "P1", "like")
    repo.reactions_after_skip(sid, ["P1"])
    repo.stay_overrides(sid)
    repo.chosen_option(day_id)
    repo.decision_logs()
    assert repo.snapshot() == before


# ---------- TripRepo (사건·제안·영업 확인) ----------


@pytest.fixture
def trips(kind):
    """사건은 그날에 붙는다 (DATA-001 E: trip_day_id). 같은 구현의 PlanningRepo로 날을 먼저 만든다."""
    return planning_repo(kind), trip_repo(kind)


AT = datetime(2026, 12, 2, 12, 10)  # 시간대 없는 도시 현지 시각 (TASK-006 §A-1)


def event(day_id: str, key: str = "delay:1", state: str = "open_low", **extra) -> EventRecord:
    return EventRecord(event_id=new_id(), day_id=day_id, dedupe_key=key, k=1, severity="low", delay_min=10, state=state, at=AT, **extra)  # type: ignore[arg-type]


def proposal(event_id: str, label: str = "relaxed", closed: ClosedInfo | None = None) -> ProposalRecord:
    return ProposalRecord(
        proposal_id=new_id(),
        event_id=event_id,
        label=label,  # type: ignore[arg-type]
        reason="늦어져서 하나 뺐어",
        dropped=("P2",),
        keeps_fixed=True,
        first_leave_at="12:30",
        course=course(label),
        from_index=1,
        created_at=AT,
        base_delay_min=10,
        closed=closed,
    )


def test_T12_A2_사건을_넣으면_같은_값으로_읽힌다(trips):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    record = event(day_id)
    repo.put_event(record)
    assert repo.get_event(record.event_id) == record
    assert repo.event_by_key(day_id, "delay:1") == record
    assert repo.get_event(new_id()) is None
    assert repo.event_by_key(day_id, "delay:9") is None


def test_T12_A2_사건을_다시_넣으면_새_상태로_바뀐다(trips):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    record = event(day_id)
    repo.put_event(record)
    from dataclasses import replace

    resolved = replace(record, state="resolved", user_choice="dismissed")
    repo.put_event(resolved)
    assert repo.get_event(record.event_id) == resolved


def test_T12_A2_열린_사건은_종류마다_처리된_것은_빠진다(trips):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    delay = event(day_id, "delay:1", "awaiting")
    closed = event(day_id, "closed:P1", "open_low")
    done = event(day_id, "delay:2", "resolved")
    for record in (delay, closed, done):
        repo.put_event(record)
    assert repo.open_event(day_id, "delay") == delay
    assert repo.open_event(day_id, "closed") == closed
    assert {e.event_id for e in repo.open_events(day_id)} == {delay.event_id, closed.event_id}
    other_day, _ = seeded_day(planning)
    assert repo.open_events(other_day) == []
    assert repo.open_event(other_day) is None


@pytest.mark.parametrize("was_open", [True, False])
def test_T12_A2_영업_확인_기록은_날·장소마다_하나(trips, was_open):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    first = VisitCheckRecord("P1", day_id, not was_open, AT)
    again = VisitCheckRecord("P1", day_id, was_open, datetime(2026, 12, 2, 12, 20))
    other = VisitCheckRecord("P2", day_id, True, AT)
    for record in (first, again, other):
        repo.put_visit_check(record)
    assert repo.get_visit_check(day_id, "P1") == again
    assert repo.visit_checks(day_id) == {"P1": again, "P2": other}
    assert repo.get_visit_check(day_id, "P3") is None
    other_day, _ = seeded_day(planning)
    assert repo.visit_checks(other_day) == {}


def test_T12_A2_새_제안을_넣으면_옛_제안은_지우지_않고_오래됨(trips):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    record = event(day_id)
    repo.put_event(record)
    old = [proposal(record.event_id, "relaxed"), proposal(record.event_id, "packed")]
    repo.put_proposals(record.event_id, old)
    assert repo.current_proposals(record.event_id) == old  # 만든 순서
    new = [proposal(record.event_id, "relaxed", ClosedInfo("P1", "P4", 420, -5, reordered=True))]
    repo.put_proposals(record.event_id, new)
    assert repo.current_proposals(record.event_id) == new
    for gone in old:
        got = repo.get_proposal(gone.proposal_id)
        assert got is not None and got.superseded is True
        assert got.course.model_dump() == gone.course.model_dump()
    assert repo.get_proposal(new_id()) is None


@pytest.mark.parametrize("alternative", ["P4", None], ids=["대안_있음", "빼고_가기"])
def test_T12_A2_닫힘_대안_정보도_같은_값으로(trips, alternative):
    planning, repo = trips
    day_id, _ = seeded_day(planning)
    record = event(day_id, "closed:P1")
    repo.put_event(record)
    info = ClosedInfo("P1", alternative, 420 if alternative else None, 3)
    made = proposal(record.event_id, closed=info)
    repo.put_proposals(record.event_id, [made])
    assert repo.get_proposal(made.proposal_id).closed == info


# ---------- Postgres만: 다른 객체(서버를 다시 켠 것과 같음)에서도 남아 있다 (AC-2) ----------


@pytest.mark.db
def test_T12_A2_AC2_계획_저장소는_새로_만든_객체에서도_그대로():
    first = planning_repo("postgres")
    day_id, sid = session_on(first)
    first.react(sid, "P1", "like")
    first.set_stay_override(sid, "P1", 75)
    option = OptionRecord(new_id(), sid, ["P1"], course())
    first.save_options([option])
    first.choose_option(day_id, option.option_id)

    second = planning_repo("postgres")
    assert second.session_day(sid) == day_id
    assert second.reactions(sid).liked == ["P1"]
    assert second.stay_overrides(sid) == {"P1": 75}
    assert second.chosen_option(day_id) == option.option_id
    assert second.get_option(option.option_id).course.model_dump() == option.course.model_dump()


@pytest.mark.db
def test_T12_A2_AC2_영업_확인·사건·제안은_새로_만든_객체에서도_그대로():
    planning = planning_repo("postgres")
    day_id, _ = seeded_day(planning)
    first = trip_repo("postgres")
    check = VisitCheckRecord("P1", day_id, False, AT)
    first.put_visit_check(check)
    record = event(day_id)
    first.put_event(record)
    made = proposal(record.event_id)
    first.put_proposals(record.event_id, [made])

    second = trip_repo("postgres")
    assert second.get_visit_check(day_id, "P1") == check
    assert second.get_event(record.event_id) == record
    assert [p.proposal_id for p in second.current_proposals(record.event_id)] == [made.proposal_id]
