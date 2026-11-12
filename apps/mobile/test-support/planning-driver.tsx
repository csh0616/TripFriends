// 흐름 테스트 공용 도구: 앱을 켜고, 가짜 서버 기본 경로를 깔고, 화면까지 데려간다. 판단 로직은 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PlanningFlow from '@/planning/planning-flow';

import { memoryStorage } from './async-storage-mock';
import { secureStore } from './secure-store-mock';
import { apiError, FakeServer, json, type Reply } from './fake-server';
import { authFake } from './supabase-mock';
import { batch, course, picks, seed, selected, session, SID } from './planning-fixtures';

export const R = {
  seed: 'POST /debug/seed-demo',
  start: 'POST /days/day-2/planning',
  get: `GET /planning/${SID}`,
  answer: `POST /planning/${SID}/answer`,
  reactions: `POST /planning/${SID}/reactions`,
  next: `POST /planning/${SID}/next`,
  compose: `POST /planning/${SID}/compose`,
  adjust: `POST /planning/${SID}/adjust`,
  back: `POST /planning/${SID}/back`,
  selectRelaxed: 'POST /course-options/opt-relaxed/select',
  selectPacked: 'POST /course-options/opt-packed/select',
};

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function happyServer(): FakeServer {
  return new FakeServer()
    .on(R.seed, json(201, seed))
    .on(R.start, json(201, session))
    .on(R.get, json(200, session))
    .on(R.answer, json(200, batch()))
    .on(R.reactions, json(200, picks([])))
    .on(R.next, json(200, batch({ round: 2, message: '서버가_준_다음_묶음_말' })))
    .on(R.compose, json(200, course()))
    .on(R.adjust, json(200, course()))
    .on(R.back, json(200, batch({ round: 3 })))
    .on(R.selectRelaxed, json(200, selected))
    .on(R.selectPacked, json(200, { ...selected, option_id: 'opt-packed' }));
}

/** 이 경로에서 세션이 없다는 404 (Q21 A7) */
export const noSession: Reply = apiError(404, 'NOT_FOUND', { resource: 'session' });

export function startApp() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PlanningFlow />
    </SafeAreaProvider>,
  );
}

const realSetImmediate = setImmediate; // 가짜 타이머를 켜도 진짜 순서를 넘길 수 있게 불러올 때 잡아 둔다

/**
 * 이벤트를 보내고 화면 갱신까지만 기다린다. fireEvent는 앱의 눌림 함수가 돌려준 약속까지 기다리므로,
 * 앱이 `async` 함수를 쓰고 서버 응답이 오지 않는 시험에서 테스트가 멈춘다. 그래서 응답은 기다리지 않는다.
 */
async function settle(fired: Promise<unknown>) {
  let failure: unknown;
  fired.catch((error) => {
    failure = error;
  });
  await new Promise<void>((done) => realSetImmediate(() => done()));
  await act(async () => {
    await new Promise<void>((done) => realSetImmediate(() => done()));
  });
  if (failure) throw failure;
}

export const tap = (element: Parameters<typeof fireEvent.press>[0]) => settle(fireEvent.press(element));
export const pressText = async (text: string | RegExp) => tap(await screen.findByText(text));
export const pressId = async (id: string) => tap(await screen.findByTestId(id));

export async function typeAndSend(value: string) {
  const input = await screen.findByTestId('input-text');
  await fireEvent.changeText(input, value);
  await settle(fireEvent(input, 'submitEditing'));
}

export async function toP1() {
  const app = await startApp();
  await pressText('데모 여행 시작');
  await screen.findByTestId('choice-walk_alley');
  return app;
}

export async function toP2() {
  const app = await toP1();
  await pressText('아무거나 찾아 줘');
  await screen.findByTestId('candidate-card-D01');
  return app;
}

export async function toP3() {
  const app = await toP2();
  await pressId('compose-button');
  await screen.findByText('코스 짜 봤어');
  return app;
}

export async function toS9() {
  const app = await toP3();
  await pressText('이걸로 할래');
  await screen.findByText('코스 저장했어');
  return app;
}

export const storedValues = () => memoryStorage.values();
// TASK-012: 기기를 비우면 로그인 세션도 없다 (세션은 기기 저장소에, B1). §18: 보관한 익명 세션(SecureStore)도 비운다
export const resetDevice = () => {
  memoryStorage.clear();
  secureStore.clear();
  authFake.reset();
};
export const hasStoredSession = () => storedValues().some((value) => value.includes(SID));

/** 앱을 껐다 켠다. 기기 저장소는 그대로. */
export async function restart(app: { unmount: () => Promise<void> }) {
  await app.unmount();
  return startApp();
}

export const expectNoBody = (body: unknown) => expect(body === undefined || JSON.stringify(body) === '{}').toBe(true);
