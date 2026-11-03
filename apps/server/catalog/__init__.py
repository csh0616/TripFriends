"""카드 카탈로그 (SCREEN-001 §3)."""

from pydantic import BaseModel


class CardSpec(BaseModel):
    id: str  # 예: "T-01"
    name: str
    shows: str  # 이 카드가 보여 주는 것 (Jev 보기 설명용 한 줄)
    has_place: bool  # 장소가 들어가 확인 상태 표시가 필수인 카드
    props: type[BaseModel]


def get_catalog() -> list[CardSpec]:
    raise NotImplementedError
