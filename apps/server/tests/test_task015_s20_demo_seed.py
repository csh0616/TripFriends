"""TASK-015 §20 #7 개발용 데모 시드(POST /debug/seed-demo)의 새 선택지 두 개: 가까운 핀(close_pins) · 장소 2곳(two_places).
reviewer가 시뮬레이터에서 P3 도식 벌리기 · 크게 보기 2곳 이름표를 띄우게 한다.

근거: TASK-015 §20 표 #7("가까운 핀 데모 데이터 -> 도식 벌리기 · 2곳 이름표 스크린샷") ·
결정권자 답 11-16(① seed-demo에 새 선택지 "핀이 가까운 날" · "장소 2곳만 있는 날"(backend) ② 가까운 장소는 기존 가짜 팩 · demo_city.json에 섞지 말고
선택지 전용 데이터 파일 -> 기존 테스트 숫자 그대로 ③ 개발 모드에서만, 운영(APP_ENV=production)에서는 꺼짐 — 기존 /debug 차단 방식(길 자체가 없어 404)을 따른다
④ 기존 시드 선택지 결과는 그대로(경계)) · TASK-015 §19(도식 핀 벌리기: 핀 중심 거리 < 28) · TASK-003 §5 · §10 Q26(시드: 3일, 숙소 = 데모 중심).

데이터 (test-writer가 지어낸 값, 앱 테스트 task-015-s20-demo-seed.test.tsx와 같은 파일):
    testdata/demo/seed-close-pins.json: CP01~CP04 4곳. CP01·CP02는 서로 약 50m(도식 거리 < 28은 앱 테스트가 진짜 projectRoute로 확인)
    testdata/demo/seed-two-places.json: TP01·TP02 2곳
    모두 demo_city.json 모양(engine Place), 영업 매일 09:00~21:00 확인됨

계약 (이 테스트가 정한 것 — 문서 없이 정함, backend가 넣는다):
    SeedRequest에 demo_places: "close_pins" | "two_places" (선택, 기본 없음). 다른 값은 지금 본문 검증과 같은 422 (detail[0].loc = ["body", "demo_places"])
    값이 있으면 시드 3일 모두 그 파일의 장소만 쓴다(숙소 · 날짜 · 둘째 날 꼭 갈 곳 규칙은 그대로). 응답 모양은 지금 그대로
    값이 없으면 지금 그대로(demo_city.json 30곳)
    둘째 날 [알아서 짜 줘](mode auto)의 두 안(relaxed · packed) 모두 = 파일의 장소 전부(순서는 엔진 몫), 숙소 = 데모 중심
"""

import importlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from auth_helpers import TESTER, bearer, install_fake_jwks
from planning_api_helpers import DEMO_PATH

DEMO_DIR = next(p / "testdata" / "demo" for p in Path(__file__).resolve().parents if (p / "testdata" / "demo").is_dir())
FILES = {"close_pins": "seed-close-pins.json", "two_places": "seed-two-places.json"}
DEMO_CENTER = {"lat": 35.0, "lng": 135.0}


def _ids(option: str) -> set[str]:
    return {row["id"] for row in json.loads((DEMO_DIR / FILES[option]).read_text(encoding="utf-8"))["places"]}


def _seed(env, body: dict | None = None) -> dict:
    response = env.client.post("/debug/seed-demo", json=body) if body is not None else env.client.post("/debug/seed-demo")
    assert response.status_code == 201, response.text
    return response.json()


def _auto(env, day_id: str) -> dict:
    response = env.client.post(f"/days/{day_id}/planning", json={"mode": "auto"})
    assert response.status_code == 201, response.text
    return response.json()


# ---------- 데이터 자체 (초록이어야 함: test-writer가 넣었다) ----------


def test_T15_S20_7_선택지_데이터는_engine_Place_모양이고_데모_도시_id와_겹치지_않는다():
    from engine.models import Place

    demo_ids = {row["id"] for row in json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]}
    for option, file in FILES.items():
        rows = json.loads((DEMO_DIR / file).read_text(encoding="utf-8"))["places"]
        for row in rows:
            Place.model_validate(row)
        assert not ({row["id"] for row in rows} & demo_ids), option


def test_T15_S20_7_경계_데모_도시는_그대로_30곳():
    assert len(json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]) == 30


def test_T15_S20_7_장소_2곳_데이터는_정확히_2곳_가까운_핀은_3곳_이상_5곳_이하():
    assert len(_ids("two_places")) == 2
    assert 3 <= len(_ids("close_pins")) <= 5  # 크게 보기 모든 이름표 모드(5곳 이하, §17)


# ---------- 시드 선택지 (backend 구현 전 빨강) ----------


@pytest.mark.parametrize("option", list(FILES))
def test_T15_S20_7_선택지를_주면_시드_3일_모두_그_파일의_장소만(env, option):
    seeded = _seed(env, {"demo_places": option})
    assert set(seeded) == {"trip_id", "day_ids"}  # 응답 모양은 지금 그대로
    for day_id in seeded["day_ids"]:
        record = env.repo.get_day(day_id)
        assert set(record.places) == _ids(option)
        assert (record.plan.lodging[0], record.plan.lodging[1]) == (DEMO_CENTER["lat"], DEMO_CENTER["lng"])


@pytest.mark.parametrize("option", list(FILES))
def test_T15_S20_7_선택지_둘째_날_알아서_짜_줘의_두_안이_파일의_장소_전부(env, option):
    seeded = _seed(env, {"demo_places": option})
    course = _auto(env, seeded["day_ids"][1])
    assert [o["label"] for o in course["options"]] == ["relaxed", "packed"]
    for o in course["options"]:
        assert {item["place_id"] for item in o["items"] if item.get("place_id")} == _ids(option), o["label"]
    assert course["day"]["lodging"] == DEMO_CENTER


def test_T15_S20_7_장소_2곳_선택지의_코스는_번호_핀_2개(env):
    course = _auto(env, _seed(env, {"demo_places": "two_places"})["day_ids"][1])
    for o in course["options"]:
        assert [item["seq"] for item in o["items"] if item.get("place_id")] == [1, 2]


def test_T15_S20_7_가까운_핀_선택지의_코스에_CP01과_CP02가_함께_있다(env):
    course = _auto(env, _seed(env, {"demo_places": "close_pins"})["day_ids"][1])
    for o in course["options"]:
        assert {"CP01", "CP02"} <= {item["place_id"] for item in o["items"]}


@pytest.mark.parametrize("value", ["far_pins", "", "CLOSE_PINS", 1])
def test_T15_S20_7_경계_모르는_선택지는_지금_본문_검증과_같은_422(env, value):
    response = env.client.post("/debug/seed-demo", json={"demo_places": value})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["body", "demo_places"]


@pytest.mark.parametrize("body", [None, {}, {"chosen": False}, {"past_days": 0}], ids=["본문_없음", "빈_본문", "chosen_false", "past_days_0"])
def test_T15_S20_7_경계_선택지가_없으면_지금처럼_데모_도시_30곳(env, body):
    demo_ids = {row["id"] for row in json.loads(DEMO_PATH.read_text(encoding="utf-8"))["places"]}
    seeded = _seed(env, body)
    for day_id in seeded["day_ids"]:
        assert set(env.repo.get_day(day_id).places) == demo_ids


# ---------- 운영에서는 꺼짐 (기존 /debug 차단 방식: 길 자체가 없어 404) ----------


@pytest.fixture
def production(monkeypatch):
    import api.main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    install_fake_jwks(monkeypatch)
    try:
        yield importlib.reload(api.main).app
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(api.main)


@pytest.mark.parametrize("option", list(FILES))
def test_T15_S20_7_운영에서는_선택지를_줘도_404(production, option):
    with TestClient(production) as client:
        response = client.post("/debug/seed-demo", json={"demo_places": option}, headers=bearer(TESTER))
        assert response.status_code == 404, response.text
