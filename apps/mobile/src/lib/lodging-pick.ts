// TASK-015 §13 Q2·Q3 a2 "지도에서 찍기"의 거리 검사 · [여기로 정했어] 켜짐 판단 (순수 함수 — 지도·화면·서버를 모른다).

/** 위도·경도 (도시 중심 center와 같은 모양) */
export type LatLng = { lat: number; lng: number };

/** 지구 반지름 (km). 서버 거리 공식(trip/detect.py · trip/visit.py의 earth_km)과 같은 값 */
export const EARTH_RADIUS_KM = 6371.0;

/** 찍은 숙소는 도시 중심에서 이 거리 "미만"이어야 한다 (m). 정확히 50km는 밖 = 서버 400 too_far와 같게 (§9 Q5 · §13 Q2) */
export const LODGING_MAX_DISTANCE_M = 50_000;

/** 두 점 사이 거리 (m). 서버와 같은 공식 (하버사인, 반지름 EARTH_RADIUS_KM) */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * 1000 * Math.asin(Math.sqrt(h));
}

/** 찍은 핀이 도시 중심에서 50km 이상이면 true (경계 50km는 밖) */
export function isTooFar(pin: LatLng, center: LatLng): boolean {
  // 서버 detect._within처럼 소수 6자리로 반올림한 뒤 비교 (정확히 50km는 부동소수점 오차가 나므로)
  return Number(distanceMeters(pin, center).toFixed(6)) >= LODGING_MAX_DISTANCE_M;
}

/** [여기로 정했어] 켜짐: 핀이 있고 && 도시 중심 50km 안 */
export function canConfirmPin(pin: LatLng | null, center: LatLng): boolean {
  return pin !== null && !isTooFar(pin, center);
}
