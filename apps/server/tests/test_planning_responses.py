"""응답 모양과 대본. 근거: TASK-003 §5, §6, §10, AC-17, TASK-002 §7 Q13, §8 Q25."""

import uuid
from datetime import date

import pytest
from planning_api_helpers import (
    CHIP_CATEGORIES,
    CHOICES,
    DIRECTION_GROUPS,
    LABELS,
    MSG_CLARIFY,
    MSG_EXHAUSTED,
    MSG_FIRST,
    MSG_NO_DIRECTION,
    QUESTION_TAIL,
    QUESTION_TEXT,
    UNKNOWN_TEXT,
    WHY_NONE,
    as_dict,
    assert_batch_shape,
    assert_course_shape,
    assert_picks_shape,
    assert_place_shape,
    assert_session_shape,
    at_of,
    cafes,
    candidate,
    demo_places,
    direction_city,
    first_option_id,
    ids,
    opening_fact,
    week_hours,
)
from planning_helpers import BASE, MONDAY, day_plan, place

from engine.models import Opening, Reactions
from engine.planning import pick_directions

FIRST_SIX = [f"P{i:02d}" for i in range(1, 7)]
SUNDAY = date(2026, 11, 15)


def city(count=24):
    return as_dict(cafes(count))


def full_flow(env, day_id):
    """성공 응답을 모두 지나가는 흐름. (이름, 응답 JSON, 모양 검사) 목록을 돌려준다."""
    results = []

    def record(name, response, status, check):
        assert response.status_code == status, f"{name}: {response.text}"
        results.append((name, response.json(), check))
        return response.json()

    session = record("start", env.start(day_id), 201, assert_session_shape)
    sid = session["session_id"]
    first = record("answer", env.answer(session, [], "조용한 데"), 200, assert_batch_shape)
    target = ids(first)[0]
    record("like", env.react(sid, target), 200, assert_picks_shape)
    record("skip", env.react(sid, ids(first)[1], "skip"), 200, assert_picks_shape)
    record("unlike", env.react(sid, target, "unlike"), 200, assert_picks_shape)
    record("clarify", env.next(sid, text=UNKNOWN_TEXT), 200, assert_batch_shape)
    record("after_clarify", env.next(sid, text=UNKNOWN_TEXT), 200, assert_batch_shape)
    record("direction", env.next(sid, direction_id="closer"), 200, assert_batch_shape)
    record("text", env.next(sid, text="밤에"), 200, assert_batch_shape)
    third = record("empty", env.next(sid), 200, assert_batch_shape)
    pick = ids(third)[0]
    record("like2", env.react(sid, pick), 200, assert_picks_shape)
    course = record("compose", env.compose(sid), 200, assert_course_shape)
    in_course = course["options"][0]["items"][0]["place_id"]  # 코스에 들어간 곳만 조정한다 (Q15)
    record("adjust", env.adjust(sid, first_option_id(course), in_course, 15), 200, assert_course_shape)
    record("back", env.back(sid), 200, assert_batch_shape)
    record("compose2", env.compose(sid), 200, assert_course_shape)
    return results, sid


# ---------- 모양 ----------


def test_E01_AC17_모든_성공_응답이_S6_모양_심어둔_하루(env):
    results, _ = full_flow(env, env.plant_day(city(60)))
    assert [name for name, _, _ in results] == [
        "start",
        "answer",
        "like",
        "skip",
        "unlike",
        "clarify",
        "after_clarify",
        "direction",
        "text",
        "empty",
        "like2",
        "compose",
        "adjust",
        "back",
        "compose2",
    ]
    for _, body, check in results:
        check(body)


def test_E02_AC17_모든_성공_응답이_S6_모양_가상_도시_둘째_날(env):
    seed = env.seed()
    results, _ = full_flow(env, seed["day_ids"][1])
    for _, body, check in results:
        check(body)


def test_E03_S6_첫_질문_내용(env):
    seed = env.seed()
    data = env.start(seed["day_ids"][1]).json()
    assert_session_shape(data)
    assert data["question"]["text"] == QUESTION_TEXT
    assert data["question"]["choices"] == CHOICES
    assert {c["label"] for c in CHOICES} == set(CHIP_CATEGORIES)


def test_E04_S5_세션과_코스안_ID는_uuid4(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    assert uuid.UUID(sid).version == 4
    for option in course["options"]:
        assert uuid.UUID(option["option_id"]).version == 4


def test_E05_S6_선택_응답과_시드_응답_모양(env):
    seed = env.seed()
    assert set(seed) == {"trip_id", "day_ids"}
    assert type(seed["trip_id"]) is str
    assert len(seed["day_ids"]) == 3 and all(type(d) is str for d in seed["day_ids"])
    _, course = env.composing(seed["day_ids"][0], likes=("D01",))
    option_id = course["options"][0]["option_id"]
    assert env.select(option_id).json() == {"day_id": seed["day_ids"][0], "option_id": option_id}


def test_E06_S6_장소_값은_데이터_그대로_앱용_필드만(env):
    places = demo_places()
    _, batch = env.browse(env.plant_day(places), ["맛집 투어"])
    data = candidate(batch, "D07")["place"]
    assert_place_shape(data)
    source = places["D07"]
    for field in ("id", "name", "category", "lat", "lng", "crowd_level", "price_level", "mood_tags"):
        assert data[field] == getattr(source, field)


def test_E07_S6_코스_항목은_엔진_값과_필드_모두(env):
    sid, course = env.composing(env.plant_day(city()), likes=("P01",))
    assert course["session_id"] == sid
    item = course["options"][0]["items"][0]
    assert item["seq"] == 1
    assert item["place_id"] == "P01"
    assert item["stay_source"] == "auto"
    assert item["is_fixed"] is False
    assert item["hours_status"] == "confirmed"


# ---------- facts.value ----------

MON = 0
TUE = 1
SUN = 6


def at(weekday, open_at, close_at):
    return Opening(weekday=weekday, open=open_at, close=close_at)


FACT_CASES = [
    pytest.param(MONDAY, [at(MON, "10:00", "18:00")], "confirmed", "10:00-18:00", "confirmed", id="한_구간"),
    pytest.param(
        MONDAY,
        [at(MON, "11:00", "14:00"), at(MON, "17:00", "22:00")],
        "confirmed",
        "11:00-14:00,17:00-22:00",
        "confirmed",
        id="두_구간_쉼표_공백없음",
    ),
    pytest.param(
        MONDAY,
        [at(MON, "08:00", "10:00"), at(MON, "12:00", "14:00"), at(MON, "17:00", "22:00")],
        "confirmed",
        "08:00-10:00,12:00-14:00,17:00-22:00",
        "confirmed",
        id="세_구간",
    ),
    pytest.param(
        MONDAY,
        [at(MON, "10:00", "18:00"), at(TUE, "09:00", "12:00")],
        "confirmed",
        "10:00-18:00",
        "confirmed",
        id="다른_요일_구간은_뺀다_월요일",
    ),
    pytest.param(
        SUNDAY,
        [at(MON, "10:00", "18:00"), at(SUN, "09:00", "12:00")],
        "confirmed",
        "09:00-12:00",
        "confirmed",
        id="그날_요일_일요일",
    ),
    pytest.param(MONDAY, [at(MON, "18:00", "26:00")], "confirmed", "18:00-26:00", "confirmed", id="자정_넘김"),
    pytest.param(MONDAY, [at(MON, "10:00", "18:00")], "unverified", "10:00-18:00", "unverified", id="미확인"),
    pytest.param(MONDAY, None, "unknown", None, "unknown", id="모름"),
    pytest.param(MONDAY, None, "confirmed", None, "unknown", id="영업시간_없으면_상태값과_상관없이_모름"),
    pytest.param(MONDAY, None, "unverified", None, "unknown", id="영업시간_없고_미확인이어도_모름"),
]


@pytest.mark.parametrize(("day", "hours", "status", "value", "out_status"), FACT_CASES)
def test_E08_S6_영업_구간과_확인_상태(env, day, hours, status, value, out_status):
    target = place("P01", hours=hours, status=status)
    places = as_dict([target, *cafes(6, start=2)])
    _, batch = env.browse(env.plant_day(places, day_plan(day=day)))
    fact = opening_fact(candidate(batch, "P01")["place"])
    assert fact["value"] == value
    assert fact["status"] == out_status
    assert fact["source_type"] == "demo"
    assert fact["checked_at"] is None


def test_E09_S6_가상_도시의_세_상태(env):
    _, batch = env.browse(env.plant_day(demo_places()), ["카페"])
    facts = {pid: opening_fact(candidate(batch, pid)["place"]) for pid in ("D01", "D02", "D03")}
    assert (facts["D01"]["value"], facts["D01"]["status"]) == ("08:00-19:00", "confirmed")
    assert (facts["D02"]["value"], facts["D02"]["status"]) == ("08:00-19:00", "unverified")
    assert (facts["D03"]["value"], facts["D03"]["status"]) == (None, "unknown")


@pytest.mark.parametrize(
    ("hours", "status", "expected"),
    [
        ([at(TUE, "10:00", "18:00")], "confirmed", "confirmed"),
        ([], "confirmed", "confirmed"),
        ([at(TUE, "10:00", "18:00")], "unverified", "unverified"),
        ([], "unverified", "unverified"),
        ([at(TUE, "10:00", "18:00")], "unknown", "unverified"),  # §10-9 Q9·Q10: 영업 구간이 있으면 모든 요일 unverified
        ([], "unknown", "unknown"),
    ],
    ids=["확인됨_그날만_휴무", "확인됨_빈_목록", "미확인_그날만_휴무", "미확인_빈_목록", "모름_그날만_휴무", "모름_빈_목록"],
)
def test_E10_Q9_Q10_그날_휴무면_null이고_미확인을_확인됨으로_내보내지_않음(env, hours, status, expected):
    places = as_dict([place("P01", hours=hours, status=status), *cafes(6, start=2)])
    _, batch = env.browse(env.plant_day(places))
    fact = opening_fact(candidate(batch, "P01")["place"])
    assert (fact["value"], fact["status"]) == (None, expected)


def test_E48_Q9_가상_도시_월요일_휴무_박물관도_데이터의_상태_그대로(env):
    # D13·D14는 화~일만 연다. 계획한 날은 월요일 (day_plan 기본값)
    _, batch = env.browse(env.plant_day(demo_places()), ["전시·체험"])
    facts = {pid: opening_fact(candidate(batch, pid)["place"]) for pid in ("D13", "D14", "D21")}
    assert (facts["D13"]["value"], facts["D13"]["status"]) == (None, "confirmed")
    assert (facts["D14"]["value"], facts["D14"]["status"]) == (None, "unverified")
    assert (facts["D21"]["value"], facts["D21"]["status"]) == (None, "unknown")


def test_E11_Q10_영업시간이_있는데_상태가_unknown이면_unverified(env):
    places = as_dict([place("P01", hours=week_hours(), status="unknown"), *cafes(6, start=2)])
    _, batch = env.browse(env.plant_day(places))
    fact = opening_fact(candidate(batch, "P01")["place"])
    assert (fact["value"], fact["status"]) == ("08:00-18:00", "unverified")


# ---------- 방향 이름표 8개와 message 대본 ----------


def like_for(env, sid, direction):
    # different는 좋아한 곳이 있어야 맞는 곳이 생긴다 (TASK-002 §8 Q24)
    if direction == "different":
        assert env.react(sid, "P01").status_code == 200


@pytest.mark.parametrize("direction", list(DIRECTION_GROUPS))
def test_E12_S6_방향버튼_이름표_8개가_message와_why에(env, direction):
    places, groups = direction_city()
    sid, _ = env.browse(env.plant_day(places))
    like_for(env, sid, direction)
    data = env.next(sid, direction_id=direction).json()
    assert_batch_shape(data)
    label = LABELS[direction]
    assert data["message"] == f"{label} 쪽으로 다시 찾아봤어!"
    assert data["exhausted"] is False
    assert data["direction_relaxed"] is False
    assert len(data["candidates"]) == 6
    assert set(ids(data)) <= (set(groups[direction]) if direction != "different" else set(places) - set(FIRST_SIX))
    for entry in data["candidates"]:
        assert entry["why"] == f"{label} 쪽이에요"


TEXTS = {
    "quieter": "한적한 데",
    "closer": "가까운 데",
    "cheaper": "저렴한 데",
    "different": "다른 느낌",
    "photo": "사진 찍기 좋은 곳",
    "indoor": "실내로",
    "food": "먹을 데",
    "night": "밤에 갈 곳",
}


@pytest.mark.parametrize("direction", list(TEXTS))
def test_E13_S6_글로_말한_방향도_같은_이름표(env, direction):
    places, groups = direction_city()
    sid, _ = env.browse(env.plant_day(places))
    like_for(env, sid, direction)
    data = env.next(sid, text=TEXTS[direction]).json()
    assert data["message"] == f"{LABELS[direction]} 쪽으로 다시 찾아봤어!"
    assert data["clarify"] is None
    assert env.values(sid)["last_direction"] == direction
    if direction != "different":
        assert set(ids(data)) <= groups[direction]


def test_E14_S6_대본_첫_묶음(env):
    _, batch = env.browse(env.plant_day(city()))
    assert batch["message"] == MSG_FIRST
    assert batch["round"] == 1
    assert batch["clarify"] is None


def test_E15_S6_대본_방향_없음(env):
    sid, _ = env.browse(env.plant_day(city()))
    data = env.next(sid).json()
    assert data["message"] == MSG_NO_DIRECTION
    assert data["clarify"] is None


def test_E16_S6_대본_되묻기(env):
    sid, _ = env.browse(env.plant_day(city()))
    assert env.next(sid, text=UNKNOWN_TEXT).json()["message"] == MSG_CLARIFY


def test_E17_S6_대본_더_고를래는_방향_없음과_같다(env):
    sid, _ = env.composing(env.plant_day(city()))
    assert env.back(sid).json()["message"] == MSG_NO_DIRECTION


@pytest.mark.parametrize(
    ("total", "exhausted", "size", "message"),
    [(10, True, 4, MSG_EXHAUSTED), (11, False, 5, MSG_NO_DIRECTION), (12, False, 6, MSG_NO_DIRECTION), (6, True, 0, MSG_EXHAUSTED)],
    ids=["남은곳_4_미만", "남은곳_5_정각", "남은곳_6", "남은곳_0"],
)
def test_E18_S6_대본_더_볼_곳이_없을_때_경계(env, total, exhausted, size, message):
    sid, _ = env.browse(env.plant_day(city(total)))
    data = env.next(sid).json()
    assert_batch_shape(data)
    assert data["exhausted"] is exhausted
    assert len(data["candidates"]) == size
    assert data["message"] == message


def test_E19_Q6_방향이_있어도_더_볼_곳이_없으면_exhausted_대본(env):
    sid, _ = env.browse(env.plant_day(city(10)))
    assert env.next(sid, direction_id="closer").json()["message"] == MSG_EXHAUSTED


@pytest.mark.parametrize(
    ("total", "message", "exhausted"),
    [(4, MSG_EXHAUSTED, True), (5, MSG_FIRST, False)],
    ids=["전체_4곳", "전체_5곳_경계"],
)
def test_E20_Q6_첫_묶음이_5곳_미만이면_exhausted_대본(env, total, message, exhausted):
    _, batch = env.browse(env.plant_day(city(total)))
    assert batch["message"] == message
    assert batch["exhausted"] is exhausted


def test_E21_Q6_글로_방향을_말한_첫_묶음은_첫_묶음_대본(env):
    places = as_dict(cafes(8, crowd=1))
    _, batch = env.browse(env.plant_day(places), [], "조용한 데")
    assert batch["message"] == MSG_FIRST


def test_E22_Q6_되묻기와_exhausted가_함께면_되묻기_대본(env):
    sid, _ = env.browse(env.plant_day(city(4)))
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["message"] == MSG_CLARIFY
    assert data["exhausted"] is True


@pytest.mark.parametrize(
    ("total", "exhausted"),
    [(10, True), (11, False)],
    ids=["안_보여준_곳_4", "안_보여준_곳_5_경계"],
)
def test_E47_Q37_되묻기의_exhausted는_지금_안_보여준_곳_5_미만인지(env, total, exhausted):
    sid, first = env.browse(env.plant_day(city(total)))
    assert first["exhausted"] is False  # 첫 묶음을 만들 때는 안 보여 준 곳이 10곳 이상
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert data["exhausted"] is exhausted
    assert data["message"] == MSG_CLARIFY
    assert ids(data) == ids(first)
    assert data["clarify"]


@pytest.mark.parametrize(
    ("matching", "relaxed"),
    [(4, True), (5, False)],
    ids=["맞는곳_4_채움", "맞는곳_5_안채움"],
)
def test_E23_S6_direction_relaxed_경계(env, matching, relaxed):
    items = cafes(6, crowd=5) + cafes(matching, start=7, crowd=1) + cafes(8, start=30, crowd=5)
    sid, _ = env.browse(env.plant_day(as_dict(items)))
    data = env.next(sid, direction_id="quieter").json()
    assert data["direction_relaxed"] is relaxed


def test_E24_Q7_방향을_못_지켜_채운_곳은_기본_문장(env):
    items = cafes(6, crowd=5) + cafes(4, start=7, crowd=1) + cafes(8, start=30, crowd=5)
    sid, _ = env.browse(env.plant_day(as_dict(items)))
    data = env.next(sid, direction_id="quieter").json()
    label = LABELS["quieter"]
    assert data["direction_relaxed"] is True
    assert data["message"] == f"{label} 쪽으로 다시 찾아봤어!"
    assert candidate(data, "P07")["why"] == f"{label} 쪽이에요"
    assert candidate(data, "P30")["why"] == WHY_NONE


# ---------- why 대본 3갈래 ----------


def why_city(extra=None):
    """P01~P06: 첫 묶음. P07~P12: 다음 묶음. extra로 다음 묶음의 값을 바꾼다."""
    extra = extra or {}
    first = [
        place("P01", tags=("골목",), hours=week_hours()),
        place("P02", tags=("현지",), hours=week_hours()),
        place("P03", tags=("야외",), hours=week_hours()),
        *cafes(3, start=4),
    ]
    second = [
        place("P07", tags=("골목",), hours=week_hours(), **extra),
        place("P08", tags=("조용", "골목"), hours=week_hours(), **extra),
        place("P09", tags=(), hours=week_hours(), **extra),
        place("P10", tags=("현지",), hours=week_hours(), **extra),
        place("P11", tags=("야외",), hours=week_hours(), **extra),
        place("P12", tags=("다른태그",), hours=week_hours(), **extra),
    ]
    return as_dict(first + second)


def test_E25_S6_why_좋아한_곳과_겹치는_태그(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.react(sid, "P01")
    data = env.next(sid).json()
    assert candidate(data, "P07")["why"] == "골목 좋아해서 골랐어요"
    assert candidate(data, "P08")["why"] == "골목 좋아해서 골랐어요"  # 후보의 맨 앞 태그(조용)가 아니라 겹치는 태그


def test_E26_S6_why_겹치지_않고_방향도_없으면_기본(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.react(sid, "P01")
    data = env.next(sid).json()
    for pid in ("P09", "P10", "P11", "P12"):
        assert candidate(data, pid)["why"] == WHY_NONE


def test_E27_S6_why_겹치지_않고_방향이_있으면_이름표(env):
    sid, _ = env.browse(env.plant_day(why_city({"price": 1})))
    env.react(sid, "P01")
    data = env.next(sid, direction_id="cheaper").json()
    for pid in ("P09", "P10", "P11", "P12"):
        assert candidate(data, pid)["why"] == f"{LABELS['cheaper']} 쪽이에요"


def test_E28_S6_why_겹치면서_방향도_있으면_태그가_먼저(env):
    sid, _ = env.browse(env.plant_day(why_city({"price": 1})))
    env.react(sid, "P01")
    data = env.next(sid, direction_id="cheaper").json()
    assert candidate(data, "P07")["why"] == "골목 좋아해서 골랐어요"


def test_E29_S6_why_넘긴_곳의_태그는_좋아한_것이_아니다(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.react(sid, "P02", "skip")
    data = env.next(sid).json()
    assert candidate(data, "P10")["why"] == WHY_NONE


def test_E30_S6_why_취소한_곳의_태그는_좋아한_것이_아니다(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.react(sid, "P03")
    env.react(sid, "P03", "unlike")
    data = env.next(sid).json()
    assert candidate(data, "P11")["why"] == WHY_NONE


def test_E31_S6_why_첫_묶음_좋아한_곳_없고_방향_없으면_기본(env):
    _, batch = env.browse(env.plant_day(city()))
    assert {c["why"] for c in batch["candidates"]} == {WHY_NONE}


def test_E32_S6_why_첫_묶음에_글로_말한_방향이_있으면_이름표(env):
    places = as_dict(cafes(8, crowd=1))
    _, batch = env.browse(env.plant_day(places), [], "조용한 데")
    assert {c["why"] for c in batch["candidates"]} == {f"{LABELS['quieter']} 쪽이에요"}


def test_E33_S6_why_더_고를래_묶음은_방향이_없다(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.react(sid, "P01")
    assert env.compose(sid).status_code == 200
    data = env.back(sid).json()
    assert candidate(data, "P07")["why"] == "골목 좋아해서 골랐어요"
    assert candidate(data, "P09")["why"] == WHY_NONE


def test_E34_S6_why_두번째_못알아들음_묶음은_방향이_없다(env):
    sid, _ = env.browse(env.plant_day(why_city()))
    env.next(sid, text=UNKNOWN_TEXT)
    data = env.next(sid, text=UNKNOWN_TEXT).json()
    assert {c["why"] for c in data["candidates"]} == {WHY_NONE}


def test_E35_Q8_겹치는_태그가_여럿이면_후보_태그_순서의_첫번째(env):
    places = as_dict(
        [
            place("P01", tags=("골목", "조용"), hours=week_hours()),
            *cafes(5, start=2),
            place("P07", tags=("조용", "골목"), hours=week_hours()),
        ]
    )
    sid, _ = env.browse(env.plant_day(places))
    env.react(sid, "P01")
    assert candidate(env.next(sid).json(), "P07")["why"] == "조용 좋아해서 골랐어요"


# ---------- §10에서 새로 정한 값 ----------

DAY_WORDS = {1: "첫째 날은", 2: "둘째 날은", 3: "셋째 날은", 4: "넷째 날은", 5: "다섯째 날은"}


@pytest.mark.parametrize("number", list(DAY_WORDS))
def test_E39_Q5_첫_질문의_날짜_말_다섯째까지(env, number):
    data = env.session(env.plant_day(city(), day_number=number))
    assert data["question"]["text"] == DAY_WORDS[number] + QUESTION_TAIL


@pytest.mark.parametrize("number", [6, 7, 10])
def test_E40_Q36_여섯째부터는_n일째는(env, number):
    text = env.session(env.plant_day(city(), day_number=number))["question"]["text"]
    assert text == f"{number}일째는" + QUESTION_TAIL


def test_E41_Q5_시드의_세_날은_trip_순서대로(env):
    day_ids = env.seed()["day_ids"]
    assert [env.session(d)["question"]["text"] for d in day_ids] == [
        DAY_WORDS[n] + QUESTION_TAIL for n in (1, 2, 3)
    ]


def test_E42_Q31_빈_묶음이면_round_그대로_exhausted(env):
    sid, first = env.browse(env.plant_day(city(6)))
    data = env.next(sid).json()
    assert_batch_shape(data)
    assert data["candidates"] == []
    assert data["exhausted"] is True
    assert data["round"] == first["round"] == 1
    assert env.values(sid)["round"] == 1
    assert env.values(sid)["batch"] == []
    assert env.next(sid).json()["round"] == 1


def test_E43_Q31_더_고를래도_빈_묶음이면_round_그대로(env):
    sid, _ = env.composing(env.plant_day(city(6)))
    data = env.back(sid).json()
    assert data["candidates"] == []
    assert data["exhausted"] is True
    assert data["round"] == 1


def test_E44_Q6_더_고를래도_더_볼_곳이_없으면_exhausted_대본(env):
    sid, _ = env.composing(env.plant_day(city(10)))
    assert env.back(sid).json()["message"] == MSG_EXHAUSTED


def test_E45_Q6_두번째_못알아들음도_더_볼_곳이_없으면_exhausted_대본(env):
    sid, _ = env.browse(env.plant_day(city(10)))
    env.next(sid, text=UNKNOWN_TEXT)
    assert env.next(sid, text=UNKNOWN_TEXT).json()["message"] == MSG_EXHAUSTED


def test_E46_Q7_첫_묶음에서_방향을_못_지켜_채운_곳도_기본_문장(env):
    places = as_dict(cafes(2, crowd=1) + cafes(6, start=3, crowd=5))
    _, batch = env.browse(env.plant_day(places), [], "조용한 데")
    assert batch["direction_relaxed"] is True
    assert batch["message"] == MSG_FIRST
    assert candidate(batch, "P01")["why"] == f"{LABELS['quieter']} 쪽이에요"
    assert candidate(batch, "P03")["why"] == WHY_NONE


# ---------- 묶음의 값 ----------


def test_E36_S6_directions는_pick_directions_결과에_이름표(env):
    places = city()
    plan = day_plan()
    _, batch = env.browse(env.plant_day(places, plan))
    expected = pick_directions(
        [places[p] for p in FIRST_SIX],
        [p for pid, p in places.items() if pid not in FIRST_SIX],
        Reactions(liked=[], skipped=[]),
        places,
        None,
        BASE,
        at_of(plan),
    )
    assert batch["directions"] == [{"id": d, "label": LABELS[d]} for d in expected]


@pytest.mark.parametrize("direction", ["closer", "photo"])
def test_E37_S6_직전_방향은_directions에_없다(env, direction):
    places, _ = direction_city()
    sid, _ = env.browse(env.plant_day(places))
    data = env.next(sid, direction_id=direction).json()
    assert direction not in [d["id"] for d in data["directions"]]


def test_E38_S6_picks_count와_round(env):
    sid, batch = env.browse(env.plant_day(city()))
    assert (batch["round"], batch["picks_count"]) == (1, 0)
    for pid in ("P01", "P02", "P03"):
        env.react(sid, pid)
    env.react(sid, "P03", "unlike")
    second = env.next(sid).json()
    assert (second["round"], second["picks_count"]) == (2, 2)
    clarify = env.next(sid, text=UNKNOWN_TEXT).json()
    assert (clarify["round"], clarify["picks_count"]) == (2, 2)
    third = env.next(sid).json()
    assert third["round"] == 3
