"""TASK-014 §31 (서버): 숙소 없는 T-08 모양 · 하루 끝 "수고했어" 문구 · 1번 장소 전 위치를 경로 선에.

근거: TASK-014 §31 표 Q2("숙소 없음 + 하루 끝·빈 코스 날의 메인 카드: T-08을 숨기지 않고 '숙소 없는 모양'으로 바꾼다 (메인 카드가 비면 안 됨):
제목 '오늘 일정 끝', 숙소 줄·[숙소로 길 안내] 없음, 본문은 Q3 문구. 빈 코스 날은 빈 코스 안내 글을 그대로 함께. §29 ④·§30의 'T-08 숨김'은 이걸로 바꿔 읽음") ·
Q3("하루 끝 이유 문구 (숙소 없음): '오늘 일정이 끝났어. 오늘도 수고했어!' (숙소 있음은 지금 문구 '…숙소로 가 볼까?' 그대로)") ·
Q4("1번 장소 전 위치를 경로 선에: 넣는다 ('지금 위치 → 1번' 선, 장소 사이와 같게)") ·
§30 Q4(숙소 없으면 첫·마지막 선 없음)·Q6(좌표를 못 찾은 숙소 = 숙소 없음) · TASK-006 §12 R1·R2(이동 중일 때만 위치가 경계 점)·§11 Q11·Q13 · TASK-007 F1·F2.

계약 (이 테스트가 정한 것, 승인 대기):
    응답 모양 — 숙소 없는 T-08 (문서에 칸 이름이 없어 가장 단순한 안: 기존 칸을 null 허용으로):
        main = {"type": "T-08", "go_home_min": (정하지 않음 — 질문), "lodging": null, "map_url": null}
        OpenAPI NowCardT08.lodging·map_url은 null을 받는다 (숙소가 있으면 지금처럼 {lat, lng}·문자열)
    숙소 없음(lodging_known=False, 좌표 못 찾은 숙소 포함) + 마지막 장소 끝(정각 포함) 뒤:
        main = 숙소 없는 T-08, reason = "오늘 일정이 끝났어. 오늘도 수고했어!", subs = [], status_text = "오늘 일정 끝"
    숙소 없음 + 빈 코스 날: main = 숙소 없는 T-08, reason = "오늘 코스가 비어 있어" 그대로 (안내 글이 함께)
    숙소 있음 (경계): main T-08 = {lodging: 숙소 좌표, map_url: 문자열}, reason = "오늘 일정이 끝났어. 숙소로 가 볼까?" 그대로
    마지막 장소 끝 1분 전(18:59): 숙소와 상관없이 main은 T-08이 아니고 이유는 하루 끝 문구가 아니다
    카드 제목 "오늘 일정 끝"·숙소 줄 없음은 앱이 그린다 (서버는 lodging·map_url null만 준다) — 앱 테스트 몫
    Q4 숙소 없음 + 1번 장소로 이동 중(1번 출발 시각 10:00 ~ 1번 시작 10:12 전) + 위치를 실음(check·연습 check):
        done + remaining을 이어 연달아 같은 점을 줄이면 [지금 위치, P1, P2, P3], remaining[0] = 지금 위치, done이 있으면 done[-1] = 지금 위치
        위치를 안 실으면 [P1, P2, P3] (§30 그대로). 1번 시작 정각(10:12)부터는 위치를 실어도 [P1, P2, P3] (이동 중이 아님, R2)
        "1번 출발 시각 전"(예: 09:59)에 위치를 실은 경우는 문서가 갈리지 않게 정하지 않는다 (질문)
    Q4 경계 숙소 있음: [숙소, 지금 위치, P1, P2, P3, 숙소] (지금 그대로)
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
    resolve,
    without_lodging,
)
from test_task014_s30_no_lodging import collapsed, joint_ok, pin_coords, views
from planning_api_helpers import week_hours
from planning_helpers import place
from trip_helpers import at_place, plain_day, plant

HOME = (35.0, 135.0)  # trip_helpers: 심은 하루의 출발점(숙소 자리)
DAY_OVER_WITH_LODGING = "오늘 일정이 끝났어. 숙소로 가 볼까?"  # TASK-006 §12 R1 (숙소 있음 그대로)
DAY_OVER_PILL = "오늘 일정 끝"  # TASK-007 F1
EMPTY_REASON = "오늘 코스가 비어 있어"  # TASK-006 §11 Q13
TOWARD_P1 = at_place(0.5)  # 숙소 자리(0km)와 P01(1km) 사이


@pytest.fixture
def no_lodging_day(env):
    day_id = plain_day(env)  # 1번 P01 10:12~12:00(이동 12 → 출발 10:00) · 2번 12:20~14:00 · 3번 14:30~19:00
    without_lodging(env, day_id)
    return env, day_id


@pytest.fixture
def empty_no_lodging(env):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    without_lodging(env, day_id)
    return env, day_id


# =====================================================================
# Q3 문구 (정확히) · Q2 숙소 없는 T-08 모양
# =====================================================================


def test_T14_S31_Q3_숙소_없는_하루_끝_문구는_정확히_수고했어():
    assert NO_LODGING_DAY_OVER == "오늘 일정이 끝났어. 오늘도 수고했어!"


@pytest.mark.parametrize("clock", ["19:00", "19:01", "21:00", "23:59"])
def test_T14_S31_Q2_숙소_모름_하루_끝은_숙소_없는_T_08_수고했어_보조_없음_알약_오늘_일정_끝(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        main = view["main"]
        assert main["type"] == "T-08", (kind, clock)
        assert "lodging" in main and main["lodging"] is None, (kind, clock, main)
        assert "map_url" in main and main["map_url"] is None, (kind, clock, main)
        assert view["reason"] == NO_LODGING_DAY_OVER, (kind, clock)
        assert view["subs"] == [], (kind, clock)
        assert view["status_text"] == DAY_OVER_PILL, (kind, clock)


@pytest.mark.parametrize("clock", ["19:00", "19:01", "23:59"])
def test_T14_S31_Q3_경계_숙소_있음_하루_끝은_숙소_좌표·길_안내_주소와_숙소로_가_볼까_그대로(env, clock):
    day_id = plain_day(env)
    for kind, view in views(env, day_id, clock).items():
        main = view["main"]
        assert main["type"] == "T-08", (kind, clock)
        assert main["lodging"] == {"lat": HOME[0], "lng": HOME[1]}, (kind, clock)
        assert isinstance(main["map_url"], str) and main["map_url"], (kind, clock)
        assert view["reason"] == DAY_OVER_WITH_LODGING, (kind, clock)
        assert view["reason"] != NO_LODGING_DAY_OVER, (kind, clock)


@pytest.mark.parametrize("lodging_known", [True, False])
def test_T14_S31_Q2_경계_마지막_장소_끝_1분_전은_숙소와_상관없이_T_08도_하루_끝_문구도_아니다(env, lodging_known):
    day_id = plain_day(env)
    if not lodging_known:
        without_lodging(env, day_id)
    for kind, view in views(env, day_id, "18:59").items():
        assert view["main"]["type"] != "T-08", (kind, lodging_known)
        assert view["reason"] not in (NO_LODGING_DAY_OVER, DAY_OVER_WITH_LODGING), (kind, lodging_known)


@pytest.mark.parametrize("clock", ["00:00", "09:00", "13:00", "19:00", "23:59"])
def test_T14_S31_Q2_빈_코스_날_숙소_없으면_숙소_없는_T_08과_빈_코스_안내_글이_함께(empty_no_lodging, clock):
    env, day_id = empty_no_lodging
    for kind, view in views(env, day_id, clock).items():
        assert is_no_lodging_t08(view["main"]), (kind, clock, view["main"])
        assert view["reason"] == EMPTY_REASON, (kind, clock)
        assert view["subs"] == [], (kind, clock)
        assert view["status_text"] == DAY_OVER_PILL, (kind, clock)


def test_T14_S31_Q2_경계_빈_코스_날_숙소_있으면_T_08에_숙소_좌표와_길_안내_주소(env):
    day_id = plant(env, [], places={"P01": place("P01", hours=week_hours())}, go_home=0)
    for kind, view in views(env, day_id, "13:00").items():
        assert view["main"]["type"] == "T-08", kind
        assert view["main"]["lodging"] == {"lat": HOME[0], "lng": HOME[1]}, kind
        assert isinstance(view["main"]["map_url"], str) and view["main"]["map_url"], kind
        assert view["reason"] == EMPTY_REASON, kind


def test_T14_S31_Q2_API로_만든_숙소_없는_여행_마지막_뒤는_숙소_없는_T_08과_수고했어(mem):  # noqa: F811
    day_id, date = planned_day(mem, lodging=None)
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for minutes in (end, end + 1, 23 * 60 + 59):
        for kind, view in every_view(mem, day_id, at_of(date, hhmm(min(minutes, 23 * 60 + 59)))).items():
            assert is_no_lodging_t08(view["main"]), (kind, hhmm(minutes), view["main"])
            assert view["reason"] == NO_LODGING_DAY_OVER, (kind, hhmm(minutes))


def test_T14_S31_Q2_좌표를_못_찾은_숙소도_마지막_뒤는_숙소_없는_T_08과_수고했어(mem, monkeypatch):  # noqa: F811
    hit = lodging_hit(mem)
    monkeypatch.setattr(mem.app.state.city, "lodging_location", lambda place_id, now: None)
    day_id, date = planned_day(mem, lodging=hit["place_id"])
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for kind, view in every_view(mem, day_id, at_of(date, hhmm(min(end + 1, 23 * 60 + 59)))).items():
        assert is_no_lodging_t08(view["main"]), (kind, view["main"])
        assert view["reason"] == NO_LODGING_DAY_OVER, kind


def test_T14_S31_Q2_경계_API로_만든_숙소_있는_여행_마지막_뒤는_숙소_좌표_T_08과_숙소로_가_볼까(mem):  # noqa: F811
    hit = lodging_hit(mem)
    day_id, date = planned_day(mem, lodging=hit["place_id"])
    lat, lng = mem.app.state.city.lodging_location(hit["place_id"], mem.app.state.clock())
    end = last_end(get_now(mem, day_id, at_of(date, "12:00")))
    for kind, view in every_view(mem, day_id, at_of(date, hhmm(min(end + 1, 23 * 60 + 59)))).items():
        assert view["main"]["lodging"] == {"lat": lat, "lng": lng}, kind
        assert isinstance(view["main"]["map_url"], str) and view["main"]["map_url"], kind
        assert view["reason"] == DAY_OVER_WITH_LODGING, kind


@settings(max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(minutes=st.integers(min_value=0, max_value=23 * 60 + 59))
def test_T14_S31_Q2_속성_숙소_모름이면_T_08은_늘_숙소_없는_모양이고_하루_끝_문구와_짝(no_lodging_day, minutes):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, hhmm(minutes)).items():
        is_t08 = view["main"]["type"] == "T-08"
        assert not is_t08 or is_no_lodging_t08(view["main"]), (kind, hhmm(minutes), view["main"])
        assert is_t08 == (view["reason"] == NO_LODGING_DAY_OVER), (kind, hhmm(minutes))
        assert view["reason"] != DAY_OVER_WITH_LODGING, (kind, hhmm(minutes))


# =====================================================================
# OpenAPI: NowCardT08.lodging·map_url은 null을 받는다
# =====================================================================


def _allows_null(spec: dict, schema: dict) -> bool:
    schema = resolve(spec, schema)
    if schema.get("type") == "null" or schema.get("nullable") is True:
        return True
    if isinstance(schema.get("type"), list) and "null" in schema["type"]:
        return True
    return any(_allows_null(spec, option) for option in schema.get("anyOf", []) + schema.get("oneOf", []))


def _has_option(spec: dict, schema: dict, pick) -> bool:
    schema = resolve(spec, schema)
    if pick(schema):
        return True
    return any(_has_option(spec, option, pick) for option in schema.get("anyOf", []) + schema.get("oneOf", []))


def test_T14_S31_Q2_OpenAPI의_NowCardT08_lodging·map_url은_null을_받고_원래_모양도_그대로():
    from api.main import app

    spec = app.openapi()
    card = spec["components"]["schemas"]["NowCardT08"]["properties"]
    assert _allows_null(spec, card["lodging"])
    assert _has_option(spec, card["lodging"], lambda s: set(s.get("properties", {})) == {"lat", "lng"})
    assert _allows_null(spec, card["map_url"])
    assert _has_option(spec, card["map_url"], lambda s: s.get("type") == "string")


# =====================================================================
# Q4 1번 장소 전 위치를 경로 선에 ("지금 위치 → 1번", 장소 사이와 같게)
# =====================================================================


@pytest.mark.parametrize("clock", ["10:00", "10:05", "10:11"])
def test_T14_S31_Q4_숙소_없고_1번으로_이동_중_위치를_실으면_경로는_지금_위치_P1_P2_P3(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind in ("check", "rehearsal"):
        view = views(env, day_id, clock, position=TOWARD_P1)[kind]
        route = view["route"]
        assert collapsed(route) == [TOWARD_P1, *pin_coords(view)], (kind, clock, route)
        assert tuple(route["remaining"][0]) == TOWARD_P1, (kind, clock, route)
        assert not route["done"] or tuple(route["done"][-1]) == TOWARD_P1, (kind, clock, route)
        assert HOME not in [tuple(p) for p in (*route["done"], *route["remaining"])], (kind, clock)
        assert joint_ok(route), (kind, clock)


@pytest.mark.parametrize("clock", ["10:00", "10:05", "10:11"])
def test_T14_S31_Q4_경계_숙소_없고_위치를_안_실으면_경로는_P1부터(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind, view in views(env, day_id, clock).items():
        assert collapsed(view["route"]) == pin_coords(view), (kind, clock, view["route"])


@pytest.mark.parametrize("clock", ["10:12", "11:00"])
def test_T14_S31_Q4_경계_숙소_없고_1번_시작_정각부터는_위치를_실어도_경로에_위치가_없다(no_lodging_day, clock):
    env, day_id = no_lodging_day
    for kind in ("check", "rehearsal"):
        view = views(env, day_id, clock, position=TOWARD_P1)[kind]
        assert collapsed(view["route"]) == pin_coords(view), (kind, clock, view["route"])


@pytest.mark.parametrize("clock", ["10:00", "10:11"])
def test_T14_S31_Q4_경계_숙소_있으면_1번으로_이동_중_경로는_숙소_지금_위치_P1_P2_P3_숙소_지금_그대로(env, clock):
    day_id = plain_day(env)
    for kind in ("check", "rehearsal"):
        view = views(env, day_id, clock, position=TOWARD_P1)[kind]
        assert collapsed(view["route"]) == [HOME, TOWARD_P1, *pin_coords(view), HOME], (kind, clock, view["route"])
