/// <reference types="jest" />
// TASK-012 §18 빈틈 1·2: 연결 도중 앱이 꺼졌을 때 / 익명 복원이 실패했을 때. 로직만 본다.
// 근거: TASK-012 §18 "빈틈 1 연결 도중 앱 종료: 앱 시작 때 보관한 익명 세션이 있으면 — 지금 세션이 그 익명이면 보관본만 지움 /
//   지금 세션이 계정이면 claim을 다시 부름(choose면 어느 여행 시트) / 실패면 §16 Q13 복구. 보관본은 SecureStore에",
//   "빈틈 2 익명 복원 실패: 알림만(계정 세션 유지, 새 익명 계정 만들지 않음)", §16 Q6(보관본은 moved·choose 성공 뒤 지움)·Q13, §15 S4.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   보관한 익명 세션은 expo-secure-store에 둔다 (테스트는 test-support/secure-store-mock). AsyncStorage에는 보관본이 없다
//   "앱이 꺼짐" = 화면을 내리고(unmount) 같은 기기 저장소로 다시 켠다. 그 사이 끝나지 않은 브라우저·claim 요청은 버린다
//   키 이름은 정하지 않는다: 저장소의 값에 익명 refresh token이 있는지로 본다
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { memoryStorage } from '../test-support/async-storage-mock';
import { apiError, FakeServer, json, type Sent } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { secureStore } from '../test-support/secure-store-mock';
import { authFake, EXISTING_USER_ID, type FakeSession } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const CLAIM = 'POST /account/claim';
const FAILED = '연결하지 못했어. 지금 여행은 그대로야';
const PICK_TITLE = '어느 여행을 쓸까?';
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-11',
  end_date: '2026-12-12',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: ['2026-12-11', '2026-12-12'].map((date, i) => ({
    day_id: `day-t${i + 1}`,
    date,
    state: i === 0 ? 'planned' : 'planning',
    chosen_option_id: i === 0 ? 'opt-1' : null,
    fixed_events: [],
    summary: i === 0 ? { end_time: '18:30', place_count: 3, move_min: 40 } : null,
    must_visits: [],
  })),
};
const CHOICES = {
  result: 'choose',
  choices: [
    { origin: 'device', trip_id: TRIP.trip_id, name: '오사카 1박 2일', start_date: '2026-12-11', end_date: '2026-12-12', planned_days: 1, total_days: 2 },
    { origin: 'account', trip_id: 'trip-account-1', name: '오사카 당일 여행', start_date: '2027-01-08', end_date: '2027-01-08', planned_days: 0, total_days: 1 },
  ],
};

let server: FakeServer;

// ---------- 익명 복원 뒤 확인 (reviewer 11-12: 실제 Supabase에서 signOut이 되살린 익명 세션을 끊던 버그) ----------
// 계약 (승인 대기): 복원 = 보관한 익명 세션으로 setSession을 먼저 하고, 성공했을 때만 옛 계정 세션을 따로 끊는다
//   -> Supabase `POST {SUPABASE_URL}/auth/v1/logout?scope=local` + Authorization: Bearer <옛 계정 access token> (가짜: authFake.logoutByToken)
//   지금 클라이언트의 signOut()은 지금 세션(= 되살린 익명)을 끊으므로 복원 뒤에 부르지 않는다
const installLogout = (target: FakeServer) =>
  target.match('POST /auth/v1/logout', (sent) => {
    const token = (target.headers(sent).authorization ?? '').replace(/^Bearer\s+/i, '');
    const scope = /[?&]scope=([^&]+)/.exec(sent.path)?.[1] ?? 'global';
    return json(authFake.logoutByToken(token, scope), {});
  });
/** 옛 계정(EXISTING_USER_ID) 세션이 모두 끊겼다 */
const expectAccountRevoked = () => {
  const tokens = authFake.accessTokensOf(EXISTING_USER_ID);
  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.filter((token) => !authFake.isRevoked(token))).toEqual([]);
};
/** 지금 세션이 연결 전 그 익명이고 끊기지 않았다 (refresh도 된다) */
const expectLiveAnon = async (anonId: string) => {
  const now = await authFake.session();
  expect(now?.user.id).toBe(anonId);
  expect(now?.user.is_anonymous).toBe(true);
  expect(authFake.isRevoked(now?.access_token)).toBe(false);
  expect(authFake.isRevoked(now?.refresh_token)).toBe(false);
};

const startHome = () => {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
};
const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};
const session = () => authFake.session();
const bearerOf = (sent: Sent) => server.headers(sent).authorization;
const holds = (values: string[], token: string) => values.filter((value) => value.includes(token)).length;

/** 날짜 목록 -> 아바타 -> [저장하기] -> [Google 계정으로 계속] (이미 있는 계정) */
async function startLinkToExisting(): Promise<FakeSession> {
  authFake.googleAccount({ existing: true });
  server.on(CURRENT, json(200, TRIP));
  await startHome();
  await screen.findByTestId('day-row-day-t1');
  const anon = (await session())!;
  await tap(screen.getByRole('button', { name: '내 프로필' }));
  await tap(await screen.findByText('저장하기'));
  await tap(await screen.findByText('Google 계정으로 계속'));
  await settleAll();
  return anon;
}

/** 그 계정으로 로그인까지 끝나고 claim 응답을 기다리는 중에 앱이 꺼진다 */
async function killDuringClaim(): Promise<FakeSession> {
  server.defer(CLAIM); // 이 claim은 답이 오지 않는다
  const anon = await startLinkToExisting();
  await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1));
  expect((await session())?.user.id).toBe(EXISTING_USER_ID);
  await screen.unmount();
  return anon;
}

beforeEach(() => {
  resetDevice();
  jest.useFakeTimers({ now: Date.parse('2026-12-02T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  server = new FakeServer();
  installLogout(server);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- 보관 위치 ----------

test('T12_S18_보관한_익명_세션은_SecureStore에_있고_AsyncStorage에는_익명_토큰이_없다', async () => {
  server.defer(CLAIM);
  const anon = await startLinkToExisting();
  await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1)); // 지금 세션 = 계정, 보관본 = 익명
  expect(holds(secureStore.values(), anon.refresh_token)).toBeGreaterThan(0);
  expect(holds(memoryStorage.values(), anon.refresh_token)).toBe(0);
  expect(holds(memoryStorage.values(), anon.access_token)).toBe(0);
});

// ---------- 빈틈 1: 앱 시작 때 보관본 처리 ----------

test('T12_S18_빈틈1_지금_세션이_그_익명이면_보관본만_지운다·claim_없음', async () => {
  authFake.browser('pick', 'hang'); // 연결 -> 이미 있는 계정 -> 그 계정 로그인 창이 떠 있는 채로 앱이 꺼짐
  const anon = await startLinkToExisting();
  await waitFor(() => expect(authFake.browserCalls()).toHaveLength(2));
  await screen.unmount();

  await startHome();
  await screen.findByTestId('day-row-day-t1');
  await settleAll();
  await waitFor(() => expect(holds(secureStore.values(), anon.refresh_token)).toBe(0));
  expect(holds(memoryStorage.values(), anon.refresh_token)).toBe(1); // 지금 세션 칸 하나뿐 (보관본 아님)
  expect((await session())?.user).toEqual(anon.user);
  expect(server.sent(CLAIM)).toEqual([]);
  expect(authFake.signOuts()).toBe(0);
  expect(screen.queryByText(FAILED)).toBeNull();
});

test('T12_S18_빈틈1_지금_세션이_계정이면_claim을_다시_부르고_moved면_보관본을_지우고_계정_여행', async () => {
  const anon = await killDuringClaim();
  server.on(CLAIM, json(200, { result: 'moved' }));
  await startHome();
  await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(2));
  const account = await session();
  const again = server.sent(CLAIM)[1];
  expect(bearerOf(again)).toBe(`Bearer ${account?.access_token}`);
  expect(authFake.userOfAccess((again.body as { anonymous_token?: string }).anonymous_token)?.id).toBe(anon.user.id);
  expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
  await settleAll();
  expect(server.sent(CURRENT).some((sent) => bearerOf(sent) === `Bearer ${account?.access_token}`)).toBe(true);
  expect(holds(secureStore.values(), anon.refresh_token)).toBe(0);
  expect(account?.user.id).toBe(EXISTING_USER_ID);
  expect(screen.queryByText(FAILED)).toBeNull();
});

test('T12_S18_빈틈1_다시_부른_claim이_choose면_어느_여행_시트', async () => {
  await killDuringClaim();
  server.on(CLAIM, json(200, CHOICES));
  await startHome();
  expect(await screen.findByText(PICK_TITLE)).toBeTruthy();
  expect(screen.getByText('오사카 1박 2일')).toBeTruthy();
  expect(server.sent(CLAIM)).toHaveLength(2);
});

test.each([
  ['서버_500', apiError(500, 'INTERNAL_ERROR')],
  ['이미_처리됨_409', apiError(409, 'ALREADY_CLAIMED')],
])('T12_S18_빈틈1_다시_부른_claim이_실패(%s)면_계정_로그아웃·익명_복원·알림', async (_name, reply) => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const anon = await killDuringClaim();
  server.on(CLAIM, reply);
  await startHome();
  expect(await screen.findByText(FAILED)).toBeTruthy();
  expect((await session())?.user).toEqual(anon.user);
  await expectLiveAnon(anon.user.id);
  expectAccountRevoked(); // §16 Q13: 옛 계정 세션이 무효가 됨
  expect(authFake.signIns()).toBe(1); // 처음 익명 로그인 한 번뿐

  // 앱을 다시 켜도 같은 익명, 새 익명 계정 0
  await screen.unmount();
  await startHome();
  expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
  await settleAll();
  await expectLiveAnon(anon.user.id);
  expect(authFake.signIns()).toBe(1);
  expect(server.sent(CLAIM)).toHaveLength(2); // 보관본을 지웠으니 또 부르지 않는다
});

test('T12_S18_빈틈1_보관본이_없으면_시작할_때_claim을_부르지_않는다', async () => {
  await authFake.keepSession({ email: 'seunghyun@gmail.com' }); // 이미 연결된 기기
  server.on(CURRENT, json(200, TRIP));
  await startHome();
  await screen.findByTestId('day-row-day-t1');
  await settleAll();
  expect(server.sent(CLAIM)).toEqual([]);
});

// ---------- 빈틈 2: 익명 복원 실패 -> 알림만 ----------

test('T12_S18_빈틈2_익명_복원이_실패하면_알림만·계정_세션_유지·새_익명_계정_없음', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  server.on(CLAIM, apiError(500, 'INTERNAL_ERROR'));
  authFake.failSetSession(1);
  await startLinkToExisting();
  expect(await screen.findByText(FAILED)).toBeTruthy();
  const now = await session();
  expect(now).not.toBeNull();
  expect(now?.user.id).toBe(EXISTING_USER_ID); // 계정 세션 유지 (지워지지 않은 익명 여행은 알려진 한계)
  expect(authFake.isRevoked(now?.access_token)).toBe(false); // 복원이 실패했으니 계정 세션을 끊지 않는다
  expect(authFake.isRevoked(now?.refresh_token)).toBe(false);
  expect(authFake.signIns()).toBe(1); // 새 익명 계정 없음
});
