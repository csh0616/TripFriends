/// <reference types="jest" />
// TASK-015 §30 여행 중 화면: 칩 시트 [열었어][닫혔어] · [구글 지도에서 보기] (서버 새 칸) · 접힌 단 아래로 보조 카드가 비치지 않음.
// 근거: TASK-015 §30 "칩 시트 질문 4개" 1(서버가 카드에 '지금 확인 가능' 값을 더함, 창 규칙은 T-05와 같은 값) · 2(장소 지도 링크, T-05와 같은 방식) · 3(T-01 · T-02 · T-07만) ·
//       "안 막는 것: T-07 '지금 출발해' 접힘에서 아래 카드 윗부분 약 7.7pt 비침 -> 고친다(§27 이유 줄 1pt와 같은 방식)" ·
//       task-015-design §15-5(칩 시트: [열었어][닫혔어]는 확인 시간 창 안에서만 · [구글 지도에서 보기]) · §15-2 하-12(접힘 밖 내용은 그리지 않거나 opacity 0)
//
// 계약 (이 파일이 정한 것 — 서버 칸 이름은 test-writer 제안, backend · PM 확정 전: server tests/test_task015_s30_chip_fields.py):
//   T-01 · T-02 · T-07 카드에 can_confirm_hours: boolean · place_map_url: string | null
//   칩 시트(chip-sheet):
//     can_confirm_hours true면 [열었어](testID visit-open) · [닫혔어](visit-closed). 누르면 T-05와 같은 요청 POST /places/{장소 id}/visit-checks 본문 {day_id, at, was_open} 한 번
//       장소 id = T-01 item.place_id · T-02 next_item.place_id. false면 두 버튼 없음. 모름(unknown) 칩도 같다
//     place_map_url이 있으면 [구글 지도에서 보기](글 "구글 지도에서 보기"), 누르면 그 URL을 연다(Linking.openURL). null이면 없음
//     보드 ③-T15d1~d3(V133)은 docs에 아직 없어 글 · 버튼 유무만 본다
//   접힌 단: 시트가 접힌 단(index 0)이면 메인 카드 밖의 보조 카드(subs)는 그리지 않거나 opacity 0 (§29 이유 줄과 같은 판정). 중간 · 높은 단이면 보인다.
//     같은 종류 안 안 줄어듦(§29)으로 접힌 경계가 마지막 요소 아래 + 4보다 아래에 남아도 그 사이로 보조 카드가 비치지 않는다
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { json } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import { nowItem, nowView, t01, t02, t03, t07 } from '../test-support/trip-now-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null };
const VISIT_ROUTE = (placeId: string) => `POST /places/${placeId}/visit-checks`;
const PLACE_URL = 'https://www.google.com/maps/search/?api=1&query=35.02,134.99';
const LONG = { unverified: '영업시간 미확인', unknown: '영업시간 모름' } as const;

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

const factItem = (status: 'unverified' | 'unknown') => nowItem(2, '서버_칩_장소', '12:20', '14:00', status);
// [이름, 카드(상태, 칸), 카드 testID, visit-check 장소 id]
const CARDS: [string, (status: 'unverified' | 'unknown', over: object) => object, string, string][] = [
  ['T_01', (status, over) => t01({ item: factItem(status), ...over }), 'card-T-01', 'D02'],
  ['T_02', (status, over) => t02({ next_item: factItem(status), ...over }), 'card-T-02', 'D02'],
];

async function openChip(control: NowControl, id: string, status: 'unverified' | 'unknown') {
  await toNow(control);
  await act(async () => {
    fireEvent.press(within(screen.getByTestId(id)).getByText(LONG[status]));
  });
  return within(screen.getByTestId('chip-sheet'));
}

describe('§30 칩 시트 [열었어][닫혔어] — can_confirm_hours (제안 이름)', () => {
  const cases = CARDS.flatMap(([name, card, id, pid]) => (['unverified', 'unknown'] as const).map((status) => [`${name}_${status}`, card, id, pid, status] as const));

  test.each(cases)('T15_S30_%s_can_confirm_hours가_true면_열었어_닫혔어가_있다', async (_name, card, id, _pid, status) => {
    const sheet = await openChip(nowServer(nowView({ main: card(status, { can_confirm_hours: true, place_map_url: null }), subs: [] })), id, status);
    expect(sheet.getByTestId('visit-open')).toBeTruthy();
    expect(sheet.getByTestId('visit-closed')).toBeTruthy();
    expect(sheet.getByText('열었어')).toBeTruthy();
    expect(sheet.getByText('닫혔어')).toBeTruthy();
  });

  test.each(cases)('T15_S30_%s_can_confirm_hours가_false면_없다', async (_name, card, id, _pid, status) => {
    const sheet = await openChip(nowServer(nowView({ main: card(status, { can_confirm_hours: false, place_map_url: null }), subs: [] })), id, status);
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    expect(sheet.queryByTestId('visit-closed')).toBeNull();
  });

  test.each([
    ['visit-open', true],
    ['visit-closed', false],
  ] as const)('T15_S30_칩_시트_%s는_T_05와_같은_visit_check를_한_번', async (button, wasOpen) => {
    const control = nowServer(nowView({ main: t02({ next_item: factItem('unverified'), can_confirm_hours: true, place_map_url: null }), subs: [] }));
    control.server.on(VISIT_ROUTE('D02'), json(200, nowView({ main: t01(), subs: [t03()] })));
    const sheet = await openChip(control, 'card-T-02', 'unverified');
    await act(async () => {
      fireEvent.press(sheet.getByTestId(button));
    });
    await waitFor(() => expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1));
    const body = control.server.sent(VISIT_ROUTE('D02'))[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['at', 'day_id', 'was_open']);
    expect(body.was_open).toBe(wasOpen);
    expect(body.day_id).toBe('day-2');
  });
});

describe('§30 칩 시트 [구글 지도에서 보기] — place_map_url (제안 이름)', () => {
  test.each(CARDS)('T15_S30_%s_링크가_있으면_보이고_누르면_그_URL을_연다', async (_name, card, id) => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const sheet = await openChip(nowServer(nowView({ main: card('unverified', { can_confirm_hours: false, place_map_url: PLACE_URL }), subs: [] })), id, 'unverified');
    await act(async () => {
      fireEvent.press(sheet.getByText('구글 지도에서 보기'));
    });
    expect(open).toHaveBeenCalledWith(PLACE_URL);
  });

  test.each(CARDS)('T15_S30_%s_링크가_null이면_없다', async (_name, card, id) => {
    const sheet = await openChip(nowServer(nowView({ main: card('unverified', { can_confirm_hours: false, place_map_url: null }), subs: [] })), id, 'unverified');
    expect(sheet.queryByText('구글 지도에서 보기')).toBeNull();
  });

  test('T15_S30_T_07_링크가_있으면_보이고_확인_버튼은_고정_일정이라_false', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const fixed = { name: '서버_식당_이름', title: '서버_예약_제목', start: '15:00', end: '16:00', facts: factItem('unverified').facts };
    const sheet = await openChip(nowServer(nowView({ main: t07({ fixed, can_confirm_hours: false, place_map_url: PLACE_URL }), subs: [] })), 'card-T-07', 'unverified');
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    await act(async () => {
      fireEvent.press(sheet.getByText('구글 지도에서 보기'));
    });
    expect(open).toHaveBeenCalledWith(PLACE_URL);
  });
});

describe('§30 접힌 단에서는 보조 카드가 비치지 않는다 (T-07 "지금 출발해" 7.7pt)', () => {
  const AREA_H = 746;
  const chain = (host: Tree): Tree[] => {
    const out: Tree[] = [];
    for (let node: Tree | null = host; node; node = node.parent) out.push(node);
    return out;
  };
  // §31 하-15: 옛 "없음 또는 opacity 0" -> 그리지 않음(없음)만 (접힘 밖 요소는 그리지 않는다)
  const hidden = (id: string) => screen.queryByTestId(id) === null;
  async function settle(index: number) {
    await act(async () => {
      sheetControl.settle(index, AREA_H);
    });
  }

  test('T15_S30_T_07_메인_+_보조_T_02_접힌_단이면_보조_카드_없음_중간_·_높은_단이면_보임', async () => {
    await toNow(nowServer(nowView({ main: t07({ leave_in_min: 0 }), subs: [t02()] })));
    expect(screen.getByText('지금 출발해')).toBeTruthy(); // 시험 자체 확인
    expect(hidden('card-T-02')).toBe(false); // 처음은 중간 단
    await settle(0);
    expect(hidden('card-T-02')).toBe(true);
    expect(hidden('card-T-07')).toBe(false); // 메인 카드는 그대로
    await settle(1);
    expect(hidden('card-T-02')).toBe(false);
    await settle(2);
    expect(hidden('card-T-02')).toBe(false);
  });

  test('T15_S30_T_01_메인_+_보조_T_02_·_T_03도_같다', async () => {
    await toNow(nowServer(nowView({ main: t01(), subs: [t02(), t03()] })));
    await settle(0);
    expect(hidden('card-T-02')).toBe(true);
    expect(hidden('card-T-03')).toBe(true);
    expect(hidden('card-T-01')).toBe(false);
    await settle(1);
    expect(hidden('card-T-02')).toBe(false);
    expect(hidden('card-T-03')).toBe(false);
  });
});

