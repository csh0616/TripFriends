// 지도 화면 계산 (순수 함수): 지도 영역 <-> 화면 좌표(pt), 축척 막대. 지도 SDK를 모른다.
// 핀 겹침 규칙(pin-overlap.ts)에 넘길 화면 좌표와, TASK-015 §D 크게 보기의 축척(Google 지도 SDK는 축척을 주지 않아 직접 그린다)에 쓴다.

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type Size = { width: number; height: number };
export type Coord = { latitude: number; longitude: number };
/** TASK-015 §20 #4: 지도가 region을 알려 주는 보이는 영역. 화면 왼쪽 위 기준 원점(x, y, 없으면 0)과 크기 */
export type Frame = Size & { x?: number; y?: number };
/** MapView mapPadding (pt) */
export type MapPadding = { top: number; bottom: number; left: number; right: number };

const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** 웹 메르카토르 세로값 (위도 -> 늘어난 y) */
const merc = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number): number => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** 좌표 -> 지도 화면 위 점 (왼쪽 위가 0,0) */
export function project(region: Region, size: Frame, at: Coord): { x: number; y: number } {
  const west = region.longitude - region.longitudeDelta / 2;
  const topMerc = merc(region.latitude + region.latitudeDelta / 2);
  const bottomMerc = merc(region.latitude - region.latitudeDelta / 2);
  return {
    x: (size.x ?? 0) + ((at.longitude - west) / region.longitudeDelta) * size.width,
    y: (size.y ?? 0) + ((topMerc - merc(at.latitude)) / (topMerc - bottomMerc)) * size.height,
  };
}

/** 화면 위 점 -> 좌표 (project의 거꾸로) */
export function unproject(region: Region, size: Frame, point: { x: number; y: number }): Coord {
  const west = region.longitude - region.longitudeDelta / 2;
  const topMerc = merc(region.latitude + region.latitudeDelta / 2);
  const bottomMerc = merc(region.latitude - region.latitudeDelta / 2);
  return {
    latitude: unmerc(topMerc - ((point.y - (size.y ?? 0)) / size.height) * (topMerc - bottomMerc)),
    longitude: west + ((point.x - (size.x ?? 0)) / size.width) * region.longitudeDelta,
  };
}

/** TASK-015 §20 #4: 지도 전체 크기에서 mapPadding을 뺀 보이는 영역 (지도가 알려 주는 region이 채우는 곳) */
export function visibleArea(size: Size, padding: MapPadding): Required<Frame> {
  return { x: padding.left, y: padding.top, width: size.width - padding.left - padding.right, height: size.height - padding.top - padding.bottom };
}

/** 화면 가로 한 점이 몇 m인가 (지도 가운데 위도 기준) */
export function metersPerPoint(region: Region, width: number): number {
  return (region.longitudeDelta * METERS_PER_DEGREE * Math.cos(rad(region.latitude))) / width;
}

/** 축척 막대 후보 (task-015-design §2 map-scale: 100 · 200 · 500m · 1km) */
export const SCALE_STEPS_M = [100, 200, 500, 1000] as const;
/** 막대 폭 상한 (pt) */
export const SCALE_MAX_WIDTH = 120;

export type ScaleBar = { meters: number; label: string; width: number };

/** 폭이 SCALE_MAX_WIDTH 이하인 가장 긴 보기 좋은 거리. 가장 짧은 것(100m)도 넘치면 100m 그대로 (더 줄이지 않는다). 값이 이상하면 null */
export function scaleBar(mPerPt: number): ScaleBar | null {
  if (!Number.isFinite(mPerPt) || mPerPt <= 0) return null;
  const fits = SCALE_STEPS_M.filter((meters) => meters / mPerPt <= SCALE_MAX_WIDTH);
  const meters = fits.length > 0 ? fits[fits.length - 1] : SCALE_STEPS_M[0];
  return { meters, label: meters >= 1000 ? `${meters / 1000}km` : `${meters}m`, width: meters / mPerPt };
}
