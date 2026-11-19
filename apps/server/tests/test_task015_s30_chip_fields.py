"""TASK-015 §30 칩 시트 1 · 2 (서버): T-01 · T-02 · T-07 카드에 "지금 확인 가능" 값과 장소 지도 링크를 더한다.

근거: TASK-015 §30 "칩 시트 질문 4개" 1(서버가 카드에 '지금 확인 가능' 값을 더함. 창 규칙은 기존 영업 확인(T-05)과 같은 값) ·
2(T-01 · T-02 · T-07 카드에 장소 지도 링크 — 장소 ID로 만든 Google 지도 URL, 링크라 저장 · 파생 문제 없음, T-05와 같은 방식) ·
TASK-008 A1(미확인 · 모름이고 그날 확인 기록이 없을 때만) · A2(창 = 출발 30분 전 ≤ at < 도착) · Q26(창 밖 visit-check는 409) ·
trip/now.py check_target(고정 일정 장소는 영업 확인 대상이 아님, §14) · T-05 map_url(구글 place_id가 있으면 maps_url, 없으면 map_search_url(좌표))

계약 (이 파일이 정한 것 — 필드 이름은 test-writer 제안, backend · PM 확정 전):
  T-01 · T-02 · T-07 카드에 두 칸을 더한다
    can_confirm_hours: bool — 그 카드의 장소가 지금 영업 확인(visit-check) 대상이면 true. = 같은 at의 visit_check_target과 같은 장소일 때.
      그래서 T-05가 그 장소로 뜨는 때와 정확히 같다(경계 포함). 장소가 없거나 고정 일정이면 false
    place_map_url: str | None — 그 카드 장소의 구글 지도 링크. T-05 map_url과 같은 함수 · 같은 값(같은 장소면 같은 URL). 장소가 없으면 null
      T-01은 item, T-02는 next_item, T-07은 fixed의 장소
  T-02의 map_url(길찾기)은 그대로 둔다. 다른 카드 칸은 바뀌지 않는다
"""

import pytest
from planning_helpers import place
from trip_helpers import OPEN_LATE, STAY, at_time, fixed_at, item, now, plant, spot, types

from trip.visit import map_search_url

def unverified(pid: str = "P02", km: float = 2.0, status: str = "unverified", hours=OPEN_LATE):
    return place(pid, category="cafe", km=km, hours=hours, status=status if hours is not None else None, stay=STAY)


# 1번 P01 10:12~12:00(이동 12), 2번 P02 12:20~14:00(이동 20 → 출발 12:00), 3번 P03 14:30~19:00(이동 30).
# P02의 영업 확인 창(A2) = 11:30 ≤ at < 12:20 (test_task008_visit.py와 같은 하루)
def visit_day(env, second=None) -> str:
    places = {"P01": spot("P01", 1.0), "P02": second or unverified(), "P03": spot("P03", 3.0)}
    items = [item(1, "P01", "10:12", "12:00", 12), item(2, "P02", "12:20", "14:00", 20), item(3, "P03", "14:30", "19:00", 30)]
    return plant(env, items, places)


def cards(view: dict) -> list[dict]:
    return [view["main"], *view["subs"]]


def card_of(view: dict, kind: str) -> dict | None:
    return next((card for card in cards(view) if card["type"] == kind), None)


def place_of(card: dict) -> dict:
    """카드의 장소 줄 (T-01 item · T-02 next_item · T-07 fixed)"""
    return {"T-01": card.get("item"), "T-02": card.get("next_item"), "T-07": card.get("fixed")}[card["type"]]


def visit_check(env, day_id: str, place_id: str, clock: str, was_open: bool):
    return env.client.post(f"/places/{place_id}/visit-checks", json={"day_id": day_id, "at": at_time(clock), "was_open": was_open})


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# ---------- 모양 ----------


@pytest.mark.parametrize("clock", ["11:00", "11:30", "11:50", "12:30"])
def test_T15_S30_T_01_T_02에_can_confirm_hours와_place_map_url이_있다(env, clock):
    view = now(env, visit_day(env), clock)
    for card in cards(view):
        if card["type"] in ("T-01", "T-02"):
            assert "can_confirm_hours" in card and type(card["can_confirm_hours"]) is bool, card
            assert "place_map_url" in card, card


# ---------- can_confirm_hours = T-05 창과 같은 값 (경계 포함) ----------


def test_T15_S30_경계_창_시작_1분_전_11_29는_T_02가_false(env):
    view = now(env, visit_day(env), "11:29")
    t02 = card_of(view, "T-02")
    if t02 is not None:
        assert t02["can_confirm_hours"] is False
    assert "T-05" not in types(cards(view))


@pytest.mark.parametrize("clock", ["11:30", "11:40", "11:50", "12:00", "12:19"], ids=["창_시작_정각", "20분_전", "출발_10분_전", "출발_정각", "도착_1분_전"])
def test_T15_S30_창_안이면_P02_T_02가_true(env, clock):
    view = now(env, visit_day(env), clock)
    t02 = card_of(view, "T-02")
    assert t02 is not None, types(cards(view))
    assert t02["next_item"]["place_id"] == "P02"
    assert t02["can_confirm_hours"] is True


@pytest.mark.parametrize("clock", ["12:20", "12:30", "13:49"], ids=["도착_정각", "도착_뒤", "일정_안(3번_출발_10분_전_T_02_메인_전)"])
def test_T15_S30_경계_도착_정각부터_P02_T_01은_false(env, clock):
    view = now(env, visit_day(env), clock)
    t01 = card_of(view, "T-01")
    assert t01 is not None and t01["item"]["place_id"] == "P02"
    assert t01["can_confirm_hours"] is False


def test_T15_S30_확인됨_장소는_창_안이어도_false(env):
    view = now(env, visit_day(env, second=unverified(status="confirmed")), "11:50")
    assert card_of(view, "T-02")["can_confirm_hours"] is False


def test_T15_S30_영업시간_모름도_창_안이면_true(env):
    view = now(env, visit_day(env, second=unverified(hours=None)), "11:50")
    t02 = card_of(view, "T-02")
    assert t02["next_item"]["facts"][0]["status"] == "unknown"
    assert t02["can_confirm_hours"] is True


def test_T15_S30_그날_확인했으면_창_안이어도_false(env):
    day_id = visit_day(env)
    assert visit_check(env, day_id, "P02", "11:40", True).status_code == 200
    assert card_of(now(env, day_id, "11:50"), "T-02")["can_confirm_hours"] is False


def test_T15_S30_1분씩_돌려도_카드의_can_confirm_hours는_그_장소_T_05가_뜨는_때와_같다(env):
    day_id = visit_day(env)
    for minute in range(10 * 60, 15 * 60):
        view = now(env, day_id, hhmm(minute))
        t05 = card_of(view, "T-05")
        t05_place = t05["place"]["place_id"] if t05 else None
        for card in cards(view):
            if card["type"] not in ("T-01", "T-02"):
                continue
            pid = place_of(card)["place_id"]
            assert card["can_confirm_hours"] is (pid is not None and pid == t05_place), (hhmm(minute), card["type"], pid)


def test_T15_S30_창_안_true일_때_visit_check는_200_창_밖_false일_때는_409(env):
    day_id = visit_day(env)
    assert card_of(now(env, day_id, "11:29"), "T-02") is None or card_of(now(env, day_id, "11:29"), "T-02")["can_confirm_hours"] is False
    assert visit_check(env, day_id, "P02", "11:29", True).status_code == 409
    assert card_of(now(env, day_id, "11:30"), "T-02")["can_confirm_hours"] is True
    assert visit_check(env, day_id, "P02", "11:30", True).status_code == 200


# ---------- place_map_url = T-05 map_url과 같은 함수 ----------


@pytest.mark.parametrize("clock", ["11:30", "11:50"])
def test_T15_S30_T_02_place_map_url은_같은_장소_T_05_map_url과_같다(env, clock):
    view = now(env, visit_day(env), clock)
    t02, t05 = card_of(view, "T-02"), card_of(view, "T-05")
    assert t02 is not None and t05 is not None, types(cards(view))
    assert t05["place"]["place_id"] == t02["next_item"]["place_id"]
    assert t02["place_map_url"] == t05["map_url"]


def test_T15_S30_T_01_place_map_url은_장소_좌표_구글_지도_검색_링크(env):
    t01 = card_of(now(env, visit_day(env), "12:30"), "T-01")
    entry = t01["item"]
    assert t01["place_map_url"] == map_search_url(entry["lat"], entry["lng"])  # 데모 · 심은 장소는 구글 place_id가 없어 좌표 (T-05와 같은 분기)


def test_T15_S30_T_02_길찾기_map_url은_그대로(env):
    t02 = card_of(now(env, visit_day(env), "11:50"), "T-02")
    assert "/maps/dir/" in t02["map_url"]
    assert "/maps/search/" in t02["place_map_url"]


def test_T15_S30_place_map_url에_장소_이름이_들어가지_않는다(env):
    view = now(env, visit_day(env), "11:50")
    t02 = card_of(view, "T-02")
    assert t02["next_item"]["name"] not in t02["place_map_url"]
    assert t02["place_map_url"].startswith("https://www.google.com/maps/search/?api=1&query")


# ---------- T-07 (고정 일정) ----------


def fixed_day(env, fixed_place=None, with_place: bool = True) -> str:
    """2번이 고정 일정: 15:00 시작, 이동 20분 → 14:40 출발. 출발 15분 전(14:25)부터 T-07 (test_task006_now.py와 같은 하루)"""
    f01 = fixed_place or spot("F01", 2.0)
    items = [item(1, "P01", "10:12", "14:40", 12), item(2, "F01" if with_place else None, "15:00", "16:00", 20, fixed=True), item(3, "P03", "16:30", "19:00", 30)]
    places = {"P01": spot("P01", 1.0), "P03": spot("P03", 3.0)}
    if with_place:
        places["F01"] = f01
    return plant(env, items, places, fixed=(fixed_at(f01 if with_place else None, "15:00", "16:00"),))


def test_T15_S30_T_07에_두_칸이_있고_고정_일정_장소는_영업_확인_대상이_아니라_false(env):
    view = now(env, fixed_day(env, fixed_place=unverified("F01", km=2.0)), "14:30")
    t07 = card_of(view, "T-07")
    assert t07 is not None, types(cards(view))
    assert t07["can_confirm_hours"] is False
    assert "T-05" not in types(cards(view))


def test_T15_S30_T_07_place_map_url은_고정_일정_장소_좌표_링크(env):
    view = now(env, fixed_day(env), "14:30")
    t07 = card_of(view, "T-07")
    f01 = spot("F01", 2.0)
    assert t07["place_map_url"] == map_search_url(f01.lat, f01.lng)
