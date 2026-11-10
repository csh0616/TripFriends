/// <reference types="jest" />
// TASK-012 §13 1·2: 앱을 다시 켜도 그날 계획 대화가 이어진다 (세션 ID는 기기에 두지 않고 서버에 묻는다) · 오래 백그라운드에 있다 돌아와도 첫 요청 전 토큰 갱신.
// 근거: TASK-012 §13 1(그날 계획에 들어갈 때 서버에 진행 중 세션을 묻고 이어 감, 없을 때만 새로 시작, TASK-004 GET 이어 가기)·2(autoRefreshToken 끈 채로
//   토큰을 읽을 때 만료 처리), TASK-004 §A A1(GET은 지금 stage의 응답), §10 Q6.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   날 줄을 눌러 계획에 들어가면 먼저 GET /days/{day_id}/planning
//     200(지금 stage 응답) -> 그 화면으로 이어 간다. POST /days/{day_id}/planning은 보내지 않는다
//     404 detail.resource = "session" -> 그때만 POST /days/{day_id}/planning으로 새로 시작
//   실제 여행의 계획 세션 ID는 기기 저장소에 쓰지 않는다 (데모 흐름의 저장은 이 테스트 밖, 질문)
//   만료된 세션이 기기에 있으면 첫 요청은 새로 받은 토큰을 싣는다 (Supabase getSession이 만료를 처리, 가짜도 같게)
import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json } from '../test-support/fake-server';
import { resetDevice, storedValues, tap } from '../test-support/planning-driver';
import { batch, picks, session, SID } from '../test-support/planning-fixtures';
import { authFake } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const DAY = 'day-t2';
const BY_DAY = `GET /days/${DAY}/planning`;
const START = `POST /days/${DAY}/planning`;
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-11',
  end_date: '2026-12-12',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: [
    { day_id: 'day-t1', date: '2026-12-11', state: 'planned', chosen_option_id: 'opt-1', fixed_events: [], summary: { end_time: '18:30', place_count: 3, move_min: 40 }, must_visits: [] },
    { day_id: DAY, date: '2026-12-12', state: 'planning', chosen_option_id: null, fixed_events: [], summary: null, must_visits: [] },
  ],
};
const RESUMED = { ...batch({ message: '서버가_기억한_묶음' }), ...picks(['D01']) };

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

async function openDay() {
  await tap(await screen.findByTestId(`day-row-${DAY}`));
}

let server: FakeServer;

beforeEach(() => {
  resetDevice();
  freezeDate('2026-11-06T03:00:00Z');
  server = new FakeServer().on(CURRENT, json(200, TRIP)).on(START, json(201, session)).on(`GET /planning/${SID}`, json(200, session));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const noSession = apiError(404, 'NOT_FOUND', { resource: 'session' });

describe('§13 1 그날 진행 중인 계획 세션을 서버에 묻는다', () => {
  test('T12_S13_1_들어갈_때_먼저_묻고_없으면(404_session)_그때_새로_시작', async () => {
    server.on(BY_DAY, noSession);
    await startHome();
    await openDay();
    await waitFor(() => expect(server.sent(START)).toHaveLength(1));
    const order = server.requests.map((r) => `${r.method} ${r.path}`).filter((r) => r === BY_DAY || r === START);
    expect(order).toEqual([BY_DAY, START]);
  });

  test('T12_S13_1_진행_중_세션이_있으면_새로_시작하지_않고_그_화면(같은_후보·담은_곳)', async () => {
    server.on(BY_DAY, json(200, RESUMED));
    await startHome();
    await openDay();
    expect(await screen.findByText('서버가_기억한_묶음')).toBeTruthy();
    for (const candidate of RESUMED.candidates) expect(screen.getByTestId(`candidate-card-${candidate.place.id}`)).toBeTruthy();
    expect(server.sent(START)).toEqual([]);
    expect(server.headers(server.sent(BY_DAY)[0]).authorization).toMatch(/^Bearer \S+$/);
  });

  test('T12_S13_1_앱을_다시_켠_뒤_같은_날에_들어가면_같은_대화_세션_ID는_기기에_없다', async () => {
    server.once(BY_DAY, noSession).on(BY_DAY, json(200, RESUMED));
    const first = await startHome();
    await openDay();
    await waitFor(() => expect(server.sent(START)).toHaveLength(1));
    expect(storedValues().some((value) => value.includes(SID))).toBe(false); // 세션 ID를 기기에 쓰지 않는다
    await first.unmount(); // 앱을 완전히 끈다 (앱 안 상태가 비워진다)
    await startHome();
    await openDay();
    expect(await screen.findByText('서버가_기억한_묶음')).toBeTruthy();
    expect(server.sent(START)).toHaveLength(1); // 다시 켠 뒤에는 새로 시작하지 않았다
    expect(storedValues().some((value) => value.includes(SID))).toBe(false);
  });
});

describe('§13 2 오래 백그라운드에 있다 돌아와도 첫 요청 전 토큰 갱신', () => {
  test('T12_S13_2_만료된_세션이_기기에_있으면_첫_요청이_새로_받은_토큰을_싣는다', async () => {
    const stale = await authFake.keepSession({ expired: true });
    await startHome();
    await screen.findByTestId(`day-row-${DAY}`);
    const [first] = server.sent(CURRENT);
    const sentToken = server.headers(first).authorization;
    expect(sentToken).toMatch(/^Bearer \S+$/);
    expect(sentToken).not.toBe(`Bearer ${stale.access_token}`);
    expect(sentToken).toBe(`Bearer ${(await authFake.session())?.access_token}`);
    expect(server.sent(CURRENT)).toHaveLength(1); // 401을 맞고 다시 보낸 것이 아니라 처음부터 새 토큰
    expect(authFake.signIns()).toBe(0); // 같은 사용자 (새 익명 계정 없음)
  });
});
