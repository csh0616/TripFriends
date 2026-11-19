// TASK-015 §19 P3 도식 핀 벌리기 (task-014-design.md §15-4 · task-015-design.md §11-1, ②-06a 새 칸). 순수 함수 — 화면을 모른다.
// 계약·값은 __tests__/task-015-diagram-spread.test.ts 머리 주석.

/** 핀 · 집 중심은 도식 틀 가장자리에서 이만큼 이상 안쪽 */
export const DIAGRAM_INSET = 18;
/** 중심 거리가 이보다 작으면 벌린다 (지름 22 + 사이 6) */
export const DIAGRAM_GAP = 28;
/** 한 핀을 앞 핀 전부와 DIAGRAM_GAP 이상 떨어뜨리려고 미는 최대 횟수 */
export const DIAGRAM_MAX_TRIES = 8;

export type DiagramPoint = { x: number; y: number };
/** 도식 좌표(pt, 틀 왼쪽 위가 0,0). seq = 코스 번호(목록 번호와 같음) */
export type DiagramStop = { seq: number; x: number; y: number };

export type DiagramSpreadInput = {
  /** 도식 틀 크기 */
  frame: { width: number; height: number };
  /** 번호 핀, 코스 순서(앞 = 1번) */
  stops: readonly DiagramStop[];
  /** 숙소 집 (없으면 null) */
  home: DiagramPoint | null;
};

export type DiagramSpreadResult = {
  /** 입력과 같은 순서 · 같은 seq, 벌린 좌표 */
  stops: DiagramStop[];
  /** 벌린 집 좌표 (입력이 null이면 null) */
  home: DiagramPoint | null;
};

const TOL = 1e-9;

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** 도식 틀 안쪽 칸 (경계 포함) */
function area(frame: { width: number; height: number }) {
  return { x0: DIAGRAM_INSET, x1: frame.width - DIAGRAM_INSET, y0: DIAGRAM_INSET, y1: frame.height - DIAGRAM_INSET };
}

type Area = ReturnType<typeof area>;

const clampTo = (p: Pt, a: Area): Pt => ({
  x: Math.min(Math.max(p.x, a.x0), Math.max(a.x0, a.x1)),
  y: Math.min(Math.max(p.y, a.y0), Math.max(a.y0, a.y1)),
});

const inside = (p: Pt, a: Area) => p.x >= a.x0 - TOL && p.x <= a.x1 + TOL && p.y >= a.y0 - TOL && p.y <= a.y1 + TOL;

/** 앞 핀 둘레 28 원 위에서 칸 안으로 들어오는, target에 가장 가까운 자리 (없으면 null) */
function onCircleInside(q: Pt, target: Pt, a: Area): Pt | null {
  const r = DIAGRAM_GAP;
  const candidates: Pt[] = [];
  for (const x of [a.x0, a.x1]) {
    const dx = x - q.x;
    if (Math.abs(dx) <= r) {
      const dy = Math.sqrt(r * r - dx * dx);
      candidates.push({ x, y: q.y + dy }, { x, y: q.y - dy });
    }
  }
  for (const y of [a.y0, a.y1]) {
    const dy = y - q.y;
    if (Math.abs(dy) <= r) {
      const dx = Math.sqrt(r * r - dy * dy);
      candidates.push({ x: q.x + dx, y }, { x: q.x - dx, y });
    }
  }
  let best: Pt | null = null;
  for (const c of candidates) {
    if (!inside(c, a)) continue;
    if (best === null || dist(c, target) < dist(best, target)) best = c;
  }
  return best;
}

/**
 * 핀 · 집 중심을 틀 안쪽 18 이상으로 넣고, 중심 거리 < 28이면 번호 큰 쪽을 앞 핀에서 멀어지는 쪽으로 28까지 민다.
 * 자리 잡는 순서 = stops 순서(1번 먼저), 마지막이 집. 8번 안에 못 풀면 번호 순서대로 가로 균등 간격. 입력은 바꾸지 않는다.
 */
export function spreadDiagramPins(input: DiagramSpreadInput): DiagramSpreadResult {
  const a = area(input.frame);
  const originals: Pt[] = [...input.stops.map((s) => ({ x: s.x, y: s.y })), ...(input.home ? [{ x: input.home.x, y: input.home.y }] : [])];
  const placed: Pt[] = [];
  let failed = false;

  originals.forEach((orig, index) => {
    let p = clampTo(orig, a);
    for (let tries = 0; ; tries += 1) {
      const q = placed.find((o) => dist(o, p) < DIAGRAM_GAP - TOL);
      if (!q) break;
      if (tries >= DIAGRAM_MAX_TRIES) {
        failed = true;
        break;
      }
      let dx = p.x - q.x;
      let dy = p.y - q.y;
      let len = Math.hypot(dx, dy);
      if (len < TOL) {
        // 같은 자리: 길 가는 쪽(다음 핀 쪽), 없거나 그것도 같은 자리면 오른쪽
        const next = originals[index + 1];
        dx = next ? next.x - orig.x : 0;
        dy = next ? next.y - orig.y : 0;
        len = Math.hypot(dx, dy);
        if (len < TOL) {
          dx = 1;
          dy = 0;
          len = 1;
        }
      }
      const target = { x: q.x + (dx / len) * DIAGRAM_GAP, y: q.y + (dy / len) * DIAGRAM_GAP };
      p = inside(target, a) ? target : (onCircleInside(q, target, a) ?? clampTo(target, a));
    }
    placed.push(p);
  });

  let out = placed;
  if (failed) {
    const n = originals.length;
    const step = n > 1 ? (a.x1 - a.x0) / (n - 1) : 0;
    out = originals.map((o, i) => ({ x: a.x0 + step * i, y: clampTo(o, a).y }));
  }

  return {
    stops: input.stops.map((s, i) => ({ seq: s.seq, x: out[i].x, y: out[i].y })),
    home: input.home ? out[input.stops.length] : null,
  };
}
