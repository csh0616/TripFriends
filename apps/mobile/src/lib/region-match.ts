// TASK-015 §22 막는 2 (껍데기, test-writer): 크게 보기에서 맞춤 뒤 먼저 오는 "처음 영역" 알림을 거를 때 쓰는 영역 비교 (순수 함수). 지도 SDK를 모른다.
// 계약: __tests__/task-015-s22-region-match.test.ts
import { project, type Region, type Size } from '@/lib/map-project';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const merc = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number): number => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** 가운데 + 네 모서리 */
function keyPoints(r: Region) {
  return [
    { latitude: r.latitude, longitude: r.longitude },
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => ({ latitude: r.latitude + (a * r.latitudeDelta) / 2, longitude: r.longitude + (b * r.longitudeDelta) / 2 }))),
  ];
}

/** 승현 11-17: "같은 영역" 허용 오차 = 화면 0.5pt (정각 0.5pt는 같음) */
export const SAME_REGION_TOLERANCE_PT = 0.5;

/**
 * base를 보이는 영역(size)에 그렸을 때, other의 가운데와 네 모서리가 base의 가운데 · 네 모서리에서 각각 SAME_REGION_TOLERANCE_PT 이내(거리, 이하)인가.
 * 가운데가 같아도 넓이(확대)가 다르면 모서리가 벌어져 false
 */
export function sameRegionOnScreen(base: Region, other: Region, size: Size): boolean {
  const mine = keyPoints(base).map((p) => project(base, size, p));
  const theirs = keyPoints(other).map((p) => project(base, size, p));
  return mine.every((m, i) => Math.hypot(m.x - theirs[i].x, m.y - theirs[i].y) <= SAME_REGION_TOLERANCE_PT);
}

/**
 * 지도가 region을 보이는 영역(size)에 실제로 보여 줄 때의 영역: 가운데 그대로, region이 다 들어오는 한 배율(가로 · 세로 중 작은 축척)로,
 * 남는 축의 폭만 넓힌다. size나 폭이 0 이하면 null
 */
export function shownRegion(region: Region, size: Size): Region | null {
  if (!(size.width > 0) || !(size.height > 0) || !(region.longitudeDelta > 0) || !(region.latitudeDelta > 0)) return null;
  const top = merc(region.latitude + region.latitudeDelta / 2);
  const bottom = merc(region.latitude - region.latitudeDelta / 2);
  // 웹 메르카토르는 가로 · 세로 축척이 같다: 영역이 다 들어가는 작은 축척 하나로 보여 준다
  const perUnit = Math.min(size.width / rad(region.longitudeDelta), size.height / (top - bottom));
  if (!Number.isFinite(perUnit) || perUnit <= 0) return null;
  // 위도 폭: 가운데 위도(도) 그대로, 위 · 아래로 같은 도만큼 넓혀 메르카토르 세로 폭이 size.height / perUnit이 되는 폭 (뉴턴법, 폭에 대해 단조 증가)
  const span = size.height / perUnit;
  const lat = region.latitude;
  const spanOf = (delta: number): number => merc(lat + delta / 2) - merc(lat - delta / 2);
  let delta = unmerc(merc(lat) + span / 2) - unmerc(merc(lat) - span / 2); // 메르카토르 가운데 기준 근사에서 시작
  for (let i = 0; i < 20; i += 1) {
    const slope = 0.5 * rad(1) * (1 / Math.cos(rad(lat + delta / 2)) + 1 / Math.cos(rad(lat - delta / 2)));
    const step = (spanOf(delta) - span) / slope;
    delta -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return { latitude: lat, longitude: region.longitude, latitudeDelta: delta, longitudeDelta: ((size.width / perUnit) * 180) / Math.PI };
}
