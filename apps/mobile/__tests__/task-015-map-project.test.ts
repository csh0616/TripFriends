/// <reference types="jest" />
// TASK-015 frontend가 더한 순수 함수 테스트 (§10 Q2 "축척 순수 함수 + 테스트", B6 화면 좌표 계산). src/lib/map-project.ts
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
