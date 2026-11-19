/// <reference types="jest" />
// TASK-015 §31 여행 중 화면: 칩 시트 §16 보드 값(sheet-fact) · 접힘 높이는 모든 카드 전환에서 한 번에.
// 근거: TASK-015 §31("칩 시트 첫 빌드는 보드와 5곳 다름: › · [열었어][닫혔어] 쌍 · 지도 링크 · 부제 · 출처 두 줄" · "하-13 … 모든 전환에") ·
//       task-015-design §16-1(› 그대로, 모름 칩도 ›, 확인됨은 버튼 아님) · §16-3(sheet-fact 줄: 장소 이름 · 부제 "다음 장소 · 3번" · 사실 줄(값이 있으면 짧은 칩 + "오늘 11:00–21:00",
//       값이 없으면 긴 칩 "영업시간 모름" 하나) · 출처 줄 한 줄 "{출처} · 확인: {월 일}" / "{출처} · 확인한 적 없음" · 링크 · 창 안: "가기 전에 열었는지 볼래?" + [열었어][닫혔어] ·
//       창 밖: 안내 "출발 30분 전부터 [열었어] [닫혔어]로 알려 줄 수 있어" · [닫기] · aria-modal · aria-label "영업시간 확인") ·
//       §16-4(T-02 창 안 = 쌍, 창 밖 = 안내, T-01 · T-07 = 쌍도 안내도 없음, T-03 줄 칩은 버튼 아님, 열 때의 모양 그대로) ·
//       §16-5([열었어] -> 시트 닫힘, [닫혔어] -> 시트 닫힘 · T-06, 요청 중 두 버튼 비활성) · §16-6(칩 aria-label "영업시간 미확인, 눌러서 확인하기") · §17-3 하-13
//
// 계약 (이 파일이 정한 것):
//   "창 안" = 서버 can_confirm_hours true (§30). T-02에서 false면 창 밖(안내). T-01 · T-07은 값과 상관없이 쌍도 안내도 없다(§16-4)
//   › = 미확인 · 모름 버튼 칩 안의 글자 "›" (칩 글자 "영업시간 미확인"과 따로). 확인됨 칩에는 없다
//   부제: T-02는 "다음 장소 · {next_item.seq}번". T-01 · T-07 부제는 문서에 없어 보지 않는다(질문)
//   출처 줄은 한 Text: "{sourceLabel} · 확인한 적 없음" 또는 "{sourceLabel} · 확인: {M}월 {D}일" (checked_at 날짜 부분)
//   사실 줄: 값이 있으면 시트 안 칩은 짧은 글("미확인" · "모름"이 아니라 값 있는 상태 글)과 "오늘 {시작}–{끝}"(엔 대시), 값이 null이면 긴 칩 "영업시간 모름" 하나(값 글 없음)
//   요청 중: [열었어][닫혔어] 둘 다 비활성(accessibilityState.disabled). 답이 오면 시트 닫힘
//   접힘 높이 한 번에: 메인 카드가 어떤 종류에서 어떤 종류로 바뀌어도(같은 종류 포함), 새 카드를 한 그림 차례에 다 재면 snapPoints[0]은 옛 값 · 새 값만 거친다.
//     시트 단을 옮기기만 하면(펼침 -> 접힘) snapPoints[0]은 바뀌지 않는다 (영상 44.2~44.6초 "펼친 시트 -> T-01 접힘"에서 562 -> 544)
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { sourceLabel } from '@/lib/source-label';
import { layout } from '@/planning/layout';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { hang, json } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { pressId, resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import { nowItem, nowView, t01, t02, t03, t07, t08 } from '../test-support/trip-now-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const textOf = (host: Tree) => [host.props.children].flat(Infinity).filter((c: unknown) => typeof c === 'string' || typeof c === 'number').join('');
const textsIn = (host: Tree) => host.queryAll((h) => h.type === 'Text').map(textOf);
const flatWords = (id: string) => textsIn(byId(id)).join('').replace(/\s/g, '');
const VISIT_ROUTE = (placeId: string) => `POST /places/${placeId}/visit-checks`;
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

type Status = 'unverified' | 'unknown' | 'confirmed';
const placeItem = (status: Status, value: string | null = '10:00-18:00', checked_at: string | null = null, seq = 3) => ({
  ...nowItem(seq, '서버_칩_장소', '12:20', '14:00', status === 'confirmed' ? 'confirmed' : status),
  place_id: 'D02',
  facts: [{ field: 'opening_hours', value, status, source_type: 'demo', checked_at }],
});
const LONG: Record<Status, string> = { unverified: '영업시간 미확인', unknown: '영업시간 모름', confirmed: '영업시간 확인됨' };
const chipButton = (cardId: string, status: Status): Tree => {
  const label = within(screen.getByTestId(cardId)).getByText(LONG[status]) as unknown as Tree;
  for (let node: Tree | null = label; node; node = node.parent) if (node.props.accessibilityRole === 'button' || node.props.role === 'button') return node;
  throw new Error('칩 버튼이 없다');
};
async function open(control: NowControl, cardId: string, status: Status) {
  await toNow(control);
  await act(async () => {
    fireEvent.press(chipButton(cardId, status) as never);
  });
  return within(screen.getByTestId('chip-sheet'));
}
const t02With = (status: Status, can: boolean, over: { value?: string | null; checked?: string | null } = {}) =>
  t02({ next_item: placeItem(status, over.value === undefined ? '10:00-18:00' : over.value, over.checked ?? null), can_confirm_hours: can, place_map_url: PLACE_URL });

describe('§31 칩 — › · 화면 읽기 (§16-1 · §16-6)', () => {
  test.each(['unverified', 'unknown'] as const)('T15_S31_%s_버튼_칩_안에_›와_aria_label_눌러서_확인하기', async (status) => {
    await toNow(nowServer(nowView({ main: t02With(status, true), subs: [] })));
    const button = chipButton('card-T-02', status);
    expect(textsIn(button)).toContain('›');
    expect(button.props.accessibilityLabel ?? button.props['aria-label']).toBe(`${LONG[status]}, 눌러서 확인하기`);
  });

  test('T15_S31_T_03_줄_칩은_버튼이_아니다', async () => {
    await toNow(nowServer(nowView({ main: t03({ items: [placeItem('unverified')] }), subs: [] })));
    const label = within(screen.getByTestId('card-T-03')).getByText('미확인') as unknown as Tree;
    const card = byId('card-T-03');
    let button = false;
    for (let node: Tree | null = label; node && node !== card; node = node.parent) if (node.props.accessibilityRole === 'button') button = true;
    expect(button).toBe(false);
    expect(textsIn(card)).not.toContain('›');
  });
});

describe('§31 칩 시트 줄 (§16-3)', () => {
  test('T15_S31_시트는_aria_modal이고_이름이_영업시간_확인', async () => {
    await open(nowServer(nowView({ main: t02With('unverified', true), subs: [] })), 'card-T-02', 'unverified');
    const sheet = byId('chip-sheet');
    const nodes = [sheet, ...sheet.queryAll(() => true)];
    expect(nodes.some((node) => node.props.accessibilityViewIsModal === true || node.props['aria-modal'] === true)).toBe(true);
    expect(nodes.some((node) => (node.props.accessibilityLabel ?? node.props['aria-label']) === '영업시간 확인')).toBe(true);
  });

  test('T15_S31_T_02_부제는_다음_장소_·_N번', async () => {
    const sheet = await open(nowServer(nowView({ main: t02With('unverified', true), subs: [] })), 'card-T-02', 'unverified');
    expect(sheet.getByText('서버_칩_장소')).toBeTruthy();
    expect(flatWords('chip-sheet')).toContain('다음장소·3번');
  });

  test('T15_S31_값이_있으면_짧은_칩과_오늘_시각(엔_대시)', async () => {
    const sheet = await open(nowServer(nowView({ main: t02With('unverified', true), subs: [] })), 'card-T-02', 'unverified');
    expect(sheet.getByText('미확인')).toBeTruthy();
    expect(sheet.queryByText('영업시간 미확인')).toBeNull();
    expect(flatWords('chip-sheet')).toContain('오늘10:00–18:00');
  });

  test('T15_S31_값이_없으면(모름)_긴_칩_영업시간_모름_하나', async () => {
    const sheet = await open(nowServer(nowView({ main: t02With('unknown', true, { value: null }), subs: [] })), 'card-T-02', 'unknown');
    expect(sheet.getAllByText('영업시간 모름')).toHaveLength(1);
    expect(sheet.queryByText('모름')).toBeNull();
    expect(flatWords('chip-sheet')).not.toMatch(/오늘\d/);
  });

  test('T15_S31_출처_줄은_한_줄_출처_·_확인한_적_없음', async () => {
    const sheet = await open(nowServer(nowView({ main: t02With('unverified', true), subs: [] })), 'card-T-02', 'unverified');
    expect(sheet.getByText(`${sourceLabel('demo')} · 확인한 적 없음`)).toBeTruthy();
  });

  test('T15_S31_출처_줄은_한_줄_출처_·_확인:_M월_D일', async () => {
    const sheet = await open(nowServer(nowView({ main: t02With('unverified', true, { checked: '2026-11-01T09:00:00+09:00' }), subs: [] })), 'card-T-02', 'unverified');
    expect(sheet.getByText(`${sourceLabel('demo')} · 확인: 11월 1일`)).toBeTruthy();
  });
});

describe('§31 언제 어떤 모양 (§16-4)', () => {
  test.each(['unverified', 'unknown'] as const)('T15_S31_T_02_%s_창_안이면_질문과_쌍_안내는_없음', async (status) => {
    const sheet = await open(nowServer(nowView({ main: t02With(status, true), subs: [] })), 'card-T-02', status);
    expect(sheet.getByText(QUESTION)).toBeTruthy();
    expect(sheet.getByTestId('visit-open')).toBeTruthy();
    expect(sheet.getByTestId('visit-closed')).toBeTruthy();
    expect(sheet.queryByText(HINT)).toBeNull();
    expect(sheet.getByText('구글 지도에서 보기')).toBeTruthy();
  });

  test.each(['unverified', 'unknown'] as const)('T15_S31_T_02_%s_창_밖이면_안내_한_줄_쌍과_질문은_없음', async (status) => {
    const sheet = await open(nowServer(nowView({ main: t02With(status, false), subs: [] })), 'card-T-02', status);
    expect(sheet.getByText(HINT)).toBeTruthy();
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    expect(sheet.queryByText(QUESTION)).toBeNull();
  });

  test('T15_S31_T_01_·_T_07은_쌍도_안내도_없다', async () => {
    let sheet = await open(nowServer(nowView({ main: t01({ item: placeItem('unverified'), can_confirm_hours: false, place_map_url: PLACE_URL }), subs: [] })), 'card-T-01', 'unverified');
    expect(sheet.queryByText(HINT)).toBeNull();
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    await screen.unmount();
    resetDevice();
    mapControl.reset();
    sheetControl.reset();
    installConfig(TEST_KEY);
    const fixed = { name: '서버_식당_이름', title: '서버_예약_제목', start: '15:00', end: '16:00', facts: placeItem('unverified').facts };
    sheet = await open(nowServer(nowView({ main: t07({ fixed, can_confirm_hours: false, place_map_url: PLACE_URL }), subs: [] })), 'card-T-07', 'unverified');
    expect(sheet.queryByText(HINT)).toBeNull();
    expect(sheet.queryByTestId('visit-open')).toBeNull();
  });

  test('T15_S31_시트가_떠_있는_동안_창이_열려도_열_때의_모양_그대로', async () => {
    const control = nowServer(nowView({ main: t02With('unverified', false), subs: [] }));
    const sheet = await open(control, 'card-T-02', 'unverified');
    expect(sheet.getByText(HINT)).toBeTruthy();
    control.show(nowView({ main: t02With('unverified', true), subs: [] }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.requests().length).toBeGreaterThanOrEqual(3));
    await act(async () => undefined);
    const still = within(screen.getByTestId('chip-sheet'));
    expect(still.getByText(HINT)).toBeTruthy();
    expect(still.queryByTestId('visit-open')).toBeNull();
  });
});

describe('§31 누른 뒤 (§16-5)', () => {
  test.each([
    ['visit-open', true],
    ['visit-closed', false],
  ] as const)('T15_S31_%s_답이_오면_시트가_닫힌다', async (button, wasOpen) => {
    const control = nowServer(nowView({ main: t02With('unverified', true), subs: [] }));
    control.server.on(VISIT_ROUTE('D02'), json(200, nowView({ main: t01(), subs: [t03()] })));
    const sheet = await open(control, 'card-T-02', 'unverified');
    await act(async () => {
      fireEvent.press(sheet.getByTestId(button));
    });
    await waitFor(() => expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1));
    expect((control.server.sent(VISIT_ROUTE('D02'))[0].body as { was_open: boolean }).was_open).toBe(wasOpen);
    await waitFor(() => expect(screen.queryByTestId('chip-sheet')).toBeNull());
  });

  test('T15_S31_요청_중에는_두_버튼이_비활성이고_다시_보내지_않는다', async () => {
    const control = nowServer(nowView({ main: t02With('unverified', true), subs: [] }));
    control.server.on(VISIT_ROUTE('D02'), hang);
    const sheet = await open(control, 'card-T-02', 'unverified');
    await act(async () => {
      fireEvent.press(sheet.getByTestId('visit-open'));
    });
    const disabled = (id: string) => {
      const host = byId(id);
      return host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true;
    };
    await waitFor(() => expect(disabled('visit-open')).toBe(true));
    expect(disabled('visit-closed')).toBe(true);
    await act(async () => {
      fireEvent.press(byId('visit-closed') as never);
      fireEvent.press(byId('visit-open') as never);
    });
    expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1);
  });
});

describe('§31 하-13 접힘 높이는 모든 카드 전환에서 한 번에', () => {
  const AREA_H = 746;
  const HANDLE = 2 * layout.sheetHandlePad + layout.sheetHandleHeight;
  const chain = (host: Tree): Tree[] => {
    const out: Tree[] = [];
    for (let node: Tree | null = host; node; node = node.parent) out.push(node);
    return out;
  };
  const insideText = (host: Tree | null): boolean => host !== null && (host.type === 'Text' || insideText(host.parent));
  const pressable = (host: Tree) => typeof host.props.onClick === 'function';
  const insidePressable = (host: Tree | null): boolean => host !== null && (pressable(host) || insidePressable(host.parent));
  function lastElement(type: string): Tree {
    const items = byId(`card-${type}`).queryAll(
      (host) => (pressable(host) && !insidePressable(host.parent)) || (host.type === 'Text' && !insideText(host.parent) && !insidePressable(host.parent)),
    );
    return items[items.length - 1];
  }
  async function measureAtOnce(type: string, y: number, height: number) {
    const sheetHost = byId('card-sheet');
    const area = chain(sheetHost).find((host) => typeof host.props.onLayout === 'function') as Tree;
    const path = chain(lastElement(type));
    const stop = path.indexOf(sheetHost);
    const measured = path.slice(0, stop < 0 ? path.length : stop).filter((host) => typeof host.props.onLayout === 'function');
    expect(measured.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      area.props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 0, width: 390, height: AREA_H } } });
      for (const [i, host] of measured.entries()) {
        host.props.onLayout({ persist() {}, nativeEvent: { layout: i === 0 ? { x: 0, y, width: 342, height } : { x: 0, y: 0, width: 390, height: 400 } } });
      }
    });
  }
  const low = () => (sheetControl.props?.snapPoints as (string | number)[])[0];
  const t05 = () => ({
    type: 'T-05',
    place: { place_id: 'D02', name: '서버_확인할_곳' },
    facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'unverified', source_type: 'demo', checked_at: null }],
    map_url: PLACE_URL,
  });
  // [종류, 카드, 마지막 요소 높이]
  const KINDS: [string, () => object, number][] = [
    ['T-01', () => t01(), 22],
    ['T-02', () => t02(), 44],
    ['T-05', () => t05(), 52],
    ['T-07', () => t07(), 22],
    ['T-08', () => t08(), 52],
  ];
  const PAIRS = KINDS.flatMap((from) => KINDS.filter((to) => to[0] !== from[0]).map((to) => [`${from[0]}_->_${to[0]}`, from, to] as const));

  test.each(PAIRS)('T15_S31_%s_접힌_단은_옛_값과_새_값만_거친다', async (_name, from, to) => {
    const control = nowServer(nowView({ main: from[1](), subs: [] }));
    await toNow(control);
    await measureAtOnce(from[0], 100, from[2]);
    const old = low();
    sheetControl.history = [];
    control.show(nowView({ main: to[1](), subs: [] }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId(`card-${to[0]}`);
    await measureAtOnce(to[0], 60, to[2]);
    const target = HANDLE + 60 + to[2] + 4;
    expect(low()).toBe(target);
    for (const value of new Set(sheetControl.history.map((points) => points[0]))) expect([old, target]).toContain(value);
  });

  test('T15_S31_같은_종류에서_내용이_늘어도_옛_값과_새_값만_거친다', async () => {
    const control = nowServer(nowView({ main: t07({ leave_in_min: 0 }), subs: [] }));
    await toNow(control);
    await measureAtOnce('T-07', 70, 22);
    const old = low();
    sheetControl.history = [];
    control.show(nowView({ main: t07({ leave_in_min: 14 }), subs: [] }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByText('14');
    await measureAtOnce('T-07', 90, 22);
    const target = HANDLE + 90 + 22 + 4;
    expect(low()).toBe(target);
    for (const value of new Set(sheetControl.history.map((points) => points[0]))) expect([old, target]).toContain(value);
  });

  test('T15_S31_펼친_시트에서_접힘으로_옮기기만_하면_접힌_단_값이_바뀌지_않는다', async () => {
    await toNow(nowServer(nowView({ main: t01(), subs: [t02(), t03()] })));
    await measureAtOnce('T-01', 100, 22);
    const before = low();
    sheetControl.history = [];
    await act(async () => {
      sheetControl.settle(2, AREA_H);
    });
    await act(async () => {
      sheetControl.settle(0, AREA_H);
    });
    for (const points of sheetControl.history) expect(points[0]).toBe(before);
  });
});
