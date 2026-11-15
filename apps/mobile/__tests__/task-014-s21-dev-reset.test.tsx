/// <reference types="jest" />
// TASK-014 §21 "Maestro account-link가 매번 로컬 DB reset을 요구하는 문제": 고정 테스트 계정(link-new@example.test)이 남아서다
//   -> 로컬 개발 환경에서만 그 계정을 지우고 시작한다 (개발 전용, 클라우드엔 닿지 않게).
// 근거: TASK-014 §21, TASK-012 §16 Q11·§17 3(가짜 로그인 공급자 new/existing, __DEV__가 아니면 무시), TASK-012 §11 Q1(토큰 없이 열린 길은 health·catalog뿐)
//
// 계약 (이 테스트가 정한 방법, 승인 대기 — 질문 4):
//   __DEV__ + EXPO_PUBLIC_DEV_LOGIN=new 로 [Google 계정으로 계속]을 누르면, updateUser 직전에 서버 POST /debug/reset-test-account 한 번
//     (앱의 익명 Bearer 토큰을 싣고, 본문에 이메일 없음). 서버가 DATABASE_URL이 로컬일 때만 지우고 204 (서버 테스트 test_task014_s21_reset_account.py)
//   204가 아니거나 서버에 못 붙으면 updateUser를 부르지 않고 기존 실패 한 줄 "연결하지 못했어. 지금 여행은 그대로야"
//   existing·값 없음·릴리스(__DEV__ false)면 이 요청을 보내지 않는다
//   Maestro account-link.yaml은 바꾸지 않는다 (흐름 안 [Google 계정으로 계속] 단계에서 앱이 부른다)
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { memoryStorage } from '../test-support/async-storage-mock';
import { apiError, FakeServer, json, networkDown, type Reply } from '../test-support/fake-server';
import { authFake } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const RESET = 'POST /debug/reset-test-account';
const FAILED = '연결하지 못했어. 지금 여행은 그대로야'; // TASK-012 §9 9
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
  await fireEvent.press(element);
  await settle();
  await settle();
};

/** reset 요청이 왔을 때 updateUser가 이미 불렸는지 적어 둔다 (순서 확인) */
let updatesAtReset: number[] = [];

async function pressGoogle(reset: Reply = json(204, null)) {
  updatesAtReset = [];
  const server = new FakeServer()
    .on('GET /trips/current', json(200, TRIP))
    .on('POST /account/claim', json(200, { result: 'moved' }))
    .match(RESET, () => {
      updatesAtReset.push(authFake.updateUserCalls().length);
      return reset;
    });
  const Index: () => React.ReactElement = require('@/app/index').default;
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

function mode(dev: boolean, value: string | undefined) {
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  if (value === undefined) delete process.env.EXPO_PUBLIC_DEV_LOGIN;
  else process.env.EXPO_PUBLIC_DEV_LOGIN = value;
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

describe('§21 개발 new: 연결 직전에 로컬 테스트 계정을 지워 달라고 한다', () => {
  test('T14_S21_4_new면_초기화를_한_번_부르고_그_뒤에_updateUser', async () => {
    mode(true, 'new');
    const server = await pressGoogle();
    await waitFor(() => expect(authFake.updateUserCalls()).toHaveLength(1));
    expect(server.sent(RESET)).toHaveLength(1);
    expect(updatesAtReset).toEqual([0]); // 초기화가 먼저
    expect(authFake.updateUserCalls()[0].email).toBe('link-new@example.test'); // 그 뒤는 기존 T12 길 그대로
  });

  test('T14_S21_4_초기화_요청은_앱의_Bearer를_싣고_본문에_이메일이_없다', async () => {
    mode(true, 'new');
    const server = await pressGoogle();
    await waitFor(() => expect(server.sent(RESET)).toHaveLength(1));
    const [sent] = server.sent(RESET);
    expect(server.headers(sent).authorization ?? '').toMatch(/^Bearer \S+/);
    expect(JSON.stringify(sent.body ?? {})).not.toMatch(/@/);
  });

  test.each([
    ['로컬 DB가 아니라 404', apiError(404, 'NOT_FOUND', { resource: 'route' })],
    ['서버 오류 500', apiError(500, 'INTERNAL_ERROR')],
    ['서버에 못 붙음', networkDown],
  ])('T14_S21_4_경계_초기화가_%s이면_updateUser를_부르지_않고_실패_한_줄', async (_name, reply) => {
    mode(true, 'new');
    const server = await pressGoogle(reply);
    await waitFor(() => expect(server.sent(RESET)).toHaveLength(1));
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(authFake.updateUserCalls()).toEqual([]);
  });
});

describe('§21 경계 new가 아니면 초기화를 부르지 않는다', () => {
  test.each([
    ['개발_existing', true, 'existing'],
    ['개발_값_없음', true, undefined],
    ['릴리스_new', false, 'new'],
  ])('T14_S21_4_%s면_초기화_요청_0', async (_name, dev, value) => {
    mode(dev, value);
    const server = await pressGoogle();
    await settle();
    await waitFor(() => expect(authFake.passwordCalls().length + authFake.linkCalls().length).toBeGreaterThan(0)); // 시험 자체 확인: 다른 길로 갔다
    expect(server.sent(RESET)).toEqual([]);
  });
});
