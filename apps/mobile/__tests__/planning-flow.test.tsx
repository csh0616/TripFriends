/// <reference types="jest" />
// 화면 흐름. 근거: TASK-004 §B-2, §B-4, §12, §13, AC-7·AC-8·AC-9·AC-12, TASK-003 §5·§6, §10(Q4·R6·R7)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, hang, json, networkDown } from '../test-support/fake-server';
import {
  expectNoBody,
  happyServer,
  noSession,
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
import { COLORS } from '../test-support/design-table';
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

    expect(server.sent(R.get)).toHaveLength(0); // Q26: select 200이면 바로 S9
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
    expect(server.sent(R.start)[0].body).toEqual({ mode: 'conversation' }); // Q31
    expect(hasStoredSession()).toBe(true);
  });

  test('W04_B2_S9의_처음부터를_누르면_저장값을_지우고_S0_서버_요청_없음', async () => {
    const server = happyServer();
    await toS9();
    const before = server.requests.length;
    await pressText('처음부터');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(server.requests).toHaveLength(before);
  });

  test('W05_B2_처음부터_뒤_앱을_다시_켜도_S0', async () => {
    const server = happyServer();
    const app = await toS9();
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
    expect(server.sent(R.start).map((r) => r.body)).toEqual([{ mode: 'conversation' }]); // Q31
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

  test('W16_B4_Q32_오늘_시간표는_day의_시작과_끝', async () => {
    happyServer();
    await toP1();
    expect(within(screen.getByTestId('timetable')).getByText(/^10:00\s*~\s*20:00$/)).toBeTruthy();
  });

  test('W17_Q6_꼭_갈_곳_줄은_이름만_시각_없음', async () => {
    happyServer();
    await toP1();
    expect(screen.getByText('꼭 갈 박물관은 먼저 넣어 뒀어')).toBeTruthy();
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

  test.each([
    ['꼭 갈 곳만', [], 0],
    ['고정 일정 1개', [{ place_id: 'D30', name: '공연', start: '15:00', end: '16:00' }], 1],
    [
      '고정 일정 2개, 장소 없는 것 포함',
      [
        { place_id: 'D30', name: '공연', start: '15:00', end: '16:00' },
        { place_id: null, name: '저녁 약속', start: '18:00', end: '19:00' },
      ],
      2,
    ],
  ])('W19_Q6_시간표_막대에는_고정_일정만_%s', async (_name, fixed, count) => {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, fixed } }));
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    expect(within(screen.getByTestId('timetable')).queryAllByTestId('timetable-segment')).toHaveLength(count);
    expect(screen.getByText('꼭 갈 박물관은 먼저 넣어 뒀어')).toBeTruthy();
  });

  test.each([
    [1, '첫째 날 계획'],
    [2, '둘째 날 계획'],
    [3, '셋째 날 계획'],
    [4, '넷째 날 계획'],
    [5, '다섯째 날 계획'],
    [6, '6일째 계획'],
    [10, '10일째 계획'],
  ])('W74_Q10_Q32_P1_머리_제목_%d일차는_%s', async (number, title) => {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, day_number: number } }));
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText(title)).toBeTruthy();
  });

  test.each([
    ['2026-12-02', '10:00', '20:00', '12월 2일 수요일 · 10:00~20:00'],
    ['2027-01-05', '09:30', '21:15', '1월 5일 화요일 · 09:30~21:15'],
    ['2026-12-05', '10:00', '20:00', '12월 5일 토요일 · 10:00~20:00'],
    ['2026-12-06', '10:00', '20:00', '12월 6일 일요일 · 10:00~20:00'],
    ['2026-12-31', '10:00', '20:00', '12월 31일 목요일 · 10:00~20:00'],
  ])('W75_Q32_P1_부제_%s', async (date, start, end, subtitle) => {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, date, start, end } }));
    await startApp();
    await pressText('데모 여행 시작');
    expect(await screen.findByText(subtitle)).toBeTruthy();
  });

  test('W76_Q25_P1_입력창은_키보드_보내기', async () => {
    happyServer();
    await toP1();
    expect(screen.getByTestId('input-text').props.returnKeyType).toBe('send');
    expect(screen.getByTestId('input-text').props.editable).not.toBe(false);
  });

  test.each(['   ', '\t\n ', ''])('W77_Q9_P1_공백만_있는_글_%j은_보내지_않는다', async (text) => {
    const server = happyServer();
    await toP1();
    await typeAndSend(text);
    expect(server.sent(R.answer)).toHaveLength(0);
    expect(screen.getByTestId('choice-cafe')).toBeTruthy();
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
    expect(card.getByText('10:00-18:00')).toBeTruthy(); // Q32: 서버 글자 그대로
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

  test('W35_B4_Q29_0곳이어도_코스_짜기는_compose이고_응답대로_P3', async () => {
    const server = happyServer();
    await toP2();
    expect(screen.getByText('0곳 담았어')).toBeTruthy();
    await pressId('compose-button');
    await screen.findByText('코스 짜 봤어');
    expect(server.sent(R.compose)).toHaveLength(1);
    expectNoBody(server.sent(R.compose)[0].body);
  });

  test('W36_Q7_다시_켜면_picks로_담은_표시를_복원_다시_누르면_unlike', async () => {
    const server = happyServer();
    server.on(R.get, json(200, batch({ picks: ['D01'], picks_count: 1 })));
    server.on(R.reactions, json(200, picks([])));
    const app = await toP2();
    await restart(app);
    await screen.findByText('1곳 담았어');
    await pressId('like-D01');
    await waitFor(() => expect(server.last().body).toEqual({ place_id: 'D01', action: 'unlike' }));
  });

  test('W78_Q7_복원한_곳이_아닌_카드는_like', async () => {
    const server = happyServer();
    server.on(R.get, json(200, batch({ picks: ['D01'], picks_count: 1 })));
    server.on(R.reactions, json(200, picks(['D01', 'D02'])));
    const app = await toP2();
    await restart(app);
    await screen.findByText('1곳 담았어');
    await pressId('like-D02');
    await waitFor(() => expect(server.last().body).toEqual({ place_id: 'D02', action: 'like' }));
  });

  test.each([
    [[], 0, 3],
    [['D01'], 1, 2],
    [['D01', 'D02', 'D03'], 3, 0],
    [['D01', 'D02', 'D03', 'D04'], 3, 0],
    [['옛묶음1', '옛묶음2'], 2, 1],
  ])('W79_Q7_B4_다시_켠_떠_있는_줄_picks_%j이면_동그라미_%d개_빈_자리_%d개', async (ids, filled, empty) => {
    const server = happyServer();
    server.on(R.get, json(200, batch({ picks: ids, picks_count: ids.length })));
    const app = await toP1();
    await restart(app);
    await screen.findByText(`${ids.length}곳 담았어`);
    expect(screen.queryAllByTestId('picked-circle')).toHaveLength(filled);
    expect(screen.queryAllByTestId('empty-circle')).toHaveLength(empty);
  });

  test('W80_Q7_새_묶음의_picks로_담은_표시를_바꾼다_더_고를래_포함', async () => {
    const server = happyServer();
    server.on(R.back, json(200, batch({ picks: ['D03'], picks_count: 1 })));
    server.on(R.reactions, json(200, picks([])));
    await toP3();
    await pressText('더 고를래');
    await screen.findByText('1곳 담았어');
    await pressId('like-D03');
    await waitFor(() => expect(server.last().body).toEqual({ place_id: 'D03', action: 'unlike' }));
  });

  // §13-3 끝 카드로 기대값 변경: 소진이면 끝 카드 글은 "코스 짜 볼까?", 서버 message는 말풍선 (Q8의 "문구는 서버 message"를 대신함)
  test('W37_Q8_S13_빈_묶음이면_카드_없이_끝_카드만_글은_코스_짜_볼까_서버_message는_말풍선', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ candidates: [], exhausted: true, message: '서버_소진' })));
    await toP1();
    await pressText('아무거나 찾아 줘');
    const end = within(await screen.findByTestId('end-card'));
    expect(end.getByText('코스 짜 볼까?')).toBeTruthy();
    expect(end.queryByText('서버_소진')).toBeNull();
    expect(screen.getAllByText('서버_소진')).toHaveLength(1);
    expect(screen.queryAllByTestId(/^candidate-card-/)).toHaveLength(0);
    expect(screen.queryByText('다른 곳도 볼래?')).toBeNull();
    expect(screen.getByTestId('compose-button')).toBeTruthy();
  });

  test.each(['   ', '\t\n ', ''])('W38_Q9_P2_공백만_있는_글_%j은_보내지_않는다', async (text) => {
    const server = happyServer();
    await toP2();
    await typeAndSend(text);
    expect(server.sent(R.next)).toHaveLength(0);
    expect(screen.queryByText('다시 해 볼래?')).toBeNull();
  });

  test('W81_Q25_P2_입력창은_키보드_보내기', async () => {
    happyServer();
    await toP2();
    expect(screen.getByTestId('input-text').props.returnKeyType).toBe('send');
    expect(screen.getByTestId('input-text').props.editable).not.toBe(false);
  });

  test.each([
    [1, '첫째 날 고르는 중'],
    [2, '둘째 날 고르는 중'],
    [5, '다섯째 날 고르는 중'],
    [6, '6일째 고르는 중'],
  ])('W82_Q10_Q32_P2_머리_제목_%d일차는_%s', async (number, title) => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ day: { ...day, day_number: number } })));
    await toP2();
    expect(screen.getByText(title)).toBeTruthy();
  });

  test('W83_Q32_P2_부제', async () => {
    happyServer();
    await toP2();
    expect(screen.getByText('12월 2일 수요일 · 10:00~20:00')).toBeTruthy();
  });
});

// ---------- P3 ----------

describe('P3 코스안', () => {
  test('W39_B4_Q32_머리_제목은_코스_짜_봤어', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('코스 짜 봤어')).toBeTruthy();
  });

  // §13-3 Q33: "{날 이름} · {n}곳" 승인, skip 해제
  test('W40_S13_Q33_P3_부제', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('둘째 날 · 3곳')).toBeTruthy();
  });

  test('W41_B4_요약_줄은_곳_수와_이동_분', async () => {
    happyServer();
    await toP3();
    expect(screen.getByText('3곳 · 이동 80분')).toBeTruthy();
  });

  test('W84_Q32_곳_수는_장소_없는_고정_일정까지_items_전체', async () => {
    const server = happyServer();
    const option = relaxed();
    option.items.push({
      ...option.items[2],
      seq: 4,
      place_id: null as unknown as string,
      lat: null as unknown as number, // §13-1 A8
      lng: null as unknown as number,
      name: '저녁 약속',
      stay_source: null as unknown as 'auto',
      hours_status: null as unknown as 'confirmed',
    });
    server.on(R.compose, json(200, course([option])));
    await toP3();
    expect(screen.getByText('4곳 · 이동 80분')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-4')).getByText('저녁 약속')).toBeTruthy();
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

  test('W53_Q14_다른_안을_보다_조정해도_같은_label의_안을_보여_주고_고르기는_새_ID', async () => {
    const server = happyServer();
    server.on(R.adjust, json(200, course([relaxed('new-relaxed'), packed('new-packed')])));
    server.on('POST /course-options/new-packed/select', json(200, { ...selected, option_id: 'new-packed' }));
    await toP3();
    await pressId('option-packed');
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    await waitFor(() => expect(server.sent(R.adjust)).toHaveLength(1));
    expect(await screen.findByText('1곳 · 이동 42분')).toBeTruthy();
    await pressText('이걸로 할래');
    await screen.findByText('코스 저장했어');
    expect(server.sent('POST /course-options/new-packed/select')).toHaveLength(1);
  });

  test('W85_Q14_같은_label의_안이_없으면_첫_안', async () => {
    const server = happyServer();
    server.on(R.adjust, json(200, course([relaxed('new-relaxed')])));
    await toP3();
    await pressId('option-packed');
    await pressId('stay-D01');
    await pressId('stay-plus-D01');
    expect(await screen.findByText('3곳 · 이동 80분')).toBeTruthy();
    expect(screen.queryByTestId('option-relaxed')).toBeNull();
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
      lat: null as unknown as number, // §13-1 A8
      lng: null as unknown as number,
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
    await toP3();
    await pressId('option-packed');
    await pressText('이걸로 할래');
    expect(await screen.findByText('코스 저장했어')).toBeTruthy();
    expect(server.sent(R.selectPacked)).toHaveLength(1);
    expect(server.sent(R.selectRelaxed)).toHaveLength(0);
    expect(server.sent(R.get)).toHaveLength(0); // Q26
  });

  test('W86_Q26_고른_뒤_다시_켜면_GET의_done으로_S9', async () => {
    const server = happyServer();
    const app = await toS9();
    server.on(R.get, json(200, done));
    await restart(app);
    expect(await screen.findByText('코스 저장했어')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(1);
  });

  test('W60_Q25_P3_입력창은_비활성이고_안내가_있고_글을_보낼_수_없다', async () => {
    const server = happyServer();
    await toP3();
    const input = screen.getByTestId('input-text');
    expect(input.props.editable).toBe(false);
    expect(screen.getByText('코스는 위에서 바꿀 수 있어')).toBeTruthy();
    const before = server.requests.length;
    await typeAndSend('좀 더 넣어 줘');
    expect(server.requests).toHaveLength(before);
  });

  test('W87_Q25_P1_P2에는_P3_안내가_없다', async () => {
    happyServer();
    await toP2();
    expect(screen.queryByText('코스는 위에서 바꿀 수 있어')).toBeNull();
  });

  test('W61_Q8_빈_코스면_안내와_더_고를래', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([relaxed('opt-relaxed', { items: [], dropped: [] })])));
    server.on(R.back, json(200, batch({ message: '다시_고르기' })));
    await toP3();
    expect(screen.getByText('담은 곳이 없어서 코스가 비었어')).toBeTruthy();
    await pressText('더 고를래');
    expect(await screen.findByText('다시_고르기')).toBeTruthy();
    expect(server.sent(R.back)).toHaveLength(1);
  });

  test('W88_Q8_항목이_있으면_빈_코스_안내가_없다', async () => {
    happyServer();
    await toP3();
    expect(screen.queryByText('담은 곳이 없어서 코스가 비었어')).toBeNull();
  });
});

// ---------- §13-1 A8: 동선 그림 ----------

describe('§13-1 A8 P3 동선 그림', () => {
  const prop = (id: string) => screen.getByTestId(id).props as Record<string, unknown>;
  const at = (id: string) => ({ x: Number(prop(id).cx), y: Number(prop(id).cy) });
  const stops = () => screen.queryAllByTestId(/^route-stop-/);
  const lineOf = () =>
    String(prop('route-line').points)
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(',').map(Number));
  const noPlace = (seq: number, name: string) => ({
    ...relaxed().items[2],
    seq,
    name,
    place_id: null,
    lat: null,
    lng: null,
    stay_source: null,
    hours_status: null,
  });

  /** 북쪽이 위, 동쪽이 오른쪽 (Q12). 경도 D20 < 숙소 < D01 < D30, 위도 D30=숙소 < D01 < D20 */
  function expectScattered() {
    const home = at('route-home');
    const [d01, d20, d30] = [at('route-stop-1'), at('route-stop-2'), at('route-stop-3')];
    expect(d20.x).toBeLessThan(home.x);
    expect(home.x).toBeLessThan(d01.x);
    expect(d01.x).toBeLessThan(d30.x);
    expect(d20.y).toBeLessThan(d01.y);
    expect(d01.y).toBeLessThan(d30.y);
    expect(d30.y).toBeCloseTo(home.y);
  }

  test('W97_A8_숙소와_항목_좌표로_그린다_일렬이_아니다_후보_좌표가_아니라_항목_좌표', async () => {
    happyServer();
    await toP3();
    expect(stops()).toHaveLength(3);
    expectScattered();
  });

  test('W98_A8_다시_켠_뒤처럼_후보를_본_적_없어도_항목_좌표로_같은_그림', async () => {
    const server = happyServer();
    const app = await toP1();
    server.on(R.get, json(200, course()));
    await restart(app);
    await screen.findByText('코스 짜 봤어');
    expect(stops()).toHaveLength(3);
    expectScattered();
  });

  test('W99_A8_첫_질문의_알아서_짜_줘로_바로_온_코스도_항목_좌표', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, course()));
    await toP1();
    await pressText('알아서 짜 줘');
    await screen.findByText('코스 짜 봤어');
    expectScattered();
  });

  test('W100_A8_모든_점이_그림_상자_안', async () => {
    happyServer();
    await toP3();
    const box = StyleSheet.flatten(prop('route-diagram').style as object) as { width: number; height: number };
    for (const id of ['route-home', 'route-stop-1', 'route-stop-2', 'route-stop-3']) {
      const { x, y } = at(id);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(box.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(box.height);
    }
  });

  test('W101_B4_A8_선은_brand이고_숙소부터_순서대로', async () => {
    happyServer();
    await toP3();
    expect(prop('route-line').stroke).toBe(COLORS.brand);
    const expected = ['route-home', 'route-stop-1', 'route-stop-2', 'route-stop-3'].map(at);
    const line = lineOf();
    expect(line).toHaveLength(4);
    line.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index].x);
      expect(y).toBeCloseTo(expected[index].y);
    });
  });

  test('W102_A8_좌표_없는_줄은_그림에서_빠지고_목록에는_남는다_곳_수는_items_전체', async () => {
    const server = happyServer();
    const option = relaxed();
    option.items.splice(1, 0, noPlace(9, '저녁 약속') as never); // 가운데에 끼운다
    server.on(R.compose, json(200, course([option])));
    await toP3();
    expect(stops()).toHaveLength(3);
    expect(screen.queryByTestId('route-stop-9')).toBeNull();
    expect(lineOf()).toHaveLength(4);
    expect(String(prop('route-line').points)).not.toMatch(/NaN|undefined|null/);
    expect(within(screen.getByTestId('course-row-9')).getByText('저녁 약속')).toBeTruthy();
    expect(screen.getByText('4곳 · 이동 80분')).toBeTruthy();
    expect(screen.getByText('둘째 날 · 4곳')).toBeTruthy();
  });

  test('W103_A8_모두_좌표가_없으면_숙소만_그리고_목록은_그대로', async () => {
    const server = happyServer();
    const option = relaxed('opt-relaxed', { items: [noPlace(1, '점심 약속'), noPlace(2, '저녁 약속')] });
    server.on(R.compose, json(200, course([option])));
    await toP3();
    expect(stops()).toHaveLength(0);
    expect(screen.getByTestId('route-home')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-1')).getByText('점심 약속')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-2')).getByText('저녁 약속')).toBeTruthy();
  });

  test('W104_A8_토글하면_그_안의_좌표로_다시_그린다', async () => {
    happyServer();
    await toP3();
    await pressId('option-packed');
    expect(stops()).toHaveLength(1);
    expect(screen.getByTestId('route-stop-1')).toBeTruthy();
    expect(screen.queryByTestId('route-stop-2')).toBeNull();
    expect(at('route-stop-1').x).toBeGreaterThan(at('route-home').x); // D01은 숙소보다 동쪽·북쪽 (fixtures SPOT)
    expect(at('route-stop-1').y).toBeLessThan(at('route-home').y);
  });

  test('W105_A8_빈_코스면_번호_원이_없다', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([relaxed('opt-relaxed', { items: [], dropped: [] })])));
    await toP3();
    expect(stops()).toHaveLength(0);
  });
});

// ---------- §13-2 #9: 주 버튼은 오른쪽 ----------

describe('§13-2 #9 떠 있는 줄의 주 버튼', () => {
  type Host = { type: string; props: Record<string, any>; queryAll: (p: (h: Host) => boolean) => Host[] };

  function buttons() {
    const bar = screen.getByTestId('floating-bar') as unknown as Host;
    expect(StyleSheet.flatten(bar.props.style).flexDirection ?? 'row').toBe('row');
    return bar.queryAll((host) => host.type === 'View' && typeof host.props.onClick === 'function');
  }
  const background = (host: Host) => StyleSheet.flatten(host.props.style).backgroundColor;
  const labelOf = (host: Host) =>
    host
      .queryAll((inner) => inner.type === 'Text')
      .map((inner) => inner.props.children)
      .join('');

  test('W106_S13_9_Q8_Q41_P3_빈_코스에서도_맨_오른쪽이_주_버튼_더_고를래_이걸로_할래는_보조', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([relaxed('opt-relaxed', { items: [], dropped: [] })])));
    await toP3();
    const all = buttons();
    const last = all[all.length - 1];
    expect(background(last)).toBe(COLORS.brand);
    expect(labelOf(last)).toBe('더 고를래');
    for (const other of all.slice(0, -1)) expect(background(other)).not.toBe(COLORS.brand);
    expect(all.map(labelOf)).toEqual(['이걸로 할래', '더 고를래']); // Q41: 보조로 남는다
    expect(background(all[0])).toBe(COLORS['bg-2']);
  });

  test('W107_B3_P3_코스가_있으면_맨_오른쪽이_주_버튼_이걸로_할래', async () => {
    happyServer();
    await toP3();
    const all = buttons();
    expect(all.map(labelOf)).toEqual(['더 고를래', '이걸로 할래']);
    expect(background(all[1])).toBe(COLORS.brand);
    expect(background(all[0])).not.toBe(COLORS.brand);
  });

  test('W108_B3_P1도_맨_오른쪽이_주_버튼', async () => {
    happyServer();
    await toP1();
    const all = buttons();
    expect(background(all[all.length - 1])).toBe(COLORS.brand);
    expect(labelOf(all[all.length - 1])).toBe('아무거나 찾아 줘');
  });

  test('W109_B3_P2도_맨_오른쪽이_주_버튼', async () => {
    happyServer();
    await toP2();
    const all = buttons();
    expect(background(all[all.length - 1])).toBe(COLORS.brand);
    expect(labelOf(all[all.length - 1])).toBe('코스 짜기');
  });
});

// ---------- §13-2 #8: 담기 움직임 ----------

describe('§13-2 #8 담기 동그라미 움직임', () => {
  const durations = (spy: jest.SpiedFunction<typeof Animated.timing>) =>
    spy.mock.calls.map(([, config]) => (config as { duration?: number }).duration);

  test('W110_S13_8_담으면_dur_draw_420ms로_그린다', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timing = jest.spyOn(Animated, 'timing');
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(screen.getByTestId('picked-mark-D01')).toBeTruthy();
    expect(reduce).toHaveBeenCalled();
    expect(durations(timing)).toContain(420);
  });

  test('W111_S13_8_움직임_줄이기가_켜져_있으면_0ms', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(screen.getByTestId('picked-mark-D01')).toBeTruthy();
    expect(reduce).toHaveBeenCalled();
    expect(durations(timing)).toContain(0);
    expect(durations(timing)).not.toContain(420);
  });

  test('W112_S13_8_응답이_오기_전에는_그리지_않는다_낙관적_갱신_없음', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timing = jest.spyOn(Animated, 'timing');
    const server = happyServer();
    await toP2();
    const respond = server.defer(R.reactions);
    await pressId('like-D01');
    expect(screen.queryByTestId('picked-mark-D01')).toBeNull();
    expect(durations(timing)).not.toContain(420);
    respond(json(200, picks(['D01'])));
    await screen.findByText('1곳 담았어');
    expect(durations(timing)).toContain(420);
  });
});

// ---------- 점검 추가: 움직임 줄이기와 카드 스크롤, 설정을 못 읽을 때 ----------

describe('DESIGN-001 §4-3 움직임 줄이기, §13-2 #8 담기 표시', () => {
  type Tree = { props: Record<string, any>; queryAll: (p: (h: Tree) => boolean) => Tree[] };

  // RN 가짜 설정 함수는 이미 mock이라 restoreAllMocks로 돌아가지 않는다. 다음 테스트로 새지 않게 기본값으로 되돌린다.
  afterEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  /** 패스 뒤 다음 카드로 넘기는 스크롤 (x가 0이면 새 묶음의 맨 앞으로 돌리는 것이라 뺀다) */
  async function scrollAfterSkip() {
    const scroll = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (o: object) => void }, 'scrollTo');
    scroll.mockClear(); // RN 가짜 ScrollView의 scrollTo는 테스트끼리 같은 함수라 앞 기록을 지운다
    happyServer();
    await toP2();
    await pressId('skip-D01');
    await waitFor(() => {
      expect(scroll.mock.calls.some(([options]) => (options as { x: number }).x > 0)).toBe(true);
    });
    return scroll.mock.calls.map(([options]) => options as { x: number; animated: boolean }).filter(({ x }) => x > 0);
  }

  test('W116_S4_3_움직임_줄이기가_꺼져_있으면_패스_뒤_스크롤은_animated_true', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const moves = await scrollAfterSkip();
    expect(moves).toHaveLength(1);
    expect(moves[0].animated).toBe(true);
  });

  test('W117_S4_3_움직임_줄이기가_켜져_있으면_패스_뒤_스크롤은_animated_false', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const moves = await scrollAfterSkip();
    expect(moves).toHaveLength(1);
    expect(moves[0].animated).toBe(false);
  });

  /** 담은 표시 고리: 남은 길이(strokeDashoffset)가 0이면 끝까지 그려진 것 */
  const ringOffset = () => {
    const [ring] = (screen.container as unknown as Tree).queryAll(
      (host) => host.props.stroke === COLORS.brand && host.props.strokeDashoffset !== undefined,
    );
    return Number(ring.props.strokeDashoffset);
  };

  async function likeFirst() {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(screen.getByTestId('picked-mark-D01')).toBeTruthy();
  }

  test.each([
    ['켜짐', true],
    ['꺼짐', false],
  ])('W118_도구_검사_움직임_줄이기_%s이면_고리가_끝값까지_그려진다', async (_name, reduce) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduce);
    await likeFirst();
    await waitFor(() => expect(ringOffset()).toBeCloseTo(0), { timeout: 3000 });
  });

  test('W119_S13_8_움직임_줄이기_설정을_못_읽어도_담은_표시_고리가_끝값까지_그려진다', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('설정 읽기 실패'));
    await likeFirst();
    await waitFor(() => expect(ringOffset()).toBeCloseTo(0), { timeout: 3000 });
  });
});

// ---------- §13-3 Q34~Q44: 승인된 것 중 테스트 없던 줄 ----------

describe('§13-3 승인된 결정 고정', () => {
  const startedWith = async (change: object) => {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, ...change } }));
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
  };

  test('W113_Q39_장소_없는_고정_일정_줄은_hours_status가_null이면_상태_칩이_없다', async () => {
    const server = happyServer();
    const option = relaxed();
    option.items.push({
      ...option.items[2],
      seq: 4,
      place_id: null as unknown as string,
      lat: null as unknown as number,
      lng: null as unknown as number,
      name: '저녁 약속',
      stay_source: null as unknown as 'auto',
      hours_status: null as unknown as 'confirmed',
    });
    server.on(R.compose, json(200, course([option])));
    await toP3();
    const row = within(screen.getByTestId('course-row-4'));
    for (const chip of ['확인됨', '미확인', '모름']) expect(row.queryByText(chip)).toBeNull();
  });

  test.each([
    ['받침 있는 이름', [{ place_id: 'D20', name: '박물관' }], '박물관은 먼저 넣어 뒀어'],
    ['받침 없는 이름', [{ place_id: 'D20', name: '카페' }], '카페는 먼저 넣어 뒀어'],
    ['한글이 아닌 이름', [{ place_id: 'D20', name: 'ABC' }], 'ABC, 먼저 넣어 뒀어'],
    ['여럿', [{ place_id: 'D20', name: '박물관' }, { place_id: 'D21', name: '카페' }], '박물관, 카페, 먼저 넣어 뒀어'],
  ])('W114_Q40_꼭_갈_곳_줄_%s', async (_name, must_visits, line) => {
    await startedWith({ must_visits });
    expect(screen.getByText(line)).toBeTruthy();
  });

  test.each([
    ['P1', toP1],
    ['P2', toP2],
  ])('W115_Q44_%s_입력창_안내_글', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.getByTestId('input-text').props.placeholder).toBe('하고 싶은 말을 써 줘');
  });
});

// ---------- 뒤로 버튼 ----------

describe('뒤로 버튼', () => {
  test('W62_Q16_P3에만_뒤로_버튼이_있다', async () => {
    happyServer();
    await toP3();
    expect(screen.getByTestId('header-back')).toBeTruthy();
  });

  test('W63_Q16_P3의_뒤로는_back이고_응답대로_P2', async () => {
    const server = happyServer();
    server.on(R.back, json(200, batch({ message: '뒤로_응답' })));
    await toP3();
    await pressId('header-back');
    expect(await screen.findByText('뒤로_응답')).toBeTruthy();
    expect(server.sent(R.back)).toHaveLength(1);
    expectNoBody(server.sent(R.back)[0].body);
    expect(screen.queryByTestId('header-back')).toBeNull();
  });

  test.each([
    ['P1', toP1],
    ['P2', toP2],
    ['S9', toS9],
  ])('W64_Q16_%s에는_뒤로_버튼이_없다', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.queryByTestId('header-back')).toBeNull();
  });

  test('W89_Q4_Q16_S0에도_뒤로_버튼이_없다', async () => {
    happyServer();
    await startApp();
    await screen.findByText('데모 여행 시작');
    expect(screen.queryByTestId('header-back')).toBeNull();
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
    server.once(R.get, noSession); // Q21 A7
    const starts = server.sent(R.start).length;
    await restart(app);
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(hasStoredSession()).toBe(false);
    expect(server.sent(R.start)).toHaveLength(starts);
  });

  test('W69_Q17_다시_켜는_GET이_끊기면_문구와_다시_S0으로_안_보냄_다시는_GET', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, networkDown);
    server.on(R.get, json(200, batch({ message: '복구_성공' })));
    await restart(app);
    expect(await screen.findByText('연결이 안 돼. 다시 해 볼까?')).toBeTruthy();
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
    expect(hasStoredSession()).toBe(true);
    await pressText('다시');
    expect(await screen.findByText('복구_성공')).toBeTruthy();
    expect(server.sent(R.get)).toHaveLength(2);
    expect(screen.queryByText('연결이 안 돼. 다시 해 볼까?')).toBeNull();
  });

  test('W70_Q17_GET을_기다리는_동안_로딩이고_S0을_보여_주지_않는다', async () => {
    const server = happyServer();
    const app = await toP1();
    const respond = server.defer(R.get);
    await app.unmount();
    await startApp();
    expect(await screen.findByTestId('app-loading')).toBeTruthy();
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
    respond(json(200, course()));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
    expect(screen.queryByTestId('app-loading')).toBeNull();
  });

  test('W90_Q17_저장값이_없으면_로딩을_지나_S0이고_GET_없음', async () => {
    const server = happyServer();
    await startApp();
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(screen.queryByTestId('app-loading')).toBeNull();
    expect(server.sent(R.get)).toHaveLength(0);
  });

  test('W91_Q17_또_끊기면_문구_그대로_다시는_또_GET', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, networkDown);
    server.once(R.get, networkDown);
    await restart(app);
    await screen.findByText('연결이 안 돼. 다시 해 볼까?');
    await pressText('다시');
    await waitFor(() => expect(server.sent(R.get)).toHaveLength(2));
    expect(await screen.findByText('연결이 안 돼. 다시 해 볼까?')).toBeTruthy();
    expect(hasStoredSession()).toBe(true);
  });

  test('W92_Q17_시간_초과도_10초에_문구와_다시', async () => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, hang);
    await app.unmount();
    jest.useFakeTimers();
    try {
      await startApp();
      const advance = (ms: number) =>
        act(async () => {
          await jest.advanceTimersByTimeAsync(ms);
        });
      await advance(9999);
      expect(screen.queryByText('연결이 안 돼. 다시 해 볼까?')).toBeNull();
      await advance(1);
      expect(screen.getByText('연결이 안 돼. 다시 해 볼까?')).toBeTruthy();
      expect(screen.queryByText('데모 여행 시작')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['500', apiError(500, 'INTERNAL_ERROR')],
    ['503', json(503, { detail: 'x' })],
  ])('W93_Q17_Q18_다시_켜는_GET이_%s여도_S0으로_안_보내고_저장값_유지_다시는_GET', async (_name, reply) => {
    const server = happyServer();
    const app = await toP1();
    server.once(R.get, reply);
    server.on(R.get, json(200, session));
    await restart(app);
    await pressText('다시');
    await screen.findByText('서버가_준_첫_질문');
    expect(server.sent(R.get)).toHaveLength(2);
    expect(hasStoredSession()).toBe(true);
  });

  test('W94_Q27_첫_화면_app_index는_S0이고_서버_상태를_부르지_않는다', async () => {
    const server = happyServer();
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <Index />
      </SafeAreaProvider>,
    );
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
    expect(server.requests.filter((r) => r.path === '/health')).toEqual([]);
  });
});

describe('Q30 API 주소', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
  });

  const load = () => {
    let module!: { API_URL: string };
    jest.isolateModules(() => {
      module = require('@/lib/api');
    });
    return module;
  };

  test('W95_Q30_주소가_없으면_localhost이고_콘솔_경고', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(load().API_URL).toBe('http://localhost:8000');
    expect(warn).toHaveBeenCalled();
  });

  test('W96_Q30_주소가_있으면_그_주소이고_경고_없음', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.0.10:8000';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(load().API_URL).toBe('http://192.168.0.10:8000');
    expect(warn).not.toHaveBeenCalled();
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
