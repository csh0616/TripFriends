"""카드 카탈로그 테스트. 근거: TASK-001 §2 catalog, AC-5, SCREEN-001 §3."""

import pytest

from catalog import get_catalog

EXPECTED_IDS = (
    {f"P-{i:02d}" for i in range(1, 8)} | {f"T-{i:02d}" for i in range(1, 15)} | {"X-01", "X-02"}
)
PLACE_CARDS = {"T-02", "T-05", "T-06", "T-09", "T-10", "T-11"}
DEFINED_PROPS = {
    "T-01": {"item", "ends_in_min"},
    "T-02": {"next_item", "leave_at", "travel_min", "map_url"},
    "T-04": {"event", "proposals"},
    "T-09": {"places", "walk_min"},
}


def by_id():
    return {card.id: card for card in get_catalog()}


def test_AC05_카드는_23종이고_ID가_문서와_같음():
    cards = get_catalog()
    assert len(cards) == 23
    assert {card.id for card in cards} == EXPECTED_IDS


def test_AC05_ID_중복_없음():
    ids = [card.id for card in get_catalog()]
    assert len(ids) == len(set(ids))


def test_AC05_장소_포함_카드가_문서와_같음():
    assert {card.id for card in get_catalog() if card.has_place} == PLACE_CARDS


def test_모든_카드에_이름과_보여주는것_한줄():
    for card in get_catalog():
        assert card.name.strip()
        assert card.shows.strip()


@pytest.mark.parametrize("card_id, fields", DEFINED_PROPS.items())
def test_AC05_정의된_4종_props_필드(card_id, fields):
    assert set(by_id()[card_id].props.model_fields) == fields


def test_나머지_카드_props는_빈_모델():
    for card_id, card in by_id().items():
        if card_id not in DEFINED_PROPS:
            assert card.props.model_fields == {}, card_id
