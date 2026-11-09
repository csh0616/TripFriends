// TASK-011 §14 N13 + (a) 후보 카드 자리 규칙 (task-011-review.md §9-4 (a), DESIGN-001 §4-11 재검수로 정한 것).
import tokens from 'design-tokens';

// 토큰에 없는 두 값은 리뷰 §9-4 (a)가 정한 그대로다: 이름·이유 띠 46, 처음 화면 위 안전 영역 아래 쓰이는 높이 776.
const NAME_WHY_BAND = 46;
const FIRST_SCREEN_USED = 776;
/** 출처 줄 아랫변과 [코스 짜기] 막대 윗변 사이에 둘 최소 간격 */
const BAR_CLEARANCE = 12;

/** 후보 카드 높이를 이루는 값: 그림 · 그림 아래 · 이름·이유 띠 · 사실 줄 위 · 사실 줄 · 출처 줄 위 · 출처 줄 */
export type CandidateCardParts = {
  photo: number;
  photoGap: number;
  nameWhy: number;
  factGap: number;
  factLine: number;
  sourceGap: number;
  source: number;
};

export function candidateCardParts(): CandidateCardParts {
  const factLine = tokens.fit['fact-line'];
  return {
    photo: tokens.trip['cover-lg'][1],
    photoGap: tokens.space['space-3'],
    nameWhy: NAME_WHY_BAND,
    factGap: tokens.space['space-3'],
    factLine: factLine.height,
    sourceGap: factLine.sourceGap,
    source: factLine.sourceHeight,
  };
}

/** 카드 높이 = 위 값들의 합 */
export function candidateCardHeight(): number {
  return Object.values(candidateCardParts()).reduce((sum, one) => sum + one, 0);
}

/** 처음 화면에서 출처 줄 아랫변과 [코스 짜기] 막대 윗변 사이 남는 자리 (홈 바 있는 기기) */
export function candidateRoom(screenHeight: number, topInset: number): number {
  return screenHeight - topInset - FIRST_SCREEN_USED;
}

/** 규칙: 출처 줄 아랫변 ≤ 막대 윗변 − 12 */
export function sourceClearsBar(room: number): boolean {
  return room >= BAR_CLEARANCE;
}
