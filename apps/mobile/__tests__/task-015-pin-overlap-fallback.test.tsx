/// <reference types="jest" />
// TASK-015 §6 "핀 겹침 계산 실패 -> 규칙 없이 지금처럼 그림(화면이 멈추지 않게)" · §11 Q6("함수는 순수·예외를 잡지 않는다. 화면이 try/catch로 감싸 실패하면 규칙 없이 그림").
// 로직만 본다: 겹침 함수가 던져도 여행 중 화면이 서고, 서버 pins마다 번호 핀 하나 · 숙소 하나가 그대로 있다 (trip-now.test.tsx T6_B4와 같은 기준).
//
// 계약: 화면은 '@/lib/pin-overlap'의 resolvePinOverlap을 부를 수 있다. 던지면 잡아서 묶기·배지·이름표 규칙 없이 그린다 (부르는지 여부·시점은 보지 않는다)
import { screen } from '@testing-library/react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { day } from '../test-support/planning-fixtures';
import { installConfig, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { pins } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return {
    __esModule: true,
    ...actual,
    resolvePinOverlap: jest.fn(() => {
      throw new Error('핀 겹침 계산 실패 (테스트)');
    }),
  };
});

type Tree = { props: Record<string, any>; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const root = () => screen.container as unknown as Tree;

beforeEach(() => {
  resetDevice();
  mapControl.reset();
  sheetControl.reset();
  installConfig(TEST_KEY);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('T15_S6_S11_Q6_겹침_함수가_던져도_여행_중_화면이_서고_핀·숙소를_규칙_없이_그대로_그린다', async () => {
  await toNow();
  expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
  for (const pin of pins) {
    expect(byId(`map-pin-${pin.seq}`).props.coordinate).toEqual({ latitude: pin.lat, longitude: pin.lng });
  }
  expect(byId('map-home').props.coordinate).toEqual({ latitude: day.lodging.lat, longitude: day.lodging.lng });
  expect(root().queryAll((h) => h.props.mapElement === 'Marker' && /^map-pin-/.test(String(h.props.testID)))).toHaveLength(pins.length);
});
