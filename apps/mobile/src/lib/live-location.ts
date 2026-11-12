// TASK-014 A3·A4: 실제 위치를 check에 실을지 정하는 순수 규칙 (빈 껍데기 — 구현은 frontend의 code-session).
// 테스트: apps/mobile/__tests__/task-014-location-lib.test.ts. 가설 값(50m·1분·100m)은 TASK-014 A3·A4 그대로.

export type Spot = { lat: number; lng: number };

/** 기기가 준 위치 한 번. accuracy = 수평 정확도 반경(m), timestamp = 잰 시각(ms) */
export type Reading = Spot & { accuracy: number | null | undefined; timestamp: number };

/** 마지막으로 check 본문에 실어 보낸 위치와 그 시각(ms) */
export type SentSpot = Spot & { timestamp: number };

/** 두 점 사이 거리(m). 하버사인 (§10 Q6) */
export function distanceM(_a: Spot, _b: Spot): number {
  throw new Error('not implemented');
}

/** §10 Q7: 잰 시각(timestamp)이 nowMs보다 120초 넘게 오래됐으면 쓰지 않는다 (가설) */
export function isFresh(_reading: Reading, _nowMs: number): boolean {
  throw new Error('not implemented');
}

/** A4: 정확도가 100m보다 나쁘거나 값이 없으면(§10 Q7) 쓰지 않는다 */
export function isAccurate(_reading: Reading): boolean {
  throw new Error('not implemented');
}

/** A3: 처음이거나, 마지막으로 보낸 곳에서 50m 넘게 움직였거나, 1분이 지났으면 보낸다. 부정확한 위치(A4)는 보내지 않는다 */
export function shouldSend(_last: SentSpot | null, _next: Reading): boolean {
  throw new Error('not implemented');
}
