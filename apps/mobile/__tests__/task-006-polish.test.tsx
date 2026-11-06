/// <reference types="jest" />
// TASK-006 §D: TASK-005에서 넘어온 것. 근거: D1~D4, §8 AC-10, TASK-005 §9 Q6·Q7·§10.
// 스타일 값은 AC-10이 정한 것만 본다. 1.3배에서 실제로 안 잘리는지는 Maestro·폰 스크린샷 몫이다.
import { screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { happyServer, pressId, R, resetDevice, startApp, toP1, toP2, toP3, toS9 } from '../test-support/planning-driver';
import { json } from '../test-support/fake-server';
import { picks } from '../test-support/planning-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
type Must = { place_id: string; name: string };
type DayTimes = { start: string; end: string; fixed: { start: string; end: string }[]; must_visits?: Must[] };

const freeHoursText = (input: DayTimes): string | null => require('@/lib/free-hours').freeHoursText(input);

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const root = () => screen.container as unknown as Tree;

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- D1 ----------

describe('D1 떠 있는 줄의 원', () => {
  /** 앞 원과의 간격 = 묶음의 gap + 자기 왼쪽 여백 (첫 원 빼고) */
  const gaps = () => {
    const circles = [...screen.queryAllByTestId('picked-circle'), ...screen.queryAllByTestId('empty-circle')] as unknown as Tree[];
    expect(circles).toHaveLength(3);
    const box = circles[0].parent as Tree;
    const inRow = box.queryAll((host) => circles.includes(host));
    return inRow.slice(1).map((host) => Number(styleOf(box).gap ?? 0) + Number(styleOf(host).marginLeft ?? 0));
  };

  test('T6_D1_빈_자리_셋의_사이_간격은_4', async () => {
    happyServer();
    await toP2();
    expect(gaps()).toEqual([4, 4]);
  });

  test('T6_D1_담은_원과_빈_자리_사이도_4_겹치지_않는다', async () => {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(gaps()).toEqual([4, 4]);
  });

  test('T6_D1_어느_원도_음수_여백을_쓰지_않는다', async () => {
    happyServer();
    await toP2();
    for (const host of screen.getAllByTestId('empty-circle') as unknown as Tree[]) {
      expect(Number(styleOf(host).marginLeft ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------- D2 ----------

describe('D2 비어 있는 시간에서 꼭 갈 곳 머문 시간도 뺀다', () => {
  const DAY = { start: '10:00', end: '20:00', fixed: [] as { start: string; end: string }[] };
  const must = (id: string): Must => ({ place_id: id, name: `꼭 갈 곳 ${id}` });

  test.each<[string, Must[], string | null]>([
    ['꼭 갈 곳 없음', [], '10시간 비어 있어'],
    ['머문 시간이 없는 꼭 갈 곳 1곳은 60분', [must('A')], '9시간 비어 있어'],
    ['머문 시간이 없는 꼭 갈 곳 3곳은 180분', [must('A'), must('B'), must('C')], '7시간 비어 있어'],
  ])('T6_D2_%s', (_name, must_visits, expected) => {
    expect(freeHoursText({ ...DAY, must_visits })).toBe(expected);
  });

  test('T6_D2_고정_일정과_함께_뺀다', () => {
    expect(freeHoursText({ ...DAY, fixed: [{ start: '13:00', end: '14:00' }], must_visits: [must('A')] })).toBe('8시간 비어 있어');
  });

  test('T6_D2_TASK005_Q7_다_빼서_반올림_뒤_0_이하면_숨긴다', () => {
    expect(freeHoursText({ start: '10:00', end: '11:00', fixed: [], must_visits: [must('A')] })).toBeNull();
    expect(freeHoursText({ start: '10:00', end: '11:00', fixed: [], must_visits: [must('A'), must('B')] })).toBeNull();
  });

  test('T6_D2_TASK005_Q6_뺀_뒤_30분은_올림', () => {
    expect(freeHoursText({ start: '10:00', end: '11:30', fixed: [], must_visits: [must('A')] })).toBe('1시간 비어 있어');
    expect(freeHoursText({ start: '10:00', end: '11:29', fixed: [], must_visits: [must('A')] })).toBeNull();
  });

  test('T6_D2_문구는_그대로이고_P1에_나온다', async () => {
    happyServer();
    await toP1(); // 가짜 day: 10:00~20:00, 꼭 갈 곳 1곳(머문 시간 값 없음)
    expect(within(byId('timetable') as never).getByText('9시간 비어 있어')).toBeTruthy();
  });

  test.skip('Q19_머문_시간_값이_있으면_그_값을_뺀다_필드_이름이_문서에_없다', () => {
    const typed = { ...must('A'), typical_min: 120 };
    expect(freeHoursText({ ...DAY, must_visits: [typed] })).toBe('8시간 비어 있어');
  });

  test.skip('Q19_꼭_갈_곳이_고정_일정이기도_하면_두_번_빼지_않는다', () => {
    const fixed = [{ start: '13:00', end: '14:00', place_id: 'A' }];
    expect(freeHoursText({ ...DAY, fixed, must_visits: [must('A')] })).toBe('9시간 비어 있어');
  });
});

// ---------- D3 ----------

describe('D3 P3 보조 줄', () => {
  const subText = (seq: number) => within(byId(`course-row-sub-${seq}`) as never).getByText(/이동 \d+분/) as unknown as Tree;

  test.each([1, 2, 3])('T6_D3_%i번_보조_줄은_두_줄까지_허용', async (seq) => {
    happyServer();
    await toP3();
    expect(subText(seq).props.numberOfLines).toBe(2);
  });

  test('T6_D3_보조_줄에서_줄까지_고정_높이가_없다_줄_높이는_내용만큼', async () => {
    happyServer();
    await toP3();
    const row = byId('course-row-1');
    let now: Tree | null = byId('course-row-sub-1');
    while (now && now !== row) {
      expect(styleOf(now).height).toBeUndefined();
      now = now.parent;
    }
    expect(styleOf(row).height).toBeUndefined();
  });

  test('T6_D3_줄의_최소_높이는_52', async () => {
    happyServer();
    await toP3();
    expect(styleOf(byId('course-row-1')).minHeight).toBe(52);
  });
});

// ---------- D4 ----------

const ALL_SCREENS: [string, () => Promise<unknown>][] = [
  [
    'S0',
    async () => {
      await startApp();
      await screen.findByText('데모 여행 시작');
    },
  ],
  ['P1', toP1],
  ['P2', toP2],
  ['P3', toP3],
  ['S9', () => toS9()],
];

// 사진 타일과 SOS 원은 모양이 정해져 있어 빼고 본다 (질문 Q20)
const FIXED_SHAPE = (id: unknown) => id === 'sos-button' || (typeof id === 'string' && id.startsWith('choice-'));

describe('D4 글자 확대 1.3배', () => {
  test.each(ALL_SCREENS)('T6_D4_%s의_모든_글자에_maxFontSizeMultiplier_1_3', async (_name, go) => {
    happyServer();
    await go();
    // 동선 그림의 숫자(Svg Text)는 시스템 글자 크기를 따르지 않아 뺀다
    const texts = root().queryAll((host) => (host.type === 'Text' || host.type === 'TextInput') && host.props.svgElement === undefined);
    expect(texts.length).toBeGreaterThan(0);
    const wrong = texts.filter((host) => host.props.maxFontSizeMultiplier !== 1.3).map((host) => host.props.children ?? host.props.testID);
    expect(wrong).toEqual([]);
  });

  test.each(ALL_SCREENS)('T6_D4_%s의_글자가_든_버튼은_고정_높이_대신_최소_높이', async (_name, go) => {
    happyServer();
    await go();
    const buttons = root().queryAll(
      (host) => host.type === 'View' && typeof host.props.onClick === 'function' && host.queryAll((inner) => inner.type === 'Text').length > 0,
    );
    expect(buttons.length).toBeGreaterThan(0);
    const fixed = buttons
      .filter((host) => !FIXED_SHAPE(host.props.testID) && styleOf(host).height !== undefined)
      .map((host) => host.props.testID ?? host.props.accessibilityLabel ?? '(이름 없음)');
    expect(fixed).toEqual([]);
  });

  test('T6_D4_P3_토글과_조정_버튼까지_펼쳐도_최소_높이', async () => {
    happyServer();
    await toP3();
    await pressId('stay-D01');
    for (const id of ['option-relaxed', 'option-packed', 'stay-plus-D01', 'stay-minus-D01']) {
      const style = styleOf(byId(id));
      expect(style.height).toBeUndefined();
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test('T6_D4_입력창도_고정_높이가_아니다', async () => {
    happyServer();
    await toP1();
    expect(styleOf(byId('input-text')).height).toBeUndefined();
    expect(styleOf(byId('input-text')).minHeight).toBeGreaterThanOrEqual(44);
  });

  test('T6_D4_머리_제목이_늘어날_수_있다', async () => {
    happyServer();
    await toP1();
    let now = screen.getByText('둘째 날 계획') as unknown as Tree | null;
    while (now) {
      if (now.props.testID !== 'sos-button') expect(styleOf(now).height).toBeUndefined();
      now = now.parent;
    }
  });

  test('T6_D4_떠_있는_줄도_최소_높이', async () => {
    happyServer();
    await toP2();
    expect(styleOf(byId('floating-bar')).height).toBeUndefined();
  });
});
