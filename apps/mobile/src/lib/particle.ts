// B1 조사 함수: 서버 trip/phrase.py with_particle과 같은 규칙, 같은 경계 표(testdata/particles.json)로 시험한다 (TASK-009 §B1·§9).
export type ParticlePair = '이/가' | '은/는' | '을/를' | '으로/로';

const PAIRS: Record<ParticlePair, [string, string]> = {
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
  '을/를': ['을', '를'],
  '으로/로': ['으로', '로'],
};
const RIEUL = 8; // 종성 번호 ㄹ
const HANGUL_COUNT = 0xd7a3 - 0xac00;

type Sound = 'none' | 'rieul' | 'batchim';

/** 끝 글자의 받침 종류. 숫자·영문은 읽는 소리(Q7), 일본어·기호는 받침 없음(Q3). 소문자 l·m·n·r은 서버처럼 대문자와 같게 */
function finalSound(last: string): Sound {
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= HANGUL_COUNT) {
    const jong = code % 28;
    return jong === 0 ? 'none' : jong === RIEUL ? 'rieul' : 'batchim';
  }
  if ('178LlRr'.includes(last)) return 'rieul'; // 일·칠·팔·엘·알
  if ('036MmNn'.includes(last)) return 'batchim'; // 영·삼·육·엠·엔
  return 'none';
}

/** '{word}{조사}'. 받침 없음 -> 가·는·를·로, ㄹ -> 이·은·을 + '로', 그 밖 -> 이·은·을·으로. 빈 문자열은 받침 없음 (Q1) */
export function withParticle(word: string, pair: ParticlePair): string {
  const [withBatchim, without] = PAIRS[pair];
  const sound = word === '' ? 'none' : finalSound(word[word.length - 1]);
  if (sound === 'none') return word + without;
  if (sound === 'rieul' && pair === '으로/로') return word + without;
  return word + withBatchim;
}
