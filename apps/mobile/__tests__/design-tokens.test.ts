/// <reference types="jest" />
// 디자인 토큰. 근거: TASK-004 §B-1, AC-4, §13-3 #2(scrim), DESIGN-001 §1·§2·§4 (표는 test-support/design-table.ts에 옮겨 적음)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COLORS, FONTS, NUMBERS, STRINGS, TYPE } from '../test-support/design-table';
import { REPO_ROOT } from '../test-support/source-files';

const PACKAGE = join(REPO_ROOT, 'packages', 'design-tokens');
const TOKENS = join(PACKAGE, 'tokens.json');
const KNOWN = new Set([
  ...Object.keys(COLORS),
  ...Object.keys(FONTS),
  ...Object.keys(TYPE),
  ...Object.keys(NUMBERS),
  ...Object.keys(STRINGS),
]);

type Found = Map<string, unknown[]>;

/** 묶는 방법은 문서에 없다: 표의 이름을 어떤 깊이에서든 찾고, 표에 없는 값이 있으면 따로 모은다. */
function collect(node: unknown, found: Found, extras: string[], path = ''): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    extras.push(path);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (KNOWN.has(key)) found.set(key, [...(found.get(key) ?? []), value]);
    else collect(value, found, extras, here);
  }
}

function read() {
  const found: Found = new Map();
  const extras: string[] = [];
  collect(JSON.parse(readFileSync(TOKENS, 'utf8')), found, extras);
  return { found, extras };
}

const one = (name: string) => {
  const values = read().found.get(name);
  expect(values).toHaveLength(1);
  return values![0];
};

test('T01_B1_tokens_json_index_ts_README가_패키지에_있다', () => {
  expect(existsSync(TOKENS)).toBe(true);
  expect(existsSync(join(PACKAGE, 'index.ts'))).toBe(true);
  expect(existsSync(join(PACKAGE, 'README.md'))).toBe(true);
});

test('T02_B1_README에_금지가_적혀_있다', () => {
  expect(readFileSync(join(PACKAGE, 'README.md'), 'utf8')).toContain('금지');
});

test('T03_B1_index_ts는_tokens_json을_그대로_내보낸다', () => {
  const module = require(join(PACKAGE, 'index.ts'));
  expect(module.default).toEqual(JSON.parse(readFileSync(TOKENS, 'utf8')));
});

test.each(Object.entries(COLORS))('T04_AC4_색_%s는_%s', (name, value) => {
  expect(String(one(name)).toUpperCase()).toBe(value);
});

test.each(Object.entries(FONTS))('T05_AC4_글꼴_%s는_%s', (name, value) => {
  expect(one(name)).toBe(value);
});

test.each(Object.entries(TYPE))('T06_AC4_글자_크기_%s', (name, value) => {
  expect(one(name)).toMatchObject(value);
});

test.each(Object.entries(NUMBERS))('T07_AC4_숫자_%s는_%d', (name, value) => {
  expect(one(name)).toBe(value);
});

test.each(Object.entries(STRINGS))('T08_AC4_글자_값_%s', (name, value) => {
  expect(one(name)).toBe(value);
});

test.each([
  ['r-full', 999],
  ['r-xl', 24],
  ['r-tail', 6],
  ['sh-0', 'none'],
  ['icon-stroke', 1.75],
])('T09_Q15_Q28_v2_1_토큰_%s의_값은_%s', (name, value) => {
  expect(one(name)).toBe(value);
});

test('T15_Q15_옛_이름_sunset은_없고_두_이름만_있다', () => {
  expect(readFileSync(TOKENS, 'utf8')).not.toContain('"sunset"');
  expect(one('sunset-start')).toBe('#FF8C42');
  expect(one('sunset-end')).toBe('#FFA140');
});

test('T10_AC4_표에_없는_토큰이_없다', () => {
  expect(read().extras).toEqual([]);
});

test('T16_Q15_필드와_이름을_뒤섞지_않는다_토큰이_정확히_표의_수만큼', () => {
  const { found } = read();
  expect([...found.keys()].sort()).toEqual([...KNOWN].sort());
});

test('T11_S4_2_가장_작은_글자는_12px_이상', () => {
  const sizes = Object.keys(TYPE).map((name) => (one(name) as { size: number }).size);
  expect(Math.min(...sizes)).toBe(12);
});

test('T12_S4_1_muted는_옛_값이_아니다', () => {
  expect(readFileSync(TOKENS, 'utf8').toUpperCase()).not.toContain('#6B7280');
});

test('T13_S2_danger는_한_번만_적힌다', () => {
  const text = readFileSync(TOKENS, 'utf8').toUpperCase();
  expect(text.match(/#B42318/g)).toHaveLength(1);
});

test('T14_도구_검사_표에_없는_값을_잡아낸다', () => {
  const found: Found = new Map();
  const extras: string[] = [];
  collect({ color: { brand: '#FF5A00', 'made-up': '#000000' } }, found, extras);
  expect(found.has('brand')).toBe(true);
  expect(extras).toEqual(['color.made-up']);
});
