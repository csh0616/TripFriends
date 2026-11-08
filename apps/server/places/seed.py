"""seed 읽기 (TASK-010 §S). docs/data/osaka-seed.yaml은 읽기만 한다."""

from pathlib import Path
from typing import Any

import yaml

CATEGORIES = {"cafe", "food", "walk", "museum", "landmark", "shop", "experience", "night"}
AREAS = {"namba", "shinsaibashi", "umeda"}
ROW_KEYS = {"id", "name_ko", "aliases", "query", "area", "category", "stay", "crowd_level", "price_level", "mood_tags"}
CITY_TIMEZONES = {"osaka": "Asia/Tokyo"}  # 도시 시간대는 도시 팩에 (A8)


def load_seed(path: Path) -> dict[str, Any]:
    """{city_code, timezone, center: {name_ko, query}, areas: {지역: {name_ko, query}}, places: [줄]}. 줄 모양이 틀리면 ValueError."""
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    city_code = data.get("city_code", "osaka")
    seed = {
        "city_code": city_code,
        "timezone": data.get("timezone", CITY_TIMEZONES[city_code]),
        "center": data["center"],
        "areas": data.get("areas", {}),  # 지역 중심 (이름 + query). 없으면 3km 검사를 건너뛴다
        "places": data["places"],
    }
    if set(seed["center"]) != {"name_ko", "query"}:
        raise ValueError("center에는 name_ko와 query만 둔다")
    if any(area not in AREAS or set(item) != {"name_ko", "query"} for area, item in seed["areas"].items()):
        raise ValueError("areas는 namba·shinsaibashi·umeda마다 name_ko와 query만 둔다")
    ids: set[str] = set()
    for row in seed["places"]:
        if set(row) != ROW_KEYS:
            raise ValueError(f"seed 줄의 키가 §S와 다름: {row.get('id')}")
        if row["category"] not in CATEGORIES or row["area"] not in AREAS or row["id"] in ids:
            raise ValueError(f"seed 줄 값이 올바르지 않음: {row['id']}")
        ids.add(row["id"])
    return seed
