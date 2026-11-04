"""가상 도시 데이터 검사. 근거: TASK-002 §2, AC-17, §7 Q2·Q13·Q20."""

import json
import re
from collections import Counter
from pathlib import Path

from planning_helpers import distance_km, to_min

from engine.models import Place

FIXTURE = Path(__file__).parents[1] / "engine" / "fixtures" / "demo_city.json"
CENTER = (35.0, 135.0)
NAME = re.compile(r"^[가-힣][가-힣 ]* [A-Z]$")
TIME = re.compile(r"^(?:[01]\d|2\d):[0-5]\d$")


def load() -> list[Place]:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [Place.model_validate(row) for row in data["places"]]


def test_Q38_파일_맨_바깥은_places_키_하나():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    assert isinstance(data["places"], list)


def test_AC17_30곳_id는_D01부터_D30():
    assert sorted(p.id for p in load()) == [f"D{i:02d}" for i in range(1, 31)]


def test_AC17_Q20_종류별_개수():
    assert Counter(p.category for p in load()) == {
        "cafe": 4,
        "food": 4,
        "walk": 4,
        "museum": 4,
        "shop": 4,
        "experience": 4,
        "landmark": 3,
        "night": 3,
    }


def test_AC17_Q20_모두_중심에서_3km_이내():
    assert all(distance_km(CENTER, (p.lat, p.lng)) <= 3.0 for p in load())


def test_AC17_Q20_이름은_가상_패턴이고_겹치지_않음():
    names = [p.name for p in load()]
    assert all(NAME.match(name) for name in names), [n for n in names if not NAME.match(n)]
    assert len(names) == len(set(names))


def test_AC17_Q20_확인상태_모름3_미확인5_확인됨22():
    assert Counter(p.hours_status for p in load()) == {"unknown": 3, "unverified": 5, "confirmed": 22}


def test_AC17_Q13_Q20_영업시간_None과_모름이_일치():
    for p in load():
        assert (p.hours is None) == (p.hours_status == "unknown"), p.id


def test_AC17_머무는_시간_값_있는_곳_10곳_최소_보통_최대_순서():
    stays = [p.stay for p in load() if p.stay is not None]
    assert len(stays) == 10
    assert all(s.min <= s.typical <= s.max for s in stays)


def test_AC17_붐빔_가격_범위():
    for p in load():
        assert 1 <= p.crowd_level <= 5, p.id
        assert 1 <= p.price_level <= 4, p.id


def test_AC17_Q12_영업시간_표기_범위():
    for p in load():
        for o in p.hours or []:
            assert 0 <= o.weekday <= 6, p.id
            assert TIME.match(o.open) and TIME.match(o.close), p.id
            assert to_min(o.open) < to_min(o.close) <= to_min("29:59"), p.id
