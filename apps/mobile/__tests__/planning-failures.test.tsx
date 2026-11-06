/// <reference types="jest" />
// §7 실패하면 (줄마다). 근거: TASK-004 §7, AC-10, TASK-003 §5, §10(Q2·Q24·Q41·R5)
import { act, screen, waitFor } from '@testing-library/react-native';
import { useFonts } from 'expo-font';

import { apiError, FakeServer, json, networkDown, type Reply } from '../test-support/fake-server';
import {
  happyServer,
  hasStoredSession,
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
};

const onP1 = () => expect(screen.getByTestId('choice-cafe')).toBeTruthy();
const onP2 = () => expect(screen.getByTestId(P2_MARK)).toBeTruthy();
const onP3 = () => expect(screen.getByText('코스 짜 봤어')).toBeTruthy();

// 서버 요청을 보내는 앱 동작 전부 (TASK-003 §5)
const ATTEMPTS: Attempt[] = [
  { name: 'P1 칩 답', go: toP1, route: R.answer, prepare: () => pressId('choice-cafe'), send: () => pressText('이걸로 찾아 줘'), stays: onP1, body: { choice_ids: ['cafe'] } },
  { name: 'P1 알아서', go: toP1, route: R.answer, send: () => pressText('알아서 짜 줘'), stays: onP1, body: { auto: true } },
  { name: 'P1 글', go: toP1, route: R.answer, send: () => typeAndSend('조용한 데'), stays: onP1, body: { choice_ids: [], text: '조용한 데' } },
  { name: 'P2 담기', go: toP2, route: R.reactions, send: () => pressId('like-D01'), stays: onP2, body: { place_id: 'D01', action: 'like' } },
  { name: 'P2 패스', go: toP2, route: R.reactions, send: () => pressId('skip-D02'), stays: onP2, body: { place_id: 'D02', action: 'skip' } },
  { name: 'P2 방향', go: toP2, route: R.next, send: () => pressId('direction-closer'), stays: onP2, body: { direction_id: 'closer' } },
  { name: 'P2 다른 곳', go: toP2, route: R.next, send: () => pressText('다른 곳 보여 줘'), stays: onP2, body: 'none' },
  { name: 'P2 글', go: toP2, route: R.next, send: () => typeAndSend('조용한 데'), stays: onP2, body: { text: '조용한 데' } },
  { name: 'P2 코스 짜기', go: toP2, route: R.compose, send: () => pressId('compose-button'), stays: onP2, body: 'none' },
  { name: 'P3 +15', go: toP3, route: R.adjust, prepare: () => pressId('stay-D01'), send: () => pressId('stay-plus-D01'), stays: onP3, body: { option_id: 'opt-relaxed', place_id: 'D01', delta: 15 } },
  { name: 'P3 더 고를래', go: toP3, route: R.back, send: () => pressText('더 고를래'), stays: onP3, body: 'none' },
  { name: 'P3 이걸로 할래', go: toP3, route: R.selectRelaxed, send: () => pressText('이걸로 할래'), stays: onP3, body: 'none' },
];
const named = ATTEMPTS.map((attempt) => [attempt.name, attempt] as [string, Attempt]);

const expectSameBody = (actual: unknown, expected: unknown) => {
  if (expected === 'none') expect(actual === undefined || JSON.stringify(actual) === '{}').toBe(true);
  else expect(actual).toEqual(expected);
};

async function failOnce(attempt: Attempt, reply: Reply): Promise<FakeServer> {
  const server = happyServer();
  server.on(R.get, json(200, done));
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

// ---------- 줄 1: 네트워크 끊김 ----------

describe('§7 줄 1 네트워크 끊김', () => {
  test.each(named)('Y01_AC10_%s_끊기면_문구와_다시_화면_그대로_다시는_같은_요청', async (_name, attempt) => {
    const server = await failOnce(attempt, networkDown);
    await expectRetrySendsSame(server, attempt, OFFLINE);
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

  test('Y04_S7_P3에서_보던_안이_그대로', async () => {
    const server = happyServer();
    await toP3();
    await pressId('option-packed');
    server.once(R.selectPacked, networkDown);
    await pressText('이걸로 할래');
    await screen.findByText(OFFLINE);
    expect(screen.getByText('1곳 · 이동 42분')).toBeTruthy();
    server.on(R.get, json(200, { ...done, option_id: 'opt-packed' }));
    await tap(screen.getByText(RETRY));
    await waitFor(() => expect(server.sent(R.selectPacked)).toHaveLength(2));
  });

  test('Y05_S7_저장된_세션을_지우지_않는다', async () => {
    await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    expect(hasStoredSession()).toBe(true);
  });

  test('Y06_S7_다시를_눌러도_또_끊기면_다시_문구_그대로', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.compose, networkDown);
    await tap(screen.getByText(RETRY));
    await waitFor(() => expect(server.sent(R.compose)).toHaveLength(2));
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    onP2();
  });

  test('Y07_S6_S7_다시_요청_중에도_한_번만', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.compose, { kind: 'hang' });
    const retry = screen.getByText(RETRY);
    await tap(retry);
    await tap(retry).catch(() => undefined);
    expect(server.sent(R.compose)).toHaveLength(2);
  });

  test('Y08_S7_다시가_성공하면_응답대로_화면이_바뀐다', async () => {
    await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
  });

  test.skip('Y09_질문대기_Q19_S0_시드_실패_뒤_다시', async () => {
    const server = happyServer();
    server.once(R.seed, networkDown);
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText(OFFLINE)).toBeTruthy();
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
  });

  test.skip('Y10_질문대기_Q19_S0_세션_시작만_실패하면_시드를_다시_하지_않는다', async () => {
    const server = happyServer();
    server.once(R.start, networkDown);
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText(OFFLINE);
    await tap(screen.getByText(RETRY));
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.seed)).toHaveLength(1);
  });
});

// ---------- 줄 1: 시간 초과 10초 ----------

describe('§7 줄 1 시간 초과 10초', () => {
  async function pressThenWait(attempt: Attempt) {
    const server = happyServer();
    server.on(R.get, json(200, done));
    await attempt.go();
    if (attempt.prepare) await attempt.prepare();
    server.once(attempt.route, { kind: 'hang' });
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

  test('Y12_S7_시간_초과_뒤_다시는_같은_요청이고_시계를_새로_잰다', async () => {
    const attempt = ATTEMPTS[8];
    const server = await pressThenWait(attempt);
    await advance(10000);
    server.once(attempt.route, { kind: 'hang' });
    await tap(screen.getByText(RETRY));
    expect(server.sent(attempt.route)).toHaveLength(2);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(9999);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    await advance(1);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
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
    server.once(R.compose, { kind: 'hang' });
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

  test.skip('Y16_질문대기_Q20_시간_초과_뒤_늦게_온_응답은_버린다', async () => {
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
  const missing = apiError(404, 'NOT_FOUND', { session_id: SID });
  // P3의 adjust·select 404는 옛 코스안일 수도 있어 질문 대기 (Q21)
  const sessionRoutes = named.filter(([, attempt]) => attempt.route !== R.adjust && attempt.route !== R.selectRelaxed);

  test.each(sessionRoutes)('Y19_AC10_%s_404면_저장값을_지우고_S0과_처음부터_다시_하자', async (_name, attempt) => {
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

  test.skip.each([
    ['adjust', ATTEMPTS[9]],
    ['select', ATTEMPTS[11]],
  ])('Y22_질문대기_Q21_%s_404가_옛_코스안이면_세션을_지우지_않고_GET으로_복구', async (_name, attempt) => {
    const server = await failOnce(attempt, apiError(404, 'NOT_FOUND', { option_id: 'opt-relaxed' }));
    server.on(R.get, json(200, course()));
    await waitFor(() => expect(server.sent(R.get).length).toBeGreaterThan(0));
    expect(hasStoredSession()).toBe(true);
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
    server.once(R.get, apiError(404, 'NOT_FOUND'));
    await pressId('compose-button');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.getByText(RESTART)).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
  });

  test.skip('Y26_질문대기_Q22_같은_stage로_복구한_뒤_다시_버튼이나_안내를_보여_주는가', async () => {
    const server = happyServer();
    await toP2();
    server.on(R.get, json(200, batch()));
    server.once(R.compose, conflict);
    await pressId('compose-button');
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(1));
    expect(screen.getByText(RETRY)).toBeTruthy();
  });

  test.skip('Y27_질문대기_Q22_복구_GET이_끊기면_다시는_GET을_보낸다', async () => {
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
  });
});

// ---------- 줄 5: 422 ----------

describe('§7 줄 5 422 COURSE_INFEASIBLE', () => {
  const infeasible = (reason: string, blocking: string[] = ['D20']) =>
    apiError(422, 'COURSE_INFEASIBLE', { reason, blocking, suggest_drop: [] });
  const compose = ATTEMPTS[8];
  const adjust = ATTEMPTS[9];
  const auto = ATTEMPTS[1];

  const CASES: [string, Attempt, string, RegExp][] = [
    ['P2 코스 짜기', compose, 'must_visit_closed', /이 그날 쉬어/],
    ['P2 코스 짜기', compose, 'must_visit_overflow', /^꼭 갈 곳이 하루에 다 안 들어가$/],
    ['P2 코스 짜기', compose, 'user_stay_conflict', /^그 시간은 안 맞아$/],
    ['P3 조정', adjust, 'must_visit_closed', /이 그날 쉬어/],
    ['P3 조정', adjust, 'must_visit_overflow', /^꼭 갈 곳이 하루에 다 안 들어가$/],
    ['P3 조정', adjust, 'user_stay_conflict', /^그 시간은 안 맞아$/],
    ['P1 알아서', auto, 'must_visit_closed', /이 그날 쉬어/],
    ['P1 알아서', auto, 'must_visit_overflow', /^꼭 갈 곳이 하루에 다 안 들어가$/],
  ];

  test.each(CASES)('Y28_AC10_%s_이유_%s면_그_문구이고_화면_그대로_다시_버튼_없음', async (_screen, attempt, reason, message) => {
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
    await screen.findByText(/이 그날 쉬어/);
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

  test.skip('Y32_질문대기_Q23_이름은_blocking_ID를_day_must_visits에서_찾는다', async () => {
    await failOnce(compose, infeasible('must_visit_closed'));
    expect(await screen.findByText(`${day.must_visits[0].name}이 그날 쉬어`)).toBeTruthy();
  });
});

// ---------- 줄 6: 500 ----------

describe('§7 줄 6 500 INTERNAL_ERROR', () => {
  const boom = apiError(500, 'INTERNAL_ERROR');

  test.each(named)('Y33_AC10_%s_500이면_문구와_다시_화면_그대로_다시는_같은_요청', async (_name, attempt) => {
    const server = await failOnce(attempt, boom);
    await expectRetrySendsSame(server, attempt, OOPS);
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

  test('Y37_S7_끊김_뒤_다시가_500이면_문구가_500으로_바뀐다', async () => {
    const server = await failOnce(ATTEMPTS[8], networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.compose, boom);
    await tap(screen.getByText(RETRY));
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  test.skip('Y38_질문대기_Q18_표에_없는_상태_코드_503_또는_JSON이_아닌_응답', async () => {
    await failOnce(ATTEMPTS[8], json(503, 'Service Unavailable'));
    expect(await screen.findByText(OOPS)).toBeTruthy();
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
