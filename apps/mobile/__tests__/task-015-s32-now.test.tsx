/// <reference types="jest" />
// TASK-015 §32 칩 시트: T-02 다음 장소가 고정 일정이면 창 밖 안내 없음 (§16-4). 규칙만 본다 — 글 · 굵기 · 버튼 모양은 사진으로 확인(결정권자 11-19, TEAM-001 §5-1)
// 근거: TASK-015 §32 "고칠 것" 하("T-02 다음 장소가 고정 일정이면 창 밖 안내가 뜰 수 있음(코드 읽기) -> §16-4대로 고정 일정이면 안내 없음 — 테스트 먼저(지금 실제로 뜨는지 확인 포함)") ·
//       task-015-design §16-4(창 안 · 창 밖 모양은 "고정 일정 아님"일 때만, T-07(고정 일정)은 쌍도 안내도 없다) · TASK-008 §14(고정 일정 장소는 영업 확인 대상 아님)
//
// 계약 (이 파일이 정한 것):
//   T-02 next_item.is_fixed true면 can_confirm_hours와 상관없이 칩 시트에 창 밖 안내 · 질문 · [열었어][닫혔어] 모두 없다
//   (지금 코드에서 실제로 뜨는지: is_fixed true · can_confirm_hours false면 안내가 뜬다 -> 첫 테스트가 실패로 재현)
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import { nowItem, nowView, t02 } from '../test-support/trip-now-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const PLACE_URL = 'https://www.google.com/maps/search/?api=1&query=35.02,134.99';
const HINT = '출발 30분 전부터 [열었어] [닫혔어]로 알려 줄 수 있어';
const QUESTION = '가기 전에 열었는지 볼래?';

beforeEach(() => {
  resetDevice();
  mapControl.reset();
  sheetControl.reset();
  installConfig(TEST_KEY);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const placeItem = (source_type = 'demo', over: object = {}) => ({
  ...nowItem(3, '서버_칩_장소', '12:20', '14:00', 'unverified'),
  place_id: 'D02',
  facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'unverified', source_type, checked_at: null }],
  ...over,
});
async function open(control: NowControl, cardId: string) {
  await toNow(control);
  const label = within(screen.getByTestId(cardId)).getByText('영업시간 미확인') as unknown as Tree;
  let button: Tree | null = label;
  while (button && button.props.accessibilityRole !== 'button') button = button.parent;
  await act(async () => {
    fireEvent.press((button ?? label) as never);
  });
  return within(screen.getByTestId('chip-sheet'));
}
const t02Main = (item = placeItem(), can = true) => nowView({ main: t02({ next_item: item, can_confirm_hours: can, place_map_url: PLACE_URL }), subs: [] });

describe('§32 T-02 다음 장소가 고정 일정이면 안내 없음 (§16-4)', () => {
  test.each([false, true])('T15_S32_고정_일정_다음_장소_can_confirm_hours_%s여도_안내_·_질문_·_쌍_모두_없음', async (can) => {
    const sheet = await open(nowServer(t02Main(placeItem('demo', { is_fixed: true }), can)), 'card-T-02');
    expect(sheet.queryByText(HINT)).toBeNull();
    expect(sheet.queryByText(QUESTION)).toBeNull();
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    expect(sheet.queryByTestId('visit-closed')).toBeNull();
  });

  test('T15_S32_시험_자체_확인_고정_일정이_아니면_창_밖_안내가_있다', async () => {
    const sheet = await open(nowServer(t02Main(placeItem('demo'), false)), 'card-T-02');
    expect(sheet.getByText(HINT)).toBeTruthy();
  });
});
