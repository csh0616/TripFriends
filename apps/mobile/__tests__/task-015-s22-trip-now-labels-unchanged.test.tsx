/// <reference types="jest" />
// TASK-015 §22 막는 2 경계: "맞춤 끝 영역을 받은 뒤에만 이름표" 규칙은 크게 보기(CourseMap)에만. 여행 중 화면(MapAdapter)은 범위 밖이라 지금 그대로다.
// 로직 · 가드레일만 본다. 근거: TASK-015 §22 막는 2(크게 보기 이름표) · 진행 담당 전달(11-17: 지금(trip-now) 화면 MapAdapter는 바꾸지 않음).
//
// 계약 (이 파일이 정한 것):
//   여행 중 화면에서 지도 준비 신호 · 경로 맞춤 없이(가짜 지도 silent) 영역 보고(regionChangeComplete) 하나만 와도 바로 그 영역으로 겹침 규칙을 돌리고
//   (resolvePinOverlap이 그 영역 뒤에 불린다), 규칙이 이름표 자리를 냈으면 `map-pin-label` 1개, 못 냈으면 0개 — 기다리지 않는다
//   (지금 동작 그대로. 이 시험이 깨지면 크게 보기 규칙이 여행 중 화면까지 번진 것)
import { act, fireEvent, screen } from '@testing-library/react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { installConfig, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { pins } from '../test-support/trip-now-fixtures';
import { resolvePinOverlap, type PinOverlapResult } from '@/lib/pin-overlap';

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
const root = () => screen.root as unknown as Host;
const labels = () => root().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label');

beforeEach(() => {
  resetDevice();
  mapControl.reset();
  overlap.mockClear();
  sheetControl.reset();
  installConfig(TEST_KEY);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('T15_S22_2_경계_여행_중_화면은_준비_신호·맞춤_없이_영역_하나만_와도_바로_겹침_규칙을_돌려_이름표를_정한다(그대로)', async () => {
  mapControl.silent = true;
  await toNow();
  expect(mapControl.fits).toHaveLength(0); // 시험 자체 확인: 맞춤 전
  expect(labels()).toHaveLength(0); // 시험 자체 확인: 영역을 받기 전
  overlap.mockClear();
  const map = root().queryAll((h) => h.props.mapElement === 'MapView')[0];
  expect(map).toBeDefined();
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  await act(async () => {
    fireEvent(map as never, 'regionChangeComplete', {
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 3 + 0.01,
      longitudeDelta: (Math.max(...lngs) - Math.min(...lngs)) * 3 + 0.01,
    });
  });
  expect(overlap).toHaveBeenCalled(); // 기다리지 않고 그 영역으로 규칙을 돌렸다
  const results = overlap.mock.results.filter((r) => r.type === 'return');
  const last = results[results.length - 1].value as PinOverlapResult;
  expect(labels()).toHaveLength(last.label ? 1 : 0);
});
