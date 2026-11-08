"""빈 영업시간 보완 (TASK-010 §A3, §9 Q8·Q23·Q24, ADR-015 §3-3 ②).

검색 결과 문장에서 **시각 값만** 규칙(정규식)으로 뽑는다. 문장은 저장·로그하지 않는다.
큰 원칙: 값이 하나로 정해지지 않으면 None(= unknown). 보완은 틀리지 않는 게 먼저다.
"""

import re
import unicodedata
from pathlib import Path
from typing import Any, Literal

import httpx

from places.provider import FAKE_PLACES_PATH, _load_fake

SERPER_URL = "https://google.serper.dev/search"
HTTP_TIMEOUT = 5.0

_TIME = r"(?:(\d{1,2}):(\d{2})|(\d{1,2})時(?:(\d{1,2})分)?)"  # 11:00 | 11時 | 11時30分
_SEP = r"\s*[~〜\-–—−ー]\s*"
_RANGE = re.compile(rf"(?<!\d){_TIME}{_SEP}(翌)?\s*{_TIME}")
_LAST_ORDER = re.compile(rf"(?:L\.?\s*O\.?|ラスト\s*オーダー)\s*:?\s*{_TIME}", re.IGNORECASE)
_ALL_DAY = re.compile(r"24\s*時間")
_WEEKDAYS = "月火水木金土日"
_CLOSED_CLAUSE = re.compile(r"定休日\s*:?\s*((?:第?[\d・]*[月火水木金土日祝](?:曜日?)?[・,、/]?)+)")
_VARIES = re.compile(r"平日|土日祝|土日|日祝|祝日|祝前日|[月火水木金土日]曜")
_DAY_MINUTES = 24 * 60


def _normalize(text: str) -> str:
    """전각 숫자·쌍점·괄호를 반각으로 (Q8)."""
    return unicodedata.normalize("NFKC", text)


def _minutes(hour_a: str | None, minute_a: str | None, hour_b: str | None, minute_b: str | None) -> int:
    if hour_a is not None:
        return int(hour_a) * 60 + int(minute_a or 0)
    return int(hour_b or 0) * 60 + int(minute_b or 0)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """겹치거나 맞닿는 구간을 합친다 (Q23 ③)."""
    merged: list[tuple[int, int]] = []
    for low, high in sorted(spans):
        if merged and low <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], high))
        else:
            merged.append((low, high))
    return merged


def _strip_closed(text: str) -> str:
    return _CLOSED_CLAUSE.sub(" ", text).replace("不定休", " ")


def _spans(text: str) -> list[tuple[int, int]] | None:
    """한 문장의 하루 구간(분). None = 요일마다 달라 하나로 정할 수 없음. 시각이 없으면 []."""
    text = _normalize(text)
    found = list(_RANGE.finditer(text))
    spans: list[tuple[int, int]] = []
    for number, match in enumerate(found):
        groups = match.groups()
        low = _minutes(*groups[0:4])
        high = _minutes(*groups[5:9])
        if groups[4]:  # 翌
            high += _DAY_MINUTES
        if high == low or low >= _DAY_MINUTES:
            continue
        if high < low or high > _DAY_MINUTES:
            high = _DAY_MINUTES  # 자정 넘김은 24:00으로 자른다 (Q8·Q23 ①)
        after = found[number + 1].start() if number + 1 < len(found) else len(text)
        last_order = _LAST_ORDER.search(text, match.end(), after)
        if last_order:
            order = _minutes(*last_order.groups())
            if low < order < high:
                high = order  # 끝 = 라스트 오더 (Q8·Q23 ④)
        spans.append((low, high))
    if _ALL_DAY.search(text):
        spans.append((0, _DAY_MINUTES))
    if spans and _VARIES.search(_strip_closed(text)):
        return None
    return _merge(spans)


def extract_hours(texts: list[str]) -> list[tuple[str, str]] | None:
    """검색 결과 문장들에서 시각 값만 규칙으로 뽑는다. 하나로 정해지면 하루 구간 목록 [("HH:MM", "HH:MM"), ...], 아니면 None."""
    found: set[tuple[tuple[int, int], ...]] = set()
    for text in texts:
        spans = _spans(text)
        if spans is None:
            return None
        if spans:
            found.add(tuple(spans))
    if len(found) != 1:
        return None
    return [(_hhmm(low), _hhmm(high)) for low, high in next(iter(found))]


def _closed_in(text: str) -> list[int] | Literal["unknown"] | None:
    text = _normalize(text)
    if "不定休" in text:
        return "unknown"
    days: set[int] = set()
    seen = False
    for clause in _CLOSED_CLAUSE.findall(text):
        seen = True
        if "第" in clause or any(ch.isdigit() for ch in clause):
            return "unknown"  # 첫째·셋째 같은 말은 하나로 정할 수 없다
        for char in clause.replace("曜日", "").replace("曜", ""):
            if char in _WEEKDAYS:
                days.add(_WEEKDAYS.index(char))
    return sorted(days) if seen else None


def extract_closed_days(texts: list[str]) -> list[int] | Literal["unknown"] | None:
    """定休日 요일 (0=월 ~ 6=일). 不定休·문장끼리 엇갈림 = "unknown". 말이 없으면 None."""
    found: set[tuple[int, ...]] = set()
    for text in texts:
        one = _closed_in(text)
        if one == "unknown":
            return "unknown"
        if one:
            found.add(tuple(one))
    if not found:
        return None
    return list(next(iter(found))) if len(found) == 1 else "unknown"


class SerperSearch:
    """serper.dev 검색. 만들기 명령 안에서만 부른다 (앱 요청마다 부르지 않는다, ADR-015 §3-3)."""

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self._key = api_key
        self._client = client or httpx.Client(timeout=HTTP_TIMEOUT)

    def search(self, q: str) -> list[dict[str, Any]]:
        response = self._client.post(SERPER_URL, headers={"X-API-KEY": self._key}, json={"q": q, "gl": "jp", "hl": "ja"})
        response.raise_for_status()
        return [
            {"text": f"{hit.get('title', '')} {hit.get('snippet', '')}".strip(), "link": hit.get("link", "")}
            for hit in response.json().get("organic", [])
        ]


class FakeSerper:
    """testdata/cities/osaka-fake.json의 serper 표를 읽는 가짜."""

    def __init__(self, path: Path | None = None):
        self._table = _load_fake(path or FAKE_PLACES_PATH)["serper"]

    def search(self, q: str) -> list[dict[str, Any]]:
        return [dict(hit) for hit in self._table.get(q, [])]
