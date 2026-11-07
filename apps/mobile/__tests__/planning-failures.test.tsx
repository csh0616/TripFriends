/// <reference types="jest" />
// §7 실패하면 (줄마다). 근거: TASK-004 §7, §12(Q17~Q23·Q26), §13(4·7·입력 글·저장 실패·Q36·Q37·Q40), AC-10, TASK-003 §5, §10(Q2·Q24·Q41·R5)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen, waitFor } from '@testing-library/react-native';
import { useFonts } from 'expo-font';

import { apiError, FakeServer, hang, json, networkDown, notJson, type Reply } from '../test-support/fake-server';
import {
  happyServer,
  hasStoredSession,
  noSession,
  pressId,
  pressText,
  R,
  resetDevice,
  restart,
  startApp,
  tap,
  toP1,
  toP2,
  toP3,
  toS9,
  typeAndSend,
} from '../test-support/planning-driver';
import { batch, course, day, done, packed, picks, relaxed, session, SID } from '../test-support/planning-fixtures';

const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';
const INVALID = '다시 해 볼래?';
const RESTART = '처음부터 다시 하자';
const RETRY = '다시';
const P2_MARK = 'candidate-card-D01';

beforeEach(() => {
  resetDevice();
  (useFonts as jest.Mock).mockReturnValue([true, null]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Attempt = {
  name: string;
  go: () => Promise<unknown>;
  route: string;
  prepare?: () => Promise<unknown>;
  send: () => Promise<unknown>;
  /** 실패 뒤 화면이 그대로인지 볼 표시 */
  stays: () => unknown;
  /** 다시 보낸 요청의 본문 */
  body: unknown;
  /** 복구 GET의 응답과 그 화면의 표시. 지금 화면과 달라야 GET이 화면을 정했는지 보인다 (Q21) */
  recovered: unknown;
  marker: string;
};

const onP1 = () => expect(screen.getByTestId('choice-cafe')).toBeTruthy();
const onP2 = () => expect(screen.getByTestId(P2_MARK)).toBeTruthy();
const onP3 = () => expect(screen.getByText('코스 짜 봤어')).toBeTruthy();

// 서버 요청을 보내는 앱 동작 전부 (TASK-003 §5)
const TO_P2 = batch({ message: '복구한_묶음' });
const P2_AFTER = { recovered: TO_P2, marker: '복구한_묶음' };
const P3_AFTER = { recovered: course(), marker: '코스 짜 봤어' };
const ATTEMPTS: Attempt[] = [
  { name: 'P1 칩 답', go: toP1, route: R.answer, prepare: () => pressId('choice-cafe'), send: () => pressText('이걸로 찾아 줘'), stays: onP1, body: { choice_ids: ['cafe'] }, ...P2_AFTER },
  { name: 'P1 알아서', go: toP1, route: R.answer, send: () => pressText('알아서 짜 줘'), stays: onP1, body: { auto: true }, ...P3_AFTER },
  { name: 'P1 글', go: toP1, route: R.answer, send: () => typeAndSend('조용한 데'), stays: onP1, body: { choice_ids: [], text: '조용한 데' }, ...P2_AFTER },
  { name: 'P2 담기', go: toP2, route: R.reactions, send: () => pressId('like-D01'), stays: onP2, body: { place_id: 'D01', action: 'like' }, ...P3_AFTER },
  { name: 'P2 패스', go: toP2, route: R.reactions, send: () => pressId('skip-D02'), stays: onP2, body: { place_id: 'D02', action: 'skip' }, ...P3_AFTER },
  { name: 'P2 방향', go: toP2, route: R.next, send: () => pressId('direction-closer'), stays: onP2, body: { direction_id: 'closer' }, ...P3_AFTER },
  { name: 'P2 다른 곳', go: toP2, route: R.next, send: () => pressText('다른 곳 보여 줘'), stays: onP2, body: 'none', ...P3_AFTER },
  { name: 'P2 글', go: toP2, route: R.next, send: () => typeAndSend('조용한 데'), stays: onP2, body: { text: '조용한 데' }, ...P3_AFTER },
  { name: 'P2 코스 짜기', go: toP2, route: R.compose, send: () => pressId('compose-button'), stays: onP2, body: 'none', ...P3_AFTER },
  { name: 'P3 +15', go: toP3, route: R.adjust, prepare: () => pressId('stay-D01'), send: () => pressId('stay-plus-D01'), stays: onP3, body: { option_id: 'opt-relaxed', place_id: 'D01', delta: 15 }, ...P2_AFTER },
  { name: 'P3 더 고를래', go: toP3, route: R.back, send: () => pressText('더 고를래'), stays: onP3, body: 'none', ...P2_AFTER },
  { name: 'P3 이걸로 할래', go: toP3, route: R.selectRelaxed, send: () => pressText('이걸로 할래'), stays: onP3, body: 'none', recovered: done, marker: '코스 저장했어' },
  { name: 'P3 뒤로', go: toP3, route: R.back, send: () => pressId('header-back'), stays: onP3, body: 'none', ...P2_AFTER },
];
const named = ATTEMPTS.map((attempt) => [attempt.name, attempt] as [string, Attempt]);

const expectSameBody = (actual: unknown, expected: unknown) => {
  if (expected === 'none') expect(actual === undefined || JSON.stringify(actual) === '{}').toBe(true);
  else expect(actual).toEqual(expected);
};

async function failOnce(attempt: Attempt, reply: Reply): Promise<FakeServer> {
  const server = happyServer();
  await attempt.go();
  if (attempt.prepare) await attempt.prepare();
  server.once(attempt.route, reply);
  await attempt.send();
  return server;
}

async function expectRetrySendsSame(server: FakeServer, attempt: Attempt, message: string) {
  expect(await screen.findByText(message)).toBeTruthy();
  attempt.stays();
  expect(server.sent(attempt.route)).toHaveLength(1);
  await tap(screen.getByText(RETRY));
  await waitFor(() => expect(server.sent(attempt.route)).toHaveLength(2));
  const [first, second] = server.sent(attempt.route);
  expect(second).toEqual(first);
  expectSameBody(second.body, attempt.body);
  await waitFor(() => expect(screen.queryByText(message)).toBeNull());
}

/** Q21: [다시]는 실패한 요청을 다시 보내지 않고 GET으로 지금 상태를 받아 그 화면을 보여 준다 */
async function expectRetryRecoversByGet(server: FakeServer, attempt: Attempt, message: string) {
  expect(await screen.findByText(message)).toBeTruthy();
  attempt.stays();
  server.on(R.get, json(200, attempt.recovered));
  const gets = server.sent(R.get).length;
  await tap(screen.getByText(RETRY));
  expect(await screen.findByText(attempt.marker)).toBeTruthy();
  expect(server.sent(R.get)).toHaveLength(gets + 1);
  expect(server.sent(attempt.route)).toHaveLength(1);
  expect(screen.queryByText(message)).toBeNull();
}

// ---------- 줄 1: 네트워크 끊김 ----------

describe('§7 줄 1 네트워크 끊김', () => {
  test.each(named)('Y01_Q21_%s_끊기면_문구와_다시_화면_그대로_다시는_같은_요청이_아니라_GET', async (_name, attempt) => {
    const server = await failOnce(attempt, networkDown);
    await expectRetryRecoversByGet(server, attempt, OFFLINE);
  });

  test('Y02_S7_담은_곳과_숫자가_그대로', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    server.once(R.compose, networkDown);
    await pressId('compose-button');
    await screen.findByText(OFFLINE);
    expect(screen.getByText('1곳 담았어')).toBeTruthy();
    server.once(R.reactions, json(200, picks([])));
    await tap(screen.getByTestId('like-D01'));
    await waitFor(() => expect((server.last().body as { action: string }).action).toBe('unlike'));
  });

  test('Y03_S7_P1에서_고른_칩이_그대로_글자도_이걸로_찾아_줘', async () => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    server.once(R.answer, networkDown);
    await pressText('이걸로 찾아 줘');
    await screen.findByText(OFFLINE);
    expect(screen.getByText('이걸로 찾아 줘')).toBeTruthy();
  });

  test('Y04_Q21_P3에서_보던_안이_그대로이고_다시는_select가_아니라_GET', async () => {
    const server = happyServer();
    await toP3();
    await pressId('option-packed');
    server.once(R.selectPacked, networkDown);
    await pressText('이걸로 할래');
    await screen.findByText(OFFLINE);
    expect(screen.getByText('1곳 · 이동 42분')).toBeTruthy();
    server.on(R.get, json(200, { ...done, option_id: 'opt-packed' }));
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('코스 저장했어')).toBeTruthy();
    expect(server.sent(R.selectPacked)).toHaveLength(1);
    expect(server.sent(R.get)).toHaveLength(1);
  });

  test('Y05_S7_저장된_세션을_지우지_않는다', async () => {
    await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    expect(hasStoredSession()).toBe(true);
  });

  test('Y06_Q21_GET도_끊기면_문구_그대로_다시는_또_GET_원래_요청은_한_번', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, networkDown);
    await tap(screen.getByText(RETRY));
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    onP2();
    server.on(R.get, json(200, course()));
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(2);
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('Y07_S6_Q21_다시_요청_중에도_GET은_한_번', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, hang);
    const retry = screen.getByText(RETRY);
    await tap(retry);
    await tap(retry).catch(() => undefined);
    expect(server.sent(R.get)).toHaveLength(1);
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('Y08_Q21_서버가_처리했으면_GET_응답대로_화면이_바뀐다', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.on(R.get, json(200, course()));
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('Y43_Q21_Q7_서버가_처리_못_했으면_같은_화면이고_담은_곳은_GET의_picks', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.reactions, networkDown);
    await pressId('like-D01');
    await screen.findByText(OFFLINE);
    server.on(R.get, json(200, batch({ picks: ['D02'], picks_count: 1 })));
    server.on(R.reactions, json(200, picks([])));
    await tap(screen.getByText(RETRY));
    await screen.findByText('1곳 담았어');
    await pressId('like-D02');
    await waitFor(() => expect(server.last().body).toEqual({ place_id: 'D02', action: 'unlike' }));
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  test('Y44_Q21_S7_다시_GET이_404_session이면_저장값을_지우고_S0', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, noSession);
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
  });

  test('Y45_Q21_S7_다시_GET이_500이면_500_문구_그_다시는_같은_GET', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, apiError(500, 'INTERNAL_ERROR'));
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText(OOPS)).toBeTruthy();
    onP2();
    server.on(R.get, json(200, course()));
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(2);
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  // ---------- Q19: S0 ----------

  const seedOrStart: [string, string, Reply, string][] = [
    ['시드 끊김', R.seed, networkDown, OFFLINE],
    ['시드 500', R.seed, apiError(500, 'INTERNAL_ERROR'), OOPS],
    ['세션 시작 끊김', R.start, networkDown, OFFLINE],
    ['세션 시작 500', R.start, apiError(500, 'INTERNAL_ERROR'), OOPS],
  ];

  test.each(seedOrStart)('Y09_Q19_S0_%s면_문구와_다시_S0_그대로_저장_없음_GET_없음', async (_name, route, reply, message) => {
    const server = happyServer();
    server.once(route, reply);
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText(RETRY)).toBeTruthy();
    expect(screen.getByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(server.sent(R.get)).toHaveLength(0);
  });

  test.each(seedOrStart)('Y10_Q19_S0_%s_뒤_다시는_실패한_단계만', async (_name, route, reply, message) => {
    const server = happyServer();
    server.once(route, reply);
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText(message);
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.seed)).toHaveLength(route === R.seed ? 2 : 1);
    expect(server.sent(R.start)).toHaveLength(route === R.start ? 2 : 1);
    expect(server.sent(R.start).every((r) => JSON.stringify(r.body) === JSON.stringify({ mode: 'conversation' }))).toBe(true);
    expect(hasStoredSession()).toBe(true);
    expect(screen.queryByText(message)).toBeNull();
  });

  test('Y46_Q19_S0_다시도_실패하면_또_실패한_단계만', async () => {
    const server = happyServer();
    server.once(R.start, networkDown);
    server.once(R.start, networkDown);
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText(OFFLINE);
    await tap(screen.getByText(RETRY));
    await waitFor(() => expect(server.sent(R.start)).toHaveLength(2));
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.seed)).toHaveLength(1);
    expect(server.sent(R.start)).toHaveLength(3);
  });
});

// ---------- Q19: S0 시간 초과 ----------
describe('Q19 S0 시간 초과', () => {
  const advance = (ms: number) =>
    act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });

  test.each([
    ['시드', R.seed],
    ['세션 시작', R.start],
  ])('Y47_Q19_%s_9999ms에는_아직_10000ms에_문구와_다시', async (_name, route) => {
    const server = happyServer();
    server.once(route, hang);
    await startApp();
    await screen.findByText('데모 여행 시작');
    jest.useFakeTimers();
    await pressText('데모 여행 시작');
    await advance(0);
    await advance(9999);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(1);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByText(RETRY)).toBeTruthy();
  });
});

// ---------- 줄 1: 시간 초과 10초 ----------

describe('§7 줄 1 시간 초과 10초', () => {
  async function pressThenWait(attempt: Attempt) {
    const server = happyServer();
    await attempt.go();
    if (attempt.prepare) await attempt.prepare();
    server.once(attempt.route, hang);
    jest.useFakeTimers();
    await attempt.send();
    return server;
  }

  const advance = (ms: number) =>
    act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });

  test.each([
    ['P1', ATTEMPTS[0]],
    ['P2', ATTEMPTS[8]],
    ['P3', ATTEMPTS[11]],
  ])('Y11_AC10_%s_9999ms에는_아직_10000ms에_문구와_다시', async (_name, attempt) => {
    await pressThenWait(attempt);
    await advance(9999);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    expect(screen.queryByText(RETRY)).toBeNull();
    await advance(1);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByText(RETRY)).toBeTruthy();
    attempt.stays();
  });

  test.each([
    ['P1', ATTEMPTS[0]],
    ['P2', ATTEMPTS[8]],
    ['P3', ATTEMPTS[11]],
  ])('Y48_Q21_%s_시간_초과_뒤_다시는_GET이고_원래_요청은_한_번', async (_name, attempt) => {
    const server = await pressThenWait(attempt);
    await advance(10000);
    server.on(R.get, json(200, attempt.recovered));
    await tap(screen.getByText(RETRY));
    await advance(0);
    expect(server.sent(R.get)).toHaveLength(1);
    expect(server.sent(attempt.route)).toHaveLength(1);
    expect(screen.getByText(attempt.marker)).toBeTruthy();
  });

  test('Y12_Q21_시간_초과_뒤_다시의_GET도_시계를_새로_잰다', async () => {
    const attempt = ATTEMPTS[8];
    const server = await pressThenWait(attempt);
    await advance(10000);
    server.once(R.get, hang);
    await tap(screen.getByText(RETRY));
    expect(server.sent(R.get)).toHaveLength(1);
    expect(server.sent(attempt.route)).toHaveLength(1);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(9999);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(1);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    attempt.stays();
  });

  test('Y13_S7_9999ms에_응답이_오면_시간_초과가_나지_않는다', async () => {
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.next);
    jest.useFakeTimers();
    await pressId('direction-closer');
    await advance(9999);
    await act(async () => {
      respond(json(200, batch({ message: '제때_온_응답' })));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('제때_온_응답')).toBeTruthy();
    await advance(20000);
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  test('Y14_S7_요청마다_따로_잰다_앞_요청의_시계가_뒤_요청을_끊지_않는다', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.reactions, json(200, picks(['D01'])));
    jest.useFakeTimers();
    await pressId('like-D01');
    await advance(5000);
    server.once(R.compose, hang);
    await pressId('compose-button');
    await advance(9999);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(1);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
  });

  test('Y15_S6_S7_시간_초과_뒤에는_버튼_막힘이_풀린다', async () => {
    const attempt = ATTEMPTS[8];
    const server = await pressThenWait(attempt);
    await advance(10000);
    server.on(R.next, json(200, batch({ message: '풀린_뒤_응답' })));
    await pressId('direction-closer');
    await advance(0);
    expect(server.sent(R.next)).toHaveLength(1);
  });

  test('Y16_Q20_시간_초과_뒤_늦게_온_응답은_버린다_문구와_화면_그대로', async () => {
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.next);
    jest.useFakeTimers();
    await pressId('direction-closer');
    await advance(10000);
    await act(async () => {
      respond(json(200, batch({ message: '늦은_응답' })));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('늦은_응답')).toBeNull();
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByText('서버가_준_묶음_말')).toBeTruthy();
  });

  test('Y49_Q20_늦게_온_코스_응답이_화면을_바꾸지_않는다', async () => {
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.compose);
    jest.useFakeTimers();
    await pressId('compose-button');
    await advance(10000);
    await act(async () => {
      respond(json(200, course()));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('코스 짜 봤어')).toBeNull();
    onP2();
  });
});

// ---------- 줄 2: 400 ----------

describe('§7 줄 2 400 INVALID_REQUEST', () => {
  const invalid = apiError(400, 'INVALID_REQUEST', [{ loc: ['body', 'x'], msg: '자세한_필드_오류', type: 'value' }], '서버_400_문장');

  test.each(named)('Y17_AC10_%s_400이면_다시_해_볼래만_보이고_자세한_내용과_다시_버튼_없음', async (_name, attempt) => {
    const log = [jest.spyOn(console, 'error'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'log')];
    log.forEach((spy) => spy.mockImplementation(() => undefined));
    await failOnce(attempt, invalid);
    expect(await screen.findByText(INVALID)).toBeTruthy();
    expect(screen.queryByText(/서버_400_문장|자세한_필드_오류|INVALID_REQUEST/)).toBeNull();
    expect(screen.queryByText(RETRY)).toBeNull();
    attempt.stays();
    expect(hasStoredSession()).toBe(true);
    expect(log.some((spy) => spy.mock.calls.length > 0)).toBe(true);
  });

  test('Y18_S7_400_뒤_담은_곳이_그대로이고_다음_요청은_보낼_수_있다', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    server.once(R.next, invalid);
    await pressId('direction-closer');
    await screen.findByText(INVALID);
    expect(screen.getByText('1곳 담았어')).toBeTruthy();
    await pressId('direction-closer');
    expect(await screen.findByText('서버가_준_다음_묶음_말')).toBeTruthy();
    expect(screen.queryByText(INVALID)).toBeNull();
  });
});

// ---------- 줄 3: 404 ----------

describe('§7 줄 3 404 세션 없음', () => {
  const missing = apiError(404, 'NOT_FOUND', { resource: 'session', session_id: SID });

  test.each(named)('Y19_Q21_%s_404_session이면_저장값을_지우고_S0과_처음부터_다시_하자', async (_name, attempt) => {
    const server = await failOnce(attempt, missing);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(screen.queryByText(RETRY)).toBeNull();
    expect(server.sent(attempt.route)).toHaveLength(1);
  });

  test('Y20_S7_404_뒤_앱을_다시_켜면_S0이고_GET을_부르지_않는다', async () => {
    const attempt = ATTEMPTS[8];
    const server = await failOnce(attempt, missing);
    await screen.findByText('데모 여행 시작');
    const app = { unmount: screen.unmount };
    const before = server.sent(R.get).length;
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(before);
  });

  test('Y21_S7_404_뒤_데모_여행_시작으로_새로_시작할_수_있다', async () => {
    const server = await failOnce(ATTEMPTS[8], missing);
    await pressText('데모 여행 시작');
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
    expect(server.sent(R.start).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(RESTART)).toBeNull();
  });

  test.each<[string, Attempt, string]>([
    ['P3 조정의 옛 코스안', ATTEMPTS[9], 'option'],
    ['P3 고르기의 옛 코스안', ATTEMPTS[11], 'option'],
    ['P2 코스 짜기에서 없는 경로', ATTEMPTS[8], 'route'],
    ['P3 더 고를래에서 없는 경로', ATTEMPTS[10], 'route'],
    ['P1 답에서 day', ATTEMPTS[0], 'day'],
  ])('Y22_Q21_Q22_%s_404_resource가_session이_아니면_저장값_유지_GET으로_복구_안내_없음', async (_name, attempt, resource) => {
    const server = happyServer();
    await attempt.go();
    if (attempt.prepare) await attempt.prepare();
    server.on(R.get, json(200, attempt.recovered));
    server.once(attempt.route, apiError(404, 'NOT_FOUND', { resource }));
    const gets = server.sent(R.get).length;
    await attempt.send();
    expect(await screen.findByText(attempt.marker)).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(gets + 1);
    expect(server.sent(attempt.route)).toHaveLength(1);
    expect(hasStoredSession()).toBe(true);
    for (const text of [RESTART, RETRY, OFFLINE, OOPS, INVALID]) expect(screen.queryByText(text)).toBeNull();
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
  });

  test('Y50_Q21_옛_코스안_404_복구로_받은_새_ID로_고른다', async () => {
    const server = happyServer();
    await toP3();
    server.once(R.selectRelaxed, apiError(404, 'NOT_FOUND', { resource: 'option' }));
    server.on(R.get, json(200, course([relaxed('new-relaxed')])));
    server.on('POST /course-options/new-relaxed/select', json(200, { ...done }));
    await pressText('이걸로 할래');
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('이걸로 할래')).toBeTruthy());
    await pressText('이걸로 할래');
    expect(await screen.findByText('코스 저장했어')).toBeTruthy();
    expect(server.sent('POST /course-options/new-relaxed/select')).toHaveLength(1);
  });

  test('Y51_Q21_404_복구_GET이_404_session이면_S0', async () => {
    const server = happyServer();
    await toP3();
    server.once(R.adjust, apiError(404, 'NOT_FOUND', { resource: 'option' }));
    server.once(R.get, noSession);
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
  });
});

// ---------- 줄 4: 409 ----------

describe('§7 줄 4 409 STATE_CONFLICT', () => {
  const conflict = apiError(409, 'STATE_CONFLICT', { stage: 'x' });
  const CASES: [string, Attempt, unknown, string][] = [
    ['P1 답 뒤 서버는 browsing', ATTEMPTS[0], batch({ message: '서버_기준_P2' }), '서버_기준_P2'],
    ['P1 답 뒤 서버는 composing', ATTEMPTS[0], course(), '코스 짜 봤어'],
    ['P2 코스 짜기 뒤 서버는 composing', ATTEMPTS[8], course(), '코스 짜 봤어'],
    ['P2 코스 짜기 뒤 서버는 done', ATTEMPTS[8], done, '코스 저장했어'],
    ['P2 담기 뒤 서버는 asking', ATTEMPTS[3], session, '서버가_준_첫_질문'],
    ['P3 조정 뒤 서버는 browsing', ATTEMPTS[9], batch({ message: '서버_기준_P2' }), '서버_기준_P2'],
    ['P3 고르기 뒤 서버는 done', ATTEMPTS[11], done, '코스 저장했어'],
    ['P3 더 고를래 뒤 서버는 done', ATTEMPTS[10], done, '코스 저장했어'],
  ];

  test.each(CASES)('Y23_AC10_%s_GET으로_다시_받아_그_화면으로', async (_name, attempt, response, marker) => {
    const server = happyServer();
    await attempt.go();
    if (attempt.prepare) await attempt.prepare();
    server.on(R.get, json(200, response));
    server.once(attempt.route, conflict);
    const before = server.sent(R.get).length;
    await attempt.send();
    expect(await screen.findByText(marker)).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(before + 1);
    expect(server.sent(attempt.route)).toHaveLength(1); // 실패한 요청을 저절로 다시 보내지 않는다
    expect(hasStoredSession()).toBe(true);
  });

  test('Y24_S7_같은_stage가_와도_화면을_서버_값으로_바꾼다', async () => {
    const server = happyServer();
    await toP2();
    server.on(R.get, json(200, batch({ message: '서버의_지금_묶음', picks_count: 4 })));
    server.once(R.compose, conflict);
    await pressId('compose-button');
    expect(await screen.findByText('서버의_지금_묶음')).toBeTruthy();
    expect(screen.getByText('4곳 담았어')).toBeTruthy();
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('Y25_S7_복구_GET이_404면_404_줄대로_S0', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.compose, conflict);
    server.once(R.get, noSession); // Q21 A7
    await pressId('compose-button');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
  });

  test('Y26_Q22_같은_stage로_복구한_뒤_안내와_다시_버튼이_없다', async () => {
    const server = happyServer();
    await toP2();
    server.on(R.get, json(200, batch()));
    server.once(R.compose, conflict);
    await pressId('compose-button');
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    await act(async () => undefined);
    for (const text of [RETRY, OFFLINE, OOPS, INVALID, RESTART]) expect(screen.queryByText(text)).toBeNull();
    onP2();
  });

  test('Y27_Q21_복구_GET이_끊기면_문구와_다시_다시는_GET_원래_요청은_한_번', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.compose, conflict);
    server.once(R.get, networkDown);
    server.on(R.get, json(200, course()));
    await pressId('compose-button');
    await screen.findByText(OFFLINE);
    await tap(screen.getByText(RETRY));
    await screen.findByText('코스 짜 봤어');
    expect(server.sent(R.compose)).toHaveLength(1);
    expect(server.sent(R.get)).toHaveLength(2);
  });
});

// ---------- 줄 5: 422 ----------

describe('§7 줄 5 422 COURSE_INFEASIBLE', () => {
  const infeasible = (reason: string, blocking: string[] = ['D20']) =>
    apiError(422, 'COURSE_INFEASIBLE', { reason, blocking, suggest_drop: [] });
  const compose = ATTEMPTS[8];
  const adjust = ATTEMPTS[9];
  const auto = ATTEMPTS[1];

  const CASES: [string, Attempt, string, string][] = [
    ['P2 코스 짜기', compose, 'must_visit_closed', '꼭 갈 박물관, 그날 쉬어'],
    ['P2 코스 짜기', compose, 'must_visit_overflow', '꼭 갈 곳이 하루에 다 안 들어가'],
    ['P2 코스 짜기', compose, 'user_stay_conflict', '그 시간은 안 맞아'],
    ['P3 조정', adjust, 'must_visit_closed', '꼭 갈 박물관, 그날 쉬어'],
    ['P3 조정', adjust, 'must_visit_overflow', '꼭 갈 곳이 하루에 다 안 들어가'],
    ['P3 조정', adjust, 'user_stay_conflict', '그 시간은 안 맞아'],
    ['P1 알아서', auto, 'must_visit_closed', '꼭 갈 박물관, 그날 쉬어'],
    ['P1 알아서', auto, 'must_visit_overflow', '꼭 갈 곳이 하루에 다 안 들어가'],
  ];

  test.each(CASES)('Y28_Q23_%s_이유_%s면_그_문구이고_화면_그대로_다시_버튼_없음', async (_screen, attempt, reason, message) => {
    await failOnce(attempt, infeasible(reason));
    expect(await screen.findByText(message)).toBeTruthy();
    attempt.stays();
    expect(screen.queryByText(RETRY)).toBeNull();
    expect(screen.queryByText('서버_내부_오류_문장')).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });

  test('Y29_S7_P2_422_뒤_담은_곳이_그대로', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    server.once(R.compose, infeasible('must_visit_overflow'));
    await pressId('compose-button');
    await screen.findByText('꼭 갈 곳이 하루에 다 안 들어가');
    expect(screen.getByText('1곳 담았어')).toBeTruthy();
    onP2();
  });

  test('Y30_S7_P3_422_뒤_보던_안과_머문_시간이_그대로_다음_조정은_같은_ID', async () => {
    const server = happyServer();
    await toP3();
    await pressId('option-packed');
    await pressId('stay-D01');
    server.once(R.adjust, infeasible('user_stay_conflict'));
    await pressId('stay-plus-D01');
    await screen.findByText('그 시간은 안 맞아');
    expect(screen.getByText('1곳 · 이동 42분')).toBeTruthy();
    expect(screen.getByText('45분')).toBeTruthy();
    await pressId('stay-minus-D01');
    await waitFor(() => expect(server.sent(R.adjust)).toHaveLength(2));
    expect(server.last().body).toEqual({ option_id: 'opt-packed', place_id: 'D01', delta: -15 });
  });

  test('Y31_Q2_P1_알아서_422_뒤_대화로_이어_갈_수_있다', async () => {
    const server = happyServer();
    await toP1();
    server.once(R.answer, infeasible('must_visit_closed'));
    await pressText('알아서 짜 줘');
    await screen.findByText('꼭 갈 박물관, 그날 쉬어');
    await pressText('아무거나 찾아 줘');
    expect(await screen.findByTestId(P2_MARK)).toBeTruthy();
    expect(server.sent(R.answer).map((r) => r.body)).toEqual([{ auto: true }, { choice_ids: [] }]);
  });

  test('Y31b_S7_P1_알아서_422_뒤_고른_칩이_그대로', async () => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    server.once(R.answer, infeasible('must_visit_overflow'));
    await pressText('알아서 짜 줘');
    await screen.findByText('꼭 갈 곳이 하루에 다 안 들어가');
    expect(screen.getByText('이걸로 찾아 줘')).toBeTruthy();
    await pressText('이걸로 찾아 줘');
    await waitFor(() => expect(server.sent(R.answer)).toHaveLength(2));
    expect(server.last().body).toEqual({ choice_ids: ['cafe'] });
  });

  test('Y32_Q23_이름은_blocking_ID를_지금_day_must_visits에서_찾는다', async () => {
    const server = happyServer();
    const must_visits = [
      { place_id: 'D20', name: '꼭 갈 박물관', stay_min: 60 },
      { place_id: 'D21', name: '둘째 꼭 갈 곳', stay_min: 60 },
    ];
    server.on(R.answer, json(200, batch({ day: { ...day, must_visits } })));
    await toP2();
    server.once(R.compose, infeasible('must_visit_closed', ['D21']));
    await pressId('compose-button');
    expect(await screen.findByText('둘째 꼭 갈 곳, 그날 쉬어')).toBeTruthy();
    expect(screen.queryByText('꼭 갈 박물관, 그날 쉬어')).toBeNull();
  });
});

// ---------- §13-3 #4: 422 문구 표 ----------

describe('§13-3 #4 422 이유 문구', () => {
  const infeasible = (reason: string) => apiError(422, 'COURSE_INFEASIBLE', { reason, blocking: ['F1'], suggest_drop: [] });
  const SCREENS: [string, Attempt][] = [
    ['P2 코스 짜기', ATTEMPTS[8]],
    ['P3 조정', ATTEMPTS[9]],
    ['P1 알아서', ATTEMPTS[1]],
  ];
  const CASES: [string, string, string, Attempt][] = SCREENS.flatMap(([name, attempt]) => [
    [name, 'fixed_unreachable', '고정 일정에 제때 못 가', attempt] as [string, string, string, Attempt],
    [name, '표에_없는_이유', '이대로는 코스를 못 짜겠어', attempt] as [string, string, string, Attempt],
  ]);

  test.each(CASES)('Y52_S13_4_%s_이유_%s면_%s_화면_그대로_다시_없음', async (_screen, reason, message, attempt) => {
    await failOnce(attempt, infeasible(reason));
    expect(await screen.findByText(message)).toBeTruthy();
    attempt.stays();
    expect(screen.queryByText(RETRY)).toBeNull();
    expect(screen.queryByText(/그날 쉬어/)).toBeNull();
    expect(screen.queryByText('서버_내부_오류_문장')).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });
});

// ---------- §13-2 #7: 이상한 담기 응답 (Q18) ----------

describe('§13-2 #7 이상한 담기 응답은 500 줄처럼', () => {
  const like = ATTEMPTS[3];
  const WEIRD: [string, unknown][] = [
    ['빈 객체', {}],
    ['picks만', { picks: ['D01'] }],
    ['숫자만', { picks_count: 1 }],
    ['picks가 글', { picks: 'D01', picks_count: 1 }],
    ['숫자가 글', { picks: ['D01'], picks_count: '1' }],
    ['null', null],
    ['배열', []],
    ['모르는 stage', { ...picks(['D01']), stage: 'somewhere' }],
  ];

  test.each(WEIRD)('Y54_S13_7_Q18_%s면_문구와_다시_화면_숫자_저장값_그대로_다시는_같은_요청', async (_name, body) => {
    const server = await failOnce(like, json(200, body));
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.getByText('0곳 담았어')).toBeTruthy();
    expect(hasStoredSession()).toBe(true);
    await expectRetrySendsSame(server, like, OOPS);
    expect(server.sent(R.get)).toHaveLength(0);
  });

  test.each(WEIRD)('Y55_S13_7_%s_뒤_버튼이_풀려서_다음_요청을_보낼_수_있다', async (_name, body) => {
    const server = await failOnce(like, json(200, body));
    await screen.findByText(OOPS);
    expect(screen.getByTestId('compose-button').props.accessibilityState?.disabled).not.toBe(true);
    await pressId('compose-button');
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('Y56_S13_7_정상_담기_응답은_문구가_없다', async () => {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(screen.queryByText(OOPS)).toBeNull();
  });
});

// ---------- §13-3 입력 글 ----------

describe('§13-3 입력 글', () => {
  const TEXT = '조용한 데';
  const typed = () => screen.getByTestId('input-text').props.value;
  const P1_TEXT = ATTEMPTS[2];
  const P2_TEXT = ATTEMPTS[7];
  const invalid = apiError(400, 'INVALID_REQUEST');
  const CASES: [string, Attempt, Reply, string][] = [
    ['P1 끊김', P1_TEXT, networkDown, OFFLINE],
    ['P1 500', P1_TEXT, apiError(500, 'INTERNAL_ERROR'), OOPS],
    ['P1 400', P1_TEXT, invalid, INVALID],
    ['P2 끊김', P2_TEXT, networkDown, OFFLINE],
    ['P2 500', P2_TEXT, apiError(500, 'INTERNAL_ERROR'), OOPS],
    ['P2 400', P2_TEXT, invalid, INVALID],
  ];

  test.each(CASES)('Y57_S13_%s면_입력_글을_되돌려_놓는다', async (_name, attempt, reply, message) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await failOnce(attempt, reply);
    await screen.findByText(message);
    expect(typed()).toBe(TEXT);
  });

  test('Y58_S13_시간_초과여도_입력_글을_되돌려_놓는다', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.next, hang);
    jest.useFakeTimers();
    await typeAndSend(TEXT);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(typed()).toBe(TEXT);
  });

  test('Y59_S13_성공하면_지운다_같은_화면에_남아도', async () => {
    happyServer();
    await toP2();
    await typeAndSend(TEXT);
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(typed()).toBe('');
  });

  test('Y60_S13_500_뒤_다시가_성공하면_지운다', async () => {
    const server = await failOnce(P2_TEXT, apiError(500, 'INTERNAL_ERROR'));
    await screen.findByText(OOPS);
    expect(typed()).toBe(TEXT);
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next)).toHaveLength(2);
    expect(typed()).toBe('');
  });

  test('Y61_S13_되돌린_글을_다시_보내서_성공하면_지운다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = await failOnce(P2_TEXT, invalid);
    await screen.findByText(INVALID);
    expect(typed()).toBe(TEXT);
    await typeAndSend(TEXT);
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next).map((r) => r.body)).toEqual([{ text: TEXT }, { text: TEXT }]);
    expect(typed()).toBe('');
  });
});

// ---------- §13-3 저장 실패, §7 마지막 줄 ----------

describe('§13-3 기기 저장 실패', () => {
  function storageFails() {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('기기 저장 실패'));
    return jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  }

  test('Y62_S13_저장이_실패해도_P1로_가고_콘솔_경고', async () => {
    const warn = storageFails();
    happyServer();
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    for (const text of [OFFLINE, OOPS, INVALID]) expect(screen.queryByText(text)).toBeNull();
  });

  test('Y63_S13_저장이_실패해도_같은_세션으로_흐름이_이어진다', async () => {
    storageFails();
    const server = happyServer();
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    await pressText('아무거나 찾아 줘');
    expect(await screen.findByTestId(P2_MARK)).toBeTruthy();
    expect(server.sent(R.answer)).toHaveLength(1);
    await pressId('compose-button');
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
  });

  test('Y64_S13_S7_저장이_실패했으면_다시_켜면_S0이고_GET_없음', async () => {
    storageFails();
    const server = happyServer();
    const app = await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(0);
  });

  test('Y65_S13_저장이_성공하면_경고가_없다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    happyServer();
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    expect(warn).not.toHaveBeenCalled();
    expect(hasStoredSession()).toBe(true);
  });
});

// ---------- 점검 추가: 기기 읽기·지우기 실패 (§7 기기 저장 실패 줄) ----------

describe('§7 기기 읽기·지우기 실패', () => {
  const quiet = () => jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const removeFails = () => jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('기기 지우기 실패'));

  test('Y72_S7_읽기가_실패하면_로딩에_멈추지_않고_S0_GET_없음_콘솔_경고_1건', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('기기 읽기 실패'));
    const warn = quiet();
    const server = happyServer();
    await startApp();
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.queryByTestId('app-loading')).toBeNull();
    expect(server.sent(R.get)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('Y73_S7_읽기가_실패해도_시작_버튼이_동작한다', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('기기 읽기 실패'));
    quiet();
    happyServer();
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
  });

  test('Y74_S7_B2_지우기가_실패해도_S9_처음부터는_S0으로_간다_콘솔_경고', async () => {
    const warn = quiet();
    happyServer();
    await toS9();
    removeFails();
    await pressText('처음부터');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  test('Y75_S7_다시_켠_GET이_404_session이면_지우기가_실패해도_S0과_처음부터_다시_하자_콘솔_경고', async () => {
    const warn = quiet();
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, noSession);
    removeFails();
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  test('Y76_S7_요청의_404_session이면_지우기가_실패해도_S0과_처음부터_다시_하자_콘솔_경고', async () => {
    const warn = quiet();
    const server = happyServer();
    await toP2();
    server.once(R.compose, noSession);
    removeFails();
    await pressId('compose-button');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });
});

// ---------- 점검 추가: 시드가 200 + JSON null (Q18·Q37) ----------

describe('Q18 Q37 시드 응답이 이상할 때', () => {
  /** 처리되지 않은 예외를 모은다. 테스트 안의 process는 복사본이라 진짜 process에 건다. */
  function watchUnhandled() {
    const real = require('node:vm').runInThisContext('process');
    const seen: unknown[] = [];
    const listener = (reason: unknown) => seen.push(reason);
    real.on('unhandledRejection', listener);
    return {
      async settled() {
        await new Promise((done) => setTimeout(done, 20));
        real.off('unhandledRejection', listener);
        return seen;
      },
    };
  }

  const nullSeed = async () => {
    const server = happyServer();
    server.once(R.seed, json(200, null));
    await startApp();
    await pressText('데모 여행 시작');
    return server;
  };

  test('Y77_Q18_Q37_시드가_200_null이면_500_줄처럼_문구와_다시_세션_시작_안_함', async () => {
    const server = await nullSeed();
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.getByText(RETRY)).toBeTruthy();
    expect(server.sent(R.start)).toHaveLength(0);
    expect(hasStoredSession()).toBe(false);
  });

  test('Y78_Q18_Q37_시드가_200_null이어도_처리되지_않은_예외가_없다', async () => {
    const watch = watchUnhandled();
    await nullSeed();
    expect(await watch.settled()).toEqual([]);
  });

  test('Y79_Q18_Q37_시드가_200_null인_뒤_시작_버튼이_풀려_다시_시작할_수_있다', async () => {
    const server = await nullSeed();
    await screen.findByText(OOPS);
    await pressText('데모 여행 시작');
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
    expect(server.sent(R.seed)).toHaveLength(2);
  });

  test('Y80_Q18_Q37_시드가_200_null인_뒤_다시는_시드부터', async () => {
    const server = await nullSeed();
    await screen.findByText(OOPS);
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
    expect(server.sent(R.seed)).toHaveLength(2);
    expect(server.sent(R.start)).toHaveLength(1);
  });
});

// ---------- §13-3 Q36·Q37·Q40: 승인된 결정 고정 ----------

describe('§13-3 승인된 결정 고정', () => {
  test.each<[string, Reply]>([
    ['404 route', apiError(404, 'NOT_FOUND', { resource: 'route' })],
    ['409', apiError(409, 'STATE_CONFLICT', { stage: 'x' })],
  ])('Y66_Q36_Q37_다시_켜는_GET_자신이_%s면_500_줄처럼_S0으로_안_보내고_다시는_GET', async (_name, reply) => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, reply);
    await restart(app);
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
    expect(hasStoredSession()).toBe(true);
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.get)).toHaveLength(2);
  });

  test('Y67_Q37_복구_GET_자신이_409면_500_줄처럼_원래_요청은_한_번', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.compose, apiError(409, 'STATE_CONFLICT', { stage: 'x' }));
    server.once(R.get, apiError(409, 'STATE_CONFLICT', { stage: 'x' }));
    server.on(R.get, json(200, course()));
    await pressId('compose-button');
    expect(await screen.findByText(OOPS)).toBeTruthy();
    await tap(screen.getByText(RETRY));
    await screen.findByText('코스 짜 봤어');
    expect(server.sent(R.compose)).toHaveLength(1);
    expect(server.sent(R.get)).toHaveLength(2);
  });

  test('Y68_Q37_S0_세션_시작의_404_day는_500_줄처럼_다시는_세션만', async () => {
    const server = happyServer();
    server.once(R.start, apiError(404, 'NOT_FOUND', { resource: 'day' }));
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText(OOPS)).toBeTruthy();
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.seed)).toHaveLength(1);
    expect(server.sent(R.start)).toHaveLength(2);
  });

  test('Y69_Q40_422_이름이_여럿이면_쉼표로_잇는다', async () => {
    const server = happyServer();
    const must_visits = [
      { place_id: 'D20', name: '꼭 갈 박물관', stay_min: 60 },
      { place_id: 'D21', name: '둘째 꼭 갈 곳', stay_min: 60 },
    ];
    server.on(R.answer, json(200, batch({ day: { ...day, must_visits } })));
    await toP2();
    server.once(
      R.compose,
      apiError(422, 'COURSE_INFEASIBLE', { reason: 'must_visit_closed', blocking: ['D20', 'D21'], suggest_drop: [] }),
    );
    await pressId('compose-button');
    expect(await screen.findByText('꼭 갈 박물관, 둘째 꼭 갈 곳, 그날 쉬어')).toBeTruthy();
  });

  const RECOVERIES: [string, Reply, boolean][] = [
    ['끊김 뒤 다시', networkDown, true],
    ['409 복구', apiError(409, 'STATE_CONFLICT', { stage: 'x' }), false],
  ];

  test.each(RECOVERIES)('Y70_Q38_%s로_P1에_돌아오면_고른_칩이_유지된다', async (_name, reply, pressRetry) => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    server.on(R.get, json(200, session));
    server.once(R.answer, reply);
    await pressText('이걸로 찾아 줘');
    if (pressRetry) await pressText(RETRY);
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    expect(await screen.findByText('이걸로 찾아 줘')).toBeTruthy();
    await pressText('이걸로 찾아 줘');
    await waitFor(() => expect(server.sent(R.answer)).toHaveLength(2));
    expect(server.last().body).toEqual({ choice_ids: ['cafe'] });
  });

  test.each(RECOVERIES)('Y71_Q38_%s로_P3에_돌아오면_보던_코스_안이_유지된다', async (_name, reply, pressRetry) => {
    const server = happyServer();
    await toP3();
    await pressId('option-packed');
    server.on(R.get, json(200, course()));
    server.once(R.selectPacked, reply);
    await pressText('이걸로 할래');
    if (pressRetry) await pressText(RETRY);
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    expect(await screen.findByText('1곳 · 이동 42분')).toBeTruthy();
    await pressText('이걸로 할래');
    await waitFor(() => expect(server.sent(R.selectPacked)).toHaveLength(2));
    expect(server.sent(R.selectRelaxed)).toHaveLength(0);
  });
});

// ---------- 줄 6: 500 ----------

describe('§7 줄 6 500 INTERNAL_ERROR', () => {
  const boom = apiError(500, 'INTERNAL_ERROR');

  test.each(named)('Y33_AC10_S7_%s_500이면_문구와_다시_화면_그대로_다시는_같은_요청_GET_아님', async (_name, attempt) => {
    const server = await failOnce(attempt, boom);
    await expectRetrySendsSame(server, attempt, OOPS);
    expect(server.sent(R.get)).toHaveLength(0);
    expect(hasStoredSession()).toBe(true);
  });

  test('Y34_S7_500_뒤_담은_곳이_그대로', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    server.once(R.next, boom);
    await pressId('direction-closer');
    await screen.findByText(OOPS);
    expect(screen.getByText('1곳 담았어')).toBeTruthy();
    onP2();
  });

  test('Y35_S7_서버_오류_글자를_그대로_보여_주지_않는다', async () => {
    await failOnce(ATTEMPTS[8], boom);
    await screen.findByText(OOPS);
    expect(screen.queryByText('서버_내부_오류_문장')).toBeNull();
  });

  test('Y36_S7_500이_다시_나면_문구가_그대로', async () => {
    const server = await failOnce(ATTEMPTS[8], boom);
    await screen.findByText(OOPS);
    server.once(R.compose, boom);
    await tap(screen.getByText(RETRY));
    await waitFor(() => expect(server.sent(R.compose)).toHaveLength(2));
    expect(await screen.findByText(OOPS)).toBeTruthy();
  });

  test('Y37_Q21_끊김_뒤_다시의_GET이_500이면_문구가_500으로_바뀐다', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, boom);
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  test.each<[string, Reply]>([
    ['503', json(503, { detail: 'x' })],
    ['401', apiError(401, 'INVALID_REQUEST')],
    ['403', apiError(403, 'INVALID_REQUEST')],
    ['JSON이 아닌 200', notJson(200)],
    ['JSON이 아닌 500', notJson(500)],
    ['JSON이 아닌 503', notJson(503)],
  ])('Y38_Q18_%s도_500_줄과_같다_문구_다시_같은_요청_화면_저장값_그대로', async (_name, reply) => {
    const server = await failOnce(ATTEMPTS[8], reply);
    await expectRetrySendsSame(server, ATTEMPTS[8], OOPS);
    expect(server.sent(R.get)).toHaveLength(0);
    expect(hasStoredSession()).toBe(true);
  });
});

// ---------- 줄 7: 요청 중에 꺼짐 ----------

describe('§7 줄 7 앱이 요청 중에 꺼짐', () => {
  test.each<[string, unknown, string]>([
    ['서버가 처리 못 함: browsing', batch({ message: '서버_그대로' }), '서버_그대로'],
    ['서버가 처리함: composing', course([relaxed(), packed()]), '코스 짜 봤어'],
  ])('Y39_AC10_%s_다시_켜면_GET_결과대로', async (_name, response, marker) => {
    const server = happyServer();
    const app = await toP2();
    server.once(R.compose, { kind: 'hang' });
    await pressId('compose-button');
    await waitFor(() => expect(server.sent(R.compose)).toHaveLength(1));
    server.on(R.get, json(200, response));
    await restart(app);
    expect(await screen.findByText(marker)).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(1);
    expect(server.sent(R.compose)).toHaveLength(1); // 끊긴 요청을 저절로 다시 보내지 않는다
  });

  test('Y40_S7_세션을_받기_전에_꺼지면_다시_켜도_S0', async () => {
    const server = happyServer();
    server.once(R.start, { kind: 'hang' });
    const app = await startApp();
    await pressText('데모 여행 시작');
    await waitFor(() => expect(server.sent(R.start)).toHaveLength(1));
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(0);
  });
});

// ---------- 줄 8: 글꼴 ----------

describe('§7 줄 8 글꼴 로드 실패', () => {
  test('Y41_AC10_글꼴을_못_읽어도_S0이_뜨고_글꼴_읽기를_시도했다', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('글꼴 실패')]);
    happyServer();
    await startApp();
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(useFonts).toHaveBeenCalled();
  });

  test('Y42_AC10_글꼴을_못_읽어도_흐름이_막히지_않는다', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('글꼴 실패')]);
    happyServer();
    await toP2();
    expect(screen.getByTestId(P2_MARK)).toBeTruthy();
  });
});
