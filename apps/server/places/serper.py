"""빈 영업시간 보완 (TASK-010 §A3, ADR-015 §3-3 ②). 껍데기."""

from pathlib import Path
from typing import Any

import httpx


def extract_hours(texts: list[str]) -> tuple[str, str] | None:
    """검색 결과 문장들에서 시각 값만 규칙으로 뽑는다. 하나로 맞으면 (여는 시각, 닫는 시각) "HH:MM", 못 뽑거나 엇갈리면 None."""
    raise NotImplementedError


class SerperSearch:
    def __init__(self, api_key: str, client: httpx.Client | None = None):
        raise NotImplementedError

    def search(self, q: str) -> list[dict[str, Any]]:
        """[{text, link}]"""
        raise NotImplementedError


class FakeSerper:
    """testdata/cities/osaka-fake.json의 serper 표를 읽는 가짜."""

    def __init__(self, path: Path | None = None):
        raise NotImplementedError

    def search(self, q: str) -> list[dict[str, Any]]:
        raise NotImplementedError
