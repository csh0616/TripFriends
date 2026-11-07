/// <reference types="jest" />
// 조사 함수 (B1)와 P1 꼭 갈 곳 줄 (B2). 근거: TASK-009 §B B1·B2, §7 AC-3, TASK-008 §13 H4·§17, DESIGN-001 §4-7.
//
// 계약 (이 테스트가 정한 이름, 보고서 ④):
//   src/lib/particle.ts  export function withParticle(word: string, pair: '이/가' | '은/는' | '을/를' | '으로/로'): string
//     돌려주는 값 = word + 고른 조사 (사이 띄어쓰기 없음). 서버 trip/phrase.py with_particle과 같은 규칙
//   경계 표: 저장소 맨 위 testdata/particles.json 하나를 앱과 서버(apps/server/tests/test_task009_polish.py)가 함께 읽는다 (AC-3)
//     v2 §9: 빈 문자열 = 받침 없음(Q1), 일본어·기호 끝 = 받침 없음(Q3), 숫자·영문은 읽는 소리로 받침(Q7)
// 새 모듈은 테스트 안에서 require 한다 (구현 전에도 이 파일의 다른 테스트가 돈다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { REPO_ROOT } from '../test-support/source-files';

type Pair = '이/가' | '은/는' | '을/를' | '으로/로';
type Case = { kind: string; word: string; expected: Record<Pair, string> };

const TABLE = JSON.parse(readFileSync(join(REPO_ROOT, 'testdata', 'particles.json'), 'utf8')) as { pairs: Pair[]; cases: Case[] };
const PAIRS = TABLE.pairs;
const READY = TABLE.cases; // §9 Q1로 빈 문자열도 기대값이 정해져 건너뛰는 줄이 없다
const NAMED = READY.filter((row) => row.word !== ''); // B2 대본은 이름이 있는 줄만 (빈 이름의 대본은 문서에 없다)

const withParticle = (word: string, pair: Pair): string => require('@/lib/particle').withParticle(word, pair);
const mustVisitLine = (names: string[]): string => require('@/planning/format').mustVisitLine(names);

// 시험용 기준 (B1 + v2 §9): 숫자·영문은 읽는 소리로(Q7), 일본어·기호 끝·빈 문자열은 받침 없음(Q1·Q3)
const NO_BATCHIM: Record<Pair, string> = { '이/가': '가', '은/는': '는', '을/를': '를', '으로/로': '로' };
const BATCHIM: Record<Pair, string> = { '이/가': '이', '은/는': '은', '을/를': '을', '으로/로': '으로' };
type Sound = 'ㄹ' | '있음' | undefined;
const DIGIT_SOUND: Record<string, Sound> = { '0': '있음', '1': 'ㄹ', '3': '있음', '6': '있음', '7': 'ㄹ', '8': 'ㄹ' }; // 영·일·삼·육·칠·팔
const LETTER_SOUND: Record<string, Sound> = { L: 'ㄹ', M: '있음', N: '있음', R: 'ㄹ' }; // 엘·엠·엔·알
const UNDECIDED = 'lmnr'; // 소문자 l·m·n·r은 문서에 없다 (질문). 표·속성에 넣지 않는다
function sound(word: string): Sound {
  if (word === '') return undefined;
  const last = word[word.length - 1];
  if (UNDECIDED.includes(last)) throw new Error(`문서에 기대값 없음: ${word}`);
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code >= 0 && code <= 0xd7a3 - 0xac00) {
    const jong = code % 28;
    return jong === 0 ? undefined : jong === 8 ? 'ㄹ' : '있음';
  }
  return DIGIT_SOUND[last] ?? LETTER_SOUND[last];
}
function oracle(word: string, pair: Pair): string {
  const kind = sound(word);
  if (kind === undefined) return word + NO_BATCHIM[pair];
  if (kind === 'ㄹ' && pair === '으로/로') return word + '로';
  return word + BATCHIM[pair];
}

describe('B1 경계 표 (AC-3, 서버와 같은 파일)', () => {
  test('T9_AC3_표_자체_확인_네_조사와_필요한_경계', () => {
    expect(PAIRS).toEqual(['이/가', '은/는', '을/를', '으로/로']);
    const kinds = TABLE.cases.map((row) => row.kind).join(' ');
    for (const needed of ['받침 없음', 'ㄹ 받침', '겹받침', '영문', '숫자', '빈 문자열', '일본어', '기호']) expect(kinds).toContain(needed);
    for (const row of READY) for (const pair of PAIRS) expect([row.word, pair, row.expected[pair]]).toEqual([row.word, pair, oracle(row.word, pair)]);
  });

  test('T9_AC3_Q7_표에_숫자_끝_0부터_9와_영문_L_M_N_R이_모두_있다', () => {
    const ends = new Set(READY.filter((row) => row.word !== '').map((row) => row.word[row.word.length - 1]));
    for (const end of '0123456789LMNR') expect([end, ends.has(end)]).toEqual([end, true]);
    expect([...'ABCDEFGHIJKOPQSTUVWXYZ'].some((end) => ends.has(end))).toBe(true); // 받침 없는 영문 예도 있다
  });

  test.each(READY.flatMap((row) => PAIRS.map((pair) => [`${row.kind} ${pair}`, row.word, pair, row.expected[pair]] as const)))(
    'T9_B1_AC3_%s',
    (_name, word, pair, expected) => {
      expect(withParticle(word, pair)).toBe(expected);
    },
  );
});

describe('B1 속성', () => {
  const hangul = fc.integer({ min: 0xac00, max: 0xd7a3 }).map((code) => String.fromCharCode(code));
  const alnum = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('').filter((c) => !UNDECIDED.includes(c)));
  const prefix = fc.array(fc.constantFrom(...'가나다 카페골목ABz09'.split('')), { maxLength: 8 }).map((chars) => chars.join(''));
  const pair = fc.constantFrom<Pair>('이/가', '은/는', '을/를', '으로/로');

  test('T9_B1_속성_한글_끝_글자는_받침에_따라', () => {
    fc.assert(fc.property(prefix, hangul, pair, (head, last, kind) => withParticle(head + last, kind) === oracle(head + last, kind)));
  });

  test('T9_B1_Q7_속성_영문_숫자_끝은_읽는_소리대로', () => {
    fc.assert(fc.property(prefix, alnum, pair, (head, last, kind) => withParticle(head + last, kind) === oracle(head + last, kind)));
  });

  test('T9_B1_속성_조사는_끝_글자만_본다', () => {
    fc.assert(fc.property(prefix, hangul, pair, (head, last, kind) => withParticle(head + last, kind).slice(head.length) === withParticle(last, kind)));
  });
});

// ---------- B2 P1 "{이름}{은/는} 먼저 넣어 뒀어" ----------

describe('B2 P1 꼭 갈 곳 줄', () => {
  test.each(NAMED.map((row) => [row.kind, row.word, `${row.expected['은/는']} 먼저 넣어 뒀어`] as const))(
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
