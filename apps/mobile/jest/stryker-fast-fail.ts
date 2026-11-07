/// <reference types="jest" />
// 돌연변이 측정 전용 (stryker.config.json에서만 쓴다, 평소 테스트에는 적용하지 않는다).
// 원인(G3): 화면 전체가 지나가는 함수(screen-for·format-stay 등)의 돌연변이는 테스트 약 250개가 한꺼번에 걸려 있다.
// 돌연변이가 화면을 깨면 그 테스트들이 하나씩 findBy 기본 1초를 다 기다리며 실패해서 한 돌연변이에 100초 넘게 걸리고, timeoutMS(30초)를 넘겨 Timeout이 된다.
// 같은 파일에서 한 테스트가 실패하면 남은 테스트는 바로 실패시켜 시간을 줄인다. 이미 잡힌(실패한) 돌연변이의 결과는 같고,
// 실패가 없는 정상 실행과 살아남는 돌연변이에는 영향이 없다.
let failedBefore = false;

// jest 30은 현재 테스트 상태를 Symbol.for가 아닌, 이름만 같은 기호(JEST_STATE_SYMBOL)로 둔다
const circus = () => {
  const symbol = Object.getOwnPropertySymbols(globalThis).find((key) => key.description === 'JEST_STATE_SYMBOL');
  return symbol ? ((globalThis as Record<symbol, unknown>)[symbol] as { currentlyRunningTest?: { errors: unknown[] } }) : undefined;
};

beforeEach(() => {
  if (failedBefore) throw new Error('같은 파일의 앞 테스트가 이미 실패해 건너뜀 (돌연변이 측정 전용)');
});

afterEach(() => {
  if ((circus()?.currentlyRunningTest?.errors.length ?? 0) > 0) failedBefore = true;
});
