/// <reference types="jest" />
// 가드레일. 근거: TASK-004 §B-1, §B-3, §B-6 G1~G7, §9, §12(Q4·Q5·Q13·Q16·Q25·Q28), §13, AC-6, DESIGN-001 §2·§4
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react-native';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/planning/primary-button';
import { FriendBubble } from '@/components/planning/friend-bubble';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { StatusChip } from '@/components/planning/status-chip';
import { contrast } from '@/lib/contrast';
import { layout } from '@/planning/layout';

import { CONTRAST_PAIRS, COLORS, STRINGS, TYPE } from '../test-support/design-table';
import { happyServer, pressId, pressText, R, resetDevice, startApp, tap, toP1, toP2, toP3, toS9 } from '../test-support/planning-driver';
import { json } from '../test-support/fake-server';
import { batch, course, picks, relaxed } from '../test-support/planning-fixtures';
import { hits, MOBILE_ROOT, REPO_ROOT, SRC, sourceFiles } from '../test-support/source-files';

const TOKENS = join(REPO_ROOT, 'packages', 'design-tokens', 'tokens.json');
const PLACEHOLDER_FILE = 'lib/placeholder-for.ts';
const SOS_FILE = 'components/planning/sos-button.tsx';
const PRIMARY_FILE = 'components/planning/primary-button.tsx';
const LAYOUT_FILE = 'planning/layout.ts';
// §B-6 G1 + Q13: hex(3·4·6·8자리), rgb(, rgba(, 따옴표 안의 색 이름. 'transparent'만 허용
const COLOUR_NAMES =
  'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';
const COLOUR_LITERAL = new RegExp(
  `#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b|\\brgba?\\(|['"\`](?:${COLOUR_NAMES})['"\`]`,
  'i',
);
// §B-1 + Q28: 글자 크기·줄 높이·모서리는 숫자 금지 (예외 파일 없음, 토큰만)
const SIZE_LITERAL = /\b(fontSize|lineHeight|border\w*Radius)\s*[:=]\s*\{?\s*-?\d/;
// Q28: 높이·너비·테두리 굵기 숫자는 layout.ts 한 파일에만
const LAYOUT_LITERAL = /\b(height|width|minHeight|minWidth|maxHeight|maxWidth|border\w*Width)\s*[:=]\s*\{?\s*-?\d/;

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- G1: 소스에 색 값 없음 ----------

describe('G1', () => {
  test('G01_도구_검사_색_값을_잡고_비슷한_글자는_안_잡는다', () => {
    for (const text of [
      "color: '#FF5A00'",
      'color: "#ff5a00aa"',
      'background: rgb(0, 0, 0)',
      'background: rgba(0, 0, 0, .5)',
      "color: '#FFF'",
      "color: '#fff8'",
      "color: 'white'",
      'color: "Black"',
      "color: 'orange'",
    ]) {
      expect(COLOUR_LITERAL.test(text)).toBe(true);
    }
    for (const text of [
      'testID="choice-1"',
      'scroll(0)',
      'tokens.color.brand',
      "backgroundColor: 'transparent'",
      "'whiteSpace'",
      "label: '하얀색'",
      '#12',
    ]) {
      expect(COLOUR_LITERAL.test(text)).toBe(false);
    }
    expect(hits([{ path: 'a.ts', text: "x\ncolor: '#FF5A00'" }], COLOUR_LITERAL)).toEqual(["a.ts:2: color: '#FF5A00'"]);
  });

  test('G02_검사_대상이_실제로_있다_빈손으로_통과하지_않는다', () => {
    const paths = sourceFiles().map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining(['planning/planning-flow.tsx', 'app/dev/health.tsx', LAYOUT_FILE, PLACEHOLDER_FILE, SOS_FILE, PRIMARY_FILE]),
    );
    expect(paths.length).toBeGreaterThanOrEqual(12);
  });

  test('G03_B6_G1_Q13_앱_소스에_색_값이_없다_placeholderFor_파일만_예외', () => {
    const files = sourceFiles().filter((f) => f.path !== PLACEHOLDER_FILE);
    expect(hits(files, COLOUR_LITERAL)).toEqual([]);
  });

  test('G04_B6_G1_예외_파일에는_표의_색이_실제로_있다_예외가_빈_허용이_아니다', () => {
    expect(readFileSync(join(SRC, PLACEHOLDER_FILE), 'utf8')).toMatch(/#476C94/i); // TASK-010 §C5: DESIGN-001 §4-8 food 밝은 끝
  });

  test('G05_B1_Q28_글자_크기_줄_높이_모서리_숫자는_어디에도_없다_layout도_예외_아님', () => {
    expect(hits(sourceFiles(), SIZE_LITERAL)).toEqual([]);
  });

  test('G06_Q13_transparent만_허용하므로_G03_검사가_빈_허용이_아니다', () => {
    const sample = [{ path: 'a.tsx', text: "a: 'transparent'\nb: 'white'\nc: rgba(0,0,0,1)\nd: '#FFF'" }];
    expect(hits(sample, COLOUR_LITERAL)).toEqual(["a.tsx:2: b: 'white'", 'a.tsx:3: c: rgba(0,0,0,1)', "a.tsx:4: d: '#FFF'"]);
  });

  test('G31_도구_검사_레이아웃_숫자를_잡고_토큰은_안_잡는다', () => {
    for (const text of ['height: 108', 'minHeight: 44', 'width={120}', 'borderWidth: 2', 'borderTopWidth: 1']) {
      expect(LAYOUT_LITERAL.test(text)).toBe(true);
    }
    for (const text of ['height: layout.tile', 'width: size.card', 'borderRadius: radius.lg', 'hitSlop={slop}']) {
      expect(LAYOUT_LITERAL.test(text)).toBe(false);
    }
    for (const text of ['fontSize: 15', 'lineHeight={22}', 'borderRadius: 24', 'borderBottomLeftRadius: 6']) {
      expect(SIZE_LITERAL.test(text)).toBe(true);
    }
  });

  test('G32_Q28_높이_너비_테두리_숫자는_layout_ts_한_파일에만', () => {
    const files = sourceFiles().filter((f) => f.path !== LAYOUT_FILE);
    expect(hits(files, LAYOUT_LITERAL)).toEqual([]);
  });

  // TASK-010 §E1·§12 답 6: 고르기·입력 토큰(DESIGN-001 §4-7)은 tokens.json에서 읽는다. layout.ts에도 숫자로 적지 않는다
  test.each([
    ['radio', 'radio'],
    ['actionBar', 'action-bar'],
    ['rowAlt', 'row-alt'],
    ['rowDrop', 'row-drop'],
    ['thumbSm', 'thumb-sm'],
    ['field', 'field'],
    ['tabDay', 'tab-day'],
    ['sheetForm', 'sheet-form'],
  ])('G33a_E1_고르기_토큰_%s(%s)는_layout_ts에_숫자로_적지_않는다', (key) => {
    expect(readFileSync(join(SRC, LAYOUT_FILE), 'utf8')).not.toMatch(new RegExp(`\\b${key}\\s*:\\s*\\d`));
  });

  // TASK-010 §13 질문 3: §4-10 여행 만들기 부품도 tokens.json에서 읽는다. layout.ts에 숫자로 적지 않는다
  test.each([
    ['sheetCal', 'sheet-cal'],
    ['calCellW', 'cal-cell'],
    ['calCellH', 'cal-cell'],
    ['calDisc', 'cal-disc'],
    ['calRing', 'cal-disc'],
    ['calOff', 'cal-off'],
    ['calBand', 'cal-band'],
    ['calTodayDot', 'cal-today-dot'],
    ['calHead', 'cal-head'],
    ['calNav', 'cal-nav'],
    ['calSlot', 'cal-slot'],
    ['coverTile', 'cover-tile'],
    ['coverBanner', 'cover-banner'],
    ['addDot', 'add-dot'],
    ['lodgeThumb', 'lodge-thumb'],
    ['listMax', 'list-max'],
    ['googleSlot', 'g-slot'],
    ['googleFooter', 'g-footer'],
  ])('G33c_S13_여행_만들기_토큰_%s(%s)는_layout_ts에_숫자로_적지_않는다', (key) => {
    expect(readFileSync(join(SRC, LAYOUT_FILE), 'utf8')).not.toMatch(new RegExp(`\\b${key}\\s*:\\s*[\\d\\[]`));
  });

  test('G33d_S13_Google_글자_색은_화면_소스에_hex로_없다', () => {
    const files = sourceFiles().filter((f) => f.path !== PLACEHOLDER_FILE);
    expect(hits(files, /#5E5E5E\b/i)).toEqual([]);
  });

  test('G33b_E1_고르기_색은_화면_소스에_hex로_없다_토큰에서_읽는다', () => {
    // sel-bg·field-error-bg·field-error는 다른 색의 별명이라 값이 같다. 화면 소스(placeholderFor 예외 파일 밖)에 그 값을 직접 쓰지 않는다
    const files = sourceFiles().filter((f) => f.path !== PLACEHOLDER_FILE);
    expect(hits(files, /#(FFF1E8|FFEDD5|C2410C)\b/i)).toEqual([]);
  });

  test.each([
    ['타일 108', /\b108\b/],
    ['사진 316', /\b316\b/],
    ['동선 그림 120', /\b120\b/],
    ['떠 있는 줄 72', /\b72\b/],
    ['고리 2.5', /\b2\.5\b/],
  ])('G33_Q28_layout_ts에_문서의_크기가_모여_있다_%s', (_name, value) => {
    expect(readFileSync(join(SRC, LAYOUT_FILE), 'utf8')).toMatch(value);
  });
});

// ---------- G2: 대비 ----------

describe('G2', () => {
  test.each(CONTRAST_PAIRS)('G07_B6_G2_토큰_%s_on_%s_대비_4_5_이상', (fg, bg) => {
    const tokens = readFileSync(TOKENS, 'utf8').toUpperCase();
    expect(tokens).toContain(COLORS[fg]);
    expect(tokens).toContain(COLORS[bg]);
    expect(contrast(COLORS[fg], COLORS[bg])).toBeGreaterThanOrEqual(4.5);
  });

  test('G08_B3_보조_버튼_ink_on_bg_2도_4_5_이상', () => {
    expect(contrast(COLORS.ink, COLORS['bg-2'])).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------- G3: 누르는 영역 ----------

type Host = { type: string; props: Record<string, any>; parent: Host | null };

function reach(host: Host): { height?: number; width?: number } {
  const style = StyleSheet.flatten(host.props.style) ?? {};
  const slop = host.props.hitSlop ?? {};
  const add = (a: unknown, b: unknown) =>
    typeof slop === 'number' ? 2 * slop : Number(typeof a === 'number' ? a : 0) + Number(typeof b === 'number' ? b : 0);
  const size = (value: unknown, min: unknown) => {
    const numeric = [value, min].filter((v): v is number => typeof v === 'number');
    return numeric.length ? Math.max(...numeric) : undefined;
  };
  const height = size(style.height, style.minHeight);
  const width = size(style.width, style.minWidth);
  return {
    height: height === undefined ? undefined : height + add(slop.top, slop.bottom),
    width: width === undefined ? undefined : width + add(slop.left, slop.right),
  };
}

/** 누를 수 있는 View 전부 (역할 표시가 없어도 잡는다). 높이는 반드시 숫자, 폭은 숫자로 정했을 때만 본다. */
function pressables(): Host[] {
  return (screen.container as unknown as { queryAll: (p: (h: Host) => boolean) => Host[] }).queryAll(
    (host) => host.type === 'View' && typeof host.props.onClick === 'function',
  );
}

function expectTouchTargets() {
  const found = pressables();
  expect(found.length).toBeGreaterThan(0);
  const small = found
    .map((host) => ({ id: host.props.testID ?? host.props.accessibilityLabel ?? '(이름 없음)', ...reach(host) }))
    .filter(({ height, width }) => height === undefined || height < 44 || (width !== undefined && width < 44));
  expect(small).toEqual([]);
}

describe('G3', () => {
  test.each([
    ['44 정각', { height: 44, width: 44 }, undefined, true],
    ['43', { height: 43, width: 44 }, undefined, false],
    ['칩 36 + 위아래 4', { height: 36 }, { top: 4, bottom: 4 }, true],
    ['칩 36 + 위아래 3', { height: 36 }, { top: 3, bottom: 4 }, false],
    ['폭 43', { height: 44, width: 43 }, undefined, false],
    ['높이를 안 정함', { padding: 20 }, undefined, false],
    ['hitSlop 숫자 4', { height: 36, width: 36 }, 4, true],
  ])('G09_도구_검사_%s', async (_name, style, hitSlop, passes) => {
    await render(<Pressable testID="x" style={style} hitSlop={hitSlop as number} onPress={() => undefined} />);
    const check = () => expectTouchTargets();
    if (passes) check();
    else expect(check).toThrow();
  });

  test('G10_B6_G3_P1의_모든_누르는_부품_44_이상', async () => {
    happyServer();
    await toP1();
    expect(screen.getByTestId('choice-walk_alley')).toBeTruthy();
    expectTouchTargets();
  });

  test('G11_B6_G3_P2의_모든_누르는_부품_44_이상', async () => {
    happyServer();
    await toP2();
    for (const id of ['direction-quieter', 'like-D01', 'skip-D01', 'compose-button', 'sos-button']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expectTouchTargets();
  });

  test('G12_B6_G3_P3의_모든_누르는_부품_44_이상_펼친_줄_포함', async () => {
    happyServer();
    await toP3();
    await pressId('stay-D01');
    for (const id of ['stay-D01', 'stay-plus-D01', 'stay-minus-D01', 'option-relaxed', 'option-packed', 'header-back']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expectTouchTargets();
  });

  test('G13_B3_Q16_P3의_SOS와_뒤로_버튼은_44_이상의_원', async () => {
    happyServer();
    await toP3();
    for (const id of ['sos-button', 'header-back']) {
      const size = reach(screen.getByTestId(id) as unknown as Host);
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('G14_B6_G3_S0의_버튼도_44_이상', async () => {
    happyServer();
    await startApp();
    await screen.findByText('데모 여행 시작');
    expectTouchTargets();
  });

  test('G34_B6_G3_S9의_버튼도_44_이상', async () => {
    happyServer();
    await toS9();
    expectTouchTargets();
  });
});

// ---------- G4: SOS·입력창 ----------

function expectFixed(id: string) {
  let host = (screen.getByTestId(id) as unknown as Host).parent;
  while (host) {
    expect(host.type).not.toBe('RCTScrollView');
    host = host.parent;
  }
}

describe('G4', () => {
  const SCREENS: [string, () => Promise<unknown>][] = [
    ['P1', toP1],
    ['P2', toP2],
    ['P3', toP3],
  ];

  test.each(SCREENS)('G15_B6_G4_%s에_SOS가_같은_testID로_하나_입력창이_하나', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
    expect(screen.getAllByTestId('input-bar')).toHaveLength(1);
  });

  test.each(SCREENS)('G16_B3_%s의_SOS와_입력창은_스크롤에_따라_움직이지_않는다', async (_name, go) => {
    happyServer();
    await go();
    expectFixed('sos-button');
    expectFixed('input-bar');
  });

  test.each(SCREENS)('G17_B3_%s에서_SOS를_누르면_준비_중_시트와_닫기_서버_요청_없음', async (_name, go) => {
    const server = happyServer();
    await go();
    const before = server.requests.length;
    await pressId('sos-button');
    expect(await screen.findByText('긴급 도움은 준비 중이야')).toBeTruthy();
    await tap(screen.getByText('닫기'));
    expect(screen.queryByText('긴급 도움은 준비 중이야')).toBeNull();
    expect(server.requests).toHaveLength(before);
  });

  test.each(SCREENS)('G18_B3_%s에서_마이크를_누르면_곧_돼_서버_요청_없음', async (_name, go) => {
    const server = happyServer();
    await go();
    const before = server.requests.length;
    await pressId('mic-button');
    expect(await screen.findByText('곧 돼')).toBeTruthy();
    expect(server.requests).toHaveLength(before);
  });

  const BARE: [string, () => Promise<unknown>][] = [
    [
      'S0',
      async () => {
        await startApp();
        await screen.findByText('데모 여행 시작');
      },
    ],
    ['S9', () => toS9()],
  ];

  test.each(BARE)('G19_Q4_%s에는_SOS가_하나이고_스크롤에_따라_움직이지_않는다', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
    expectFixed('sos-button');
  });

  test.each(BARE)('G20_Q4_%s에는_입력창과_마이크가_없다', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.queryByTestId('input-bar')).toBeNull();
    expect(screen.queryByTestId('input-text')).toBeNull();
    expect(screen.queryByTestId('mic-button')).toBeNull();
  });

  test.each(BARE)('G35_Q4_B3_%s의_SOS를_누르면_준비_중_시트_서버_요청_없음', async (_name, go) => {
    const server = happyServer();
    await go();
    const before = server.requests.length;
    await pressId('sos-button');
    expect(await screen.findByText('긴급 도움은 준비 중이야')).toBeTruthy();
    await tap(screen.getByText('닫기'));
    expect(screen.queryByText('긴급 도움은 준비 중이야')).toBeNull();
    expect(server.requests).toHaveLength(before);
  });
});

// ---------- G5: danger는 SOS 부품에서만 ----------

describe('G5', () => {
  test('G21_B6_G5_danger는_SOS_부품_밖에서_쓰이지_않는다', () => {
    const others = sourceFiles().filter((f) => f.path !== SOS_FILE);
    expect(hits(others, /\bdanger\b/i)).toEqual([]);
  });

  test('G22_B3_SOS_부품은_실제로_danger_토큰을_쓴다', () => {
    expect(existsSync(join(SRC, SOS_FILE))).toBe(true);
    const source = readFileSync(join(SRC, SOS_FILE), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).toMatch(/\bdanger\b/);
  });
});

// ---------- G6: 상태 칩 ----------

describe('G6', () => {
  const CHIPS: ['confirmed' | 'unverified' | 'unknown', string, string][] = [
    ['confirmed', '확인됨', COLORS.ok],
    ['unverified', '미확인', COLORS.warn],
    ['unknown', '모름', COLORS.muted],
  ];

  test.each(CHIPS)('G23_B6_G6_%s_칩은_글자_%s와_색을_함께', async (status, text, colour) => {
    await render(<StatusChip status={status} />);
    const label = screen.getByText(text);
    expect(String(StyleSheet.flatten(label.props.style).color).toUpperCase()).toBe(colour);
  });

  test('G24_B6_G6_P2의_모든_후보_카드에_상태_글자가_있다', async () => {
    happyServer();
    await toP2();
    const expected: [string, string][] = [
      ['D01', '확인됨'],
      ['D02', '미확인'],
      ['D03', '모름'],
      ['D04', '확인됨'],
      ['D05', '미확인'],
      ['D06', '확인됨'],
    ];
    for (const [id, text] of expected) {
      expect(within(screen.getByTestId(`candidate-card-${id}`)).getByText(text)).toBeTruthy();
    }
  });

  test('G25_Q5_P3_각_줄에_hours_status_글자가_있다', async () => {
    happyServer();
    await toP3();
    expect(within(screen.getByTestId('course-row-1')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-2')).getByText('미확인')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-3')).getByText('확인됨')).toBeTruthy();
  });

  test('G36_Q5_P3_모름_상태도_글자로', async () => {
    const server = happyServer();
    const option = relaxed();
    option.items[0] = { ...option.items[0], hours_status: 'unknown' as never };
    server.on(R.compose, json(200, course([option])));
    await toP3();
    expect(within(screen.getByTestId('course-row-1')).getByText('모름')).toBeTruthy();
  });

  test('G37_Q5_P3_줄에는_영업_값_글자를_쓰지_않는다', async () => {
    happyServer();
    await toP3();
    for (const row of ['course-row-1', 'course-row-2', 'course-row-3']) {
      expect(within(screen.getByTestId(row)).queryByText(/오늘 휴무|영업시간 모름|\d{2}:\d{2}-\d{2}:\d{2}/)).toBeNull();
    }
  });
});

// ---------- G7: 주 버튼 글자색 ----------

describe('G7', () => {
  const textColour = (text: string) => String(StyleSheet.flatten(screen.getByText(text).props.style).color).toUpperCase();

  test('G26_B6_G7_주_버튼_부품의_글자색은_on_brand', async () => {
    await render(<PrimaryButton label="누름" onPress={() => undefined} />);
    expect(textColour('누름')).toBe(COLORS['on-brand']);
  });

  test('G27_B6_G7_주_버튼_소스는_on_brand_토큰을_쓴다', () => {
    const source = readFileSync(join(SRC, PRIMARY_FILE), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).toMatch(/on-brand|onBrand/);
  });

  test('G28_B4_화면의_주_버튼_글자도_on_brand', async () => {
    happyServer();
    await toP1();
    expect(textColour('아무거나 찾아 줘')).toBe(COLORS['on-brand']);
    await tap(screen.getByTestId('choice-cafe'));
    expect(textColour('이걸로 찾아 줘')).toBe(COLORS['on-brand']);
  });

  test('G29_B4_P2의_코스_짜기와_P3의_이걸로_할래도_on_brand', async () => {
    happyServer();
    await toP2();
    expect(textColour('코스 짜기')).toBe(COLORS['on-brand']);
    await pressId('compose-button');
    await screen.findByText('코스 짜 봤어');
    expect(textColour('이걸로 할래')).toBe(COLORS['on-brand']);
  });
});

// ---------- §9 ----------

// TASK-010 PM 답(11-09): 점검 전용 서버 주소(EXPO_PUBLIC_CHECK_API_URL)도 주소다.
// TASK-012 §10 승인(apps/mobile/CLAUDE.md): Supabase 프로젝트 URL·공개 키(+ 점검용 CHECK_ 둘)를 더한다. 그 밖의 EXPO_PUBLIC_ 변수는 여전히 금지
const ALLOWED_PUBLIC = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_CHECK_API_URL',
  'EXPO_PUBLIC_CHECK_SUPABASE_KEY',
  'EXPO_PUBLIC_CHECK_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_KEY',
  'EXPO_PUBLIC_SUPABASE_URL',
];
test('G30_S9_T12_EXPO_PUBLIC_변수는_허용_목록_안에서만', () => {
  const names = [...new Set(sourceFiles().flatMap((f) => f.text.match(/EXPO_PUBLIC_\w+/g) ?? []))];
  expect(names.filter((name) => !ALLOWED_PUBLIC.includes(name))).toEqual([]);
});

test('G30_S9_T12_비밀_키_이름은_앱에_0', () => {
  // ADR-016 §3-3: 앱에 들어가는 키는 공개 키뿐. secret·service_role 이름은 EXPO_PUBLIC_이든 아니든 0
  const names = sourceFiles().flatMap((f) => f.text.match(/\w*(SECRET|SERVICE_ROLE|service_role|sb_secret_)\w*/g) ?? []);
  expect(names).toEqual([]);
});

// ---------- §13 ----------

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const root = () => screen.container as unknown as Tree;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const textOf = (host: Tree) => {
  const flat = (value: unknown): string => (Array.isArray(value) ? value.map(flat).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  return flat(host.props.children);
};
const textsUnder = (host: Tree) => host.queryAll((inner) => inner.type === 'Text');

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

describe('§13-2 #1 그림자', () => {
  const expectShadow = (style: Record<string, any>) => {
    expect(style.shadowColor).toBe(COLORS['on-brand']);
    expect(style.shadowOffset).toEqual(expect.objectContaining({ height: expect.any(Number) }));
    expect(style.shadowOpacity).toBeGreaterThan(0);
    expect(style.shadowRadius).toBeGreaterThan(0);
    expect(style.elevation).toBeGreaterThan(0);
  };

  test.each([
    ['P1', toP1],
    ['P2', toP2],
    ['P3', toP3],
  ] as [string, () => Promise<unknown>][])('G38_S13_1_%s_떠_있는_줄에_그림자가_실제로_있다', async (_name, go) => {
    happyServer();
    await go();
    expectShadow(styleOf(byId('floating-bar')));
    expect(styleOf(byId('floating-bar')).shadowOffset.height).toBeGreaterThan(0);
  });

  test('G39_S13_1_SOS_시트에_위쪽으로_드리운_그림자가_실제로_있다', async () => {
    happyServer();
    await toP1();
    await pressId('sos-button');
    expectShadow(styleOf(byId('sos-sheet')));
    expect(styleOf(byId('sos-sheet')).shadowOffset.height).toBeLessThan(0);
  });
});

describe('§13-2 #3 칩 누르는 영역', () => {
  /** 위로 올라가며 가로 스크롤 영역까지의 높이를 잰다. 조상이 칩 높이로 줄어 있으면 hitSlop이 잘린다. */
  function reachInsideScroll(host: Tree) {
    const own = reach(host as unknown as Host).height ?? 0;
    let room = Number(styleOf(host).height ?? styleOf(host).minHeight ?? 0);
    let current = host.parent;
    while (current) {
      const style = styleOf(current);
      const vertical = style.paddingVertical ?? style.padding;
      const padding = vertical !== undefined ? 2 * vertical : (style.paddingTop ?? 0) + (style.paddingBottom ?? 0);
      room = Math.max(room + padding, style.height ?? 0, style.minHeight ?? 0);
      if (current.type === 'RCTScrollView') {
        // 안쪽 묶음의 스타일은 RN 가짜 ScrollView에서 contentContainerStyle 속성으로 남는다
        const inner = StyleSheet.flatten(current.props.contentContainerStyle) ?? {};
        const innerVertical = inner.paddingVertical ?? inner.padding;
        const innerPadding = innerVertical !== undefined ? 2 * Number(innerVertical) : Number(inner.paddingTop ?? 0) + Number(inner.paddingBottom ?? 0);
        const start = Number(styleOf(host).height ?? styleOf(host).minHeight ?? 0);
        room = Math.max(room + innerPadding, Number(inner.height ?? 0), Number(inner.minHeight ?? 0), start);
        return { own, room };
      }
      current = current.parent;
    }
    return { own, room: 0 };
  }

  const expectChipReach = (id: string) => {
    const { own, room } = reachInsideScroll(byId(id));
    expect(own).toBeGreaterThanOrEqual(44);
    expect(room).toBeGreaterThanOrEqual(44);
  };

  const noop = () => undefined;
  test.each<[string, object | undefined, object, boolean]>([
    ['스크롤 영역이 칩 높이면 hitSlop이 잘린다', { top: 4, bottom: 4 }, { height: 36 }, false],
    ['칩 36 + 위아래 4 + 스크롤 안쪽 위아래 4', { top: 4, bottom: 4 }, { height: 36 }, true],
    ['감싸는 44 높이', undefined, { height: 44 }, true],
    ['hitSlop 3이면 43', { top: 3, bottom: 4 }, { height: 36 }, false],
  ])('G40_도구_검사_%s', async (name, slop, style, passes) => {
    await render(
      <ScrollView horizontal contentContainerStyle={name.includes('안쪽') ? { paddingVertical: 4 } : undefined}>
        <View>
          <Pressable testID="chip" hitSlop={slop} style={style} onPress={noop} />
        </View>
      </ScrollView>,
    );
    if (passes) expectChipReach('chip');
    else expect(() => expectChipReach('chip')).toThrow();
  });

  test('G41_S13_3_방향_칩의_44가_스크롤_영역에_잘리지_않는다', async () => {
    happyServer();
    await toP2();
    expectChipReach('direction-quieter');
    expectChipReach('direction-closer');
  });

  test('G42_S13_3_되묻기_칩의_44가_스크롤_영역에_잘리지_않는다', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ clarify: [{ id: 'food', label: '먹을 데' }] })));
    await toP2();
    expectChipReach('clarify-food');
  });
});

describe('§13-2 #6 #8 숫자는 layout·토큰으로', () => {
  const ICON_LITERAL = /\b(size|strokeWidth|r|rx|ry)\s*[:=]\s*\{?\s*-?\d/;

  test('G43_도구_검사_아이콘_크기_숫자를_잡는다', () => {
    for (const text of ['size={16}', 'size: 16', 'strokeWidth={3}', 'r={11}']) expect(ICON_LITERAL.test(text)).toBe(true);
    for (const text of ['size={layout.check}', 'size = control.icon', 'strokeWidth={layout.routeLine}', 'gear={1}']) {
      expect(ICON_LITERAL.test(text)).toBe(false);
    }
  });

  test('G44_S13_6_아이콘_크기_숫자는_layout_ts_한_파일에만', () => {
    const files = sourceFiles().filter((f) => f.path !== LAYOUT_FILE);
    expect(hits(files, ICON_LITERAL)).toEqual([]);
  });

  test('G45_S13_8_담기_움직임_시간은_토큰으로_420을_직접_쓰지_않는다', () => {
    expect(hits(sourceFiles(), /\b420\b/)).toEqual([]);
    expect(sourceFiles().some((f) => f.text.includes("dur-draw"))).toBe(true);
  });
});

describe('§13-2 #10 칩 글자', () => {
  const expectLabel = (id: string) => {
    const [label] = textsUnder(byId(id));
    const style = styleOf(label);
    expect(style.fontSize).toBe(TYPE.label.size);
    expect(style.lineHeight).toBe(TYPE.label.lineHeight);
    expect(String(style.fontFamily)).toMatch(/NotoSansKR.*600/);
  };

  test('G46_S13_10_방향_칩_글자는_label_12_16_600', async () => {
    happyServer();
    await toP2();
    expectLabel('direction-quieter');
  });

  test('G47_S13_10_되묻기_칩_글자도_label', async () => {
    const server = happyServer();
    server.on(R.answer, json(200, batch({ clarify: [{ id: 'food', label: '먹을 데' }] })));
    await toP2();
    expectLabel('clarify-food');
  });
});

describe('§13-3 #2 scrim', () => {
  const CONCAT = /\bcolor(?:\.\w+|\[[^\]]*\])\s*\+|\$\{\s*color\b|\bcolor(?:\.\w+|\[[^\]]*\])\.concat\(/;

  test('G48_도구_검사_색에_글자를_붙이는_것을_잡는다', () => {
    for (const text of ["color.ink + '66'", "color['on-brand'] + '66'", '`${color.ink}66`', "color.ink.concat('66')"]) {
      expect(CONCAT.test(text)).toBe(true);
    }
    for (const text of ['color.ink', "color['bg-2']", 'backgroundColor: color.scrim', 'width + 2']) {
      expect(CONCAT.test(text)).toBe(false);
    }
  });

  test('G49_S13_2_토큰_밖_색_조합_색_더하기_투명도_글자가_소스에_없다', () => {
    expect(hits(sourceFiles(), CONCAT)).toEqual([]);
  });

  test.each(ALL_SCREENS)('G50_S13_2_%s_시트_뒤_막은_scrim_토큰', async (_name, go) => {
    happyServer();
    await go();
    await pressId('sos-button');
    expect(styleOf(byId('sheet-scrim')).backgroundColor).toBe(STRINGS.scrim);
  });

  test('G51_S13_2_scrim_값은_DESIGN_001_그대로', () => {
    expect(STRINGS.scrim).toBe('rgba(26,26,26,0.40)');
    expect(readFileSync(join(REPO_ROOT, 'docs', 'DESIGN-001_Brand-Tokens.md'), 'utf8')).toContain(STRINGS.scrim);
  });
});

describe('§13-3 비활성', () => {
  const OPACITY = /\bopacity\s*[:=]/;

  const expectPlainDisabled = (button: { props: Record<string, any> }) => {
    const style = styleOf(button);
    expect(style.backgroundColor).toBe(COLORS['bg-2']);
    expect(style.opacity ?? 1).toBe(1);
  };

  test('G52_도구_검사_opacity를_잡고_그림자는_안_잡는다', () => {
    for (const text of ['opacity: 0.5', 'dim: { opacity: 0.5 }', 'opacity={0.5}']) expect(OPACITY.test(text)).toBe(true);
    for (const text of ['shadowOpacity: 0.1', 'stopOpacity={1}']) expect(OPACITY.test(text)).toBe(false);
  });

  test('G53_S13_비활성을_opacity로_만들지_않는다_소스_전체', () => {
    expect(hits(sourceFiles(), OPACITY)).toEqual([]);
  });

  test('G54_S13_주_버튼_비활성은_bg_2_바탕_muted_글자_opacity_없음', async () => {
    await render(<PrimaryButton testID="b" label="누름" disabled onPress={() => undefined} />);
    expectPlainDisabled(screen.getByTestId('b'));
    expect(styleOf(screen.getByText('누름')).color).toBe(COLORS.muted);
  });

  test('G55_S13_보조_버튼_비활성도_bg_2_바탕_muted_글자_opacity_없음', async () => {
    await render(<SecondaryButton testID="b" label="누름" disabled onPress={() => undefined} />);
    expectPlainDisabled(screen.getByTestId('b'));
    expect(styleOf(screen.getByText('누름')).color).toBe(COLORS.muted);
  });

  test('G56_S13_활성이면_주_버튼은_brand_보조는_ink_글자', async () => {
    await render(
      <>
        <PrimaryButton testID="p" label="주" onPress={() => undefined} />
        <SecondaryButton testID="s" label="보조" onPress={() => undefined} />
      </>,
    );
    expect(styleOf(screen.getByTestId('p')).backgroundColor).toBe(COLORS.brand);
    expect(styleOf(screen.getByText('주')).color).toBe(COLORS['on-brand']);
    expect(styleOf(screen.getByText('보조')).color).toBe(COLORS.ink);
  });

  const BUSY: [string, () => Promise<unknown>, string, () => Promise<unknown>][] = [
    ['P1', toP1, R.answer, () => pressText('아무거나 찾아 줘')],
    ['P2', toP2, R.compose, () => pressId('compose-button')],
    ['P3', toP3, R.back, () => pressText('더 고를래')],
  ];

  test.each(BUSY)('G57_S13_%s_요청_중_막힌_버튼은_모두_bg_2_바탕이고_글자는_muted', async (_name, go, route, act) => {
    const server = happyServer();
    await go();
    server.once(route, { kind: 'hang' });
    await act();
    const disabled = root().queryAll(
      (host) => host.type === 'View' && typeof host.props.onClick === 'function' && host.props.accessibilityState?.disabled === true,
    );
    expect(disabled.length).toBeGreaterThan(0);
    for (const button of disabled) {
      expectPlainDisabled(button);
      for (const label of textsUnder(button)) expect(styleOf(label).color).toBe(COLORS.muted);
    }
  });

  test('G58_S13_S0_요청_중_시작_버튼도_같다', async () => {
    const server = happyServer();
    server.once(R.seed, { kind: 'hang' });
    await startApp();
    await pressText('데모 여행 시작');
    expect(styleOf(screen.getByText('데모 여행 시작')).color).toBe(COLORS.muted);
  });
});

describe('§13-3 글꼴', () => {
  const HANGUL = /[가-힣]/;
  const family = (host: { props: Record<string, any> }) => String(styleOf(host).fontFamily);

  test.each(ALL_SCREENS)('G59_S13_%s_DM_Mono에_한글이_섞인_글이_없다', async (_name, go) => {
    happyServer();
    await go();
    const wrong = textsUnder(root())
      .filter((host) => /mono/i.test(family(host)) && HANGUL.test(textOf(host)))
      .map(textOf);
    expect(wrong).toEqual([]);
  });

  test('G60_S13_머문_시간_글은_font_text', async () => {
    happyServer();
    await toP3();
    expect(family(within(screen.getByTestId('course-row-1')).getByText('1시간 30분'))).toMatch(/NotoSansKR/);
  });

  test('G61_S13_B4_시각과_번호는_DM_Mono', async () => {
    happyServer();
    await toP2();
    expect(family(within(screen.getByTestId('candidate-card-D01')).getByText('01 / 06'))).toMatch(/mono/i);
    await pressId('compose-button');
    await screen.findByText('코스 짜 봤어');
    expect(family(within(screen.getByTestId('course-row-1')).getByText('10:10'))).toMatch(/mono/i);
  });
});

describe('§13-3 아바타', () => {
  const painted = (host: Tree) => {
    const style = styleOf(host);
    return [host.props.fill, host.props.stroke, style.backgroundColor, style.borderColor].filter(
      (value) => typeof value === 'string' && value !== 'none' && value !== 'transparent',
    );
  };

  test('G62_S13_아바타는_T_글자가_아니라_ink_원_32', async () => {
    await render(<FriendBubble message="말" />);
    expect(screen.queryByText('T')).toBeNull();
    const style = styleOf(byId('friend-avatar'));
    expect(style.backgroundColor).toBe(COLORS.ink);
    expect(style.width).toBe(32);
    expect(style.height).toBe(32);
    expect(style.borderRadius).toBe(999);
    expect(textsUnder(byId('friend-avatar'))).toEqual([]);
  });

  test('G63_S13_아바타의_눈과_입은_흰색_도형', async () => {
    await render(<FriendBubble message="말" />);
    const inner = byId('friend-avatar')
      .queryAll((host) => host.type === 'View')
      .flatMap(painted);
    expect(inner.length).toBeGreaterThan(0);
    for (const value of inner) expect(String(value).toUpperCase()).toBe(COLORS.surface);
  });

  test.each([
    ['P1', toP1],
    ['P2', toP2],
  ] as [string, () => Promise<unknown>][])('G64_S13_%s_말풍선에도_T_글자_없이_아바타', async (_name, go) => {
    happyServer();
    await go();
    expect(screen.queryByText('T')).toBeNull();
    expect(screen.getByTestId('friend-avatar')).toBeTruthy();
  });
});

describe('§13-3 로고', () => {
  const LOGO = join(MOBILE_ROOT, 'assets', 'brand', 'logo-ink.png');

  test('G65_S13_확정_로고가_assets_brand에_같은_파일로_있다', () => {
    expect(existsSync(LOGO)).toBe(true);
    expect(readFileSync(LOGO).equals(readFileSync(join(REPO_ROOT, 'docs', 'design', 'logo-ink.png')))).toBe(true);
  });

  test('G66_S13_S0이_확정_로고를_보여_준다', async () => {
    happyServer();
    await startApp();
    await screen.findByText('데모 여행 시작');
    expect(screen.getByTestId('s0-logo').props.source).toBeTruthy();
    expect(hits(sourceFiles(), /assets\/brand\/logo-ink\.png/).length).toBeGreaterThan(0);
  });

  test('G67_S13_임시_로고는_지웠다', () => {
    expect(hits(sourceFiles(), /LogoTile|logoTile/)).toEqual([]);
    const s0 = sourceFiles().filter((f) => f.path === 'planning/screens/s0.tsx');
    expect(s0).toHaveLength(1);
    expect(hits(s0, /LinearGradient|sunset/)).toEqual([]);
  });
});

describe('§13-3 #5 주황 4% (폰 크기 390x844, 계산할 수 있는 면적만)', () => {
  const PHONE = { width: 390, height: 844, scale: 2, fontScale: 1 };
  const LIMIT = 0.04 * PHONE.width * PHONE.height;
  let window: ReturnType<typeof Dimensions.get>;

  beforeEach(() => {
    window = Dimensions.get('window');
    Dimensions.set({ window: PHONE, screen: PHONE });
  });

  afterEach(() => {
    Dimensions.set({ window, screen: window });
  });

  // TASK-006 D4·§11-4: 주 버튼은 고정 높이 대신 최소 높이가 된다. 둘 다 잰다
  const isPrimary = (host: Tree) => styleOf(host).backgroundColor === COLORS.brand && (styleOf(host).height ?? styleOf(host).minHeight) === 52;
  const isBrand = (value: unknown) => String(value).toUpperCase() === COLORS.brand;

  /** 주 버튼을 뺀 주황 면적. box: 크기를 스타일에 안 적은 고리의 상자 */
  function brandArea(scope: Tree, box?: { width: number; height: number }) {
    return scope
      .queryAll((host) => host.type === 'View' && !isPrimary(host))
      .reduce((sum, host) => {
        const style = styleOf(host);
        let area = 0;
        if (isBrand(style.backgroundColor)) area += Number(style.width) * Number(style.height);
        if (isBrand(style.borderColor)) {
          const width = Number(style.width ?? box?.width);
          const height = Number(style.height ?? box?.height);
          area += 2 * (width + height) * Number(style.borderWidth);
        }
        if (isBrand(host.props.stroke)) {
          const stroke = Number(host.props.strokeWidth);
          if (host.props.points !== undefined) {
            const points = String(host.props.points).trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
            const length = points.slice(1).reduce((total, [x, y], i) => total + Math.hypot(x - points[i][0], y - points[i][1]), 0);
            area += length * stroke;
          } else {
            area += 2 * Math.PI * Number(host.props.r) * stroke;
          }
        }
        if (isBrand(host.props.fill)) area += Math.PI * Number(host.props.r) ** 2;
        return sum + area;
      }, 0);
  }

  test('G68_S13_5_도구_검사_넘치는_면적을_잡는다', async () => {
    await render(
      <>
        <View testID="big" style={{ backgroundColor: COLORS.brand, width: 390, height: 34 }} />
        <View testID="main" style={{ backgroundColor: COLORS.brand, width: 390, height: 52 }} />
      </>,
    );
    expect(brandArea(root())).toBe(390 * 34);
    expect(brandArea(root())).toBeGreaterThan(LIMIT);
  });

  test('G69_S13_5_P1_타일을_모두_골라도_고리는_4퍼센트_이하', async () => {
    happyServer();
    await toP1();
    for (const id of ['walk_alley', 'food_tour', 'shopping', 'night_view', 'cafe', 'museum_experience']) await pressId(`choice-${id}`);
    const tile = { width: (PHONE.width - 2 * layout.screenMargin - 12) / 2, height: layout.tile };
    const area = brandArea(root(), tile);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThanOrEqual(LIMIT);
  });

  test('G70_S13_5_P2_담은_카드_한_장의_주황은_4퍼센트_이하', async () => {
    const server = happyServer();
    server.on(R.reactions, json(200, picks(['D01'])));
    await toP2();
    await pressId('like-D01');
    await screen.findByText('1곳 담았어');
    const area = brandArea(byId('candidate-card-D01'));
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThanOrEqual(LIMIT);
  });

  test('G71_S13_5_P3_동선과_그_밖의_주황은_주_버튼_빼고_4퍼센트_이하', async () => {
    happyServer();
    await toP3();
    const area = brandArea(root());
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThanOrEqual(LIMIT);
  });

  test.each(ALL_SCREENS)('G72_S13_5_S4_1_%s_주황으로_쓴_글자가_없다', async (_name, go) => {
    happyServer();
    await go();
    const wrong = textsUnder(root()).filter((host) => isBrand(styleOf(host).color)).map(textOf);
    expect(wrong).toEqual([]);
  });
});

describe('§13-3 Q34 머리 제목', () => {
  /** SOS에서 위로 올라가 본문 스크롤을 품기 직전까지가 머리다 */
  function headerTexts() {
    let header = byId('sos-button');
    while (header.parent && header.parent.queryAll((host) => host.type === 'RCTScrollView').length === 0) header = header.parent;
    return textsUnder(header).map(textOf).filter((value) => value !== 'SOS');
  }

  test.each<[string, () => Promise<unknown>, string[]]>([
    ['S0', ALL_SCREENS[0][1], []],
    ['S9', ALL_SCREENS[4][1], []],
    ['P1은 제목이 있어서 검사가 빈손이 아니다', toP1, ['2일째 계획', '12월 2일 수 · 10:00–20:00']], // TASK-011 §4-11
  ])('G73_Q34_%s_머리_글자', async (_name, go, expected) => {
    happyServer();
    await go();
    expect(headerTexts()).toEqual(expected);
  });
});
