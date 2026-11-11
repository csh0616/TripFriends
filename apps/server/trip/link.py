"""계정 연결 규칙 (TASK-012 §C4·C6, §15 S3, §16 Q1~Q5). 얇은 API(`api.account`) 뒤의 판단·저장 순서.

어떤 경우에도 여행을 지우지 않는다: 옮기거나 archived로만 바꾼다. 지금 여행 = 데모가 아닌 active 여행 (§16).
순서: 처리됨 확인(409) -> 두 사람의 지금 여행 -> (둘 다 있으면 choose만 돌려주고 아무것도 안 바꿈) -> 처리됨 적기 -> 옮기기.
"""

from typing import Literal

from pydantic import BaseModel

from trip.claims import ClaimStore
from trip.store import TripRow, TripStore
from trip.trips import ApiError, Trip, TripBook

CITY_NAMES = {"osaka": "오사카"}  # 날짜 목록 머리(앱 day-list.ts)와 같은 이름


class TripChoice(BaseModel):
    origin: Literal["device", "account"]
    trip_id: str
    name: str
    start_date: str
    end_date: str
    planned_days: int
    total_days: int


class ClaimResult(BaseModel):
    result: Literal["moved", "choose"]
    choices: list[TripChoice] | None = None


class ClaimBody(BaseModel):
    anonymous_token: str


class ChooseBody(BaseModel):
    anonymous_token: str
    trip_id: str


def already_claimed() -> ApiError:
    return ApiError(409, "ALREADY_CLAIMED", "이미 연결을 마친 기기예요", None)


class AccountLink:
    def __init__(self, book: TripBook, store: TripStore, claims: ClaimStore):
        self.book, self.store, self.claims = book, store, claims

    def _current(self, owner: str) -> TripRow | None:
        trip = self.store.active_trip(owner)
        return None if trip is None or trip.is_demo else trip  # 데모는 지금 여행이 아니다 (§16 Q1)

    def _choice(self, origin: Literal["device", "account"], trip: TripRow) -> TripChoice:
        total = len(trip.day_ids)
        planned = sum(1 for day_id in trip.day_ids if self.book.planning.chosen_option(day_id) is not None)
        city = CITY_NAMES.get(trip.city_code, trip.city_code)
        name = f"{city} 당일 여행" if total == 1 else f"{city} {total - 1}박 {total}일"
        return TripChoice(
            origin=origin, trip_id=trip.trip_id, name=name, start_date=trip.start_date.isoformat(), end_date=trip.end_date.isoformat(),
            planned_days=planned, total_days=total,
        )

    def _settle(self, anonymous_id: str, account_id: str) -> None:
        if not self.claims.mark(anonymous_id, account_id):  # 동시에 들어온 두 번째
            raise already_claimed()
        self.store.move_trips(anonymous_id, account_id)

    def claim(self, anonymous_id: str, account_id: str) -> ClaimResult:
        if self.claims.is_claimed(anonymous_id):
            raise already_claimed()
        mine, theirs = self._current(anonymous_id), self._current(account_id)
        if mine is not None and theirs is not None:
            return ClaimResult(result="choose", choices=[self._choice("device", mine), self._choice("account", theirs)])
        self._settle(anonymous_id, account_id)
        return ClaimResult(result="moved")

    def choose(self, anonymous_id: str, account_id: str, trip_id: str) -> Trip:
        if self.claims.is_claimed(anonymous_id):
            raise already_claimed()
        mine, theirs = self._current(anonymous_id), self._current(account_id)
        current = [trip for trip in (mine, theirs) if trip is not None]
        if trip_id not in {trip.trip_id for trip in current}:  # 두 여행이 아니면 남의 것과 같은 404 (§16 Q3)
            raise ApiError(404, "NOT_FOUND", "없는 여행이에요", {"resource": "trip", "trip_id": trip_id})
        self._settle(anonymous_id, account_id)
        for trip in current:
            if trip.trip_id != trip_id:
                self.store.archive_trip(trip.trip_id)  # 고르지 않은 쪽은 지우지 않고 보관 (기기 여행은 위에서 이미 계정으로 옮김, §16 Q2)
        return self.book.get(trip_id, account_id)
