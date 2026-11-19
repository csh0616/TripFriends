/// <reference types="jest" />
// TASK-015 §22 막는 2 — 경로 맞춤이 요청하는 "목표 영역" (순수 함수 fitTargetRegion).
// 크게 보기는 맞춤 뒤 영역 보고가 1초(COURSE_LABEL_FIT_WAIT_MS) 안에 한 번도 오지 않으면 이 목표 영역으로 이름표를 그린다 (없으면 initialRegion).
// 근거: 승현 11-17 보충 ①("맞춤으로 요청한 목표 영역(경로 범위 + 여백으로 계산한 것)을 우선, 없을 때만 initialRegion") ·
//       §20 #4(region은 mapPadding을 뺀 보이는 영역을 채운다) · §21 #1(맞춤 여백 edgePadding은 보이는 영역 안쪽 여백 — 두 번 빼지 않음)
//
// 계약 (이 파일이 정한 것):
//   fitTargetRegion(points, size, edgePadding): size = 보이는 영역 크기, edgePadding = 그 안쪽 여백. 안쪽 칸 = size에서 edgePadding을 뺀 사각형
//   돌려준 region을 project(region, size, 점)로 화면 점으로 바꾸면:
//     모든 점이 안쪽 칸 안(오차 1e-6pt) · 점 상자 가운데 = 안쪽 칸 가운데 · 가로나 세로 중 한쪽은 상자가 안쪽 칸 끝에 닿는다(한 배율, 남는 쪽은 가운데)
//   한 배율 = 지도 모양 그대로: size.width / 경도 폭(라디안) = size.height / 메르카토르 세로 폭 (웹 메르카토르 지도는 가로 · 세로 축척이 같다)
//   null: 점이 없음 · 모든 점이 한 자리(넓이 0) · 안쪽 칸 폭이나 높이가 0 이하 · size가 0 이하
import fc from 'fast-check';

import { fitTargetRegion, project, type Coord, type MapPadding, type Region, type Size } from '@/lib/map-project';

const EPS = 1e-6;
const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

function screenBox(region: Region, size: Size, points: Coord[]) {
  const at = points.map((p) => project(region, size, p));
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function checkFit(points: Coord[], size: Size, pad: MapPadding) {
  const region = fitTargetRegion(points, size, pad);
  expect(region).not.toBeNull();
  const r = region as Region;
  const box = screenBox(r, size, points);
  const inner = { left: pad.left, right: size.width - pad.right, top: pad.top, bottom: size.height - pad.bottom };
  // 모든 점이 안쪽 칸 안
  expect(box.left).toBeGreaterThanOrEqual(inner.left - EPS);
  expect(box.right).toBeLessThanOrEqual(inner.right + EPS);
  expect(box.top).toBeGreaterThanOrEqual(inner.top - EPS);
  expect(box.bottom).toBeLessThanOrEqual(inner.bottom + EPS);
  // 가운데
  expect(Math.abs((box.left + box.right) / 2 - (inner.left + inner.right) / 2)).toBeLessThan(EPS);
  expect(Math.abs((box.top + box.bottom) / 2 - (inner.top + inner.bottom) / 2)).toBeLessThan(EPS);
  // 한쪽은 끝에 닿는다
  const touchesX = Math.abs(box.right - box.left - (inner.right - inner.left)) < EPS;
  const touchesY = Math.abs(box.bottom - box.top - (inner.bottom - inner.top)) < EPS;
  expect(touchesX || touchesY).toBe(true);
  // 한 배율
  const perLng = size.width / rad(r.longitudeDelta);
  const perMerc = size.height / (merc(r.latitude + r.latitudeDelta / 2) - merc(r.latitude - r.latitudeDelta / 2));
  expect(Math.abs(perLng - perMerc) / perLng).toBeLessThan(1e-6);
  return r;
}

// 2곳 데모(testdata/demo/seed-two-places.json) + 숙소(데모 중심) — 크게 보기 경로 = 숙소 · 1 · 2 · 숙소
const HOME = { latitude: 35.0, longitude: 135.0 };
const TP01 = { latitude: 35.006, longitude: 135.004 };
const TP02 = { latitude: 34.996, longitude: 134.994 };
const PATH = [HOME, TP01, TP02, HOME];
const SIZE = { width: 402, height: 672 }; // iPhone 17 크게 보기 보이는 영역 (874 − mapPadding.bottom 202)
const PAD = { top: 142, bottom: 40, left: 24, right: 24 };

describe('§22 막는 2 — fitTargetRegion 예시', () => {
  test('T15_S22_2_목표_영역_2곳_데모_경로가_안쪽_칸에_한_배율로_가운데', () => {
    checkFit(PATH, SIZE, PAD);
  });

  test('T15_S22_2_목표_영역_경계_여백_0이면_점_상자가_보이는_영역_끝에_닿는다', () => {
    checkFit(PATH, SIZE, { top: 0, bottom: 0, left: 0, right: 0 });
  });

  test('T15_S22_2_목표_영역_같은_위도_두_점(세로_폭_0)은_가로로_끝에_닿고_세로는_가운데', () => {
    const points = [{ latitude: 35.0, longitude: 134.99 }, { latitude: 35.0, longitude: 135.01 }];
    const r = checkFit(points, SIZE, PAD);
    const box = screenBox(r, SIZE, points);
    expect(Math.abs(box.right - box.left - (SIZE.width - PAD.left - PAD.right))).toBeLessThan(EPS);
  });

  test('T15_S22_2_목표_영역_같은_경도_두_점(가로_폭_0)은_세로로_끝에_닿는다', () => {
    const points = [{ latitude: 34.99, longitude: 135.0 }, { latitude: 35.01, longitude: 135.0 }];
    const r = checkFit(points, SIZE, PAD);
    const box = screenBox(r, SIZE, points);
    expect(Math.abs(box.bottom - box.top - (SIZE.height - PAD.top - PAD.bottom))).toBeLessThan(EPS);
  });

  test('T15_S22_2_목표_영역_경계_안쪽_칸_폭_1이면_있다', () => {
    expect(fitTargetRegion(PATH, SIZE, { ...PAD, left: 200, right: SIZE.width - 201 })).not.toBeNull();
  });

  test.each<[string, Coord[], Size, MapPadding]>([
    ['점_없음', [], SIZE, PAD],
    ['한_점', [TP01], SIZE, PAD],
    ['모든_점이_한_자리', [TP01, TP01, TP01], SIZE, PAD],
    ['경계_안쪽_칸_폭_0', PATH, SIZE, { ...PAD, left: 200, right: SIZE.width - 200 }],
    ['안쪽_칸_폭_음수', PATH, SIZE, { ...PAD, left: 300, right: 300 }],
    ['경계_안쪽_칸_높이_0', PATH, SIZE, { ...PAD, top: 300, bottom: SIZE.height - 300 }],
    ['보이는_영역_폭_0', PATH, { width: 0, height: 672 }, { top: 0, bottom: 0, left: 0, right: 0 }],
    ['보이는_영역_높이_0', PATH, { width: 402, height: 0 }, { top: 0, bottom: 0, left: 0, right: 0 }],
  ])('T15_S22_2_목표_영역_없음_%s이면_null', (_name, points, size, pad) => {
    expect(fitTargetRegion(points, size, pad)).toBeNull();
  });
});

describe('§22 막는 2 — fitTargetRegion 속성', () => {
  test('T15_S22_2_목표_영역_속성_아무_경로든_안쪽_칸_안·가운데·한쪽_끝_닿음·한_배율', () => {
    const coord = fc.record({ latitude: fc.double({ min: 34.5, max: 35.5, noNaN: true }), longitude: fc.double({ min: 134.5, max: 135.5, noNaN: true }) });
    fc.assert(
      fc.property(
        fc.array(coord, { minLength: 2, maxLength: 8 }).filter((ps) => {
          const lats = ps.map((p) => p.latitude);
          const lngs = ps.map((p) => p.longitude);
          return Math.max(...lats) - Math.min(...lats) > 1e-4 || Math.max(...lngs) - Math.min(...lngs) > 1e-4;
        }),
        fc.integer({ min: 200, max: 500 }),
        fc.integer({ min: 300, max: 900 }),
        fc.record({ top: fc.integer({ min: 0, max: 80 }), bottom: fc.integer({ min: 0, max: 80 }), left: fc.integer({ min: 0, max: 60 }), right: fc.integer({ min: 0, max: 60 }) }),
        (points, width, height, pad) => {
          checkFit(points, { width, height }, pad);
        },
      ),
      { numRuns: 200 },
    );
  });
});
