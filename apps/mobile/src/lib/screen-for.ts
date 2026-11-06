// TASK-004 §B-5. 껍데기: 구현은 frontend가 한다.
export type ScreenName = 'P1' | 'P2' | 'P3' | 'S9';

export function screenFor(_response: { stage?: unknown }): ScreenName {
  throw new Error('not implemented');
}
