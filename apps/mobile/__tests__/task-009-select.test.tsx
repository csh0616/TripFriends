/// <reference types="jest" />
// TASK-009 앱: 사건 카드 고르기 방식(A1~A6)·실패(§6)·문구(B2 T-06 제목, B3 출처)·데모 다시 시작(C2 앱 쪽). 로직·가드레일만 본다.
// 근거: TASK-009 §A·§B·§C C2·§6·§7 AC-2·AC-4·AC-5, TASK-008 §13 H1~H4, DESIGN-001 §4-7(고르기 방식, 주황 버튼 없음 = 아직 안 바뀜),
// TASK-007 §6(409 stale·끊김), SRS FR-13(고르기 전 일정 불변), SCREEN-001 §3-2.
// 색은 "주황 버튼 개수"(AC-2)만 센다. 높이는 TASK-009 A2·A4가 숫자로 정한 것만 (action-bar 68, row-alt 64, thumb-sm 44, row-drop 52).
//
// 계약 (이 테스트가 정한 이름, 보고서 ④):
//   제안 칸: T-04 'proposal-{proposal_id}', T-06 대안 'proposal-{proposal_id}', T-06 [빼고 가기] 칸 'closed-skip'
//     칸 = 누를 수 있는 하나의 부품. accessibilityRole 'radio', 고른 칸은 accessibilityState.checked(또는 selected) true
//     T-06 대안 칸 안 사진 자리 'proposal-thumb-{proposal_id}'
//   시트 아래 확정 줄 'action-bar' 안 주 버튼 하나 'select-confirm' (글자 '이걸로 할래')
//     고르기 전 비활성 (accessibilityState.disabled true, 눌러도 아무것도 안 보냄). 누르면 POST /proposals/{고른 id}/accept (본문 없음)
//   [그대로 갈래](T-04)/[그대로 둘게](T-06) 'event-dismiss'는 칸 목록 아래 보조 버튼 (action-bar 밖)
//   §6: 409 stale → 같은 시각·위치로 check 다시, 끊김 → GET /now (accept는 다시 보내지 않음). 둘 다 고른 상태를 지운다
//   B3: 출처 글자 demo → '데모 데이터', user → '내가 확인', 그 밖 → '출처 정보' (source_type 원문은 화면에 없음)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { COLORS, NUMBERS } from '../test-support/design-table';
import { apiError, json, networkDown } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { expectNoBody, pressId, pressText, R, resetDevice, startApp, tap } from '../test-support/planning-driver';
import { session } from '../test-support/planning-fixtures';
import { REPO_ROOT } from '../test-support/source-files';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import {
  ACCEPT_ROUTE,
  chosenSeed,
  delayedView,
  DISMISS_ROUTE,
  nowItem,
  nowView,
  PROPOSAL_SPOT,
  proposal,
  proposalPacked,
  t01,
  t02,
  t03,
  t04,
} from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; children: unknown[]; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const inCard = (id: string) => within(byId(id) as never);
const textOf = (host: Tree) => {
  const flat = (value: unknown): string => (Array.isArray(value) ? value.map(flat).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  return flat(host.props.children);
};
const words = (id: string) =>
  byId(id)
    .queryAll((inner) => inner.type === 'Text')
    .map(textOf)
    .join(' ');
const chain = (host: Tree): Tree[] => {
  const list: Tree[] = [];
  for (let now: Tree | null = host; now; now = now.parent) list.push(now);
  return list;
};
const same = (a: unknown, b: string) => String(a).toUpperCase() === b.toUpperCase();
const AT = (clock: string) => `2026-12-02T${clock}:00`;

/** testID가 붙은 부품에서 실제로 눌리는 상자 (onClick이 있는 View) */
const pressable = (id: string): Tree => {
  const host = byId(id);
  return chain(host).find((h) => typeof h.props.onClick === 'function') ?? host.queryAll((h) => typeof h.props.onClick === 'function')[0] ?? host;
};
/** 고른 상태: 칸 부품(또는 그 눌리는 상자)의 접근성 상태 */
const isChosen = (id: string) =>
  [byId(id), pressable(id)].some((host) => {
    const state = host.props.accessibilityState ?? {};
    return state.checked === true || state.selected === true || host.props['aria-checked'] === true || host.props['aria-selected'] === true;
  });
const roleOf = (id: string) => [byId(id), pressable(id)].map((host) => host.props.accessibilityRole ?? host.props.role);
const isDisabled = (id: string) =>
  [byId(id), pressable(id)].some((host) => host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true);
/** 화면 전체에서 주황 바탕의 눌리는 버튼 수 (AC-2) */
const orangeButtons = () =>
  (screen.root as unknown as Tree).queryAll((host) => typeof host.props.onClick === 'function' && same(styleOf(host).backgroundColor, COLORS.brand)).length;
const sizeOf = (host: Tree, key: 'height' | 'width') => {
  const style = styleOf(host);
  const min = key === 'height' ? style.minHeight : style.minWidth;
  return [style[key], min].filter((value): value is number => typeof value === 'number');
};
/** 누를 수 있는 높이: height·minHeight + hitSlop */
function reachHeight(host: Tree): number {
  const slop = host.props.hitSlop ?? {};
  const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
  const numeric = sizeOf(host, 'height');
  return (numeric.length ? Math.max(...numeric) : 0) + extra;
}
/** 칸 높이: 칸 부품이나 그 눌리는 상자 중 height/minHeight가 있는 값 */
const rowHeight = (id: string) => [...sizeOf(byId(id), 'height'), ...sizeOf(pressable(id), 'height')];

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

// ---------- 가짜 서버 값 (T-06은 visit-check.test.tsx와 같은 모양) ----------

const hoursFact = (status: string, over: object = {}) => ({ field: 'opening_hours', value: '10:00-18:00', status, source_type: 'demo', checked_at: null, ...over });
const altItem = (placeId: string, name: string) => ({ ...nowItem(2, name, '12:20', '13:00', 'confirmed', PROPOSAL_SPOT), place_id: placeId, facts: [hoursFact('unverified')] });
const LATER_ITEM = { ...nowItem(3, '서버_뒤_장소', '13:30', '15:00', 'unknown'), place_id: 'D03' };
const replace = (id: string, placeId: string, name: string) => ({
  proposal_id: id,
  label: 'relaxed',
  reason: `서버_${id}_이유`,
  dropped: [],
  keeps_fixed: true,
  first_leave_at: '12:00',
  items: [altItem(placeId, name), LATER_ITEM],
  closed: { alternative: { place_id: placeId, name }, distance_m: 350, travel_change_min: 4, reordered: false },
});
const skip = () => ({
  proposal_id: 'skip-1',
  label: 'relaxed',
  reason: '서버_빼고_이유',
  dropped: [{ place_id: 'D02', name: '서버_닫힌_곳' }],
  keeps_fixed: true,
  first_leave_at: '12:00',
  items: [LATER_ITEM],
  closed: { alternative: null, distance_m: null, travel_change_min: -5, reordered: false },
});
const t06 = (over: object = {}) => ({
  type: 'T-06',
  event_id: 'ev-closed',
  closed: { place_id: 'D02', name: '서버_닫힌_곳' },
  proposals: [replace('alt-1', 'D09', '서버_대안_장소'), replace('alt-2', 'D10', '서버_대안_둘'), skip()],
  ...over,
});
const closedEvent = { event_id: 'ev-closed', type: 'closed', severity: 'high', delay_min: 0, state: 'awaiting', proposals: [] };
const closedView = (over: object = {}) => nowView({ main: t06(), subs: [t03()], reason: '서버_T06_이유', event: closedEvent, ...over });

type Kind = {
  card: string;
  view: () => object;
  rows: string[]; // 칸 testID
  accepts: string[]; // 칸마다 그 제안의 proposal_id
  event: string;
  keep: string; // 보조 버튼 글자
};
const KINDS: [string, Kind][] = [
  [
    'T-04',
    { card: 'card-T-04', view: () => delayedView(), rows: ['proposal-prop-relaxed', 'proposal-prop-packed'], accepts: ['prop-relaxed', 'prop-packed'], event: 'ev-1', keep: '그대로 갈래' },
  ],
  [
    'T-06',
    {
      card: 'card-T-06',
      view: () => closedView(),
      rows: ['proposal-alt-1', 'proposal-alt-2', 'closed-skip'],
      accepts: ['alt-1', 'alt-2', 'skip-1'],
      event: 'ev-closed',
      keep: '그대로 둘게',
    },
  ],
];

async function open(kind: Kind): Promise<NowControl> {
  const control = nowServer(kind.view());
  for (const id of kind.accepts) control.server.on(ACCEPT_ROUTE(id), json(200, nowView({ main: t01(), subs: [t03()] })));
  control.server.on(DISMISS_ROUTE(kind.event), json(200, nowView({ main: t01(), subs: [t03()] })));
  await toNow(control);
  return control;
}
const accepted = (control: NowControl) => control.server.requests.filter((request) => /\/accept$/.test(request.path));

// ---------- A1~A5 고르기 방식 (T-04·T-06 공통) ----------

describe.each(KINDS)('A 고르기 방식 %s', (_name, kind) => {
  const [firstRow, secondRow] = kind.rows;

  test('T9_A1_칸은_고르는_칸_radio이고_처음에는_아무것도_안_골라져_있다', async () => {
    await open(kind);
    for (const row of kind.rows) {
      expect([row, roleOf(row).includes('radio')]).toEqual([row, true]);
      expect([row, isChosen(row)]).toEqual([row, false]);
    }
  });

  test('T9_A1_칸을_누르면_그_칸만_고른_상태', async () => {
    await open(kind);
    await pressId(firstRow);
    expect(kind.rows.map(isChosen)).toEqual(kind.rows.map((row) => row === firstRow));
  });

  test('T9_A1_다른_칸을_누르면_고른_칸이_바뀐다', async () => {
    await open(kind);
    await pressId(firstRow);
    await pressId(secondRow);
    expect(kind.rows.map(isChosen)).toEqual(kind.rows.map((row) => row === secondRow));
  });

  test('T9_A1_고른_칸을_다시_누르면_해제', async () => {
    await open(kind);
    await pressId(firstRow);
    await pressId(firstRow);
    expect(kind.rows.map(isChosen)).toEqual(kind.rows.map(() => false));
  });

  test('T9_A2_시트_아래_action_bar에_주_버튼_이걸로_할래_하나', async () => {
    await open(kind);
    expect(screen.getAllByText('이걸로 할래')).toHaveLength(1);
    expect(within(byId('action-bar') as never).getByTestId('select-confirm')).toBeTruthy();
    expect(within(byId('select-confirm') as never).getByText('이걸로 할래')).toBeTruthy();
    expect(screen.queryByText('이걸로')).toBeNull(); // 칸별 [이걸로] 없음 (G5를 바꿈)
  });

  test('T9_A2_action_bar_높이_68', async () => {
    await open(kind);
    expect(sizeOf(byId('action-bar'), 'height')).toContain(68);
  });

  test('T9_A2_고르기_전에는_비활성이고_눌러도_아무것도_안_보낸다', async () => {
    const control = await open(kind);
    expect(isDisabled('select-confirm')).toBe(true);
    const before = control.server.requests.length;
    await pressId('select-confirm');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(control.server.requests).toHaveLength(before);
  });

  test.each(kind.rows.map((row, index) => [row, kind.accepts[index]]))('T9_A2_%s를_고르고_누르면_그_제안_accept_본문_없이_한_번', async (row, id) => {
    const control = await open(kind);
    await pressId(row);
    expect(isDisabled('select-confirm')).toBe(false);
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE(id))).toHaveLength(1));
    expectNoBody(control.server.sent(ACCEPT_ROUTE(id))[0].body);
    expect(accepted(control)).toHaveLength(1);
  });

  test('T9_A2_바꾼_뒤_누르면_나중에_고른_제안만_accept', async () => {
    const control = await open(kind);
    await pressId(firstRow);
    await pressId(secondRow);
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE(kind.accepts[1]))).toHaveLength(1));
    expect(control.server.sent(ACCEPT_ROUTE(kind.accepts[0]))).toEqual([]);
  });

  test('T9_A2_해제하면_다시_비활성이고_눌러도_안_보낸다', async () => {
    const control = await open(kind);
    await pressId(firstRow);
    await pressId(firstRow);
    expect(isDisabled('select-confirm')).toBe(true);
    await pressId('select-confirm');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(accepted(control)).toEqual([]);
  });

  test('T9_A3_그대로_버튼은_칸_목록_아래_보조_버튼이고_action_bar_밖', async () => {
    await open(kind);
    expect(within(byId('event-dismiss') as never).getByText(kind.keep)).toBeTruthy();
    expect(chain(byId('event-dismiss')).some((host) => host.props.testID === 'action-bar')).toBe(false);
    expect(same(styleOf(pressable('event-dismiss')).backgroundColor, COLORS.brand)).toBe(false);
    const order = byId(kind.card)
      .queryAll((host) => typeof host.props.testID === 'string' && [...kind.rows, 'event-dismiss'].includes(host.props.testID))
      .map((host) => host.props.testID);
    const unique = [...new Set(order)];
    expect(unique.at(-1)).toBe('event-dismiss');
    expect(unique.slice(0, -1)).toEqual(kind.rows);
  });

  test('T9_A3_그대로_버튼은_고르지_않아도_바로_dismiss_한_번이고_accept는_없다', async () => {
    const control = await open(kind);
    await pressId('event-dismiss');
    await waitFor(() => expect(control.server.sent(DISMISS_ROUTE(kind.event))).toHaveLength(1));
    expect(accepted(control)).toEqual([]);
  });

  test('T9_A5_AC2_고르기_바꾸기_해제만으로는_서버_요청_0건', async () => {
    const control = await open(kind);
    const before = control.server.requests.length;
    for (const row of kind.rows) await pressId(row);
    await pressId(firstRow);
    await pressId(firstRow);
    await new Promise((resolve) => setTimeout(resolve, 400)); // 디바운스(300ms)가 지나도
    expect(control.server.requests).toHaveLength(before);
  });

  test('T9_AC2_고르기_전_주황_버튼_0개_고른_뒤_1개_해제하면_다시_0개', async () => {
    await open(kind);
    expect(orangeButtons()).toBe(0);
    await pressId(firstRow);
    expect(orangeButtons()).toBe(1);
    expect(same(styleOf(pressable('select-confirm')).backgroundColor, COLORS.brand)).toBe(true);
    await pressId(secondRow);
    expect(orangeButtons()).toBe(1);
    await pressId(secondRow);
    expect(orangeButtons()).toBe(0);
  });

  test.each([...kind.rows, 'select-confirm'])('T9_NFR13_%s_누르는_높이_44_이상', async (id) => {
    await open(kind);
    expect(reachHeight(pressable(id))).toBeGreaterThanOrEqual(NUMBERS['touch-min']);
  });

  test('T9_A5_FR13_고른_칸의_제안은_확정_전_지도에_그리지_않는다', async () => {
    await open(kind);
    await pressId(firstRow);
    const markers = (screen.root as unknown as Tree).queryAll((host) => host.props.mapElement === 'Marker').map((host) => host.props.coordinate);
    expect(markers).not.toContainEqual({ latitude: PROPOSAL_SPOT.lat, longitude: PROPOSAL_SPOT.lng });
  });
});

// ---------- A4 T-06 칸 ----------

describe('A4 T-06 칸', () => {
  test.each(['proposal-alt-1', 'proposal-alt-2'])('T9_A4_대안_칸_%s_높이는_row_alt_64', async (id) => {
    await open(KINDS[1][1]);
    expect(rowHeight(id)).toContain(64);
  });

  test.each(['alt-1', 'alt-2'])('T9_A4_대안_칸_%s_안_사진_자리는_thumb_sm_44', async (id) => {
    await open(KINDS[1][1]);
    const thumb = inCard(`proposal-${id}`).getByTestId(`proposal-thumb-${id}`) as unknown as Tree;
    expect(sizeOf(thumb, 'width')).toContain(44);
    expect(sizeOf(thumb, 'height')).toContain(44);
  });

  test('T9_A4_빼고_가기_칸_높이는_row_drop_52', async () => {
    await open(KINDS[1][1]);
    expect(rowHeight('closed-skip')).toContain(52);
  });

  test('T9_A4_빼고_가기_칸에는_빼고_가기와_서버_이유', async () => {
    await open(KINDS[1][1]);
    expect(words('closed-skip')).toContain('빼고 가기');
    expect(words('closed-skip')).toContain('서버_빼고_이유');
  });

  test('T9_A4_대안이_0곳이어도_빼고_가기_칸을_골라_확정할_수_있다', async () => {
    const control = nowServer(closedView({ main: t06({ proposals: [skip()] }) }));
    control.server.on(ACCEPT_ROUTE('skip-1'), json(200, nowView({ main: t01(), subs: [t03()] })));
    await toNow(control);
    expect(orangeButtons()).toBe(0);
    await pressId('closed-skip');
    expect(isChosen('closed-skip')).toBe(true);
    expect(orangeButtons()).toBe(1);
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('skip-1'))).toHaveLength(1));
  });

  test('T9_A4_대안_칸에서_빼고_가기_칸으로_바꾸면_skip_제안을_accept', async () => {
    const control = await open(KINDS[1][1]);
    await pressId('proposal-alt-1');
    await pressId('closed-skip');
    expect(isChosen('proposal-alt-1')).toBe(false);
    expect(isChosen('closed-skip')).toBe(true);
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('skip-1'))).toHaveLength(1));
    expect(control.server.sent(ACCEPT_ROUTE('alt-1'))).toEqual([]);
  });
});

// ---------- §6 고른 뒤 실패 ----------

describe('§6 고른 뒤 실패', () => {
  const noneChosen = (rows: string[]) => rows.map((row) => [row, isChosen(row)]);

  test('T9_S6_T_04_409_stale이면_check를_다시_부르고_고른_상태를_지운다', async () => {
    const control = nowServer(delayedView());
    control.server.once(ACCEPT_ROUTE('prop-packed'), apiError(409, 'STATE_CONFLICT', { reason: 'stale' }));
    await toNow(control);
    const lastCheck = control.checks().at(-1);
    const before = control.checks().length;
    // 새 제안에 같은 id가 다시 와도 고른 상태는 남지 않아야 한다
    control.show(delayedView({ main: t04({ proposals: [proposal({ reason: '서버_새_이유' }), proposalPacked()] }) }));
    await pressId('proposal-prop-packed');
    await pressId('select-confirm');
    await waitFor(() => expect(control.checks().length).toBe(before + 1));
    expect(control.checks().at(-1)?.at).toBe(lastCheck?.at);
    expect(await screen.findByText('시간이 지나서 다시 찾아봤어')).toBeTruthy();
    await screen.findByText('서버_새_이유');
    expect(noneChosen(['proposal-prop-relaxed', 'proposal-prop-packed'])).toEqual([
      ['proposal-prop-relaxed', false],
      ['proposal-prop-packed', false],
    ]);
    expect(isDisabled('select-confirm')).toBe(true);
    expect(orangeButtons()).toBe(0);
    expect(control.server.sent(ACCEPT_ROUTE('prop-packed'))).toHaveLength(1);
  });

  test('T9_S6_T_06_409_stale이면_check를_다시_부르고_고른_상태를_지운다', async () => {
    const control = nowServer(closedView());
    control.server.once(ACCEPT_ROUTE('alt-2'), apiError(409, 'STATE_CONFLICT', { reason: 'stale' }));
    await toNow(control);
    const before = control.checks().length;
    await pressId('proposal-alt-2');
    await pressId('select-confirm');
    await waitFor(() => expect(control.checks().length).toBe(before + 1));
    await screen.findByText('시간이 지나서 다시 찾아봤어');
    expect(noneChosen(['proposal-alt-1', 'proposal-alt-2', 'closed-skip']).every(([, chosen]) => chosen === false)).toBe(true);
    expect(isDisabled('select-confirm')).toBe(true);
    expect(control.server.sent(ACCEPT_ROUTE('alt-2'))).toHaveLength(1);
  });

  test.each(KINDS)('T9_S6_%s_accept가_끊기면_다시_보내지_않고_GET_now_고른_상태를_지운다', async (_name, kind) => {
    const control = nowServer(kind.view());
    control.server.once(ACCEPT_ROUTE(kind.accepts[0]), networkDown);
    await toNow(control);
    const before = control.gets().length;
    // 끊긴 뒤 GET /now가 같은 카드를 다시 주는 경우 (반영 안 됨): 고른 상태가 남지 않아야 한다
    await pressId(kind.rows[0]);
    await pressId('select-confirm');
    await waitFor(() => expect(control.gets().length).toBe(before + 1));
    await screen.findByTestId(kind.card);
    await waitFor(() => expect(kind.rows.map(isChosen)).toEqual(kind.rows.map(() => false)));
    expect(isDisabled('select-confirm')).toBe(true);
    expect(control.server.sent(ACCEPT_ROUTE(kind.accepts[0]))).toHaveLength(1);
  });
});

// ---------- B2 T-06 제목 "{장소}{이/가} 닫혔대" (공유 경계 표) ----------

type Case = { kind: string; word: string; pending?: string; expected: Record<string, string> };
const TABLE = JSON.parse(readFileSync(join(REPO_ROOT, 'testdata', 'particles.json'), 'utf8')) as { cases: Case[] };
const READY = TABLE.cases.filter((row) => row.pending === undefined);

describe('B2 T-06 제목', () => {
  test('T9_B2_AC4_언덕_카페_B가_닫혔대', async () => {
    await toNow(nowServer(closedView({ main: t06({ closed: { place_id: 'D02', name: '언덕 카페 B' } }) })));
    expect(words('card-T-06')).toContain('언덕 카페 B가 닫혔대');
    expect(words('card-T-06')).not.toContain('B이');
  });

  test.each(READY.map((row) => [row.kind, row.word, row.expected['이/가']] as const))('T9_B2_T_06_제목_%s', async (_kind, name, subject) => {
    await toNow(nowServer(closedView({ main: t06({ closed: { place_id: 'D02', name } }) })));
    expect(words('card-T-06')).toContain(`${subject} 닫혔대`);
  });
});

// ---------- B3 출처 표시 ----------

describe('B3 출처 표시', () => {
  const t05 = (source: string) => ({
    type: 'T-05',
    place: { place_id: 'D02', name: '서버_확인할_곳' },
    facts: [hoursFact('unverified', { source_type: source })],
    map_url: 'https://www.google.com/maps/search/?api=1&query=35.02,134.99',
  });

  test.each([
    ['demo', '데모 데이터'],
    ['user', '내가 확인'],
    ['official', '출처 정보'],
    ['api', '출처 정보'],
    ['서버_모르는_출처', '출처 정보'],
    ['', '출처 정보'],
  ])('T9_B3_AC4_source_type_%s는_%s', async (source, label) => {
    await toNow(nowServer(nowView({ main: t05(source), subs: [t02()] })));
    expect(words('card-T-05')).toContain(label);
    if (source !== '') expect(words('card-T-05')).not.toContain(source);
  });

  test('T9_B3_사용자_확인이면_내가_확인과_확인_날짜', async () => {
    await toNow(nowServer(nowView({ main: { ...t05('user'), facts: [hoursFact('confirmed', { source_type: 'user', checked_at: AT('11:40') })] }, subs: [t02()] })));
    expect(words('card-T-05')).toContain('내가 확인');
    expect(words('card-T-05')).toContain('확인: 2026-12-02');
  });

  test('T9_B3_화면_어디에도_source_type_원문_demo가_없다', async () => {
    await toNow(nowServer(nowView({ main: t05('demo'), subs: [t02(), t03()] })));
    const all = (screen.root as unknown as Tree)
      .queryAll((host) => host.type === 'Text')
      .map(textOf)
      .join(' ');
    expect(all).not.toMatch(/\bdemo\b/);
  });
});

// ---------- C2 앱: [처음부터 다시] 뒤 다음 데모는 새 시드 ----------

describe('C2 데모 다시 시작 (앱)', () => {
  const restartFromProfile = async () => {
    await tap(screen.getByRole('button', { name: '프로필' }));
    await screen.findByTestId('profile-sheet');
    await pressId('profile-restart');
    await screen.findByText('데모 여행 시작');
  };

  test('T9_C2_AC5_처음부터_다시_뒤_데모_여행_시작은_새로_시드하고_새_날로_계획', async () => {
    const { control } = await toNow();
    expect(control.server.sent(R.seed)).toHaveLength(1);
    control.server.once(R.seed, json(201, { trip_id: 'trip-new', day_ids: ['new-1', 'new-2', 'new-3'] }));
    control.server.on('POST /days/new-2/planning', json(201, session));
    await restartFromProfile();
    await pressText('데모 여행 시작');
    await waitFor(() => expect(control.server.sent(R.seed)).toHaveLength(2));
    await waitFor(() => expect(control.server.sent('POST /days/new-2/planning')).toHaveLength(1));
    expect(control.server.sent(R.start)).toHaveLength(1); // 이전 데모의 날(day-2)로 다시 시작하지 않는다
  });

  test('T9_C2_AC5_처음부터_다시_뒤_여행_중_데모_바로_보기도_새로_시드하고_새_날을_연다', async () => {
    const control = nowServer();
    control.server.on(R.seed, json(201, chosenSeed()));
    await startApp();
    await pressId('s0-now-demo');
    await screen.findByTestId('now-main');
    control.server.once(R.seed, json(201, chosenSeed({ day_id: 'day-9' })));
    control.server.match('GET /days/day-9/now', () => json(200, nowView()));
    control.server.match('POST /days/day-9/check', () => json(200, nowView()));
    await restartFromProfile();
    await pressId('s0-now-demo');
    await waitFor(() => expect(control.server.sent(R.seed)).toHaveLength(2));
    expect(control.server.sent(R.seed)[1].body).toEqual({ chosen: true });
    await waitFor(() => expect(control.server.requests.some((request) => request.path.startsWith('/days/day-9/now'))).toBe(true));
  });
});
