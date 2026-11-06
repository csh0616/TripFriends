/// <reference types="jest" />
// §6 규칙이 겹칠 때 (줄마다). 근거: TASK-004 §6, AC-11, §B-4, §12(Q16·Q18), §13-3(끝 카드)
import { screen, waitFor, within } from '@testing-library/react-native';

import { json } from '../test-support/fake-server';
import {
  happyServer,
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
import { batch, course, done, packed, picks, relaxed, session } from '../test-support/planning-fixtures';

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- 줄 1: 서버 message와 앱 고정 문구 ----------

describe('§6 줄 1 서버 문구가 이긴다', () => {
  test('X01_S6_P1_말풍선은_서버_글자_그대로', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText('서버가_준_첫_질문')).toBeTruthy();
    expect(screen.queryByText(/어떤 하루면 좋겠어/)).toBeNull();
  });

  test('X02_S6_P2_말풍선은_서버_글자_그대로', async () => {
    happyServer();
    await toP2();
    expect(screen.getByText('서버가_준_묶음_말')).toBeTruthy();
    expect(screen.queryByText(/이런 곳들 어때/)).toBeNull();
  });

  test('X03_S6_P2_새_응답마다_서버_글자로_바뀐다', async () => {
    happyServer();
    await toP2();
    await pressId('direction-closer');
    expect(await screen.findByText('서버가_준_다음_묶음_말')).toBeTruthy();
    expect(screen.queryByText('서버가_준_묶음_말')).toBeNull();
  });

  // §13-3 끝 카드로 기대값 변경: 끝 카드 글은 서버 message가 아니라 앱 고정 "코스 짜 볼까?", 서버 message는 말풍선
  test('X04_S13_exhausted_끝_카드는_코스_짜_볼까_서버_message는_말풍선에만', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ exhausted: true, message: '서버가_준_소진_문장' })));
    await toP2();
    const end = within(screen.getByTestId('end-card'));
    expect(end.getByText('코스 짜 볼까?')).toBeTruthy();
    expect(end.queryByText('서버가_준_소진_문장')).toBeNull();
    expect(screen.getAllByText('서버가_준_소진_문장')).toHaveLength(1);
    expect(screen.queryByText('다른 곳도 볼래?')).toBeNull();
  });

  test('X05_S6_exhausted가_아닐_때만_끝_카드에_앱_문구', async () => {
    happyServer();
    await toP2();
    expect(within(screen.getByTestId('end-card')).getByText('다른 곳도 볼래?')).toBeTruthy();
  });
});

// ---------- §13-3 끝 카드: 되묻기와 겹쳐도 같은 규칙 ----------

describe('§13-3 끝 카드 글', () => {
  const clarify = [{ id: 'food' as const, label: '먹을 데' }];

  test('X29_S13_소진과_되묻기가_겹치면_끝_카드는_코스_짜_볼까_말풍선은_서버_글', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ exhausted: true, clarify, message: '이 중에 있어?' })));
    await toP2();
    expect(within(screen.getByTestId('end-card')).getByText('코스 짜 볼까?')).toBeTruthy();
    expect(screen.getAllByText('이 중에 있어?')).toHaveLength(1);
    expect(screen.queryByText('다른 곳도 볼래?')).toBeNull();
  });

  test('X30_S13_되묻기여도_소진이_아니면_끝_카드는_다른_곳도_볼래', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ exhausted: false, clarify, message: '이 중에 있어?' })));
    await toP2();
    const end = within(screen.getByTestId('end-card'));
    expect(end.getByText('다른 곳도 볼래?')).toBeTruthy();
    expect(end.queryByText('코스 짜 볼까?')).toBeNull();
    expect(screen.getAllByText('이 중에 있어?')).toHaveLength(1);
  });

  test('X31_S13_실제_소진_문장도_화면에_한_번만', async () => {
    const message = '더 보여 줄 곳이 거의 없어. 이제 코스 짜 볼까?'; // TASK-003 §6 소진 문장
    const server = happyServer();
    server.on(R.answer, json(200, batch({ exhausted: true, message })));
    await toP2();
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getAllByText('코스 짜 볼까?')).toHaveLength(1);
  });

  test('X32_S13_다시_켠_GET의_소진_묶음도_같은_규칙', async () => {
    const server = happyServer();
    const app = await toP2();
    server.on(R.get, json(200, batch({ exhausted: true, message: '다시_받은_소진' })));
    await restart(app);
    expect(await screen.findByText('다시_받은_소진')).toBeTruthy();
    expect(within(screen.getByTestId('end-card')).getByText('코스 짜 볼까?')).toBeTruthy();
    expect(screen.getAllByText('다시_받은_소진')).toHaveLength(1);
  });

  test('X33_S13_빈_묶음이어도_소진이_아니면_다른_곳도_볼래', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ candidates: [], exhausted: false, message: '서버_빈_묶음' })));
    await toP2Empty();
    const end = within(screen.getByTestId('end-card'));
    expect(end.getByText('다른 곳도 볼래?')).toBeTruthy();
    expect(screen.getAllByText('서버_빈_묶음')).toHaveLength(1);
  });

  async function toP2Empty() {
    await toP1();
    await pressText('아무거나 찾아 줘');
    await screen.findByTestId('end-card');
  }
});

// ---------- 줄 2: clarify와 directions ----------

describe('§6 줄 2 clarify가 있으면 그 칩만', () => {
  const clarify = [
    { id: 'food' as const, label: '먹을 데' },
    { id: 'night' as const, label: '밤에 갈 데' },
  ];
  const clarifying = batch({
    message: '이 중에 있어?',
    clarify,
    directions: [{ id: 'quieter', label: '좀 더 한적한 데' }],
  });

  test('X06_S6_clarify_칩만_보이고_directions는_숨는다', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, clarifying));
    await toP2();
    expect(screen.getByTestId('clarify-food')).toBeTruthy();
    expect(screen.getByTestId('clarify-night')).toBeTruthy();
    expect(screen.queryByTestId('direction-quieter')).toBeNull();
    expect(screen.queryByText('좀 더 한적한 데')).toBeNull();
  });

  test('X07_B4_clarify_칩을_누르면_next_direction_id', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, clarifying));
    await toP2();
    await pressId('clarify-night');
    await waitFor(() => expect(server.sent(R.next)).toHaveLength(1));
    expect(server.sent(R.next)[0].body).toEqual({ direction_id: 'night' });
  });

  test('X08_S6_clarify가_null이면_directions_칩', async () => {
    happyServer();
    await toP2();
    expect(screen.getByTestId('direction-quieter')).toBeTruthy();
    expect(screen.queryAllByTestId(/^clarify-/)).toHaveLength(0);
  });

  test('X09_S6_되묻기_뒤_새_묶음이_오면_directions로_돌아간다', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, clarifying));
    await toP2();
    await pressId('clarify-food');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(screen.queryAllByTestId(/^clarify-/)).toHaveLength(0);
    expect(screen.getByTestId('direction-quieter')).toBeTruthy();
  });

  test('X10_S6_되묻기_응답을_받으면_칩이_clarify로_바뀌고_카드는_그대로', async () => {
    const server = happyServer();
    server.on(R.next, json(200, clarifying));
    await toP2();
    await typeAndSend('그냥 아무거나');
    expect(await screen.findByTestId('clarify-food')).toBeTruthy();
    expect(screen.queryByTestId('direction-quieter')).toBeNull();
    expect(screen.getByTestId('candidate-card-D01')).toBeTruthy();
  });
});

// ---------- 줄 3: exhausted와 끝 카드 ----------

describe('§6 줄 3 exhausted', () => {
  const exhausted = batch({ exhausted: true, message: '서버가_준_소진_문장' });

  async function toExhausted() {
    const server = happyServer();
    server.on(R.answer, json(200, exhausted));
    await toP2();
    return server;
  }

  test('X11_S6_다른_곳_보여_줘가_사라지고_끝_카드에_코스_짜기', async () => {
    await toExhausted();
    expect(screen.queryByText('다른 곳 보여 줘')).toBeNull();
    expect(within(screen.getByTestId('end-card')).getByText('코스 짜기')).toBeTruthy();
  });

  test('X12_S6_끝_카드의_코스_짜기는_compose', async () => {
    const server = await toExhausted();
    await tap(within(screen.getByTestId('end-card')).getByText('코스 짜기'));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.compose)).toHaveLength(1);
  });

  test('X13_S6_next는_여전히_가능_방향_칩', async () => {
    const server = await toExhausted();
    await pressId('direction-quieter');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next)[0].body).toEqual({ direction_id: 'quieter' });
  });

  test('X14_S6_next는_여전히_가능_입력창_글', async () => {
    const server = await toExhausted();
    await typeAndSend('조용한 데');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next)[0].body).toEqual({ text: '조용한 데' });
  });

  test('X15_S6_떠_있는_줄의_코스_짜기도_그대로', async () => {
    await toExhausted();
    expect(screen.getByTestId('compose-button')).toBeTruthy();
  });

  test('X16_S6_exhausted가_아니면_끝_카드에_코스_짜기를_강조하지_않는다', async () => {
    happyServer();
    await toP2();
    const end = within(screen.getByTestId('end-card'));
    expect(end.getByText('다른 곳 보여 줘')).toBeTruthy();
    expect(end.queryByText('코스 짜기')).toBeNull();
  });
});

// ---------- 줄 4: 연타 ----------

describe('§6 줄 4 요청 중이면 그 화면의 서버 요청 버튼을 모두 막는다', () => {
  type Act = [string, () => Promise<unknown>];

  const P1_ACTS: Act[] = [
    ['이걸로 찾아 줘', () => pressText('아무거나 찾아 줘')],
    ['알아서 짜 줘', () => pressText('알아서 짜 줘')],
    ['입력창 글', () => typeAndSend('조용한 데')],
  ];
  const P2_ACTS: Act[] = [
    ['담기', () => pressId('like-D01')],
    ['패스', () => pressId('skip-D02')],
    ['방향 칩', () => pressId('direction-closer')],
    ['다른 곳 보여 줘', () => pressText('다른 곳 보여 줘')],
    ['코스 짜기', () => pressId('compose-button')],
    ['입력창 글', () => typeAndSend('조용한 데')],
  ];
  const P3_ACTS: Act[] = [
    ['+15', () => pressId('stay-plus-D01')],
    ['-15', () => pressId('stay-minus-D01')],
    ['더 고를래', () => pressText('더 고를래')],
    ['뒤로', () => pressId('header-back')],
    ['이걸로 할래', () => pressText('이걸로 할래')],
  ];

  /** 첫 동작을 누른 뒤 응답을 잡아 두고, 그 화면의 모든 요청 동작을 다시 눌러도 요청이 늘지 않는다 */
  async function runBlocked(go: () => Promise<unknown>, acts: Act[], first: Act, prepare?: () => Promise<unknown>) {
    const server = happyServer();
    await go();
    if (prepare) await prepare();
    for (const route of [R.answer, R.reactions, R.next, R.compose, R.adjust, R.back, R.selectRelaxed]) {
      server.once(route, { kind: 'hang' });
    }
    const before = server.requests.length;
    await first[1]();
    await waitFor(() => expect(server.requests).toHaveLength(before + 1));
    for (const act of acts) {
      await act[1]().catch(() => undefined);
    }
    expect(server.requests).toHaveLength(before + 1);
  }

  test.each(P1_ACTS)('X17_S6_P1_%s_요청_중에는_P1의_모든_요청_버튼이_막힌다', async (name, act) => {
    await runBlocked(toP1, P1_ACTS, [name, act]);
  });

  test.each(P2_ACTS)('X18_S6_P2_%s_요청_중에는_P2의_모든_요청_버튼이_막힌다', async (name, act) => {
    await runBlocked(toP2, P2_ACTS, [name, act]);
  });

  test.each(P3_ACTS)('X19_S6_P3_%s_요청_중에는_P3의_모든_요청_버튼이_막힌다', async (name, act) => {
    await runBlocked(toP3, P3_ACTS, [name, act], () => pressId('stay-D01'));
  });

  test('X20_S6_S0_데모_여행_시작_연타는_한_번만', async () => {
    const server = happyServer();
    server.once(R.seed, { kind: 'hang' });
    await startApp();
    await pressText('데모 여행 시작');
    await waitFor(() => expect(server.requests).toHaveLength(1));
    await pressText('데모 여행 시작').catch(() => undefined);
    expect(server.sent(R.seed)).toHaveLength(1);
  });

  test('X21_S6_S0_둘째_단계_요청_중에도_막힌다', async () => {
    const server = happyServer();
    server.once(R.start, { kind: 'hang' });
    await startApp();
    await pressText('데모 여행 시작');
    await waitFor(() => expect(server.sent(R.start)).toHaveLength(1));
    await pressText('데모 여행 시작').catch(() => undefined);
    expect(server.sent(R.seed)).toHaveLength(1);
    expect(server.sent(R.start)).toHaveLength(1);
  });

  test('X22_S6_응답이_오면_다시_누를_수_있다', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    server.once(R.reactions, json(200, picks(['D01', 'D02'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    await pressId('like-D02');
    expect(await screen.findByText('2곳 담았어')).toBeTruthy();
  });

  test('X23_S6_같은_카드_담기_연타도_한_번만', async () => {
    const server = happyServer();
    const respond = server.defer(R.reactions);
    await toP2();
    await pressId('like-D01');
    await pressId('like-D01');
    await pressId('like-D01');
    expect(server.sent(R.reactions)).toHaveLength(1);
    respond(json(200, picks(['D01'])));
    await screen.findByText('1곳 담았어');
    expect(server.sent(R.reactions)).toHaveLength(1);
  });

  test('X24_B3_S6_요청_중에도_SOS는_누를_수_있다', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.compose, { kind: 'hang' });
    await pressId('compose-button');
    await pressId('sos-button');
    expect(await screen.findByText('긴급 도움은 준비 중이야')).toBeTruthy();
  });

  test('X25_S6_요청_중에도_서버를_안_부르는_P3_토글은_막지_않아도_요청이_늘지_않는다', async () => {
    const server = happyServer();
    await toP3();
    server.once(R.back, { kind: 'hang' });
    await pressText('더 고를래');
    const before = server.requests.length;
    await pressId('option-packed').catch(() => undefined);
    expect(server.requests).toHaveLength(before);
  });
});

// ---------- 줄 5: 응답 stage와 지금 화면 ----------

describe('§6 줄 5 응답 stage가 이긴다', () => {
  const browsing = batch({ message: '서버는_browsing' });
  const composing = course();
  const P1 = '서버가_준_첫_질문';
  const P2 = '서버는_browsing';
  const P3 = '코스 짜 봤어';
  const S9 = '코스 저장했어';

  type Case = [string, () => Promise<unknown>, string, () => Promise<unknown>, unknown, string];
  const CASES: Case[] = [
    ['P1 답 응답이 composing', toP1, R.answer, () => pressText('아무거나 찾아 줘'), composing, P3],
    ['P1 답 응답이 done', toP1, R.answer, () => pressText('아무거나 찾아 줘'), done, S9],
    ['P1 알아서 응답이 browsing', toP1, R.answer, () => pressText('알아서 짜 줘'), browsing, P2],
    ['P2 next 응답이 composing', toP2, R.next, () => pressId('direction-closer'), composing, P3],
    ['P2 next 응답이 asking', toP2, R.next, () => pressId('direction-closer'), session, P1],
    ['P2 compose 응답이 browsing', toP2, R.compose, () => pressId('compose-button'), browsing, P2],
    ['P3 back 응답이 composing', toP3, R.back, () => pressText('더 고를래'), composing, P3],
    ['P3 back 응답이 done', toP3, R.back, () => pressText('더 고를래'), done, S9],
    ['P3 adjust 응답이 browsing', toP3, R.adjust, async () => { await pressId('stay-D01'); await pressId('stay-plus-D01'); }, browsing, P2],
  ];

  test.each(CASES)('X26_S6_%s면_그_화면으로', async (_name, go, route, act, response, marker) => {
    const server = happyServer();
    await go();
    server.on(route, json(200, response));
    await act();
    expect(await screen.findByText(marker)).toBeTruthy();
  });

  test('X27_S6_B2_응답을_받기_전에는_앱이_혼자_화면을_바꾸지_않는다', async () => {
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.compose);
    await pressId('compose-button');
    expect(screen.queryByText(P3)).toBeNull();
    expect(screen.getByTestId('candidate-card-D01')).toBeTruthy();
    respond(json(200, course([relaxed(), packed()])));
    expect(await screen.findByText(P3)).toBeTruthy();
  });

  test('X28_Q18_모르는_stage면_500_줄처럼_문구와_다시_화면_그대로_다시는_같은_요청', async () => {
    const server = happyServer();
    await toP2();
    server.once(R.next, json(200, { ...batch(), stage: 'somewhere' }));
    await pressId('direction-closer');
    expect(await screen.findByText('잠깐 문제가 생겼어')).toBeTruthy();
    expect(screen.getByTestId('candidate-card-D01')).toBeTruthy();
    await pressText('다시');
    await screen.findByText('서버가_준_다음_묶음_말');
    const [first, second] = server.sent(R.next);
    expect(second).toEqual(first);
    expect(server.sent(R.get)).toHaveLength(0);
  });
});
