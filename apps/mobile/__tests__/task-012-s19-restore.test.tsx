/// <reference types="jest" />
// TASK-012 §19 F2: 처음 화면(S0)에서 로그인할 길. 앱을 다시 깐 사람이 데모·새 여행을 거치지 않고 저장해 둔 여행으로 (AC-8 상황).
// 근거: TASK-012 §19 F2("S0에 보조 버튼 「저장해 둔 여행 불러오기」 -> 저장 권유 시트와 같은 시트(제목 「저장해 둔 여행 불러올래?」, Google 버튼)
//   -> 연결 결과대로(계정 여행이 지금 여행). 익명에 여행이 없으니 moved"), §9 9(실패 알림)·§16 Q7(취소면 시트 그대로)·§16 Q11·§17 3(가짜 공급자),
//   DESIGN-001 §4-12·리뷰 §3(보조 버튼 = bg-2 바탕, 주황 아님).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   S0 보조 버튼 = 역할 button, 이름 「저장해 둔 여행 불러오기」. 개발·릴리스 빌드 모두에 있다 (데모 버튼과 달리)
//   시트 = 제목 「저장해 둔 여행 불러올래?」 + [Google 계정으로 계속] (그 밖 문구는 문서에 없어 보지 않는다)
//   연결은 저장 권유 시트와 같은 길 (C2·C4): 이미 있는 계정이면 claim -> moved -> 그 계정 토큰으로 지금 여행 -> 날짜 목록
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json, type Sent } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { authFake, EXISTING_USER_ID } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const CLAIM = 'POST /account/claim';
const RESTORE = '저장해 둔 여행 불러오기';
const TITLE = '저장해 둔 여행 불러올래?';
const GOOGLE = 'Google 계정으로 계속';
const FAILED = '연결하지 못했어. 지금 여행은 그대로야';
const BRAND = '#FF5A00';
const NO_TRIP = apiError(404, 'NOT_FOUND', { resource: 'trip' });
const ACCOUNT_TRIP = {
  trip_id: 'trip-account-1',
  city_code: 'osaka',
  start_date: '2026-12-11',
  end_date: '2026-12-12',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: ['2026-12-11', '2026-12-12'].map((date, i) => ({
    day_id: `day-a${i + 1}`,
    date,
    state: i === 0 ? 'planned' : 'planning',
    chosen_option_id: i === 0 ? 'opt-1' : null,
    fixed_events: [],
    summary: i === 0 ? { end_time: '18:30', place_count: 3, move_min: 40 } : null,
    must_visits: [],
  })),
};

let server: FakeServer;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;
const realFlag = process.env.EXPO_PUBLIC_DEV_LOGIN;

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
const tokenOf = (sent: Sent) => (server.headers(sent).authorization ?? '').replace(/^Bearer /, '');

/** 지금 여행: 계정(이미 있던 Google 계정) 토큰이면 계정 여행, 익명 토큰이면 없음 (다시 깐 앱) */
function freshInstallServer() {
  server = new FakeServer();
  server.match(CURRENT, (sent) => (authFake.userOfAccess(tokenOf(sent))?.id === EXISTING_USER_ID ? json(200, ACCOUNT_TRIP) : NO_TRIP));
  server.match('POST /auth/v1/logout', (sent) => json(authFake.logoutByToken(tokenOf(sent)), {}));
  return server;
}

async function toRestoreSheet() {
  await startHome();
  await tap(await screen.findByRole('button', { name: RESTORE }));
  await screen.findByText(TITLE);
}

beforeEach(() => {
  resetDevice();
  jest.useFakeTimers({ now: Date.parse('2026-12-02T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  freshInstallServer();
  authFake.googleAccount({ existing: true });
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN;
  else process.env.EXPO_PUBLIC_DEV_LOGIN = realFlag;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([
  ['개발_빌드', true],
  ['릴리스', false],
])('T12_S19_F2_S0에_보조_버튼_저장해_둔_여행_불러오기가_있다(%s)·주황_아님', async (_name, dev) => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  await startHome();
  const button = await screen.findByRole('button', { name: RESTORE });
  const fill = String(StyleSheet.flatten((button as unknown as { props: { style?: Parameters<typeof StyleSheet.flatten>[0] } }).props.style)?.backgroundColor ?? '').toUpperCase();
  expect(fill).not.toBe(BRAND); // 보조 버튼 (주 버튼은 [여행 만들기] 하나)
  expect(screen.getByText('여행 만들기')).toBeTruthy();
});

test('T12_S19_F2_누르면_저장_권유와_같은_시트·제목_저장해_둔_여행_불러올래·Google_버튼', async () => {
  await toRestoreSheet();
  expect(screen.getByText(TITLE)).toBeTruthy();
  expect(screen.getAllByText(GOOGLE)).toHaveLength(1);
  expect(authFake.linkCalls()).toEqual([]); // 누르기 전엔 연결을 시작하지 않는다
});

test('T12_S19_F2_이미_있는_계정이면_claim_moved_뒤_그_계정_여행이_날짜_목록', async () => {
  server.on(CLAIM, json(200, { result: 'moved' }));
  await toRestoreSheet();
  await tap(screen.getByText(GOOGLE));
  expect(await screen.findByTestId('day-row-day-a1')).toBeTruthy();
  const account = await authFake.session();
  expect(account?.user.id).toBe(EXISTING_USER_ID);
  expect(server.sent(CLAIM)).toHaveLength(1);
  expect(tokenOf(server.sent(CLAIM)[0])).toBe(account?.access_token);
  expect(server.sent(CURRENT).some((sent) => tokenOf(sent) === account?.access_token)).toBe(true);
  expect(screen.queryByText(TITLE)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(authFake.signIns()).toBe(1);
});

test.each([['cancel'], ['dismiss']] as const)('T12_S19_F2_S16_Q7_브라우저를_닫으면(%s)_알림_없이_시트_그대로', async (step) => {
  authFake.browser(step);
  await toRestoreSheet();
  const before = await authFake.session();
  await tap(screen.getByText(GOOGLE));
  await settleAll();
  expect(screen.getByText(TITLE)).toBeTruthy();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect((await authFake.session())?.user).toEqual(before?.user);
  expect(server.sent(CLAIM)).toEqual([]);
});

test.each([
  ['연결_주소를_못_받음', () => authFake.failLink(1), null],
  ['claim_500', () => undefined, apiError(500, 'INTERNAL_ERROR')],
])('T12_S19_F2_S9_9_실패하면(%s)_같은_알림·시트_닫힘·처음_화면_익명_그대로', async (_name, arrange, claimReply) => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  arrange();
  if (claimReply) server.on(CLAIM, claimReply);
  await toRestoreSheet();
  const before = await authFake.session();
  await tap(screen.getByText(GOOGLE));
  expect(await screen.findByText(FAILED)).toBeTruthy();
  expect(screen.queryByText(TITLE)).toBeNull();
  expect(screen.getByText('여행 만들기')).toBeTruthy();
  const after = await authFake.session();
  expect(after?.user.id).toBe(before?.user.id);
  expect(after?.user.is_anonymous).toBe(true);
  expect(authFake.signIns()).toBe(1);
});

test('T12_S19_F2_S17_3_가짜_공급자_existing도_처음_화면에서_불러온다', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  process.env.EXPO_PUBLIC_DEV_LOGIN = 'existing';
  server.on(CLAIM, json(200, { result: 'moved' }));
  await toRestoreSheet();
  await tap(screen.getByText(GOOGLE));
  expect(await screen.findByTestId('day-row-day-a1')).toBeTruthy();
  expect(authFake.passwordCalls().map((call) => call.email)).toEqual(['link-existing@example.test']);
  expect(authFake.browserCalls()).toEqual([]);
  expect(server.sent(CLAIM)).toHaveLength(1);
});

test('T12_S19_F2_불러온_뒤_앱을_다시_켜도_계정_여행', async () => {
  server.on(CLAIM, json(200, { result: 'moved' }));
  await toRestoreSheet();
  await tap(screen.getByText(GOOGLE));
  await screen.findByTestId('day-row-day-a1');
  await screen.unmount();
  await startHome();
  expect(await screen.findByTestId('day-row-day-a1')).toBeTruthy();
  await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1)); // 보관본이 없으니 다시 claim하지 않는다
});
