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

/**
 * TASK-015 §22 막는 2: 경로 맞춤(fitToCoordinates)이 요청하는 목표 영역 — 점 상자를 보이는 영역(size) 안 edgePadding 안쪽에
 * 한 배율로 넣고 가운데 맞춘 region (region은 size를 채운다). 점이 없거나 모든 점이 한 자리거나 안쪽 넓이가 0 이하면 null.
 * 계약: __tests__/task-015-s22-fit-target-region.test.ts
 */
export function fitTargetRegion(points: Coord[], size: Size, edgePadding: MapPadding): Region | null {
  const innerWidth = size.width - edgePadding.left - edgePadding.right;
  const innerHeight = size.height - edgePadding.top - edgePadding.bottom;
  if (points.length === 0 || !(size.width > 0) || !(size.height > 0) || !(innerWidth > 0) || !(innerHeight > 0)) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const spanLng = rad(Math.max(...lngs) - Math.min(...lngs)); // 라디안
  const topM = merc(Math.max(...lats));
  const bottomM = merc(Math.min(...lats));
  const spanMerc = topM - bottomM;
  // 웹 메르카토르는 가로·세로 축척이 같다: pt / 라디안(경도) = pt / 메르카토르 세로. 두 방향 중 더 빡빡한 쪽에 맞춘다
  const scales = [spanLng > 0 ? innerWidth / spanLng : Infinity, spanMerc > 0 ? innerHeight / spanMerc : Infinity];
  const perUnit = Math.min(...scales);
  if (!Number.isFinite(perUnit) || perUnit <= 0) return null;
  // 상자 가운데를 안쪽 칸 가운데에
  const centerX = edgePadding.left + innerWidth / 2;
  const centerY = edgePadding.top + innerHeight / 2;
  const midLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const west = midLng - (centerX / perUnit) * (180 / Math.PI);
  const longitudeDelta = (size.width / perUnit) * (180 / Math.PI);
  const topMerc = (topM + bottomM) / 2 + centerY / perUnit;
  const north = unmerc(topMerc);
  const south = unmerc(topMerc - size.height / perUnit);
  return { latitude: (north + south) / 2, longitude: west + longitudeDelta / 2, latitudeDelta: north - south, longitudeDelta };
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
