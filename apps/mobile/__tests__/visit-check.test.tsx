/// <reference types="jest" />
// 영업 확인(T-05)·닫힘 대안(T-06), 앱의 로직·가드레일. 근거: TASK-008 §C C1~C3, §0-1 G1·G4·G5, §6 앱 쪽 줄, §8 AC-6,
// SCREEN-001 §3-2(장소 카드는 확인 상태 필수)·§5, DESIGN-001 주황 규칙(주 버튼만), TASK-007 §B-4·§14.
// 색·간격은 보지 않는다. G5("[이걸로]는 보조 버튼 bg-2 + ink, 한 카드에 주황 큰 버튼 여러 개 없음")만 문서의 가드레일로 본다.
//
// 계약 (이 테스트가 정한 이름, 보고서 ④):
//   T-05 카드 'card-T-05': 서버 값 {type, place:{place_id,name}, facts, map_url}
//     [구글 지도에서 보기] 'visit-map-link' → Linking.openURL(map_url)
//     [열었어] 'visit-open', [닫혔어] 'visit-closed' → POST /places/{place_id}/visit-checks 본문 {day_id, at, was_open}
//   T-06 카드 'card-T-06': 서버 값 {type, event_id, closed:{place_id,name}, proposals[]}
//     제안 = TASK-007 제안 {proposal_id, label, reason, dropped, keeps_fixed, first_leave_at, items}
//            + closed {alternative:{place_id,name}|null, distance_m, travel_change_min, reordered} (§11 Q4, reordered는 §14)
//     §14: closed.reordered가 true면 대안 칸에 "순서를 바꿔야 들어가 · {HH:MM}에 들러", 시각 = items 안 그 대안 줄의 start
//     §14: 제안이 0개면 "지금은 바꿀 방법을 못 찾았어" + [그대로 둘게]만
//     대안 칸(alternative 있음) 'proposal-{proposal_id}': 이름 = closed.alternative.name, 거리 = closed.distance_m,
//       이동 변화 = closed.travel_change_min, 사실 칩 = items 안 그 대안 줄의 facts. [이걸로] 'proposal-accept-{proposal_id}'
//     [빼고 가기] 'closed-skip' → closed.alternative가 null인 제안의 accept, [그대로 둘게] 'event-dismiss' → dismiss
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import fc from 'fast-check';
import { Linking, StyleSheet } from 'react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { COLORS } from '../test-support/design-table';
import { apiError, json, networkDown } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { expectNoBody, pressId, resetDevice } from '../test-support/planning-driver';
import { SPOT } from '../test-support/planning-fixtures';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import {
  ACCEPT_ROUTE,
  delayedView,
  DISMISS_ROUTE,
  nowItem,
  nowView,
  PROPOSAL_SPOT,
  second,
  t01,
  t02,
  t03,
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
const AT = (clock: string) => `2026-12-02T${clock}:00`;
const same = (a: unknown, b: string) => String(a).toUpperCase() === b.toUpperCase();

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

// ---------- 가짜 서버 값 ----------

const CHECK_PLACE = { place_id: 'D02', name: '서버_확인할_곳' };
const VISIT_ROUTE = (placeId: string) => `POST /places/${placeId}/visit-checks`;
const SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=35.02,134.99';

const hoursFact = (status: string, over: object = {}) => ({ field: 'opening_hours', value: '10:00-18:00', status, source_type: '서버_출처', checked_at: null, ...over });

const t05 = (over: object = {}) => ({ type: 'T-05', place: CHECK_PLACE, facts: [hoursFact('unverified')], map_url: SEARCH_URL, ...over });

/** 메인 T-05 (짝 T-02) */
const checkView = (over: object = {}) => nowView({ main: t05(), subs: [t02()], reason: '서버_T05_이유', ...over });

const confirmedSecond = { ...second, facts: [hoursFact('confirmed', { source_type: 'user', checked_at: AT('10:00') })] };
const openedView = () => nowView({ main: t01({ item: confirmedSecond }), subs: [t03({ items: [confirmedSecond] })] });

// §11 Q4: TASK-007 제안 + closed
const altItem = (placeId: string, name: string, status: string) => ({
  ...nowItem(2, name, '12:20', '13:00', 'confirmed', PROPOSAL_SPOT),
  place_id: placeId,
  facts: [hoursFact(status, { value: '08:00-19:00', source_type: 'demo' })],
});
const LATER_ITEM = { ...nowItem(3, '서버_뒤_장소', '13:30', '15:00', 'unknown'), place_id: 'D03' };
const replace = (over: object = {}, closed: object = {}) => ({
  proposal_id: 'alt-1',
  label: 'relaxed',
  reason: '서버_대안_이유',
  dropped: [],
  keeps_fixed: true,
  first_leave_at: '12:00',
  items: [altItem('D09', '서버_대안_장소', 'unverified'), LATER_ITEM],
  closed: { alternative: { place_id: 'D09', name: '서버_대안_장소' }, distance_m: 350, travel_change_min: 4, reordered: false, ...closed },
  ...over,
});
const replace2 = () =>
  replace(
    { proposal_id: 'alt-2', items: [altItem('D10', '서버_대안_둘', 'confirmed'), LATER_ITEM] },
    { alternative: { place_id: 'D10', name: '서버_대안_둘' }, distance_m: 800, travel_change_min: 7, reordered: false },
  );
const skip = (over: object = {}) => ({
  proposal_id: 'skip-1',
  label: 'relaxed',
  reason: '서버_빼고_이유',
  dropped: [{ place_id: 'D02', name: '서버_닫힌_곳' }],
  keeps_fixed: true,
  first_leave_at: '12:00',
  items: [LATER_ITEM],
  closed: { alternative: null, distance_m: null, travel_change_min: -5, reordered: false },
  ...over,
});
const t06 = (over: object = {}) => ({
  type: 'T-06',
  event_id: 'ev-closed',
  closed: { place_id: 'D02', name: '서버_닫힌_곳' },
  proposals: [replace(), replace2(), skip()],
  ...over,
});
const closedEvent = { event_id: 'ev-closed', type: 'closed', severity: 'high', delay_min: 0, state: 'awaiting', proposals: [] };
const closedView = (over: object = {}) => nowView({ main: t06(), subs: [t03()], reason: '서버_T06_이유', event: closedEvent, ...over });

const GUESSES = /열었을|열려 있을|열 거야|영업 중일|아마/;

// ---------- C1 T-05 카드 ----------

describe('C1 T-05 카드', () => {
  const shows = (over: object = {}) => toNow(nowServer(checkView(over)));

  test('T8_C1_메인_T_05가_now_main_안에', async () => {
    await shows();
    expect(chain(byId('card-T-05')).some((host) => host.props.testID === 'now-main')).toBe(true);
  });

  test('T8_C1_A4_장소_이름과_묻는_문장', async () => {
    await shows();
    expect(inCard('card-T-05').getByText('서버_확인할_곳')).toBeTruthy();
    expect(inCard('card-T-05').getByText('가기 전에 열었는지 볼래?')).toBeTruthy();
  });

  test.each([
    ['unverified', '미확인'],
    ['unknown', '모름'],
  ])('T8_C1_AC6_사실_칩은_서버_상태_%s', async (status, label) => {
    await shows({ main: t05({ facts: [hoursFact(status)] }) });
    expect(inCard('card-T-05').getByText(label)).toBeTruthy();
  });

  test('T8_C1_AC2_출처는_서버_값_그대로', async () => {
    await shows();
    expect(words('card-T-05')).toContain('서버_출처');
  });

  test('T8_C1_AC2_확인_날짜가_없으면_확인한_적_없음', async () => {
    await shows();
    expect(words('card-T-05')).toContain('확인한 적 없음');
  });

  test('T8_C1_AC2_확인_날짜가_있으면_확인_날짜', async () => {
    await shows({ main: t05({ facts: [hoursFact('unverified', { checked_at: '2026-11-01T09:00:00' })] }) });
    expect(words('card-T-05')).toContain('확인: 2026-11-01');
    expect(words('card-T-05')).not.toContain('확인한 적 없음');
  });

  test('T8_C1_AC2_구글_지도에서_보기는_서버의_map_url을_연다', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(undefined);
    await shows();
    expect(inCard('card-T-05').getByText('구글 지도에서 보기')).toBeTruthy();
    await pressId('visit-map-link');
    await waitFor(() => expect(open).toHaveBeenCalledWith(SEARCH_URL));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('T8_C1_열었어_닫혔어_두_버튼', async () => {
    await shows();
    expect(within(byId('visit-open') as never).getByText('열었어')).toBeTruthy();
    expect(within(byId('visit-closed') as never).getByText('닫혔어')).toBeTruthy();
  });

  test('T8_C1_G5_T_05_카드에는_주황_면이_없다', async () => {
    await shows();
    const orange = byId('card-T-05').queryAll((host) => same(styleOf(host).backgroundColor, COLORS.brand));
    expect(orange).toEqual([]);
  });

  test('T8_C1_A3_보조로_나온_T_05도_같은_값과_버튼', async () => {
    await toNow(nowServer(nowView({ main: t02({ leave_in_min: 5 }), subs: [t05(), t03()] })));
    expect(chain(byId('card-T-05')).some((host) => host.props.testID === 'now-main')).toBe(false);
    expect(inCard('card-T-05').getByText('서버_확인할_곳')).toBeTruthy();
    expect(byId('visit-open')).toBeTruthy();
    expect(byId('visit-closed')).toBeTruthy();
  });

  test('T8_C1_AC6_영업_여부를_지어낸_글자가_없다', async () => {
    await shows();
    expect(words('card-T-05')).not.toMatch(GUESSES);
  });
});

// ---------- C2 답 보내기 ----------

describe('C2 열었어·닫혔어', () => {
  async function ready(reply: object = openedView()): Promise<NowControl> {
    const control = nowServer(checkView());
    control.server.on(VISIT_ROUTE('D02'), json(200, reply));
    await toNow(control);
    return control;
  }

  test.each([
    ['visit-open', true],
    ['visit-closed', false],
  ])('T8_C2_A5_%s는_visit_check를_한_번_본문은_day_id_at_was_open', async (id, wasOpen) => {
    const control = await ready(wasOpen ? openedView() : closedView());
    await pressId(id);
    await waitFor(() => expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1));
    const body = control.server.sent(VISIT_ROUTE('D02'))[0].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['at', 'day_id', 'was_open']);
    expect(body).toEqual({ day_id: 'day-2', at: AT('10:00'), was_open: wasOpen });
  });

  test('T8_C2_열었어_응답으로_카드가_사라지고_그_장소_칩이_확인됨', async () => {
    await ready();
    await pressId('visit-open');
    await screen.findByTestId('card-T-01');
    expect(screen.queryByTestId('card-T-05')).toBeNull();
    expect(inCard('card-T-01').getByText('확인됨')).toBeTruthy();
  });

  test('T8_C2_닫혔어_응답으로_T_06', async () => {
    await ready(closedView());
    await pressId('visit-closed');
    await screen.findByTestId('card-T-06');
    expect(screen.queryByTestId('card-T-05')).toBeNull();
    expect(chain(byId('card-T-06')).some((host) => host.props.testID === 'now-main')).toBe(true);
  });

  test('T8_C2_누르기_전에는_visit_check를_보내지_않는다', async () => {
    const control = await ready();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    expect(control.server.requests.filter((request) => /\/visit-checks$/.test(request.path))).toEqual([]);
  });

  test('T8_C2_데모_시각을_옮긴_뒤에는_그_시각으로_보낸다', async () => {
    const control = await ready();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    await pressId('visit-open');
    await waitFor(() => expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1));
    expect((control.server.sent(VISIT_ROUTE('D02'))[0].body as Record<string, unknown>).at).toBe(AT('10:10'));
  });
});

// ---------- §6 visit-check 끊김 ----------

describe('§6 visit-check 실패', () => {
  test('T8_S6_끊기면_다시_보내지_않고_GET_now로_지금_상태를_받는다', async () => {
    const control = nowServer(checkView());
    control.server.once(VISIT_ROUTE('D02'), networkDown);
    await toNow(control);
    const before = control.gets().length;
    control.show(openedView());
    await pressId('visit-open');
    await waitFor(() => expect(control.gets().length).toBe(before + 1));
    expect(control.gets().at(-1)?.at).toBe(AT('10:00'));
    await screen.findByTestId('card-T-01');
    expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1);
  });
});

describe('§11 Q10 visit-check 409', () => {
  test('T8_S6_Q10_409면_다시_보내지_않고_GET_now로_지금_상태를_받는다', async () => {
    const control = nowServer(checkView());
    control.server.once(VISIT_ROUTE('D02'), apiError(409, 'STATE_CONFLICT'));
    await toNow(control);
    const before = control.gets().length;
    control.show(openedView());
    await pressId('visit-open');
    await waitFor(() => expect(control.gets().length).toBe(before + 1));
    await screen.findByTestId('card-T-01');
    expect(control.server.sent(VISIT_ROUTE('D02'))).toHaveLength(1);
  });
});

// ---------- C3 T-06 카드 ----------

describe('C3 T-06 카드', () => {
  const shows = (over: object = {}) => toNow(nowServer(closedView(over)));

  test('T8_C3_제목은_장소가_닫혔대_근처에_이런_데_있어', async () => {
    await shows();
    expect(words('card-T-06')).toContain('서버_닫힌_곳이 닫혔대');
    expect(words('card-T-06')).toContain('근처에 이런 데 있어');
  });

  test('T8_C3_대안_칸은_서버_순서대로_이름_거리_이동_변화_사실_칩_이걸로', async () => {
    await shows();
    const ids = byId('card-T-06')
      .queryAll((host) => typeof host.props.testID === 'string' && /^proposal-alt-\d$/.test(host.props.testID))
      .map((host) => host.props.testID);
    expect([...new Set(ids)]).toEqual(['proposal-alt-1', 'proposal-alt-2']);
    const row = inCard('proposal-alt-1');
    expect(row.getByText('서버_대안_장소')).toBeTruthy();
    expect(words('proposal-alt-1')).toContain('350m');
    expect(words('proposal-alt-1')).toContain('+4분');
    expect(row.getByText('미확인')).toBeTruthy(); // items 안 대안(D09) 줄의 facts
    expect(within(byId('proposal-accept-alt-1') as never).getByText('이걸로')).toBeTruthy();
    expect(inCard('proposal-alt-2').getByText('확인됨')).toBeTruthy();
    expect(words('proposal-alt-2')).toContain('+7분');
  });

  test('T8_C3_B4_빼고_가기와_그대로_둘게는_하나씩_그대로_둘게가_맨_아래', async () => {
    await shows();
    expect(within(byId('closed-skip') as never).getByText('빼고 가기')).toBeTruthy();
    expect(inCard('card-T-06').getAllByText('그대로 둘게')).toHaveLength(1);
    const order = byId('card-T-06')
      .queryAll((host) => typeof host.props.testID === 'string' && /^(proposal-alt-\d|closed-skip|event-dismiss)$/.test(host.props.testID))
      .map((host) => host.props.testID);
    const unique = [...new Set(order)];
    expect(unique.at(-1)).toBe('event-dismiss');
    expect(unique.indexOf('closed-skip')).toBeGreaterThan(unique.indexOf('proposal-alt-2'));
  });

  test('T8_C3_Q4_대안의_사실_칩은_items_안_그_대안_줄에서_온다', async () => {
    // 대안 줄(D09)이 items 둘째에 있어도 그 줄의 상태를 쓴다 (첫 줄 LATER_ITEM은 모름)
    await shows({ main: t06({ proposals: [replace({ items: [LATER_ITEM, altItem('D09', '서버_대안_장소', 'confirmed')] }), skip()] }) });
    expect(inCard('proposal-alt-1').getByText('확인됨')).toBeTruthy();
  });

  test.each([
    [354, '350m'],
    [995, '1.0km'],
    [1200, '1.2km'],
  ])('T8_C3_Q15_거리_%sm는_%s', async (meters, label) => {
    await shows({ main: t06({ proposals: [replace({}, { distance_m: meters }), skip()] }) });
    expect(words('proposal-alt-1')).toContain(label);
  });

  // §12 Q27: 부호를 붙여 그대로. 마이너스 글자는 문서 표기 "−"(U+2212)
  test.each([
    [0, '+0분'],
    [-3, '−3분'],
  ])('T8_C3_Q27_이동_변화_%s분은_%s', async (minutes, label) => {
    await shows({ main: t06({ proposals: [replace({}, { travel_change_min: minutes }), skip()] }) });
    expect(words('proposal-alt-1')).toContain(label);
  });

  test('T8_C3_Q4_빼고_가기는_목록_자리가_아니라_alternative_null인_제안', async () => {
    const control = nowServer(closedView({ main: t06({ proposals: [skip({ proposal_id: 'x-9' }), replace()] }) }));
    control.server.on(ACCEPT_ROUTE('x-9'), json(200, nowView({ main: t01(), subs: [t03()] })));
    await toNow(control);
    expect(screen.queryByTestId('proposal-accept-x-9')).toBeNull(); // 대안 칸으로 그리지 않는다
    await pressId('closed-skip');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('x-9'))).toHaveLength(1));
    expect(control.server.sent(ACCEPT_ROUTE('alt-1'))).toEqual([]);
  });

  test('T8_C3_B4_대안이_0곳이면_안내와_빼고_가기_그대로_둘게만', async () => {
    await shows({ main: t06({ proposals: [skip()] }) });
    expect(words('card-T-06')).toContain('근처에 열린 비슷한 곳이 없어');
    expect(screen.queryAllByTestId(/^proposal-accept-/)).toEqual([]);
    expect(byId('closed-skip')).toBeTruthy();
    expect(byId('event-dismiss')).toBeTruthy();
  });

  test('T8_C3_대안이_있으면_없다는_안내가_없다', async () => {
    await shows();
    expect(words('card-T-06')).not.toContain('근처에 열린 비슷한 곳이 없어');
  });

  test('T8_C3_S7_빼고_가기_이유는_서버_글자_그대로', async () => {
    await shows({ main: t06({ proposals: [replace(), skip({ reason: '서버_꼭_갈_곳이었어' })] }) });
    expect(words('card-T-06')).toContain('서버_꼭_갈_곳이었어');
  });

  test('T8_C3_AC6_대안의_사실_칩은_칸마다_하나_이상', async () => {
    await shows();
    for (const id of ['proposal-alt-1', 'proposal-alt-2']) expect(words(id)).toMatch(/확인됨|미확인|모름/);
  });

  test('T8_C3_AC6_영업_여부를_지어낸_글자가_없다', async () => {
    await shows();
    expect(words('card-T-06')).not.toMatch(GUESSES);
  });

  // §14: 닫힌 곳 자리에 못 넣어 다시 짠 대안. 들르는 시각은 items 안 그 대안 줄의 start (뒤 줄 LATER_ITEM이 앞에 온다)
  const moved = (start: string) =>
    replace({ items: [LATER_ITEM, { ...altItem('D09', '서버_대안_장소', 'unverified'), seq: 3, start, end: '23:59' }] }, { reordered: true });

  test.each(['17:45', '00:00', '23:58'])('T8_S14_다시_짠_대안은_순서를_바꿔야_들어가_%s에_들러', async (start) => {
    await shows({ main: t06({ proposals: [moved(start), skip()] }) });
    expect(words('proposal-alt-1')).toContain('순서를 바꿔야 들어가');
    expect(words('proposal-alt-1')).toContain(`${start}에 들러`);
  });

  test('T8_S14_자리에_들어간_대안에는_순서_안내가_없다', async () => {
    await shows({ main: t06({ proposals: [replace(), { ...moved('17:45'), proposal_id: 'alt-2' }, skip()] }) });
    expect(words('proposal-alt-1')).not.toContain('순서를 바꿔야');
    expect(words('proposal-alt-1')).not.toContain('에 들러');
    expect(words('proposal-alt-2')).toContain('순서를 바꿔야 들어가');
  });

  test('T8_S14_제안이_0개면_못_찾았어와_그대로_둘게만', async () => {
    await shows({ main: t06({ proposals: [] }) });
    expect(words('card-T-06')).toContain('지금은 바꿀 방법을 못 찾았어');
    expect(screen.queryAllByTestId(/^proposal-accept-/)).toEqual([]);
    expect(screen.queryByTestId('closed-skip')).toBeNull();
    expect(byId('event-dismiss')).toBeTruthy();
    expect(inCard('card-T-06').getAllByText('그대로 둘게')).toHaveLength(1);
  });

  test('T8_S14_제안이_있으면_못_찾았어_안내가_없다', async () => {
    await shows();
    expect(words('card-T-06')).not.toContain('지금은 바꿀 방법을 못 찾았어');
  });

  test('T8_C3_짝은_서버_순서_그대로_T_06_T_03', async () => {
    await shows();
    const ids = (screen.root as unknown as Tree)
      .queryAll((host) => typeof host.props.testID === 'string' && /^card-T-\d+$/.test(host.props.testID) && host.type === 'View')
      .map((host) => host.props.testID);
    expect(ids).toEqual(['card-T-06', 'card-T-03']);
  });
});

// ---------- B5 [이걸로]·[빼고 가기]·[그대로 둘게] ----------

describe('B5 T-06 고르기', () => {
  async function ready(): Promise<NowControl> {
    const control = nowServer(closedView());
    for (const id of ['alt-1', 'alt-2', 'skip-1']) control.server.on(ACCEPT_ROUTE(id), json(200, nowView({ main: t01(), subs: [t03()] })));
    control.server.on(DISMISS_ROUTE('ev-closed'), json(200, nowView({ main: t01(), subs: [t03()] })));
    await toNow(control);
    return control;
  }

  test('T8_B5_이걸로는_그_대안의_accept를_본문_없이_한_번', async () => {
    const control = await ready();
    await pressId('proposal-accept-alt-2');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('alt-2'))).toHaveLength(1));
    expectNoBody(control.server.sent(ACCEPT_ROUTE('alt-2'))[0].body);
    expect(control.server.sent(ACCEPT_ROUTE('alt-1'))).toEqual([]);
    await screen.findByTestId('card-T-01');
    expect(screen.queryByTestId('card-T-06')).toBeNull();
  });

  test('T8_B4_빼고_가기는_skip_제안의_accept', async () => {
    const control = await ready();
    await pressId('closed-skip');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('skip-1'))).toHaveLength(1));
    expectNoBody(control.server.sent(ACCEPT_ROUTE('skip-1'))[0].body);
  });

  test('T8_B5_그대로_둘게는_dismiss_본문_없이_한_번', async () => {
    const control = await ready();
    await pressId('event-dismiss');
    await waitFor(() => expect(control.server.sent(DISMISS_ROUTE('ev-closed'))).toHaveLength(1));
    expectNoBody(control.server.sent(DISMISS_ROUTE('ev-closed'))[0].body);
    expect(control.server.requests.filter((request) => /\/accept$/.test(request.path))).toEqual([]);
  });

  test('T8_B5_FR13_누르지_않으면_accept도_dismiss도_보내지_않는다', async () => {
    const control = await ready();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    expect(control.server.requests.filter((request) => /^\/(proposals|events)\//.test(request.path))).toEqual([]);
  });
});

// ---------- G5 [이걸로]는 보조 버튼, 한 카드에 주황 큰 버튼 여러 개 없음 ----------

describe('G5 주황 규칙', () => {
  const pressableOf = (id: string) => {
    const host = byId(id);
    return chain(host).find((h) => typeof h.props.onClick === 'function') ?? host;
  };
  const labelColour = (id: string, label: string) => {
    const text = within(byId(id) as never).getByText(label) as unknown as Tree;
    return styleOf(text).color;
  };
  const orangeButtons = (cardId: string) =>
    byId(cardId).queryAll((host) => typeof host.props.onClick === 'function' && same(styleOf(host).backgroundColor, COLORS.brand)).length;

  test.each(['proposal-accept-prop-relaxed', 'proposal-accept-prop-packed'])('T8_G5_T_04의_%s는_bg_2_바탕_ink_글자', async (id) => {
    await toNow(nowServer(delayedView()));
    expect(same(styleOf(pressableOf(id)).backgroundColor, COLORS['bg-2'])).toBe(true);
    expect(same(labelColour(id, '이걸로'), COLORS.ink)).toBe(true);
  });

  test('T8_G5_T_04_카드에_주황_큰_버튼은_하나_이하', async () => {
    await toNow(nowServer(delayedView()));
    expect(orangeButtons('card-T-04')).toBeLessThanOrEqual(1);
  });

  test.each(['proposal-accept-alt-1', 'proposal-accept-alt-2'])('T8_G5_T_06의_%s는_bg_2_바탕_ink_글자', async (id) => {
    await toNow(nowServer(closedView()));
    expect(same(styleOf(pressableOf(id)).backgroundColor, COLORS['bg-2'])).toBe(true);
    expect(same(labelColour(id, '이걸로'), COLORS.ink)).toBe(true);
  });

  test('T8_G5_T_06_카드에_주황_큰_버튼은_하나_이하', async () => {
    await toNow(nowServer(closedView()));
    expect(orangeButtons('card-T-06')).toBeLessThanOrEqual(1);
  });

  test.each(['visit-open', 'visit-closed'])('T8_G5_C1_T_05의_%s도_보조_버튼', async (id) => {
    await toNow(nowServer(checkView()));
    expect(same(styleOf(pressableOf(id)).backgroundColor, COLORS['bg-2'])).toBe(true);
  });
});

// ---------- G4 늦은 상태의 T-02 문구 ----------

// 데모 시드 시각: 3번 13:11 시작·이동 16분 → 예정 출발 12:55 (trip-delay.test의 §14 시나리오와 같음)
const SEED_PINS = [
  { seq: 1, place_id: 'D01', name: '서버_첫째_장소', ...SPOT.D01, start: '10:20', end: '11:50', travel_min: 20, state: 'done' },
  { seq: 2, place_id: 'D02', name: '서버_둘째_장소', ...SPOT.D20, start: '12:10', end: '12:40', travel_min: 20, state: 'done' },
  { seq: 3, place_id: 'D03', name: '서버_셋째_장소', ...SPOT.D30, start: '13:11', end: '15:00', travel_min: 16, state: 'next' },
];
const lateT02 = (over: object = {}) => t02({ leave_at: '12:55', leave_in_min: 0, travel_min: 16, ...over });
const lowEvent = { event_id: 'ev-low', type: 'delay', severity: 'low', delay_min: 10, state: 'open_low', proposals: [] };

describe('G4 늦은 상태의 T-02', () => {
  /** 데모 시각 13:05: [+10분] 18번 + 시각 막대 한 칸(5분) */
  async function at1305(view: object) {
    const control = nowServer(nowView({ pins: SEED_PINS }));
    await toNow(control);
    control.show(view);
    await pressId('demo-toggle');
    for (let i = 0; i < 18; i += 1) await pressId('demo-plus-10');
    await act(async () => {
      fireEvent(byId('demo-bar') as never, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    });
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('13:05')));
    await act(async () => undefined);
    return control;
  }

  test('T8_G4_늦은_상태에서_출발_시각이_지났으면_출발_시각이_n분_지났어', async () => {
    await at1305(nowView({ status: 'delayed', status_text: '10분 늦어지는 중', main: lateT02(), subs: [t03()], pins: SEED_PINS, event: lowEvent }));
    await waitFor(() => expect(words('card-T-02')).toContain('출발 시각이 10분 지났어'));
    expect(words('card-T-02')).not.toContain('지금 나서자');
  });

  test('T8_G4_늦은_상태가_아니면_지금_나서자_그대로', async () => {
    await at1305(nowView({ status: 'on_track', main: lateT02(), subs: [t03()], pins: SEED_PINS }));
    await waitFor(() => expect(words('card-T-02')).toContain('지금 나서자'));
    expect(words('card-T-02')).not.toContain('지났어');
  });

  test('T8_G4_늦은_상태라도_출발_전이면_분_뒤_문구', async () => {
    await at1305(nowView({ status: 'delayed', status_text: '10분 늦어지는 중', main: lateT02({ leave_at: '13:15', leave_in_min: 10 }), subs: [t03()], pins: SEED_PINS, event: lowEvent }));
    await waitFor(() => expect(words('card-T-02')).toContain('13:15에 출발 · 10분 뒤'));
    expect(words('card-T-02')).not.toContain('지났어');
  });
});

// ---------- G1 지연 중 마지막 일정 뒤 위치 = 마지막 장소 (TASK-007 §14의 끝) ----------

type Spot = { lat: number; lng: number };
type Item = Spot & { start: string; end: string; travel_min: number };
type Course = { lodging: Spot; items: Item[]; go_home_min: number | null };
const lib = () => require('@/lib/fake-position');
const delayedPosition = (at: string, delayMin: number, course: Course): Spot | null => lib().delayedPosition(at, delayMin, course);
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const atMin = (minutes: number) => `2026-12-02T${clock(minutes)}:00`;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const HOME = { lat: 35, lng: 135 };
const LAST = { lat: 35.5, lng: 135.1 };
const COURSE: Course = {
  lodging: HOME,
  go_home_min: 25,
  items: [
    { lat: 35.1, lng: 135.2, start: '10:12', end: '12:00', travel_min: 12 },
    { ...LAST, start: '14:30', end: '19:00', travel_min: 30 },
  ],
};
const expectAt = (actual: Spot | null, expected: Spot) => {
  expect(actual).not.toBeNull();
  expect((actual as Spot).lat).toBeCloseTo(expected.lat, 9);
  expect((actual as Spot).lng).toBeCloseTo(expected.lng, 9);
};

describe('G1 지연 중 마지막 일정 뒤', () => {
  test.each([
    ['숙소 도착 예정 정각', '19:25'],
    ['숙소 도착 예정 뒤', '19:40'],
    ['한참 뒤', '22:00'],
  ])('T8_G1_기준_시각이_%s여도_마지막_장소', (_name, t) => {
    expectAt(delayedPosition(atMin(toMin(t) + 10), 10, COURSE), LAST);
  });

  test.each(['19:00', '19:05'])('T8_G1_숙소까지_0분이어도_마지막_장소_%s', (t) => {
    expectAt(delayedPosition(atMin(toMin(t) + 10), 10, { ...COURSE, go_home_min: 0 }), LAST);
  });

  test('T8_G1_속성_마지막_일정_끝_뒤_어느_시각이든_지연이_있으면_마지막_장소', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: toMin('19:00'), max: toMin('23:00') }),
        fc.integer({ min: 1, max: 60 }),
        fc.option(fc.integer({ min: 0, max: 90 }), { nil: null }),
        (t, late, home) => {
          expectAt(delayedPosition(atMin(t + late), late, { ...COURSE, go_home_min: home }), LAST);
        },
      ),
    );
  });

  test('T8_G1_지연이_0이면_마지막_뒤는_fakePosition_그대로_숙소로_간다', () => {
    expectAt(delayedPosition(atMin(toMin('19:40')), 0, COURSE), HOME);
  });
});
