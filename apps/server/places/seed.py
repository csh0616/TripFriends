"""seed 읽기 (TASK-010 §S, v2 선택 키 open_space·curated_hours §13). docs/data/osaka-seed.yaml은 읽기만 한다."""

from pathlib import Path
from typing import Any

import yaml

CATEGORIES = {"cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"}
OPTIONAL_KEYS = {"open_space", "curated_hours"}  # seed v2 (§13 O1·O2): 우리가 정한 값. 팩에도 남는다 (Google 값 아님)
ROW_KEYS = {"id", "name_ko", "aliases", "query", "area", "category", "stay", "crowd_level", "price_level", "mood_tags"}
CITY_TIMEZONES = {"osaka": "Asia/Tokyo"}  # 도시 시간대는 도시 팩에 (A8)


def load_seed(path: Path) -> dict[str, Any]:
    """{city_code, timezone, center: {name_ko, query}, areas: [{id, name_ko, query}], places: [줄]}. 줄 모양이 틀리면 ValueError."""
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    city_code = data.get("city_code", "osaka")
    seed = {
        "city_code": city_code,
        "timezone": data.get("timezone", CITY_TIMEZONES[city_code]),
        "center": data["center"],
        "areas": data.get("areas", []),  # 지역 중심 [{id, name_ko, query}]. 지역은 데이터다 (§12): 몇 곳이든 그대로. 없으면 3km 검사를 건너뛴다
        "places": data["places"],
    }
    if set(seed["center"]) != {"name_ko", "query"}:
        raise ValueError("center에는 name_ko와 query만 둔다")
    area_ids = [item.get("id") for item in seed["areas"]]
    if any(set(item) != {"id", "name_ko", "query"} for item in seed["areas"]) or len(area_ids) != len(set(area_ids)):
        raise ValueError("areas는 지역마다 id·name_ko·query만 두고 id는 겹치지 않는다")
    ids: set[str] = set()
    for row in seed["places"]:
        if not ROW_KEYS <= set(row) <= ROW_KEYS | OPTIONAL_KEYS:
            raise ValueError(f"seed 줄의 키가 §S와 다름: {row.get('id')}")
        if row["category"] not in CATEGORIES or (area_ids and row["area"] not in area_ids) or row["id"] in ids:
            raise ValueError(f"seed 줄 값이 올바르지 않음: {row['id']}")
        if "open_space" in row and not isinstance(row["open_space"], bool):
            raise ValueError(f"open_space는 true/false: {row['id']}")
        for span in row.get("curated_hours", []):
            if set(span) != {"days", "open", "close"} or span["days"] != "all":  # 요일별 시간대는 아직 문서에 없다
                raise ValueError(f"curated_hours는 {{days: all, open, close}}만: {row['id']}")
        ids.add(row["id"])
    return seed
