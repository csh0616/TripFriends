"""TASK-009 서버 쪽 정리. 근거: TASK-009 §B B1·B2, §C C1·C2, §6(시드 실패 = S0 표 그대로), §7 AC-1·AC-3·AC-5,
TASK-008 §13 H4·§14·§17, DESIGN-001 §4-7(조사는 앱·서버 대본 공통).

계약 (이 테스트가 정한 이름, 보고서 ④):
    조사 함수 하나 (B1): trip/phrase.py `with_particle(word: str, pair: str) -> str`
        pair는 "이/가" "은/는" "을/를" "으로/로" 중 하나. 돌려주는 값 = word + 고른 조사 (사이 띄어쓰기 없음)
    경계 표: 저장소 맨 위 testdata/particles.json 하나를 앱(apps/mobile/__tests__/particle.test.ts)과 이 파일이 함께 읽는다 (AC-3).
        v2 §9: 빈 문자열 = 받침 없음(Q1), 일본어·기호 끝 = 받침 없음(Q3), 숫자·영문은 읽는 소리로 받침(Q7)
    엔진 공개 이름 (C1): engine/planning.py `buffer_min(label: str) -> int` — relaxed 15, packed 5 (엔진 `_limits()`의 값을 그대로).
        trip/retime.py `buffer_min(label)`은 그 값을 읽는다 (복사하지 않는다)
    시드 (C2): POST /debug/seed-demo 는 부를 때마다 새 trip_id·day_ids (chosen이면 day.day_id도 새것)

새 이름은 테스트 함수 안에서 불러온다 (구현 전에도 이 파일의 다른 테스트가 모인다).
"""

from auth_helpers import TESTER, bearer, install_fake_jwks  # TASK-012 §11: 시드도 Bearer
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st
from planning_api_helpers import assert_error
from test_task008_visit import answered, cards, closed_view, demo_scenario, hhmm, leave_of, named_alt, replaces, seed_chosen
from trip_helpers import now

# mutmut은 테스트를 apps/server/mutants/ 안에 복사해 돌리므로 고정 깊이 대신 위로 올라가며 정본(저장소 맨 위 testdata/)을 찾는다
TABLE_PATH = next(
    d / "testdata" / "particles.json"
    for d in Path(__file__).resolve().parents
    if (d / "testdata" / "particles.json").is_file()
)
TABLE = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
PAIRS = TABLE["pairs"]
CASES = TABLE["cases"]
READY = CASES  # §9 Q1로 빈 문자열도 기대값이 정해져 건너뛰는 줄이 없다
# B2 대본(장소 이름이 들어가는 문장)은 이름이 있는 줄만. 빈 이름의 대본은 문서에 없다
NAMED = [case for case in CASES if case["word"] != ""]

# 시험용 기준 (B1 + v2 §9): 받침 없음 → 가·는·를·로, ㄹ 받침 → 로, 그 밖 받침 → 이·은·을·으로.
# 숫자·영문은 읽는 소리로(Q7), 일본어·기호 끝·빈 문자열은 받침 없음(Q1·Q3)
NO_BATCHIM = {"이/가": "가", "은/는": "는", "을/를": "를", "으로/로": "로"}
BATCHIM = {"이/가": "이", "은/는": "은", "을/를": "을", "으로/로": "으로"}
RIEUL = 8  # 종성 번호 ㄹ
# §9 Q7 읽는 소리의 받침: "ㄹ" / "있음" / 없으면 받침 없음
DIGIT_SOUND = {"0": "있음", "1": "ㄹ", "3": "있음", "6": "있음", "7": "ㄹ", "8": "ㄹ"}  # 영·일·삼·육·칠·팔
LETTER_SOUND = {"L": "ㄹ", "M": "있음", "N": "있음", "R": "ㄹ"}  # 엘·엠·엔·알
LETTER_SOUND |= {k.lower(): v for k, v in LETTER_SOUND.items()}  # TASK-010 §E3: 소문자 l·m·n·r은 대문자와 같다


def sound(word: str) -> str | None:
    if word == "":
        return None
    last = word[-1]
    code = ord(last) - 0xAC00
    if 0 <= code <= 0xD7A3 - 0xAC00:
        jong = code % 28
        return None if jong == 0 else ("ㄹ" if jong == RIEUL else "있음")
    return DIGIT_SOUND.get(last) or LETTER_SOUND.get(last)


def oracle(word: str, pair: str) -> str:
    kind = sound(word)
    if kind is None:
        return word + NO_BATCHIM[pair]
    if kind == "ㄹ" and pair == "으로/로":
        return word + "로"
    return word + BATCHIM[pair]


def with_particle(word: str, pair: str) -> str:
    from trip.phrase import with_particle as target

    return target(word, pair)


# ---------- 경계 표 자체 (AC-3: 표에 꼭 있어야 하는 경계) ----------


def test_T9_AC3_표_자체_확인_네_조사와_필요한_경계가_모두_있다():
    assert PAIRS == ["이/가", "은/는", "을/를", "으로/로"]
    for case in CASES:
        assert set(case["expected"]) == set(PAIRS), case["word"]
    kinds = " ".join(case["kind"] for case in CASES)
    for needed in ("받침 없음", "ㄹ 받침", "겹받침", "영문", "숫자", "빈 문자열", "일본어", "기호"):
        assert needed in kinds, needed


def test_T9_AC3_Q7_표에_숫자_끝_0부터_9와_영문_L_M_N_R이_모두_있다():
    ends = {case["word"][-1] for case in CASES if case["word"]}
    assert set("0123456789") <= ends
    assert set("LMNR") <= ends
    assert set("lmnr") <= ends  # TASK-010 §E3
    assert ends & set("ABCDEFGHIJKOPQSTUVWXYZ")  # 받침 없는 영문 예도 있다


def test_T9_AC3_표_자체_확인_준비된_줄은_문서_규칙과_같다():
    # 표를 잘못 적으면 앱·서버가 함께 틀린 쪽으로 맞춰진다. 표 값을 문서 규칙(oracle)으로 한 번 더 본다
    for case in READY:
        for pair in PAIRS:
            assert case["expected"][pair] == oracle(case["word"], pair), (case["word"], pair)


# ---------- B1 조사 함수: 공유 경계 표 ----------


@pytest.mark.parametrize(
    ("word", "pair", "expected"),
    [(case["word"], pair, case["expected"][pair]) for case in READY for pair in PAIRS],
    ids=[f"{case['kind']}-{pair}" for case in READY for pair in PAIRS],
)
def test_T9_B1_AC3_공유_경계_표(word, pair, expected):
    assert with_particle(word, pair) == expected


HANGUL = st.integers(min_value=0xAC00, max_value=0xD7A3).map(chr)
ALNUM = st.sampled_from(list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))  # TASK-010 §E3: 소문자 l·m·n·r도 넣는다
PREFIX = st.text(alphabet=st.sampled_from("가나다 카페골목ABz09"), max_size=8)


@given(prefix=PREFIX, last=HANGUL, pair=st.sampled_from(["이/가", "은/는", "을/를", "으로/로"]))
def test_T9_B1_속성_한글_끝_글자는_받침에_따라(prefix, last, pair):
    word = prefix + last
    assert with_particle(word, pair) == oracle(word, pair)


@given(prefix=PREFIX, last=ALNUM, pair=st.sampled_from(["이/가", "은/는", "을/를", "으로/로"]))
def test_T9_B1_Q7_속성_영문_숫자_끝은_읽는_소리대로(prefix, last, pair):
    word = prefix + last
    assert with_particle(word, pair) == oracle(word, pair)


@given(prefix=PREFIX, last=HANGUL, pair=st.sampled_from(["이/가", "은/는", "을/를", "으로/로"]))
def test_T9_B1_속성_조사는_끝_글자만_본다(prefix, last, pair):
    # 앞 글자가 무엇이든 붙는 조사는 끝 글자 하나로만 정해진다
    assert with_particle(prefix + last, pair)[len(prefix) :] == with_particle(last, pair)


# ---------- B2 서버 대본 (장소 이름이 들어가는 문장) ----------
# 서버 대본에서 장소 이름 뒤에 받침에 따라 바뀌는 조사가 붙는 곳은 닫힘 대안 "{대안}{으로/로} 대신 가기" 하나다.
# "{닫힌 곳} 빼고 가기", 늦어짐 "{이름들} 빼고 {고정 일정}에 여유 있게"는 받침과 무관한 말만 붙어 그대로 둔다.


@pytest.mark.parametrize("case", NAMED, ids=[case["kind"] for case in NAMED])
def test_T9_B2_닫힘_대안_이유는_조사_함수의_으로_로(case):
    from trip.phrase import swap_reason

    assert swap_reason(case["word"]) == f"{case['expected']['으로/로']} 대신 가기"


@pytest.mark.parametrize(
    ("name", "expected"),
    [("닭", "닭으로 대신 가기"), ("값", "값으로 대신 가기"), ("길", "길로 대신 가기"), ("cafe", "cafe로 대신 가기"), ("카페 1", "카페 1로 대신 가기"), ("카페 3", "카페 3으로 대신 가기"), ("카페 M", "카페 M으로 대신 가기"), ("언덕 카페 B", "언덕 카페 B로 대신 가기")],
    ids=["겹받침_ㄺ", "겹받침_ㅄ", "ㄹ받침_한_글자", "영문_소문자", "숫자_1_ㄹ", "Q7_숫자_3_ㅁ", "Q7_영문_M_ㅁ", "AC4_영문_대문자"],
)
def test_T9_B2_API_닫힘_대안_이유도_같은_표대로(env, name, expected):
    _, view = closed_view(env, extra=(named_alt(name),))
    (proposal,) = replaces(view["main"])
    assert proposal["closed"]["reordered"] is False  # 시험 자체 확인: 자리에 넣은 안
    assert proposal["reason"] == expected


@pytest.mark.parametrize("case", NAMED, ids=[case["kind"] for case in NAMED])
@pytest.mark.parametrize("was_must", [False, True], ids=["꼭_갈_곳_아님", "꼭_갈_곳"])
def test_T9_B2_빼고_가기_이유는_조사_없이_그대로(case, was_must):
    from trip.phrase import skip_reason

    tail = " · 꼭 갈 곳이었어" if was_must else ""
    assert skip_reason(case["word"], was_must) == f"{case['word']} 빼고 가기{tail}"


@pytest.mark.parametrize(
    ("names", "title", "expected"),
    [
        ([], None, "머무는 시간 줄여서 다 가기"),
        (["박물관"], None, "박물관 빼고 남은 일정 여유 있게"),
        (["카페", "닭"], "저녁 예약", "카페, 닭 빼고 저녁 예약에 여유 있게"),
        (["언덕 카페 B"], "체험 1", "언덕 카페 B 빼고 체험 1에 여유 있게"),
    ],
    ids=["빠지는_곳_없음", "고정_일정_없음", "고정_일정_있음", "영문_숫자"],
)
def test_T9_B2_늦어짐_이유는_TASK_007_대본_그대로(names, title, expected):
    from trip.alternatives import reason_text

    assert reason_text(names, title) == expected


# ---------- C1 retime의 쉬는 시간은 엔진 공개 이름으로 ----------


@pytest.mark.parametrize(("label", "minutes"), [("relaxed", 15), ("packed", 5)])
def test_T9_C1_엔진_공개_이름의_쉬는_시간(label, minutes):
    from engine.planning import buffer_min

    assert buffer_min(label) == minutes


@pytest.mark.parametrize(("label", "minutes"), [("relaxed", 15), ("packed", 5)])
def test_T9_C1_AC5_retime의_쉬는_시간_값은_그대로(label, minutes):
    from trip.retime import buffer_min

    assert buffer_min(label) == minutes


def test_T9_C1_retime은_엔진_값을_읽는다_엔진이_바뀌면_따라간다(monkeypatch):
    # 복사한 값(15·5)이면 엔진 기준이 바뀌어도 그대로 남는다. 엔진 공개 이름을 읽으면 따라간다
    import engine.planning as engine
    from trip.retime import buffer_min

    original = engine._limits()
    monkeypatch.setattr(engine, "_limits", lambda: original._replace(relaxed_buffer_min=23, packed_buffer_min=7))
    assert engine.buffer_min("relaxed") == 24
    assert (buffer_min("relaxed"), buffer_min("packed")) == (23, 7)


# ---------- C2 데모 다시 시작 ----------


def seed_plain(env) -> dict:
    response = env.client.post("/debug/seed-demo")
    assert response.status_code == 201, response.text
    return response.json()


def ids_of(seeded: dict) -> set[str]:
    found = {seeded["trip_id"], *seeded["day_ids"]}
    if "day" in seeded:
        found.add(seeded["day"]["day_id"])
    return found


@pytest.mark.parametrize(
    "first, second",
    [(seed_plain, seed_plain), (seed_chosen, seed_chosen), (seed_plain, seed_chosen), (seed_chosen, seed_plain)],
    ids=["일반_두_번", "chosen_두_번", "일반_뒤_chosen", "chosen_뒤_일반"],
)
def test_T9_C2_AC5_시드를_두_번_부르면_여행_날_ID가_모두_다르다(env, first, second):
    a, b = first(env), second(env)
    assert ids_of(a).isdisjoint(ids_of(b))


def test_T9_C2_시드를_여러_번_불러도_매번_새_ID(env):
    seen: set[str] = set()
    for _ in range(4):
        fresh = ids_of(seed_chosen(env))
        assert seen.isdisjoint(fresh)
        seen |= fresh


def test_T9_C2_AC5_이전_데모의_닫혔어_기록과_사건이_새_데모에_섞이지_않는다(env):
    _, old_day, entry = demo_scenario(env)
    clock = hhmm(leave_of(entry) - 30)
    closed = answered(env, old_day, entry.place_id, clock, False)
    assert closed["main"]["type"] == "T-06"  # 시험 자체 확인: 이전 데모에 확인 기록과 닫힘 사건이 생겼다
    _, new_day, new_entry = demo_scenario(env)
    assert new_day != old_day
    assert new_entry.place_id == entry.place_id and new_entry.start == entry.start  # 같은 시드 규칙이라 같은 장소·시각
    view = now(env, new_day, clock)
    assert view["event"] is None
    assert "T-06" not in [card["type"] for card in cards(view)]
    assert view["main"]["type"] == "T-05"  # 새 데모에서는 다시 묻는다 (확인 기록 없음)
    fact = view["main"]["facts"][0]
    assert fact["status"] in {"unverified", "unknown"}
    assert (fact["source_type"], fact["checked_at"]) == ("demo", None)
    assert env.app.state.trip_repo.visit_checks(new_day) == {}


def test_T9_C2_AC5_이전_데모의_열었어_기록도_새_데모에_없다(env):
    _, old_day, entry = demo_scenario(env)
    clock = hhmm(leave_of(entry) - 30)
    opened = answered(env, old_day, entry.place_id, clock, True)
    assert "T-05" not in [card["type"] for card in cards(opened)]  # 시험 자체 확인
    _, new_day, _ = demo_scenario(env)
    view = now(env, new_day, clock)
    assert view["main"]["type"] == "T-05"
    assert view["main"]["facts"][0]["source_type"] == "demo"


def test_T9_C2_새_시드가_이전_데모의_기록을_지우지도_않는다(env):
    # "섞이지 않게" = 새 ID로 따로 둔다. 이전 날의 기록을 건드리지 않는다
    _, old_day, entry = demo_scenario(env)
    answered(env, old_day, entry.place_id, hhmm(leave_of(entry) - 30), False)
    seed_chosen(env)
    record = env.app.state.trip_repo.get_visit_check(old_day, entry.place_id)
    assert record is not None and record.was_open is False


def test_T9_C2_운영이면_시드는_여전히_404(monkeypatch):
    import importlib

    import api.main

    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.setenv("APP_ENV", "production")
    install_fake_jwks(monkeypatch)  # TASK-012 §11: 시드도 Bearer (운영은 그래도 404)
    try:
        with TestClient(importlib.reload(api.main).app) as client:
            assert_error(client.post("/debug/seed-demo", headers=bearer(TESTER)), 404)  # TASK-012 §11: 토큰이 있어도 운영은 404
            assert_error(client.post("/debug/seed-demo", json={"chosen": True}, headers=bearer(TESTER)), 404)
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)
