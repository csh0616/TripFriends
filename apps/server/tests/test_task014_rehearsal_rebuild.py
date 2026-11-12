"""TASK-014 §11·§12 연습 기록 보강: 다시 세운 사건·제안·코스가 "같은 행동을 실제로 했을 때"와 칸마다 같은가 (메모리 저장소).

근거: TASK-014 §11 원칙("연습은 실제와 똑같이 보이고, 저장만 안 한다")·§11 테스트 줄(행동 적용 뒤 DB 그대로, 실제와 같은 응답)·
§12(최종 모양, 순서 뒤집힘·모양 이상 400 VALIDATION_ERROR, 남의 것 404, 모두 저장 0), TASK-007 B-2·B-3·B-4(대안·반영·상태 표)·§6(500 그대로),
TASK-008(닫힘 대안 T-06). 겨냥한 돌연변이 묶음(backend mutmut 보고): 저장 0·순서·400 검사(`TripService._replay`·`_install`·`_internal`,
`trip/rehearsal.py`의 `_from_index`·`_minutes`·`rebuild` 검사 줄) 먼저, 그다음 다시 세운 코스 세부(`_proposal_record`).

비교 방법 (구현 내부 함수를 부르지 않는다):
    연습: 저장소 메서드(put_event·put_proposals·save_options)를 감싸 연습 요청 안에서 놓인 값을 옮겨 적는다 (그 뒤 되돌려진다)
    실제: 같은 날에서 같은 check -> accept/dismiss를 실제로 하고 저장소에 남은 값을 읽는다
    -> 제안 기록·사건 기록·새 코스안의 칸(stay_min·stay_source·travel_min·wait_min·is_fixed·hours_status·시작·끝·go_home_min·total_travel_min·dropped)을 그대로 비교
    빼는 칸: 새로 만드는 id, 만든 시각(created_at·at: 연습은 행동을 다시 놓는 요청의 시각을 쓴다)
DB 쪽(-m db)은 이번에 돌리지 않는다 (reviewer가 로컬 Supabase를 쓰는 중).
"""

from dataclasses import asdict
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from auth_helpers import TESTER, bearer
from test_task014_location_rehearsal import act_accept, act_dismiss, act_visit, everything, same_shape
from trip_helpers import P01, ac05_day, at_time, fixed_later_day, infeasible_day, plain_day

SERVER_ERROR = "서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요"  # 500 공통 문장 (TASK-003 R11, api/main.py·trip/service.py)

def engine_like(factory):
    """심은 하루의 고른 코스를 엔진이 만드는 모양으로 맞춘다: 고정 일정 줄의 stay_source = None (엔진·대안 계산이 그렇게 만든다).
    trip_helpers.item()은 장소가 있으면 고정이어도 'auto'를 넣어서, 그대로면 다시 세운 값(원래 줄 복사)과 실제 대안(엔진 계산)이
    이 칸에서 시험 데이터 때문에 달라진다."""

    def plant(env) -> str:
        day_id = factory(env)
        option_id = env.repo.chosen_option(day_id)
        record = env.repo.get_option(option_id)
        items = [i.model_copy(update={"stay_source": None}) if i.is_fixed else i for i in record.course.items]
        from planning.repo import OptionRecord

        fixed = OptionRecord(f"{option_id}-engine", record.session_id, [], record.course.model_copy(update={"items": items}))
        env.repo.save_options([fixed])
        env.repo.choose_option(day_id, fixed.option_id)
        return day_id

    return plant


# 날 -> (1번 P01에서 떠날 예정 시각(분), 설명). 위치는 늘 P01 (k = 1)
DAYS = {
    "plain": (engine_like(plain_day), 12 * 60, "장소 셋, 대기 0, 마지막은 숙소로"),
    "ac05": (engine_like(ac05_day), 12 * 60 + 25, "고정 체험 15:30이 있어 대기가 생기고 빠지는 곳이 생긴다 (SRS AC-05)"),
    "fixed_later": (engine_like(fixed_later_day), 12 * 60, "고정 일정 14:00 (늦어도 고정 일정 앞에서 기다린다)"),
}


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def check(env, day_id: str, clock: str, rehearsal: bool = False, actions: list | None = None, position=P01):
    payload: dict = {"at": at_time(clock)}
    if position is not None:
        payload["lat"], payload["lng"] = position
    if rehearsal:
        payload["rehearsal"] = True
        if actions is not None:
            payload["rehearsal_actions"] = actions
    return env.client.post(f"/days/{day_id}/check", json=payload)


def ok(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


class Spy:
    """저장소 메서드를 감싸 놓인 값을 옮겨 적는다 (원래 동작은 그대로)."""

    def __init__(self, monkeypatch, env):
        self.events: list = []
        self.proposals: list = []
        self.options: list = []
        trip_type, plan_type = type(env.app.state.trip_repo), type(env.app.state.planning_repo)
        self._wrap(monkeypatch, trip_type, "put_event", lambda record: self.events.append(record))
        self._wrap(monkeypatch, trip_type, "put_proposals", lambda _event_id, records: self.proposals.append(list(records)))
        self._wrap(monkeypatch, plan_type, "save_options", lambda records: self.options.append(list(records)))
        self.on = False

    def _wrap(self, monkeypatch, owner, name, note):
        original = getattr(owner, name)

        def wrapper(repo, *args, **kwargs):
            if self.on:
                note(*args, **kwargs)
            return original(repo, *args, **kwargs)

        monkeypatch.setattr(owner, name, wrapper)

    def during(self, call):
        self.events, self.proposals, self.options = [], [], []
        self.on = True
        try:
            return call()
        finally:
            self.on = False


def proposal_fields(record) -> dict:
    """제안 기록에서 id·만든 시각을 뺀 칸 전부 (course는 칸마다)."""
    found = asdict(record)
    for key in ("proposal_id", "event_id", "created_at"):
        found.pop(key)
    found["course"] = record.course.model_dump()
    return found


def event_fields(record) -> dict:
    found = asdict(record)
    for key in ("event_id", "at"):
        found.pop(key)
    found["dedupe_key"] = found["dedupe_key"].rsplit(":", 1)[-1]  # delay:{day_id}:{k} -> k 자리만 (날 id는 같은 날이라 같다)
    return found


def course_of(env, day_id: str) -> dict:
    option_id = env.repo.chosen_option(day_id)
    return env.repo.get_option(option_id).course.model_dump()


def late_clock(kind: str, late: int) -> str:
    return hhmm(DAYS[kind][1] + late)


# =====================================================================
# 1. 저장 0 · 500 · 순서 (먼저 겨냥: _install·_internal·_replay)
# =====================================================================


def quiet(env):
    env.client = TestClient(env.app, headers=bearer(TESTER), raise_server_exceptions=False)
    return env


def test_T14_R1_다시_놓는_사건의_그래프가_실패하면_500_공통_문장이고_저장_0(env, monkeypatch):
    # §6(TASK-007): 처리 중 예외는 500 INTERNAL_ERROR, 요청 전 그대로. 연습 기록의 사건을 다시 놓다가 실패해도 같다
    quiet(env)
    day_id = plain_day(env)
    event = ok(check(env, day_id, "12:20", rehearsal=True))["event"]
    before = everything(env, "memory")

    def boom(*_args, **_kwargs):
        raise RuntimeError("다시 놓기 강제 실패 (시험)")

    monkeypatch.setattr("graphs.trip._view", boom)
    response = check(env, day_id, "12:30", rehearsal=True, actions=[act_accept(event)])
    assert response.status_code == 500, response.text
    error = response.json()["error"]
    assert error["code"] == "INTERNAL_ERROR" and error["message"] == SERVER_ERROR
    assert everything(env, "memory") == before


def test_T14_R1_실패한_다음_연습도_정상이고_저장_0(env, monkeypatch):
    # 실패한 요청이 남긴 것이 없어서(그래프 스레드 포함) 다음 연습은 처음처럼 된다
    quiet(env)
    day_id = plain_day(env)
    event = ok(check(env, day_id, "12:20", rehearsal=True))["event"]
    with monkeypatch.context() as patch:
        patch.setattr("graphs.trip._view", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("시험")))
        assert check(env, day_id, "12:30", rehearsal=True, actions=[act_accept(event)]).status_code == 500
    before = everything(env, "memory")
    again = ok(check(env, day_id, "12:30", rehearsal=True, actions=[act_accept(event)]))
    assert again["main"]["type"] != "T-04"  # 고른 뒤라 같은 사건을 다시 띄우지 않는다
    assert everything(env, "memory") == before


@pytest.mark.parametrize("order", [("accept", "dismiss"), ("dismiss", "accept"), ("dismiss", "dismiss"), ("accept", "accept")])
def test_T14_R1_같은_사건에_두_번_행동하면_실제처럼_409이고_저장_0(env, order):
    # 실제: 처리 끝난 사건에 다시 accept·dismiss = 409 STATE_CONFLICT (TASK-007 B-4 상태 표). 연습은 실제와 같은 코드로 적용한다 (§11)
    day_id = plain_day(env)
    event = ok(check(env, day_id, "12:20", rehearsal=True))["event"]
    make = {"accept": act_accept, "dismiss": act_dismiss}
    before = everything(env, "memory")
    practiced = check(env, day_id, "12:25", rehearsal=True, actions=[make[order[0]](event), make[order[1]](event)])
    assert practiced.status_code == 409, practiced.text
    assert practiced.json()["error"]["code"] == "STATE_CONFLICT"
    assert everything(env, "memory") == before
    # 같은 순서를 실제로 하면 두 번째가 409
    real_event = ok(check(env, day_id, "12:20"))["event"]
    first = env.client.post(f"/proposals/{real_event['proposals'][0]['proposal_id']}/accept" if order[0] == "accept" else f"/events/{real_event['event_id']}/dismiss")
    assert first.status_code == 200
    second = env.client.post(f"/proposals/{real_event['proposals'][0]['proposal_id']}/accept" if order[1] == "accept" else f"/events/{real_event['event_id']}/dismiss")
    assert second.status_code == 409


def test_T14_R1_이미_저장된_실제_사건을_기록으로_고르면_실제_반영과_같고_저장_0(env):
    # 연습 기록의 사건이 저장소에 이미 있으면(실제 check가 만든 사건) 다시 놓지 않고 그대로 실제 accept 길을 탄다
    day_id = plain_day(env)
    real_event = ok(check(env, day_id, "12:20"))["event"]
    before = everything(env, "memory")
    practiced = ok(check(env, day_id, "12:30", rehearsal=True, actions=[act_accept(real_event)]))
    assert everything(env, "memory") == before
    assert everything(env, "memory")["stores"]["trip_repo"] == before["stores"]["trip_repo"]  # 사건이 둘이 되지 않았다
    ok(env.client.post(f"/proposals/{real_event['proposals'][0]['proposal_id']}/accept"))
    assert same_shape(practiced) == same_shape(ok(check(env, day_id, "12:30")))


def test_T14_R1_닫힘_사건을_그대로_갈래하면_실제로_한_것과_같다(env):
    from test_task008_visit import ALTS, visit_day

    day_id = visit_day(env, extra=ALTS)
    closed = act_visit("P02", day_id, at_time("11:40"), was_open=False)
    made = ok(env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": at_time("11:40"), "was_open": False, "rehearsal": True}))["event"]
    before = everything(env, "memory")
    practiced = ok(check(env, day_id, "11:50", rehearsal=True, actions=[closed, act_dismiss(made)], position=None))
    assert everything(env, "memory") == before
    real_event = ok(env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": at_time("11:40"), "was_open": False}))["event"]
    ok(env.client.post(f"/events/{real_event['event_id']}/dismiss"))
    assert same_shape(practiced) == same_shape(ok(check(env, day_id, "11:50", position=None)))


@pytest.mark.parametrize("index", [0, 1, -1], ids=["첫_대안", "둘째_대안", "빼고_가기"])
def test_T14_R1_닫힘_대안을_몇_번째든_고르면_실제로_그_대안을_고른_것과_같다(env, index):
    from test_task008_visit import ALTS, visit_day

    day_id = visit_day(env, extra=ALTS)
    closed = act_visit("P02", day_id, at_time("11:40"), was_open=False)
    made = ok(env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": at_time("11:40"), "was_open": False, "rehearsal": True}))["event"]
    assert len(made["proposals"]) >= 3  # 시험 자체 확인: 대안 둘 이상 + [빼고 가기]
    chosen = made["proposals"][index]["proposal_id"]
    before = everything(env, "memory")
    practiced = ok(check(env, day_id, "11:50", rehearsal=True, actions=[closed, act_accept(made, chosen)], position=None))
    assert everything(env, "memory") == before
    real_event = ok(env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": at_time("11:40"), "was_open": False}))["event"]
    ok(env.client.post(f"/proposals/{real_event['proposals'][index]['proposal_id']}/accept"))
    assert same_shape(practiced) == same_shape(ok(check(env, day_id, "11:50", position=None)))


def test_T14_R1_열었어는_닫힘_사건을_만들지_않아_그_뒤_닫힘_대안을_고르면_400(env):
    # 열었어(was_open true) 뒤에는 닫힘 사건이 없다 -> 그 닫힘 사건을 고르는 행동은 순서가 맞지 않는 것 (§12 Q4: 400)
    from test_task008_visit import ALTS, visit_day

    day_id = visit_day(env, extra=ALTS)
    made = ok(env.client.post("/places/P02/visit-checks", json={"day_id": day_id, "at": at_time("11:40"), "was_open": False, "rehearsal": True}))["event"]
    before = everything(env, "memory")
    opened = act_visit("P02", day_id, at_time("11:40"), was_open=True)
    response = check(env, day_id, "11:50", rehearsal=True, actions=[opened, act_accept(made)], position=None)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert everything(env, "memory") == before


# =====================================================================
# 2. 400 검사 경계 (rebuild·_from_index·_minutes)
# =====================================================================


def tamper(event: dict, edit) -> dict:
    copy = {**event, "proposals": [{**p, "items": [dict(i) for i in p["items"]], "dropped": [dict(d) for d in p["dropped"]]} for p in event["proposals"]]}
    edit(copy)
    return copy


def _seq_gap(e):
    e["proposals"][0]["items"][-1]["seq"] += 1


def _seq_start_zero(e):
    for p in e["proposals"]:
        for n, item in enumerate(p["items"]):
            item["seq"] = n + 1  # 1번(지난 장소)부터라고 함 -> 지난 자리 없음


def _seq_past_end(e):
    for p in e["proposals"]:
        for n, item in enumerate(p["items"]):
            item["seq"] = 10 + n


def _other_start(e):
    second = e["proposals"][-1]
    second["items"] = second["items"][1:]  # 둘째 안만 한 칸 뒤에서 시작 -> 한 사건의 제안이 다른 장소에서 시작


def _empty(e):
    for p in e["proposals"]:
        p["items"], p["dropped"] = [], []


def _no_proposals(e):
    e["proposals"] = []


def _time(value):
    def edit(e):
        e["proposals"][0]["items"][0]["start"] = value

    return edit


def _dropped_outside(e):
    e["proposals"][0]["dropped"] = [{"place_id": "osaka-fake-museum", "name": "코스 밖"}]


BAD = [
    (_seq_gap, "순번이_건너뜀"),
    (_seq_start_zero, "순번이_지난_자리부터"),
    (_seq_past_end, "순번이_코스_밖"),
    (_other_start, "제안마다_시작_장소가_다름"),
    (_empty, "일정도_빠지는_곳도_없는_제안"),
    (_time("12:5"), "시각_4글자"),
    (_time("1205"), "시각_콜론_없음"),
    (_time("12-05"), "시각_다른_구분자"),
    (_time("ab:cd"), "시각_숫자_아님"),
    (_time("12:050"), "시각_6글자"),
    (_dropped_outside, "빠지는_곳이_코스_밖"),
]


@pytest.mark.parametrize("edit", [b for b, _ in BAD], ids=[i for _, i in BAD])
@pytest.mark.parametrize("kind", ["accept", "dismiss"])
def test_T14_R2_다시_세울_수_없는_사건은_400이고_저장_0(env, edit, kind):
    day_id = ac05_day(env)  # 대안 둘(relaxed·packed)이 다 있는 날
    event = ok(check(env, day_id, late_clock("ac05", 20), rehearsal=True))["event"]
    assert event and len(event["proposals"]) >= 2  # 시험 자체 확인
    bad = tamper(event, edit)
    action = act_accept(bad, bad["proposals"][0]["proposal_id"]) if kind == "accept" and bad["proposals"] else act_dismiss(bad)
    before = everything(env, "memory")
    response = check(env, day_id, late_clock("ac05", 30), rehearsal=True, actions=[action])
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert everything(env, "memory") == before


def test_T14_R2_경계_손대지_않은_사건은_받는다(env):
    day_id = ac05_day(env)
    event = ok(check(env, day_id, late_clock("ac05", 20), rehearsal=True))["event"]
    for action in (act_accept(event), act_accept(event, event["proposals"][-1]["proposal_id"]), act_dismiss(event)):
        assert check(env, day_id, late_clock("ac05", 30), rehearsal=True, actions=[action]).status_code == 200


# =====================================================================
# 3. 다시 세운 사건·제안·코스 = 실제 (칸마다) — _proposal_record·rebuild
# =====================================================================


def rebuilt_vs_real(env, monkeypatch, kind: str, late: int, index: int) -> None:
    factory = DAYS[kind][0]
    spy = Spy(monkeypatch, env)
    day_id = factory(env)
    clock = late_clock(kind, late)
    event = ok(check(env, day_id, clock, rehearsal=True))["event"]
    assert event is not None and event["state"] == "awaiting"  # 시험 자체 확인: 높음
    if not event["proposals"]:
        return
    index %= len(event["proposals"])
    chosen = event["proposals"][index]["proposal_id"]
    later = hhmm(DAYS[kind][1] + late + 5)
    before = everything(env, "memory")
    practiced = ok(spy.during(lambda: check(env, day_id, later, rehearsal=True, actions=[act_accept(event, chosen)])))
    assert everything(env, "memory") == before
    rebuilt_event = spy.events[0]
    rebuilt = spy.proposals[0]
    new_option = spy.options[0][0].course.model_dump()
    # 실제
    real_view = ok(check(env, day_id, clock))
    real_record = env.app.state.trip_repo.get_event(real_view["event"]["event_id"])
    real_proposals = env.app.state.trip_repo.current_proposals(real_record.event_id)
    left, right = [proposal_fields(p) for p in rebuilt], [proposal_fields(p) for p in real_proposals]
    assert len(left) == len(right)
    for a, b in zip(left, right):
        assert {k: a[k] for k in a if k != "course"} == {k: b[k] for k in b if k != "course"}
        assert {k: a["course"][k] for k in a["course"] if k != "items"} == {k: b["course"][k] for k in b["course"] if k != "items"}
        assert a["course"]["items"] == b["course"]["items"]
    assert event_fields(rebuilt_event) == event_fields(real_record)
    ok(env.client.post(f"/proposals/{real_proposals[index].proposal_id}/accept"))
    assert new_option == course_of(env, day_id)  # 새 코스안: 머무는 시간·대기·이동·숙소 복귀·dropped까지
    assert same_shape(practiced) == same_shape(ok(check(env, day_id, later)))


@pytest.mark.parametrize("kind", sorted(DAYS))
@pytest.mark.parametrize("index", [0, 1], ids=["relaxed", "packed"])
def test_T14_R3_다시_세운_제안·사건·새_코스가_실제와_칸마다_같다(env, monkeypatch, kind, index):
    rebuilt_vs_real(env, monkeypatch, kind, 20, index)


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(kind=st.sampled_from(sorted(DAYS)), late=st.integers(min_value=20, max_value=75), index=st.integers(min_value=0, max_value=3))
def test_T14_R3_속성_여러_늦은_분·날에서_연습_기록_적용은_실제_적용과_같다(env, monkeypatch, kind, late, index):
    with monkeypatch.context() as patch:
        rebuilt_vs_real(env, patch, kind, late, index)


def dismiss_vs_real(env, factory, clock: str, later: str) -> None:
    day_id = factory(env)
    event = ok(check(env, day_id, clock, rehearsal=True))["event"]
    assert event is not None  # 시험 자체 확인
    before = everything(env, "memory")
    practiced = check(env, day_id, later, rehearsal=True, actions=[act_dismiss(event)])
    assert everything(env, "memory") == before
    real_event = ok(check(env, day_id, clock))["event"]
    real = env.client.post(f"/events/{real_event['event_id']}/dismiss")
    if real.status_code == 200:  # 실제로 되는 일이면 연습도 되고 화면이 같다
        assert practiced.status_code == 200, practiced.text
        assert same_shape(practiced.json()) == same_shape(ok(check(env, day_id, later)))
    else:  # 실제로 안 되는 일(낮음 사건 dismiss = 409)은 연습도 받지 않는다. 400(§12 모양)인지 409(실제 그대로)인지는 질문으로 남김
        assert practiced.status_code in (400, real.status_code), (practiced.text, real.text)


@pytest.mark.parametrize(
    "factory, clock, later",
    [
        (plain_day, "12:20", "12:25"),
        (ac05_day, "12:45", "12:50"),
        (fixed_later_day, "12:20", "12:25"),
        (infeasible_day, "13:30", "13:35"),  # 무엇을 빼도 고정 일정에 못 간다 -> 제안 0개 (빈 제안 경계)
        (plain_day, "12:10", "12:12"),  # 낮음(open_low): 제안 없이 사건만
    ],
    ids=["plain", "ac05", "fixed_later", "제안_0개", "낮음"],
)
def test_T14_R3_그대로_갈래_기록은_실제_dismiss와_결과가_같다_빈_제안_포함(env, factory, clock, later):
    dismiss_vs_real(env, factory, clock, later)


def test_T14_R3_빈_제안_사건도_실제처럼_제안_0개로_보인다(env):
    # 제안 0개(B-2 Infeasible)인 사건을 기록에 넣고 다시 계산해도 실제와 같은 화면 (안내 + [그대로 갈래]만, TASK-007 C3)
    day_id = infeasible_day(env)
    event = ok(check(env, day_id, "13:30", rehearsal=True))["event"]
    assert event is not None and event["proposals"] == []  # 시험 자체 확인
    practiced = check(env, day_id, "13:35", rehearsal=True, actions=[act_dismiss(event)])
    assert practiced.status_code == 200, practiced.text
