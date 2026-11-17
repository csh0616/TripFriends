// TASK-015 §27 · task-015-design §14-5: 여행 중 카드 시트가 메인 카드 종류가 바뀔 때 움직이는 값 (한 곳에서 정한다 — 폰 확인 때 200~300ms 안에서 조정).
// 계약: __tests__/task-015-s27-sheet-motion.test.tsx

export type SheetMotion = {
  /** 시트 높이가 옮겨 가는 시간 (ms). "동작 줄이기"면 0 = 즉시 */
  durationMs: number;
  /** 내용 교차 페이드 시간 (ms). "동작 줄이기"면 0 */
  fadeMs: number;
};

/** 시트 높이 움직임 (TASK-015 §26 `822a093` 250ms, 폰 확인 때 200~300 안에서 조정) */
const SHEET_MOVE_MS = 250;
/** 내용 교차 페이드 (task-015-design §14-5 ② "약 120ms") */
const SHEET_FADE_MS = 120;

/** reduceMotion = 기기 설정 "동작 줄이기" (AccessibilityInfo.isReduceMotionEnabled) */
export function sheetMotion(reduceMotion: boolean): SheetMotion {
  return reduceMotion ? { durationMs: 0, fadeMs: 0 } : { durationMs: SHEET_MOVE_MS, fadeMs: SHEET_FADE_MS };
}
