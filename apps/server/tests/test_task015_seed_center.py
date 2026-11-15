"""TASK-015 §11 시드 v3 center 좌표 규칙 (서버, places.seed.load_seed).

근거: TASK-015 §11 "시드 v3 깨짐 승인" — places/seed.py의 "center는 name_ko·query만" 검사를
**lat·lng는 선택, 둘 다 있거나 둘 다 없음, 범위(위도 −90~90 · 경도 −180~180) 숫자**로 넓힌다 · §9 Q6(center lat·lng는 우리 값, Google 값 아님).

계약:
    load_seed(path)의 center = {name_ko, query} 또는 {name_ko, query, lat, lng} (받은 값 그대로 돌려준다)
    lat·lng 한쪽만 · 범위 밖 · 숫자 아님(글자·null·true/false) -> ValueError
    그 밖의 키는 지금처럼 ValueError (name_ko·query는 그대로 필수)
    범위 끝(±90 · ±180)은 받는다 ("−90~90"을 닫힌 범위로 읽음)
"""

from pathlib import Path

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from test_task010_v14 import SEED

BASE_CENTER = {"name_ko": "난바역", "query": "Namba Station Osaka"}


def seed_with(tmp_path: Path, center: dict) -> Path:
    """정본 seed 사본에서 center만 바꾼 파일 (정본은 읽기만)."""
    data = yaml.safe_load(SEED.read_text(encoding="utf-8"))
    data["center"] = center
    path = tmp_path / "seed-center.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def load(tmp_path: Path, center: dict) -> dict:
    from places.seed import load_seed

    return load_seed(seed_with(tmp_path, center))


@pytest.mark.parametrize(
    "center",
    [
        pytest.param(BASE_CENTER, id="좌표_둘_다_없음"),
        pytest.param({**BASE_CENTER, "lat": 34.6662, "lng": 135.5010}, id="v3_난바역"),
        pytest.param({**BASE_CENTER, "lat": 90, "lng": 180}, id="경계_위도_90_경도_180_정수"),
        pytest.param({**BASE_CENTER, "lat": -90.0, "lng": -180.0}, id="경계_위도_−90_경도_−180"),
        pytest.param({**BASE_CENTER, "lat": 0, "lng": 0}, id="영"),
    ],
)
def test_T15_S11_center_좌표는_선택이고_받으면_그대로(tmp_path, center):
    assert load(tmp_path, center)["center"] == center


@pytest.mark.parametrize(
    "center",
    [
        pytest.param({**BASE_CENTER, "lat": 34.6662}, id="lat만"),
        pytest.param({**BASE_CENTER, "lng": 135.5010}, id="lng만"),
        pytest.param({**BASE_CENTER, "lat": 90.0001, "lng": 135.5}, id="위도_90_넘음"),
        pytest.param({**BASE_CENTER, "lat": -90.0001, "lng": 135.5}, id="위도_−90_밑"),
        pytest.param({**BASE_CENTER, "lat": 34.6, "lng": 180.0001}, id="경도_180_넘음"),
        pytest.param({**BASE_CENTER, "lat": 34.6, "lng": -180.0001}, id="경도_−180_밑"),
        pytest.param({**BASE_CENTER, "lat": "34.6662", "lng": 135.5010}, id="위도_글자"),
        pytest.param({**BASE_CENTER, "lat": 34.6662, "lng": "135.5010"}, id="경도_글자"),
        pytest.param({**BASE_CENTER, "lat": None, "lng": None}, id="둘_다_null"),
        pytest.param({**BASE_CENTER, "lat": True, "lng": 135.5}, id="위도_true"),
        pytest.param({**BASE_CENTER, "lat": 34.6, "lng": 135.5, "place_id": "FAKE-x"}, id="그_밖의_키_place_id"),
        pytest.param({"name_ko": "난바역", "lat": 34.6, "lng": 135.5}, id="query_없음"),
    ],
)
def test_T15_S11_경계_center_좌표가_틀리면_ValueError(tmp_path, center):
    with pytest.raises(ValueError):
        load(tmp_path, center)


@settings(max_examples=40, deadline=None)
@given(lat=st.floats(-90, 90, allow_nan=False), lng=st.floats(-180, 180, allow_nan=False))
def test_T15_S11_범위_안_숫자면_언제나_받는다(tmp_path_factory, lat, lng):
    center = {**BASE_CENTER, "lat": lat, "lng": lng}
    assert load(tmp_path_factory.mktemp("c"), center)["center"] == center


@settings(max_examples=40, deadline=None)
@given(lat=st.one_of(st.floats(min_value=90, exclude_min=True, allow_infinity=False), st.floats(max_value=-90, exclude_max=True, allow_infinity=False)))
def test_T15_S11_위도_범위_밖은_언제나_ValueError(tmp_path_factory, lat):
    with pytest.raises(ValueError):
        load(tmp_path_factory.mktemp("c"), {**BASE_CENTER, "lat": lat, "lng": 135.5})
