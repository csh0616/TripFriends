// TASK-015 §B6 핀 겹침 규칙 (task-014-design.md §11-3, ②-06a "핀이 겹칠 때"). 순수 함수 — 지도·화면을 모른다.
// 계약·값은 __tests__/task-015-pin-overlap.test.ts 머리 주석. 예외를 잡지 않는다 — 부르는 화면이 try/catch로 감싼다.

/** 핀 종류. 순위·가림 순서 모두 next > now > lodging > later > done */
export type PinKind = 'next' | 'now' | 'lodging' | 'later' | 'done';

/** 화면 좌표(pt). x·y = 핀 중심, size = 핀 지름(TASK-015 §12: 지난 28 · 지금 32 · 다음 36 · 나중 28 · 숙소 보통 28, 숙소에 머무는 동안은 결과에서 32) */
export type ScreenPin = {
  id: string;
  kind: PinKind;
  x: number;
  y: number;
  size: number;
  /** 코스 번호 (숙소는 null). 같은 순위끼리 묶을 때 번호가 앞선 핀이 남는다 (TASK-015 §11 Q4) */
  seq: number | null;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type PinOverlapInput = {
  pins: ScreenPin[];
  /** 지도 화면 크기 (이름표는 가장자리에서 8 안쪽) */
  screen: { width: number; height: number };
  /** 다음 핀 이름표 폭 (글자 길이에 따라 화면이 잰 값). 높이는 28로 정해져 있다 */
  labelWidth: number;
  /** 내 위치 점 또는 reh-dot (중심·지름). 없으면 null */
  me?: { x: number; y: number; size: number } | null;
  /** 떠 있는 판 (상단 줄·알림 등) */
  panels?: Rect[];
  /** 계획상 지금 있는 곳이 숙소 (출발 전·귀가 후) */
  stayingAtLodging?: boolean;
  /**
   * TASK-015 §17 이름표 모드 (기본 'next'). 'all' = 코스 크게 보기(①-41): 번호 핀이 ALL_LABELS_MAX곳 이하면 보이는 번호 핀마다 이름표,
   * 그보다 많으면 'next'와 같다(다음 핀 하나). 계약: __tests__/task-015-pin-overlap-all-labels.test.ts
   */
  labelMode?: 'next' | 'all';
  /** 핀 id -> 그 핀 이름표 폭 (화면이 잰 값). 없는 핀은 labelWidth */
  labelWidths?: Readonly<Record<string, number>>;
};

/** 놓인 이름표 하나 */
export type PlacedLabel = { pinId: string; side: LabelSide; rect: Rect };

export type LabelSide = 'top' | 'right' | 'left' | 'bottom';

export type Badge = { type: 'plus'; count: number; corner: 'top-right' | 'bottom-right' } | { type: 'home'; corner: 'top-right' };

export type ShownPin = ScreenPin & {
  /** 'pin' = 번호 핀 · 'home' = 숙소 마커 · 'now' = 머무는 동안 숙소 마커가 "지금 핀" 모양 */
  shape: 'pin' | 'home' | 'now';
  badges: Badge[];
  /** 이 핀에 묶여 지도에서 빠진 핀 id (숙소가 집 배지로 들어간 것 포함) */
  hidden: string[];
  /** 화면 읽기 글. 예 "나중 4번, 5번도 같은 곳" (TASK-015 §11 Q6) */
  a11yLabel: string;
};

export type PinOverlapResult = {
  /** 보일 핀. 그리는 순서(아래 -> 위): done, later, lodging, now, next */
  pins: ShownPin[];
  /** 다음 핀의 이름표. 후보 위 -> 오른쪽 -> 왼쪽 -> 아래, 모두 안 되면 null */
  label: PlacedLabel | null;
  /** TASK-015 §17: 놓인 이름표 전부 ('next' 모드면 label 하나 또는 빈 목록). frontend가 구현하며 늘 채운다 */
  labels?: PlacedLabel[];
  /** 내 위치 점(reh-dot 포함)을 그리나. 숙소에 머무는 동안은 false */
  meDot: boolean;
};

/** TASK-015 §17 "모든 이름표" 모드: 번호 핀이 이 수 이하면 모든 핀에 이름표 (①-41 "5곳 이하") */
export const ALL_LABELS_MAX = 5;

/** 중심 거리가 이 값 "미만"이면 묶는다 */
export const GROUP_DISTANCE = 36;

/** 가림 순서 (위 -> 아래). 위가 보이고 누르기도 위가 받는다 */
export const PIN_STACK = ['next', 'now', 'lodging', 'later', 'done', 'label', 'me', 'route'] as const;

/** 번호 핀 순위 (높음 -> 낮음). 숙소는 번호 핀 묶기에 끼지 않는다 (§11 Q5) */
const NUMBERED_RANK: readonly PinKind[] = ['next', 'now', 'later', 'done'];
const RANK_WORD: Record<string, string> = { next: '다음', now: '지금', later: '나중', done: '지난' };
const DRAW_ORDER: readonly PinKind[] = ['done', 'later', 'lodging', 'now', 'next'];
const LABEL_HEIGHT = 28;
const LABEL_GAP_TOP_BOTTOM = 4;
const LABEL_GAP_SIDE = 6;
const SCREEN_MARGIN = 8;
const PIN_MARGIN = 4; // 다른 핀 둘레 여유 (맞닿음 = 간격 <= 여유도 겹침)
const LODGING_STAYING_SIZE = 32; // 머무는 동안 숙소 마커 = "지금 핀" 지름 (§12)
const EPS = 1e-9;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const bySeq = (a: ScreenPin, b: ScreenPin): number => (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Group = { host: ScreenPin; numbered: ScreenPin[]; homes: ScreenPin[] };

function touchesCircle(rect: Rect, c: { x: number; y: number }, radius: number): boolean {
  const nx = Math.min(Math.max(c.x, rect.x), rect.x + rect.width);
  const ny = Math.min(Math.max(c.y, rect.y), rect.y + rect.height);
  return Math.hypot(c.x - nx, c.y - ny) <= radius + EPS;
}

function touchesRect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width + EPS && b.x <= a.x + a.width + EPS && a.y <= b.y + b.height + EPS && b.y <= a.y + a.height + EPS;
}

function labelRects(pin: { x: number; y: number; size: number }, w: number): [LabelSide, Rect][] {
  const r = pin.size / 2;
  return [
    ['top', { x: pin.x - w / 2, y: pin.y - r - LABEL_GAP_TOP_BOTTOM - LABEL_HEIGHT, width: w, height: LABEL_HEIGHT }],
    ['right', { x: pin.x + r + LABEL_GAP_SIDE, y: pin.y - LABEL_HEIGHT / 2, width: w, height: LABEL_HEIGHT }],
    ['left', { x: pin.x - r - LABEL_GAP_SIDE - w, y: pin.y - LABEL_HEIGHT / 2, width: w, height: LABEL_HEIGHT }],
    ['bottom', { x: pin.x - w / 2, y: pin.y + r + LABEL_GAP_TOP_BOTTOM, width: w, height: LABEL_HEIGHT }],
  ];
}

function a11yOf(group: Group, staying: boolean): string {
  const { host, numbered, homes } = group;
  if (host.kind === 'lodging') return staying ? '지금 숙소' : '숙소';
  let text = `${RANK_WORD[host.kind]} ${host.seq}번`;
  if (numbered.length > 0) {
    const seqs = numbered.map((p) => p.seq as number).sort((a, b) => a - b);
    text += `, ${seqs.map((n) => `${n}번`).join('·')}도 같은 곳`;
  }
  if (homes.length > 0) text += ', 숙소도 같은 곳';
  return text;
}

/** 계산 순서 ②~⑤ (①카메라는 호출하는 쪽이 끝낸 뒤 화면 좌표를 넘긴다). 예외를 잡지 않는다 — 화면이 감싼다 (§11 Q6) */
export function resolvePinOverlap(input: PinOverlapInput): PinOverlapResult {
  const { pins, screen, labelWidth, me = null, panels = [], stayingAtLodging = false } = input;

  // ② 번호 핀 묶기: 순위 -> 코스 번호 순으로 하나씩, 이미 남긴 핀 중 36 안의 첫 핀에 붙고 없으면 새로 남는다 (§11 Q4 욕심 방식)
  const numbered = pins
    .filter((p) => p.kind !== 'lodging')
    .sort((a, b) => NUMBERED_RANK.indexOf(a.kind) - NUMBERED_RANK.indexOf(b.kind) || bySeq(a, b));
  const groups: Group[] = [];
  for (const p of numbered) {
    const host = groups.find((g) => dist(g.host, p) < GROUP_DISTANCE);
    if (host) host.numbered.push(p);
    else groups.push({ host: p, numbered: [], homes: [] });
  }

  // ③ 숙소: 남긴 번호 핀 중 36 안의 첫 핀에 집 배지로 붙고, 없으면 숙소 마커로 남는다 (번호 핀이 이긴다, §11 Q5)
  const lodgings = pins.filter((p) => p.kind === 'lodging').sort(bySeq);
  for (const home of lodgings) {
    const host = groups.find((g) => dist(g.host, home) < GROUP_DISTANCE);
    if (host) host.homes.push(home);
    else groups.push({ host: home, numbered: [], homes: [] });
  }

  // 보일 핀 (그리는 순서: 아래 -> 위)
  const shown: ShownPin[] = groups
    .map((group): ShownPin => {
      const { host } = group;
      const standing = host.kind === 'lodging' && stayingAtLodging;
      const badges: Badge[] = [];
      if (group.homes.length > 0) badges.push({ type: 'home', corner: 'top-right' });
      if (group.numbered.length > 0) badges.push({ type: 'plus', count: group.numbered.length, corner: group.homes.length > 0 ? 'bottom-right' : 'top-right' });
      return {
        ...host,
        size: standing ? LODGING_STAYING_SIZE : host.size,
        shape: host.kind !== 'lodging' ? 'pin' : standing ? 'now' : 'home',
        badges,
        hidden: [...group.numbered, ...group.homes].map((p) => p.id),
        a11yLabel: a11yOf(group, stayingAtLodging),
      };
    })
    .sort((a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind) || bySeq(a, b));

  // ④ 내 위치 점: 숙소에 머무는 동안은 그리지 않는다 (숙소 마커가 "지금 핀")
  const meDot = me !== null && !stayingAtLodging;

  // ⑤ 이름표: 'next' = 다음 핀 하나, 'all'(번호 핀 5곳 이하) = 보이는 번호 핀 모두. 위 -> 오른쪽 -> 왼쪽 -> 아래, 다 안 되면 그 이름표만 뺀다 (이름표 때문에 핀을 빼지 않는다)
  const allMode = input.labelMode === 'all' && pins.filter((p) => p.kind !== 'lodging').length <= ALL_LABELS_MAX;
  const next = shown.find((p) => p.kind === 'next');
  // 다음 핀을 먼저, 나머지는 코스 번호 순
  const targets = allMode ? [...shown.filter((p) => p.shape === 'pin')].sort((a, b) => (a === next ? -1 : b === next ? 1 : bySeq(a, b))) : next ? [next] : [];
  const labels: PlacedLabel[] = [];
  for (const target of targets) {
    const free = (rect: Rect): boolean =>
      rect.x >= SCREEN_MARGIN &&
      rect.y >= SCREEN_MARGIN &&
      rect.x + rect.width <= screen.width - SCREEN_MARGIN &&
      rect.y + rect.height <= screen.height - SCREEN_MARGIN &&
      shown.every((other) => other.id === target.id || !touchesCircle(rect, other, other.size / 2 + PIN_MARGIN)) &&
      !(meDot && me && touchesCircle(rect, me, me.size / 2)) &&
      panels.every((panel) => !touchesRect(rect, panel)) &&
      labels.every((placed) => !touchesRect(rect, placed.rect));
    const width = input.labelWidths?.[target.id] ?? labelWidth;
    const found = labelRects(target, width).find(([, rect]) => free(rect));
    if (found) labels.push({ pinId: target.id, side: found[0], rect: found[1] });
  }
  const label = next ? (labels.find((l) => l.pinId === next.id) ?? null) : null;

  return { pins: shown, label, labels, meDot };
}
