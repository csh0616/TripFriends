/// <reference types="jest" />
// TASK-015 §B6 핀 겹침 규칙 — 순수 함수 (앱). 보이는 모습(색·테두리 굵기)은 보지 않고, 어떤 핀·배지·이름표 자리가 나오는지만 본다.
// 근거: TASK-015 §B6("가림 순서 · 이름표 자리 후보(위→오른쪽→왼쪽→아래, 다 안 되면 뺌) · 중심 거리 < 36 묶기 +N 배지 · 숙소+번호 핀 집 배지 ·
//       숙소에 머무는 동안 숙소 마커가 '지금 핀' 모양 · 내 위치 점은 핀 아래 · 계산 순서 ①~⑤. 순수 함수로 — 입력: 핀 화면 좌표·순위, 출력: 보일 핀·배지·이름표 자리") ·
//       §9 Q10(test-writer가 먼저) · docs/design/reviews/task-014-design.md §11-3 표(값)·§12-3(계산 순서 한 줄 요약) · DESIGN-001 §4-6(핀 크기 28 / 32 / 36) ·
//       §6("핀 겹침 계산 실패 -> 규칙 없이 지금처럼 그림") ·
//       TASK-015 §11(11-16 PM 답) Q3(옆 이름표는 핀 중심에 세로 가운데 · 이름표 자리는 다른 핀과 맞닿음(간격 0)도 겹침 · 묶기 < 36) ·
//       Q4(같은 순위면 코스 번호가 앞선 핀이 남음 · 사슬은 욕심 방식) · Q5(숙소+번호 핀이면 번호 핀이 이김, 순위표는 번호 핀끼리와 그리는 순서에만) ·
//       Q6(함수는 순수·예외를 잡지 않음, 화면이 감쌈 · 보이는 핀마다 a11yLabel을 함수가 만든다) ·
//       TASK-015 §12(11-16) 숙소 마커 지름(보통 28, 지금 있는 곳이 숙소일 때만 32 '지금 핀' 모양·내 위치 점 안 그림. 지난 28 · 지금 32 · 다음 36 · 나중 28.
//       묶기는 크기와 상관없이 중심 거리 < 36) · Q4(a11yLabel 글 6가지, 사용자 이름표 label은 넣지 않음) ·
//       Q5(이름표 자리 검사의 장애물 모두 맞닿음까지 겹침) -> §13 Q1로 정리: **하나의 규칙** = 장애물을 여유만큼 키운 뒤 맞닿음까지 겹침(간격 <= 여유).
//       여유는 다른 핀 4 · 내 위치 점 0 · 떠 있는 판 0 (§12 Q5의 "4 미만"은 PM 글 실수, §11 Q3가 맞다) ·
//       **TASK-015 §24(11-18): 떠 있는 판 여유 0 -> 4** ("SOS · 닫기 · 제목 · 축척 · 시트와 4 이상 띄움, 닿으면 밀지 않고 다음 후보" — task-015-design §12-3 Q4).
//       같은 하나의 규칙(간격 <= 여유면 겹침)이라 판과 간격 4는 겹침 · 5는 통과. 내 위치 점 여유는 §24에 말이 없어 0 그대로 ·
//       TASK-015 §13 Q6(다른 순위끼리 묶인 글: 남은 핀(높은 순위)이 앞, 붙은 번호는 순위 말 없이 번호 오름차순 — "나중 4번, 2번도 같은 곳").
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   모듈 '@/lib/pin-overlap'
//   resolvePinOverlap({ pins, screen, labelWidth, me?, panels?, stayingAtLodging? }) -> { pins: ShownPin[], label, meDot }
//     입력 pins = [{ id, kind: next|now|lodging|later|done, x, y(핀 중심, pt), size(지름), seq: 코스 번호(숙소는 null) }] — ① 카메라는 부르는 쪽이 끝낸 뒤의 화면 좌표
//     출력 pins = 보일 핀만, 그리는 순서(아래 -> 위) done · later · lodging · now · next. 각 핀 { ...입력, shape: pin|home|now, badges, hidden: 묶여 빠진 id[], a11yLabel }
//     a11yLabel (§11 Q6 · §12 Q4): 보이는 핀마다 화면 읽기 글. 순위 말(다음·지금·지난·나중)은 순위표에서
//                묶이지 않은 핀 "나중 4번" · 여러 번호 묶음 "나중 4번, 5번·6번도 같은 곳"(붙은 번호는 순위와 상관없이 번호 오름차순, §13 Q6) · 숙소 혼자 "숙소" ·
//                집 배지 "다음 3번, 숙소도 같은 곳" · 둘 다 "나중 4번, 5번도 같은 곳, 숙소도 같은 곳" · 숙소에 머무는 중 "지금 숙소" (label은 넣지 않음)
//     badges: { type: 'plus', count, corner } (빠진 번호 핀 수) · { type: 'home', corner: 'top-right' } (숙소가 번호 핀에 묶임). 둘 다면 home 오른쪽 위, plus 오른쪽 아래
//     label = 다음 핀 하나의 이름표 { pinId, side: top|right|left|bottom, rect } | null
//   이름표 자리 (§11-3 "높이 28 · 핀과 위 4 · 옆 6"):
//     top    = { x: cx − w/2, y: cy − size/2 − 4 − 28, w, 28 }      bottom = { x: cx − w/2, y: cy + size/2 + 4, w, 28 }
//     right  = { x: cx + size/2 + 6, (세로 가운데 맞춤), w, 28 }       left   = { x: cx − size/2 − 6 − w, (세로 가운데 맞춤), w, 28 }
//     막히는 것: 보이는 다른 핀(원, 반지름 size/2 + 4) · 내 위치 점(원, 반지름 size/2, 숙소에 머무는 동안은 그리지 않아 막지 않음) · 떠 있는 판 ·
//                화면 가장자리에서 8 안쪽을 벗어남. 다른 핀(원 + 4)과는 맞닿음(간격 0)도 겹침 (§11 Q3). 내 위치 점·떠 있는 판도 맞닿음(간격 0)이면 겹침 (§12 Q5)
//   묶기: 중심 거리 < 36(GROUP_DISTANCE)이면 순위가 낮은 핀이 빠진다 (순위 next > now > lodging > later > done). 다만 숙소와 번호 핀이면 번호 핀이 이긴다(집 배지)
//     욕심 방식 (§11 Q4): 번호 핀을 순위 -> 코스 번호 순으로 하나씩 보며, 이미 남긴 핀 중 36 안의 첫 핀(남긴 순서)에 붙고, 없으면 새로 남는다.
//     그 뒤 숙소: 남긴 번호 핀 중 36 안의 첫 핀에 집 배지로 붙고, 없으면 숙소 마커로 남는다 (번호 핀은 숙소에 붙지 않는다, Q5). 입력 순서와 상관없다
//   예외: 함수는 잡지 않는다 (§11 Q6). 화면이 감싸 실패하면 규칙 없이 그린다 (task-015-pin-overlap-fallback.test.tsx)
//   숙소 마커 지름 (§12): 보통 28(입력 size 그대로), 머무는 동안은 shape 'now'·size 32, meDot false
import fc from 'fast-check';

import { GROUP_DISTANCE, PIN_STACK, resolvePinOverlap, type PinKind, type PinOverlapInput, type Rect, type ScreenPin } from '@/lib/pin-overlap';

const SCREEN = { width: 390, height: 600 };
const W = 80; // 이름표 폭 (화면이 잰 값으로 친다)
const H = 28;
// TASK-015 §12: 지난 28 · 지금 32 · 다음 36 · 나중 28 · 숙소 보통 28 (지금 있는 곳이 숙소일 때만 32 — 함수가 바꾼다)
const SIZE: Record<PinKind, number> = { next: 36, now: 32, done: 28, later: 28, lodging: 28 };
const LODGING_STAYING_SIZE = 32;

const pin = (id: string, kind: PinKind, x: number, y: number, seq: number | null = kind === 'lodging' ? null : 1): ScreenPin => ({ id, kind, x, y, size: SIZE[kind], seq });
const NEXT = pin('n', 'next', 195, 300);
const run = (pins: ScreenPin[], over: Partial<PinOverlapInput> = {}) => resolvePinOverlap({ pins, screen: SCREEN, labelWidth: W, ...over });
const shownIds = (result: ReturnType<typeof run>) => result.pins.map((p) => p.id);
const byId = (result: ReturnType<typeof run>, id: string) => {
  const found = result.pins.find((p) => p.id === id);
  if (!found) throw new Error(`보일 핀에 ${id}가 없다`);
  return found;
};

// =====================================================================
// 가림 순서 (§11-3: 다음 · 지금 · 숙소 · 나중 · 지난 -> 이름표 -> 내 위치 점·고리 -> 길)
// =====================================================================

describe('§B6 가림 순서', () => {
  test('T15_B6_가림_순서_표는_위부터_다음·지금·숙소·나중·지난·이름표·내_위치_점·길', () => {
    expect([...PIN_STACK]).toEqual(['next', 'now', 'lodging', 'later', 'done', 'label', 'me', 'route']);
  });

  test('T15_B6_핀이_이름표보다_위이고_내_위치_점은_핀_아래', () => {
    const stack = [...PIN_STACK] as string[];
    for (const kind of ['next', 'now', 'lodging', 'later', 'done']) {
      expect(stack.indexOf(kind)).toBeLessThan(stack.indexOf('label')); // 번호가 말풍선 밑에 숨지 않는다
      expect(stack.indexOf(kind)).toBeLessThan(stack.indexOf('me'));
    }
  });

  test('T15_B6_보일_핀은_아래부터_지난·나중·숙소·지금·다음_순으로_그린다', () => {
    const far = [pin('n', 'next', 50, 100), pin('w', 'now', 150, 200), pin('h', 'lodging', 250, 300), pin('l', 'later', 50, 400), pin('d', 'done', 300, 500)];
    for (const order of [far, [...far].reverse()]) {
      expect(run(order).pins.map((p) => p.kind)).toEqual(['done', 'later', 'lodging', 'now', 'next']);
    }
  });
});

// =====================================================================
// 가까운 핀 묶기 (§11-3: 중심 거리 < 36 -> 낮은 순위를 빼고 높은 핀에 +N)
// =====================================================================

describe('§B6 가까운 핀 묶기', () => {
  test('T15_B6_묶는_거리는_36', () => {
    expect(GROUP_DISTANCE).toBe(36);
  });

  test('T15_B6_중심_거리_35_99면_낮은_순위를_빼고_높은_핀에_+1_배지_오른쪽_위', () => {
    const result = run([pin('n', 'next', 100, 100), pin('l', 'later', 135.99, 100)]);
    expect(shownIds(result)).toEqual(['n']);
    expect(byId(result, 'n').badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]);
    expect(byId(result, 'n').hidden).toEqual(['l']);
  });

  test('T15_B6_경계_중심_거리_정확히_36이면_묶지_않는다', () => {
    const result = run([pin('n', 'next', 100, 100), pin('l', 'later', 136, 100)]);
    expect(shownIds(result).sort()).toEqual(['l', 'n']);
    for (const shown of result.pins) expect(shown.badges).toEqual([]);
  });

  test('T15_B6_경계_대각선_거리도_중심_거리로_잰다', () => {
    // (30, 20) 떨어짐 = 36.06 -> 묶지 않음 / (30, 19) = 35.51 -> 묶음
    expect(shownIds(run([pin('n', 'next', 100, 100), pin('l', 'later', 130, 120)])).sort()).toEqual(['l', 'n']);
    expect(shownIds(run([pin('n', 'next', 100, 100), pin('l', 'later', 130, 119)]))).toEqual(['n']);
  });

  test.each<[PinKind, PinKind]>([
    ['next', 'now'],
    ['next', 'later'],
    ['next', 'done'],
    ['now', 'later'],
    ['now', 'done'],
    ['later', 'done'],
  ])('T15_B6_순위_%s가_%s를_이긴다', (high, low) => {
    for (const pins of [
      [pin('a', high, 100, 100), pin('b', low, 110, 100)],
      [pin('b', low, 110, 100), pin('a', high, 100, 100)],
    ]) {
      const result = run(pins);
      expect(shownIds(result)).toEqual(['a']);
      expect(byId(result, 'a').badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]);
    }
  });

  test('T15_B6_셋이_서로_가까우면_가장_높은_핀_하나에_+2', () => {
    const result = run([pin('l1', 'later', 110, 100), pin('w', 'now', 100, 100), pin('l2', 'later', 100, 110)]);
    expect(shownIds(result)).toEqual(['w']);
    expect(byId(result, 'w').badges).toEqual([{ type: 'plus', count: 2, corner: 'top-right' }]);
    expect([...byId(result, 'w').hidden].sort()).toEqual(['l1', 'l2']);
  });

  test('T15_B6_확대해서_거리가_36_이상이_되면_묶음이_풀린다', () => {
    const near = [pin('n', 'next', 195, 300), pin('l', 'later', 215, 300)]; // 20
    expect(shownIds(run(near))).toEqual(['n']);
    const zoomed = near.map((p) => ({ ...p, x: 195 + (p.x - 195) * 2 })); // 같은 가운데로 두 배 확대 -> 40
    const result = run(zoomed);
    expect(shownIds(result).sort()).toEqual(['l', 'n']);
    for (const shown of result.pins) expect(shown.badges).toEqual([]);
  });
});

// =====================================================================
// 숙소 + 번호 핀 (§11-3: < 36이면 번호 핀이 이기고 숙소는 집 배지)
// =====================================================================

describe('§B6 숙소 + 번호 핀 = 집 배지', () => {
  test.each<PinKind>(['next', 'now', 'later', 'done'])('T15_B6_숙소와_%s_핀이_가까우면_번호_핀이_보이고_집_배지', (kind) => {
    const result = run([pin('h', 'lodging', 100, 100), pin('p', kind, 120, 100)]);
    expect(shownIds(result)).toEqual(['p']);
    expect(byId(result, 'p').badges).toEqual([{ type: 'home', corner: 'top-right' }]); // +N은 없다 (숙소는 번호가 아니다)
    expect(byId(result, 'p').hidden).toEqual(['h']);
  });

  test('T15_B6_경계_숙소와_번호_핀이_정확히_36이면_둘_다_보이고_배지_없음', () => {
    const result = run([pin('h', 'lodging', 100, 100), pin('p', 'later', 136, 100)]);
    expect(shownIds(result).sort()).toEqual(['h', 'p']);
    expect(byId(result, 'h').shape).toBe('home');
    for (const shown of result.pins) expect(shown.badges).toEqual([]);
  });

  test('T15_B6_묶음과_집_배지가_같이면_집_배지는_오른쪽_위_+N은_오른쪽_아래', () => {
    const result = run([pin('n', 'next', 100, 100), pin('l', 'later', 115, 100), pin('h', 'lodging', 100, 118)]);
    expect(shownIds(result)).toEqual(['n']);
    const badges = byId(result, 'n').badges;
    expect(badges).toHaveLength(2);
    expect(badges).toEqual(expect.arrayContaining([{ type: 'home', corner: 'top-right' }, { type: 'plus', count: 1, corner: 'bottom-right' }]));
  });

  test('T15_B6_숙소가_혼자면_숙소_마커_모양', () => {
    const result = run([pin('h', 'lodging', 100, 100), NEXT]);
    expect(byId(result, 'h').shape).toBe('home');
    expect(byId(result, 'n').shape).toBe('pin');
  });
});

// =====================================================================
// 묶는 순서 (§11 Q4 욕심 방식 · Q5 숙소는 번호 핀에)
// =====================================================================

describe('§11 Q4 같은 순위·사슬', () => {
  test.each<PinKind>(['later', 'done'])('T15_S11_Q4_같은_순위_%s면_코스_번호가_앞선_핀이_남는다', (kind) => {
    for (const pins of [
      [pin('a', kind, 100, 100, 4), pin('b', kind, 120, 100, 5)],
      [pin('b', kind, 120, 100, 5), pin('a', kind, 100, 100, 4)],
      [pin('z', kind, 100, 100, 4), pin('a', kind, 120, 100, 5)], // id 글자 순서가 아니라 번호
    ]) {
      const result = run(pins);
      const keep = pins.find((p) => p.seq === 4)!.id;
      const gone = pins.find((p) => p.seq === 5)!.id;
      expect(shownIds(result)).toEqual([keep]);
      expect(byId(result, keep).hidden).toEqual([gone]);
      expect(byId(result, keep).badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]);
    }
  });

  test('T15_S11_Q4_순위가_번호보다_먼저_번호가_뒤여도_순위_높은_핀이_남는다', () => {
    const result = run([pin('d', 'done', 100, 100, 1), pin('l', 'later', 120, 100, 6)]);
    expect(shownIds(result)).toEqual(['l']);
    expect(byId(result, 'l').hidden).toEqual(['d']);
  });

  test('T15_S11_Q4_사슬은_이어지지_않는다_A–B_30·B–C_30·A–C_60이면_A가_남고_B는_A에_C는_따로', () => {
    const chain = [pin('A', 'later', 100, 100, 1), pin('B', 'later', 130, 100, 2), pin('C', 'later', 160, 100, 3)];
    for (const pins of [chain, [...chain].reverse(), [chain[1], chain[2], chain[0]]]) {
      const result = run(pins);
      expect(shownIds(result).sort()).toEqual(['A', 'C']);
      expect(byId(result, 'A').hidden).toEqual(['B']);
      expect(byId(result, 'C').hidden).toEqual([]);
      expect(byId(result, 'C').badges).toEqual([]);
    }
  });

  test('T15_S11_Q4_경계_사슬_A–C가_정확히_36이면_C는_따로_35_99면_A에', () => {
    const at = (cx: number) => [pin('A', 'later', 100, 100, 1), pin('B', 'later', 118, 100, 2), pin('C', 'later', cx, 100, 3)];
    expect(shownIds(run(at(136))).sort()).toEqual(['A', 'C']);
    const near = run(at(135.99));
    expect(shownIds(near)).toEqual(['A']);
    expect([...byId(near, 'A').hidden].sort()).toEqual(['B', 'C']);
  });

  test('T15_S11_Q4_두_남은_핀_모두_36_안이면_먼저_남긴_핀에_붙는다', () => {
    // 지금(100) · 나중 1번(140): 40 떨어져 둘 다 남음. 나중 2번(120)은 둘 다 20 -> 먼저 남긴 지금 핀에
    const result = run([pin('L1', 'later', 140, 100, 1), pin('L2', 'later', 120, 100, 2), pin('W', 'now', 100, 100, 3)]);
    expect(shownIds(result).sort()).toEqual(['L1', 'W']);
    expect(byId(result, 'W').hidden).toEqual(['L2']);
    expect(byId(result, 'L1').hidden).toEqual([]);
  });

  test('T15_S11_Q4_같은_순위에서_먼저_남긴_핀_=_번호가_앞선_핀', () => {
    // 나중 1번(100) · 나중 2번(140) 둘 다 남음. 나중 3번(120)은 둘 다 20 -> 1번에
    const result = run([pin('c', 'later', 120, 100, 3), pin('b', 'later', 140, 100, 2), pin('a', 'later', 100, 100, 1)]);
    expect(byId(result, 'a').hidden).toEqual(['c']);
    expect(byId(result, 'b').hidden).toEqual([]);
  });
});

describe('§11 Q5 숙소와 번호 핀', () => {
  test('T15_S11_Q5_숙소는_순위가_나중보다_높아도_나중_핀에_집_배지로_붙는다', () => {
    const result = run([pin('h', 'lodging', 100, 100), pin('l', 'later', 110, 100, 3)]);
    expect(shownIds(result)).toEqual(['l']);
    expect(byId(result, 'l').badges).toEqual([{ type: 'home', corner: 'top-right' }]);
  });

  test('T15_S11_Q5_번호_핀은_숙소에_붙지_않는다_숙소_곁_나중_둘은_번호_핀끼리_묶인다', () => {
    const result = run([pin('h', 'lodging', 100, 100), pin('l1', 'later', 120, 100, 1), pin('l2', 'later', 130, 100, 2)]);
    expect(shownIds(result)).toEqual(['l1']);
    expect([...byId(result, 'l1').hidden].sort()).toEqual(['h', 'l2']);
    expect(byId(result, 'l1').badges).toEqual(expect.arrayContaining([{ type: 'home', corner: 'top-right' }, { type: 'plus', count: 1, corner: 'bottom-right' }]));
  });

  test('T15_S11_Q5_숙소는_36_안의_남긴_번호_핀_중_먼저_남긴_핀에', () => {
    // 다음(100) · 나중(140) 둘 다 남음, 숙소(120)는 둘 다 20 -> 먼저 남긴 다음 핀에
    const result = run([pin('l', 'later', 140, 100, 2), pin('h', 'lodging', 120, 100), pin('n', 'next', 100, 100, 1)]);
    expect(byId(result, 'n').hidden).toEqual(['h']);
    expect(byId(result, 'l').hidden).toEqual([]);
  });

  test('T15_S11_Q5_안_겹치면_숙소는_그리는_순서에서만_나중_위·지금_아래', () => {
    const result = run([pin('w', 'now', 50, 100, 2), pin('h', 'lodging', 200, 100), pin('l', 'later', 350, 100, 3)]);
    expect(result.pins.map((p) => p.id)).toEqual(['l', 'h', 'w']);
  });
});

// =====================================================================
// 화면 읽기 글 (§11 Q6: 보이는 핀마다 a11yLabel, 묶음을 아는 함수가 만든다)
// =====================================================================

describe('§11 Q6 a11yLabel', () => {
  test('T15_S11_Q6_나중_4번에_5번이_묶이면_나중_4번,_5번도_같은_곳', () => {
    const result = run([pin('a', 'later', 100, 100, 4), pin('b', 'later', 120, 100, 5)]);
    expect(byId(result, 'a').a11yLabel).toBe('나중 4번, 5번도 같은 곳');
  });

  test.each<[PinKind, string]>([
    ['next', '다음'],
    ['now', '지금'],
    ['later', '나중'],
    ['done', '지난'],
  ])('T15_S11_Q6_번호_핀_%s의_글은_%s_N번으로_시작', (kind, word) => {
    const result = run([pin('p', kind, 100, 100, 7)]);
    expect(byId(result, 'p').a11yLabel.startsWith(`${word} 7번`)).toBe(true);
  });

  // §12 Q4 정확한 글 (이전 단언: 숙소·집 배지 글에 "숙소"가 든다 / "나중 3번"으로 시작 — 정확한 글은 질문이었다)
  test('T15_S12_Q4_묶이지_않은_핀은_나중_4번', () => {
    expect(byId(run([pin('a', 'later', 100, 100, 4)]), 'a').a11yLabel).toBe('나중 4번');
  });

  test('T15_S12_Q4_여러_번호_묶음은_나중_4번,_5번·6번도_같은_곳', () => {
    const pins = [pin('a', 'later', 100, 100, 4), pin('b', 'later', 120, 100, 5), pin('c', 'later', 100, 120, 6)];
    for (const order of [pins, [...pins].reverse()]) expect(byId(run(order), 'a').a11yLabel).toBe('나중 4번, 5번·6번도 같은 곳');
  });

  // §13 Q6 다른 순위끼리 묶임: 남은 핀(높은 순위)이 앞, 붙은 번호는 순위 말 없이 번호 오름차순
  test('T15_S13_Q6_지난_2번이_나중_4번에_붙으면_나중_4번,_2번도_같은_곳', () => {
    const pins = [pin('a', 'later', 100, 100, 4), pin('b', 'done', 120, 100, 2)];
    for (const order of [pins, [...pins].reverse()]) expect(byId(run(order), 'a').a11yLabel).toBe('나중 4번, 2번도 같은 곳');
  });

  test('T15_S13_Q6_다음_5번에_지난_1번·나중_6번·지금_3번이_붙으면_순위_말_없이_번호_오름차순', () => {
    const pins = [pin('n', 'next', 100, 100, 5), pin('d', 'done', 115, 100, 1), pin('l', 'later', 100, 115, 6), pin('w', 'now', 110, 110, 3)];
    for (const order of [pins, [...pins].reverse()]) {
      const label = byId(run(order), 'n').a11yLabel;
      expect(label).toBe('다음 5번, 1번·3번·6번도 같은 곳');
      for (const word of ['지난', '나중', '지금']) expect(label).not.toContain(word); // 붙은 번호에는 순위 말이 없다
    }
  });

  test('T15_S13_Q6_다른_순위_묶음과_집_배지가_둘_다면_번호_다음에_숙소', () => {
    const result = run([pin('h', 'lodging', 100, 118), pin('a', 'later', 100, 100, 4), pin('b', 'done', 115, 100, 2)]);
    expect(byId(result, 'a').a11yLabel).toBe('나중 4번, 2번도 같은 곳, 숙소도 같은 곳');
  });

  test('T15_S12_Q4_숙소_혼자는_숙소', () => {
    expect(byId(run([pin('h', 'lodging', 100, 100), NEXT]), 'h').a11yLabel).toBe('숙소');
  });

  test('T15_S12_Q4_집_배지는_다음_3번,_숙소도_같은_곳', () => {
    expect(byId(run([pin('h', 'lodging', 100, 100), pin('n', 'next', 120, 100, 3)]), 'n').a11yLabel).toBe('다음 3번, 숙소도 같은 곳');
  });

  test('T15_S12_Q4_번호_묶음과_집_배지가_둘_다면_나중_4번,_5번도_같은_곳,_숙소도_같은_곳', () => {
    const result = run([pin('h', 'lodging', 100, 118), pin('a', 'later', 100, 100, 4), pin('b', 'later', 115, 100, 5)]);
    expect(byId(result, 'a').a11yLabel).toBe('나중 4번, 5번도 같은 곳, 숙소도 같은 곳');
  });

  test('T15_S12_Q4_숙소에_머무는_중은_지금_숙소', () => {
    expect(byId(run([pin('h', 'lodging', 100, 100), NEXT], { stayingAtLodging: true }), 'h').a11yLabel).toBe('지금 숙소');
  });

  test('T15_S12_Q4_경계_머물지_않으면_지금이_붙지_않는다', () => {
    expect(byId(run([pin('h', 'lodging', 100, 100), NEXT], { stayingAtLodging: false }), 'h').a11yLabel).toBe('숙소');
  });

  test('T15_S12_Q4_사용자_이름표_label은_입력에_있어도_글에_넣지_않는다', () => {
    // §12 Q4 "사용자 이름표(label)는 넣지 않는다(짧게)". 함수 입력 모양에 label 칸이 없다 -> 핀에 붙여 보내도 글은 그대로
    const withLabel = { ...pin('h', 'lodging', 100, 100), label: '친구 집' } as ScreenPin;
    expect(byId(run([withLabel, NEXT]), 'h').a11yLabel).toBe('숙소');
    expect(byId(run([withLabel, NEXT], { stayingAtLodging: true }), 'h').a11yLabel).toBe('지금 숙소');
  });
});

// =====================================================================
// 머무는 동안 = 숙소 (§11-3: 숙소 마커가 "지금 핀" 모양 32, 내 위치 점·reh-dot은 그리지 않음)
// =====================================================================

describe('§B6 숙소에 머무는 동안', () => {
  const ME = { x: 100, y: 100, size: 22 };

  test('T15_S12_숙소_마커_보통_지름은_28', () => {
    expect(SIZE.lodging).toBe(28);
    expect(byId(run([pin('h', 'lodging', 100, 100), NEXT]), 'h').size).toBe(28);
  });

  test('T15_B6_S12_머무는_동안_숙소_마커는_지금_핀_모양_32이고_내_위치_점을_그리지_않는다', () => {
    const result = run([pin('h', 'lodging', 100, 100), NEXT], { me: ME, stayingAtLodging: true }); // 입력 지름 28
    expect(byId(result, 'h').shape).toBe('now');
    expect(byId(result, 'h').size).toBe(LODGING_STAYING_SIZE);
    expect(result.meDot).toBe(false);
  });

  test('T15_B6_S12_경계_머물지_않으면_숙소는_숙소_모양_28이고_내_위치_점을_그린다', () => {
    const result = run([pin('h', 'lodging', 100, 100), NEXT], { me: ME, stayingAtLodging: false });
    expect(byId(result, 'h').shape).toBe('home');
    expect(byId(result, 'h').size).toBe(28);
    expect(result.meDot).toBe(true);
  });

  test('T15_S12_번호_핀_지름은_머물든_아니든_입력_그대로_지난_28·지금_32·다음_36·나중_28', () => {
    const pins = [pin('n', 'next', 50, 100, 1), pin('w', 'now', 150, 100, 2), pin('l', 'later', 250, 100, 3), pin('d', 'done', 350, 100, 4), pin('h', 'lodging', 200, 400)];
    for (const staying of [false, true]) {
      const result = run(pins, { stayingAtLodging: staying });
      expect(Object.fromEntries(result.pins.filter((p) => p.kind !== 'lodging').map((p) => [p.kind, p.size]))).toEqual({ next: 36, now: 32, later: 28, done: 28 });
    }
  });

  test.each([
    [35.99, false],
    [35.99, true],
    [36, false],
    [36, true],
  ])('T15_S12_경계_묶기는_숙소_크기와_상관없이_중심_거리_<_36_거리_%d·머무는_중_%s', (gap, staying) => {
    const result = run([pin('h', 'lodging', 100, 100), pin('l', 'later', 100 + gap, 100, 3)], { stayingAtLodging: staying });
    expect(shownIds(result).sort()).toEqual(gap < 36 ? ['l'] : ['h', 'l']);
  });

  test('T15_B6_경계_위치를_모르면_내_위치_점_없음', () => {
    expect(run([NEXT], { me: null }).meDot).toBe(false);
  });
});

// =====================================================================
// 이름표 자리 (§11-3: 다음 핀 하나에만. 위 -> 오른쪽 -> 왼쪽 -> 아래, 다 안 되면 뺀다)
// =====================================================================

describe('§B6 이름표 자리', () => {
  // NEXT(195, 300, 36), 이름표 80 x 28. 위 후보 = y 250 ~ 278, 오른쪽 후보 x 219 ~ 299, 왼쪽 x 91 ~ 171, 아래 y 322 ~ 350
  const ABOVE = pin('a', 'later', 195, 250); // 다음 핀과 50 (묶이지 않음), 원(14 + 4)이 위 후보를 막는다
  const RIGHT = pin('r', 'later', 259, 300); // 64
  const LEFT = pin('lf', 'later', 131, 300); // 64
  const BELOW = pin('b', 'later', 195, 360); // 60

  test('T15_B6_막는_것이_없으면_위_핀과_4_띄우고_높이_28', () => {
    const { label } = run([NEXT]);
    expect(label).toEqual({ pinId: 'n', side: 'top', rect: { x: 155, y: 250, width: W, height: H } });
  });

  test('T15_B6_위가_막히면_오른쪽_핀과_옆_6', () => {
    const { label } = run([NEXT, ABOVE]);
    expect(label?.side).toBe('right');
    expect(label?.rect.x).toBe(195 + 18 + 6);
    expect(label?.rect.height).toBe(H);
  });

  test('T15_B6_위·오른쪽이_막히면_왼쪽', () => {
    const { label } = run([NEXT, ABOVE, RIGHT]);
    expect(label?.side).toBe('left');
    expect((label?.rect.x ?? 0) + W).toBe(195 - 18 - 6);
  });

  test('T15_B6_위·오른쪽·왼쪽이_막히면_아래_핀과_4', () => {
    const { label } = run([NEXT, ABOVE, RIGHT, LEFT]);
    expect(label?.side).toBe('bottom');
    expect(label?.rect).toEqual({ x: 155, y: 300 + 18 + 4, width: W, height: H });
  });

  test('T15_B6_넷_다_막히면_이름표를_뺀다', () => {
    const result = run([NEXT, ABOVE, RIGHT, LEFT, BELOW]);
    expect(result.label).toBeNull();
    expect(shownIds(result)).toContain('n'); // 이름표 때문에 핀을 빼지 않는다 (§12-3)
  });

  test('T15_B6_오른쪽만_막히면_위', () => {
    expect(run([NEXT, RIGHT]).label?.side).toBe('top');
  });

  test.each([
    [231, 'top'], // 원 아래 끝 231 + 18 = 249 < 250: 1 떨어짐
    [232, 'right'], // 250 = 250: 맞닿음(간격 0)도 겹침 (§11 Q3 ③)
    [233, 'right'], // 251 > 250: 1 겹침 (핀 원만이면 247로 안 겹친다 -> +4 여유가 있어야 막힌다)
  ])('T15_B6_경계_다른_핀은_4_여유를_두고_잰다_위_핀_중심_y_%d면_%s', (y, side) => {
    expect(run([NEXT, pin('a', 'later', 195, y)]).label?.side).toBe(side);
  });

  test('T15_S11_Q3_오른쪽_이름표는_핀_중심에_세로_가운데', () => {
    expect(run([NEXT, ABOVE]).label).toEqual({ pinId: 'n', side: 'right', rect: { x: 195 + 18 + 6, y: 300 - H / 2, width: W, height: H } });
  });

  test('T15_S11_Q3_왼쪽_이름표는_핀_중심에_세로_가운데', () => {
    expect(run([NEXT, ABOVE, RIGHT]).label).toEqual({ pinId: 'n', side: 'left', rect: { x: 195 - 18 - 6 - W, y: 300 - H / 2, width: W, height: H } });
  });

  test.each([
    [195 + 18 + 6 + W + 1 + 18, 'right'], // 오른쪽 후보 오른쪽 끝 299, 원(나중 14 + 4) 왼쪽 끝 300: 1 떨어짐
    [195 + 18 + 6 + W + 18, 'left'], // 299 = 299: 맞닿음도 겹침 -> 왼쪽
  ])('T15_S11_Q3_경계_오른쪽_후보와_다른_핀_맞닿음_핀_중심_x_%d면_%s', (x, side) => {
    expect(run([NEXT, ABOVE, pin('r', 'later', x, 300)]).label?.side).toBe(side);
  });

  test('T15_B6_묶여서_빠진_핀은_이름표를_막지_않는다_핀_자리가_먼저', () => {
    const result = run([NEXT, pin('a', 'later', 195, 270)]); // 30 -> 묶임
    expect(shownIds(result)).toEqual(['n']);
    expect(result.label?.side).toBe('top');
  });

  test('T15_B6_내_위치_점과_겹치면_다음_후보', () => {
    expect(run([NEXT], { me: { x: 195, y: 262, size: 22 } }).label?.side).toBe('right');
  });

  test('T15_B6_경계_숙소에_머무는_동안은_내_위치_점을_그리지_않으니_막지_않는다', () => {
    const result = run([NEXT, pin('h', 'lodging', 60, 500)], { me: { x: 195, y: 262, size: 22 }, stayingAtLodging: true });
    expect(result.label?.side).toBe('top');
  });

  test('T15_B6_떠_있는_판과_겹치면_다음_후보', () => {
    expect(run([NEXT], { panels: [{ x: 0, y: 240, width: 390, height: 20 }] }).label?.side).toBe('right');
  });

  // §24: 판 여유 4 — 1 떨어지면 이제 겹침(옛 단언 'top'), 5 떨어져야 위
  test('T15_S24_경계_떠_있는_판과_1_떨어지면_이제_겹침이라_다음_후보', () => {
    expect(run([NEXT], { panels: [{ x: 0, y: 229, width: 390, height: 20 }] }).label?.side).toBe('right'); // 판 아래 끝 249, 위 후보 윗변 250
  });

  test('T15_S24_경계_떠_있는_판과_5_떨어지면_위', () => {
    expect(run([NEXT], { panels: [{ x: 0, y: 225, width: 390, height: 20 }] }).label?.side).toBe('top'); // 판 아래 끝 245
  });

  // §12 Q5 -> §24: 떠 있는 판은 간격 4 이하(맞닿음 포함)면 겹침, 5부터 통과. 위 후보 = x 155 ~ 235, y 250 ~ 278
  //   (오른쪽 후보 x 219 ~ 299 · y 286 ~ 314는 아래 판들과 4 넘게 떨어져 있어 'right'가 다음 후보로 나온다)
  test.each([
    [{ x: 0, y: 229, width: 390, height: 21 }, 'right'], // 판 아래 끝 250 = 위 후보 윗변: 맞닿음 (그대로 겹침)
    [{ x: 0, y: 226, width: 390, height: 20 }, 'right'], // 246: 4 떨어짐 -> 겹침
    [{ x: 0, y: 225, width: 390, height: 20 }, 'top'], // 245: 5 떨어짐
    [{ x: 235, y: 250, width: 50, height: 28 }, 'right'], // 판 왼쪽 끝 235 = 위 후보 오른쪽 끝: 맞닿음
    [{ x: 239, y: 250, width: 50, height: 28 }, 'right'], // 4 떨어짐 -> 겹침
    [{ x: 240, y: 250, width: 50, height: 28 }, 'top'], // 5 떨어짐
    [{ x: 105, y: 250, width: 50, height: 28 }, 'right'], // 판 오른쪽 끝 155 = 위 후보 왼쪽 끝: 맞닿음
    [{ x: 101, y: 250, width: 50, height: 28 }, 'right'], // 151: 4 떨어짐 -> 겹침
    [{ x: 100, y: 250, width: 50, height: 28 }, 'top'], // 150: 5 떨어짐
  ])('T15_S24_경계_떠_있는_판은_4_여유를_두고_잰다_판_%j면_%s', (panel, side) => {
    expect(run([NEXT], { panels: [panel] }).label?.side).toBe(side);
  });

  test('T15_S24_경계_내_위치_점_여유는_0_그대로(§24에_말_없음)', () => {
    // 점(반지름 11) 아래 끝 249 -> 위 후보 윗변과 1 떨어짐: 판이라면 겹침이지만 점은 통과
    expect(run([NEXT], { me: { x: 195, y: 238, size: 22 } }).label?.side).toBe('top');
  });

  test.each([
    [195, 239, 'right'], // 점(반지름 11) 아래 끝 250 = 위 후보 윗변: 맞닿음
    [195, 238, 'top'], // 249: 1 떨어짐
    [246, 264, 'right'], // 점 왼쪽 끝 235 = 위 후보 오른쪽 끝: 맞닿음
    [247, 264, 'top'], // 236: 1 떨어짐
  ])('T15_S12_Q5_경계_내_위치_점과_맞닿으면_겹침_점_중심_(%d,_%d)면_%s', (x, y, side) => {
    expect(run([NEXT], { me: { x, y, size: 22 } }).label?.side).toBe(side);
  });

  test.each([
    [58, 'top'], // 위 후보 y = 8 (가장자리에서 8)
    [57.5, 'right'], // 7.5
  ])('T15_B6_경계_화면_위_가장자리_8_안쪽_다음_핀_y_%d면_%s', (y, side) => {
    expect(run([pin('n', 'next', 195, y)]).label?.side).toBe(side);
  });

  test.each([
    [48, 'top'], // 위 후보 x = 8
    [47.5, 'right'],
  ])('T15_B6_경계_화면_왼쪽_가장자리_8_안쪽_다음_핀_x_%d면_%s', (x, side) => {
    expect(run([pin('n', 'next', x, 300)]).label?.side).toBe(side);
  });

  test.each([
    [342, 'top'], // 위 후보 오른쪽 끝 382 = 390 − 8
    [342.5, 'left'], // 위는 넘치고 오른쪽 후보는 더 넘친다
  ])('T15_B6_경계_화면_오른쪽_가장자리_8_안쪽_다음_핀_x_%d면_%s', (x, side) => {
    expect(run([pin('n', 'next', x, 300)]).label?.side).toBe(side);
  });

  test('T15_B6_이름표는_다음_핀에만_다음_핀이_없으면_없다', () => {
    expect(run([pin('w', 'now', 195, 300), pin('l', 'later', 300, 450)]).label).toBeNull();
    expect(run([]).label).toBeNull();
  });
});

// =====================================================================
// 속성 (fast-check) — 아무 배치에서나 지켜지는 것
// =====================================================================

const RANK: PinKind[] = ['next', 'now', 'lodging', 'later', 'done'];

const arbInput: fc.Arbitrary<PinOverlapInput> = fc
  .record({
    singles: fc.subarray(['next', 'now', 'lodging'] as PinKind[]),
    later: fc.integer({ min: 0, max: 4 }),
    done: fc.integer({ min: 0, max: 4 }),
    spots: fc.array(fc.tuple(fc.integer({ min: 0, max: SCREEN.width }), fc.integer({ min: 0, max: SCREEN.height })), { minLength: 11, maxLength: 11 }),
    seqs: fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 11, maxLength: 11 }), // 코스 번호 (순위와 따로 섞는다)
    me: fc.option(fc.tuple(fc.integer({ min: 0, max: SCREEN.width }), fc.integer({ min: 0, max: SCREEN.height })), { nil: null }),
    panel: fc.option(fc.tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 500 })), { nil: null }),
    staying: fc.boolean(),
    labelWidth: fc.integer({ min: 30, max: 160 }),
  })
  .map(({ singles, later, done, spots, seqs, me, panel, staying, labelWidth }) => {
    const kinds: PinKind[] = [...singles, ...Array<PinKind>(later).fill('later'), ...Array<PinKind>(done).fill('done')];
    return {
      pins: kinds.map((kind, i) => pin(`p${i}`, kind, spots[i][0], spots[i][1], kind === 'lodging' ? null : seqs[i])),
      screen: SCREEN,
      labelWidth,
      me: me ? { x: me[0], y: me[1], size: 22 } : null,
      panels: panel ? [{ x: panel[0], y: panel[1], width: 90, height: 48 }] : [],
      stayingAtLodging: staying && singles.includes('lodging'),
    };
  });

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** §11 Q3 ③ · §12 Q5: 다른 핀(+4)·내 위치 점과는 맞닿음(간격 0)도 겹침 */
const rectTouchesCircle = (r: Rect, c: { x: number; y: number }, radius: number) => {
  const nx = Math.min(Math.max(c.x, r.x), r.x + r.width);
  const ny = Math.min(Math.max(c.y, r.y), r.y + r.height);
  return Math.hypot(c.x - nx, c.y - ny) <= radius + 1e-9;
};
/** 두 사각형 사이 거리 (겹치면 0) */
const rectGap = (a: Rect, b: Rect) => {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(dx, dy);
};
/** §24: 떠 있는 판과는 간격 4 이하면 겹침 (§12 Q5 여유 0 -> 4). 모서리 쪽(대각선) 판정 방식은 문서에 없어 유클리드 거리 > 4만 본다 */
const PANEL_MARGIN = 4;

describe('§B6 속성', () => {
  test('T15_B6_P_모든_핀은_보이거나_한_핀에_묶여_정확히_한_번_나온다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = resolvePinOverlap(input);
        const seen = [...result.pins.map((p) => p.id), ...result.pins.flatMap((p) => p.hidden)].sort();
        expect(seen).toEqual(input.pins.map((p) => p.id).sort());
      }),
    );
  });

  test('T15_B6_P_보이는_핀끼리는_중심_거리_36_이상', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { pins } = resolvePinOverlap(input);
        for (let i = 0; i < pins.length; i += 1) for (let j = i + 1; j < pins.length; j += 1) expect(dist(pins[i], pins[j])).toBeGreaterThanOrEqual(GROUP_DISTANCE);
      }),
    );
  });

  test('T15_B6_P_빠진_핀은_자기를_묶은_핀보다_순위가_낮고_36_미만_숙소는_번호_핀에', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = resolvePinOverlap(input);
        const original = new Map(input.pins.map((p) => [p.id, p]));
        for (const shown of result.pins) {
          for (const id of shown.hidden) {
            const gone = original.get(id)!;
            expect(dist(original.get(shown.id)!, gone)).toBeLessThan(GROUP_DISTANCE);
            if (gone.kind === 'lodging') expect(shown.kind).not.toBe('lodging');
            else {
              expect(shown.kind).not.toBe('lodging'); // 번호 핀은 숙소에 붙지 않는다 (Q5)
              expect(RANK.indexOf(shown.kind)).toBeLessThanOrEqual(RANK.indexOf(gone.kind));
              if (shown.kind === gone.kind) expect(shown.seq!).toBeLessThan(gone.seq!); // 같은 순위면 번호가 앞선 핀이 남는다 (Q4)
            }
          }
        }
      }),
    );
  });

  test('T15_B6_P_다음_핀은_늘_보인다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const next = input.pins.find((p) => p.kind === 'next');
        if (next) expect(resolvePinOverlap(input).pins.map((p) => p.id)).toContain(next.id);
      }),
    );
  });

  test('T15_B6_P_배지는_빠진_것과_맞는다_+N은_번호_핀_수_집은_숙소가_빠졌을_때', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const kindOf = new Map(input.pins.map((p) => [p.id, p.kind]));
        for (const shown of resolvePinOverlap(input).pins) {
          const numbered = shown.hidden.filter((id) => kindOf.get(id) !== 'lodging').length;
          const plus = shown.badges.find((b) => b.type === 'plus');
          const home = shown.badges.find((b) => b.type === 'home');
          expect(plus ? (plus as { count: number }).count : 0).toBe(numbered);
          expect(Boolean(home)).toBe(shown.hidden.some((id) => kindOf.get(id) === 'lodging'));
          if (plus) expect(plus.corner).toBe(home ? 'bottom-right' : 'top-right');
        }
      }),
    );
  });

  test('T15_B6_P_서로_36_이상_떨어지면_아무것도_빠지지_않는다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { pins } = input;
        const apart = pins.every((a, i) => pins.every((b, j) => i >= j || dist(a, b) >= GROUP_DISTANCE));
        fc.pre(apart);
        const result = resolvePinOverlap(input);
        expect(result.pins).toHaveLength(pins.length);
        for (const shown of result.pins) expect(shown.badges).toEqual([]);
      }),
    );
  });

  test('T15_B6_P_그리는_순서는_아래부터_순위_낮은_핀', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const ranks = resolvePinOverlap(input).pins.map((p) => RANK.indexOf(p.kind));
        for (let i = 1; i < ranks.length; i += 1) expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
      }),
    );
  });

  test('T15_B6_P_이름표가_있으면_다음_핀에_붙고_화면_8_안쪽이며_보이는_핀·점·판과_겹치지_않는다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = resolvePinOverlap(input);
        const { label } = result;
        if (!label) return;
        const next = input.pins.find((p) => p.kind === 'next');
        expect(label.pinId).toBe(next?.id);
        expect(label.rect.height).toBe(H);
        expect(label.rect.width).toBe(input.labelWidth);
        const r = label.rect;
        expect(r.x).toBeGreaterThanOrEqual(8);
        expect(r.y).toBeGreaterThanOrEqual(8);
        expect(r.x + r.width).toBeLessThanOrEqual(SCREEN.width - 8);
        expect(r.y + r.height).toBeLessThanOrEqual(SCREEN.height - 8);
        for (const other of result.pins) if (other.id !== label.pinId) expect(rectTouchesCircle(r, other, other.size / 2 + 4)).toBe(false);
        if (input.me && result.meDot) expect(rectTouchesCircle(r, input.me, input.me.size / 2)).toBe(false); // §12 Q5 맞닿음도 겹침
        for (const panel of input.panels ?? []) expect(rectGap(r, panel)).toBeGreaterThan(PANEL_MARGIN - 1e-9); // §24 판과 4 넘게
      }),
    );
  });

  test('T15_B6_P_머무는_동안이면_내_위치_점은_없고_숙소는_보이면_지금_핀_모양', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const result = resolvePinOverlap(input);
        if (input.stayingAtLodging) {
          expect(result.meDot).toBe(false);
          for (const shown of result.pins) if (shown.kind === 'lodging') expect(shown.shape).toBe('now');
        } else {
          expect(result.meDot).toBe(Boolean(input.me));
        }
      }),
    );
  });

  test('T15_B6_P_같은_입력이면_같은_결과이고_입력을_바꾸지_않는다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const copy = JSON.parse(JSON.stringify(input));
        expect(resolvePinOverlap(input)).toEqual(resolvePinOverlap(copy));
        expect(input).toEqual(copy);
      }),
    );
  });
  test('T15_S11_Q4_P_묶음은_욕심_방식_기준_계산과_같다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const expected = greedy(input.pins);
        const result = resolvePinOverlap(input);
        const got = new Map(result.pins.map((p) => [p.id, [...p.hidden].sort()]));
        expect(new Map([...expected].map(([id, hidden]) => [id, [...hidden].sort()]))).toEqual(got);
      }),
    );
  });

  test('T15_S11_Q4_P_입력_순서를_바꿔도_결과가_같다', () => {
    fc.assert(
      fc.property(arbInput, fc.nat(), (input, turn) => {
        const k = input.pins.length ? turn % input.pins.length : 0;
        const rotated = { ...input, pins: [...input.pins.slice(k), ...input.pins.slice(0, k)].reverse() };
        const norm = (r: ReturnType<typeof resolvePinOverlap>) => ({
          pins: r.pins.map((p) => ({ ...p, hidden: [...p.hidden].sort() })).sort((a, b) => (a.id < b.id ? -1 : 1)),
          label: r.label,
          meDot: r.meDot,
        });
        expect(norm(resolvePinOverlap(rotated))).toEqual(norm(resolvePinOverlap(input)));
      }),
    );
  });

  test('T15_S11_Q6_P_보이는_핀마다_빈_글이_아닌_a11yLabel_번호_핀은_자기·묶인_번호를_모두_담는다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const seqOf = new Map(input.pins.map((p) => [p.id, p.seq]));
        for (const shown of resolvePinOverlap(input).pins) {
          expect(typeof shown.a11yLabel).toBe('string');
          expect(shown.a11yLabel.trim()).not.toBe('');
          if (shown.kind !== 'lodging') expect(shown.a11yLabel).toContain(`${shown.seq}번`);
          for (const id of shown.hidden) {
            const seq = seqOf.get(id);
            expect(shown.a11yLabel).toContain(seq === null ? '숙소' : `${seq}번`);
          }
        }
      }),
    );
  });
});

/** §11 Q4·Q5 기준 계산: 번호 핀을 순위 -> 번호 순으로, 남긴 핀 중 36 안의 첫 핀에 붙거나 새로 남는다. 그 뒤 숙소를 남긴 번호 핀에. 보이는 id -> 붙은 id[] */
function greedy(pins: ScreenPin[]): Map<string, string[]> {
  const numbered = pins.filter((p) => p.kind !== 'lodging').sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind) || a.seq! - b.seq!);
  const kept: ScreenPin[] = [];
  const out = new Map<string, string[]>();
  for (const p of numbered) {
    const host = kept.find((k) => dist(k, p) < GROUP_DISTANCE);
    if (host) out.get(host.id)!.push(p.id);
    else {
      kept.push(p);
      out.set(p.id, []);
    }
  }
  for (const home of pins.filter((p) => p.kind === 'lodging')) {
    const host = kept.find((k) => dist(k, home) < GROUP_DISTANCE);
    if (host) out.get(host.id)!.push(home.id);
    else out.set(home.id, []);
  }
  return out;
}
