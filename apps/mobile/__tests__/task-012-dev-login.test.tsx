/// <reference types="jest" />
// TASK-012 §16 Q11 개발용 가짜 로그인 공급자 (AC-6 Maestro account-link 용). 로직만 본다.
// 근거: TASK-012 §16 Q11("__DEV__ 그리고 EXPO_PUBLIC_DEV_LOGIN=1일 때만. 브라우저 단계 대신 로컬 Supabase에서: 새 계정 = 익명 사용자에
//   테스트 이메일·비밀번호를 붙임(같은 user_id) · 이미 있는 계정 = 시드된 테스트 계정으로 로그인 -> 진짜 /account/claim"), §15 S5, AC-6.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   켜졌을 때 [Google 계정으로 계속]은 브라우저·linkIdentity를 쓰지 않고 supabase auth.updateUser({ email: 'link-new@example.test', password })
//     또는 auth.signInWithPassword({ email: 'link-existing@example.test', password }) 를 부른다 (둘 중 무엇을 고르는지는 질문)
//   꺼졌을 때(EXPO_PUBLIC_DEV_LOGIN 없음, 또는 릴리스 __DEV__ = false) = 진짜 길 (linkIdentity + 앱 안 브라우저)
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
const EMAILS = ['link-new@example.test', 'link-existing@example.test'];
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

test('T12_S16_Q11_개발_빌드에서_EXPO_PUBLIC_DEV_LOGIN_1이면_브라우저_없이_로컬_테스트_계정', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  process.env.EXPO_PUBLIC_DEV_LOGIN = '1';
  const Index = require('@/app/index').default;
  await pressGoogleFromMenu(Index);
  await waitFor(() => expect(authFake.updateUserCalls().length + authFake.passwordCalls().length).toBeGreaterThan(0));
  expect(authFake.browserCalls()).toEqual([]);
  expect(authFake.linkCalls()).toEqual([]);
  const used = [...authFake.updateUserCalls(), ...authFake.passwordCalls()];
  expect(used.every((call) => EMAILS.includes(call.email) && typeof call.password === 'string' && call.password.length > 0)).toBe(true);
  // 새 계정 길이면 같은 user_id (연결과 같은 결과), 이미 있는 계정 길이면 진짜 /account/claim
  for (const call of authFake.updateUserCalls()) expect(call.email).toBe('link-new@example.test');
  for (const call of authFake.passwordCalls()) expect(call.email).toBe('link-existing@example.test');
});

test('T12_S16_Q11_EXPO_PUBLIC_DEV_LOGIN이_없으면_진짜_길(linkIdentity·브라우저)', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  delete process.env.EXPO_PUBLIC_DEV_LOGIN;
  await pressGoogleFromMenu(require('@/app/index').default);
  await waitFor(() => expect(authFake.linkCalls()).toHaveLength(1));
  expect(authFake.updateUserCalls()).toEqual([]);
  expect(authFake.passwordCalls()).toEqual([]);
});

test('T12_S16_Q11_S15_S5_릴리스(__DEV___false)면_EXPO_PUBLIC_DEV_LOGIN_1이어도_진짜_길', async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_PUBLIC_DEV_LOGIN = '1';
  await pressGoogleFromMenu(require('@/app/index').default);
  await waitFor(() => expect(authFake.linkCalls()).toHaveLength(1));
  expect(authFake.updateUserCalls()).toEqual([]);
  expect(authFake.passwordCalls()).toEqual([]);
});
