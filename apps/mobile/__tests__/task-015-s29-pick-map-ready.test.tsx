/// <reference types="jest" />
// TASK-015 §29 (b): a2 "지도에서 찍기" — 지도가 준비된 뒤에만 보이는 표시 `pick-map-ready`. Maestro `lodging-pin.yaml`이 길게 누르기 전에 이것을 기다린다(시간이 아니라 상태).
// 근거: TASK-015 §29 "실패 ①: 지도가 준비되기 약 0.5초 전에 길게 누름 · 결정권자 (b) 길게 누르기 전엔 지도 준비 화면 표시를 기다림(시간이 아니라 상태; testID 없으면 frontend가 붙임)"
//
// 계약 (이 파일이 정한 것):
//   testID `pick-map-ready` = a2 화면(lodging-pick-screen) 안의 요소. 지도 준비 신호(MapView onMapReady 또는 onMapLoaded) 또는 첫 영역 알림(onRegionChangeComplete) 뒤에만 있고, 그 전엔 없다
//   한 번 생기면 핀 찍기 · 이름 입력 · 키보드 열림에도 그대로 있다 (다시 없어지지 않는다)
//   누를 수 없고(누르기를 가로채지 않음) 화면 읽기에 따로 읽히지 않는다. Maestro가 "보임"으로 찾을 수 있게 크기는 0보다 커야 한다(모습은 frontend 몫)
//   지도를 못 불러와 a4가 되면 없다
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

import { mapControl } from '../test-support/maps-mock';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CENTER = { lat: 34.6662, lng: 135.501 };
const SPOT = { latitude: 34.657913, longitude: 135.506271 };
const REGION = { latitude: CENTER.lat, longitude: CENTER.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 };

type Host = { props: Record<string, any>; parent: Host | null };

async function show() {
  const confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LodgingPickScreen cityCode="osaka" center={CENTER} onConfirm={confirm} onBack={jest.fn()} />
    </SafeAreaProvider>,
  );
}

const ready = () => screen.queryByTestId('pick-map-ready');

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  mapControl.reset();
  mapControl.silent = true; // 시험이 준비 신호를 직접 준다
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
    throw new Error('a2 화면은 네트워크를 부르지 않는다');
  }) as never);
});
afterEach(() => {
  fetchSpy.mockRestore();
  mapControl.reset();
});

describe('§29 a2 지도 준비 표시 pick-map-ready', () => {
  test('T15_S29_지도_준비_신호_전에는_없다', async () => {
    await show();
    expect(screen.getByTestId('pick-map')).toBeTruthy(); // 시험 자체 확인: 지도는 그려졌다
    expect(ready()).toBeNull();
  });

  test('T15_S29_지도_준비_신호(onMapReady)_뒤에_생긴다', async () => {
    await show();
    await act(async () => {
      mapControl.ready();
    });
    expect(ready()).not.toBeNull();
  });

  test('T15_S29_준비_신호_없이_첫_영역_알림이_와도_생긴다', async () => {
    await show();
    expect(ready()).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId('pick-map'), 'regionChangeComplete', REGION);
    });
    expect(ready()).not.toBeNull();
  });

  test('T15_S29_한_번_생기면_핀_·_이름_·_키보드에도_그대로', async () => {
    await show();
    await act(async () => {
      mapControl.ready();
    });
    await act(async () => {
      fireEvent(screen.getByTestId('pick-map'), 'longPress', { nativeEvent: { coordinate: SPOT } });
    });
    expect(ready()).not.toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'focus');
    });
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { height: 336, screenY: 508, screenX: 0, width: 390 }, duration: 0 });
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('pick-label'), '친구 집');
    });
    expect(ready()).not.toBeNull();
  });

  test('T15_S29_표시는_누르기를_가로채지_않고_화면_읽기에_따로_안_읽힌다', async () => {
    await show();
    await act(async () => {
      mapControl.ready();
    });
    const host = ready() as unknown as Host;
    expect(host).not.toBeNull();
    expect(host.props.onPress ?? host.props.onClick).toBeUndefined();
    const chain: Host[] = [];
    for (let node: Host | null = host; node; node = node.parent) chain.push(node);
    expect(chain.some((node) => node.props.pointerEvents === 'none' || node.props.pointerEvents === 'box-none')).toBe(true);
    expect(host.props.accessible === true && typeof host.props.accessibilityLabel === 'string' && host.props.accessibilityLabel.length > 0).toBe(false);
  });

  test('T15_S29_지도를_못_불러와_a4면_없다', async () => {
    mapControl.failRender = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await show();
    expect(screen.getByTestId('pick-map-failed')).toBeTruthy(); // 시험 자체 확인
    expect(ready()).toBeNull();
  });
});
