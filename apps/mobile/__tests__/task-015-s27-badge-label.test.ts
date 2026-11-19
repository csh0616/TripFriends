/// <reference types="jest" />
// TASK-015 §27 하-11: 배지(+N · 집)가 붙은 핀은 핀 + 배지를 한 덩어리로 보고, 이름표 간격(위 4 · 옆 6)을 그 바깥 경계에서 잰다. 순수 함수.
// 근거: TASK-015 §27 표 "하-11 (71 · 72): +N 배지 핀 위 이름표가 배지와 약 2 닿음 -> 고친다" ·
//       docs/design/reviews/task-014-design.md §11-3 "이름표 자리" 줄(11-18 추가 문장): "배지(+N · 집)가 붙은 핀은 핀 + 배지를 한 덩어리로 본다:
//       위 4 · 옆 6은 그 바깥 경계에서 잰다(배지가 핀 오른쪽 위 +10 −10 · 지름 20이라 28 핀은 위 후보가 핀 윗변 위 10, 오른쪽 후보가 핀 가장자리 옆 12)" ·
//       같은 표 "가까운 핀 묶기"(+N 배지 지름 20 · 핀 오른쪽 위 +10, −10) · "숙소 + 번호 핀"(집 배지 지름 20 · 핀 오른쪽 위) ·
//       task-015-design §14-3 하-11("테스트에 '이름표 ∩ (핀 + 배지) = ∅' 더하기")
//
//       **TASK-015 §31 · task-015-design §17-1(11-19, 디자이너 정정 — 보드 ②-06a 값)**: 배지 가운데 옛 (+10, −10) -> **(+15, −14)**. 집 + N 둘 다면 집 (+15, −14) · +N (+15, +14). 지름 20.
//         이름표 자리(28 핀): 위 14 · 오른쪽 17 · 둘 다면 아래도 14 · 왼쪽 6 (옛: 위 10 · 오른쪽 12 · 아래 10). 옛 숫자 단언은 모두 새 값으로 바꿨다
//
// 계약 (이 파일이 정한 것):
//   오른쪽 위 배지 = 원(가운데 = 핀 가운데 + (15, −14), 반지름 10) · 오른쪽 아래 배지 = (15, +14). 덩어리 = 핀 원과 배지 원들을 감싼 상자
//     -> 덩어리 위 = min(cy − r, cy − 24) · 오른쪽 = max(cx + r, cx + 25) · 아래(오른쪽 아래 배지가 있으면) = max(cy + r, cy + 24) · 왼쪽은 핀 그대로 (r = 핀 지름 / 2)
//     (28 핀: 위 후보 아랫변 = 핀 윗변 − 14, 오른쪽 후보 왼변 = 핀 가장자리 + 17, 둘 다면 아래 후보 윗변 = 핀 아랫변 + 14 — §17-1 표와 같다)
//   후보: 위 (cx − w/2, 덩어리 위 − 4 − 28) · 오른쪽 (덩어리 오른쪽 + 6, cy − 14) · 왼쪽 (cx − r − 6 − w, cy − 14) · 아래 (cx − w/2, cy + r + 4)
//     옆 이름표 세로 가운데는 지금처럼 핀 가운데 (TASK-015 §11 Q3)
//   다른 핀의 배지도 그 핀 덩어리의 일부 -> 이름표가 다른 핀의 배지 원(+4 여유)에 닿으면 다음 후보 ("다른 핀 +4 여유"를 덩어리에)
//   배지가 없는 핀은 지금 값 그대로 (위 4 · 옆 6을 핀 원에서)
import fc from 'fast-check';

import { resolvePinOverlap, type PinKind, type PinOverlapInput, type Rect, type ScreenPin } from '@/lib/pin-overlap';

const SCREEN = { width: 390, height: 600 };
const W = 80;
const H = 28;
const SIZE: Record<PinKind, number> = { next: 36, now: 32, done: 28, later: 28, lodging: 28 };
const BADGE_DX = 15; // §31: 배지 가운데 = 핀 가운데 + (15, ∓14) (옛 (10, ∓10))
const BADGE_DY = 14;
const BADGE_R = 10; // 지름 20

const pin = (id: string, kind: PinKind, x: number, y: number, seq: number | null = kind === 'lodging' ? null : 1): ScreenPin => ({ id, kind, x, y, size: SIZE[kind], seq });
const run = (pins: ScreenPin[], over: Partial<PinOverlapInput> = {}) => resolvePinOverlap({ pins, screen: SCREEN, labelWidth: W, ...over });

const badgeOf = (p: { x: number; y: number }, corner: 'top-right' | 'bottom-right' = 'top-right') => ({ x: p.x + BADGE_DX, y: p.y + (corner === 'top-right' ? -BADGE_DY : BADGE_DY), r: BADGE_R });
const lumpTop = (p: { y: number; size: number }) => Math.min(p.y - p.size / 2, p.y - BADGE_DY - BADGE_R);
const lumpRight = (p: { x: number; size: number }) => Math.max(p.x + p.size / 2, p.x + BADGE_DX + BADGE_R);
const lumpBottomBoth = (p: { y: number; size: number }) => Math.max(p.y + p.size / 2, p.y + BADGE_DY + BADGE_R);

function touchesCircle(rect: Rect, c: { x: number; y: number }, radius: number): boolean {
  const nx = Math.min(Math.max(c.x, rect.x), rect.x + rect.width);
  const ny = Math.min(Math.max(c.y, rect.y), rect.y + rect.height);
  return Math.hypot(c.x - nx, c.y - ny) <= radius + 1e-9;
}

describe('§27 하-11 +N 배지가 붙은 다음 핀 — 덩어리 바깥에서 위 4 · 옆 6', () => {
  // 다음 핀(36) 가운데 (195, 300), 나중 핀이 20 떨어져(< 36) 묶여 +N 배지
  const NEXT = pin('n', 'next', 195, 300, 1);
  const LATER = pin('l', 'later', 195 - 20, 300 + 5, 2);

  test('T15_S27_시험_자체_확인_다음_핀에_+N_배지가_오른쪽_위', () => {
    const shown = run([NEXT, LATER]).pins.find((p) => p.id === 'n');
    expect(shown?.badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]);
  });

  test('T15_S31_위_후보는_배지_윗변(가운데_−24)_위_4', () => {
    const { label } = run([NEXT, LATER]);
    expect(label?.side).toBe('top');
    // 36 핀: 덩어리 위 = min(300 − 18, 300 − 24) = 276 -> 이름표 아랫변 272 (§27 옛 값 276)
    expect(label?.rect).toEqual({ x: 195 - W / 2, y: lumpTop(NEXT) - 4 - H, width: W, height: H });
    expect((label?.rect.y ?? 0) + H).toBe(272);
  });

  test('T15_S31_오른쪽_후보는_배지_오른쪽(가운데_+25)_옆_6', () => {
    // 위를 막는다: 다음 핀 바로 위 다른 핀 (묶이지 않게 36 이상)
    const ABOVE = pin('a', 'done', 195, 300 - 50, 3);
    const { label } = run([NEXT, LATER, ABOVE]);
    expect(label?.side).toBe('right');
    expect(label?.rect).toEqual({ x: lumpRight(NEXT) + 6, y: 300 - H / 2, width: W, height: H });
    expect(label?.rect.x).toBe(195 + 31); // §27 옛 195 + 26
  });

  test('T15_S27_왼쪽_아래_후보는_배지와_상관없이_지금_값', () => {
    // 위 · 오른쪽을 막는다
    const ABOVE = pin('a', 'done', 195, 300 - 50, 3);
    const RIGHT = pin('r', 'done', 195 + 60, 300, 4);
    const left = run([NEXT, LATER, ABOVE, RIGHT]).label;
    expect(left?.side).toBe('left');
    expect(left?.rect).toEqual({ x: 195 - 18 - 6 - W, y: 300 - H / 2, width: W, height: H });
  });
});

describe('§31 28 핀 (§17-1 표: 위 14 · 오른쪽 17 · 둘 다면 아래 14 · 왼쪽 6)', () => {
  // 크게 보기('all') 나중 핀 28. 핀 1 가운데 (200, 300), 핀 2가 15 떨어져 묶임 -> 핀 1에 +N
  const P1 = pin('p1', 'later', 200, 300, 1);
  const P2 = pin('p2', 'later', 200 - 15, 300 + 5, 2);

  test('T15_S31_28_핀_+N_위_후보_아랫변_=_핀_윗변_−_14', () => {
    const result = run([P1, P2], { labelMode: 'all' });
    expect(result.pins.find((p) => p.id === 'p1')?.badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]); // 시험 자체 확인
    const placed = (result.labels ?? []).find((l) => l.pinId === 'p1');
    expect(placed?.side).toBe('top');
    expect((placed?.rect.y ?? 0) + H).toBe(300 - 14 - 14); // §27 옛 − 10
  });

  test('T15_S31_28_핀_+N_오른쪽_후보_왼변_=_핀_가장자리_+_17', () => {
    const ABOVE = pin('a', 'done', 200, 300 - 50, 3);
    const placed = (run([P1, P2, ABOVE], { labelMode: 'all' }).labels ?? []).find((l) => l.pinId === 'p1');
    expect(placed?.side).toBe('right');
    expect(placed?.rect.x).toBe(200 + 14 + 17); // §27 옛 + 12
  });

  test('T15_S31_28_핀_집_배지도_같은_덩어리(위_후보_아랫변_=_핀_윗변_−_14)', () => {
    const HOME = pin('h', 'lodging', 200 + 10, 300 + 10);
    const result = run([P1, HOME], { labelMode: 'all' });
    expect(result.pins.find((p) => p.id === 'p1')?.badges).toEqual([{ type: 'home', corner: 'top-right' }]); // 시험 자체 확인
    const placed = (result.labels ?? []).find((l) => l.pinId === 'p1');
    expect(placed?.side).toBe('top');
    expect((placed?.rect.y ?? 0) + H).toBe(300 - 14 - 14); // §27 옛 − 10
  });

  test('T15_S31_28_핀_집_+_N_둘_다면_아래_후보_윗변_=_핀_아랫변_+_14_왼쪽은_6', () => {
    // 핀 1 (200, 300)에 집(10, 10 떨어짐)과 나중 핀 2(15 떨어짐)가 묶여 집 오른쪽 위 · +N 오른쪽 아래. 위 · 오른쪽을 다른 핀으로 막는다
    const HOME = pin('h', 'lodging', 210, 310);
    const ABOVE = pin('a', 'done', 200, 300 - 60, 3);
    const RIGHT = pin('r', 'done', 200 + 70, 300, 4);
    const both = run([P1, P2, HOME, ABOVE, RIGHT], { labelMode: 'all' });
    expect(both.pins.find((p) => p.id === 'p1')?.badges).toEqual([
      { type: 'home', corner: 'top-right' },
      { type: 'plus', count: 1, corner: 'bottom-right' },
    ]); // 시험 자체 확인
    const placed = (both.labels ?? []).find((l) => l.pinId === 'p1');
    expect(placed?.side).toBe('left');
    expect((placed?.rect.x ?? 0) + W).toBe(200 - 14 - 6);
    // 왼쪽도 막으면 아래 = 덩어리 아래(+24) + 4
    const LEFT = pin('l', 'done', 200 - 70, 300, 5);
    const lower = (run([P1, P2, HOME, ABOVE, RIGHT, LEFT], { labelMode: 'all' }).labels ?? []).find((l) => l.pinId === 'p1');
    expect(lower?.side).toBe('bottom');
    expect(lower?.rect.y).toBe(lumpBottomBoth(P1) + 4);
    expect(lower?.rect.y).toBe(300 + 14 + 14);
  });

  test('T15_S27_배지_없는_28_핀은_지금_값_그대로(위_4_·_옆_6)', () => {
    const LONE = pin('p1', 'later', 200, 300, 1);
    const placed = (run([LONE], { labelMode: 'all' }).labels ?? [])[0];
    expect(placed?.side).toBe('top');
    expect((placed?.rect.y ?? 0) + H).toBe(300 - 14 - 4);
  });
});

describe('§27 하-11 다른 핀의 배지도 장애물 (덩어리 + 4)', () => {
  test('T15_S31_위_후보가_옆_핀의_배지에만_닿으면_다음_후보', () => {
    // 다음 핀(36) (195, 300)의 위 후보 = x 155–235 · y 250–278. 나중 핀 Q (231, 300)는 다음 핀과 정확히 36(묶이지 않음),
    // Q에 묶인 R (241, 310)으로 Q에 +N 배지(§31: 가운데 246, 286). Q 원 + 4(18)는 위 후보와 22 떨어져 안 닿고, 배지 원 + 4(14)는 13.6으로 닿는다
    const NEXT = pin('n', 'next', 195, 300, 1);
    const topRect: Rect = { x: 195 - W / 2, y: 300 - 18 - 4 - H, width: W, height: H };
    const Q = pin('q', 'later', 231, 300, 2);
    const R = pin('r', 'done', 241, 310, 3);
    // 시험 자체 확인: NEXT와 Q · R은 36 이상 떨어져 묶이지 않고, Q 원 + 4는 위 후보에 안 닿고, Q 배지 원 + 4는 닿는다
    expect(Math.hypot(NEXT.x - Q.x, NEXT.y - Q.y)).toBeGreaterThanOrEqual(36);
    expect(Math.hypot(NEXT.x - R.x, NEXT.y - R.y)).toBeGreaterThanOrEqual(36);
    expect(touchesCircle(topRect, Q, Q.size / 2 + 4)).toBe(false);
    const qb = badgeOf(Q);
    expect(touchesCircle(topRect, qb, qb.r + 4)).toBe(true);
    const result = run([NEXT, Q, R]);
    expect(result.pins.find((p) => p.id === 'q')?.badges).toEqual([{ type: 'plus', count: 1, corner: 'top-right' }]);
    expect(result.label?.side).not.toBe('top');
  });
});

describe('§27 · §31 속성: 이름표 ∩ (핀 + 배지들) = ∅ (오른쪽 위 · 오른쪽 아래)', () => {
  const kinds: PinKind[] = ['next', 'now', 'later', 'done', 'lodging'];
  // 묶음(배지)이 자주 생기게 한 점 둘레(±30)에 핀을 모은다
  const arbPins = fc
    .record({ cx: fc.integer({ min: 40, max: SCREEN.width - 40 }), cy: fc.integer({ min: 40, max: SCREEN.height - 40 }), n: fc.integer({ min: 2, max: 6 }) })
    .chain(({ cx, cy, n }) =>
      fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          fc
            .record({ kind: fc.constantFrom(...kinds), dx: fc.integer({ min: -30, max: 30 }), dy: fc.integer({ min: -30, max: 30 }) })
            .map(({ kind, dx, dy }) => pin(`p${i}`, kind, cx + dx, cy + dy, kind === 'lodging' ? null : i + 1)),
        ),
      ),
    );

  test('T15_S27_P_놓인_이름표는_자기_핀_배지와_닿지_않고_다른_핀의_배지와_4_넘게_떨어진다', () => {
    fc.assert(
      fc.property(arbPins, fc.constantFrom<'next' | 'all'>('next', 'all'), (pins, labelMode) => {
        const result = resolvePinOverlap({ pins, screen: SCREEN, labelWidth: W, labelMode });
        for (const placed of result.labels ?? (result.label ? [result.label] : [])) {
          for (const shown of result.pins) {
            for (const badge of shown.badges) {
              const b = badgeOf(shown, badge.corner);
              const margin = shown.id === placed.pinId ? 0 : 4;
              expect(touchesCircle(placed.rect, b, b.r + margin - (shown.id === placed.pinId ? 1e-6 : 0))).toBe(false);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
