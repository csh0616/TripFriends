// TASK-004 §B-5, §12 Q11: 직선거리(하버사인, 지구 반지름 6371km)를 "숙소에서 650m" / "숙소에서 1.2km"로.
// 1km 미만은 10m 단위로 반올림, 995m부터는 "1.0km". 걷는 시간은 쓰지 않는다 (데이터 없음).
export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6371000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function haversineMetres(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceLabel(from: LatLng, to: LatLng): string {
  const metres = haversineMetres(from, to);
  const rounded = Math.round(metres / 10) * 10;
  if (rounded < 1000) return `숙소에서 ${rounded}m`;
  return `숙소에서 ${(metres / 1000).toFixed(1)}km`;
}
