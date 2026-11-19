/// <reference types="jest" />
// TASK-015 §29 여행 중 화면: 미확인 · 모름 칩을 누르면 작은 시트 · 칩 글자 자리별 표 · 접힘일 때 이유 줄 · 접힌 단은 목표 값으로 한 번에. 로직 · 가드레일만 (시트 보드 값은 디자이너 보드가 나온 뒤).
// 근거: TASK-015 §29 표("미확인 · 모름 칩 누르기 -> 작은 시트(출처 · 확인 날짜 · [구글 지도에서 보기], [열었어][닫혔어]는 확인 시간 창 안에서만) — 승인, 이번 TASK" ·
//       "칩 글자: 영업 값이 옆에 있으면 짧게, 없으면 '영업시간 …'으로 길게 · '늘 열려 있어' · T-05 사실 줄은 짧게 · '추천 시간대'는 윤곽 칩 그대로" · "T-03 줄 예외로 짧게" ·
//       "하: 짧아지는 카드로 바뀔 때 이유 줄이 잘린 채 비침 -> 시트가 다 움직인 뒤 이유 줄을 보이게(또는 페이드에 포함)" · "하: 접힌 높이 633 -> 610 되돌아옴 -> 목표 높이로 한 번에") ·
//       task-015-design §15-5(칩 표 · 미확인 칩 누르기 제안: 장소 이름 · 사실 줄(칩 + 출처 + "확인: {날짜}" 또는 "확인한 적 없음") · [구글 지도에서 보기] · [닫기].
//         T-05와 같은 내용. 확인됨 칩은 버튼이 아니다. 칩에 "›" 같은 표시를 더하지 않는다) · §15-2 하-12("접힘일 때 이유 줄은 opacity 0이거나 그리지 않는다") · 하-13("한 번만 움직인다") ·
//       TASK-008 A2(확인 시간 창 = leave_at − 30 ≤ at < next.start) · Q26(창 밖 visit-check는 409)
//
// 계약 (이 파일이 정한 것):
//   칩 시트: T-01 · T-02 · T-07 라벨 줄의 미확인 · 모름 칩은 버튼(accessibilityRole 'button'), 누르면 testID `chip-sheet`가 열린다. 확인됨 칩은 버튼이 아니고 눌러도 안 열린다
//     시트 안: 장소 이름(T-01 item.name · T-02 next_item.name · T-07 fixed.name) · 칩 · 출처 글(@/lib/source-label sourceLabel) ·
//       checked_at이 있으면 "확인: YYYY-MM-DD", 없으면 "확인한 적 없음" (T-05 사실 줄과 같은 글) · [닫기](testID `chip-sheet-close`)를 누르면 닫힌다
//     시트를 열고 닫아도 서버에 요청이 없다
//     [열었어][닫혔어]: 확인 시간 창을 앱이 알 수 있는 값이 응답에 없어(질문) "창 밖이면 없다"만 본다 — T-01(지금 있는 곳, 이미 도착 = 창 밖)에서는 시트에 visit-open · visit-closed 없음
//     [구글 지도에서 보기]: T-01 · T-02 · T-07 장소 줄에 장소 지도 링크가 응답에 없어(질문) 이 파일은 보지 않는다
//   칩 글자(자리별 표, 옛 -> 새는 trip-now.test.tsx): 라벨 줄 = 긴 글 · T-03 줄 = 확인됨 · 미확인 짧게, 모름만 긴 글 · "늘 열려 있어" 옆 = 짧은 확인됨 · T-05 사실 줄 = 짧게 · 추천 시간대 = 그대로
//   이유 줄: 시트가 접힌 단(index 0)에 있으면 이유 줄(now-reason)은 그리지 않거나 opacity 0. 중간 · 높은 단에서는 보인다
//   접힌 단 한 번에: 메인 카드가 다른 종류로 바뀌고 새 카드의 자리를 한 그림 차례에 다 재면, 그 사이 snapPoints[0]은 옛 값 · 새 값 둘만 거친다(중간 값 없음).
//     시트 움직임은 넘침이 없는 시간 애니메이션(animationConfigs에 스프링 값 damping · stiffness · mass 없음)
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { sourceLabel } from '@/lib/source-label';
import { layout } from '@/planning/layout';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { pressId, resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { nowItem, nowView, t01, t02, t03, t07, t08 } from '../test-support/trip-now-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const nowCard = (card: object) => nowView({ main: card, subs: [] });
const textOf = (host: Tree) => [host.props.children].flat(Infinity).filter((c: unknown) => typeof c === 'string' || typeof c === 'number').join('');
const words = (id: string) => byId(id).queryAll((h) => h.type === 'Text').map(textOf).join(' ');
const chain = (host: Tree): Tree[] => {
  const out: Tree[] = [];
  for (let node: Tree | null = host; node; node = node.parent) out.push(node);
  return out;
};
const isButton = (host: Tree, stop: Tree) => {
  for (const node of chain(host)) {
    if (node.props.accessibilityRole === 'button' || node.props.role === 'button') return true;
    if (node === stop) return false;
  }
  return false;
};

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

const CHECKED = '2026-11-01T09:00:00+09:00';
const withFact = (status: 'confirmed' | 'unverified' | 'unknown', checked_at: string | null = null) => ({
  ...nowItem(2, '서버_칩_장소', '12:20', '14:00', status),
  facts: [{ field: 'opening_hours', value: '10:00-18:00', status, source_type: 'demo', checked_at }],
});
// [이름, 카드 만들기(상태, 확인 날짜), 카드 testID, 시트에 나올 장소 이름]
const CARDS: [string, (status: 'confirmed' | 'unverified' | 'unknown', checked?: string | null) => object, string, string][] = [
  ['T_01', (status, checked = null) => t01({ item: withFact(status, checked) }), 'card-T-01', '서버_칩_장소'],
  ['T_02', (status, checked = null) => t02({ next_item: withFact(status, checked) }), 'card-T-02', '서버_칩_장소'],
  [
    'T_07',
    (status, checked = null) => t07({ fixed: { name: '서버_식당_이름', title: '서버_예약_제목', start: '15:00', end: '16:00', facts: withFact(status, checked).facts } }),
    'card-T-07',
    '서버_식당_이름',
  ],
];
const LONG: Record<'unverified' | 'unknown', string> = { unverified: '영업시간 미확인', unknown: '영업시간 모름' };

describe('§29 미확인 · 모름 칩을 누르면 작은 시트', () => {
  const cases = CARDS.flatMap(([name, card, id, place]) => (['unverified', 'unknown'] as const).map((status) => [`${name}_${status}`, card, id, place, status] as const));

  test.each(cases)('T15_S29_%s_칩은_버튼이고_누르면_장소_이름_·_출처_·_확인한_적_없음_시트', async (_name, card, id, place, status) => {
    const { control } = await toNow(nowServer(nowCard(card(status))));
    const chip = within(screen.getByTestId(id)).getByText(LONG[status]) as unknown as Tree;
    expect(isButton(chip, byId(id))).toBe(true);
    expect(screen.queryByTestId('chip-sheet')).toBeNull();
    const before = control.requests().length;
    await act(async () => {
      fireEvent.press(chip as never);
    });
    expect(screen.getByTestId('chip-sheet')).toBeTruthy();
    const sheet = words('chip-sheet');
    expect(sheet).toContain(place);
    expect(sheet).toContain(sourceLabel('demo'));
    expect(sheet).toContain('확인한 적 없음');
    expect(control.requests()).toHaveLength(before);
  });

  test.each(CARDS)('T15_S29_%s_확인_날짜가_있으면_확인:_날짜', async (_name, card, id) => {
    await toNow(nowServer(nowCard(card('unverified', CHECKED))));
    await act(async () => {
      fireEvent.press(within(screen.getByTestId(id)).getByText(LONG.unverified));
    });
    expect(words('chip-sheet')).toContain('확인: 11월 1일'); // §31 · §16-3 출처 줄 "{출처} · 확인: {월 일}" (§29 옛 '확인: 2026-11-01')
    expect(words('chip-sheet')).not.toContain('확인한 적 없음');
  });

  test.each(CARDS)('T15_S29_%s_닫기를_누르면_시트가_닫히고_서버_요청_없음', async (_name, card, id) => {
    const { control } = await toNow(nowServer(nowCard(card('unknown'))));
    const before = control.requests().length;
    await act(async () => {
      fireEvent.press(within(screen.getByTestId(id)).getByText(LONG.unknown));
    });
    expect(screen.getByTestId('chip-sheet')).toBeTruthy();
    await pressId('chip-sheet-close');
    expect(screen.queryByTestId('chip-sheet')).toBeNull();
    expect(control.requests()).toHaveLength(before);
  });

  test.each(CARDS)('T15_S29_%s_확인됨_칩은_버튼이_아니고_눌러도_시트가_안_열린다', async (_name, card, id) => {
    await toNow(nowServer(nowCard(card('confirmed'))));
    const chip = within(screen.getByTestId(id)).getByText('영업시간 확인됨') as unknown as Tree;
    expect(isButton(chip, byId(id))).toBe(false);
    await act(async () => {
      fireEvent.press(chip as never);
    });
    expect(screen.queryByTestId('chip-sheet')).toBeNull();
  });

  test('T15_S29_T_01(이미_도착_=_확인_시간_창_밖)_시트에는_열었어_닫혔어가_없다', async () => {
    await toNow(nowServer(nowCard(t01({ item: withFact('unverified') }))));
    await act(async () => {
      fireEvent.press(within(screen.getByTestId('card-T-01')).getByText(LONG.unverified));
    });
    const sheet = within(screen.getByTestId('chip-sheet'));
    expect(sheet.queryByTestId('visit-open')).toBeNull();
    expect(sheet.queryByTestId('visit-closed')).toBeNull();
    expect(words('chip-sheet')).not.toMatch(/열었어|닫혔어/);
  });

  // §31 · task-015-design §16-1 정정(PM 승인 11-18): 옛 "칩에 › 를 더하지 않는다" -> 미확인 · 모름 버튼 칩에는 › 가 있고 확인됨 칩에는 없다
  test('T15_S31_미확인_·_모름_버튼_칩에는_›가_있고_확인됨_칩에는_없다', async () => {
    await toNow(nowServer(nowCard(t01({ item: withFact('unverified') }))));
    expect(words('card-T-01')).toContain('›');
    await screen.unmount();
    resetDevice();
    mapControl.reset();
    sheetControl.reset();
    installConfig(TEST_KEY);
    await toNow(nowServer(nowCard(t01({ item: withFact('confirmed') }))));
    expect(words('card-T-01')).not.toContain('›');
  });
});

describe('§29 칩 글자 — 자리별 표 (task-015-design §15-5)', () => {
  test('T15_S29_라벨_줄은_긴_글(확인됨_·_미확인_·_모름)', async () => {
    for (const [status, label] of [
      ['confirmed', '영업시간 확인됨'],
      ['unverified', '영업시간 미확인'],
      ['unknown', '영업시간 모름'],
    ] as const) {
      await toNow(nowServer(nowCard(t01({ item: withFact(status) }))));
      expect(within(screen.getByTestId('card-T-01')).getByText(label)).toBeTruthy();
      await screen.unmount();
      resetDevice();
      mapControl.reset();
      sheetControl.reset();
      installConfig(TEST_KEY);
    }
  });

  test('T15_S29_T_03_줄은_확인됨_·_미확인_짧게_모름만_긴_글', async () => {
    const confirmedRow = nowItem(4, '서버_넷째_장소', '15:00', '16:00', 'confirmed');
    await toNow(nowServer(nowCard(t03({ items: [confirmedRow, nowItem(2, '서버_둘째', '12:20', '14:00', 'unverified'), nowItem(3, '서버_셋째', '14:30', '19:00', 'unknown')] }))));
    expect(within(screen.getByTestId('rest-row-4')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('rest-row-2')).getByText('미확인')).toBeTruthy();
    expect(within(screen.getByTestId('rest-row-3')).getByText('영업시간 모름')).toBeTruthy();
    for (const long of ['영업시간 확인됨', '영업시간 미확인']) expect(within(screen.getByTestId('card-T-03')).queryByText(long)).toBeNull();
  });

  test('T15_S29_늘_열려_있어_옆은_짧은_확인됨', async () => {
    await toNow(nowServer(nowCard(t01({ item: { ...withFact('confirmed'), facts: [{ ...withFact('confirmed').facts[0], source_type: 'curated', value: '00:00-24:00' }] } }))));
    expect(within(screen.getByTestId('card-T-01')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('card-T-01')).queryByText('영업시간 확인됨')).toBeNull();
  });

  test('T15_S29_추천_시간대는_그대로(영업시간_안_붙음)', async () => {
    await toNow(nowServer(nowCard(t01({ item: { ...withFact('confirmed'), facts: [{ ...withFact('confirmed').facts[0], source_type: 'curated', value: '17:00-24:00' }] } }))));
    expect(within(screen.getByTestId('card-T-01')).getByText('추천 시간대')).toBeTruthy();
    expect(words('card-T-01')).not.toContain('영업시간 추천');
  });
});

describe('§29 하-12 접힌 단에서는 이유 줄을 그리지 않는다 (짧아지는 카드로 바뀔 때 잘린 채 안 비침)', () => {
  const AREA_H = 746;
  // §31 하-15(task-015-design §17-3 "접힘일 때 접힘 밖 요소는 그리지 않는다"): 옛 "없음 또는 opacity 0" -> 그리지 않음(없음)만
  const hidden = () => screen.queryByTestId('now-reason') === null;
  async function settle(index: number) {
    await act(async () => {
      sheetControl.settle(index, AREA_H);
    });
  }

  test('T15_S29_접힌_단(index_0)이면_이유_줄_없음_중간_·_높은_단이면_보임', async () => {
    await toNow(nowServer(nowCard(t01())));
    expect(hidden()).toBe(false); // 처음은 중간 단
    await settle(0);
    expect(hidden()).toBe(true);
    await settle(1);
    expect(hidden()).toBe(false);
    await settle(2);
    expect(hidden()).toBe(false);
  });

  test('T15_S29_접힌_채_짧은_카드로_바뀌어도_이유_줄이_비치지_않는다', async () => {
    const { control } = await toNow(nowServer(nowCard(t01())));
    await settle(0);
    control.show(nowCard(t08()));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId('card-T-08');
    expect(hidden()).toBe(true);
  });
});

describe('§29 하-13 접힌 단은 목표 값으로 한 번에 (넘침 · 되돌아옴 없음)', () => {
  const AREA_H = 746;
  const HANDLE = 2 * layout.sheetHandlePad + layout.sheetHandleHeight;
  const insideText = (host: Tree | null): boolean => host !== null && (host.type === 'Text' || insideText(host.parent));
  const pressable = (host: Tree) => typeof host.props.onClick === 'function';
  const insidePressable = (host: Tree | null): boolean => host !== null && (pressable(host) || insidePressable(host.parent));
  function lastElement(type: string): Tree {
    const items = byId(`card-${type}`).queryAll(
      (host) => (pressable(host) && !insidePressable(host.parent)) || (host.type === 'Text' && !insideText(host.parent) && !insidePressable(host.parent)),
    );
    return items[items.length - 1];
  }
  /** 새 카드의 자리를 한 그림 차례(한 act)에 다 잰다 */
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

  test('T15_S29_다른_종류로_바뀔_때_접힌_단은_옛_값과_새_값_둘만_거친다', async () => {
    const { control } = await toNow(nowServer(nowCard(t01())));
    await measureAtOnce('T-01', 120, 22);
    const old = low();
    sheetControl.history = [];
    control.show(nowCard(t08()));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId('card-T-08');
    await measureAtOnce('T-08', 50, 52);
    const target = HANDLE + 50 + 52 + 4;
    expect(low()).toBe(target);
    const seen = [...new Set(sheetControl.history.map((points) => points[0]))];
    for (const value of seen) expect([old, target]).toContain(value);
  });

  test('T15_S29_시트_움직임은_넘침이_없는_시간_애니메이션(스프링_값_없음)', async () => {
    await toNow(nowServer(nowCard(t01())));
    await waitFor(() => expect(sheetControl.props?.animationConfigs).toBeDefined());
    const config = sheetControl.props?.animationConfigs as Record<string, unknown>;
    expect(typeof config.duration).toBe('number');
    for (const spring of ['damping', 'stiffness', 'mass', 'overshootClamping']) expect(config[spring]).toBeUndefined();
  });
});

