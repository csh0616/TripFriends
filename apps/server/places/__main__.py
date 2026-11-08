"""`uv run python -m places build osaka [--seed PATH] [--pack-dir DIR] [--cache-dir DIR]` (TASK-010 §A2, §9 Q21). 껍데기.

기본값: seed = docs/data/osaka-seed.yaml, 팩 = apps/server/places/packs/, 캐시 = apps/server/.cache/places/.
PLACES_PROVIDER=fake 면 가짜 공급자(testdata/cities/osaka-fake.json)로 돈다.
"""

import sys


def main(argv: list[str]) -> int:
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
