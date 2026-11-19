/// <reference types="jest" />
// TASK-015 §17 핀 겹침 "모든 이름표" 모드 — 순수 함수 (앱). 어떤 핀에 이름표가 어느 자리로 붙는지만 본다 (모습은 보지 않는다).
// 근거: TASK-015 §17 "frontend가 문서 없이 정한 것" 표("크게 보기에 이름표 없음" -> 고친다: 디자인 ①-41대로 5곳 이하면 모든 핀에 이름표.
//       겹침 함수에 '모든 이름표' 모드: 같은 자리 후보 순서(위 -> 오른쪽 -> 왼쪽 -> 아래), 겹치면 그 이름표만 뺌, 6곳 이상이면 다음 핀 규칙. test-writer 테스트 먼저) ·
//       task-015-design §2 "이름표: 핀마다 이름표(5곳 이하일 때) ... 6곳 이상이면 B6의 묶음·이름표 빼기 규칙" · task-014-design §11-3 이름표 자리 값(높이 28 · 위 4 · 옆 6 · 가장자리 8) ·
//       TASK-015 §13 Q1(장애물 여유: 다른 핀 4 · 떠 있는 판 0, 맞닿음까지 겹침) -> §24(11-18): 떠 있는 판 여유 **4**(간격 4 이하면 겹침, 닿으면 다음 후보)
//
// 계약 (이 테스트가 제안 — 껍데기 타입은 src/lib/pin-overlap.ts):
//   resolvePinOverlap 입력에 labelMode?: 'next' | 'all' (기본 'next') · labelWidths?: { [pinId]: 폭 } (없는 핀은 labelWidth)
//   출력에 labels: PlacedLabel[] ({pinId, side, rect}) — 놓인 이름표 전부. label(다음 핀 하나)은 지금 뜻 그대로
//   'all'이고 입력 번호 핀(숙소 뺀 것)이 ALL_LABELS_MAX(5) 이하: 보이는 번호 핀마다 같은 후보 순서로 자리를 찾고, 다 막히면 그 핀 이름표만 뺀다
//   'all'이고 6곳 이상: 'next'와 같다 (다음 핀 하나, 다음 핀이 없으면 이름표 없음)
//   'next'(기본): labels = label이 있으면 [label], 없으면 []
//   묶여 빠진 핀(hidden)에는 이름표가 없다. 숙소 마커의 이름표 · 이름표끼리 겹칠 때 · 묶기 전/후 어느 수로 5곳을 세는지는 문서에 없어 보지 않는다(질문)
import fc from 'fast-check';

import { ALL_LABELS_MAX, resolvePinOverlap, type PinKind, type PinOverlapInput, type PlacedLabel, type Rect, type ScreenPin } from '@/lib/pin-overlap';

const SCREEN = { width: 390, height: 844 };
const W = 80;
const H = 28;
const SIZE: Record<PinKind, number> = { next: 36, now: 32, done: 28, later: 28, lodging: 28 };
const X = 195;
const ROWS = [100, 220, 340, 460, 580, 700]; // 120씩 떨어져 서로의 이름표·핀과 닿지 않는다

const pin = (id: string, kind: PinKind, x: number, y: number, seq: number | null = null): ScreenPin => ({ id, kind, x, y, size: SIZE[kind], seq: kind === 'lodging' ? null : seq });
/** 나중 핀 n개를 세로로 (p1..pn) */
const column = (n: number, kind: PinKind = 'later') => ROWS.slice(0, n).map((y, i) => pin(`p${i + 1}`, kind, X, y, i + 1));
const run = (pins: ScreenPin[], over: Partial<PinOverlapInput> = {}) => resolvePinOverlap({ pins, screen: SCREEN, labelWidth: W, ...over });
const labelsOf = (result: ReturnType<typeof run>): PlacedLabel[] => {
  expect(Array.isArray(result.labels)).toBe(true); // 늘 배열
  return result.labels as PlacedLabel[];
};
const idsOf = (labels: PlacedLabel[]) => labels.map((l) => l.pinId).sort();
const top = (p: ScreenPin, w = W): Rect => ({ x: p.x - w / 2, y: p.y - p.size / 2 - 4 - H, width: w, height: H });
const right = (p: ScreenPin, w = W): Rect => ({ x: p.x + p.size / 2 + 6, y: p.y - H / 2, width: w, height: H });

test('T15_S17_모든_이름표_기준_수는_5곳', () => {
  expect(ALL_LABELS_MAX).toBe(5);
});

describe('§17 모든 이름표 — 5곳 이하', () => {
  test.each([1, 2, 3, 4, 5])('T15_S17_번호_핀_%i곳이면_모든_핀에_이름표', (n) => {
    const pins = column(n);
    const labels = labelsOf(run(pins, { labelMode: 'all' }));
    expect(idsOf(labels)).toEqual(pins.map((p) => p.id).sort());
  });

  test('T15_S17_자리가_비면_첫_후보_위에_핀_위_4·높이_28로', () => {
    const pins = column(5);
    const labels = labelsOf(run(pins, { labelMode: 'all' }));
    for (const p of pins) {
      const found = labels.find((l) => l.pinId === p.id)!;
      expect(found.side).toBe('top');
      expect(found.rect).toEqual(top(p));
    }
  });

  test('T15_S17_위가_떠_있는_판에_막히면_그_핀만_다음_후보_오른쪽', () => {
    const pins = column(5);
    const panel: Rect = { x: 0, y: 40, width: 390, height: 40 }; // p1(100)의 위 자리 54~82만 덮는다 (§24: 오른쪽 자리 86~114와는 6 떨어져 여유 4 밖)
    const labels = labelsOf(run(pins, { labelMode: 'all', panels: [panel] }));
    const first = labels.find((l) => l.pinId === 'p1')!;
    expect(first.side).toBe('right');
    expect(first.rect).toEqual(right(pins[0]));
    for (const p of pins.slice(1)) expect(labels.find((l) => l.pinId === p.id)!.side).toBe('top');
  });

  test('T15_S17_네_자리가_다_막힌_핀은_그_이름표만_뺀다', () => {
    const pins = column(5);
    const panel: Rect = { x: 0, y: 290, width: 390, height: 100 }; // p3(340) 둘레 네 자리 모두
    const result = run(pins, { labelMode: 'all', panels: [panel] });
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2', 'p4', 'p5']);
    expect(result.pins.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']); // 이름표 때문에 핀을 빼지 않는다
  });

  test.each([
    [0, 'right'], // 위 자리 윗변에 딱 닿음
    [1, 'right'], // 옛 여유 0에선 'top' -> §24 여유 4라 겹침
    [4, 'right'], // 4 떨어짐 = 여유와 같음 -> 겹침
    [5, 'top'], // 5 떨어짐 -> 위 그대로
  ])('T15_S24_경계_판과_%i_떨어지면_%s(판_여유_4)', (gap, side) => {
    const pins = column(1);
    const panel: Rect = { x: 0, y: 0, width: 390, height: top(pins[0]).y - gap };
    const labels = labelsOf(run(pins, { labelMode: 'all', panels: [panel] }));
    expect(labels[0].side).toBe(side);
  });

  test('T15_S17_핀마다_자기_이름표_폭을_쓴다', () => {
    const pins = column(3);
    const labels = labelsOf(run(pins, { labelMode: 'all', labelWidths: { p2: 120 } }));
    expect(labels.find((l) => l.pinId === 'p2')!.rect).toEqual(top(pins[1], 120));
    expect(labels.find((l) => l.pinId === 'p1')!.rect.width).toBe(W); // 없는 핀은 labelWidth
  });

  test('T15_S17_묶여_빠진_핀에는_이름표가_없다', () => {
    const pins = [...column(4), pin('p5', 'later', X + 20, ROWS[1], 5)]; // p5는 p2와 20 떨어져 p2에 묶인다
    const result = run(pins, { labelMode: 'all' });
    expect(result.pins.map((p) => p.id)).not.toContain('p5');
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('T15_S17_다음_핀이_있으면_label은_그_핀의_이름표와_같다', () => {
    const pins = [pin('p1', 'done', X, ROWS[0], 1), pin('p2', 'next', X, ROWS[1], 2), pin('p3', 'later', X, ROWS[2], 3)];
    const result = run(pins, { labelMode: 'all' });
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2', 'p3']);
    expect(result.label).toEqual(labelsOf(result).find((l) => l.pinId === 'p2'));
  });
});

describe('§17 모든 이름표 — 6곳 이상이면 다음 핀 규칙', () => {
  test('T15_S17_경계_6곳이고_다음_핀이_없으면_이름표_없음', () => {
    const result = run(column(6), { labelMode: 'all' });
    expect(labelsOf(result)).toEqual([]);
    expect(result.label).toBeNull();
  });

  test('T15_S17_경계_6곳이면_다음_핀_하나에만', () => {
    const pins = [...column(5), pin('p6', 'next', X, ROWS[5], 6)];
    const result = run(pins, { labelMode: 'all' });
    expect(idsOf(labelsOf(result))).toEqual(['p6']);
    expect(result.label?.pinId).toBe('p6');
  });

  test('T15_S17_경계_6곳_결과는_next_모드와_같다', () => {
    const pins = [...column(5), pin('p6', 'next', X, ROWS[5], 6)];
    expect(run(pins, { labelMode: 'all' })).toEqual(run(pins, { labelMode: 'next' }));
  });
});

describe('§17 기본(next) 모드', () => {
  test('T15_S17_기본_모드에서_다음_핀이_없으면_labels는_빈_목록', () => {
    const result = run(column(5));
    expect(labelsOf(result)).toEqual([]);
    expect(result.label).toBeNull();
  });

  test('T15_S17_기본_모드의_labels는_label_하나', () => {
    const pins = [pin('p1', 'later', X, ROWS[0], 1), pin('p2', 'next', X, ROWS[2], 2)];
    const result = run(pins);
    expect(result.label).not.toBeNull();
    expect(labelsOf(result)).toEqual([result.label]);
  });

  test('T15_S17_labelMode를_주지_않으면_next와_같다', () => {
    const pins = [pin('p1', 'later', X, ROWS[0], 1), pin('p2', 'next', X, ROWS[2], 2)];
    expect(run(pins)).toEqual(run(pins, { labelMode: 'next' }));
  });
});

// ---------- 속성: 아무 핀·판이어도 놓인 이름표는 규칙을 지킨다 ----------

/** 두 사각형 사이 거리 (겹치면 0). §24 판 여유 4 — 모서리 쪽 판정 방식은 문서에 없어 유클리드 거리 > 4만 본다 */
const rectGap = (a: Rect, b: Rect) => Math.hypot(Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0), Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0));
const touchesCircle = (r: Rect, c: { x: number; y: number }, radius: number) => {
  const nx = Math.min(Math.max(c.x, r.x), r.x + r.width);
  const ny = Math.min(Math.max(c.y, r.y), r.y + r.height);
  return Math.hypot(c.x - nx, c.y - ny) <= radius;
};

const kindArb = fc.constantFrom<PinKind>('next', 'now', 'later', 'done');
const pinsArb = fc
  .array(fc.record({ kind: kindArb, x: fc.integer({ min: 0, max: 390 }), y: fc.integer({ min: 0, max: 844 }) }), { minLength: 1, maxLength: 8 })
  .map((list) => {
    let nextSeen = false;
    return list.map((p, i) => {
      const kind: PinKind = p.kind === 'next' && nextSeen ? 'later' : p.kind; // 다음 핀은 하나
      if (kind === 'next') nextSeen = true;
      return pin(`p${i + 1}`, kind, p.x, p.y, i + 1);
    });
  });
const panelArb = fc.record({ x: fc.integer({ min: 0, max: 390 }), y: fc.integer({ min: 0, max: 844 }), width: fc.integer({ min: 1, max: 200 }), height: fc.integer({ min: 1, max: 200 }) });

test('T15_S17_속성_모든_이름표는_화면_8_안쪽이고_판·다른_핀과_닿지_않고_보이는_핀마다_하나_이하', () => {
  fc.assert(
    fc.property(pinsArb, fc.array(panelArb, { maxLength: 3 }), (pins, panels) => {
      const result = run(pins, { labelMode: 'all', panels });
      const labels = labelsOf(result);
      const shown = result.pins;
      const ids = labels.map((l) => l.pinId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const label of labels) {
        const owner = shown.find((p) => p.id === label.pinId);
        expect(owner).toBeDefined();
        expect(owner!.kind).not.toBe('lodging');
        const r = label.rect;
        expect(r.x).toBeGreaterThanOrEqual(8);
        expect(r.y).toBeGreaterThanOrEqual(8);
        expect(r.x + r.width).toBeLessThanOrEqual(SCREEN.width - 8);
        expect(r.y + r.height).toBeLessThanOrEqual(SCREEN.height - 8);
        for (const panel of panels) expect(rectGap(r, panel)).toBeGreaterThan(4 - 1e-9); // §24 판과 4 넘게
        for (const other of shown) if (other.id !== owner!.id) expect(touchesCircle(r, other, other.size / 2 + 4)).toBe(false);
      }
      const numbered = pins.filter((p) => p.kind !== 'lodging').length;
      if (numbered > ALL_LABELS_MAX) {
        expect(labels.length).toBeLessThanOrEqual(1);
        for (const label of labels) expect(shown.find((p) => p.id === label.pinId)!.kind).toBe('next');
      }
    }),
    { numRuns: 200 },
  );
});

// ---------- §18 Q1 모든 이름표 모드에서 숙소에는 이름표가 없다 ----------
// 근거: TASK-015 §18 test-writer 남은 질문 표 1("모든 이름표 모드에서 숙소에도 이름표? -> 없음 — 집 모양이 이미 숙소를 말한다")
// 계약: labelMode 'all'에서 숙소 마커(혼자 남은 것 · 머무는 중 '지금 핀' 모양 모두)의 id는 labels에 없다. 숙소는 5곳을 셀 때도 빠진다(지금 계약 그대로)
//       번호 핀에 집 배지로 붙은 숙소는 번호 핀의 이름표 하나뿐(숙소 몫 이름표를 따로 만들지 않는다)
describe('§18 Q1 모든 이름표 — 숙소는 이름표 없음', () => {
  const HOME = pin('home', 'lodging', X, ROWS[5]);

  test('T15_S18_Q1_혼자_남은_숙소_마커에는_이름표가_없고_번호_핀은_모두_있다', () => {
    const pins = [...column(3), HOME];
    const result = run(pins, { labelMode: 'all' });
    expect(result.pins.map((p) => p.id)).toContain('home'); // 시험 자체 확인: 숙소 마커가 보인다
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2', 'p3']);
  });

  test('T15_S18_Q1_숙소에_머무는_중(지금_핀_모양)이어도_숙소에는_이름표가_없다', () => {
    const pins = [...column(2), HOME];
    const result = run(pins, { labelMode: 'all', stayingAtLodging: true });
    expect(result.pins.find((p) => p.id === 'home')?.shape).toBe('now');
    expect(labelsOf(result).map((l) => l.pinId)).not.toContain('home');
  });

  test('T15_S18_Q1_경계_번호_핀_5곳_+_숙소면_모든_이름표_모드_그대로이고_숙소만_빠진다', () => {
    const pins = [...column(5), pin('home', 'lodging', X + 150, ROWS[5])];
    const result = run(pins, { labelMode: 'all' });
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  test('T15_S18_Q1_집_배지로_붙은_숙소는_따로_이름표가_없고_번호_핀_이름표_하나', () => {
    const pins = [...column(2), pin('home', 'lodging', X + 10, ROWS[0])]; // p1과 10 떨어져 집 배지
    const result = run(pins, { labelMode: 'all' });
    expect(result.pins.find((p) => p.id === 'p1')?.hidden).toContain('home');
    expect(idsOf(labelsOf(result))).toEqual(['p1', 'p2']);
  });

  test('T15_S18_Q1_속성_모든_이름표_모드에서_숙소_id는_labels에_없다', () => {
    fc.assert(
      fc.property(
        pinsArb,
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 390 }), y: fc.integer({ min: 0, max: 844 }) }), { minLength: 1, maxLength: 2 }),
        fc.boolean(),
        (numbered, homes, staying) => {
          const lodgings = homes.map((h, i) => pin(`home${i}`, 'lodging', h.x, h.y));
          const result = run([...numbered, ...lodgings], { labelMode: 'all', stayingAtLodging: staying });
          for (const label of labelsOf(result)) expect(label.pinId.startsWith('home')).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
