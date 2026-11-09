// TASK-011 §14 N13 + (a) 후보 카드 자리 규칙 (task-011-review.md §9-4 (a), DESIGN-001 §4-11 재검수로 정한 것).
// 테스트가 정한 시그니처만 있는 껍데기. 구현은 코드 세션에서.

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
  throw new Error('not implemented');
}

/** 카드 높이 = 위 값들의 합 */
export function candidateCardHeight(): number {
  throw new Error('not implemented');
}

/** 처음 화면에서 출처 줄 아랫변과 [코스 짜기] 막대 윗변 사이 남는 자리 (홈 바 있는 기기) */
export function candidateRoom(screenHeight: number, topInset: number): number {
  void screenHeight;
  void topInset;
  throw new Error('not implemented');
}

/** 규칙: 출처 줄 아랫변 ≤ 막대 윗변 − 12 */
export function sourceClearsBar(room: number): boolean {
  void room;
  throw new Error('not implemented');
}
