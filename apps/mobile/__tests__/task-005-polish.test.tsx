/// <reference types="jest" />
// 화면 다듬기와 복구 뒤 입력 글. 근거: TASK-005 §B(B1~B12), §C(C1), §4 5줄, §5 3줄, §6 AC-5·AC-6, §9-3(우선), TASK-004 §13-3 비활성, DESIGN-001 v2.3 §2·§4.
// 로직·토큰·구조만 본다. 보이는 모습 자체는 AC-7(폰 스크린샷)이 본다.
import { screen, waitFor, within } from '@testing-library/react-native';
import fc from 'fast-check';
import { StyleSheet } from 'react-native';

import { contrast } from '@/lib/contrast';

import { shadow } from '@/planning/theme';

import { COLORS, STRINGS, TYPE } from '../test-support/design-table';
import { apiError, hang, json, networkDown, type Reply } from '../test-support/fake-server';
import { happyServer, pressId, pressText, R, resetDevice, startApp, tap, toP1, toP2, toP3, typeAndSend } from '../test-support/planning-driver';
import { batch, course, day, packed, picks, relaxed, session } from '../test-support/planning-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };
type DayTimes = { start: string; end: string; fixed: { start: string; end: string }[] };

// 아직 없는 파일이라 테스트마다 불러온다 (없으면 그 테스트만 "Cannot find module"로 빨갛다)
const freeHoursText = (input: DayTimes): string | null => require('@/lib/free-hours').freeHoursText(input);
const responseChanged = (before: unknown, after: unknown): boolean => require('@/lib/response-changed').responseChanged(before, after);

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const inside = (host: Tree) => host.queryAll(() => true);
const isBrand = (value: unknown) => String(value).toUpperCase() === COLORS.brand;
const fillOf = (host: Tree) => styleOf(host).backgroundColor;
const isClear = (value: unknown) => value === undefined || value === 'transparent';
const strokes = (host: Tree) => inside(host).map((h) => h.props.stroke).filter((v): v is string => typeof v === 'string');
const hasIcon = (host: Tree) => inside(host).some((h) => typeof h.props.d === 'string');
const textStyle = (scope: ReturnType<typeof within> | typeof screen, value: string | RegExp) =>
  styleOf(scope.getByText(value) as unknown as Tree);
const hasShadow = (style: Record<string, any>) => Number(style.shadowOpacity ?? 0) > 0 || Number(style.elevation ?? 0) > 0;

function paintedAncestor(host: Tree): Tree | null {
  let now = host.parent;
  while (now && fillOf(now) === undefined) now = now.parent;
  return now;
}

const raised = () => (shadow as unknown as Record<string, Record<string, unknown>>).raise;

const MONO = 'DMMono_500Medium';
const BOLD = 'NotoSansKR_700Bold';
const MEDIUM = 'NotoSansKR_500Medium';

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- B1: 방향 칩 ----------

describe('B1 방향 칩', () => {
  test.each(['direction-quieter', 'direction-closer'])('T5_B1_%s_안_고른_칩은_bg_2_바탕에_ink_글자', async (id) => {
    happyServer();
    await toP2();
    const chip = byId(id);
    expect(fillOf(chip)).toBe(COLORS['bg-2']);
    expect(fillOf(chip)).not.toBe(COLORS['brand-soft']);
    const label = chip.queryAll((h) => h.type === 'Text')[0];
    expect(styleOf(label).color).toBe(COLORS.ink);
  });

  test('T5_S9_Q8_고른_상태가_없어_다음_묶음의_방향_칩도_전부_bg_2', async () => {
    const server = happyServer();
    server.on(R.next, json(200, batch({ round: 2, directions: [{ id: 'photo' as const, label: '사진 예쁜 데' }] })));
    await toP2();
    await pressId('direction-quieter');
    await screen.findByTestId('direction-photo');
    expect(fillOf(byId('direction-photo'))).toBe(COLORS['bg-2']);
  });

  const clarify = [{ id: 'quieter' as const, label: '좀 더 한적한 데' }];

  test('T5_S9_Q9_되묻기_칩은_제안이라_brand_soft에_ink_글자', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ clarify, message: '이 중에 있어?' })));
    await toP2();
    const chip = byId('clarify-quieter');
    expect(fillOf(chip)).toBe(COLORS['brand-soft']);
    expect(styleOf(chip.queryAll((h) => h.type === 'Text')[0]).color).toBe(COLORS.ink);
  });

  test('T5_S9_Q9_S13_요청_중_되묻기_칩은_비활성_규칙대로_bg_2', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ clarify, message: '이 중에 있어?' })));
    await toP2();
    server.once(R.compose, hang);
    await pressId('compose-button');
    expect(fillOf(byId('clarify-quieter'))).toBe(COLORS['bg-2']);
  });
});

// ---------- B2: 담은 표시 하나 + §5 3줄 ----------

describe('B2 담은 표시', () => {
  async function likedD01() {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    return server;
  }

  test('T5_B2_담은_뒤_담기_버튼은_ink_바탕이고_주황이_아니다', async () => {
    await likedD01();
    const button = byId('like-D01');
    expect(fillOf(button)).toBe(COLORS.ink);
    expect(inside(button).filter((h) => isBrand(styleOf(h).backgroundColor) || isBrand(h.props.stroke))).toEqual([]);
  });

  test('T5_B2_담은_뒤_담기_버튼에_체크_아이콘이_ink_위에서_보인다', async () => {
    await likedD01();
    const button = byId('like-D01');
    expect(hasIcon(button)).toBe(true);
    for (const stroke of strokes(button)) expect(contrast(stroke, COLORS.ink)).toBeGreaterThanOrEqual(4.5); // DESIGN-001 §2
  });

  test('T5_B2_담은_카드에_담은_표시_하나_주황_고리_하나', async () => {
    await likedD01();
    const card = byId('candidate-card-D01');
    expect(within(card as never).queryAllByTestId(/^picked-mark-/)).toHaveLength(1);
    const rings = inside(card).filter((h) => isBrand(h.props.stroke) || isBrand(styleOf(h).borderColor));
    expect(rings).toHaveLength(1);
    expect(hasIcon(byId('picked-mark-D01'))).toBe(true);
  });

  test('T5_B2_담지_않은_카드에는_담은_표시가_없고_담기_버튼은_ink', async () => {
    await likedD01();
    expect(screen.queryByTestId('picked-mark-D02')).toBeNull();
    expect(fillOf(byId('like-D02'))).toBe(COLORS.ink);
  });

  test('T5_B2_두_곳을_담아도_카드마다_표시_하나', async () => {
    const server = await likedD01();
    server.on(R.reactions, json(200, picks(['D01', 'D02'])));
    await pressId('like-D02');
    await screen.findByText('2곳 담았어');
    for (const id of ['D01', 'D02']) {
      expect(within(byId(`candidate-card-${id}`) as never).queryAllByTestId(/^picked-mark-/)).toHaveLength(1);
    }
  });

  test('T5_B2_다시_누르면_취소_요청', async () => {
    const server = await likedD01();
    await pressId('like-D01');
    await waitFor(() => expect(server.sent(R.reactions)).toHaveLength(2));
    expect(server.sent(R.reactions)[1].body).toEqual({ place_id: 'D01', action: 'unlike' });
  });

  test('T5_S5_움직임은_사진_위_동그라미에만_담기_버튼과_떠_있는_줄에는_없다', async () => {
    await likedD01();
    const drawn = (host: Tree) => inside(host).filter((h) => h.props.strokeDasharray !== undefined);
    expect(drawn(byId('candidate-card-D01'))).toHaveLength(1);
    expect(drawn(byId('like-D01'))).toEqual([]);
    expect(drawn(byId('floating-bar'))).toEqual([]);
  });
});

// ---------- B3: 빈 자리 부품 ----------

describe('B3 떠 있는 줄 빈 자리', () => {
  test('T5_B3_빈_자리는_점선_1점5_muted_테두리', async () => {
    happyServer();
    await toP2();
    const empties = screen.getAllByTestId('empty-circle') as unknown as Tree[];
    expect(empties).toHaveLength(3);
    for (const empty of empties) {
      const style = styleOf(empty);
      expect(style.borderStyle).toBe('dashed');
      expect(style.borderWidth).toBe(1.5);
      expect(style.borderColor).toBe(COLORS.muted);
    }
  });

  test('T5_B3_빈_자리_가운데에_더하기_아이콘', async () => {
    happyServer();
    await toP2();
    for (const empty of screen.getAllByTestId('empty-circle') as unknown as Tree[]) expect(hasIcon(empty)).toBe(true);
  });

  test('T5_B3_담은_자리에는_점선이_없다', async () => {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    expect(styleOf(byId('picked-circle')).borderStyle).toBeUndefined();
    expect(screen.getAllByTestId('empty-circle')).toHaveLength(2);
  });
});

// ---------- B4: 코스 종류 토글 ----------

describe('B4 토글', () => {
  test('T5_S9_Q14_sh_raise_값은_DESIGN_001과_같고_sh_float와_다른_그림자로_옮겨진다', () => {
    expect(STRINGS['sh-raise']).toBe('0 1px 2px rgba(26,26,26,.08), 0 2px 8px rgba(26,26,26,.08)');
    expect(raised().shadowOpacity).toBeGreaterThan(0);
    expect(raised().shadowRadius).not.toBe(shadow.float.shadowRadius);
  });

  const look = (id: string) => {
    const button = byId(id);
    const label = button.queryAll((h) => h.type === 'Text')[0];
    return { fill: fillOf(button), box: styleOf(button), label: styleOf(label) };
  };

  const expectOn = (id: string) => {
    const on = look(id);
    expect(on.fill).toBe(COLORS.surface);
    expect(hasShadow(on.box)).toBe(true);
    // §9 Q14: sh-raise. theme의 shadow.raise는 새 임시 이름
    expect(raised()).toBeDefined();
    expect(on.box).toMatchObject(raised());
    expect(on.label.color).toBe(COLORS.ink);
    expect(on.label.fontFamily).toBe(BOLD);
  };

  const expectOff = (id: string) => {
    const off = look(id);
    expect(isClear(off.fill)).toBe(true);
    expect(hasShadow(off.box)).toBe(false);
    expect(off.label.color).toBe(COLORS.muted);
    expect(off.label.fontFamily).toBe(MEDIUM);
  };

  test('T5_B4_고른_쪽은_surface_칸과_그림자_글자_ink_700', async () => {
    happyServer();
    await toP3();
    expectOn('option-relaxed');
  });

  test('T5_B4_안_고른_쪽은_채움_그림자_없고_글자_muted_500', async () => {
    happyServer();
    await toP3();
    expectOff('option-packed');
  });

  test('T5_B4_바꾸면_스타일도_서로_바뀐다', async () => {
    happyServer();
    await toP3();
    await pressId('option-packed');
    expectOn('option-packed');
    expectOff('option-relaxed');
  });

  test('T5_B4_두_칸은_bg_2_판_안에_있다', async () => {
    happyServer();
    await toP3();
    for (const id of ['option-relaxed', 'option-packed']) {
      expect(fillOf(paintedAncestor(byId(id)) as Tree)).toBe(COLORS['bg-2']);
    }
  });
});

// ---------- B5: P3 목록 ----------

describe('B5 코스 목록 줄', () => {
  const height = (id: string) => {
    const style = styleOf(byId(id));
    return Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0));
  };

  test.each(['course-row-1', 'course-row-2', 'course-row-3'])('T5_B5_%s_접힌_줄은_52_높이이고_바탕이_없다', async (id) => {
    happyServer();
    await toP3();
    expect(height(id)).toBe(52);
    expect(isClear(fillOf(byId(id)))).toBe(true);
  });

  test('T5_B5_펼친_줄만_bg_2', async () => {
    happyServer();
    await toP3();
    await pressId('stay-D01');
    expect(fillOf(byId('course-row-1'))).toBe(COLORS['bg-2']);
    expect(isClear(fillOf(byId('course-row-2')))).toBe(true);
    await pressId('stay-D01');
    expect(isClear(fillOf(byId('course-row-1')))).toBe(true);
  });

  test('T5_B5_상태_칩은_보조_줄에_이동과_함께_있고_머문_시간과_이름은_그_밖에', async () => {
    happyServer();
    await toP3();
    const sub = within(byId('course-row-sub-1') as never);
    expect(sub.getByText(/이동 12분/)).toBeTruthy();
    expect(sub.getByText('확인됨')).toBeTruthy();
    expect(sub.queryByText('장소 D01')).toBeNull();
    expect(sub.queryByText('1시간 30분')).toBeNull();
    expect(within(byId('course-row-1') as never).getByText('장소 D01')).toBeTruthy();
    expect(within(byId('course-row-1') as never).getByText('1시간 30분')).toBeTruthy();
  });

  test('T5_B5_번호_원을_잇는_세로선은_2px_line', async () => {
    happyServer();
    await toP3();
    const lines = screen.getAllByTestId('course-line') as unknown as Tree[];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(styleOf(line).width).toBe(2);
      expect(fillOf(line)).toBe(COLORS.line);
    }
  });

  test('T5_B5_한_줄뿐이면_이을_번호가_없어_세로선도_없다', async () => {
    const server = happyServer();
    server.on(R.compose, json(200, course([packed()])));
    await toP3();
    expect(screen.queryAllByTestId('course-line')).toEqual([]);
  });

  test('T5_B5_시각은_DM_Mono', async () => {
    happyServer();
    await toP3();
    expect(textStyle(within(byId('course-row-1') as never), '10:10').fontFamily).toBe(MONO);
  });
});

// ---------- B6·B11: P3 글자 토큰 ----------

describe('B6·B11 P3 글자', () => {
  test('T5_B6_요약_줄은_caption_muted', async () => {
    happyServer();
    await toP3();
    const style = textStyle(screen, '3곳 · 이동 80분');
    expect(style.fontSize).toBe(TYPE.caption.size);
    expect(style.lineHeight).toBe(TYPE.caption.lineHeight);
    expect(style.fontFamily).toBe(MEDIUM);
    expect(style.color).toBe(COLORS.muted);
  });

  test.each([1, 2, 3])('T5_B11_%i번_줄_번호는_num_md', async (seq) => {
    happyServer();
    await toP3();
    const style = textStyle(within(byId(`course-row-${seq}`) as never), String(seq));
    expect(style.fontFamily).toBe(MONO);
    expect(style.fontSize).toBe(TYPE['num-md'].size);
    expect(style.lineHeight).toBe(TYPE['num-md'].lineHeight);
  });
});

// ---------- B7·B9: 동선 그림, 뒤로 버튼 ----------

describe('B7·B9 구조', () => {
  test('T5_B7_숙소는_흰_원에_ink_테두리', async () => {
    happyServer();
    await toP3();
    const home = byId('route-home');
    expect(home.props.fill).toBe(COLORS.surface);
    expect(home.props.stroke).toBe(COLORS.ink);
  });

  test('T5_B7_S9_Q15_숙소_원은_지름_24', async () => {
    happyServer();
    await toP3();
    expect(byId('route-home').props.r).toBe(12);
  });

  test('T5_B7_S9_Q15_숙소_원_안의_집_아이콘은_14', async () => {
    happyServer();
    await toP3();
    const icon = byId('route-home-icon');
    expect(hasIcon(icon)).toBe(true);
    expect([icon, ...inside(icon)].some((h) => h.props.width === 14 && h.props.height === 14)).toBe(true);
  });

  test.each([1, 2, 3])('T5_S9_Q16_동선_그림의_%i번_번호도_num_md', async (seq) => {
    happyServer();
    await toP3();
    const label = inside(byId('route-diagram')).find((h) => h.type === 'Text' && h.props.children === String(seq)) as Tree;
    expect(label.props.fontFamily).toBe(MONO);
    expect(label.props.fontSize).toBe(TYPE['num-md'].size);
  });

  test('T5_B7_검은_점이_남아_있지_않다_ink로_채운_원은_번호_원뿐', async () => {
    happyServer();
    await toP3();
    const filled = inside(byId('route-diagram')).filter((h) => h.props.fill === COLORS.ink);
    expect(filled.length).toBeGreaterThan(0);
    for (const host of filled) expect(String(host.props.testID)).toMatch(/^route-stop-/);
  });

  test('T5_B9_뒤로_버튼은_투명_바탕이고_누르는_영역은_44', async () => {
    happyServer();
    await toP3();
    const style = styleOf(byId('header-back'));
    expect(isClear(style.backgroundColor)).toBe(true);
    expect(style.width).toBe(44);
    expect(style.height).toBe(44);
  });

  test('T5_S9_Q19_요청_중_뒤로_버튼은_bg_2_바탕에_muted_아이콘', async () => {
    const server = happyServer();
    await toP3();
    server.once(R.selectRelaxed, hang);
    await pressText('이걸로 할래');
    const back = byId('header-back');
    expect(fillOf(back)).toBe(COLORS['bg-2']);
    expect(strokes(back).length).toBeGreaterThan(0);
    for (const stroke of strokes(back)) expect(stroke).toBe(COLORS.muted);
  });
});

// ---------- B10: 마이크 비활성 ----------

describe('B10 마이크', () => {
  test.each<[string, () => Promise<unknown>]>([
    ['P1', toP1],
    ['P2', toP2],
    ['P3', toP3],
  ])('T5_B10_%s_마이크는_bg_2_바탕에_muted_아이콘', async (_name, go) => {
    happyServer();
    await go();
    const mic = byId('mic-button');
    expect(fillOf(mic)).toBe(COLORS['bg-2']);
    const painted = strokes(mic);
    expect(painted.length).toBeGreaterThan(0);
    for (const stroke of painted) expect(stroke).toBe(COLORS.muted);
  });
});

// ---------- B12: 422 문구 ----------

describe('B12 too_many_places 문구', () => {
  const MESSAGE = '하루에 넣기엔 너무 많아. 몇 곳 빼 볼래?';
  const reply = apiError(422, 'COURSE_INFEASIBLE', { reason: 'too_many_places', blocking: [], suggest_drop: [] });

  const CASES: [string, () => Promise<unknown>, string, () => Promise<unknown>, () => unknown][] = [
    ['P1 알아서', toP1, R.answer, () => pressText('알아서 짜 줘'), () => expect(screen.getByTestId('choice-cafe')).toBeTruthy()],
    ['P2 코스 짜기', toP2, R.compose, () => pressId('compose-button'), () => expect(screen.getByTestId('candidate-card-D01')).toBeTruthy()],
    [
      'P3 조정',
      async () => {
        await toP3();
        await pressId('stay-D01');
      },
      R.adjust,
      () => pressId('stay-plus-D01'),
      () => expect(screen.getByText('코스 짜 봤어')).toBeTruthy(),
    ],
  ];

  test.each(CASES)('T5_A5_B12_%s_문구가_나오고_화면_그대로_다시_버튼_없음', async (_name, go, route, send, stays) => {
    const server = happyServer();
    await go();
    server.once(route, reply);
    await send();
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    stays();
    expect(screen.queryByText('다시')).toBeNull();
    expect(screen.queryByText('이대로는 코스를 못 짜겠어')).toBeNull();
  });
});

// ---------- B8: 빈 시간 계산 함수 (§4 5줄) ----------

describe('B8 freeHoursText', () => {
  const DAY = { start: '10:00', end: '20:00' };
  const at = (start: string, end: string) => ({ start, end });

  test.each<[string, { start: string; end: string }[], string | null]>([
    ['고정 일정 없음', [], '10시간 비어 있어'],
    ['안쪽 1시간', [at('13:00', '14:00')], '9시간 비어 있어'],
    ['안쪽 2개', [at('11:00', '12:00'), at('15:00', '17:00')], '7시간 비어 있어'],
    ['하루 시작에 맞닿아 시작 안쪽', [at('10:00', '11:00')], '9시간 비어 있어'],
    ['하루 끝에 맞닿아 끝 안쪽', [at('19:00', '20:00')], '9시간 비어 있어'],
  ])('T5_B8_%s', (_name, fixed, expected) => {
    expect(freeHoursText({ ...DAY, fixed })).toBe(expected);
  });

  test.each<[string, { start: string; end: string }[], string | null]>([
    ['앞으로 걸침: 안쪽 1시간만 뺀다', [at('09:00', '11:00')], '9시간 비어 있어'],
    ['뒤로 걸침: 안쪽 1시간만 뺀다', [at('19:00', '21:00')], '9시간 비어 있어'],
    ['완전히 앞: 빼지 않는다', [at('08:00', '09:00')], '10시간 비어 있어'],
    ['완전히 뒤: 빼지 않는다', [at('21:00', '22:00')], '10시간 비어 있어'],
    ['시작에 끝이 맞닿음: 빼지 않는다', [at('09:00', '10:00')], '10시간 비어 있어'],
    ['끝에 시작이 맞닿음: 빼지 않는다', [at('20:00', '21:00')], '10시간 비어 있어'],
    ['하루 전체와 같다: 0이라 줄 숨김', [at('10:00', '20:00')], null],
    ['하루를 덮고 넘친다: 0이라 줄 숨김', [at('09:00', '21:00')], null],
    ['여러 개가 하루를 다 채운다: 0이라 줄 숨김', [at('10:00', '15:00'), at('15:00', '20:00')], null],
    ['걸친 것까지 합쳐 다 채운다: 0이라 줄 숨김', [at('09:00', '15:00'), at('15:00', '21:00')], null],
  ])('T5_S4_B8_%s', (_name, fixed, expected) => {
    expect(freeHoursText({ ...DAY, fixed })).toBe(expected);
  });

  test.each<[string, string, string, { start: string; end: string }[], string]>([
    ['자정을 넘는 하루', '20:00', '26:00', [], '6시간 비어 있어'],
    ['자정을 넘는 고정 일정이 뒤로 걸침', '20:00', '26:00', [at('25:00', '27:00')], '5시간 비어 있어'],
  ])('T5_B8_%s', (_name, start, end, fixed, expected) => {
    expect(freeHoursText({ start, end, fixed })).toBe(expected);
  });

  // §9 Q6: 1시간 단위 반올림, 30분은 올림
  test.each<[string, string, string]>([
    ['3시간 14분은 3시간', '13:14', '3시간 비어 있어'],
    ['3시간 15분은 3시간', '13:15', '3시간 비어 있어'],
    ['3시간 29분은 3시간', '13:29', '3시간 비어 있어'],
    ['3시간 30분은 4시간', '13:30', '4시간 비어 있어'],
    ['3시간 45분은 4시간', '13:45', '4시간 비어 있어'],
    ['3시간 59분은 4시간', '13:59', '4시간 비어 있어'],
    ['30분은 1시간', '10:30', '1시간 비어 있어'],
    ['45분은 1시간', '10:45', '1시간 비어 있어'],
  ])('T5_B8_S9_Q6_반올림_%s', (_name, end, expected) => {
    expect(freeHoursText({ start: '10:00', end, fixed: [] })).toBe(expected);
  });

  // §9 Q7: 반올림 뒤 값이 0 이하면 숨김
  test.each<[string, string]>([
    ['10분', '10:10'],
    ['29분', '10:29'],
  ])('T5_S4_B8_S9_Q7_남은_시간이_%s이면_반올림하면_0이라_숨긴다', (_name, end) => {
    expect(freeHoursText({ start: '10:00', end, fixed: [] })).toBeNull();
  });

  test('T5_S4_B8_S9_Q7_고정_일정을_뺀_뒤_29분과_30분의_경계', () => {
    const fixed = [at('10:00', '19:31')];
    expect(freeHoursText({ ...DAY, fixed })).toBeNull();
    expect(freeHoursText({ ...DAY, fixed: [at('10:00', '19:30')] })).toBe('1시간 비어 있어');
  });

  const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

  test('T5_B8_속성_정시로_된_입력에서는_하루_길이_빼기_안쪽_고정_일정', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (start, length, offset, busy) => {
          const fixedStart = start + Math.min(offset, length - 1);
          const fixedEnd = Math.min(fixedStart + busy, start + length);
          const left = length - (fixedEnd - fixedStart);
          const result = freeHoursText({
            start: clock(start),
            end: clock(start + length),
            fixed: [at(clock(fixedStart), clock(fixedEnd))],
          });
          expect(result).toBe(left > 0 ? `${left}시간 비어 있어` : null);
        },
      ),
    );
  });

  test('T5_S4_B8_속성_하루_밖의_고정_일정은_결과를_바꾸지_않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 20, max: 28 }), (fixedStart) => {
        const fixed = [at(clock(fixedStart), clock(fixedStart + 1))];
        expect(freeHoursText({ ...DAY, fixed })).toBe(freeHoursText({ ...DAY, fixed: [] }));
      }),
    );
  });
});

// ---------- B8: P1 시간표 ----------

describe('B8 P1 시간표', () => {
  async function p1With(fixed: { place_id: string | null; name: string; start: string; end: string }[]) {
    const server = happyServer();
    server.on(R.start, json(201, { ...session, day: { ...day, fixed } }));
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByText('서버가_준_첫_질문');
    return within(byId('timetable') as never);
  }
  const lunch = { place_id: null, name: '점심 약속', start: '13:00', end: '14:00' };

  test('T5_B8_고정_일정이_없으면_막대를_숨기고_비어_있는_시간을_쓴다', async () => {
    const table = await p1With([]);
    expect(table.queryByTestId('timetable-bar')).toBeNull();
    expect(table.getByText('10시간 비어 있어')).toBeTruthy();
  });

  test('T5_B8_고정_일정이_있으면_막대와_구간이_있고_뺀_시간을_쓴다', async () => {
    const table = await p1With([lunch]);
    expect(table.getByTestId('timetable-bar')).toBeTruthy();
    expect(table.getAllByTestId('timetable-segment')).toHaveLength(1);
    expect(table.getByText('9시간 비어 있어')).toBeTruthy();
  });

  test('T5_S4_B8_고정_일정이_하루를_다_채우면_비어_있어_줄을_숨긴다', async () => {
    const table = await p1With([{ ...lunch, start: '10:00', end: '20:00' }]);
    expect(table.queryByText(/비어 있어/)).toBeNull();
  });

  test('T5_S4_B8_고정_일정이_하루_밖으로_걸치면_안쪽만_뺀다', async () => {
    const table = await p1With([{ ...lunch, start: '09:00', end: '11:00' }]);
    expect(table.getByText('9시간 비어 있어')).toBeTruthy();
  });
});

// ---------- C1: 복구 뒤 입력 글 ----------

describe('C1 responseChanged', () => {
  const twoOptions = course([relaxed('a'), packed('b')]);

  test.each<[string, unknown, unknown]>([
    ['묶음 그대로', batch(), batch()],
    ['글만 다른 묶음', batch(), batch({ message: '다른_말' })],
    ['담은 수만 다른 묶음', batch(), batch({ picks_count: 2, picks: ['D01', 'D02'] })],
    ['첫 질문 그대로', session, session],
    ['코스안 ID가 같음', twoOptions, course([relaxed('a'), packed('b')])],
    ['코스안 ID는 같고 내용만 다름', twoOptions, course([relaxed('a', { go_home_min: 99 }), packed('b')])],
    ['코스안 ID 순서만 다름 (§9 Q18)', twoOptions, course([packed('b'), relaxed('a')])],
  ])('T5_C1_같다_%s', (_name, before, after) => {
    expect(responseChanged(before, after)).toBe(false);
  });

  test.each<[string, unknown, unknown]>([
    ['stage: 첫 질문에서 묶음', session, batch()],
    ['stage: 묶음에서 코스', batch(), twoOptions],
    ['stage: 코스에서 완료', twoOptions, { day_id: 'day-2', option_id: 'a', stage: 'done' }],
    ['round: 1에서 2', batch({ round: 1 }), batch({ round: 2 })],
    ['round: 2에서 1', batch({ round: 2 }), batch({ round: 1 })],
    ['코스안 ID: 둘 다 다름', twoOptions, course([relaxed('c'), packed('d')])],
    ['코스안 ID: 하나만 다름', twoOptions, course([relaxed('a'), packed('d')])],
    ['코스안 ID: 수가 줄어듦', twoOptions, course([relaxed('a')])],
    ['코스안 ID: 수가 늘어남', course([relaxed('a')]), twoOptions],
  ])('T5_C1_다르다_%s', (_name, before, after) => {
    expect(responseChanged(before, after)).toBe(true);
  });

  test('T5_C1_속성_round가_같으면_같고_다르면_다르다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 }), (a, b) => {
        expect(responseChanged(batch({ round: a }), batch({ round: b }))).toBe(a !== b);
      }),
    );
  });
});

describe('C1 복구 뒤 입력 글', () => {
  const TEXT = '조용한 데';
  const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
  const conflict = apiError(409, 'STATE_CONFLICT', { stage: 'browsing' });
  const typed = () => screen.getByTestId('input-text').props.value;

  /** P2에서 글을 보냈는데 실패 */
  async function failedOnP2(reply: Reply, after?: unknown) {
    const server = happyServer();
    await toP2();
    if (after !== undefined) server.on(R.get, json(200, after));
    server.once(R.next, reply);
    await typeAndSend(TEXT);
    return server;
  }

  const gotGet = (server: ReturnType<typeof happyServer>, count = 1) =>
    waitFor(() => expect(server.sent(R.get).length).toBeGreaterThanOrEqual(count));

  test('T5_C1_끊김_뒤_GET이_같으면_글을_그대로_둔다', async () => {
    const server = await failedOnP2(networkDown, batch());
    await screen.findByText(OFFLINE);
    await pressText('다시');
    await gotGet(server);
    await waitFor(() => expect(screen.queryByText(OFFLINE)).toBeNull());
    expect(typed()).toBe(TEXT);
    expect(server.sent(R.next)).toHaveLength(1);
  });

  test('T5_C1_끊김_뒤_GET의_글만_달라도_같은_것이라_글을_둔다', async () => {
    const server = await failedOnP2(networkDown, batch({ message: '복구한_묶음' }));
    await screen.findByText(OFFLINE);
    await pressText('다시');
    await screen.findByText('복구한_묶음');
    await gotGet(server);
    expect(typed()).toBe(TEXT);
  });

  test('T5_C1_끊김_뒤_GET의_round가_다르면_글을_지운다', async () => {
    await failedOnP2(networkDown, batch({ round: 2, message: '복구한_묶음' }));
    await screen.findByText(OFFLINE);
    expect(typed()).toBe(TEXT);
    await pressText('다시');
    await screen.findByText('복구한_묶음');
    await waitFor(() => expect(typed()).toBe(''));
  });

  test('T5_C1_끊김_뒤_GET의_stage가_다르면_글이_남지_않는다', async () => {
    const server = await failedOnP2(networkDown, course());
    await screen.findByText(OFFLINE);
    await pressText('다시');
    await screen.findByText('코스 짜 봤어');
    expect(typed()).toBe('');
    server.on(R.back, json(200, batch({ round: 3 })));
    await pressText('더 고를래');
    await screen.findByTestId('candidate-card-D01');
    expect(typed()).toBe('');
  });

  test('T5_C1_409_뒤_GET이_같으면_글을_그대로_둔다', async () => {
    const server = await failedOnP2(conflict, batch());
    await gotGet(server);
    await screen.findByTestId('candidate-card-D01');
    await waitFor(() => expect(screen.getByTestId('input-text').props.editable).toBe(true));
    expect(typed()).toBe(TEXT);
  });

  test('T5_C1_409_뒤_GET의_round가_다르면_글을_지운다', async () => {
    await failedOnP2(conflict, batch({ round: 2, message: '복구한_묶음' }));
    await screen.findByText('복구한_묶음');
    await waitFor(() => expect(typed()).toBe(''));
  });

  test('T5_C1_409_뒤_GET의_stage가_다르면_글이_남지_않는다', async () => {
    await failedOnP2(conflict, course());
    await screen.findByText('코스 짜 봤어');
    expect(typed()).toBe('');
  });

  test('T5_C1_P1에서_끊김_뒤_첫_질문이_그대로면_글을_둔다', async () => {
    const server = happyServer();
    await toP1();
    server.on(R.get, json(200, session));
    server.once(R.answer, networkDown);
    await typeAndSend(TEXT);
    await screen.findByText(OFFLINE);
    await pressText('다시');
    await gotGet(server);
    await waitFor(() => expect(screen.queryByText(OFFLINE)).toBeNull());
    expect(typed()).toBe(TEXT);
  });

  test('T5_C1_P1에서_끊김_뒤_묶음으로_바뀌면_글이_남지_않는다', async () => {
    const server = happyServer();
    await toP1();
    server.on(R.get, json(200, batch({ message: '복구한_묶음' })));
    server.once(R.answer, networkDown);
    await typeAndSend(TEXT);
    await screen.findByText(OFFLINE);
    await pressText('다시');
    await screen.findByText('복구한_묶음');
    expect(typed()).toBe('');
  });

  test('T5_C1_복구_GET이_또_끊겨도_글을_두고_성공한_GET이_다르면_그때_지운다', async () => {
    const server = await failedOnP2(networkDown);
    await screen.findByText(OFFLINE);
    server.once(R.get, networkDown);
    await pressText('다시');
    await gotGet(server);
    await screen.findByText(OFFLINE);
    expect(typed()).toBe(TEXT);
    server.on(R.get, json(200, batch({ round: 2, message: '복구한_묶음' })));
    await tap(screen.getByText('다시'));
    await screen.findByText('복구한_묶음');
    await waitFor(() => expect(typed()).toBe(''));
  });

  test('T5_C1_500_뒤_같은_요청이_성공하는_길은_C1과_상관없이_지운다', async () => {
    await failedOnP2(apiError(500, 'INTERNAL_ERROR'));
    await screen.findByText('잠깐 문제가 생겼어');
    await pressText('다시');
    await screen.findByText('서버가_준_다음_묶음_말');
    expect(typed()).toBe('');
  });

  // §9 Q17: 모든 GET 복구. 세션이 아닌 404도 GET으로 복구된다 (TASK-004 §12 Q21)
  const routeGone = apiError(404, 'NOT_FOUND', { resource: 'route' });

  test('T5_S9_Q17_세션이_아닌_404_뒤_GET이_같으면_글을_그대로_둔다', async () => {
    const server = await failedOnP2(routeGone, batch());
    await gotGet(server);
    await waitFor(() => expect(screen.getByTestId('input-text').props.editable).toBe(true));
    expect(typed()).toBe(TEXT);
  });

  test('T5_S9_Q17_세션이_아닌_404_뒤_GET의_round가_다르면_글을_지운다', async () => {
    await failedOnP2(routeGone, batch({ round: 2, message: '복구한_묶음' }));
    await screen.findByText('복구한_묶음');
    await waitFor(() => expect(typed()).toBe(''));
  });
});
