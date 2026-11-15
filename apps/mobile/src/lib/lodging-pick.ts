// TASK-015 §13 Q2·Q3 a2 "지도에서 찍기"의 거리 검사 · [여기로 정했어] 켜짐 판단 (순수 함수 — 지도·화면·서버를 모른다).
// 껍데기만 있다 (테스트 세션, §11 "test-writer는 로직 없는 타입·함수 모양만"). 구현은 frontend가 __tests__/task-015-lodging-pick-lib.test.ts를 통과시키며 채운다.

/** 위도·경도 (도시 중심 center와 같은 모양) */
export type LatLng = { lat: number; lng: number };

/** 지구 반지름 (km). 서버 거리 공식(trip/detect.py · trip/visit.py의 earth_km)과 같은 값 */
export const EARTH_RADIUS_KM = 6371.0;

/** 찍은 숙소는 도시 중심에서 이 거리 "미만"이어야 한다 (m). 정확히 50km는 밖 = 서버 400 too_far와 같게 (§9 Q5 · §13 Q2) */
export const LODGING_MAX_DISTANCE_M = 50_000;

/** 두 점 사이 거리 (m). 서버와 같은 공식 (하버사인, 반지름 EARTH_RADIUS_KM) */
export function distanceMeters(_a: LatLng, _b: LatLng): number {
  throw new Error('not implemented');
}

/** 찍은 핀이 도시 중심에서 50km 이상이면 true (경계 50km는 밖) */
export function isTooFar(_pin: LatLng, _center: LatLng): boolean {
  throw new Error('not implemented');
}

/** [여기로 정했어] 켜짐: 핀이 있고 && 도시 중심 50km 안 */
export function canConfirmPin(_pin: LatLng | null, _center: LatLng): boolean {
  throw new Error('not implemented');
}
