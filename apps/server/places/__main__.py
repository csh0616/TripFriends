"""`uv run python -m places build osaka [--seed PATH] [--pack-dir DIR] [--cache-dir DIR]` (TASK-010 §A2, §9 Q21). 얇은 껍데기.

기본값: seed = docs/data/osaka-seed.yaml, 팩 = apps/server/places/packs/, 캐시 = apps/server/.cache/places/.
PLACES_PROVIDER=fake 이거나 키가 없으면 가짜 공급자로 돈다. 키는 환경 변수로만 받는다
(`uv run --env-file .env python -m places build osaka`). 출력에는 개수·비율만 있고 Google 값·검색 문장은 없다.
"""

import argparse
import json
import logging
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from places.build import DEFAULT_CAPS, BuildResult, build_pack
from places.cache import save_cache
from places.factory import make_providers
from places.seed import load_seed

SERVER = Path(__file__).resolve().parents[1]
DEFAULT_SEED = SERVER.parents[1] / "docs" / "data" / "osaka-seed.yaml"


def _summary(result: BuildResult) -> list[str]:
    """A6 측정표 재료: 카테고리별 장소 수, 영업시간 채움 비율(Google만 / + Serper), 뺀 곳, 호출 수."""
    rows = result.pack["places"]
    google = Counter(), Counter()
    total = Counter(row["category"] for row in rows)
    for row in rows:
        entry = result.cache[row["place_id"]]
        google[0][row["category"]] += bool(entry["opening_hours"])
        google[1][row["category"]] += bool(entry["opening_hours"] or (entry.get("serper") or {}).get("hours"))
    lines = ["카테고리  장소 수  영업시간(Google만)  영업시간(+Serper)"]
    for category, count in sorted(total.items()):
        lines.append(f"{category}  {count}  {google[0][category]}/{count}  {google[1][category]}/{count}")
    lines += [f"뺀 곳: {item['id']} ({item['reason']})" for item in result.report["excluded"]]
    calls = result.report["calls"]
    lines.append(f"호출 수: Google {calls['google']}, Serper {calls['serper']}")
    return lines


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="places")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="도시 팩과 캐시를 만든다")
    build.add_argument("city", choices=["osaka"])
    build.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    build.add_argument("--pack-dir", type=Path, default=SERVER / "places" / "packs")
    build.add_argument("--cache-dir", type=Path, default=SERVER / ".cache" / "places")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    if not args.seed.is_file():
        print(f"seed 파일이 없어요: {args.seed}", file=sys.stderr)
        return 2
    provider, serper, _fake = make_providers()
    result = build_pack(load_seed(args.seed), provider, DEFAULT_CAPS, serper=serper, now=datetime.now(UTC))
    for line in _summary(result):
        print(line)
    if result.report["stopped"]:
        print("호출 상한에 닿아 멈췄어요. 팩과 캐시는 쓰지 않았어요.", file=sys.stderr)
        return 1
    args.pack_dir.mkdir(parents=True, exist_ok=True)
    (args.pack_dir / f"{args.city}.json").write_text(json.dumps(result.pack, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    save_cache(args.cache_dir / f"{args.city}.json", result.cache)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
