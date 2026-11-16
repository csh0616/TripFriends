/// <reference types="jest" />
// TASK-015 §20 #7 a4(a2 지도를 못 불러옴)는 스크린샷 대신 테스트로만 확인한다. 로직·가드레일만 본다 (모습은 보지 않는다).
// 근거: TASK-015 §20 표 #7("a4(지도 그리기 실패)는 테스트로만 확인") · §6 표("지도를 못 불러옴(③): '지도를 못 불러왔어' + [다시]·[숙소 없이 계속]") ·
//       docs/design/reviews/task-015-design.md §1-1 표(a4: 지도가 안 뜸 -> [다시] · [숙소 없이 계속], 저장 lodging: null) · §1-5 · §7 글 표(a4) ·
//       TASK-006 §11 Q17(지도 준비 신호 8초) — map-adapter MAP_READY_LIMIT_MS와 같은 값
//
// testID (지금 코드에 있는 이름): a4 `pick-map-failed` · [다시] `pick-retry` · [숙소 없이 계속] `pick-skip`
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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
const CENTER = { lat: 34.6662, lng: 135.501 };
const FAIL_TITLE = '지도를 못 불러왔어';
const FAIL_BODY = '잠깐 뒤에 다시 해 보거나, 숙소 없이 계속해도 돼';
const READY_LIMIT_MS = 8000;

let confirm: jest.Mock<Promise<LodgingPickResult>, [PickedLodging]>;
let onSkip: jest.Mock;

async function show() {
  confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
  onSkip = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LodgingPickScreen cityCode="osaka" center={CENTER} onConfirm={confirm} onBack={jest.fn()} onSkip={onSkip} />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetDevice();
  mapControl.reset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a4 지도 부품이 그리다 던짐', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined); // 던질 때 React가 찍는 오류 줄
    mapControl.failRender = true;
  });

  test('T15_S20_7_a4_지도가_던지면_지도_대신_a4_제목·보조_글·다시·숙소_없이_계속', async () => {
    await show();
    const failed = await screen.findByTestId('pick-map-failed');
    expect(screen.queryByTestId('pick-map')).toBeNull();
    expect(within(failed).getByText(FAIL_TITLE)).toBeTruthy();
    expect(within(failed).getByText(FAIL_BODY)).toBeTruthy();
    expect(within(failed).getByTestId('pick-retry')).toBeTruthy();
    expect(within(failed).getByTestId('pick-skip')).toBeTruthy();
  });

  test('T15_S20_7_a4_숙소_없이_계속을_누르면_onSkip_한_번_onConfirm은_안_부름', async () => {
    await show();
    await tap(await screen.findByTestId('pick-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('T15_S20_7_a4_다시를_누르면_지도를_다시_그린다', async () => {
    await show();
    await screen.findByTestId('pick-map-failed');
    mapControl.failRender = false;
    await tap(screen.getByTestId('pick-retry'));
    expect(await screen.findByTestId('pick-map')).toBeTruthy();
    expect(screen.queryByTestId('pick-map-failed')).toBeNull();
  });

  test('T15_S20_7_a4_경계_다시를_눌러도_또_던지면_a4_그대로', async () => {
    await show();
    await screen.findByTestId('pick-map-failed');
    await tap(screen.getByTestId('pick-retry'));
    expect(await screen.findByTestId('pick-map-failed')).toBeTruthy();
    expect(screen.queryByTestId('pick-map')).toBeNull();
  });
});

describe('a4 지도 준비 신호가 8초 안에 없음', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mapControl.silent = true;
  });

  test('T15_S20_7_a4_경계_7999ms까지는_지도_그대로', async () => {
    await show();
    await act(async () => {
      jest.advanceTimersByTime(READY_LIMIT_MS - 1);
    });
    expect(screen.getByTestId('pick-map')).toBeTruthy();
    expect(screen.queryByTestId('pick-map-failed')).toBeNull();
  });

  test('T15_S20_7_a4_경계_8000ms가_되면_a4', async () => {
    await show();
    await act(async () => {
      jest.advanceTimersByTime(READY_LIMIT_MS);
    });
    expect(screen.getByTestId('pick-map-failed')).toBeTruthy();
  });

  test('T15_S20_7_a4_경계_8초_전에_준비_신호가_오면_a4가_안_된다', async () => {
    await show();
    await act(async () => {
      jest.advanceTimersByTime(READY_LIMIT_MS - 1);
      mapControl.ready();
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId('pick-map')).toBeTruthy();
    expect(screen.queryByTestId('pick-map-failed')).toBeNull();
  });
});

// ---------- 여행 만들기 화면에서: a4 [숙소 없이 계속] -> lodging: null ----------

const NOW_ISO = '2026-12-02T03:00:00Z';
const CREATE = 'POST /trips';
const created = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-10',
  end_date: '2026-12-11',
  lodging: null,
  status: 'active',
  trip_days: [10, 11].map((d) => ({ day_id: `day-t${d}`, date: `2026-12-${d}`, state: 'planning', chosen_option_id: null, fixed_events: [] as unknown[] })),
};

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

test('T15_S20_7_a4_숙소_없이_계속으로_돌아와_만들면_본문_lodging_null', async () => {
  jest.useFakeTimers({
    now: Date.parse(NOW_ISO),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const server = new FakeServer();
  server.on('GET /trips/current', apiError(404, 'NOT_FOUND', { resource: 'trip' }));
  server.on('GET /cities/osaka', json(200, { code: 'osaka', name_ko: '오사카', center: CENTER }));
  server.match('GET /places/lodging-search', () => json(200, []));
  server.match('GET /places/address-search', () => json(200, []));
  server.on(CREATE, json(201, created));
  const Index = require('@/app/index').default;
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
  await tap(await screen.findByText('여행 만들기'));
  await tap(await screen.findByTestId('field-start-date'));
  await tap(await screen.findByTestId('cal-day-2026-12-10'));
  await tap(await screen.findByTestId('cal-day-2026-12-11'));
  await tap(screen.getByTestId('calendar-confirm'));
  await settleAll();
  await fireEvent.changeText(await screen.findByTestId('lodging-search'), '친구 집 근처');
  await settleAll();
  mapControl.failRender = true;
  await tap(await screen.findByTestId('btn-pick-map'));
  await tap(await screen.findByTestId('pick-skip'));
  await tap(await screen.findByTestId('create-trip-submit'));
  await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
  expect((server.sent(CREATE)[0].body as Record<string, unknown>).lodging).toBeNull();
});
