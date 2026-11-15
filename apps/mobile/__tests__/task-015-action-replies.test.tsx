/// <reference types="jest" />
// TASK-015 §E ② 행동 응답은 버리지 않는다 (앱). 로직만 본다.
// 근거: TASK-015 §E ②("연습 재생 중 [닫혔어]를 누르면 그 응답이 버려져 연습 기록에서 빠질 수 있음 -> 규칙: 행동(고르기·확정·닫혔어·영업 확인)의 응답은 버리지 않는다.
//       '최신 시각만 남기기'(TASK-014)는 check 같은 조회 응답에만") · §7 AC-3("연습 재생 중 [닫혔어] -> 연습 기록에 남음. 조회 응답은 지금처럼 최신만") ·
//       TASK-014 §29 ①·§30 Q2(요청 하나씩, 오래된 것 = 보낸 순서, 화면에 있는 것보다 오래된 조회 응답만 버림)·§34 ② · TASK-014 §11(연습 기록 rehearsal_actions) ·
//       TASK-007 B8(행동 앞서 보낸 시계·위치 응답은 버림) · TASK-007 §11 Q15(accept 직후 이유 한 줄 "바꾼 일정으로 안내할게").
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   행동 = 실제 여행의 [이걸로 할래](accept)·[그대로 갈래](dismiss)·[열었어]/[닫혔어](visit-checks), 연습의 [닫혔어](visit-checks rehearsal: true)
//   행동을 보낸 뒤 시계가 바뀌어 나간 check의 응답이 먼저 와 화면에 있어도, 늦게 온 행동 응답은 버리지 않는다:
//     실제 여행 = 그 응답을 화면에 반영한다 (accept면 이유 줄 "바꾼 일정으로 안내할게")
//     연습 [닫혔어] = 연습 기록에 쌓여 다음 연습 check의 rehearsal_actions에 든다 + "연습이라 저장하지 않았어" 한 줄
//   (경계) 행동보다 앞서 보낸 check의 응답이 행동 응답 뒤에 오면 지금처럼 버린다 (조회 응답은 최신만, TASK-007 B8)
// §9 Q8 반영 (11-16):
//   ① 늦은 행동 응답을 화면에 반영한 뒤, 행동을 보낸 뒤로 시계가 더 갔으면 그 시각으로 check를 **한 번** 보낸다 ("요청 하나씩"은 그대로)
//      테스트는 그 check를 붙잡아, 붙잡힌 동안 행동 응답이 화면에 있는지 본다. (경계) 시계가 그대로면 더 보내지 않는다
//   ② 연습 [닫혔어] 응답도 화면에 보인다 (대안 카드 T-06) — 연습은 실제와 같게
// §11 Q8 반영 (11-16):
//   행동 응답이 올 때 check가 이미 진행 중이면 그때 보내지 않고, 그 check가 끝난 뒤 시계가 행동 시각보다 더 갔으면 한 번 더.
//   기다리는 check는 최대 하나 — 진행 중에 시계가 여러 번 가도 끝난 뒤 최신 시각으로 한 번 (TASK-014 "요청 하나씩 · 최신 시각만")
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json, type Reply, type Sent } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { sheetControl } from '../test-support/bottom-sheet-mock';
import { pressId, resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import { ACCEPT_ROUTE, delayedView, delayEvent, DISMISS_ROUTE, nowView, pins, PROPOSAL_SPOT, t01, t02, t03, t07 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const AT = (clock: string) => `2026-12-02T${clock}:00`;
const ACCEPTED_NOTE = '바꾼 일정으로 안내할게';
const REHEARSAL_NOTE = '연습이라 저장하지 않았어';
const t05 = {
  type: 'T-05',
  place: { place_id: 'D02', name: '서버_확인할_곳' },
  facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'unverified', source_type: '서버_출처', checked_at: null }],
  map_url: 'https://www.google.com/maps/search/?api=1&query=35.02,134.99',
};
const VISIT_ROUTE = 'POST /places/D02/visit-checks';
const laterCheck = () => nowView({ main: t07(), subs: [], reason: '서버_뒤에_보낸_check_응답' });
const accepted = () =>
  nowView({
    main: t01(),
    subs: [t03()],
    reason: '서버_바뀐_이유',
    pins: [{ ...pins[0] }, { seq: 2, place_id: 'D09', name: '서버_새_장소', ...PROPOSAL_SPOT, start: '14:10', end: '15:00', travel_min: 20, state: 'next' }],
    event: delayEvent({ state: 'resolved', proposals: [] }),
  });
const reasonLine = () => within(screen.getByTestId('now-reason'));
const closedEvent = { event_id: 'ev-closed', type: 'closed', severity: 'high', delay_min: 0, state: 'awaiting', proposals: [] };
const t06 = { type: 'T-06', event_id: 'ev-closed', closed: { place_id: 'D02', name: '서버_확인할_곳' }, proposals: [] as unknown[] };

/**
 * §9 Q8 ①: 늦게 온 행동 응답을 풀어 준다. 그 뒤 나갈 check 하나를 미리 붙잡아 두고, 붙잡힌 동안 shown()이 맞는지 본다.
 * check는 지금 시계(10:10)로 딱 한 번. 풀어 준 뒤에도 더 보내지 않는다.
 */
async function releaseLateAction(control: NowControl, release: (reply: Reply) => void, reply: object, shown: () => void) {
  const before = control.checks().length;
  const holdCheck = control.defer();
  await act(async () => release(json(200, reply)));
  await waitFor(shown);
  await waitFor(() => expect(control.checks()).toHaveLength(before + 1));
  expect(control.checks().at(-1)?.at).toBe(AT('10:10'));
  shown(); // check가 붙잡혀 있는 동안에도 행동 응답이 화면에 있다 (check 응답이 그린 것이 아니다)
  await act(async () => holdCheck(json(200, { ...reply, at: AT('10:10') })));
  await act(async () => undefined);
  expect(control.checks()).toHaveLength(before + 1);
}

// =====================================================================
// 실제 여행 화면(데모 시계로 시각을 바꾼다 — 같은 코드 길, TASK-014 §30 Q1)
// =====================================================================

describe('§E ② 실제 여행: 행동 응답은 뒤에 보낸 check 응답이 먼저 와도 반영한다', () => {
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

  /** 행동 요청을 붙잡아 둔 채(응답 전) 시계를 10분 옮겨 그 check 응답이 먼저 화면에 오게 한다 */
  async function laterCheckArrivesFirst(control: NowControl) {
    control.show(laterCheck());
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    await screen.findByTestId('card-T-07'); // 시험 자체 확인: 뒤에 보낸 check 응답이 먼저 화면에 왔다
  }

  test('T15_E2_이걸로_할래_응답이_늦게_와도_화면에_반영하고_이유_줄은_바꾼_일정으로_안내할게', async () => {
    const control = nowServer(delayedView());
    const release = control.server.defer(ACCEPT_ROUTE('prop-relaxed'));
    await toNow(control);
    await pressId('proposal-prop-relaxed');
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1));
    await laterCheckArrivesFirst(control);
    await releaseLateAction(control, release, accepted(), () => {
      expect(screen.queryByTestId('card-T-07')).toBeNull();
      expect(screen.getByTestId('card-T-01')).toBeTruthy();
      expect(reasonLine().getByText(ACCEPTED_NOTE)).toBeTruthy();
    });
    expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1); // 다시 보내지 않는다 (TASK-007 §6)
  });

  test('T15_E2_그대로_갈래_응답이_늦게_와도_화면에_반영한다', async () => {
    const control = nowServer(delayedView());
    const release = control.server.defer(DISMISS_ROUTE('ev-1'));
    await toNow(control);
    await pressId('event-dismiss');
    await waitFor(() => expect(control.server.sent(DISMISS_ROUTE('ev-1'))).toHaveLength(1));
    await laterCheckArrivesFirst(control);
    await releaseLateAction(control, release, nowView({ reason: '서버_그대로_이유' }), () => {
      expect(reasonLine().getByText('서버_그대로_이유')).toBeTruthy();
      expect(screen.queryByTestId('card-T-07')).toBeNull();
    });
  });

  test.each([
    ['visit-closed', false],
    ['visit-open', true],
  ])('T15_E2_영업_확인_%s_응답이_늦게_와도_화면에_반영한다', async (button, wasOpen) => {
    const control = nowServer(nowView({ main: t05, subs: [t02()] }));
    const release = control.server.defer(VISIT_ROUTE);
    await toNow(control);
    await pressId(button);
    await waitFor(() => expect(control.server.sent(VISIT_ROUTE)).toHaveLength(1));
    expect((control.server.sent(VISIT_ROUTE)[0].body as Record<string, unknown>).was_open).toBe(wasOpen);
    await laterCheckArrivesFirst(control);
    const reply = wasOpen
      ? nowView({ main: t01(), subs: [], reason: '서버_영업_확인_응답' })
      : nowView({ main: t06, subs: [t03()], reason: '서버_영업_확인_응답', event: closedEvent });
    await releaseLateAction(control, release, reply, () => {
      expect(reasonLine().getByText('서버_영업_확인_응답')).toBeTruthy();
      expect(screen.queryByTestId('card-T-07')).toBeNull();
      if (!wasOpen) expect(screen.getByTestId('card-T-06')).toBeTruthy();
    });
  });

  test('T15_E2_경계_행동보다_앞서_보낸_check_응답이_뒤에_오면_지금처럼_버린다', async () => {
    const control = nowServer(delayedView());
    control.server.on(ACCEPT_ROUTE('prop-relaxed'), json(200, accepted()));
    await toNow(control);
    await pressId('demo-toggle');
    const releaseCheck = control.defer(); // 다음 check 하나를 붙잡는다
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    const checksBeforeAction = control.checks().length;
    await pressId('proposal-prop-relaxed');
    await pressId('select-confirm');
    await screen.findByTestId('card-T-01');
    expect(reasonLine().getByText(ACCEPTED_NOTE)).toBeTruthy();
    await act(async () => releaseCheck(json(200, laterCheck())));
    await act(async () => undefined);
    expect(screen.queryByTestId('card-T-07')).toBeNull(); // 조회 응답은 최신만 (TASK-007 B8 그대로)
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(control.checks()).toHaveLength(checksBeforeAction); // §9 Q8 ① 경계: 행동 뒤 시계가 그대로면 check를 더 보내지 않는다
  });

  // ---------- §11 Q8: 행동 응답이 올 때 check가 이미 진행 중이면 ----------

  /** [이걸로 할래](10:00)를 붙잡은 채 시계 +10 -> check(10:10)도 붙잡는다. (행동 풀기, check 풀기) */
  async function actionThenCheckInFlight(control: NowControl) {
    const releaseAction = control.server.defer(ACCEPT_ROUTE('prop-relaxed'));
    await toNow(control);
    await pressId('proposal-prop-relaxed');
    await pressId('select-confirm');
    await waitFor(() => expect(control.server.sent(ACCEPT_ROUTE('prop-relaxed'))).toHaveLength(1));
    await pressId('demo-toggle');
    const releaseCheck = control.defer();
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.checks().at(-1)?.at).toBe(AT('10:10')));
    return { releaseAction, releaseCheck };
  }

  test('T15_S11_Q8_행동_응답_때_check가_진행_중이면_보내지_않고_끝난_뒤_시계가_더_갔으면_한_번_더', async () => {
    const control = nowServer(delayedView());
    const { releaseAction, releaseCheck } = await actionThenCheckInFlight(control);
    const inFlight = control.checks().length;
    await act(async () => releaseAction(json(200, accepted())));
    await screen.findByTestId('card-T-01');
    expect(reasonLine().getByText(ACCEPTED_NOTE)).toBeTruthy();
    await act(async () => undefined);
    expect(control.checks()).toHaveLength(inFlight); // "요청 하나씩": 진행 중이면 겹쳐 보내지 않는다
    await act(async () => releaseCheck(json(200, { ...accepted(), at: AT('10:10') })));
    await waitFor(() => expect(control.checks()).toHaveLength(inFlight + 1)); // 10:10 > 행동 시각 10:00 -> 한 번 더
    expect(control.checks().at(-1)?.at).toBe(AT('10:10'));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(control.checks()).toHaveLength(inFlight + 1); // 한 번만
  });

  test('T15_S11_Q8_기다리는_check는_하나뿐_진행_중에_시계가_여러_번_가도_끝난_뒤_최신_시각으로_한_번', async () => {
    const control = nowServer(delayedView());
    const { releaseAction, releaseCheck } = await actionThenCheckInFlight(control);
    const inFlight = control.checks().length;
    await act(async () => releaseAction(json(200, accepted())));
    await screen.findByTestId('card-T-01');
    await pressId('demo-plus-10'); // 10:20
    await pressId('demo-plus-10'); // 10:30
    await act(async () => undefined);
    expect(control.checks()).toHaveLength(inFlight); // 진행 중에는 쌓지 않는다
    await act(async () => releaseCheck(json(200, { ...accepted(), at: AT('10:10') })));
    await waitFor(() => expect(control.checks()).toHaveLength(inFlight + 1));
    expect(control.checks().at(-1)?.at).toBe(AT('10:30')); // 최신 시각으로 합침
    await act(async () => undefined);
    await act(async () => undefined);
    expect(control.checks()).toHaveLength(inFlight + 1); // 10:20 · 10:30 · 행동 뒤 한 번이 따로 나가지 않는다
  });
});

// =====================================================================
// 연습 화면 (AC-3: 연습 재생 중 [닫혔어] -> 연습 기록에 남음)
// =====================================================================

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';
const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const trip = () => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging: null, // TASK-015 §9 Q2: 응답에 lodging_place_id 없음
  status: 'active',
  is_demo: false,
  trip_days: [tripDay(1, 'past'), tripDay(2, 'today'), tripDay(3, 'planned'), tripDay(4, 'planning')],
});
const plannedDay = { ...demoDay, day_id: PLANNED, date: PLANNED_DATE };
const rehearsalView = (over: object = {}) => nowView({ day: plannedDay, ...over });

describe('§E ② 연습: [닫혔어] 응답은 뒤에 보낸 check 응답이 먼저 와도 연습 기록에 남는다 (AC-3)', () => {
  let server: FakeServer;
  let checkReply: (sent: Sent) => Reply | Promise<Reply>;
  const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;
  const sentTo = (prefix: string) => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(prefix));
  const checks = () => sentTo(`POST /days/${PLANNED}/check`);
  const actionsOf = (sent: Sent): unknown[] => (Array.isArray(body(sent).rehearsal_actions) ? (body(sent).rehearsal_actions as unknown[]) : []);
  const hasClosed = (sent: Sent) => actionsOf(sent).some((one) => (one as { type?: string; was_open?: boolean }).type === 'visit_check' && (one as { was_open?: boolean }).was_open === false);

  beforeEach(() => {
    resetDevice();
    locationFake.reset();
    mapControl.reset();
    jest.useFakeTimers({
      now: Date.parse(NOW_ISO),
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    const view = rehearsalView({ main: t05, subs: [t02()] });
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    server = new FakeServer().on('GET /trips/current', json(200, trip()));
    server.match(`GET /days/${PLANNED}/now`, () => json(200, view));
    server.match(`POST /days/${PLANNED}/check`, (sent) => checkReply(sent));
    server.on(`GET /days/${PLANNED}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function toRehearsal() {
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
    await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
    await screen.findByTestId('trip-now-screen');
    await screen.findByTestId('now-main');
    await act(async () => {
      await new Promise<void>((done) => setImmediate(done));
    });
  }

  test('T15_E2_AC3_연습_닫혔어_응답이_뒤에_보낸_check보다_늦게_와도_다음_check의_연습_기록에_든다', async () => {
    await toRehearsal();
    const release = server.defer(VISIT_ROUTE);
    await tap(await screen.findByTestId('visit-closed'));
    await waitFor(() => expect(sentTo(VISIT_ROUTE)).toHaveLength(1));
    const pressedAt = body(sentTo(VISIT_ROUTE)[0]).at;
    // 재생처럼 시계가 바뀌어 나간 check의 응답이 먼저 온다
    const before = checks().length;
    const shownAfter = rehearsalView({ main: t07(), subs: [], reason: '서버_뒤에_보낸_check_응답' });
    checkReply = (sent) => json(200, { ...shownAfter, at: body(sent).at });
    await tap(await screen.findByTestId('demo-plus-10'));
    await waitFor(() => expect(checks().length).toBeGreaterThan(before));
    await screen.findByTestId('card-T-07'); // 시험 자체 확인
    // 늦게 온 [닫혔어] 응답 (§9 Q8 ②: 대안 카드 T-06이 화면에 보인다). 그 뒤 나갈 check(§9 Q8 ①)는 붙잡아 둔다
    const closedReply = rehearsalView({ main: t06, subs: [t03()], reason: '서버_닫힘_대안_응답', event: closedEvent });
    let releaseFollow!: (reply: Reply) => void;
    const follow = new Promise<Reply>((done) => (releaseFollow = done));
    const beforeRelease = checks().length;
    checkReply = () => follow;
    await act(async () => release(json(200, closedReply)));
    await screen.findByTestId('card-T-06');
    expect(screen.queryByTestId('card-T-07')).toBeNull();
    expect(reasonLine().getByText('서버_닫힘_대안_응답')).toBeTruthy();
    // §9 Q8 ①: 행동 뒤 시계가 10분 갔으니 check 한 번 — 연습 기록에 [닫혔어]가 들어 있다
    await waitFor(() => expect(checks()).toHaveLength(beforeRelease + 1));
    expect(hasClosed(checks()[checks().length - 1])).toBe(true);
    expect(screen.getByTestId('card-T-06')).toBeTruthy(); // 붙잡힌 동안에도 [닫혔어] 응답이 화면에 있다
    await act(async () => releaseFollow(json(200, { ...closedReply, at: body(checks()[checks().length - 1]).at })));
    await act(async () => undefined);
    expect(checks()).toHaveLength(beforeRelease + 1); // 한 번만
    // 다음 연습 check에도 [닫혔어]가 기록으로 함께 간다
    checkReply = (sent) => json(200, { ...rehearsalView(), at: body(sent).at });
    const afterRelease = checks().length;
    await tap(await screen.findByTestId('demo-plus-10'));
    await waitFor(() => expect(checks().length).toBeGreaterThan(afterRelease));
    await waitFor(() => expect(hasClosed(checks()[checks().length - 1])).toBe(true));
    expect(actionsOf(checks()[checks().length - 1])).toEqual([{ type: 'visit_check', place_id: 'D02', day_id: PLANNED, at: pressedAt, was_open: false }]);
    expect(screen.getByText(REHEARSAL_NOTE)).toBeTruthy(); // 연습 한 번의 첫 행동 안내
  });

  test('T15_E2_AC3_경계_뒤에_보낸_check가_없으면_닫혔어는_지금처럼_기록에_든다', async () => {
    server.on(VISIT_ROUTE, json(200, rehearsalView()));
    await toRehearsal();
    await tap(await screen.findByTestId('visit-closed'));
    await waitFor(() => expect(sentTo(VISIT_ROUTE)).toHaveLength(1));
    const pressedAt = body(sentTo(VISIT_ROUTE)[0]).at;
    const before = checks().length;
    await tap(await screen.findByTestId('demo-plus-10'));
    await waitFor(() => expect(checks().length).toBeGreaterThan(before));
    await waitFor(() => expect(hasClosed(checks()[checks().length - 1])).toBe(true));
    expect(actionsOf(checks()[checks().length - 1])).toEqual([{ type: 'visit_check', place_id: 'D02', day_id: PLANNED, at: pressedAt, was_open: false }]);
  });

  test('T15_Q8_2_연습_닫혔어_응답의_대안_카드_T_06이_화면에_보이고_시계가_그대로면_check를_더_보내지_않는다', async () => {
    server.on(VISIT_ROUTE, json(200, rehearsalView({ main: t06, subs: [t03()], reason: '서버_연습_닫힘_대안', event: closedEvent })));
    await toRehearsal();
    const before = checks().length;
    await tap(await screen.findByTestId('visit-closed'));
    await screen.findByTestId('card-T-06');
    expect(screen.queryByTestId('card-T-05')).toBeNull();
    expect(within(screen.getByTestId('now-reason')).getByText('서버_연습_닫힘_대안')).toBeTruthy();
    await act(async () => undefined);
    expect(checks()).toHaveLength(before); // §9 Q8 ① 경계: 시계가 그대로
  });
});
