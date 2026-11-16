/// <reference types="jest" />
// TASK-015 §20 #4 지도 좌표 계산을 "보이는 영역" 기준으로 (src/lib/map-project.ts 순수 함수).
// 근거: TASK-015 §20 표 #4(크게 보기에서 떠 있는 판 검사가 안 먹음: 이름표가 SOS 밑 · 가운데 알약에 닿음) ·
//       §B6(겹침 함수 입력 = 핀 화면 좌표) · 승현이 받아들인 frontend 시뮬레이터 진단(11-17, iPhone 17 402×874):
//         onRegionChangeComplete의 region은 mapPadding을 뺀 보이는 영역(세로 672)인데 project가 화면 전체(874)로 계산 ->
//         가운데 y가 336이어야 하는데 437 -> 가운데로부터 거리 874/672 ≈ 1.30배 어긋남. 고치는 방향: 계산 크기를 mapPadding을 뺀 영역으로.
//
// 계약 (이 파일이 정한 것):
//   visibleArea(size, mapPadding) -> { x: left, y: top, width: size.width − left − right, height: size.height − top − bottom }
//   project(region, frame, at) / unproject(region, frame, point): frame = { width, height, x?, y? }.
//     region이 frame 안을 채운다: 북쪽 끝 -> y = frame.y, 남쪽 끝 -> y = frame.y + height, 서쪽 끝 -> x = frame.x, 동쪽 끝 -> x = frame.x + width.
//     x · y가 없으면 0 = 지금(TASK-015 §17 넘겨받은 계약)과 같은 결과
import fc from 'fast-check';

import { project, unproject, visibleArea, type Frame, type Region } from '@/lib/map-project';

const REGION: Region = { latitude: 34.6662, longitude: 135.501, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const NORTH = REGION.latitude + REGION.latitudeDelta / 2;
const SOUTH = REGION.latitude - REGION.latitudeDelta / 2;
const WEST = REGION.longitude - REGION.longitudeDelta / 2;
const EAST = REGION.longitude + REGION.longitudeDelta / 2;

describe('§20 #4 visibleArea: mapPadding을 뺀 보이는 영역', () => {
  test('T15_S20_4_visibleArea_진단_사례_402x874_아래_202면_세로_672', () => {
    expect(visibleArea({ width: 402, height: 874 }, { top: 0, bottom: 202, left: 0, right: 0 })).toEqual({ x: 0, y: 0, width: 402, height: 672 });
  });

  test('T15_S20_4_visibleArea_위·왼쪽_여백은_원점을_옮기고_네_여백_모두_크기에서_빠진다', () => {
    expect(visibleArea({ width: 402, height: 874 }, { top: 30, bottom: 202, left: 10, right: 20 })).toEqual({ x: 10, y: 30, width: 372, height: 642 });
  });

  test('T15_S20_4_visibleArea_경계_여백_0이면_화면_전체', () => {
    expect(visibleArea({ width: 390, height: 844 }, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  test('T15_S20_4_visibleArea_성질_원점+크기+반대쪽_여백_=_화면_크기', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 1400 }),
        fc.integer({ min: 200, max: 1400 }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 0, max: 90 }),
        (width, height, top, bottom, left, right) => {
          const area = visibleArea({ width, height }, { top, bottom, left, right });
          expect(area).toEqual({ x: left, y: top, width: width - left - right, height: height - top - bottom });
        },
      ),
    );
  });
});

describe('§20 #4 project · unproject: region이 보이는 영역(frame)을 채운다', () => {
  const FRAME: Required<Frame> = { x: 10, y: 30, width: 402, height: 672 };

  test('T15_S20_4_project_진단_사례_region_가운데_핀은_보이는_영역_가운데_y_336', () => {
    const p = project(REGION, { x: 0, y: 0, width: 402, height: 672 }, { latitude: REGION.latitude, longitude: REGION.longitude });
    expect(p.x).toBeCloseTo(201, 6);
    expect(p.y).toBeCloseTo(336, 0); // 화면 전체(874)로 계산하면 437
  });

  test('T15_S20_4_project_region_가운데_핀은_원점+크기의_절반(위·왼쪽_여백_더함)', () => {
    const p = project(REGION, FRAME, { latitude: REGION.latitude, longitude: REGION.longitude });
    expect(p.x).toBeCloseTo(FRAME.x + FRAME.width / 2, 6);
    expect(p.y).toBeCloseTo(FRAME.y + FRAME.height / 2, 0);
  });

  test.each<[string, number, number, 'x' | 'y', number]>([
    ['북쪽_끝은_y_=_frame.y', NORTH, REGION.longitude, 'y', 30],
    ['남쪽_끝은_y_=_frame.y+height', SOUTH, REGION.longitude, 'y', 30 + 672],
    ['서쪽_끝은_x_=_frame.x', REGION.latitude, WEST, 'x', 10],
    ['동쪽_끝은_x_=_frame.x+width', REGION.latitude, EAST, 'x', 10 + 402],
  ])('T15_S20_4_project_경계_%s', (_name, latitude, longitude, axis, expected) => {
    expect(project(REGION, FRAME, { latitude, longitude })[axis]).toBeCloseTo(expected, 6);
  });

  test.each<[string, { x: number; y: number }, 'latitude' | 'longitude', number]>([
    ['frame_왼쪽_위_점은_북서_끝', { x: 10, y: 30 }, 'latitude', NORTH],
    ['frame_왼쪽_위_점은_북서_끝(경도)', { x: 10, y: 30 }, 'longitude', WEST],
    ['frame_오른쪽_아래_점은_남동_끝', { x: 412, y: 702 }, 'latitude', SOUTH],
    ['frame_오른쪽_아래_점은_남동_끝(경도)', { x: 412, y: 702 }, 'longitude', EAST],
  ])('T15_S20_4_unproject_경계_%s', (_name, point, key, expected) => {
    expect(unproject(REGION, FRAME, point)[key]).toBeCloseTo(expected, 9);
  });

  test('T15_S20_4_project와_unproject는_frame이_있어도_서로_거꾸로(성질)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        fc.integer({ min: 300, max: 900 }),
        (fy, fx, x, y, height) => {
          const frame = { x, y, width: 402, height };
          const at = { latitude: REGION.latitude + fy * REGION.latitudeDelta, longitude: REGION.longitude + fx * REGION.longitudeDelta };
          const point = project(REGION, frame, at);
          const back = unproject(REGION, frame, point);
          expect(back.latitude).toBeCloseTo(at.latitude, 9);
          expect(back.longitude).toBeCloseTo(at.longitude, 9);
          // 원점만큼 옮겨진 것 = 원점 없이 계산한 값 + 원점
          const plain = project(REGION, { width: 402, height }, at);
          expect(point.x).toBeCloseTo(plain.x + x, 6);
          expect(point.y).toBeCloseTo(plain.y + y, 6);
        },
      ),
    );
  });

  test('T15_S20_4_경계_x·y가_0이면_x·y를_안_준_것(지금)과_같다(성질)', () => {
    fc.assert(
      fc.property(fc.double({ min: -0.5, max: 0.5, noNaN: true }), fc.double({ min: -0.5, max: 0.5, noNaN: true }), (fy, fx) => {
        const at = { latitude: REGION.latitude + fy * REGION.latitudeDelta, longitude: REGION.longitude + fx * REGION.longitudeDelta };
        expect(project(REGION, { x: 0, y: 0, width: 390, height: 600 }, at)).toEqual(project(REGION, { width: 390, height: 600 }, at));
      }),
    );
  });
});
