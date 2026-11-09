"""TASK-012 A2: 메모리 저장소와 같은 인터페이스의 Postgres 구현 (빈 껍데기, test-writer).

계약 테스트(tests/test_task012_contract.py)가 메모리·Postgres 두 구현에 같은 테스트를 돌린다.
연결 주소는 생성자 인자 `url` (서버는 환경 변수 DATABASE_URL, 테스트는 TEST_DATABASE_URL에서 읽는다).
§10 Q1: DB에는 place_id(와 우리 장소 id)만 둔다. 읽을 때 장소·좌표는 도시 데이터(city: 팩 + 좌표 캐시 + 영업시간 메모리)에서
`clock()` 시각으로 되살린다 -> 계획 저장소 생성자가 city·clock을 받는다.
"""

from collections.abc import Callable
from datetime import datetime

from places.city import CityData
from planning.repo import PlanningRepo
from trip.repo import TripRepo


class PostgresPlanningRepo(PlanningRepo):
    def __init__(self, url: str, city: CityData, clock: Callable[[], datetime]) -> None:
        raise NotImplementedError


class PostgresTripRepo(TripRepo):
    def __init__(self, url: str) -> None:
        raise NotImplementedError
