/// <reference types="jest" />
// 여행 중 늦어짐 (로직·가드레일). 근거: TASK-007 §C C1~C6, §6 앱 쪽 줄, §0-1 F1·F3·F4·F6, TASK-006 §7·§11·§12, SCREEN-001 §2·§5.
// 색·간격은 보지 않는다. 지도·시트는 가짜 부품이다 (test-support/maps-mock, bottom-sheet-mock).
//
// 계약 (이 테스트가 정한 이름, 보고서 ④):
//   시각이 바뀔 때: POST /days/{day_id}/check 본문 {at, lat, lng}. 재실행·첫 요청: GET /days/{day_id}/now?at= (위치 쿼리 없음)
//   데모 패널: 'demo-delay-10'(글자 '+10분 늦게'), 'demo-delay-reset'(글자 '지연 초기화')
//   T-04 카드: 'card-T-04'. 제안 칸 'proposal-{proposal_id}', 그 안 [이걸로] 'proposal-accept-{proposal_id}', 맨 아래 [그대로 갈래] 'event-dismiss'
//   accept: POST /proposals/{proposal_id}/accept (본문 없음), dismiss: POST /events/{event_id}/dismiss (본문 없음)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { LISTS, NUMBERS } from '../test-support/design-table';
import { apiError, hang, json, networkDown } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { expectNoBody, pressId, resetDevice, restart } from '../test-support/planning-driver';
import { day, SPOT } from '../test-support/planning-fixtures';
import { layout } from '@/planning/layout';
import { advance, buildConfig, expectDashedAlong, installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import {
  ACCEPT_ROUTE,
  delayedView,
  delayEvent,
  DISMISS_ROUTE,
  nowView,
  pins,
  proposal,
  PROPOSAL_SPOT,
  route,
  t01,
  t03,
  t04,
  t08,
  third,
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

/** 누를 수 있는 높이: height·minHeight + hitSlop (trip-now.test의 reach와 같은 셈) */
function reachHeight(host: Tree): number {
  const style = styleOf(host);
  const slop = host.props.hitSlop ?? {};
  const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
  const numeric = [style.height, style.minHeight].filter((v): v is number => typeof v === 'number');
  return (numeric.length ? Math.max(...numeric) : 0) + extra;
}
/** testID가 붙은 부품 아래에서 실제로 눌리는 상자 (onClick이 있는 View) */
const pressable = (id: string) => {
  const host = byId(id);
  return chain(host).find((h) => typeof h.props.onClick === 'function') ?? host.queryAll((h) => typeof h.props.onClick === 'function')[0];
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

const pressPlus = async (times: number) => {
  for (let i = 0; i < times; i += 1) await pressId('demo-plus-10');
};
const pressDelay = async (times: number) => {
  for (let i = 0; i < times; i += 1) await pressId('demo-delay-10');
};

const mid = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
const expectSentAt = (request: { lat: string | null; lng: string | null } | undefined, spot: { lat: number; lng: number }) => {
  expect(request).toBeDefined();
  expect(Number(request?.lat)).toBeCloseTo(spot.lat, 9);
  expect(Number(request?.lng)).toBeCloseTo(spot.lng, 9);
};

// ---------- C1 시각이 바뀔 때 POST /check ----------

describe('C1 check', () => {
  test('T7_C1_시각이_바뀌면_GET이_아니라_POST_check_위치는_본문', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    const sent = control.checks().at(-1);
    expect(sent?.path).toBe('/days/day-2/check');
    expect(sent?.lat).not.toBeNull();
    expect(sent?.lng).not.toBeNull();
    expect(control.gets().filter((request) => request.at === AT('10:10'))).toEqual([]);
  });

  test('T7_C1_check_본문은_at_lat_lng', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    await pressPlus(2); // 10:20, 1번 일정 안 → 1번 장소
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:20')));
    const body = control.checks().at(-1)?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['at', 'lat', 'lng']);
    expect(body.lat).toBeCloseTo(SPOT.D01.lat, 9);
    expect(body.lng).toBeCloseTo(SPOT.D01.lng, 9);
  });

  test('T7_C1_B4_GET_now에는_위치를_싣지_않는다', async () => {
    const { app, control } = await toNow();
    await pressId('demo-toggle');
    await pressPlus(3);
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('10:30')));
    await restart(app);
    await screen.findByTestId('now-main');
    expect(control.gets().length).toBeGreaterThan(0);
    for (const request of control.gets()) {
      expect(request.lat).toBeNull();
      expect(request.lng).toBeNull();
    }
  });

  test('T7_C1_S12_R7_첫_요청은_GET_now이고_핀으로_계산한_위치는_check로_한_번', async () => {
    const { control } = await toNow();
    const [first, second] = control.requests();
    expect(first.kind).toBe('now');
    expect(first.at).toBe(AT('10:00'));
    expect(second.kind).toBe('check');
    expect(second.at).toBe(AT('10:00'));
    expectSentAt(second, day.lodging); // 10:00은 1번 출발 정각이라 숙소
  });

  test('T7_C1_재실행_복구는_GET_now로_마지막_데모_시각', async () => {
    const { app, control } = await toNow();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    const before = control.requests().length;
    await restart(app);
    await screen.findByTestId('now-main');
    const after = control.requests().slice(before);
    expect(after[0].kind).toBe('now');
    expect(after[0].at).toBe(AT('10:10'));
  });

  test('T7_C1_B8_check도_300ms_디바운스이고_연달아_바꾸면_마지막_시각으로_한_번', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    const before = control.checks().length;
    await pressId('demo-plus-10');
    await advance(100);
    await pressId('demo-plus-10');
    await advance(299);
    expect(control.checks()).toHaveLength(before);
    await advance(1);
    expect(control.checks()).toHaveLength(before + 1);
    expect(control.checks().at(-1)?.at).toBe(AT('10:20'));
  });

  test('T7_C1_check_응답으로_화면이_바뀐다', async () => {
    const control = nowServer();
    await toNow(control);
    control.show(delayedView());
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(await screen.findByTestId('card-T-04')).toBeTruthy();
  });
});

// ---------- C2 데모 지연 ----------

describe('C2 데모 지연', () => {
  async function at1220() {
    const { control } = await toNow();
    await pressId('demo-toggle');
    await pressPlus(14); // 12:20 = 2번 시작
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('12:20')));
    return control;
  }

  test('T7_C2_데모_패널에_늦게_버튼과_지연_초기화', async () => {
    await toNow();
    await pressId('demo-toggle');
    expect(inCard('demo-panel').getByText('+10분 늦게')).toBeTruthy();
    expect(inCard('demo-panel').getByText('지연 초기화')).toBeTruthy();
    expect(within(byId('demo-panel') as never).getByTestId('demo-delay-10')).toBeTruthy();
    expect(within(byId('demo-panel') as never).getByTestId('demo-delay-reset')).toBeTruthy();
  });

  test('T7_C2_늦게를_누르면_같은_시각으로_check하고_위치는_10분_전_자리', async () => {
    const control = await at1220();
    expectSentAt(control.checks().at(-1), SPOT.D20); // 지연 0: 2번 장소
    await pressDelay(1);
    await waitFor(() => expectSentAt(control.checks().at(-1), mid(SPOT.D01, SPOT.D20))); // 12:10 = 1번과 2번 사이 가운데
    expect(control.checks().at(-1)?.at).toBe(AT('12:20'));
  });

  test('T7_C2_두_번이면_20분_전_자리', async () => {
    const control = await at1220();
    await pressDelay(2);
    await waitFor(() => expectSentAt(control.checks().at(-1), SPOT.D01)); // 12:00 = 1번 끝 정각, 막 떠난 자리
    expect(control.checks().at(-1)?.at).toBe(AT('12:20'));
  });

  test('T7_C2_지연은_시각이_바뀌어도_이어진다', async () => {
    const control = await at1220();
    await pressDelay(2);
    await waitFor(() => expectSentAt(control.checks().at(-1), SPOT.D01));
    await pressId('demo-plus-10'); // 12:30, 지연 20 → 12:10 자리
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('12:30')));
    expectSentAt(control.checks().at(-1), mid(SPOT.D01, SPOT.D20));
  });

  test('T7_C2_지연_초기화면_지금_자리로', async () => {
    const control = await at1220();
    await pressDelay(2);
    await waitFor(() => expectSentAt(control.checks().at(-1), SPOT.D01));
    await pressId('demo-delay-reset');
    await waitFor(() => expectSentAt(control.checks().at(-1), SPOT.D20));
    expect(control.checks().at(-1)?.at).toBe(AT('12:20'));
  });

  test('T7_C2_지연은_최대_60분', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    await pressPlus(19); // 13:10
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('13:10')));
    await pressDelay(6); // 60분 → 12:10 = 1번과 2번 사이 가운데
    await waitFor(() => expectSentAt(control.checks().at(-1), mid(SPOT.D01, SPOT.D20)));
    await pressDelay(1); // 70분이면 12:00(1번)이겠지만 60에서 멈춘다
    await act(async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expectSentAt(control.checks().at(-1), mid(SPOT.D01, SPOT.D20));
  });

  test('T7_C2_지연은_위치만_바꾸고_데모_시각은_그대로', async () => {
    await at1220();
    await pressDelay(3);
    expect(textOf(byId('demo-time').queryAll((h) => h.type === 'Text')[0])).toBe('12:20');
  });
});

// ---------- C3 T-04 카드 ----------

describe('C3 T-04 카드', () => {
  const shows = (over: object = {}) => toNow(nowServer(delayedView(over)));

  test('T7_C3_메인_T_04가_now_main_안에', async () => {
    await shows();
    expect(chain(byId('card-T-04')).some((host) => host.props.testID === 'now-main')).toBe(true);
  });

  test('T7_C3_제목은_분_늦어지고_있어', async () => {
    await shows();
    expect(inCard('card-T-04').getByText('23분 늦어지고 있어')).toBeTruthy();
  });

  test('T7_C3_제목의_분은_카드의_delay_min', async () => {
    await shows({ main: t04({ delay_min: 31 }) });
    expect(inCard('card-T-04').getByText('31분 늦어지고 있어')).toBeTruthy();
  });

  test('T7_C3_고정_일정이_있으면_지킬게_한_줄', async () => {
    await shows();
    expect(inCard('card-T-04').getByText('서버_예약_제목 15:30은 지킬게')).toBeTruthy();
  });

  test('T7_C3_고정_일정이_없으면_지킬게_줄이_없다', async () => {
    await shows({ main: t04({ fixed: null }) });
    expect(inCard('card-T-04').queryByText(/지킬게/)).toBeNull();
  });

  test('T7_C3_제안마다_한_칸_이유_빠지는_곳_첫_출발_시각_이걸로', async () => {
    await shows();
    const relaxed = inCard('proposal-prop-relaxed');
    expect(relaxed.getByText('서버_이유_여유')).toBeTruthy();
    expect(relaxed.getByText('서버_빠지는_곳')).toBeTruthy();
    expect(words('proposal-prop-relaxed')).toContain('13:40');
    expect(relaxed.getByTestId('proposal-accept-prop-relaxed')).toBeTruthy();
    expect(relaxed.getByText('이걸로')).toBeTruthy();
    const packed = inCard('proposal-prop-packed');
    expect(packed.getByText('서버_이유_빠듯')).toBeTruthy();
    expect(words('proposal-prop-packed')).toContain('13:35');
    expect(packed.queryByText('서버_빠지는_곳')).toBeNull();
  });

  test('T7_C3_제안_칸은_서버_순서대로_카드_안에', async () => {
    await shows();
    const ids = byId('card-T-04')
      .queryAll((host) => typeof host.props.testID === 'string' && /^proposal-prop-/.test(host.props.testID) && !/accept/.test(host.props.testID))
      .map((host) => host.props.testID);
    expect([...new Set(ids)]).toEqual(['proposal-prop-relaxed', 'proposal-prop-packed']);
  });

  test('T7_C3_그대로_갈래는_맨_아래_하나', async () => {
    await shows();
    const card = byId('card-T-04');
    const order = card
      .queryAll((host) => typeof host.props.testID === 'string' && /^(proposal-prop-[a-z]+|event-dismiss)$/.test(host.props.testID))
      .map((host) => host.props.testID);
    const unique = [...new Set(order)];
    expect(unique.at(-1)).toBe('event-dismiss');
    expect(inCard('card-T-04').getAllByText('그대로 갈래')).toHaveLength(1);
  });

  test.each(['proposal-accept-prop-relaxed', 'proposal-accept-prop-packed', 'event-dismiss'])('T7_C3_NFR13_%s_누르는_높이_44_이상', async (id) => {
    await shows();
    expect(reachHeight(pressable(id))).toBeGreaterThanOrEqual(NUMBERS['touch-min']);
  });

  test('T7_C3_B2_제안이_0개면_어떻게_해도_늦어_안내와_그대로_갈래만', async () => {
    await shows({ main: t04({ proposals: [] }), event: delayEvent({ proposals: [] }) });
    expect(inCard('card-T-04').getByText('어떻게 해도 서버_예약_제목에 늦어')).toBeTruthy();
    expect(screen.queryAllByTestId(/^proposal-accept-/)).toEqual([]);
    expect(inCard('card-T-04').queryByText('이걸로')).toBeNull();
    expect(byId('event-dismiss')).toBeTruthy();
  });

  test('T7_C3_보조_카드는_서버_순서_그대로이고_4장_이하', async () => {
    await shows();
    const ids = (screen.root as unknown as Tree)
      .queryAll((host) => typeof host.props.testID === 'string' && /^card-T-\d+$/.test(host.props.testID) && host.type === 'View')
      .map((host) => host.props.testID);
    expect(ids).toEqual(['card-T-04', 'card-T-07', 'card-T-03']);
  });

  test('T7_C3_AC6_T_04가_메인이어도_SOS와_입력창은_하나씩', async () => {
    await shows();
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
    expect(screen.getAllByTestId('input-bar')).toHaveLength(1);
  });
});

// ---------- C4 이걸로·그대로 갈래 ----------

const accepted = () =>
  nowView({
    main: t01(),
    subs: [t03()],
    reason: '서버_바뀐_이유',
    pins: [{ ...pins[0] }, { seq: 2, place_id: 'D09', name: '서버_새_장소', ...PROPOSAL_SPOT, start: '14:10', end: '15:00', travel_min: 20, state: 'next' }],
    event: delayEvent({ state: 'resolved', proposals: [] }),
  });

describe('C4 이걸로·그대로 갈래', () => {
  async function ready(): Promise<NowControl> {
    const control = nowServer(delayedView());
    control.server.on(ACCEPT_ROUTE('prop-relaxed'), json(200, accepted()));
    control.server.on(ACCEPT_ROUTE('prop-packed'), json(200, accepted()));
    control.server.on(DISMISS_ROUTE('ev-1'), json(200, nowView({ reason: '서버_그대로_이유' })));
    await toNow(control);
    return control;
  }

  test('T7_C4_이걸로를_누르면_그_제안의_accept를_본문_없이_한_번', async () => {
    const control = await ready();
    await pressId('proposal-accept-prop-packed');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('prop-packed'))).toHaveLength(1));
    expectNoBody(control.server.sent(ACCEPT_ROUTE('prop-packed'))[0].body);
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toEqual([]);
  });

  test('T7_C4_accept_응답으로_카드와_지도를_바꾼다', async () => {
    await ready();
    await pressId('proposal-accept-prop-relaxed');
    await screen.findByTestId('card-T-01');
    expect(screen.queryByTestId('card-T-04')).toBeNull();
    await waitFor(() => expect(byId('map-pin-2').props.coordinate).toEqual({ latitude: PROPOSAL_SPOT.lat, longitude: PROPOSAL_SPOT.lng }));
    expect(screen.queryByTestId('map-pin-3')).toBeNull();
  });

  test('T7_C4_accept_뒤_이유_한_줄은_바꾼_일정으로_안내할게', async () => {
    await ready();
    await pressId('proposal-accept-prop-relaxed');
    await screen.findByTestId('card-T-01');
    expect(inCard('now-reason').getByText('바꾼 일정으로 안내할게')).toBeTruthy();
  });

  test('T7_C4_그대로_갈래는_dismiss_본문_없이_한_번이고_응답을_그린다', async () => {
    const control = await ready();
    await pressId('event-dismiss');
    await waitFor(() => expect(control.server.sent(DISMISS_ROUTE('ev-1'))).toHaveLength(1));
    expectNoBody(control.server.sent(DISMISS_ROUTE('ev-1'))[0].body);
    await screen.findByTestId('card-T-01');
    expect(screen.queryByTestId('card-T-04')).toBeNull();
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toEqual([]);
  });

  test('T7_C4_accept_뒤에도_시각이_바뀌면_check가_이어진다', async () => {
    const control = await ready();
    await pressId('proposal-accept-prop-relaxed');
    await screen.findByTestId('card-T-01');
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
  });
});

// ---------- C5 알약 ----------

describe('C5 알약 delayed', () => {
  test('T7_C5_글자는_서버_status_text_그대로', async () => {
    await toNow(nowServer(delayedView({ status_text: '서버_23분_늦어지는_중' })));
    expect(inCard('status-pill').getByText('서버_23분_늦어지는_중')).toBeTruthy();
  });

  test('T7_F1_하루가_끝난_뒤_알약도_서버_글자_그대로', async () => {
    await toNow(nowServer(nowView({ main: t08(), subs: [], status: 'free', status_text: '오늘 일정 끝' })));
    expect(inCard('status-pill').getByText('오늘 일정 끝')).toBeTruthy();
  });
});

// ---------- C6 고르기 전에는 동선·남은 일정이 그대로 ----------

describe('C6 고르기 전 동선 불변', () => {
  const markers = () =>
    (screen.root as unknown as Tree).queryAll((host) => host.props.mapElement === 'Marker').map((host) => host.props.coordinate as { latitude: number; longitude: number });

  test('T7_C6_AC06_제안의_자리는_지도에_그리지_않는다_미리보기_없음', async () => {
    await toNow(nowServer(delayedView()));
    await screen.findByTestId('card-T-04');
    expect(markers()).not.toContainEqual({ latitude: PROPOSAL_SPOT.lat, longitude: PROPOSAL_SPOT.lng });
    for (const pin of pins) expect(byId(`map-pin-${pin.seq}`).props.coordinate).toEqual({ latitude: pin.lat, longitude: pin.lng });
  });

  test('T7_C6_AC06_동선은_서버_route_그대로', async () => {
    await toNow(nowServer(delayedView()));
    expect(byId('map-route-done').props.coordinates).toEqual(route.done.map(([latitude, longitude]) => ({ latitude, longitude })));
    expectDashedAlong(
      screen.getAllByTestId(/^map-route-remaining/) as never,
      route.remaining.map(([latitude, longitude]) => ({ latitude, longitude })),
      LISTS['route-dash'],
    );
  });

  test('T7_C6_AC06_남은_일정_줄은_서버_T_03_그대로', async () => {
    await toNow(nowServer(delayedView()));
    expect(inCard('rest-row-3').getByText(third.name)).toBeTruthy();
    expect(screen.queryByText('서버_제안_장소')).toBeNull();
  });

  test('T7_C6_FR13_누르지_않으면_accept도_dismiss도_보내지_않는다', async () => {
    const control = nowServer(delayedView());
    await toNow(control);
    await pressId('demo-toggle');
    await pressPlus(3);
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:30')));
    const decided = control.server.requests.filter((request) => /^\/(proposals|events)\//.test(request.path));
    expect(decided).toEqual([]);
  });
});

// ---------- §6 앱 쪽 실패 ----------

describe('§6 accept 실패', () => {
  async function pending(reply: Parameters<NowControl['once']>[0]) {
    const control = nowServer(delayedView());
    control.server.once(ACCEPT_ROUTE('prop-relaxed'), reply);
    await toNow(control);
    return control;
  }

  test('T7_S6_끊기면_accept를_다시_보내지_않고_GET_now로_지금_상태를_받는다', async () => {
    const control = await pending(networkDown);
    const before = control.gets().length;
    control.show(nowView({ main: t01(), event: delayEvent({ state: 'resolved', proposals: [] }) }));
    await pressId('proposal-accept-prop-relaxed');
    await waitFor(() => expect(control.gets().length).toBe(before + 1));
    expect(control.gets().at(-1)?.at).toBe(AT('10:00'));
    await screen.findByTestId('card-T-01');
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1);
  });

  test('T7_S6_시간_초과도_같다', async () => {
    const control = await pending(hang);
    const before = control.gets().length;
    jest.useFakeTimers();
    await pressId('proposal-accept-prop-relaxed');
    await advance(9999);
    expect(control.gets()).toHaveLength(before);
    await advance(1 + 300);
    await waitFor(() => expect(control.gets().length).toBe(before + 1));
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1);
  });

  test('T7_S6_409_stale이면_check를_다시_불러_새_제안과_안내', async () => {
    const control = await pending(apiError(409, 'STATE_CONFLICT', { reason: 'stale' }));
    const lastCheck = control.checks().at(-1);
    const before = control.checks().length;
    const fresh = t04({ proposals: [proposal({ proposal_id: 'prop-new', reason: '서버_새_이유' })] });
    control.show(delayedView({ main: fresh }));
    await pressId('proposal-accept-prop-relaxed');
    await waitFor(() => expect(control.checks().length).toBe(before + 1));
    const again = control.checks().at(-1);
    expect(again?.at).toBe(lastCheck?.at);
    expect([again?.lat, again?.lng]).toEqual([lastCheck?.lat, lastCheck?.lng]);
    expect(await screen.findByText('시간이 지나서 다시 찾아봤어')).toBeTruthy();
    expect(inCard('card-T-04').getByText('서버_새_이유')).toBeTruthy();
    expect(control.gets().filter((request) => request.at === lastCheck?.at).length).toBeLessThanOrEqual(1);
  });

  test('T7_S6_409_이미_처리됨이면_GET_now로_지금_화면', async () => {
    const control = await pending(apiError(409, 'STATE_CONFLICT'));
    const [gets, checks] = [control.gets().length, control.checks().length];
    control.show(nowView({ main: t01() }));
    await pressId('proposal-accept-prop-relaxed');
    await waitFor(() => expect(control.gets().length).toBe(gets + 1));
    await screen.findByTestId('card-T-01');
    expect(control.checks()).toHaveLength(checks);
    expect(screen.queryByText('시간이 지나서 다시 찾아봤어')).toBeNull();
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1);
  });
});

describe('§6 check 실패 = TASK-006 §7', () => {
  test('T7_S6_check가_끊기면_마지막_화면과_띠_다시는_같은_check', async () => {
    const control = nowServer(delayedView());
    await toNow(control);
    control.once(networkDown);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(await screen.findByText('연결이 안 돼, 저장된 일정만 보여')).toBeTruthy();
    expect(screen.getByTestId('card-T-04')).toBeTruthy();
    const failed = control.checks().at(-1);
    const before = control.checks().length;
    await pressId('retry-button');
    await waitFor(() => expect(control.checks().length).toBe(before + 1));
    const retried = control.checks().at(-1);
    expect(retried?.kind).toBe('check');
    expect(retried?.body).toEqual(failed?.body);
  });

  test('T7_S6_check가_500이면_마지막_화면과_문구', async () => {
    const control = nowServer(delayedView());
    await toNow(control);
    control.once(apiError(500, 'INTERNAL_ERROR'));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(await screen.findByText('잠깐 문제가 생겼어')).toBeTruthy();
    expect(screen.getByTestId('card-T-04')).toBeTruthy();
  });
});

// ---------- F3 [내 위치]·[데모]는 시트 윗면을 따라가고, 높으면 숨김 ----------

const AREA = 746; // trip-now.test.tsx와 같은 시험 영역 높이
const FRACTIONS = [0.16, 0.44, 0.88]; // TASK-006 §14 승인

async function settleTo(index: number) {
  const area = chain(byId('card-sheet')).find((host) => typeof host.props.onLayout === 'function') as Tree;
  await act(async () => sheetControl.settle(index, AREA));
  await fireEvent(area as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: AREA } } });
}

async function atLevel(index: number) {
  await toNow();
  await settleTo(index);
}

const floatBottom = () => Number(styleOf(chain(byId('my-location-button')).find((host) => styleOf(host).position === 'absolute') as Tree).bottom);

describe('F3 떠 있는 줄', () => {
  test.each([
    ['낮게', 0],
    ['중간', 1],
  ])('T7_F3_시트가_%s면_내_위치와_데모가_보이고_시트_위에_있다', async (_name, index) => {
    await atLevel(index as number);
    expect(byId('my-location-button')).toBeTruthy();
    expect(byId('demo-toggle')).toBeTruthy();
    expect(floatBottom()).toBeGreaterThanOrEqual(AREA * FRACTIONS[index as number]);
  });

  test('T7_F3_시트가_높을수록_떠_있는_줄도_위에', async () => {
    // 가짜 시트는 같은 화면에서 단을 바꿔도 다시 그리지 않을 수 있어, 단마다 새로 띄워 비교한다
    const { app } = await toNow();
    await settleTo(0);
    const low = floatBottom();
    await app.unmount();
    resetDevice();
    mapControl.reset();
    sheetControl.reset();
    await atLevel(1);
    expect(floatBottom()).toBeGreaterThan(low);
  });

  test('T7_F3_시트가_높으면_내_위치와_데모를_숨긴다', async () => {
    await atLevel(2);
    expect(screen.queryByTestId('my-location-button')).toBeNull();
    expect(screen.queryByTestId('demo-toggle')).toBeNull();
    expect(screen.getByTestId('sos-button')).toBeTruthy();
  });

  test('T7_F3_다시_내리면_다시_보인다', async () => {
    await atLevel(2);
    await settleTo(1);
    await waitFor(() => expect(screen.getByTestId('my-location-button')).toBeTruthy());
    expect(screen.getByTestId('demo-toggle')).toBeTruthy();
  });
});

// ---------- F4·F6 지도 겹침 순서 ----------

describe('F4·F6 지도', () => {
  const z = (id: string) => Number(byId(id).props.zIndex ?? 0);

  test('T7_F4_다음_핀과_말풍선은_숙소_아이콘보다_위', async () => {
    await toNow();
    const next = pins.find((pin) => pin.state === 'next') as { seq: number };
    expect(z(`map-pin-${next.seq}`)).toBeGreaterThan(z('map-home'));
    expect(inCard(`map-pin-${next.seq}`).getByText(pins[next.seq - 1].name)).toBeTruthy(); // 말풍선이 같은 마커 안
  });

  test('T7_F6_f85d63d_숙소_아이콘은_내_위치_점보다_위', async () => {
    await toNow();
    expect(z('map-home')).toBeGreaterThan(z('map-my-position'));
  });

  test('T7_F6_f85d63d_점선은_화면_점_기준으로_환산한다', async () => {
    await toNow();
    const region = { latitude: 35, longitude: 135, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    await act(async () => byId('map-view').props.onRegionChangeComplete?.(region));
    const metersPerPoint = (region.longitudeDelta * (Math.PI / 180) * 6371000 * Math.cos((region.latitude * Math.PI) / 180)) / Dimensions.get('window').width;
    const expected = LISTS['route-dash'].map((value) => Math.max(1, Math.round(value * metersPerPoint)));
    expect(expected).not.toEqual(LISTS['route-dash']); // 시험 자체 확인: 환산 전후가 다르다
    await waitFor(() =>
      expectDashedAlong(
        screen.getAllByTestId(/^map-route-remaining/) as never,
        route.remaining.map(([latitude, longitude]) => ({ latitude, longitude })),
        expected,
      ),
    );
  });

  test('T7_F6_f85d63d_처음_맞출_때_위는_상단_줄_말풍선_핀_반쪽_아래는_시트_핀_반쪽만큼_비운다', async () => {
    await toNow();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    const padding = (mapControl.fits[0].options?.edgePadding ?? {}) as { top?: number; bottom?: number };
    const pinHalf = NUMBERS['pin-next'] / 2;
    const insetTop = 47; // 시험 도구 METRICS
    expect(padding.top).toBeGreaterThanOrEqual(insetTop + layout.header + layout.pinBubble + pinHalf);
    expect(padding.bottom).toBeGreaterThanOrEqual(Dimensions.get('window').height * FRACTIONS[1] + pinHalf);
  });
});

// ---------- F6 f4ec8d4 지도 키는 react-native-maps 플러그인 옵션으로 ----------

describe('F6 f4ec8d4 지도 키 전달', () => {
  const mapsPlugins = (config: Record<string, any>) =>
    (config.plugins ?? []).filter((plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'react-native-maps');

  test('T7_F6_키가_있으면_react_native_maps_플러그인의_iosGoogleMapsApiKey로_한_번', () => {
    const config = buildConfig(TEST_KEY);
    const found = mapsPlugins(config);
    expect(found).toHaveLength(1);
    expect(Array.isArray(found[0]) && found[0][1]?.iosGoogleMapsApiKey === TEST_KEY).toBe(true);
  });

  test('T7_F6_ios_config_googleMapsApiKey는_쓰지_않는다_옛_포드_문제', () => {
    for (const key of [TEST_KEY, null]) expect(buildConfig(key).ios?.config?.googleMapsApiKey).toBeUndefined();
  });

  test('T7_F6_키가_없어도_플러그인은_옵션_없이_한_번', () => {
    const found = mapsPlugins(buildConfig(null));
    expect(found).toHaveLength(1);
    expect(Array.isArray(found[0]) ? found[0][1]?.iosGoogleMapsApiKey : undefined).toBeUndefined();
  });

  test('T7_F6_expo_dev_client는_한_번', () => {
    const config = buildConfig(TEST_KEY);
    expect((config.plugins ?? []).filter((plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-dev-client')).toHaveLength(1);
  });

  test('T7_F6_app_json에_지도_키_자리가_없다', () => {
    const appJson = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8'));
    expect(JSON.stringify(appJson)).not.toMatch(/googleMapsApiKey|iosGoogleMapsApiKey/);
  });
});
