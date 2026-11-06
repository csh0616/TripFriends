/// <reference types="jest" />
// 화면 흐름. 근거: TASK-004 §B-2, §B-4, AC-7·AC-8·AC-9·AC-12, TASK-003 §5·§6, §10(Q4·R6·R7)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen, waitFor, within } from '@testing-library/react-native';

import { json } from '../test-support/fake-server';
import {
  expectNoBody,
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
  toS9,
  typeAndSend,
} from '../test-support/planning-driver';
import { batch, course, day, done, packed, picks, relaxed, seed, selected, session, SID } from '../test-support/planning-fixtures';
import { REPO_ROOT } from '../test-support/source-files';

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- AC-7: 한 바퀴 ----------

describe('AC-7 S0에서 S9까지', () => {
  test('W01_AC7_한_바퀴의_요청_순서와_본문이_계약과_같다', async () => {
    const server = happyServer();
    server.on(R.get, json(200, done));
    server.on(R.reactions, json(200, picks(['D01'])));
    await startApp();
    expect(server.requests).toEqual([]);

    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    await pressId('choice-cafe');
    await pressText('이걸로 찾아 줘');
    await screen.findByText('서버가_준_묶음_말');
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    await pressId('compose-button');
    await screen.findByText('코스 짜 봤어');
    await pressText('이걸로 할래');
    await screen.findByText('코스 저장했어');

    const posts = server.requests.filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.path)).toEqual([
      '/debug/seed-demo',
      '/days/day-2/planning',
      `/planning/${SID}/answer`,
      `/planning/${SID}/reactions`,
      `/planning/${SID}/compose`,
      '/course-options/opt-relaxed/select',
    ]);
    expectNoBody(posts[0].body);
    expect(posts[1].body).toEqual({ mode: 'conversation' });
    expect(posts[2].body).toEqual({ choice_ids: ['cafe'] });
    expect(posts[3].body).toEqual({ place_id: 'D01', action: 'like' });
    expectNoBody(posts[4].body);
    expectNoBody(posts[5].body);
    expect(server.unexpected).toEqual([]);
  });

  test('W02_B2_처음_켜면_S0이고_서버를_부르지_않는다', async () => {
    const server = happyServer();
    await startApp();
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.requests).toEqual([]);
  });

  test('W03_B2_둘째_날_day_id로_대화_세션을_시작하고_세션_ID를_저장한다', async () => {
    const server = happyServer();
    server.on(R.seed, json(201, { ...seed, day_ids: ['첫째', 'day-2', '셋째'] }));
    await toP1();
    expect(server.sent(R.start)).toHaveLength(1);
    expect(hasStoredSession()).toBe(true);
  });

  test('W04_B2_S9의_처음부터를_누르면_저장값을_지우고_S0_서버_요청_없음', async () => {
    const server = happyServer();
    await toS9(server);
    const before = server.requests.length;
    await pressText('처음부터');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(server.requests).toHaveLength(before);
  });

  test('W05_B2_처음부터_뒤_앱을_다시_켜도_S0', async () => {
    const server = happyServer();
    const app = await toS9(server);
    await pressText('처음부터');
    await screen.findByText('데모 여행 시작');
    const before = server.requests.length;
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.requests).toHaveLength(before);
  });
});

// ---------- P1 ----------

describe('P1 첫 질문', () => {
  test('W06_B4_말풍선은_서버_question_text_타일은_choices_6개', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText('서버가_준_첫_질문')).toBeTruthy();
    for (const choice of session.question.choices) {
      expect(within(screen.getByTestId(`choice-${choice.id}`)).getByText(choice.label)).toBeTruthy();
    }
    expect(screen.getAllByTestId(/^choice-/)).toHaveLength(6);
  });

  test('W07_B4_서버가_준_보기를_그대로_쓴다_고정_목록이_아니다', async () => {
    const server = happyServer();
    server.on(
      R.start,
      json(201, { ...session, question: { ...session.question, choices: [{ id: 'cafe', label: '서버_보기_글자' }] } }),
    );
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText('서버_보기_글자')).toBeTruthy();
    expect(screen.getAllByTestId(/^choice-/)).toHaveLength(1);
  });

  test('W08_B4_여러_개_고르면_고른_것_모두를_보낸다', async () => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    await pressId('choice-night_view');
    await pressId('choice-shopping');
    await pressText('이걸로 찾아 줘');
    await screen.findByText('서버가_준_묶음_말');
    const body = server.sent(R.answer)[0].body as { choice_ids: string[] };
    expect([...body.choice_ids].sort()).toEqual(['cafe', 'night_view', 'shopping']);
    expect(Object.keys(body)).toEqual(['choice_ids']);
  });

  test('W09_B4_다시_누르면_빠진다', async () => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    await pressId('choice-shopping');
    await pressId('choice-cafe');
    await pressText('이걸로 찾아 줘');
    await screen.findByText('서버가_준_묶음_말');
    expect(server.sent(R.answer)[0].body).toEqual({ choice_ids: ['shopping'] });
  });

  test('W10_B4_0개면_글자만_아무거나_찾아_줘_고르면_이걸로_찾아_줘_빼면_다시', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText('아무거나 찾아 줘')).toBeTruthy();
    expect(screen.queryByText('이걸로 찾아 줘')).toBeNull();
    await pressId('choice-cafe');
    expect(screen.getByText('이걸로 찾아 줘')).toBeTruthy();
    expect(screen.queryByText('아무거나 찾아 줘')).toBeNull();
    await pressId('choice-cafe');
    expect(screen.getByText('아무거나 찾아 줘')).toBeTruthy();
  });

  test('W11_B4_S4_1_0개로_눌러도_빈_목록을_보낸다_거르지_않음', async () => {
    const server = happyServer();
    await toP2();
    expect(server.sent(R.answer)[0].body).toEqual({ choice_ids: [] });
  });

  test('W12_B4_알아서_짜_줘는_auto_true만_보내고_응답대로_P3', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, course()));
    await toP1();
    await pressId('choice-cafe');
    await pressText('알아서 짜 줘');
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(server.sent(R.answer)[0].body).toEqual({ auto: true });
  });

  test('W13_B4_R7_입력창_글은_지금_고른_칩과_함께', async () => {
    const server = happyServer();
    await toP1();
    await pressId('choice-cafe');
    await typeAndSend('조용한 데');
    await screen.findByText('서버가_준_묶음_말');
    expect(server.sent(R.answer)[0].body).toEqual({ choice_ids: ['cafe'], text: '조용한 데' });
  });

  test('W14_B4_R7_칩이_없으면_빈_목록과_글', async () => {
    const server = happyServer();
    await toP1();
    await typeAndSend('조용한 데');
    await screen.findByText('서버가_준_묶음_말');
    expect(server.sent(R.answer)[0].body).toEqual({ choice_ids: [], text: '조용한 데' });
  });

  test('W15_B4_타일을_눌러도_서버를_부르지_않는다', async () => {
    const server = happyServer();
    await toP1();
    const before = server.requests.length;
    await pressId('choice-cafe');
    expect(server.requests).toHaveLength(before);
  });

  test('W16_B4_오늘_시간표는_day의_시작과_끝', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText(/10:00\s*~\s*20:00/)).toBeTruthy();
  });

  test('W17_B4_꼭_갈_곳이_있으면_이름과_먼저_넣어_뒀어', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText(/꼭 갈 박물관.*먼저 넣어 뒀어/)).toBeTruthy();
  });

  test.each([
    ['꼭 갈 곳도 고정 일정도 없음', { must_visits: [], fixed: [] }],
    ['고정 일정만 있음', { must_visits: [], fixed: [{ place_id: 'D30', name: '공연', start: '15:00', end: '16:00' }] }],
  ])('W18_B4_%s이면_먼저_넣어_뒀어_줄을_숨긴다', async (_name, change) => {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, ...change } }));
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    expect(screen.queryByText(/먼저 넣어 뒀어/)).toBeNull();
  });

  test.skip('W19_질문대기_Q6_꼭_갈_곳의_시각도_보여_준다', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText(/\d{2}:\d{2} 꼭 갈 박물관/)).toBeTruthy();
  });
});

// ---------- P2 ----------

describe('P2 후보 고르기', () => {
  test('W20_B4_말풍선은_서버_message_후보_카드는_묶음_수만큼', async () => {
    happyServer();
    await toP2();
    expect(screen.getByText('서버가_준_묶음_말')).toBeTruthy();
    expect(screen.getAllByTestId(/^candidate-card-/)).toHaveLength(6);
  });

  test('W21_B4_카드에_번호_이름_why_영업_거리', async () => {
    happyServer();
    await toP2();
    const card = within(screen.getByTestId('candidate-card-D01'));
    expect(card.getByText('01 / 06')).toBeTruthy();
    expect(card.getByText('장소 D01')).toBeTruthy();
    expect(card.getByText('이유 D01')).toBeTruthy();
    expect(card.getByText(/10:00.*18:00/)).toBeTruthy();
    expect(card.getByText('확인됨')).toBeTruthy();
    expect(card.getByText('숙소에서 650m')).toBeTruthy();
    expect(within(screen.getByTestId('candidate-card-D03')).getByText('03 / 06')).toBeTruthy();
    expect(within(screen.getByTestId('candidate-card-D02')).getByText('숙소에서 1.2km')).toBeTruthy();
  });

  test.each([
    ['D03', '영업시간 모름', '모름'],
    ['D04', '오늘 휴무', '확인됨'],
    ['D05', '오늘 휴무', '미확인'],
  ])('W22_Q9_카드_%s는_%s와_%s', async (id, text, chip) => {
    happyServer();
    await toP2();
    const card = within(screen.getByTestId(`candidate-card-${id}`));
    expect(card.getByText(text)).toBeTruthy();
    expect(card.getByText(chip)).toBeTruthy();
  });

  test('W23_AC8_담기는_like_요청이고_숫자는_서버_picks_count', async () => {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'], 5))); // 앱이 세면 1, 서버는 5
    await toP2();
    expect(screen.getByText('0곳 담았어')).toBeTruthy();
    await pressId('like-D01');
    expect(await screen.findByText('5곳 담았어')).toBeTruthy();
    expect(server.sent(R.reactions).map((r) => r.body)).toEqual([{ place_id: 'D01', action: 'like' }]);
  });

  test('W24_AC8_첫_묶음의_숫자도_서버_값', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ picks_count: 7 })));
    await toP2();
    expect(screen.getByText('7곳 담았어')).toBeTruthy();
  });

  test('W25_AC8_응답이_오기_전에는_숫자가_바뀌지_않는다_낙관적_갱신_없음', async () => {
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.reactions);
    await pressId('like-D01');
    expect(screen.getByText('0곳 담았어')).toBeTruthy();
    respond(json(200, picks(['D01'])));
    expect(await screen.findByText('1곳 담았어')).toBeTruthy();
  });

  test('W26_AC8_담은_곳을_다시_누르면_unlike', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    server.once(R.reactions, json(200, picks([])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    await pressId('like-D01');
    await screen.findByText('0곳 담았어');
    expect(server.sent(R.reactions).map((r) => r.body)).toEqual([
      { place_id: 'D01', action: 'like' },
      { place_id: 'D01', action: 'unlike' },
    ]);
  });

  test('W27_AC8_취소_뒤_다시_누르면_like', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    server.once(R.reactions, json(200, picks([])));
    server.once(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    await pressId('like-D01');
    await screen.findByText('0곳 담았어');
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect((server.last().body as { action: string }).action).toBe('like');
  });

  test('W28_AC8_패스는_skip_요청', async () => {
    const server = happyServer();
    await toP2();
    await pressId('skip-D02');
    await waitFor(() => expect(server.sent(R.reactions)).toHaveLength(1));
    expect(server.sent(R.reactions)[0].body).toEqual({ place_id: 'D02', action: 'skip' });
  });

  test('W29_AC8_담은_곳을_패스하면_숫자는_서버_값으로_줄어든다', async () => {
    const server = happyServer();
    server.once(R.reactions, json(200, picks(['D01'])));
    server.once(R.reactions, json(200, picks([])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    await pressId('skip-D01');
    expect(await screen.findByText('0곳 담았어')).toBeTruthy();
  });

  test.each([
    [0, 0, 3],
    [2, 2, 1],
    [3, 3, 0],
    [4, 3, 0],
  ])('W30_B4_담은_곳_%d곳이면_동그라미_%d개_빈_자리_%d개', async (count, filled, empty) => {
    const server = happyServer();
    const ids = ['D01', 'D02', 'D03', 'D04'].slice(0, count);
    ids.forEach((_, index) => server.once(R.reactions, json(200, picks(ids.slice(0, index + 1)))));
    await toP2();
    for (const id of ids) await pressId(`like-${id}`);
    await screen.findByText(`${count}곳 담았어`);
    expect(screen.queryAllByTestId('picked-circle')).toHaveLength(filled);
    expect(screen.queryAllByTestId('empty-circle')).toHaveLength(empty);
  });

  test('W31_B4_방향_칩은_directions_누르면_next_direction_id', async () => {
    const server = happyServer();
    await toP2();
    expect(screen.getByText('좀 더 한적한 데')).toBeTruthy();
    await pressId('direction-closer');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next)[0].body).toEqual({ direction_id: 'closer' });
  });

  test('W32_B4_끝_카드의_다른_곳_보여_줘는_빈_next', async () => {
    const server = happyServer();
    await toP2();
    const end = within(screen.getByTestId('end-card'));
    expect(end.getByText('다른 곳도 볼래?')).toBeTruthy();
    await tap(end.getByText('다른 곳 보여 줘'));
    await screen.findByText('서버가_준_다음_묶음_말');
    expectNoBody(server.sent(R.next)[0].body);
  });

  test('W33_B4_입력창_글은_next_text', async () => {
    const server = happyServer();
    await toP2();
    await typeAndSend('조용한 데');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(server.sent(R.next)[0].body).toEqual({ text: '조용한 데' });
  });

  test('W34_B4_새_묶음을_받으면_새_카드로_바뀐다', async () => {
    const server = happyServer();
    const next = batch({ message: '두번째', candidates: [batch().candidates[0]], picks_count: 2 });
    server.on(R.next, json(200, next));
    await toP2();
    await pressId('direction-closer');
    await screen.findByText('두번째');
    expect(screen.getAllByTestId(/^candidate-card-/)).toHaveLength(1);
    expect(screen.getByText('2곳 담았어')).toBeTruthy();
  });

  test('W35_B4_코스_짜기는_compose이고_응답대로_P3', async () => {
    const server = happyServer();
    await toP3();
    expect(server.sent(R.compose)).toHaveLength(1);
    expectNoBody(server.sent(R.compose)[0].body);
  });

  test.skip('W36_질문대기_Q7_앱을_다시_켠_뒤에도_담은_카드가_표시된다', async () => {
    const server = happyServer();
    server.on(R.get, json(200, batch({ picks_count: 1 })));
    server.on(R.reactions, json(200, picks([])));
    const app = await toP2();
    await restart(app);
    await pressId('like-D01');
    await waitFor(() => expect((server.last().body as { action: string }).action).toBe('unlike'));
  });

  test.skip('W37_질문대기_Q8_빈_묶음이면_끝_카드와_코스_짜기만', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ candidates: [], exhausted: true, message: '소진' })));
    await toP2();
    expect(screen.getByTestId('end-card')).toBeTruthy();
  });

  test.skip('W38_질문대기_Q9_공백만_보내면_요청을_보내지_않는다', async () => {
    const server = happyServer();
    await toP2();
    await typeAndSend('   ');
    expect(server.sent(R.next)).toHaveLength(0);
  });
});

// ---------- P3 ----------

describe('P3 코스안', () => {
  test('W39_B4_머리_제목은_코스_짜_봤어_부제는_곳_수', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('코스 짜 봤어')).toBeTruthy();
    expect(screen.getByText(/째 날 · 3곳$/)).toBeTruthy();
  });

  test.skip('W40_질문대기_Q10_부제의_날짜_표기', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('둘째 날 · 3곳')).toBeTruthy();
  });

  test('W41_B4_요약_줄은_곳_수와_이동_분', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('3곳 · 이동 80분')).toBeTruthy();
  });

  test('W42_B4_순서_목록_시각_이름_머문_시간_보조', async () => {
    happyServer();
    await toP3();
    const first = within(screen.getByTestId('course-row-1'));
    expect(first.getByText('10:10')).toBeTruthy();
    expect(first.getByText('장소 D01')).toBeTruthy();
    expect(first.getByText('1시간 30분')).toBeTruthy();
    expect(first.getByText(/12분/)).toBeTruthy();
    expect(within(screen.getByTestId('course-row-2')).getByText(/꼭 갈 곳/)).toBeTruthy();
    expect(within(screen.getByTestId('course-row-3')).getByText(/고정 일정/)).toBeTruthy();
  });

  test('W43_B4_이름은_서버_name을_쓴다', async () => {
    const server = happyServer();
    const changed = relaxed();
    changed.items[0] = { ...changed.items[0], name: '서버가_준_이름' };
    server.on(R.compose, json(200, course([changed])));
    await toP3();
    expect(screen.getByText('서버가_준_이름')).toBeTruthy();
  });

  test('W44_B4_stay_source_user면_바꿈_auto면_없음', async () => {
    happyServer();
    await toP3();
    expect(within(screen.getByTestId('course-row-2')).getByText(/바꿈/)).toBeTruthy();
    expect(within(screen.getByTestId('course-row-1')).queryByText(/바꿈/)).toBeNull();
  });

  test('W45_B4_코스_종류_토글_글자', async () => {
    happyServer();
    await toP3();
    expect(within(screen.getByTestId('option-relaxed')).getByText('느긋하게')).toBeTruthy();
    expect(within(screen.getByTestId('option-packed')).getByText('꽉 채워서')).toBeTruthy();
  });

  test('W46_B4_안이_1개면_토글을_숨긴다', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([relaxed()])));
    await toP3();
    expect(screen.queryByTestId('option-relaxed')).toBeNull();
    expect(screen.queryByText('느긋하게')).toBeNull();
  });

  test('W47_B4_토글을_누르면_그_안의_항목으로_바뀐다_서버_요청_없음', async () => {
    const server = happyServer();
    await toP3();
    const before = server.requests.length;
    await pressId('option-packed');
    expect(screen.getByText('1곳 · 이동 42분')).toBeTruthy();
    expect(screen.getByText('45분')).toBeTruthy();
    expect(server.requests).toHaveLength(before);
  });

  test('W48_B4_동선_그림이_있다', async () => {
    happyServer();
    await toP3();
    expect(screen.getByTestId('route-diagram')).toBeTruthy();
  });

  test('W49_B4_머문_시간을_누르기_전에는_버튼이_없고_누르면_펼쳐진다', async () => {
    happyServer();
    await toP3();
    expect(screen.queryByTestId('stay-plus-D01')).toBeNull();
    await pressId('stay-D01');
    expect(screen.getByTestId('stay-plus-D01')).toBeTruthy();
    expect(screen.getByTestId('stay-minus-D01')).toBeTruthy();
    expect(screen.queryByTestId('stay-plus-D20')).toBeNull();
  });

  test.each([
    ['stay-plus-D01', 15],
    ['stay-minus-D01', -15],
  ])('W50_AC9_%s는_delta_%d_보이는_안의_option_id', async (id, delta) => {
    const server = happyServer();
    await toP3();
    await pressId('stay-D01');
    await pressId(id);
    await waitFor(() => expect(server.sent(R.adjust)).toHaveLength(1));
    expect(server.sent(R.adjust)[0].body).toEqual({ option_id: 'opt-relaxed', place_id: 'D01', delta });
  });

  test('W51_AC9_다른_안을_보고_있으면_그_안의_option_id', async () => {
    const server = happyServer();
    await toP3();
    await pressId('option-packed');
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    await waitFor(() => expect(server.sent(R.adjust)).toHaveLength(1));
    expect(server.sent(R.adjust)[0].body).toEqual({ option_id: 'opt-packed', place_id: 'D01', delta: 15 });
  });

  test('W52_AC9_조정_뒤에는_새_ID로_다음_조정과_고르기를_한다', async () => {
    const server = happyServer();
    server.on(R.adjust, json(200, course([relaxed('new-relaxed'), packed('new-packed')])));
    server.on('POST /course-options/new-relaxed/select', json(200, { ...selected, option_id: 'new-relaxed' }));
    server.on(R.get, json(200, { ...done, option_id: 'new-relaxed' }));
    await toP3();
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    await waitFor(() => expect(server.sent(R.adjust)).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('이걸로 할래')).toBeTruthy());
    await pressText('이걸로 할래');
    await screen.findByText('코스 저장했어');
    expect(server.sent('POST /course-options/new-relaxed/select')).toHaveLength(1);
    expect(server.sent(R.selectRelaxed)).toHaveLength(0);
  });

  test.skip('W53_질문대기_Q14_다른_안을_보다_조정해도_같은_종류의_안을_계속_보여_준다', async () => {
    const server = happyServer();
    server.on(R.adjust, json(200, course([relaxed('new-relaxed'), packed('new-packed')])));
    await toP3();
    await pressId('option-packed');
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    expect(await screen.findByText('1곳 · 이동 42분')).toBeTruthy();
  });

  test('W54_AC9_R6_고정_일정_줄에는_버튼이_없다_눌러도_안_나온다', async () => {
    const server = happyServer();
    await toP3();
    const stay = screen.queryByTestId('stay-D30');
    if (stay) await tap(stay);
    expect(screen.queryByTestId('stay-plus-D30')).toBeNull();
    expect(screen.queryByTestId('stay-minus-D30')).toBeNull();
    expect(server.sent(R.adjust)).toHaveLength(0);
    expect(within(screen.getByTestId('course-row-3')).getByText('1시간')).toBeTruthy();
  });

  test('W55_AC9_R6_장소_없는_고정_일정_줄에도_버튼이_없고_화면이_깨지지_않는다', async () => {
    const server = happyServer();
    const withoutPlace = relaxed();
    withoutPlace.items.push({
      ...withoutPlace.items[2],
      seq: 4,
      place_id: null as unknown as string,
      stay_source: null as unknown as 'auto',
      hours_status: null as unknown as 'confirmed',
    });
    server.on(R.compose, json(200, course([withoutPlace])));
    await toP3();
    expect(within(screen.getByTestId('course-row-4')).queryByTestId(/^stay-/)).toBeNull();
    expect(screen.queryByTestId('stay-plus-null')).toBeNull();
  });

  test('W56_B4_점검_카드_빠진_곳이_없으면_빠진_곳_없어', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([packed()])));
    await toP3();
    expect(screen.getByText('빠진 곳 없어')).toBeTruthy();
    expect(screen.queryByText(/못 넣었어/)).toBeNull();
    expect(screen.getByText('숙소까지 30분')).toBeTruthy();
  });

  test('W57_B4_점검_카드_이유_3종의_글자', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('3곳은 못 넣었어')).toBeTruthy();
    expect(screen.queryByText('빠진 곳 없어')).toBeNull();
    expect(screen.getByText(/장소 D02/)).toBeTruthy();
    expect(screen.getByText(/그 시간엔 닫혀/)).toBeTruthy();
    expect(screen.getByText(/장소 D03/)).toBeTruthy();
    expect(screen.getByText(/시간이 모자라/)).toBeTruthy();
    expect(screen.getByText(/장소 D04/)).toBeTruthy();
    expect(screen.getByText(/다른 일정과 겹쳐/)).toBeTruthy();
    expect(screen.getByText('숙소까지 25분')).toBeTruthy();
  });

  test('W58_B4_더_고를래는_back이고_응답대로_P2', async () => {
    const server = happyServer();
    server.on(R.back, json(200, batch({ message: '더_고를래_응답' })));
    await toP3();
    await pressText('더 고를래');
    expect(await screen.findByText('더_고를래_응답')).toBeTruthy();
    expectNoBody(server.sent(R.back)[0].body);
    expect(screen.queryByText('코스 짜 봤어')).toBeNull();
  });

  test('W59_B4_이걸로_할래는_보이는_안의_option_id로_select', async () => {
    const server = happyServer();
    server.on(R.get, json(200, { ...done, option_id: 'opt-packed' }));
    await toP3();
    await pressId('option-packed');
    await pressText('이걸로 할래');
    expect(await screen.findByText('코스 저장했어')).toBeTruthy();
    expect(server.sent(R.selectPacked)).toHaveLength(1);
    expect(server.sent(R.selectRelaxed)).toHaveLength(0);
  });

  test.skip('W60_질문대기_Q25_P3_입력창의_글은_어떤_요청도_보내지_않는다', async () => {
    const server = happyServer();
    await toP3();
    const before = server.requests.length;
    await typeAndSend('좀 더 넣어 줘');
    expect(server.requests).toHaveLength(before);
  });

  test.skip('W61_질문대기_Q8_빈_코스면_빈_상태_문구', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([relaxed('opt-relaxed', { items: [], dropped: [] })])));
    await toP3();
    expect(screen.getByText('0곳 · 이동 80분')).toBeTruthy();
  });
});

// ---------- 뒤로 버튼 ----------

describe('뒤로 버튼', () => {
  test.each([
    ['P1', toP1],
    ['P2', toP2],
    ['P3', toP3],
  ])('W62_B3_%s에_뒤로_버튼이_있다', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.getByTestId('header-back')).toBeTruthy();
  });

  test.skip('W63_질문대기_Q16_P3의_뒤로는_더_고를래와_같다', async () => {
    const server = happyServer();
    await toP3();
    await pressId('header-back');
    await waitFor(() => expect(server.sent(R.back)).toHaveLength(1));
  });

  test.skip('W64_질문대기_Q16_P1과_P2의_뒤로_동작', async () => {
    const server = happyServer();
    await toP2();
    const before = server.requests.length;
    await pressId('header-back');
    expect(server.requests).toHaveLength(before);
  });
});

// ---------- AC-12: 다시 켜기 ----------

describe('AC-12 다시 켜기', () => {
  const STAGES: [string, unknown, string][] = [
    ['asking이면 P1', session, '서버가_준_첫_질문'],
    ['browsing이면 P2', batch({ message: '다시_받은_묶음' }), '다시_받은_묶음'],
    ['composing이면 P3', course(), '코스 짜 봤어'],
    ['done이면 S9', done, '코스 저장했어'],
  ];

  test.each(STAGES)('W65_AC12_저장된_세션의_GET이_%s', async (_name, response, marker) => {
    const server = happyServer();
    const app = await toP1();
    server.on(R.get, json(200, response));
    const before = server.requests.length;
    await restart(app);
    expect(await screen.findByText(marker)).toBeTruthy();
    expect(server.requests.slice(before)).toEqual([{ method: 'GET', path: `/planning/${SID}`, body: undefined }]);
  });

  test('W66_AC12_다시_켠_화면은_지금_화면이_아니라_GET_응답이_정한다', async () => {
    const server = happyServer();
    const app = await toP2();
    server.on(R.get, json(200, session));
    await restart(app);
    expect(await screen.findByText('서버가_준_첫_질문')).toBeTruthy();
    expect(screen.queryByTestId('candidate-card-D01')).toBeNull();
  });

  test('W67_AC12_다시_켠_P2에서도_요청이_이어진다', async () => {
    const server = happyServer();
    server.on(R.get, json(200, batch({ picks_count: 2 })));
    server.on(R.reactions, json(200, picks(['D09', 'D08', 'D01'])));
    const app = await toP1();
    await restart(app);
    await screen.findByText('2곳 담았어');
    await pressId('like-D01');
    expect(await screen.findByText('3곳 담았어')).toBeTruthy();
  });

  test('W68_AC12_404면_저장값을_지우고_S0_세션을_새로_만들지_않는다', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, { kind: 'json', status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', detail: null } } });
    const starts = server.sent(R.start).length;
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(server.sent(R.start)).toHaveLength(starts);
  });

  test.skip('W69_질문대기_Q17_다시_켜는_GET이_실패하면', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, { kind: 'network' });
    await restart(app);
    expect(await screen.findByText('연결이 안 돼. 다시 해 볼까?')).toBeTruthy();
    expect(hasStoredSession()).toBe(true);
  });

  test.skip('W70_질문대기_Q17_GET_응답을_기다리는_동안_S0을_보여_주지_않는다', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, { kind: 'hang' });
    await restart(app);
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
  });
});

// ---------- 가짜 응답과 서버 계약 ----------

type Schema = Record<string, any>;

function resolve(spec: Schema, schema: Schema): Schema {
  let current = schema;
  while (current.$ref) current = spec.components.schemas[current.$ref.split('/').pop()];
  return current;
}

function mismatches(spec: Schema, rawSchema: Schema, value: unknown, path = '$'): string[] {
  const schema = resolve(spec, rawSchema);
  if (schema.anyOf) {
    const results = schema.anyOf.map((option: Schema) => mismatches(spec, option, value, path));
    return results.some((r: string[]) => r.length === 0) ? [] : results.sort((a: string[], b: string[]) => a.length - b.length)[0];
  }
  if (schema.enum) return schema.enum.includes(value) ? [] : [`${path}: enum 밖 값 ${String(value)}`];
  if (schema.const !== undefined) return schema.const === value ? [] : [`${path}: const와 다름`];
  if (schema.type === 'null') return value === null ? [] : [`${path}: null 아님`];
  if (schema.type === 'string') return typeof value === 'string' ? [] : [`${path}: 문자열 아님`];
  if (schema.type === 'integer') return Number.isInteger(value) ? [] : [`${path}: 정수 아님`];
  if (schema.type === 'number') return typeof value === 'number' ? [] : [`${path}: 숫자 아님`];
  if (schema.type === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: 참거짓 아님`];
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: 배열 아님`];
    return value.flatMap((entry, index) => mismatches(spec, schema.items, entry, `${path}[${index}]`));
  }
  if (schema.type === 'object' || schema.properties) {
    if (value === null || typeof value !== 'object') return [`${path}: 객체 아님`];
    const record = value as Record<string, unknown>;
    const properties: Schema = schema.properties ?? {};
    const problems = Object.keys(record)
      .filter((key) => !(key in properties))
      .map((key) => `${path}.${key}: 명세에 없는 키`);
    for (const key of schema.required ?? []) if (!(key in record)) problems.push(`${path}.${key}: 빠진 키`);
    for (const [key, sub] of Object.entries(properties)) {
      if (key in record) problems.push(...mismatches(spec, sub as Schema, record[key], `${path}.${key}`));
    }
    return problems;
  }
  return [];
}

describe('가짜 응답이 서버 명세와 맞는다', () => {
  const spec = () => JSON.parse(readFileSync(join(REPO_ROOT, 'packages/api-types/openapi.json'), 'utf8'));
  const schema = (name: string) => ({ $ref: `#/components/schemas/${name}` });

  test.each<[string, string, unknown]>([
    ['PlanningSession', 'PlanningSession', session],
    ['CandidateBatch', 'CandidateBatch', batch()],
    ['CandidateBatch 되묻기', 'CandidateBatch', batch({ clarify: [{ id: 'food', label: '먹을 데' }] })],
    ['CourseResult', 'CourseResult', course()],
    ['Picks', 'Picks', picks(['D01'])],
    ['SeedResult', 'SeedResult', seed],
    ['SelectResult', 'SelectResult', selected],
  ])('W71_AC7_A5_%s', (_name, model, value) => {
    expect(mismatches(spec(), schema(model), value)).toEqual([]);
  });

  test('W72_AC7_A5_GET의_done_응답', () => {
    const operation = spec().paths['/planning/{session_id}'].get;
    expect(mismatches(spec(), operation.responses['200'].content['application/json'].schema, done)).toEqual([]);
  });

  test('W73_도구_검사_없는_키와_빠진_키를_잡는다', () => {
    expect(mismatches(spec(), schema('Picks'), { picks: [], picks_count: 0, extra: 1 })).toEqual(['$.extra: 명세에 없는 키']);
    expect(mismatches(spec(), schema('Picks'), { picks: [] })).toEqual(['$.picks_count: 빠진 키']);
  });
});
