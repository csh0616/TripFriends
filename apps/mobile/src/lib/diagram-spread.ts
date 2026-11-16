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

export function spreadDiagramPins(input: DiagramSpreadInput): DiagramSpreadResult {
  void input;
  throw new Error('not implemented');
}
