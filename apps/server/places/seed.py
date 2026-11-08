"""seed 읽기 (TASK-010 §S). 껍데기."""

from pathlib import Path
from typing import Any


def load_seed(path: Path) -> dict[str, Any]:
    """{city_code, timezone, center: {name_ko, query}, places: [줄]}"""
    raise NotImplementedError
