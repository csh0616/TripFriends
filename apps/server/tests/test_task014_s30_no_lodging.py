"""TASK-014 §30 (서버): 숙소 없는 여행의 경로 선·마지막 뒤·빈 코스 날의 카드, 숙소 좌표를 못 찾은 여행.

근거: TASK-014 §30 표 Q3("숙소 없음, 마지막 뒤·빈 코스 날의 메인 카드: T-08만 빼고 서버 규칙이 고르는 카드 그대로. 빈 코스 안내 글은 남김.
이동 상태 알약은 '오늘 일정 끝' 그대로") · Q4("경로 선의 도시 중심: 뺀다 (숙소 없으면 첫·마지막 선 없음)") ·
Q6("숙소를 골랐는데 좌표를 못 찾음(lodging_known=False): null (모르는 숙소 = 없는 숙소와 같게)") ·
§29 표 ④(day.lodging null, T-08 숨김, 서버 내부 계산에 도시 중심을 쓰는 건 그대로 가능) · TASK-006 §11 Q11(지난 길 끝 = 남은 길 시작)·Q13(빈 코스 이유) ·
TASK-007 F1(알약 "오늘 일정 끝").

계약 (이 테스트가 정한 것, 승인 대기):
    Q4 숙소 없음(lodging_known=False) -> route.done·route.remaining 어디에도 하루 출발점(도시 중심) 좌표가 없다
        done + remaining을 이어 붙여 연달아 같은 점을 하나로 줄이면 = 핀 좌표를 순서대로 (이동 중 위치를 실었으면 그 위치가 두 장소 사이에 끼인다)
        둘 다 비어 있지 않으면 done의 끝 = remaining의 시작 (Q11 그대로). 빈 코스 날은 done = remaining = []
    Q4 경계: 숙소 있음 -> done[0] = 숙소, remaining[-1] = 숙소 (지금 그대로)
    Q3 숙소 없음 -> 같은 시각 숙소 있는 날과 비교해: 보조 = 숙소 있는 날 보조에서 T-08만 뺀 것,
        숙소 있는 날 메인이 T-08이 아니면 메인 종류·이유가 같다.
        (§31 Q2로 바뀜) 메인이 T-08인 자리(마지막 뒤·빈 코스)는 숙소 없는 날도 T-08 "숙소 없는 모양"(lodging·map_url = null),
        하루 끝 이유는 §31 Q3 "오늘 일정이 끝났어. 오늘도 수고했어!" (빈 코스 날 이유는 "오늘 코스가 비어 있어" 그대로)
    Q3 마지막 장소 끝 뒤·빈 코스 날: status_text = "오늘 일정 끝" (숙소와 상관없이)
    Q3 빈 코스 날 + 숙소 없음: reason = "오늘 코스가 비어 있어" 그대로, subs·pins = [], 메인은 숙소 없는 T-08 (§31 Q2로 바뀜)
    Q6 POST /trips에 lodging_place_id를 줬지만 좌표를 못 구한 여행(city.lodging_location이 None) -> 숙소 없는 여행과 같다:
        trip.lodging.place_id는 준 값 그대로(TASK-015 §9 Q2: 응답의 lodging_place_id는 없어짐), now·실제 check·연습 check의 day.lodging = null, 마지막 뒤 숙소 없는 T-08(§31 Q2), 경로에 도시 중심 없음
        (§29 심은 하루 테스트 test_T14_S29_4_심은_하루_lodging_known_False…가 저장소 쪽을 이미 덮는다. 이 파일은 POST /trips 길로 한 번 더)
    빈 시간 < 이동 시간(Q7)은 앱의 가짜 위치 몫이라 서버 테스트는 없다
"""

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from test_task014_s29_no_lodging import (
    NO_LODGING_DAY_OVER,
    at_of,
    every_view,
    get_now,
    hhmm,
    is_no_lodging_t08,
    last_end,
    lodging_hit,
    mem,  # noqa: F401  (pytest 픽스처를 이 파일에서도 쓴다)
    planned_day,
    without_lodging,
)
from planning_api_helpers import week_hours
from planning_helpers import place
from trip_helpers import at_place, at_time, plain_day, plant

HOME = (35.0, 135.0)  # trip_helpers: 심은 하루의 출발점(숙소 자리) = 숙소 모름이면 도시 중심 같은 출발점
DAY_OVER_PILL = "오늘 일정 끝"
DAY_OVER_WITH_LODGING = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # TASK-006 §12 R1 (숙소 있음은 그대로, §31 Q3)
EMPTY_REASON = "오늘 코스가 비어 있어"


# ---------- 도우미 ----------


def views(env, day_id: str, clock: str, position: tuple[float, float] | None = None) -> dict[str, dict]:
    """GET /now · 실제 check · 연습 check. position은 check 두 개에만 싣는다 (GET /now는 위치를 무시)."""
    out = {}
    response = env.client.get(f"/days/{day_id}/now", params={"at": at_time(clock)})
    assert response.status_code == 200, response.text
    out["now"] = response.json()
    spot = {"lat": position[0], "lng": position[1]} if position else {}
    for name, extra in (("check", {}), ("rehearsal", {"rehearsal": True})):
        response = env.client.post(f"/days/{day_id}/check", json={"at": at_time(clock), **spot, **extra})
        assert response.status_code == 200, response.text
        out[name] = response.json()
    return out


def points(route: dict) -> list[tuple[float, float]]:
    return [(p[0], p[1]) for p in (*route["done"], *route["remaining"])]


def collapsed(route: dict) -> list[tuple[float, float]]:
    """done + remaining을 이어 붙이고 연달아 같은 점을 하나로"""
    out: list[tuple[float, float]] = []
    for p in points(route):
        if not out or out[-1] != p:
            out.append(p)
    return out


def pin_coords(view: dict) -> list[tuple[float, float]]:
    return [(pin["lat"], pin["lng"]) for pin in sorted(view["pins"], key=lambda pin: pin["seq"])]


def joint_ok(route: dict) -> bool:
    done, remaining = route["done"], route["remaining"]
    return not done or not remaining or tuple(done[-1]) == tuple(remaining[0])


@pytest.fixture
def no_lodging_day(env):
    day_id = plain_day(env)  # 1번 P01 10:12~12:00 · 2번 P02 12:20~14:00(이동 20) · 3번 P03 14:30~19:00(이동 30)
    without_lodging(env, day_id)
    return env, day_id


@pytest.fixture
def pair(env):
    """같은 코스의 두 날: (숙소 있음, 숙소 모름)"""
    known = plain_day(env)
    unknown = plain_day(env)
    without_lodging(env, unknown)
    return env, known, unknown


# =====================================================================
# Q4 경로 선: 숙소 없으면 도시 중심(첫·마지막 선) 없음
# =====================================================================


@pytest.mark.parametrize("clock", ["00:00", "09:00", "10:05", "10:12", "12:10", "13:00", "14:15", "18:59", "19:00", "19:01", "23:59"])
def test_T14_S30_Q4_숙소_없으면_어느_시각이든_경로에_출발점_좌표가_없다(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        assert HOME not in points(view["route"]), (kind, clock, view["route"])


@pytest.mark.parametrize("clock", ["09:00", "10:12", "13:00", "19:00", "19:01", "23:59"])
def test_T14_S30_Q4_숙소_없으면_경로는_장소들_사이만_핀_순서대로(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        assert collapsed(view["route"]) == pin_coords(view), (kind, clock, view["route"])
        assert joint_ok(view["route"]), (kind, clock)  # Q11: 지난 길 끝 = 남은 길 시작


def test_T14_S30_Q4_숙소_없어도_장소_사이_이동_중_위치는_두_장소_사이에_끼인다(no_lodging_day):
    env, day_id = no_lodging_day
    here = at_place(1.5)  # P01(1km)과 P02(2km) 사이, 12:10 = 1번 → 2번 이동 중 (출발 12:00)
    for kind in ("check", "rehearsal"):
        view = views(env, day_id, "12:10", position=here)[kind]
        p1, p2, p3 = pin_coords(view)
        assert collapsed(view["route"]) == [p1, here, p2, p3], (kind, view["route"])
        assert HOME not in points(view["route"]), kind


def test_T14_S30_Q4_숙소_없는_여행_API로_만든_날도_경로에_도시_중심이_없다(mem):  # noqa: F811
    day_id, date = planned_day(mem, lodging=None)
    center = tuple(mem.app.state.city.center())
    sample = get_now(mem, day_id, at_of(date, "12:00"))
    end = last_end(sample)
    for clock in ("00:00", "12:00", hhmm(end), hhmm(min(end + 1, 23 * 60 + 59)), "23:59"):
        for kind, view in every_view(mem, day_id, at_of(date, clock)).items():
            assert center not in points(view["route"]), (kind, clock)
            assert collapsed(view["route"]) == pin_coords(view), (kind, clock)


@pytest.mark.parametrize("clock", ["09:00", "13:00", "19:01"])
def test_T14_S30_Q4_경계_숙소_있으면_경로는_숙소에서_시작해_숙소로_끝난다_지금_그대로(env, clock):
    day_id = plain_day(env)
    for kind, view in views(env, day_id, clock).items():
        route = view["route"]
        assert tuple(route["done"][0]) == HOME, (kind, clock)
        assert tuple(route["remaining"][-1]) == HOME, (kind, clock)
        assert collapsed(route) == [HOME, *pin_coords(view), HOME], (kind, clock)


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(minutes=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_T14_S30_Q4_속성_숙소_없으면_어느_분이든_경로는_핀_좌표만_순서대로(no_lodging_day, minutes):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, hhmm(minutes)).items():
        route = view["route"]
        assert set(points(route)) <= set(pin_coords(view)), (kind, hhmm(minutes))
        assert collapsed(route) == pin_coords(view), (kind, hhmm(minutes))
        assert joint_ok(route), (kind, hhmm(minutes))


# =====================================================================
# Q3 카드: T-08만 빼고 서버 규칙이 고르는 카드 그대로 · 알약 "오늘 일정 끝"
# =====================================================================


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(minutes=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_T14_S30_Q3_속성_숙소_없으면_숙소_있는_날과_같은_카드_T_08은_숙소_없는_모양(pair, minutes):
    env, known, unknown = pair
    clock = hhmm(minutes)
    with_home, without = views(env, known, clock), views(env, unknown, clock)
    for kind in ("now", "check", "rehearsal"):
        a, b = with_home[kind], without[kind]
        assert [card["type"] for card in b["subs"]] == [card["type"] for card in a["subs"] if card["type"] != "T-08"], (kind, clock)
        if a["main"]["type"] != "T-08":
            assert b["main"]["type"] == a["main"]["type"], (kind, clock)
            assert b["reason"] == a["reason"], (kind, clock)
        else:  # §31 Q2: 숨기지 않고 숙소 없는 모양, Q3 문구
            assert is_no_lodging_t08(b["main"]), (kind, clock, b["main"])
            assert a["reason"] == DAY_OVER_WITH_LODGING, (kind, clock)
            assert b["reason"] == NO_LODGING_DAY_OVER, (kind, clock)
        assert b["status_text"] == a["status_text"], (kind, clock)


@pytest.mark.parametrize("clock", ["19:00", "19:01", "20:30", "23:59"])
def test_T14_S30_Q3_숙소_없어도_마지막_장소_끝_뒤_알약은_오늘_일정_끝(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        assert view["status_text"] == DAY_OVER_PILL, (kind, clock)
        assert is_no_lodging_t08(view["main"]), (kind, clock, view["main"])  # §31 Q2


@pytest.mark.parametrize("clock", ["18:59", "13:00"])
def test_T14_S30_Q3_경계_숙소_없어도_마지막_장소_끝_전에는_오늘_일정_끝이_아니다(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        assert view["status_text"] != DAY_OVER_PILL, (kind, clock)


@pytest.fixture
def empty_no_lodging(env):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    without_lodging(env, day_id)
    return env, day_id


@pytest.mark.parametrize("clock", ["09:00", "13:00", "18:00", "19:00", "23:59"])
def test_T14_S30_Q3_빈_코스_날_숙소_없으면_안내_글은_남고_T_08은_숙소_없는_모양(empty_no_lodging, clock):
    env, day_id = empty_no_lodging
    for kind, view in views(env, day_id, clock).items():
        assert view["reason"] == EMPTY_REASON, (kind, clock)  # §11 Q13 안내 글 그대로
        assert is_no_lodging_t08(view["main"]), (kind, clock, view["main"])  # §31 Q2
        assert view["subs"] == [] and view["pins"] == [], (kind, clock)
        assert view["status_text"] == DAY_OVER_PILL, (kind, clock)
        assert view["day"]["lodging"] is None, (kind, clock)
        assert view["route"] == {"done": [], "remaining": []}, (kind, clock)  # Q4: 장소가 없으니 선도 없다


@pytest.mark.parametrize("clock", ["09:00", "19:00"])
def test_T14_S30_Q3_경계_빈_코스_날_숙소_있으면_T_08과_안내_글_지금_그대로(env, clock):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    for kind, view in views(env, day_id, clock).items():
        assert view["main"]["type"] == "T-08", (kind, clock)
        assert view["reason"] == EMPTY_REASON, (kind, clock)
        assert view["status_text"] == DAY_OVER_PILL, (kind, clock)


# =====================================================================
# Q6 숙소를 골랐는데 좌표를 못 찾음 = 숙소 없음
# =====================================================================


@pytest.fixture
def unlocated_day(mem, monkeypatch):  # noqa: F811
    """숙소 검색 첫 결과를 골랐지만 좌표를 못 구한 여행 (city.lodging_location -> None, TASK-010: 여행은 숙소 없이도 만들어진다)"""
    hit = lodging_hit(mem)
    monkeypatch.setattr(mem.app.state.city, "lodging_location", lambda place_id, now: None)
    day_id, date = planned_day(mem, lodging=hit["place_id"])  # trip.lodging.place_id는 준 값 그대로 (planned_day가 확인)
    return mem, day_id, date


def test_T14_S30_Q6_좌표를_못_찾은_숙소면_now·check·연습_모두_day_lodging_null(unlocated_day):
    osaka, day_id, date = unlocated_day
    for clock in ("09:00", "12:00", "23:59"):
        for kind, view in every_view(osaka, day_id, at_of(date, clock)).items():
            assert view["day"]["lodging"] is None, (kind, clock, view["day"]["lodging"])


def test_T14_S30_Q6_좌표를_못_찾은_숙소면_마지막_뒤_T_08은_숙소_없는_모양이고_경로에_도시_중심이_없다(unlocated_day):
    osaka, day_id, date = unlocated_day
    center = tuple(osaka.app.state.city.center())
    end = last_end(get_now(osaka, day_id, at_of(date, "12:00")))
    for minutes in (end, end + 1, 23 * 60 + 59):
        for kind, view in every_view(osaka, day_id, at_of(date, hhmm(min(minutes, 23 * 60 + 59)))).items():
            assert is_no_lodging_t08(view["main"]), (kind, hhmm(minutes), view["main"])  # §31 Q2
            assert view["reason"] == NO_LODGING_DAY_OVER, (kind, hhmm(minutes))  # §31 Q3
            assert center not in points(view["route"]), (kind, hhmm(minutes))
            assert view["status_text"] == DAY_OVER_PILL, (kind, hhmm(minutes))
