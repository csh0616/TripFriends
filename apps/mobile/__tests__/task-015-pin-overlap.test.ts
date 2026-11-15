/// <reference types="jest" />
// TASK-015 §B6 핀 겹침 규칙 — 순수 함수 (앱). 보이는 모습(색·테두리 굵기)은 보지 않고, 어떤 핀·배지·이름표 자리가 나오는지만 본다.
// 근거: TASK-015 §B6("가림 순서 · 이름표 자리 후보(위→오른쪽→왼쪽→아래, 다 안 되면 뺌) · 중심 거리 < 36 묶기 +N 배지 · 숙소+번호 핀 집 배지 ·
//       숙소에 머무는 동안 숙소 마커가 '지금 핀' 모양 · 내 위치 점은 핀 아래 · 계산 순서 ①~⑤. 순수 함수로 — 입력: 핀 화면 좌표·순위, 출력: 보일 핀·배지·이름표 자리") ·
//       §9 Q10(test-writer가 먼저) · docs/design/reviews/task-014-design.md §11-3 표(값)·§12-3(계산 순서 한 줄 요약) · DESIGN-001 §4-6(핀 크기 28 / 32 / 36) ·
//       §6("핀 겹침 계산 실패 -> 규칙 없이 지금처럼 그림").
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   모듈 '@/lib/pin-overlap'
//   resolvePinOverlap({ pins, screen, labelWidth, me?, panels?, stayingAtLodging? }) -> { pins: ShownPin[], label, meDot }
//     입력 pins = [{ id, kind: next|now|lodging|later|done, x, y(핀 중심, pt), size(지름) }] — ① 카메라는 부르는 쪽이 끝낸 뒤의 화면 좌표
//     출력 pins = 보일 핀만, 그리는 순서(아래 -> 위) done · later · lodging · now · next. 각 핀 { ...입력, shape: pin|home|now, badges, hidden: 묶여 빠진 id[] }
//     badges: { type: 'plus', count, corner } (빠진 번호 핀 수) · { type: 'home', corner: 'top-right' } (숙소가 번호 핀에 묶임). 둘 다면 home 오른쪽 위, plus 오른쪽 아래
//     label = 다음 핀 하나의 이름표 { pinId, side: top|right|left|bottom, rect } | null
//   이름표 자리 (§11-3 "높이 28 · 핀과 위 4 · 옆 6"):
//     top    = { x: cx − w/2, y: cy − size/2 − 4 − 28, w, 28 }      bottom = { x: cx − w/2, y: cy + size/2 + 4, w, 28 }
//     right  = { x: cx + size/2 + 6, (세로 가운데 맞춤), w, 28 }       left   = { x: cx − size/2 − 6 − w, (세로 가운데 맞춤), w, 28 }
//     막히는 것: 보이는 다른 핀(원, 반지름 size/2 + 4) · 내 위치 점(원, 반지름 size/2, 숙소에 머무는 동안은 그리지 않아 막지 않음) · 떠 있는 판 ·
//                화면 가장자리에서 8 안쪽을 벗어남. 겹침 = 넓이가 생기는 겹침 (테스트는 1pt 이상 떨어뜨리거나 겹치게 둔다)
//   묶기: 중심 거리 < 36(GROUP_DISTANCE)이면 순위가 낮은 핀이 빠진다 (순위 next > now > lodging > later > done). 다만 숙소와 번호 핀이면 번호 핀이 이긴다(집 배지)
//   숙소에 머무는 동안: 숙소 마커 shape 'now'·size 32, meDot false
import fc from 'fast-check';

import { GROUP_DISTANCE, PIN_STACK, resolvePinOverlap, type PinKind, type PinOverlapInput, type Rect, type ScreenPin } from '@/lib/pin-overlap';

const SCREEN = { width: 390, height: 600 };
const W = 80; // 이름표 폭 (화면이 잰 값으로 친다)
const H = 28;
const SIZE: Record<PinKind, number> = { next: 36, now: 32, done: 32, later: 28, lodging: 32 }; // DESIGN-001 §4-6 (숙소는 가정 — 질문)

const pin = (id: string, kind: PinKind, x: number, y: number): ScreenPin => ({ id, kind, x, y, size: SIZE[kind] });
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
// 머무는 동안 = 숙소 (§11-3: 숙소 마커가 "지금 핀" 모양 32, 내 위치 점·reh-dot은 그리지 않음)
// =====================================================================

describe('§B6 숙소에 머무는 동안', () => {
  const ME = { x: 100, y: 100, size: 22 };

  test('T15_B6_머무는_동안_숙소_마커는_지금_핀_모양_32이고_내_위치_점을_그리지_않는다', () => {
    const result = run([pin('h', 'lodging', 100, 100), NEXT], { me: ME, stayingAtLodging: true });
    expect(byId(result, 'h').shape).toBe('now');
    expect(byId(result, 'h').size).toBe(32);
    expect(result.meDot).toBe(false);
  });

  test('T15_B6_경계_머물지_않으면_숙소는_숙소_모양이고_내_위치_점을_그린다', () => {
    const result = run([pin('h', 'lodging', 100, 100), NEXT], { me: ME, stayingAtLodging: false });
    expect(byId(result, 'h').shape).toBe('home');
    expect(result.meDot).toBe(true);
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
    [233, 'right'], // 251 > 250: 1 겹침 (핀 원만이면 247로 안 겹친다 -> +4 여유가 있어야 막힌다)
  ])('T15_B6_경계_다른_핀은_4_여유를_두고_잰다_위_핀_중심_y_%d면_%s', (y, side) => {
    expect(run([NEXT, pin('a', 'later', 195, y)]).label?.side).toBe(side);
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

  test('T15_B6_경계_떠_있는_판과_1_떨어지면_위', () => {
    expect(run([NEXT], { panels: [{ x: 0, y: 229, width: 390, height: 20 }] }).label?.side).toBe('top'); // 판 아래 끝 249
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
    me: fc.option(fc.tuple(fc.integer({ min: 0, max: SCREEN.width }), fc.integer({ min: 0, max: SCREEN.height })), { nil: null }),
    panel: fc.option(fc.tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 500 })), { nil: null }),
    staying: fc.boolean(),
    labelWidth: fc.integer({ min: 30, max: 160 }),
  })
  .map(({ singles, later, done, spots, me, panel, staying, labelWidth }) => {
    const kinds: PinKind[] = [...singles, ...Array<PinKind>(later).fill('later'), ...Array<PinKind>(done).fill('done')];
    return {
      pins: kinds.map((kind, i) => pin(`p${i}`, kind, spots[i][0], spots[i][1])),
      screen: SCREEN,
      labelWidth,
      me: me ? { x: me[0], y: me[1], size: 22 } : null,
      panels: panel ? [{ x: panel[0], y: panel[1], width: 90, height: 48 }] : [],
      stayingAtLodging: staying && singles.includes('lodging'),
    };
  });

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const rectHitsCircle = (r: Rect, c: { x: number; y: number }, radius: number) => {
  const nx = Math.min(Math.max(c.x, r.x), r.x + r.width);
  const ny = Math.min(Math.max(c.y, r.y), r.y + r.height);
  return Math.hypot(c.x - nx, c.y - ny) < radius - 1e-9;
};
const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9 && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9;

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
            else expect(RANK.indexOf(shown.kind)).toBeLessThanOrEqual(RANK.indexOf(gone.kind));
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
        for (const other of result.pins) if (other.id !== label.pinId) expect(rectHitsCircle(r, other, other.size / 2 + 4)).toBe(false);
        if (input.me && result.meDot) expect(rectHitsCircle(r, input.me, input.me.size / 2)).toBe(false);
        for (const panel of input.panels ?? []) expect(rectsOverlap(r, panel)).toBe(false);
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
});
