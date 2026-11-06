// TASK-004 §B-2·§B-5: 서버 응답의 stage가 화면을 정한다. 모르는 stage는 오류.
export type ScreenName = 'P1' | 'P2' | 'P3' | 'S9';

const SCREEN_BY_STAGE: Readonly<Record<string, ScreenName>> = {
  asking: 'P1',
  browsing: 'P2',
  composing: 'P3',
  done: 'S9',
};

export function screenFor(response: { stage?: unknown }): ScreenName {
  const stage = response.stage;
  if (typeof stage === 'string' && Object.prototype.hasOwnProperty.call(SCREEN_BY_STAGE, stage)) {
    return SCREEN_BY_STAGE[stage];
  }
  throw new Error(`모르는 stage: ${String(stage)}`);
}
