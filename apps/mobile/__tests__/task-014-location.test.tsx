/// <reference types="jest" />
// TASK-014 §A 실제 위치(앱) · §B4 기기에 위치 0 · §6 실패 표(위치 줄). 로직·가드레일만 본다 (모습·배치는 §D 보드 -> Maestro·스크린샷).
// 근거: TASK-014 §A A1~A6·§B B4·§6·§7 AC-2·AC-4, TASK-010 C4(실제 여행 오늘 = 시계만)·§9 Q18(도시 시간대), TASK-007 B-4(위치는 check 본문),
// SRS FR-11·FR-30·NFR-10, 절대 규칙 4(앱은 서버만 부른다).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   위치 공급자 = expo-location (jest.setup.ts가 test-support/expo-location-mock으로 바꿔 끼운다. 손잡이 locationFake)
//   문서에 적힌 글자만 쓴다: 안내 시트 [위치 켜기]·[나중에] (§D1), 알약 "위치 꺼짐"(§D2) -> 누르면 [설정 열기], SOS 시트 "위치 확인됨"(A5)
//   [설정 열기] = react-native Linking.openSettings()
//   "앞에 있음/백그라운드" = react-native AppState 'change' 이벤트 ('active' | 'background')
//   화면을 떠나는 길 = 기존 프로필 메뉴 [날짜 목록으로] (testID profile-restart)
//   위치를 보내는 곳 = POST /days/{day_id}/check 본문 lat·lng (GET /now에는 싣지 않는다)
// §9·§10(v1.2)으로 문구가 확정돼 [보드] 표시는 뺐다. 글자는 TASK-014 §D·§9와 DESIGN-001 §4-13·docs/design/reviews/task-014-design.md §1 그대로.
// §10 Q7: 1분마다 앱이 지금 위치를 직접 다시 잰다(getCurrentPositionAsync). 잰 시각이 120초보다 오래됐거나 정확도 값이 없으면 버린다.
// §10 Q10: 안내는 기기당 한 번. §10 Q11: SOS는 좋은 좌표가 없으면 "위치 확인됨" 줄 자체가 없다. 데모는 데모 위치로 같은 규칙.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json, networkDown, type Reply, type Sent } from '../test-support/fake-server';
import { resetDevice, storedValues, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { secureStore } from '../test-support/secure-store-mock';
import { toNow } from '../test-support/trip-now-driver';
import { nowView } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 = 아래 여행의 오늘(day-t2)
const TODAY = 'day-t2';

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const trip = (over: object = {}) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: [tripDay(1, 'past'), tripDay(2, 'today'), tripDay(3, 'planned'), tripDay(4, 'planning')],
  ...over,
});
const todayView = () => nowView({ day: { ...demoDay, day_id: TODAY, date: '2026-12-02' }, at: '2026-12-02T12:00:00' });

// 기기가 잰 위치: 장소 좌표와 겹치지 않는 소수 자리 (기기 저장소 검사에서 찾기 쉽게)
const HERE = { lat: 34.668713, lng: 135.501327 };
const METERS_PER_DEG_LAT = (6371000 * Math.PI) / 180;
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / METERS_PER_DEG_LAT, lng: from.lng });

// ---------- 공용 ----------

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

const appListeners = new Set<(next: string) => void>();
function installAppState() {
  appListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((type: string, handler: (next: string) => void) => {
    if (type === 'change') appListeners.add(handler);
    return { remove: () => appListeners.delete(handler) };
  }) as unknown as typeof AppState.addEventListener);
}
async function moveApp(next: 'active' | 'background' | 'inactive') {
  try {
    Object.defineProperty(AppState, 'currentState', { value: next, configurable: true, writable: true });
  } catch {
    // 바꿀 수 없으면 이벤트만 보낸다
  }
  await act(async () => {
    appListeners.forEach((handler) => handler(next));
  });
  await settleAll();
}

let server: FakeServer;
let liveReply: () => Reply; // GET /now·POST /check 응답 (테스트가 바꿔 끼운다. FakeServer.match는 먼저 건 것이 이긴다)

const sentTo = (prefix: string): Sent[] => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(prefix));
const checks = () => sentTo(`POST /days/${TODAY}/check`);
const field = (sent: Sent, name: string): unknown => (sent.body as Record<string, unknown> | undefined)?.[name];
const checksWith = (spot: { lat: number; lng: number }) => checks().filter((sent) => field(sent, 'lat') === spot.lat && field(sent, 'lng') === spot.lng);
const anyCheckHasPosition = () => checks().some((sent) => field(sent, 'lat') !== undefined || field(sent, 'lng') !== undefined);

/** 기기가 위치를 하나 잰다 (가짜 공급자) */
async function walk(spot: { lat: number; lng: number }, accuracy: number | null | undefined = 10, timestamp = Date.now()) {
  await act(async () => {
    locationFake.emit({ ...spot, accuracy, timestamp });
  });
  await settleAll();
}

async function openToday() {
  await tap(await screen.findByTestId(`day-row-${TODAY}`));
  await screen.findByTestId('trip-now-screen');
  await waitFor(() => expect(sentTo(`GET /days/${TODAY}/now`).length).toBeGreaterThanOrEqual(1));
  await settleAll();
}

async function leaveToList() {
  await tap(screen.getByLabelText('프로필'));
  await tap(await screen.findByTestId('profile-restart')); // 실제 여행 = "날짜 목록으로"
  await screen.findByTestId(`day-row-${TODAY}`);
}

/** 안내 시트 [위치 켜기] -> iOS 권한 창 (답은 locationFake.willAnswer) */
async function turnOn() {
  await tap(await screen.findByText('위치 켜기'));
  await settleAll();
}

type Host = { props: Record<string, any>; parent: Host | null };
const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
/** 글자를 감싼 가장 가까운 눌리는 상자 */
const pressableOf = (host: Host): Host => {
  for (let now: Host | null = host; now; now = now.parent) if (typeof now.props.onClick === 'function' || typeof now.props.onPress === 'function') return now;
  return host;
};
/** 누를 수 있는 높이: height·minHeight + hitSlop (task-010-new-trip-confirm의 reachHeight와 같은 셈) */
function reachHeight(host: Host): number {
  const style = styleOf(host);
  const slop = host.props.hitSlop ?? {};
  const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
  const numeric = [style.height, style.minHeight].filter((v): v is number => typeof v === 'number');
  return (numeric.length ? Math.max(...numeric) : 0) + extra;
}

const allDeviceText = () => [...storedValues(), ...secureStore.values()].join('\n');
const textsOf = (value: number) => [String(value), value.toFixed(6), value.toFixed(5), value.toFixed(4)];
const deviceLeaks = (spot: { lat: number; lng: number }) => [spot.lat, spot.lng].flatMap(textsOf).filter((text) => allDeviceText().includes(text));

// DESIGN-001 §4-13 (TASK-014 §9 답 2): iOS 권한 창 글
const PLIST_TEXT = '지금 어디쯤인지 알아서, 일정이 늦어질 때 미리 알려 주려고 위치를 써요. 위치는 저장하지 않아요.';
const OFFLINE_BAND = '연결이 안 돼, 저장된 일정만 보여'; // 기존 여행 중 화면 끊김 띠 (TASK-006 §7)

const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  freezeDate(NOW_ISO);
  installAppState();
  server = new FakeServer().on(CURRENT, json(200, trip()));
  liveReply = () => json(200, todayView());
  server.match(`GET /days/${TODAY}/now`, () => liveReply());
  server.match(`POST /days/${TODAY}/check`, () => liveReply());
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// A1 언제 묻나
// =====================================================================

describe('A1 언제 묻나: 실제 여행의 오늘 여행 중 화면을 처음 열 때 한 번', () => {
  test('T14_A1_앱을_켜고_날짜_목록까지는_묻지_않는다', async () => {
    await startHome();
    await screen.findByTestId(`day-row-${TODAY}`);
    await settleAll();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
    expect(screen.queryByText('위치 켜기')).toBeNull();
  });

  test('T14_A1_오늘_화면을_처음_열면_안내_시트가_나오고_아직_권한_창은_띄우지_않는다', async () => {
    await startHome();
    await openToday();
    expect(await screen.findByText('위치 켜기')).toBeTruthy();
    expect(screen.getByText('나중에')).toBeTruthy();
    expect(locationFake.askCount()).toBe(0); // 권한 창은 [위치 켜기]를 누른 뒤 (A1)
    expect(locationFake.readCount()).toBe(0);
  });

  test('T14_A1_위치_켜기를_누르면_앱_사용_중_권한만_한_번_묻고_백그라운드는_0', async () => {
    await startHome();
    await openToday();
    await turnOn();
    expect(locationFake.foregroundAsks()).toBe(1);
    expect(locationFake.backgroundCount()).toBe(0);
    expect(screen.queryByText('위치 켜기')).toBeNull(); // 시트는 닫힌다
  });

  test('T14_A1_안내는_한_번만_나중에_뒤_다시_열어도_시트가_없다', async () => {
    await startHome();
    await openToday();
    await tap(await screen.findByText('나중에'));
    await leaveToList();
    await openToday();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(locationFake.askCount()).toBe(0);
  });

  test('T14_A1_데모_여행_중_화면은_묻지도_읽지도_않는다', async () => {
    await toNow();
    await settleAll();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
  });

  test('T14_A1_계획_화면에서는_묻지_않는다', async () => {
    server.on('POST /days/day-t4/planning', json(201, require('../test-support/planning-fixtures').session));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await waitFor(() => expect(sentTo('POST /days/day-t4/planning')).toHaveLength(1));
    await settleAll();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
  });

  test('T14_A1_오늘이_아닌_계획_완료·지난_날을_열어도_묻지_않는다', async () => {
    server.on('GET /days/day-t3/course', json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
    server.on('GET /days/day-t1/course', json(200, require('../test-support/planning-fixtures').relaxed('opt-1')));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t3'));
    await settleAll();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
  });

  test('T14_A1_허용된_오늘_화면에서_백그라운드를_오가도_백그라운드_위치를_부르지_않는다', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE);
    await moveApp('background');
    await moveApp('active');
    expect(locationFake.backgroundCount()).toBe(0);
  });
});

// =====================================================================
// A2 거절·나중에 -> 시계만 + "위치 꺼짐" 알약, 자동으로 다시 묻지 않음
// =====================================================================

describe('A2 거절·나중에', () => {
  test('T14_A2_나중에면_시계만_쓰고_위치_꺼짐_알약이_보인다', async () => {
    await startHome();
    await openToday();
    await tap(await screen.findByText('나중에'));
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
    expect(anyCheckHasPosition()).toBe(false);
  });

  test('T14_A2_권한_창에서_거절하면_시계만_쓰고_위치_꺼짐_알약', async () => {
    locationFake.willAnswer('denied');
    await startHome();
    await openToday();
    await turnOn();
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy();
    expect(locationFake.readCount()).toBe(0);
    expect(anyCheckHasPosition()).toBe(false);
  });

  test('T14_A2_알약을_누르면_설명과_설정_열기_누르면_설정으로', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
    locationFake.willAnswer('denied');
    await startHome();
    await openToday();
    await turnOn();
    await tap(await screen.findByText('위치 꺼짐'));
    await tap(await screen.findByText('설정 열기'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(locationFake.foregroundAsks()).toBe(1); // 알약을 눌러도 권한 창을 다시 띄우지 않는다
  });

  test('T14_A2_거절한_뒤_다시_열어도_시트를_자동으로_띄우지_않는다', async () => {
    locationFake.willAnswer('denied');
    await startHome();
    await openToday();
    await turnOn();
    await leaveToList();
    await openToday();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy();
    expect(locationFake.foregroundAsks()).toBe(1);
  });

  test('T14_A2_이미_거절된_기기는_앱을_다시_켜도_시트_없이_알약만', async () => {
    locationFake.permit('denied', false);
    await startHome();
    await openToday();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy();
    expect(locationFake.askCount()).toBe(0);
  });

  test('T14_A2_시계는_그대로_흐른다_거절해도_check는_시각만으로_간다', async () => {
    locationFake.willAnswer('denied');
    await startHome();
    await openToday();
    await turnOn();
    const at = (sent: Sent) => (sent.method === 'GET' ? decodeURIComponent(sent.path.split('at=')[1] ?? '') : String(field(sent, 'at')));
    const asked = [...sentTo(`GET /days/${TODAY}/now`), ...checks()];
    expect(asked.length).toBeGreaterThan(0);
    for (const sent of asked) expect(at(sent).startsWith('2026-12-02T12:00')).toBe(true); // TASK-010 §9 Q18: 도시 시간대의 지금
    expect(anyCheckHasPosition()).toBe(false);
  });
});

describe('§9 답 1·3·4·6: 권한 상태별 알약·띠·[내 위치]', () => {
  test('T14_S9_1_나중에_뒤_알약을_누르면_다시_위치_켜기_시트_누르면_그때_권한_창', async () => {
    await startHome();
    await openToday();
    await tap(await screen.findByText('나중에'));
    await tap(await screen.findByText('위치 꺼짐'));
    expect(await screen.findByText('위치 켜기')).toBeTruthy(); // undetermined -> D1 시트 (사용자가 눌렀을 때만)
    expect(screen.queryByText('설정 열기')).toBeNull();
    expect(locationFake.askCount()).toBe(0);
    await turnOn();
    expect(locationFake.foregroundAsks()).toBe(1);
    expect(locationFake.backgroundCount()).toBe(0);
  });

  test('T14_S9_1_거절된_뒤_알약을_누르면_설정_열기_시트이고_위치_켜기는_없다', async () => {
    locationFake.permit('denied', false);
    await startHome();
    await openToday();
    await tap(await screen.findByText('위치 꺼짐'));
    expect(await screen.findByText('설정 열기')).toBeTruthy();
    expect(screen.queryByText('위치 켜기')).toBeNull(); // iOS는 한 번 거절하면 앱이 다시 못 묻는다
    expect(locationFake.askCount()).toBe(0);
  });

  test('T14_S9_3_끊김_띠가_있는_동안은_위치_꺼짐_알약을_숨긴다', async () => {
    locationFake.permit('denied', false);
    liveReply = () => networkDown;
    await startHome();
    await openToday();
    await screen.findByText(OFFLINE_BAND);
    expect(screen.queryByText('위치 꺼짐')).toBeNull();
    liveReply = () => json(200, todayView());
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy(); // 띠가 사라지면 다시 보인다
  });

  test.each([
    ['나중에', 'undetermined'],
    ['거절', 'denied'],
  ] as const)('T14_S9_4_위치를_모르면(%s)_내_위치로_이동_버튼을_숨긴다', async (_name, status) => {
    locationFake.permit(status, status !== 'denied');
    await startHome();
    await openToday();
    if (status === 'undetermined') await tap(await screen.findByText('나중에'));
    await screen.findByText('위치 꺼짐');
    expect(screen.queryByTestId('my-location-button')).toBeNull();
  });

  test('T14_S9_4_경계_좋은_위치가_있으면_내_위치로_이동_버튼이_있다', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByTestId('my-location-button')).toBeTruthy();
  });

  test('T14_Q10_나중에_뒤_앱을_다시_켜도_안내를_띄우지_않는다_기기당_한_번', async () => {
    const first = await startHome();
    await openToday();
    await tap(await screen.findByText('나중에'));
    await first.unmount(); // 앱을 끈다 (기기 저장소는 그대로, iOS 권한은 아직 undetermined)
    await startHome();
    await openToday();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy(); // 켜는 길은 알약 하나
    expect(locationFake.askCount()).toBe(0);
  });

  test('T14_D2_위치_꺼짐_알약의_누르는_높이는_44_이상', async () => {
    locationFake.permit('denied', false);
    await startHome();
    await openToday();
    const pill = pressableOf((await screen.findByText('위치 꺼짐')) as unknown as Host);
    expect(reachHeight(pill)).toBeGreaterThanOrEqual(44); // task-014-design §2 pill-off: 보이는 32 · 누르는 44
  });

  test('T14_S9_6_부정확한_위치는_알약_없이_조용히_시계만', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE, 400);
    await settleAll();
    expect(screen.queryByText('위치 꺼짐')).toBeNull();
    expect(anyCheckHasPosition()).toBe(false);
  });
});

// =====================================================================
// A3 언제 읽나: 앞에 있을 때만, 50m 넘게 움직였거나 1분 -> check 본문
// =====================================================================

describe('A3 언제 읽나', () => {
  async function granted() {
    await startHome();
    await openToday();
    await turnOn();
  }

  test('T14_A3_허락하면_읽은_위치를_check_본문으로_보낸다_주소에는_없다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    for (const sent of server.requests) expect(sent.path).not.toMatch(/[?&](lat|lng)=/); // B1·TASK-007 B-4: 주소에 위치 0
  });

  test('T14_A3_50m_넘게_움직이면_새_위치로_다시_보낸다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    const moved = north(HERE, 80);
    await walk(moved, 10, Date.now() + 10_000);
    await waitFor(() => expect(checksWith(moved).length).toBeGreaterThanOrEqual(1));
  });

  test('T14_A3_경계_10초_안에_30m만_움직이면_그_위치로는_보내지_않는다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    const nudged = north(HERE, 30);
    await walk(nudged, 10, Date.now() + 10_000);
    await settleAll();
    expect(checksWith(nudged)).toEqual([]);
  });

  test('T14_A3_경계_제자리여도_1분이_지나면_다시_보낸다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    const before = checksWith(HERE).length;
    jest.setSystemTime(Date.parse(NOW_ISO) + 60_000);
    await walk(HERE, 10, Date.parse(NOW_ISO) + 60_000);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThan(before));
  });

  test('T14_A3_백그라운드로_가면_읽기를_멈추고_그동안의_위치는_보내지_않는다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(locationFake.activeWatches()).toBeGreaterThanOrEqual(1));
    await moveApp('background');
    expect(locationFake.activeWatches()).toBe(0);
    const away = north(HERE, 500);
    await walk(away, 10, Date.now() + 120_000);
    expect(checksWith(away)).toEqual([]);
  });

  test('T14_A3_다시_앞으로_오면_다시_읽는다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(locationFake.activeWatches()).toBeGreaterThanOrEqual(1));
    const started = locationFake.watchCount();
    await moveApp('background');
    await moveApp('active');
    await waitFor(() => expect(locationFake.activeWatches()).toBeGreaterThanOrEqual(1));
    expect(locationFake.watchCount()).toBeGreaterThan(started);
    const back = north(HERE, 300);
    await walk(back, 10, Date.now() + 120_000);
    await waitFor(() => expect(checksWith(back).length).toBeGreaterThanOrEqual(1));
  });

  test('T14_A3_화면을_떠나면_읽기를_멈춘다', async () => {
    await granted();
    await walk(HERE);
    await waitFor(() => expect(locationFake.activeWatches()).toBeGreaterThanOrEqual(1));
    await leaveToList();
    expect(locationFake.activeWatches()).toBe(0);
    const away = north(HERE, 500);
    await walk(away, 10, Date.now() + 120_000);
    expect(checksWith(away)).toEqual([]);
  });

  test('T14_A3_이미_허용된_기기는_시트_없이_바로_읽는다', async () => {
    // 추론: A1의 안내는 "처음 열 때" 권한을 받기 위한 것. 이미 허용이면 안내 없이 읽는다 (질문 목록)
    locationFake.permit('granted');
    await startHome();
    await openToday();
    expect(screen.queryByText('위치 켜기')).toBeNull();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    expect(locationFake.askCount()).toBe(0);
  });
});

// =====================================================================
// A4 정확도 / §6 부정확·위치 꺼짐
// =====================================================================

describe('A4 정확도 · §6', () => {
  beforeEach(() => locationFake.permit('granted'));

  test.each([
    [100, true],
    [100.5, false],
    [150, false],
  ])('T14_A4_정확도_%sm_위치를_보내나_%s', async (accuracy, sent) => {
    await startHome();
    await openToday();
    await walk(HERE, accuracy);
    await settleAll();
    if (sent) await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    else expect(checksWith(HERE)).toEqual([]);
  });

  test('T14_S6_부정확한_위치는_버리고_시계만_check는_위치_없이_간다', async () => {
    await startHome();
    await openToday();
    await walk(HERE, 300);
    jest.setSystemTime(Date.parse(NOW_ISO) + 60_000);
    await walk(HERE, 300, Date.parse(NOW_ISO) + 60_000);
    await settleAll();
    expect(anyCheckHasPosition()).toBe(false);
  });

  test('T14_S6_좋은_위치_뒤에_부정확한_위치가_오면_부정확한_값은_보내지_않는다', async () => {
    await startHome();
    await openToday();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    const bad = north(HERE, 900);
    await walk(bad, 500, Date.now() + 70_000);
    await settleAll();
    expect(checksWith(bad)).toEqual([]);
  });

  test('T14_S6_기기_위치_서비스가_꺼져_있으면_시계만_위치_꺼짐_알약', async () => {
    locationFake.services(false);
    await startHome();
    await openToday();
    expect(await screen.findByText('위치 꺼짐')).toBeTruthy();
    expect(anyCheckHasPosition()).toBe(false);
  });
});

// =====================================================================
// A5 SOS 시트의 "위치 확인됨"
// =====================================================================

describe('A5 SOS 시트', () => {
  test('T14_A5_좌표가_있으면_SOS_시트에_위치_확인됨', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    await tap(screen.getByTestId('sos-button'));
    expect(await screen.findByText('위치 확인됨')).toBeTruthy();
  });

  test('T14_Q11_데모는_데모_위치로_같은_규칙_SOS에_위치_확인됨', async () => {
    await toNow(); // 데모 여행 중: 위치는 fakePosition(코스대로)
    await tap(screen.getByTestId('sos-button'));
    expect(await screen.findByText('위치 확인됨')).toBeTruthy();
    expect(locationFake.readCount()).toBe(0); // 데모는 실제 위치를 읽지 않는다
  });

  test('T14_A5_위치를_거절했으면_위치_확인됨이_없다', async () => {
    locationFake.permit('denied', false);
    await startHome();
    await openToday();
    await tap(screen.getByTestId('sos-button'));
    await screen.findByTestId('sos-sheet');
    expect(screen.queryByText('위치 확인됨')).toBeNull();
  });

  test('T14_A5_부정확한_위치만_있으면_위치_확인됨이_없다', async () => {
    // A4: 100m보다 나쁜 위치는 쓰지 않는다 -> SOS의 "지금 위치"에도 쓰지 않는다 (A5는 A4를 따른다고 읽음, 질문 목록)
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE, 400);
    await tap(screen.getByTestId('sos-button'));
    await screen.findByTestId('sos-sheet');
    expect(screen.queryByText('위치 확인됨')).toBeNull();
  });
});

// =====================================================================
// §10 Q7 오래된 위치: 1분마다 지금 위치를 다시 재고, 잰 시각이 120초보다 오래됐거나 정확도 값이 없으면 버린다
// 가짜 타이머(setTimeout·setInterval·Date)로 시간을 민다
// =====================================================================

describe('§10 Q7 오래된 위치', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.useFakeTimers({ now: Date.parse(NOW_ISO), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
    locationFake.permit('granted');
  });

  const minutes = async (count: number) => {
    for (let i = 0; i < count; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
    }
    await settleAll();
  };

  test('T14_Q7_1분마다_앱이_지금_위치를_직접_다시_잰다', async () => {
    locationFake.stayAt(HERE);
    await startHome();
    await openToday();
    const before = locationFake.currentCount();
    await minutes(3);
    expect(locationFake.currentCount()).toBeGreaterThanOrEqual(before + 3);
  });

  test('T14_Q7_가만히_30분_같은_자리에_있어도_위치를_계속_쓴다', async () => {
    locationFake.stayAt(HERE); // 폰은 움직이지 않아 watch로는 새 위치를 안 준다. 앱이 물을 때마다 방금 잰 값
    await startHome();
    await openToday();
    await minutes(28);
    const at28 = checksWith(HERE).length;
    expect(at28).toBeGreaterThanOrEqual(20);
    await minutes(2);
    expect(checksWith(HERE).length).toBeGreaterThan(at28); // 28분 뒤에도 버려지지 않는다
  });

  test.each([
    [120_000, true],
    [120_001, false],
    [600_000, false],
  ])('T14_Q7_폰이_%sms_전에_잰_값을_주면_보내나_%s', async (age, sent) => {
    locationFake.answerOld(HERE, age);
    await startHome();
    await openToday();
    await minutes(3);
    if (sent) expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1);
    else expect(checksWith(HERE)).toEqual([]);
  });

  test.each([null, undefined])('T14_Q7_정확도_값이_%s인_위치는_버린다', async (accuracy) => {
    locationFake.stayAt({ ...HERE, accuracy });
    await startHome();
    await openToday();
    await act(async () => {
      locationFake.emit({ ...HERE, accuracy, timestamp: Date.now() }); // watch로 온 값도 같다
    });
    await minutes(2);
    expect(checksWith(HERE)).toEqual([]);
    expect(screen.queryByText('위치 꺼짐')).toBeNull(); // §9 답 6: 조용히 시계만
  });

  test('T14_Q7_백그라운드에서는_1분이_지나도_다시_재지_않는다', async () => {
    locationFake.stayAt(HERE);
    await startHome();
    await openToday();
    await minutes(1);
    await moveApp('background');
    const before = locationFake.readCount();
    await minutes(3);
    expect(locationFake.readCount()).toBe(before);
  });
});

// =====================================================================
// B4 기기 저장소(AsyncStorage·SecureStore)에 좌표 0
// =====================================================================

describe('B4 기기에 위치 0', () => {
  test('T14_B4_걸으며_보낸_위치가_AsyncStorage·SecureStore_어디에도_없다', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    const route = [HERE, north(HERE, 80), north(HERE, 160)];
    for (const [index, spot] of route.entries()) await walk(spot, 10, Date.now() + index * 61_000);
    await waitFor(() => expect(checksWith(route[2]).length).toBeGreaterThanOrEqual(1)); // 시험 자체 확인: 위치를 썼다
    expect(storedValues().length + secureStore.values().length).toBeGreaterThan(0); // 시험 자체 확인: 기기 저장소에 무언가는 있다(로그인 세션)
    for (const spot of route) expect(deviceLeaks(spot)).toEqual([]);
  });

  test('T14_B4_화면을_떠나고_백그라운드를_거쳐도_기기에_좌표가_없다', async () => {
    locationFake.permit('granted');
    await startHome();
    await openToday();
    await walk(HERE);
    await waitFor(() => expect(checksWith(HERE).length).toBeGreaterThanOrEqual(1));
    await moveApp('background');
    await moveApp('active');
    await leaveToList();
    expect(deviceLeaks(HERE)).toEqual([]);
  });
});

// =====================================================================
// A6 앱 설정: 앱 사용 중 권한 문구만, 백그라운드 위치 없음
// =====================================================================

describe('A6 앱 설정', () => {
  const config = () => require('../test-support/trip-now-driver').buildConfig(null) as Record<string, any>;
  const pluginOptions = (built: Record<string, any>, name: string): Record<string, any> | null => {
    const found = (built.plugins ?? []).find((plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin) === name);
    return found === undefined ? null : Array.isArray(found) ? (found[1] ?? {}) : {};
  };

  test('T14_A6_expo_location을_설정에_넣고_앱_사용_중_설명은_DESIGN_001_문구', () => {
    // A6 "§D1 안내와 같은 뜻의 한국어 한 문장" -> TASK-014 §9 답 2 + DESIGN-001 §4-13이 정한 글자 그대로 (두 문장으로 보이는 점은 질문 목록)
    const built = config();
    const options = pluginOptions(built, 'expo-location');
    const plist = built.ios?.infoPlist ?? {};
    const text: unknown = plist.NSLocationWhenInUseUsageDescription ?? options?.locationWhenInUsePermission;
    expect(options !== null || plist.NSLocationWhenInUseUsageDescription !== undefined).toBe(true);
    expect(text).toBe(PLIST_TEXT);
  });

  test('T14_A6_백그라운드_위치를_켜지_않는다', () => {
    const built = config();
    const options = pluginOptions(built, 'expo-location') ?? {};
    const plist = built.ios?.infoPlist ?? {};
    expect(plist.UIBackgroundModes ?? []).not.toContain('location');
    expect(options.isIosBackgroundLocationEnabled === true).toBe(false);
    expect(options.isAndroidBackgroundLocationEnabled === true).toBe(false);
    expect(typeof options.locationAlwaysPermission === 'string').toBe(false);
    expect(typeof options.locationAlwaysAndWhenInUsePermission === 'string').toBe(false);
    expect(plist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined();
    expect(plist.NSLocationAlwaysUsageDescription).toBeUndefined();
  });
});
