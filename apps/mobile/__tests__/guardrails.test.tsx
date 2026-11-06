/// <reference types="jest" />
// 가드레일. 근거: TASK-004 §B-1, §B-3, §B-6 G1~G7, §9, §12(Q4·Q5·Q13·Q16·Q25·Q28), AC-6, DESIGN-001 §2·§4-4
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react-native';
import { Pressable, StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/planning/primary-button';
import { StatusChip } from '@/components/planning/status-chip';
import { contrast } from '@/lib/contrast';

import { CONTRAST_PAIRS, COLORS } from '../test-support/design-table';
import { happyServer, pressId, R, resetDevice, startApp, tap, toP1, toP2, toP3, toS9 } from '../test-support/planning-driver';
import { json } from '../test-support/fake-server';
import { course, relaxed } from '../test-support/planning-fixtures';
import { hits, REPO_ROOT, SRC, sourceFiles } from '../test-support/source-files';

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
    expect(readFileSync(join(SRC, PLACEHOLDER_FILE), 'utf8')).toMatch(/#8FA3B8/i);
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

test('G30_S9_EXPO_PUBLIC_변수는_API_주소만', () => {
  const names = sourceFiles().flatMap((f) => f.text.match(/EXPO_PUBLIC_\w+/g) ?? []);
  expect(new Set(names)).toEqual(new Set(['EXPO_PUBLIC_API_URL']));
});
