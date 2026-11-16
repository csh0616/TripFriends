/// <reference types="jest" />
// TASK-015 §19 P3 도식 핀 벌리기 — 순수 함수 (앱). 좌표만 본다(색 · 굵기는 보지 않는다).
// 근거: TASK-015 §19("도식 핀 벌리기: 핀 중심은 도식 틀에서 18 이상 안쪽, 핀 중심 거리 < 28이면 묶지 않고 벌림 — 실제 위치에서 최대 약 28pt 벗어남.
//       벌리기는 순수 함수 + test-writer 테스트 먼저(값은 ②-06a 새 칸)") ·
//       task-014-design.md §15-4 표("도식 안 여백 = 중심은 프레임 가장자리에서 18 이상 안쪽 → 칸 314×84(x 18~332 · y 18~102)" ·
//       "핀 겹침 = 벌린다: 중심 거리 < 28이면 번호가 큰 쪽을 앞 핀에서 멀어지는 쪽으로 28까지 민다 · 1번은 안 움직임 · 같은 자리면 길 가는 쪽(없으면 오른쪽) ·
//        밀린 자리가 칸 밖이면 앞 핀 둘레 28 원 위에서 칸 안으로 들어오는 가장 가까운 자리 · 앞 핀 전부와 28 이상이 될 때까지 최대 8번 ·
//        그래도 안 되면 번호 순서대로 가로 균등 간격(핀 5 + 집 1 = 168 ≤ 314) · 번호는 늘 다 보인다") ·
//       §15-4 "frontend 확인 값" ①~⑤ + 보드 예(1 (36,84) · 2 (120,52) · 3 (130,60) · 4 (214,70) · 5 (226,66) · 집 (322,34) → 3 (142,70) · 5 (241,61)) ·
//       task-015-design.md §11-1 표(같은 값)
//
// 계약 (이 테스트가 정한 것, 질문 목록 참고):
//   모듈 '@/lib/diagram-spread'
//   상수 DIAGRAM_INSET = 18 · DIAGRAM_GAP = 28 · DIAGRAM_MAX_TRIES = 8
//   spreadDiagramPins({ frame: { width, height }, stops: [{ seq, x, y }](코스 순서, 앞 = 1번), home: { x, y } | null })
//     -> { stops: 같은 순서 · 같은 seq의 벌린 좌표, home: 벌린 집 좌표 | null }
//   좌표는 도식 틀 좌표(pt, 왼쪽 위 0,0). 입력을 바꾸지 않는다
//   "칸 안" = DIAGRAM_INSET <= x <= width − DIAGRAM_INSET, DIAGRAM_INSET <= y <= height − DIAGRAM_INSET (경계 포함)
//   집도 벌리기에 들어간다(모든 쌍에 집 포함, "핀 5 + 집 1"). 1번은 집보다 먼저 자리를 잡는다(1번은 안 움직임)
//   "1번"·"번호 큰 쪽" = stops 배열 순서 (좌표 없는 줄이 빠져 seq가 건너뛰어도)
import fc from 'fast-check';

import { DIAGRAM_GAP, DIAGRAM_INSET, DIAGRAM_MAX_TRIES, spreadDiagramPins, type DiagramSpreadInput } from '@/lib/diagram-spread';

const FRAME = { width: 350, height: 120 }; // ①-16 도식 350×120
const EPS = 1e-6;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const all = (r: ReturnType<typeof spreadDiagramPins>) => [...r.stops, ...(r.home ? [r.home] : [])];
const insideArea = (p: { x: number; y: number }, frame: { width: number; height: number }) =>
  p.x >= DIAGRAM_INSET - EPS && p.x <= frame.width - DIAGRAM_INSET + EPS && p.y >= DIAGRAM_INSET - EPS && p.y <= frame.height - DIAGRAM_INSET + EPS;
const minPairGap = (points: { x: number; y: number }[]) => {
  let min = Infinity;
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) min = Math.min(min, dist(points[i], points[j]));
  return min;
};
const stopsOf = (...xy: [number, number][]) => xy.map(([x, y], i) => ({ seq: i + 1, x, y }));
const run = (stops: [number, number][], home: [number, number] | null = null, frame = FRAME) =>
  spreadDiagramPins({ frame, stops: stopsOf(...stops), home: home ? { x: home[0], y: home[1] } : null });

describe('§19 값', () => {
  test('T15_S19_상수는_안쪽_18_거리_28_최대_8번', () => {
    expect(DIAGRAM_INSET).toBe(18);
    expect(DIAGRAM_GAP).toBe(28);
    expect(DIAGRAM_MAX_TRIES).toBe(8);
  });
});

describe('§15-4 보드 예', () => {
  test('T15_S19_보드_예_3번은_142_70_5번은_241_61로_밀리고_나머지는_제자리', () => {
    const r = run([[36, 84], [120, 52], [130, 60], [214, 70], [226, 66]], [322, 34]);
    const at = (seq: number) => r.stops.find((s) => s.seq === seq)!;
    expect(at(1)).toEqual({ seq: 1, x: 36, y: 84 });
    expect(at(2)).toEqual({ seq: 2, x: 120, y: 52 });
    expect(at(4)).toEqual({ seq: 4, x: 214, y: 70 });
    expect(r.home).toEqual({ x: 322, y: 34 });
    // 보드 값은 정수로 반올림돼 있어 1 안쪽이면 같다고 본다
    expect(Math.abs(at(3).x - 142)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(3).y - 70)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(5).x - 241)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(5).y - 61)).toBeLessThanOrEqual(1);
    // 밀린 핀은 앞 핀과 정확히 28 (28까지 민다)
    expect(dist(at(3), at(2))).toBeCloseTo(28, 6);
    expect(dist(at(5), at(4))).toBeCloseTo(28, 6);
  });
});

describe('§15-4 거리 경계 (< 28이면 벌림, 28이면 그대로)', () => {
  test('T15_S19_중심_거리_28이면_그대로', () => {
    const r = run([[100, 60], [128, 60]]);
    expect(r.stops).toEqual(stopsOf([100, 60], [128, 60]));
  });

  test('T15_S19_중심_거리_27점99면_번호_큰_쪽이_앞_핀에서_멀어지는_쪽으로_28까지', () => {
    const r = run([[100, 60], [127.99, 60]]);
    expect(r.stops[0]).toEqual({ seq: 1, x: 100, y: 60 });
    expect(r.stops[1].x).toBeCloseTo(128, 6);
    expect(r.stops[1].y).toBeCloseTo(60, 6);
  });

  test('T15_S19_대각선으로_가까우면_같은_방향으로_28까지', () => {
    // (100,60) -> (106,68): 거리 10, 방향 (0.6, 0.8) -> (116.8, 82.4)
    const r = run([[100, 60], [106, 68]]);
    expect(r.stops[1].x).toBeCloseTo(116.8, 6);
    expect(r.stops[1].y).toBeCloseTo(82.4, 6);
  });

  test('T15_S19_번호_작은_쪽은_안_움직이고_큰_쪽만_민다', () => {
    const r = run([[200, 60], [190, 60]]); // 2번이 1번 왼쪽 -> 왼쪽으로
    expect(r.stops[0]).toEqual({ seq: 1, x: 200, y: 60 });
    expect(r.stops[1].x).toBeCloseTo(172, 6);
    expect(r.stops[1].y).toBeCloseTo(60, 6);
  });

  test('T15_S19_집도_핀과_28_미만이면_벌린다_1번은_제자리', () => {
    const r = run([[100, 60]], [110, 60]);
    expect(r.stops[0]).toEqual({ seq: 1, x: 100, y: 60 });
    expect(dist(r.home!, r.stops[0])).toBeGreaterThanOrEqual(28 - EPS);
  });

  test('T15_S19_집과_28이면_그대로', () => {
    const r = run([[100, 60]], [100, 88]);
    expect(r.home).toEqual({ x: 100, y: 88 });
  });
});

describe('§15-4 같은 자리', () => {
  test('T15_S19_같은_자리_다음_핀이_없으면_오른쪽으로_28', () => {
    const r = run([[100, 60], [100, 60]]);
    expect(r.stops[0]).toEqual({ seq: 1, x: 100, y: 60 });
    expect(r.stops[1].x).toBeCloseTo(128, 6);
    expect(r.stops[1].y).toBeCloseTo(60, 6);
  });

  test('T15_S19_같은_자리면_길_가는_쪽_다음_핀_쪽으로_28', () => {
    const r = run([[100, 60], [100, 60], [30, 60]]); // 다음(3번)이 왼쪽
    expect(r.stops[1].x).toBeCloseTo(72, 6);
    expect(r.stops[1].y).toBeCloseTo(60, 6);
  });

  test('T15_S19_5곳과_집이_한_점에_모여도_번호_1_5와_집이_다_보인다', () => {
    const r = run([[175, 60], [175, 60], [175, 60], [175, 60], [175, 60]], [175, 60]);
    expect(r.stops.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(r.home).not.toBeNull();
    expect(minPairGap(all(r))).toBeGreaterThanOrEqual(28 - EPS);
    for (const p of all(r)) expect(insideArea(p, FRAME)).toBe(true);
  });
});

describe('§15-4 틀 안쪽 18 경계', () => {
  test.each([
    ['왼쪽 x=18', [18, 60]],
    ['오른쪽 x=332', [332, 60]],
    ['위 y=18', [175, 18]],
    ['아래 y=102', [175, 102]],
  ] as const)('T15_S19_혼자인_핀이_%s이면_그대로', (_, xy) => {
    expect(run([[xy[0], xy[1]]]).stops[0]).toEqual({ seq: 1, x: xy[0], y: xy[1] });
  });

  test.each([
    ['왼쪽 x=17.99', [17.99, 60]],
    ['오른쪽 x=332.01', [332.01, 60]],
    ['위 y=17.99', [175, 17.99]],
    ['아래 y=102.01', [175, 102.01]],
  ] as const)('T15_S19_혼자인_핀이_%s이면_칸_안으로', (_, xy) => {
    expect(insideArea(run([[xy[0], xy[1]]]).stops[0], FRAME)).toBe(true);
  });

  test('T15_S19_1번이_아닌_핀도_칸_밖이면_칸_안으로', () => {
    const r = run([[100, 60], [300, 17.99]]);
    expect(r.stops[0]).toEqual({ seq: 1, x: 100, y: 60 });
    expect(insideArea(r.stops[1], FRAME)).toBe(true);
  });

  test('T15_S19_집이_칸_밖이면_칸_안으로', () => {
    const r = run([[100, 60]], [340, 110]);
    expect(insideArea(r.home!, FRAME)).toBe(true);
  });

  test('T15_S19_밀린_자리가_칸_밖이면_앞_핀_둘레_28_원_위_칸_안_가장_가까운_자리', () => {
    // 1번 (320,60), 2번 같은 자리 · 다음 없음 -> 오른쪽 (348,60)은 칸 밖(> 332).
    // 1번 둘레 28 원 위에서 칸 안(x <= 332)이고 (348,60)에 가장 가까운 자리 = x 332 · y 60 ± √(28² − 12²)
    const r = run([[320, 60], [320, 60]]);
    const p = r.stops[1];
    expect(insideArea(p, FRAME)).toBe(true);
    expect(dist(p, r.stops[0])).toBeCloseTo(28, 3);
    expect(p.x).toBeCloseTo(332, 3);
    expect(Math.abs(p.y - 60)).toBeCloseTo(Math.sqrt(28 * 28 - 12 * 12), 3);
  });
});

describe('§15-4 속성', () => {
  const frameArb = fc.record({ width: fc.integer({ min: 300, max: 420 }), height: fc.integer({ min: 100, max: 160 }) });

  /** 아무 자리 (틀 안 아무 곳, 칸 밖 포함) */
  const scattered = frameArb.chain((frame) => {
    const pt = fc.record({ x: fc.double({ min: 0, max: frame.width, noNaN: true }), y: fc.double({ min: 0, max: frame.height, noNaN: true }) });
    return fc.record({
      frame: fc.constant(frame),
      stops: fc.array(pt, { minLength: 1, maxLength: 5 }).map((ps) => ps.map((p, i) => ({ seq: i + 1, ...p }))),
      home: fc.option(pt, { nil: null }),
    });
  });

  /** 한곳에 몰린 자리 (겹침이 많이 생김, 같은 자리 포함) */
  const clustered = frameArb.chain((frame) =>
    fc
      .record({ cx: fc.integer({ min: 0, max: frame.width }), cy: fc.integer({ min: 0, max: frame.height }) })
      .chain(({ cx, cy }) => {
        const pt = fc.record({ x: fc.integer({ min: cx - 10, max: cx + 10 }), y: fc.integer({ min: cy - 10, max: cy + 10 }) });
        return fc.record({
          frame: fc.constant(frame),
          stops: fc.array(pt, { minLength: 1, maxLength: 5 }).map((ps) => ps.map((p, i) => ({ seq: i + 1, ...p }))),
          home: fc.option(pt, { nil: null }),
        });
      }),
  );

  const inputs: [string, fc.Arbitrary<DiagramSpreadInput>][] = [
    ['흩어진 자리', scattered],
    ['몰린 자리', clustered],
  ];

  test.each(inputs)('T15_S19_속성_%s_벌린_뒤_모든_쌍_중심_거리_28_이상', (_, arb) => {
    fc.assert(fc.property(arb, (input) => minPairGap(all(spreadDiagramPins(input))) >= DIAGRAM_GAP - EPS));
  });

  test.each(inputs)('T15_S19_속성_%s_모든_중심이_칸_안', (_, arb) => {
    fc.assert(fc.property(arb, (input) => all(spreadDiagramPins(input)).every((p) => insideArea(p, input.frame))));
  });

  test.each(inputs)('T15_S19_속성_%s_같은_입력_같은_출력_입력은_그대로', (_, arb) => {
    fc.assert(
      fc.property(arb, (input) => {
        const before = JSON.parse(JSON.stringify(input));
        const a = spreadDiagramPins(input);
        const b = spreadDiagramPins(JSON.parse(JSON.stringify(input)));
        expect(a).toEqual(b);
        expect(input).toEqual(before);
      }),
    );
  });

  test.each(inputs)('T15_S19_속성_%s_seq와_순서와_집_있음이_그대로', (_, arb) => {
    fc.assert(
      fc.property(arb, (input) => {
        const r = spreadDiagramPins(input);
        expect(r.stops.map((s) => s.seq)).toEqual(input.stops.map((s) => s.seq));
        expect(r.home === null).toBe(input.home === null);
      }),
    );
  });

  test('T15_S19_속성_이미_칸_안이고_모두_28_이상이면_아무것도_안_움직임', () => {
    // 칸 안 격자(가로 · 세로 칸 28 이상)에서 서로 다른 칸을 골라 처음부터 겹침이 없게 만든다
    const spaced = frameArb.chain((frame) => {
      const cols = Math.floor((frame.width - 2 * DIAGRAM_INSET) / DIAGRAM_GAP) + 1;
      const rows = Math.floor((frame.height - 2 * DIAGRAM_INSET) / DIAGRAM_GAP) + 1;
      return fc
        .record({
          cells: fc.uniqueArray(fc.integer({ min: 0, max: cols * rows - 1 }), { minLength: 1, maxLength: 6 }),
          withHome: fc.boolean(),
        })
        .map(({ cells, withHome }) => {
          const pts = cells.map((c) => ({ x: DIAGRAM_INSET + (c % cols) * DIAGRAM_GAP, y: DIAGRAM_INSET + Math.floor(c / cols) * DIAGRAM_GAP }));
          const home = withHome && pts.length > 1 ? pts.pop()! : null;
          return { frame, stops: pts.map((p, i) => ({ seq: i + 1, ...p })), home } as DiagramSpreadInput;
        });
    });
    fc.assert(
      fc.property(spaced, (input) => {
        const r = spreadDiagramPins(input);
        expect(r.stops).toEqual(input.stops);
        expect(r.home).toEqual(input.home);
      }),
    );
  });

  test('T15_S19_속성_핀_둘이면_1번은_칸_안일_때_제자리', () => {
    const two = frameArb.chain((frame) => {
      const pt = fc.record({ x: fc.double({ min: 0, max: frame.width, noNaN: true }), y: fc.double({ min: 0, max: frame.height, noNaN: true }) });
      return fc.record({
        frame: fc.constant(frame),
        first: fc.record({
          x: fc.double({ min: DIAGRAM_INSET, max: frame.width - DIAGRAM_INSET, noNaN: true }),
          y: fc.double({ min: DIAGRAM_INSET, max: frame.height - DIAGRAM_INSET, noNaN: true }),
        }),
        other: pt,
        otherIsHome: fc.boolean(),
      });
    });
    fc.assert(
      fc.property(two, ({ frame, first, other, otherIsHome }) => {
        const input: DiagramSpreadInput = otherIsHome
          ? { frame, stops: [{ seq: 1, ...first }], home: other }
          : { frame, stops: [{ seq: 1, ...first }, { seq: 2, ...other }], home: null };
        expect(spreadDiagramPins(input).stops[0]).toEqual({ seq: 1, ...first });
      }),
    );
  });

  test('T15_S19_속성_한_번_밀기는_28까지_정확히_이동은_28_이하', () => {
    // 1번이 칸 가장자리에서 28 넘게 안쪽이면 민 자리가 늘 칸 안 -> "실제 위치에서 최대 약 28pt"
    const arb = frameArb.chain((frame) =>
      fc.record({
        frame: fc.constant(frame),
        x1: fc.double({ min: DIAGRAM_INSET + DIAGRAM_GAP, max: frame.width - DIAGRAM_INSET - DIAGRAM_GAP, noNaN: true }),
        y1: fc.double({ min: DIAGRAM_INSET + DIAGRAM_GAP, max: frame.height - DIAGRAM_INSET - DIAGRAM_GAP, noNaN: true }),
        angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        d: fc.double({ min: 0.5, max: 27.99, noNaN: true }),
      }),
    );
    fc.assert(
      fc.property(arb, ({ frame, x1, y1, angle, d }) => {
        const x2 = x1 + d * Math.cos(angle);
        const y2 = y1 + d * Math.sin(angle);
        const r = spreadDiagramPins({ frame, stops: [{ seq: 1, x: x1, y: y1 }, { seq: 2, x: x2, y: y2 }], home: null });
        const moved = r.stops[1];
        expect(dist(moved, r.stops[0])).toBeCloseTo(DIAGRAM_GAP, 6);
        expect(moved.x).toBeCloseTo(x1 + DIAGRAM_GAP * Math.cos(angle), 6);
        expect(moved.y).toBeCloseTo(y1 + DIAGRAM_GAP * Math.sin(angle), 6);
        expect(dist(moved, { x: x2, y: y2 })).toBeLessThanOrEqual(DIAGRAM_GAP + EPS);
      }),
    );
  });
});
