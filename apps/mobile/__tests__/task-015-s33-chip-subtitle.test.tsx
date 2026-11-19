/// <reference types="jest" />
// TASK-015 §33 칩 시트 부제 우선순위 (로직만 — 글 모양 · 굵기는 사진으로, TEAM-001 §5-1).
// 근거: TASK-015 §33 "§32 질문 답 ① 부제 T-01 '지금 있는 곳' · T-07 '고정 일정' — 우선순위 고정 일정 > 지금 있는 곳 > 다음 장소 · N번
//       (고정 일정이 걸린 장소는 T-02에서 눌러도 부제 '고정 일정' + 사실 줄 · 링크 · 닫기만)" · task-015-design §18-1 1번 · §16-3 부제 줄 · §16-4
//
// 계약 (이 파일이 정한 것):
//   "고정 일정이 걸린 장소" = T-07(fixed) · T-01 item.is_fixed true · T-02 next_item.is_fixed true
//   부제 = 고정 일정이 걸린 장소면 "고정 일정", 아니면 T-01 "지금 있는 곳", 아니면 T-02 "다음 장소 · {seq}번"
//   고정 일정이 걸린 장소의 시트: 사실 줄(칩 + 출처 줄) · [구글 지도에서 보기](place_map_url이 있을 때) · [닫기]만 — 질문 · [열었어][닫혔어] · 창 밖 안내 없음
//     (can_confirm_hours 값과 상관없이. cc11381 "T-02 고정 일정이면 안내 · 질문 · 쌍 없음"과 같은 규칙)
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { nowItem, nowView, t01, t02, t07 } from '../test-support/trip-now-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const PLACE_URL = 'https://www.google.com/maps/search/?api=1&query=35.02,134.99';
const HINT = '출발 30분 전부터 [열었어] [닫혔어]로 알려 줄 수 있어';
const QUESTION = '가기 전에 열었는지 볼래?';
const textOf = (host: Tree) => [host.props.children].flat(Infinity).filter((c: unknown) => typeof c === 'string' || typeof c === 'number').join('');
const sheetWords = () => (screen.getByTestId('chip-sheet') as unknown as Tree).queryAll((h) => h.type === 'Text').map(textOf).join('').replace(/\s/g, '');

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

const placeItem = (isFixed: boolean) => ({
  ...nowItem(3, '서버_칩_장소', '12:20', '14:00', 'unverified'),
  place_id: 'D02',
  is_fixed: isFixed,
  facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'unverified', source_type: 'demo', checked_at: null }],
});
const fixedT07 = () =>
  t07({ fixed: { name: '서버_식당_이름', title: '서버_예약_제목', start: '15:00', end: '16:00', facts: placeItem(true).facts }, can_confirm_hours: false, place_map_url: PLACE_URL });

async function open(main: object, cardId: string) {
  await toNow(nowServer(nowView({ main, subs: [] })));
  const label = within(screen.getByTestId(cardId)).getByText('영업시간 미확인') as unknown as Tree;
  let button: Tree | null = label;
  while (button && button.props.accessibilityRole !== 'button') button = button.parent;
  await act(async () => {
    fireEvent.press((button ?? label) as never);
  });
  return within(screen.getByTestId('chip-sheet'));
}

// [이름, 메인 카드, 카드 testID, 기대 부제(빈칸 없앤 글)]
const CASES: [string, () => object, string, string][] = [
  ['T_02_고정_일정이_걸린_다음_장소', () => t02({ next_item: placeItem(true), can_confirm_hours: true, place_map_url: PLACE_URL }), 'card-T-02', '고정일정'],
  ['T_01_지금_있는_곳이_고정_일정_장소', () => t01({ item: placeItem(true), can_confirm_hours: false, place_map_url: PLACE_URL }), 'card-T-01', '고정일정'],
  ['T_07', fixedT07, 'card-T-07', '고정일정'],
  ['T_01_보통_장소', () => t01({ item: placeItem(false), can_confirm_hours: false, place_map_url: PLACE_URL }), 'card-T-01', '지금있는곳'],
  ['T_02_보통_장소', () => t02({ next_item: placeItem(false), can_confirm_hours: true, place_map_url: PLACE_URL }), 'card-T-02', '다음장소·3번'],
];

describe('§33 칩 시트 부제 우선순위 — 고정 일정 > 지금 있는 곳 > 다음 장소 · N번', () => {
  test.each(CASES)('T15_S33_%s_부제', async (_name, card, id, subtitle) => {
    await open(card(), id);
    const words = sheetWords();
    expect(words).toContain(subtitle);
    for (const other of ['고정일정', '지금있는곳', '다음장소·']) if (!subtitle.startsWith(other)) expect(words).not.toContain(other);
  });

  test.each(CASES.slice(0, 3))('T15_S33_%s_시트는_사실_줄_·_링크_·_닫기만(질문_·_쌍_·_안내_없음)', async (_name, card, id) => {
    const sheet = await open(card(), id);
    expect(sheet.getByText('미확인')).toBeTruthy(); // 사실 줄 칩
    expect(sheet.getByText('데모 데이터 · 확인한 적 없음')).toBeTruthy(); // 출처 줄
    expect(sheet.getByText('구글 지도에서 보기')).toBeTruthy();
    expect(sheet.getByTestId('chip-sheet-close')).toBeTruthy();
    expect(sheet.queryByText(QUESTION)).toBeNull();
    expect(sheet.queryByText(HINT)).toBeNull();
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    expect(sheet.queryByTestId('visit-closed')).toBeNull();
  });
});
