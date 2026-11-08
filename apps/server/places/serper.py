"""빈 영업시간 보완 (TASK-010 §A3, §9 Q8, ADR-015 §3-3 ②). 껍데기."""

from pathlib import Path
from typing import Any, Literal

import httpx


def extract_hours(texts: list[str]) -> list[tuple[str, str]] | None:
    """검색 결과 문장들에서 시각 값만 규칙으로 뽑는다. 하나로 정해지면 하루 구간 목록 [("HH:MM", "HH:MM"), ...], 아니면 None."""
    raise NotImplementedError


def extract_closed_days(texts: list[str]) -> list[int] | Literal["unknown"] | None:
    """定休日 요일 (0=월 ~ 6=일). 不定休 = "unknown". 말이 없으면 None."""
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
