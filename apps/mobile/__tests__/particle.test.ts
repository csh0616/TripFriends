/// <reference types="jest" />
// 조사 함수 (B1)와 P1 꼭 갈 곳 줄 (B2). 근거: TASK-009 §B B1·B2, §7 AC-3, TASK-008 §13 H4·§17, DESIGN-001 §4-7.
//
// 계약 (이 테스트가 정한 이름, 보고서 ④):
//   src/lib/particle.ts  export function withParticle(word: string, pair: '이/가' | '은/는' | '을/를' | '으로/로'): string
//     돌려주는 값 = word + 고른 조사 (사이 띄어쓰기 없음). 서버 trip/phrase.py with_particle과 같은 규칙
//   경계 표: 저장소 맨 위 testdata/particles.json 하나를 앱과 서버(apps/server/tests/test_task009_polish.py)가 함께 읽는다 (AC-3)
//     "pending"이 붙은 줄(빈 문자열)은 문서에 기대값이 없어 승인 전까지 건너뛴다 (질문 Q1)
// 새 모듈은 테스트 안에서 require 한다 (구현 전에도 이 파일의 다른 테스트가 돈다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { REPO_ROOT } from '../test-support/source-files';

type Pair = '이/가' | '은/는' | '을/를' | '으로/로';
type Case = { kind: string; word: string; pending?: string; expected: Record<Pair, string> };

const TABLE = JSON.parse(readFileSync(join(REPO_ROOT, 'testdata', 'particles.json'), 'utf8')) as { pairs: Pair[]; cases: Case[] };
const PAIRS = TABLE.pairs;
const READY = TABLE.cases.filter((row) => row.pending === undefined);
const PENDING = TABLE.cases.filter((row) => row.pending !== undefined);

const withParticle = (word: string, pair: Pair): string => require('@/lib/particle').withParticle(word, pair);
const mustVisitLine = (names: string[]): string => require('@/planning/format').mustVisitLine(names);

// 시험용 기준 (문서 B1 그대로)
const NO_BATCHIM: Record<Pair, string> = { '이/가': '가', '은/는': '는', '을/를': '를', '으로/로': '로' };
const BATCHIM: Record<Pair, string> = { '이/가': '이', '은/는': '은', '을/를': '을', '으로/로': '으로' };
function oracle(word: string, pair: Pair): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 0xd7a3 - 0xac00)) return word + NO_BATCHIM[pair];
  const jong = code % 28;
  if (jong === 0) return word + NO_BATCHIM[pair];
  if (jong === 8 && pair === '으로/로') return word + '로';
  return word + BATCHIM[pair];
}

describe('B1 경계 표 (AC-3, 서버와 같은 파일)', () => {
  test('T9_AC3_표_자체_확인_네_조사와_필요한_경계', () => {
    expect(PAIRS).toEqual(['이/가', '은/는', '을/를', '으로/로']);
    const kinds = TABLE.cases.map((row) => row.kind).join(' ');
    for (const needed of ['받침 없음', 'ㄹ 받침', '겹받침', '영문', '숫자', '빈 문자열']) expect(kinds).toContain(needed);
    for (const row of READY) for (const pair of PAIRS) expect([row.word, pair, row.expected[pair]]).toEqual([row.word, pair, oracle(row.word, pair)]);
  });

  test.each(READY.flatMap((row) => PAIRS.map((pair) => [`${row.kind} ${pair}`, row.word, pair, row.expected[pair]] as const)))(
    'T9_B1_AC3_%s',
    (_name, word, pair, expected) => {
      expect(withParticle(word, pair)).toBe(expected);
    },
  );

  // 질문 Q1: 빈 문자열의 기대값이 문서에 없다. 승인되면 pending을 지우고 위 표에 합친다
  for (const row of PENDING) for (const pair of PAIRS) test.todo(`T9_B1_AC3_Q1_승인_대기_${row.kind}_${pair}`);
});

describe('B1 속성', () => {
  const hangul = fc.integer({ min: 0xac00, max: 0xd7a3 }).map((code) => String.fromCharCode(code));
  const alnum = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''));
  const prefix = fc.array(fc.constantFrom(...'가나다 카페골목ABz09'.split('')), { maxLength: 8 }).map((chars) => chars.join(''));
  const pair = fc.constantFrom<Pair>('이/가', '은/는', '을/를', '으로/로');

  test('T9_B1_속성_한글_끝_글자는_받침에_따라', () => {
    fc.assert(fc.property(prefix, hangul, pair, (head, last, kind) => withParticle(head + last, kind) === oracle(head + last, kind)));
  });

  test('T9_B1_속성_영문_숫자_끝은_받침_없음', () => {
    fc.assert(fc.property(prefix, alnum, pair, (head, last, kind) => withParticle(head + last, kind) === head + last + NO_BATCHIM[kind]));
  });

  test('T9_B1_속성_조사는_끝_글자만_본다', () => {
    fc.assert(fc.property(prefix, hangul, pair, (head, last, kind) => withParticle(head + last, kind).slice(head.length) === withParticle(last, kind)));
  });
});

// ---------- B2 P1 "{이름}{은/는} 먼저 넣어 뒀어" ----------

describe('B2 P1 꼭 갈 곳 줄', () => {
  test.each(READY.map((row) => [row.kind, row.word, `${row.expected['은/는']} 먼저 넣어 뒀어`] as const))(
    'T9_B2_P1_한_곳이면_%s_은_는',
    (_kind, word, line) => {
      expect(mustVisitLine([word])).toBe(line);
    },
  );

  // 여럿이면 조사를 피해 쉼표로 (TASK-004 Q40 그대로, B2가 바꾸지 않음)
  test('T9_B2_P1_여럿이면_쉼표_그대로', () => {
    expect(mustVisitLine(['언덕 카페 B', '박물관'])).toBe('언덕 카페 B, 박물관, 먼저 넣어 뒀어');
  });
});
