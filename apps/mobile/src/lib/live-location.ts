// TASK-014 A3·A4·§10 Q6·Q7: 실제 위치를 check에 실을지 정하는 순수 규칙. 테스트: __tests__/task-014-location-lib.test.ts
// 가설 값(50m·1분·100m·120초)은 TASK-014 그대로. 위치는 기기에 저장하지 않는다 (메모리에서만 쓰는 함수들).

export type Spot = { lat: number; lng: number };

/** 기기가 준 위치 한 번. accuracy = 수평 정확도 반경(m), timestamp = 잰 시각(ms) */
export type Reading = Spot & { accuracy: number | null | undefined; timestamp: number };

/** 마지막으로 check 본문에 실어 보낸 위치와 그 시각(ms) */
export type SentSpot = Spot & { timestamp: number };

export const MOVE_M = 50;
export const RESEND_MS = 60_000;
export const MAX_ACCURACY_M = 100;
export const MAX_AGE_MS = 120_000;

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 두 점 사이 거리(m). 하버사인 (§10 Q6) */
export function distanceM(a: Spot, b: Spot): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** §10 Q7: 잰 시각(timestamp)이 nowMs보다 120초 넘게 오래됐으면 쓰지 않는다 */
export function isFresh(reading: Reading, nowMs: number): boolean {
  return nowMs - reading.timestamp <= MAX_AGE_MS;
}

/** A4: 정확도가 100m보다 나쁘거나 값이 없으면(§10 Q7) 쓰지 않는다 */
export function isAccurate(reading: Reading): boolean {
  const { accuracy } = reading;
  return typeof accuracy === 'number' && accuracy <= MAX_ACCURACY_M;
}

/** A3: 처음이거나, 마지막으로 보낸 곳에서 50m 넘게 움직였거나, 1분이 지났으면 보낸다. 부정확한 위치(A4)는 보내지 않는다 */
export function shouldSend(last: SentSpot | null, next: Reading): boolean {
  if (!isAccurate(next)) return false;
  if (last === null) return true;
  return distanceM(last, next) > MOVE_M || next.timestamp - last.timestamp >= RESEND_MS;
}
