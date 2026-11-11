/// <reference types="jest" />
// TASK-012 §16 Q11·§17 3 개발용 가짜 로그인 공급자 (AC-6 Maestro account-link 용). 로직만 본다.
// 근거: TASK-012 §16 Q11(브라우저 단계 대신 로컬 Supabase: 새 계정 = 익명 사용자에 테스트 이메일·비밀번호를 붙임(같은 user_id),
//   이미 있는 계정 = 시드된 테스트 계정으로 로그인 -> 진짜 /account/claim, 이메일 link-new@example.test·link-existing@example.test),
//   §17 3(`EXPO_PUBLIC_DEV_LOGIN=new` / `existing`, Maestro 흐름마다 다른 값, __DEV__가 아니면 값이 있어도 무시), §15 S5, AC-6, apps/mobile/CLAUDE.md 허용 목록.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   __DEV__ + 'new'      : [Google 계정으로 계속] -> 브라우저·linkIdentity 없이 auth.updateUser({ email: 'link-new@example.test', password })
//   __DEV__ + 'existing' : 브라우저·linkIdentity 없이 auth.signInWithPassword({ email: 'link-existing@example.test', password }) -> POST /account/claim
//   그 밖의 값('1' 등)·값 없음·__DEV__ false : 진짜 길 (linkIdentity + 앱 안 브라우저)
//   __DEV__·EXPO_PUBLIC_DEV_LOGIN은 [Google 계정으로 계속]을 누를 때 읽는다 (모듈을 불러올 때 한 번 읽고 굳히지 않는다)
//   -> 테스트는 같은 앱을 켜 두고 두 값만 바꿔 본다. 릴리스 번들에서 코드가 빠지는지는 lib 테스트(같은 줄 __DEV__ 가드)·reviewer export 확인 몫
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { memoryStorage } from '../test-support/async-storage-mock';
import { FakeServer, json } from '../test-support/fake-server';
import { authFake } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-11',
  end_date: '2026-12-11',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: [{ day_id: 'day-t1', date: '2026-12-11', state: 'planned', chosen_option_id: 'opt-1', fixed_events: [], summary: null, must_visits: [] }],
};
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;
const realFlag = process.env.EXPO_PUBLIC_DEV_LOGIN;

const settle = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};
const press = async (element: Parameters<typeof fireEvent.press>[0]) => {
  fireEvent.press(element);
  await settle();
  await settle();
};

async function pressGoogleFromMenu(Index: () => React.ReactElement) {
  const server = new FakeServer().on('GET /trips/current', json(200, TRIP)).on('POST /account/claim', json(200, { result: 'moved' }));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
  await screen.findByTestId('day-row-day-t1');
  await press(screen.getByRole('button', { name: '내 프로필' }));
  await press(await screen.findByText('저장하기'));
  await press(await screen.findByText('Google 계정으로 계속'));
  return server;
}

beforeEach(() => {
  memoryStorage.clear();
  authFake.reset();
  jest.useFakeTimers({ now: Date.parse('2026-12-02T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN;
  else process.env.EXPO_PUBLIC_DEV_LOGIN = realFlag;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('T12_S17_3_개발_빌드_new면_브라우저_없이_익명_사용자에_link_new_이메일_붙이기·같은_user_id', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  process.env.EXPO_PUBLIC_DEV_LOGIN = 'new';
  const server = await pressGoogleFromMenu(require('@/app/index').default);
  const before = (await authFake.session())?.user.id;
  await waitFor(() => expect(authFake.updateUserCalls()).toHaveLength(1));
  const [call] = authFake.updateUserCalls();
  expect(call.email).toBe('link-new@example.test');
  expect(typeof call.password === 'string' && call.password.length > 0).toBe(true);
  expect(authFake.passwordCalls()).toEqual([]);
  expect(authFake.browserCalls()).toEqual([]);
  expect(authFake.linkCalls()).toEqual([]);
  expect((await authFake.session())?.user.id).toBe(before); // 연결과 같은 결과: 같은 user_id
  expect(server.requests.filter((r) => r.path.startsWith('/account'))).toEqual([]);
});

test('T12_S17_3_개발_빌드_existing이면_link_existing으로_로그인하고_진짜_claim', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  process.env.EXPO_PUBLIC_DEV_LOGIN = 'existing';
  const server = await pressGoogleFromMenu(require('@/app/index').default);
  await waitFor(() => expect(server.sent('POST /account/claim')).toHaveLength(1));
  const [call] = authFake.passwordCalls();
  expect(call.email).toBe('link-existing@example.test');
  expect(typeof call.password === 'string' && call.password.length > 0).toBe(true);
  expect(authFake.updateUserCalls()).toEqual([]);
  expect(authFake.browserCalls()).toEqual([]);
  expect(authFake.linkCalls()).toEqual([]);
  expect(authFake.oauthCalls()).toEqual([]);
});

test.each([
  ['값_없음', true, undefined],
  ['모르는_값_1', true, '1'],
  ['모르는_값_대문자_NEW', true, 'NEW'],
  ['릴리스_new', false, 'new'],
  ['릴리스_existing', false, 'existing'],
])('T12_S17_3_S15_S5_%s면_진짜_길(linkIdentity·브라우저)', async (_name, dev, value) => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  if (value === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN;
  else process.env.EXPO_PUBLIC_DEV_LOGIN = value;
  await pressGoogleFromMenu(require('@/app/index').default);
  await waitFor(() => expect(authFake.linkCalls()).toHaveLength(1));
  expect(authFake.browserCalls()).toHaveLength(1);
  expect(authFake.updateUserCalls()).toEqual([]);
  expect(authFake.passwordCalls()).toEqual([]);
});
