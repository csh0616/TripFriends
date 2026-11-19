/// <reference types="jest" />
// TASK-015 지도 화면 좌표 · 축척 순수 함수 (src/lib/map-project.ts). 처음엔 frontend가 썼고 §17(11-16)에 test-writer가 검토해 넘겨받았다.
// 근거: TASK-015 §10 Q2("축척을 직접 그리면 보드 값 map-scale 96×30, 100·200·500m·1km 중 막대 ≤ 120 · 화면 너비 · 위도로 m/pt 계산하는 순수 함수 + 테스트"),
//       §17("축척: 120pt 안에 드는 가장 긴 것 — 승인"), task-015-design §2 map-scale, §B6(핀 겹침 입력 = 핀 화면 좌표).
//
// 계약 (frontend가 만든 모양 그대로 승인 받음):
//   project(region, size, coord) -> {x, y}: 왼쪽 위 0,0, 동쪽 = 오른쪽, 북쪽 = 위. unproject는 그 거꾸로
//   metersPerPoint(region, width): 지도 가운데 위도 기준 가로 1pt의 m
//   scaleBar(mPerPt) -> {meters, label, width} | null: 100·200·500·1000m 가운데 width ≤ 120인 가장 긴 것. 1000m는 "1km". 값이 이상하면 null
//   (문서 밖, frontend가 정함 — 질문 목록): 100m도 120을 넘으면 100m 그대로 그린다
import { metersPerPoint, project, scaleBar, unproject, type Region } from '@/lib/map-project';

const REGION: Region = { latitude: 34.6662, longitude: 135.501, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const SIZE = { width: 390, height: 600 };

test('가운데 좌표는 화면 가운데', () => {
  const p = project(REGION, SIZE, { latitude: REGION.latitude, longitude: REGION.longitude });
  expect(p.x).toBeCloseTo(195, 6);
  expect(p.y).toBeCloseTo(300, 0);
});

test('project와 unproject는 서로 거꾸로', () => {
  const at = { latitude: 34.67, longitude: 135.51 };
  const back = unproject(REGION, SIZE, project(REGION, SIZE, at));
  expect(back.latitude).toBeCloseTo(at.latitude, 9);
  expect(back.longitude).toBeCloseTo(at.longitude, 9);
});

test('동쪽·북쪽이 오른쪽·위', () => {
  const east = project(REGION, SIZE, { latitude: REGION.latitude, longitude: REGION.longitude + 0.01 });
  const north = project(REGION, SIZE, { latitude: REGION.latitude + 0.01, longitude: REGION.longitude });
  expect(east.x).toBeGreaterThan(195);
  expect(north.y).toBeLessThan(300);
});

test.each<[number, number, string]>([
  [1, 100, '100m'], // 1m/pt: 100m=100pt, 200m=200pt 넘침
  [1.2, 100, '100m'],
  [1.7, 200, '200m'], // 200m=117.6pt <= 120
  [5, 500, '500m'], // 500m=100pt <= 120, 1km=200pt 넘침
  [10, 1000, '1km'], // 1km=100pt
  [100, 1000, '1km'], // 1km=10pt
  [0.1, 100, '100m'], // 가장 짧은 것도 넘치면 100m
])('scaleBar %d m/pt', (mPerPt, meters) => {
  const bar = scaleBar(mPerPt)!;
  expect(bar.meters).toBe(meters);
  expect(bar.width).toBeCloseTo(meters / mPerPt, 9);
  if (bar.meters !== 100) expect(bar.width).toBeLessThanOrEqual(120);
});

// 경계: 막대 폭이 정확히 120이면 들어간다(≤ 120), 조금이라도 넘으면 한 단계 짧은 것
test.each<[string, number, number]>([
  ['1km가 정확히 120', 1000 / 120, 1000],
  ['1km가 120을 조금 넘음', 1000 / 120 - 1e-6, 500],
  ['500m가 정확히 120', 500 / 120, 500],
  ['500m가 120을 조금 넘음', 500 / 120 - 1e-6, 200],
  ['200m가 정확히 120', 200 / 120, 200],
  ['200m가 120을 조금 넘음', 200 / 120 - 1e-6, 100],
])('T15_D_scaleBar_경계_%s', (_name, mPerPt, meters) => {
  expect(scaleBar(mPerPt)!.meters).toBe(meters);
});

test('T15_D_metersPerPoint_적도에서_경도_1도_폭은_약_111km', () => {
  // 6371km 지구에서 경도 1도 = 2π·6371000/360 ≈ 111194.9m (가운데 위도 0)
  const equator: Region = { latitude: 0, longitude: 0, latitudeDelta: 1, longitudeDelta: 1 };
  expect(metersPerPoint(equator, 1)).toBeCloseTo((2 * Math.PI * 6371000) / 360, 3);
});

test('T15_D_metersPerPoint는_위도가_높으면_줄어든다(cos)', () => {
  const osaka = metersPerPoint(REGION, 390);
  const equator = metersPerPoint({ ...REGION, latitude: 0 }, 390);
  expect(osaka / equator).toBeCloseTo(Math.cos((REGION.latitude * Math.PI) / 180), 9);
});

test('scaleBar 이름은 1000m면 1km', () => {
  expect(scaleBar(10)!.label).toBe('1km');
  expect(scaleBar(5)!.label).toBe('500m');
});

test.each([0, -1, NaN, Infinity])('scaleBar %s는 null', (value) => {
  expect(scaleBar(value)).toBeNull();
});

test('metersPerPoint는 폭에 반비례', () => {
  expect(metersPerPoint(REGION, 200)).toBeCloseTo(metersPerPoint(REGION, 400) * 2, 9);
});
