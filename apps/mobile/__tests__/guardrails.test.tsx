/// <reference types="jest" />
// 가드레일. 근거: TASK-004 §B-1, §B-3, §B-6 G1~G7, §9, AC-6, DESIGN-001 §2·§4-4
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react-native';
import { Pressable, StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/planning/primary-button';
import { StatusChip } from '@/components/planning/status-chip';
import { contrast } from '@/lib/contrast';

import { CONTRAST_PAIRS, COLORS } from '../test-support/design-table';
import { happyServer, pressId, resetDevice, tap, toP1, toP2, toP3, toS9 } from '../test-support/planning-driver';
import { hits, REPO_ROOT, SRC, sourceFiles } from '../test-support/source-files';

const TOKENS = join(REPO_ROOT, 'packages', 'design-tokens', 'tokens.json');
const PLACEHOLDER_FILE = 'lib/placeholder-for.ts';
const SOS_FILE = 'components/planning/sos-button.tsx';
const PRIMARY_FILE = 'components/planning/primary-button.tsx';
// §B-6 G1: `#RRGGBB`(8자리 #RRGGBBAA도 앞 6자리로 잡힘)와 `rgb(`
const COLOUR_LITERAL = /#[0-9a-fA-F]{6}|\brgb\(/;
// §B-1: 숫자 글자 크기·모서리 값 직접 쓰기 금지
const SIZE_LITERAL = /\b(fontSize|lineHeight|border\w*Radius)\s*:\s*-?\d/;

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- G1: 소스에 색 값 없음 ----------

describe('G1', () => {
  test('G01_도구_검사_색_값을_잡고_비슷한_글자는_안_잡는다', () => {
    for (const text of ["color: '#FF5A00'", 'color: "#ff5a00aa"', 'background: rgb(0, 0, 0)']) {
      expect(COLOUR_LITERAL.test(text)).toBe(true);
    }
    for (const text of ['testID="choice-1"', 'scroll(0)', 'tokens.color.brand']) {
      expect(COLOUR_LITERAL.test(text)).toBe(false);
    }
    expect(hits([{ path: 'a.ts', text: "x\ncolor: '#FF5A00'" }], COLOUR_LITERAL)).toEqual(["a.ts:2: color: '#FF5A00'"]);
  });

  test('G02_검사_대상이_실제로_있다_빈손으로_통과하지_않는다', () => {
    const paths = sourceFiles().map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['planning/planning-flow.tsx', PLACEHOLDER_FILE, SOS_FILE, PRIMARY_FILE]));
    expect(paths.length).toBeGreaterThanOrEqual(12);
  });

  test('G03_B6_G1_앱_소스에_색_값이_없다_placeholderFor_파일만_예외', () => {
    const files = sourceFiles().filter((f) => f.path !== PLACEHOLDER_FILE);
    expect(hits(files, COLOUR_LITERAL)).toEqual([]);
  });

  test('G04_B6_G1_예외_파일에는_표의_색이_실제로_있다_예외가_빈_허용이_아니다', () => {
    expect(readFileSync(join(SRC, PLACEHOLDER_FILE), 'utf8')).toMatch(/#8FA3B8/i);
  });

  test('G05_B1_숫자_글자_크기와_모서리를_직접_쓰지_않는다', () => {
    expect(hits(sourceFiles(), SIZE_LITERAL)).toEqual([]);
  });

  test.skip('G06_질문대기_Q13_rgba와_3자리_hex와_색_이름도_막는다', () => {
    expect(hits(sourceFiles().filter((f) => f.path !== PLACEHOLDER_FILE), /\brgba\(|#[0-9a-fA-F]{3}\b|'(white|black)'/)).toEqual([]);
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
    for (const id of ['direction-quieter', 'like-D01', 'skip-D01', 'compose-button', 'sos-button', 'header-back']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expectTouchTargets();
  });

  test('G12_B6_G3_P3의_모든_누르는_부품_44_이상_펼친_줄_포함', async () => {
    happyServer();
    await toP3();
    await pressId('stay-D01');
    for (const id of ['stay-D01', 'stay-plus-D01', 'stay-minus-D01', 'option-relaxed', 'option-packed']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expectTouchTargets();
  });

  test('G13_B3_SOS와_뒤로_버튼은_정확히_44_이상의_원', async () => {
    happyServer();
    await toP1();
    for (const id of ['sos-button', 'header-back']) {
      const size = reach(screen.getByTestId(id) as unknown as Host);
      expect(size.height).toBeGreaterThanOrEqual(44);
      expect(size.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('G14_B6_G3_S0과_S9의_버튼도_44_이상', async () => {
    const server = happyServer();
    await toS9(server);
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

  test.skip('G19_질문대기_Q4_S0과_S9에도_SOS가_있다', async () => {
    const server = happyServer();
    await toS9(server);
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
  });

  test.skip('G20_질문대기_Q4_S0과_S9에도_입력창이_있다', async () => {
    const server = happyServer();
    await toS9(server);
    expect(screen.getAllByTestId('input-bar')).toHaveLength(1);
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

  test.skip('G25_질문대기_Q5_P3_코스_줄에도_상태_글자가_있다', async () => {
    happyServer();
    await toP3();
    expect(within(screen.getByTestId('course-row-1')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-2')).getByText('미확인')).toBeTruthy();
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
