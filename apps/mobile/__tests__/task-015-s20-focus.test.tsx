/// <reference types="jest" />
// TASK-015 §20 #1 포커스 · 블러를 실제로 보내는 여행 만들기 화면 테스트. 로직·가드레일만 본다 (모습은 보지 않는다).
// 근거: TASK-015 §20 "테스트 초록 ≠ 실제 7번째"(숙소를 고르면 검색 칸이 블러 없이 사라져 `focused`가 'lodging'에 남고
//       앱이 "키보드가 열려 있다"고 보고 [여행 만들기]를 그리지 않음 -> AC-5 실패) ·
//       §20 표 #1(포커스 · 블러를 실제로 보내는 Jest 테스트: 숙소 고름 · 주소 고름 · 지도 찍기에서 돌아옴 -> [여행 만들기]가 보인다) ·
//       §20 표 #2(숙소를 고르면 focused를 비운다, 지도 찍기에서 돌아올 때도) · §20 표 #3(키보드가 열린 채 [여기로 정했어] 한 번 누르면 넘어가야 한다) ·
//       docs/design/reviews/task-015-design.md §1-1(a1 주소 줄 · a2 [여기로 정했어] · a3 [지도에서 찍기] -> a2 · a4 [숙소 없이 계속])
//
// 시험 방법 (이 파일이 정한 것):
//   검색 칸 `lodging-search`에 fireEvent 'focus'를 보낸 뒤 글을 치고 결과를 고른다. 고르는 동안 'blur'는 보내지 않는다 —
//   실제 기기에서 칸이 화면에서 사라질 때 블러가 오지 않은 것(reviewer Maestro)을 그대로 흉내 낸다.
//   시험 자체 확인: 포커스가 있는 동안에는 [여행 만들기](`create-trip-submit`)가 없다(지금 규칙: 키보드가 열린 동안 주 버튼 줄을 접는다)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

import { apiError, FakeServer, json } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const NOW_ISO = '2026-12-02T03:00:00Z';
const CURRENT = 'GET /trips/current';
const CITY = 'GET /cities/osaka';
const OSAKA_CENTER = { lat: 34.6662, lng: 135.501 }; // 시드 v3 (§9 Q6)
const SPOT = { latitude: 34.657913, longitude: 135.506271 }; // 오사카 중심에서 약 1km (지어낸 값)
const NAME_HIT = { place_id: 'FAKE-T15-S20-lodging-1', name: '가짜_숙소_이름', address_short: '가짜_짧은_주소' };
const ADDR_HIT = { place_id: 'FAKE-T15-S20-address-1', name: '가짜_주소_장소', address_short: '가짜_짧은_주소_2' };
const KEYBOARD = 336;

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

let server: FakeServer;

/** name: 이름 검색 결과, address: 주소 검색 결과 */
function serverWith(name: unknown[], address: unknown[]) {
  server = new FakeServer();
  server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
  server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
  server.match('GET /places/lodging-search', () => json(200, name));
  server.match('GET /places/address-search', () => json(200, address));
}

beforeEach(() => {
  resetDevice();
  mapControl.reset();
  freezeDate(NOW_ISO);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function toForm() {
  const Index = require('@/app/index').default;
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
  await tap(await screen.findByText('여행 만들기'));
  await screen.findByTestId('create-trip-submit');
}

/** 검색 칸에 포커스(키보드 열림) -> 글을 친다. 블러는 보내지 않는다 */
async function focusAndType(value: string) {
  const input = await screen.findByTestId('lodging-search');
  await act(async () => {
    fireEvent(input, 'focus');
  });
  expect(screen.queryByTestId('create-trip-submit')).toBeNull(); // 시험 자체 확인: 포커스 동안은 주 버튼 줄을 접는다
  await fireEvent.changeText(screen.getByTestId('lodging-search'), value);
  await settleAll();
}

async function longPress(at: { latitude: number; longitude: number }) {
  await act(async () => {
    fireEvent(screen.getByTestId('pick-map'), 'longPress', { nativeEvent: { coordinate: at } });
  });
}

/** 이름·주소 둘 다 0건 -> a3 [지도에서 찍기] -> a2 */
async function focusToPick() {
  serverWith([], []);
  await toForm();
  await focusAndType('친구 집 근처');
  await tap(await screen.findByTestId('btn-pick-map'));
  await screen.findByTestId('pick-map');
}

describe('§20 #1 검색 칸에 포커스가 있던 채 숙소를 정하면 [여행 만들기]가 보인다', () => {
  test('T15_S20_1_경계_포커스만_있고_고르지_않으면_여행_만들기가_접혀_있고_블러하면_다시_보인다', async () => {
    serverWith([NAME_HIT], []);
    await toForm();
    await focusAndType('가짜 숙소');
    expect(screen.queryByTestId('create-trip-submit')).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId('lodging-search'), 'blur');
    });
    expect(screen.getByTestId('create-trip-submit')).toBeTruthy();
  });

  test('T15_S20_1_이름_결과_줄을_고르면_블러_없이도_여행_만들기가_보인다', async () => {
    serverWith([NAME_HIT], []);
    await toForm();
    await focusAndType('가짜 숙소');
    await tap(await screen.findByTestId(`lodging-result-${NAME_HIT.place_id}`));
    expect(await screen.findByTestId('lodging-picked')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-submit')).not.toBeNull();
  });

  test('T15_S20_1_a1_주소_결과_줄을_고르면_블러_없이도_여행_만들기가_보인다', async () => {
    serverWith([], [ADDR_HIT]);
    await toForm();
    await focusAndType('2-5-12 Namba');
    await tap(await screen.findByTestId(`addr-row-${ADDR_HIT.place_id}`));
    expect(await screen.findByTestId('lodging-picked')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-submit')).not.toBeNull();
  });

  test('T15_S20_1_a2에서_여기로_정했어로_돌아오면_블러_없이도_여행_만들기가_보인다', async () => {
    await focusToPick();
    await longPress(SPOT);
    await tap(screen.getByTestId('pick-confirm'));
    await settleAll();
    expect(await screen.findByTestId('lodging-picked')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-submit')).not.toBeNull();
  });

  test('T15_S20_2_a2에서_뒤로_돌아와도_여행_만들기가_보인다', async () => {
    // §20 #2 "지도 찍기에서 돌아올 때도" — [뒤로]도 돌아오는 길이라 같이 본다 (돌아온 칸에는 포커스가 없다)
    await focusToPick();
    await tap(screen.getByTestId('pick-back'));
    await settleAll();
    expect(await screen.findByTestId('lodging-search')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-submit')).not.toBeNull();
  });

  test('T15_S20_2_a4_숙소_없이_계속으로_돌아와도_여행_만들기가_보인다', async () => {
    serverWith([], []);
    await toForm();
    await focusAndType('친구 집 근처');
    mapControl.failRender = true; // a4: 지도를 못 불러옴 -> 지도 대신 a4
    jest.spyOn(console, 'error').mockImplementation(() => undefined); // 지도 부품이 던질 때 React가 찍는 오류 줄
    await tap(await screen.findByTestId('btn-pick-map'));
    await screen.findByTestId('pick-map-failed');
    await tap(screen.getByTestId('pick-skip'));
    await settleAll();
    expect(await screen.findByTestId('lodging-search')).toBeTruthy();
    expect(screen.queryByTestId('create-trip-submit')).not.toBeNull();
  });
});

// ---------- §20 #3 a2 키보드가 열린 채 [여기로 정했어] 한 번 ----------

function keyboardEvent(height: number) {
  return { endCoordinates: { height, screenX: 0, screenY: 844 - height, width: 390 }, startCoordinates: { height: 0, screenX: 0, screenY: 844, width: 390 }, duration: 250, easing: 'keyboard' };
}

async function keyboard(show: boolean) {
  await act(async () => {
    DeviceEventEmitter.emit(show ? 'keyboardWillShow' : 'keyboardWillHide', keyboardEvent(show ? KEYBOARD : 0));
  });
  await act(async () => {
    DeviceEventEmitter.emit(show ? 'keyboardDidShow' : 'keyboardDidHide', keyboardEvent(show ? KEYBOARD : 0));
  });
}

describe('§20 #3 a2 이름 칸에 포커스(키보드 열림) 그대로 [여기로 정했어]', () => {
  test('T15_S20_3_키보드가_열린_채_여기로_정했어를_한_번_누르면_onConfirm이_한_번_불린다', async () => {
    // RNTL 한계: 실제 기기에서 첫 누름이 키보드 닫기에 먹히는지는 Jest가 흉내 내지 못한다 (fireEvent.press는 onPress를 바로 부른다).
    // 그래서 이 시험은 "한 번 누름 = 한 번 보냄"과 키보드가 열린 상태에서도 버튼이 눌러질 수 있는 상태(비활성 아님)만 지킨다. 원인은 Maestro 몫
    const confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <LodgingPickScreen cityCode="osaka" center={OSAKA_CENTER} onConfirm={confirm} onBack={jest.fn()} />
      </SafeAreaProvider>,
    );
    await longPress(SPOT);
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'focus');
    });
    await fireEvent.changeText(screen.getByTestId('pick-label'), '친구 집');
    await keyboard(true);
    await tap(screen.getByTestId('pick-confirm'));
    await settleAll();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.latitude, lng: SPOT.longitude, label: '친구 집' });
  });
});
