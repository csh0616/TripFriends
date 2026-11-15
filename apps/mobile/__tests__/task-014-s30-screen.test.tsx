/// <reference types="jest" />
// TASK-014 §30 Q1: §29 ① 응답 규칙(동시에 하나 · 기다리는 동안 최신 시각만 · 응답은 버리지 않고 보낸 순서로 오래된 것만 버림)이
// 데모 재생(실제 여행도 연습도 아닌 S9 데모)과 실제 여행(live)의 시계·위치 check에도 똑같다. 로직·가드레일만 본다.
// 근거: TASK-014 §30 표 Q1("데모 재생·실제 여행 모두 (같은 코드 길)") · Q2("보낸 순서(지금 카운터)") · §29 표 ①,
//       TASK-006 B7(데모 시계 [+10분]·재생 1초에 5분)·B8(300ms 디바운스), TASK-014 A3(실제 여행: 좋은 위치를 check 본문에)·C4(실제 시계를 따라간다).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — §29 ①의 계약을 데모·실제 여행으로 넓힌 것):
//   데모: [+10분]·재생이 부르는 POST /check는 한 번에 하나만 나가 있다. 기다리는 동안 시계가 여러 번 바뀌면 마지막 시각 하나만 들고 있다가
//         응답이 온 뒤(400ms 안) 그 시각으로 한 번. 돌아온 응답은 화면에 반영한다. 재생 중 느린 응답(1.5초)이어도 카드가 실제로 바뀌고, 보여 준 시각은 앞으로만
//   실제 여행: 위치 check가 나가 있는 동안 새 위치·시계 분이 바뀌어도 더 보내지 않는다. 응답이 오면(400ms 안) 그때의 시각 + 마지막으로 잰 좋은 위치로 한 번
//   요청 시간 제한(10초)은 그대로라 실제 여행 시계 테스트는 응답을 10초 안에 돌려준다
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json, type Reply, type Sent } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { pressId, resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { nowView } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const REAL_TIMERS_KEEP = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate'] as const;

const hhmmOf = (at: unknown) => {
  const found = /T(\d{2}:\d{2})/.exec(String(at));
  return found ? found[1] : '??:??';
};
const reasonFor = (at: unknown) => `서버_이유_${hhmmOf(at)}`;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function advance(ms: number, step = 50) {
  for (let passed = 0; passed < ms; passed += step) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - passed));
    });
  }
}
const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};
const shownReason = (): string | null => {
  const found = within(screen.getByTestId('now-reason')).queryByText(/^서버_이유_/);
  return found ? String(found.props.children) : null;
};

/** 응답 방식: now = 바로 · manual = 테스트가 하나씩 풀어 준다 · delay = ms 뒤 */
type Mode = { kind: 'now' } | { kind: 'manual' } | { kind: 'delay'; ms: number };
let inFlight = 0;
let maxInFlight = 0;
let waiting: (() => void)[] = [];
function slow(mode: Mode, reply: Reply): Reply | Promise<Reply> {
  if (mode.kind === 'now') return reply;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise<Reply>((done) => {
    const finish = () => {
      inFlight -= 1;
      done(reply);
    };
    if (mode.kind === 'delay') setTimeout(finish, mode.ms);
    else waiting.push(finish);
  });
}
async function answerOldest() {
  const next = waiting.shift();
  if (!next) throw new Error('기다리는 check가 없다');
  await act(async () => {
    next();
  });
  await advance(0);
}

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  installConfig(TEST_KEY);
  inFlight = 0;
  maxInFlight = 0;
  waiting = [];
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// 데모 (S9 [여행 중 화면 보기(데모)], 연습 아님)
// =====================================================================

describe('§30 Q1 데모: check는 하나씩, 기다리는 동안 최신 시각 하나만', () => {
  const AT = (clock: string) => `2026-12-02T${clock}:00`;
  let mode: Mode;

  async function ready() {
    mode = { kind: 'now' };
    const control = nowServer();
    // 서버처럼 보낸 at을 싣고, 이유 줄로 어느 시각의 응답인지 보이게
    control.reply(((at: string | null) => slow(mode, json(200, nowView({ at, reason: reasonFor(at) })))) as never);
    await toNow(control);
    await pressId('demo-toggle');
    jest.useFakeTimers({ now: Date.now(), doNotFake: [...REAL_TIMERS_KEEP] });
    return control;
  }
  const checksAfter = (control: ReturnType<typeof nowServer>, before: number) => control.checks().slice(before).map((request) => hhmmOf(request.at));

  test('T14_S30_Q1_데모_응답을_기다리는_동안_10분을_여러_번_눌러도_check를_더_보내지_않는다', async () => {
    const control = await ready();
    mode = { kind: 'manual' };
    const before = control.checks().length;
    await pressId('demo-plus-10'); // 10:10
    await advance(400);
    expect(control.checks().length).toBe(before + 1);
    for (let i = 0; i < 3; i += 1) {
      await pressId('demo-plus-10'); // 10:20 · 10:30 · 10:40
      await advance(400);
    }
    expect(control.checks().length).toBe(before + 1);
    expect(maxInFlight).toBe(1);
  });

  test('T14_S30_Q1_데모_응답이_오면_반영하고_들고_있던_마지막_시각으로_한_번만', async () => {
    const control = await ready();
    mode = { kind: 'manual' };
    const before = control.checks().length;
    await pressId('demo-plus-10');
    await advance(400);
    for (let i = 0; i < 3; i += 1) {
      await pressId('demo-plus-10');
      await advance(400);
    }
    await answerOldest();
    expect(shownReason()).toBe(reasonFor(AT('10:10'))); // 시계가 그 뒤로 바뀌었어도 버리지 않는다
    await advance(400);
    expect(checksAfter(control, before)).toEqual(['10:10', '10:40']); // 중간 시각(10:20·10:30)은 안 보낸다
    await answerOldest();
    expect(shownReason()).toBe(reasonFor(AT('10:40')));
    expect(maxInFlight).toBe(1);
  });

  test('T14_S30_Q1_경계_데모_응답이_바로_오면_10분마다_check가_하나씩_지금처럼', async () => {
    const control = await ready();
    const before = control.checks().length;
    for (let i = 0; i < 3; i += 1) {
      await pressId('demo-plus-10');
      await advance(400);
    }
    expect(checksAfter(control, before)).toEqual(['10:10', '10:20', '10:30']);
    expect(shownReason()).toBe(reasonFor(AT('10:30')));
  });

  test.each([800, 1500])('T14_S30_Q1_데모_재생_중_check_응답이_%sms_걸려도_카드가_바뀌고_시각은_앞으로만', async (ms) => {
    await ready();
    mode = { kind: 'delay', ms };
    await pressId('demo-play');
    const seen: string[] = [];
    for (let t = 0; t < 6000; t += 50) {
      await advance(50);
      const now = shownReason();
      if (now && now !== seen[seen.length - 1]) seen.push(now);
    }
    const changed = seen.filter((reason) => reason !== reasonFor(AT('10:00')));
    expect(changed.length).toBeGreaterThanOrEqual(2);
    const shownMinutes = seen.map((reason) => minutesOf(reason.slice(-5)));
    expect([...shownMinutes].sort((a, b) => a - b)).toEqual(shownMinutes);
    expect(maxInFlight).toBe(1);
  });
});

// =====================================================================
// 실제 여행 (live): 위치·시계 check
// =====================================================================

describe('§30 Q1 실제 여행: 위치·시계 check도 하나씩', () => {
  const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
  const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00:00 (day-t2가 오늘)
  const TODAY = 'day-t2';
  const HERE = { lat: 34.668713, lng: 135.501327 };
  const METERS_PER_DEG_LAT = (6371000 * Math.PI) / 180;
  const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / METERS_PER_DEG_LAT, lng: from.lng });
  const todayDay = { ...demoDay, day_id: TODAY, date: '2026-12-02' };

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
    lodging_place_id: null,
    status: 'active',
    is_demo: false,
    trip_days: [tripDay(1, 'past'), tripDay(2, 'today'), tripDay(3, 'planned'), tripDay(4, 'planning')],
  });

  let server: FakeServer;
  let mode: Mode;
  const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;
  const checks = () => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(`POST /days/${TODAY}/check`));
  const view = (at: unknown) => nowView({ day: todayDay, at, reason: reasonFor(at) });

  beforeEach(() => {
    mode = { kind: 'now' };
    // 실제 시계(30초마다 다시 읽기)·요청 시간 제한까지 가짜 시계로: 화면을 띄우기 전에 켠다
    jest.useRealTimers();
    jest.useFakeTimers({ now: Date.parse(NOW_ISO), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] }); // task-014-location §10 Q7과 같은 방식
    server = new FakeServer().on('GET /trips/current', json(200, trip()));
    server.match(`GET /days/${TODAY}/now`, (sent) => {
      const found = /[?&]at=([^&]+)/.exec(sent.path);
      return json(200, view(found ? decodeURIComponent(found[1]) : '2026-12-02T12:00:00'));
    });
    server.match(`POST /days/${TODAY}/check`, (sent) => slow(mode, json(200, view(body(sent).at))));
  });

  async function openToday() {
    locationFake.permit('granted');
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
    await tap(await screen.findByTestId(`day-row-${TODAY}`));
    await screen.findByTestId('trip-now-screen');
    await waitFor(() => expect(server.requests.some((r) => r.method === 'GET' && r.path.startsWith(`/days/${TODAY}/now`))).toBe(true));
    await settleAll();
  }
  async function walk(spot: { lat: number; lng: number }) {
    await act(async () => {
      locationFake.emit({ ...spot, accuracy: 10, timestamp: Date.now() });
    });
    await settleAll();
  }

  test('T14_S30_Q1_실제_여행_위치_check를_기다리는_동안_새_위치가_와도_더_보내지_않는다', async () => {
    await openToday();
    mode = { kind: 'manual' };
    const before = checks().length;
    await walk(HERE);
    await waitFor(() => expect(checks().length).toBe(before + 1));
    await advance(1000);
    await walk(north(HERE, 100)); // 50m 넘게 움직여 보낼 만한 위치 (A3)
    await advance(1000);
    await walk(north(HERE, 200));
    await advance(1000);
    expect(checks().length).toBe(before + 1);
    expect(maxInFlight).toBe(1);
  });

  test('T14_S30_Q1_실제_여행_응답이_오면_반영하고_마지막으로_잰_위치로_한_번만', async () => {
    await openToday();
    mode = { kind: 'manual' };
    const before = checks().length;
    await walk(HERE);
    await waitFor(() => expect(checks().length).toBe(before + 1));
    await advance(1000);
    await walk(north(HERE, 100));
    await advance(1000);
    const latest = north(HERE, 200);
    await walk(latest);
    await advance(1000);
    await answerOldest();
    expect(shownReason()).toBe(reasonFor('T12:00')); // 버리지 않는다
    await advance(400);
    const sent = checks().slice(before);
    expect(sent).toHaveLength(2);
    expect([body(sent[1]).lat, body(sent[1]).lng]).toEqual([latest.lat, latest.lng]); // 중간 위치(100m)는 안 보낸다
    expect(maxInFlight).toBe(1);
  });

  test('T14_S30_Q1_실제_여행_위치_check를_기다리는_동안_시계_분이_바뀌면_응답_뒤_그_시각으로_한_번', async () => {
    await openToday();
    await advance(55000); // 12:00:55 (30초마다 시계를 다시 읽어도 아직 12:00)
    mode = { kind: 'manual' };
    const before = checks().length;
    await walk(HERE); // 12:00 위치 check, 응답 대기
    await waitFor(() => expect(checks().length).toBe(before + 1));
    expect(hhmmOf(body(checks()[before]).at)).toBe('12:00');
    await advance(6000); // 12:01:01 — 60초 시계 읽기로 분이 바뀐다 (디바운스 300ms도 지남)
    expect(checks().length).toBe(before + 1);
    await answerOldest(); // 시간 제한(10초) 안
    expect(shownReason()).toBe(reasonFor('T12:00'));
    await advance(400);
    const sent = checks().slice(before);
    expect(sent.map((one) => hhmmOf(body(one).at))).toEqual(['12:00', '12:01']);
    expect([body(sent[1]).lat, body(sent[1]).lng]).toEqual([HERE.lat, HERE.lng]); // 잰 지 120초 안의 위치는 그대로 싣는다 (§10 Q7)
    expect(maxInFlight).toBe(1);
  });

  test('T14_S30_Q1_경계_실제_여행_응답이_바로_오면_움직일_때마다_위치_check가_나간다_지금처럼', async () => {
    await openToday();
    const before = checks().length;
    await walk(HERE);
    await advance(1000);
    await walk(north(HERE, 100));
    await advance(1000);
    const sent = checks().slice(before);
    expect(sent.map((one) => body(one).lat)).toEqual([HERE.lat, north(HERE, 100).lat]);
  });
});
