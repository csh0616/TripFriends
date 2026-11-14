/// <reference types="jest" />
// TASK-014 §21 reviewer 점검 답 (11-15, 고칠 것 3건) — 1 연습 지도 "지금 구간"만 · 2 D6 날짜 숫자 DM Mono 13/18 나란한 별도 글자 · 3 [+10분] 아이콘 + "10분".
// 근거: TASK-014 §21 표 1~3, task-014-design §2 reh-clock·§9-1·§9-2, DESIGN-001 §4-13. 4(Maestro account-link 초기화)는 task-014-s21-account-reset.test.ts.
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   연습 카메라 = MapAdapter.fit 한 번(fitToCoordinates + edgePadding). 처음 맞출 때 animateToRegion·animateCamera(옮기기)는 없다
//     머무는 중(핀 중 state "now"가 있음): 맞춤 좌표의 상자 가운데 = 그 장소(1m 안), 상자 동서 폭 = 800m ± 5% (§21 "가설: 화면에 약 800m")
//     이동 중(state "now"가 없고 "next"가 있음): 맞춤 좌표 = { 지금 자리(응답 position = reh-dot), 출발(마지막 done 핀), 도착(next 핀) } 정확히 이 셋
//     둘 다 아래 여백 >= 연습 시트 440 + 시계 판 112 (§19 하한 그대로)
//   실제 여행(연습 아님) 카메라는 그대로: 처음 맞출 때 모든 핀 + 숙소 (TASK-006 B10)
//   D6 날짜: 숫자 Text("12/11")와 요일 Text("금")가 같은 부모 아래 나란한 별도 Text. 숫자 Text는 다른 Text 안에 없다. 숫자 = DM Mono 13/18
//   [+10분] `demo-plus-10`: 보이는 글자는 "10분" 하나(버튼 안 글자에 "+" 없음, + 는 아이콘 하나), accessibilityLabel은 "10분"을 포함하고 "+"가 없다
//   테스트로 못 고정하는 것 (reviewer 스크린샷): DM Mono가 실제로 그려지는지 · 800m가 화면에서 어떻게 보이는지 · 경로·점이 시계 판에 가리지 않는지
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { FakeServer, json, type Sent } from '../test-support/fake-server';
import { locationFake } from '../test-support/expo-location-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay, SPOT } from '../test-support/planning-fixtures';
import { nowView, pins as basePins, POSITION, t02, t03 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const TODAY = 'day-t2';
const PLANNED = 'day-t3';
const REH_SHEET = 440; // task-014-design §2 연습 카드 시트 (§19·§20 Q3 하한)
const REH_CLOCK = 112; // DESIGN-001 §4-13 reh-clock 높이
const STAY_SPAN_M = 800; // TASK-014 §21 1 "가설: 화면에 약 800m"
const STAY_TOLERANCE = 0.05; // 이 테스트가 정한 "약" (질문 1)
const METERS_PER_DEGREE = (Math.PI / 180) * 6371000; // map-adapter와 같은 셈

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const trip = () => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: [tripDay(1, 'past'), tripDay(2, 'today'), tripDay(3, 'planned'), tripDay(4, 'planning')],
});

// 머무는 중: 1 지남 · 2 지금(D20) · 3 다음. reh-dot은 그 장소에
const STAY_PINS = basePins; // done · now · next
// 이동 중: 1 지남(D01, 출발) · 2 다음(D20, 도착) · 3 나중(D30). reh-dot은 길 위 POSITION
const MOVE_PINS = [
  { ...basePins[0], state: 'done' },
  { ...basePins[1], state: 'next' },
  { ...basePins[2], state: 'later' },
];
const LODGING = demoDay.lodging;

const plannedDay = { ...demoDay, day_id: PLANNED, date: '2026-12-03' };
const stayView = (over: object = {}) => nowView({ day: plannedDay, pins: STAY_PINS, position: SPOT.D20, ...over });
const moveView = (over: object = {}) => nowView({ day: plannedDay, pins: MOVE_PINS, position: POSITION, main: t02(), subs: [t03()], ...over });

// ---------- 화면 나무 도구 ----------

type Host = { type: unknown; props: Record<string, any>; parent: Host | null; children: (Host | string)[]; queryAll: (pick: (host: Host) => boolean) => Host[] };
const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Host;
const chain = (host: Host): Host[] => {
  const list: Host[] = [];
  for (let now: Host | null = host; now; now = now.parent) list.push(now);
  return list;
};
const ownText = (host: Host) =>
  (Array.isArray(host.props.children) ? host.props.children : [host.props.children]).filter((part: unknown) => typeof part === 'string' || typeof part === 'number').join('');
const textHosts = (under: Host) => under.queryAll((inner) => inner.type === 'Text');
const svgsIn = (host: Host) => host.queryAll((inner) => inner.props.svgElement === 'Svg');

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

let server: FakeServer;
let rehReply: () => object;
const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;

async function toRehearsal() {
  await startHome();
  await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  await settleAll();
}

const withMap = () => {
  (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { googleMapsKeyPresent: true } };
};

type Coord = { latitude: number; longitude: number };
const key = (point: Coord) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
const asCoord = (at: { lat: number; lng: number }): Coord => ({ latitude: at.lat, longitude: at.lng });
const keysOf = (points: Coord[]) => [...new Set(points.map(key))].sort();

async function firstFit() {
  await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
  return mapControl.fits[0];
}

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  sheetControl.reset();
  (Constants as unknown as { expoConfig: unknown }).expoConfig = null;
  freezeDate(NOW_ISO);
  server = new FakeServer().on(CURRENT, json(200, trip()));
  rehReply = () => stayView();
  server.match(`GET /days/${PLANNED}/now`, () => json(200, rehReply()));
  server.match(`POST /days/${PLANNED}/check`, (sent) => json(200, { ...rehReply(), at: body(sent).at ?? '2026-12-03T10:00:00' }));
  server.on(`GET /days/${PLANNED}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// 1 연습 지도 = 지금 구간만 (TASK-014 §21 1)
// =====================================================================

describe('§21 1 연습 지도는 지금 구간만 비춘다', () => {
  test('T14_S21_1_머무는_중이면_그_장소가_가운데', async () => {
    withMap();
    await toRehearsal();
    expect(screen.queryByTestId('map-fallback')).toBeNull(); // 시험 자체 확인: 지도가 그려졌다
    const { coordinates } = await firstFit();
    const lats = coordinates.map((p) => p.latitude);
    const lngs = coordinates.map((p) => p.longitude);
    const center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const cos = Math.cos((SPOT.D20.lat * Math.PI) / 180);
    expect(Math.abs(center.lat - SPOT.D20.lat) * METERS_PER_DEGREE).toBeLessThanOrEqual(1);
    expect(Math.abs(center.lng - SPOT.D20.lng) * METERS_PER_DEGREE * cos).toBeLessThanOrEqual(1);
  });

  test('T14_S21_1_머무는_중이면_동서_폭은_약_800m_코스_전체가_아니다', async () => {
    withMap();
    await toRehearsal();
    const { coordinates } = await firstFit();
    const lngs = coordinates.map((p) => p.longitude);
    const width = (Math.max(...lngs) - Math.min(...lngs)) * METERS_PER_DEGREE * Math.cos((SPOT.D20.lat * Math.PI) / 180);
    expect(width).toBeGreaterThanOrEqual(STAY_SPAN_M * (1 - STAY_TOLERANCE));
    expect(width).toBeLessThanOrEqual(STAY_SPAN_M * (1 + STAY_TOLERANCE));
    // 다른 핀·숙소는 맞춤 좌표에 없다
    const others = [SPOT.D01, SPOT.D30, LODGING].map((at) => key(asCoord(at)));
    for (const point of coordinates) expect(others).not.toContain(key(point));
  });

  test('T14_S21_1_머무는_중_처음_맞출_때_옮기기_호출은_없다_맞춤_하나', async () => {
    withMap();
    await toRehearsal();
    await firstFit();
    await settleAll();
    expect(mapControl.fits).toHaveLength(1);
    expect(mapControl.moves).toEqual([]);
  });

  test('T14_S21_1_이동_중이면_지금_자리·출발·도착_셋만', async () => {
    rehReply = () => moveView();
    withMap();
    await toRehearsal();
    const { coordinates } = await firstFit();
    expect(keysOf(coordinates)).toEqual(keysOf([asCoord(POSITION), asCoord(SPOT.D01), asCoord(SPOT.D20)]));
  });

  test('T14_S21_1_경계_이동_중이어도_나중_장소와_숙소는_넣지_않는다', async () => {
    rehReply = () => moveView();
    withMap();
    await toRehearsal();
    const { coordinates } = await firstFit();
    const keys = coordinates.map(key);
    expect(keys).not.toContain(key(asCoord(SPOT.D30)));
    expect(keys).not.toContain(key(asCoord(LODGING)));
  });

  test.each([
    ['머무는 중', () => stayView()],
    ['이동 중', () => moveView()],
  ])('T14_S21_1_%s도_아래_여백은_440_더하기_112_이상_그대로', async (_name, reply) => {
    rehReply = reply;
    withMap();
    await toRehearsal();
    const fit = await firstFit();
    expect(Number(fit.options?.edgePadding?.bottom ?? 0)).toBeGreaterThanOrEqual(REH_SHEET + REH_CLOCK);
  });
});

describe('§21 1 경계 실제 여행(연습 아님) 카메라는 그대로', () => {
  const todayDay = { ...demoDay, day_id: TODAY, date: '2026-12-02' };

  test.each([
    ['머무는 중', STAY_PINS],
    ['이동 중', MOVE_PINS],
  ])('T14_S21_1_실제_여행_%s이면_처음엔_모든_핀과_숙소', async (_name, livePins) => {
    const view = () => nowView({ day: todayDay, at: '2026-12-02T12:00:00', pins: livePins });
    server.match(`GET /days/${TODAY}/now`, () => json(200, view()));
    server.match(`POST /days/${TODAY}/check`, () => json(200, view()));
    withMap();
    await startHome();
    await tap(await screen.findByTestId(`day-row-${TODAY}`));
    await screen.findByTestId('trip-now-screen');
    await settleAll();
    expect(screen.queryByTestId('rehearsal-band')).toBeNull(); // 시험 자체 확인: 연습이 아니다
    const { coordinates } = await firstFit();
    const keys = coordinates.map(key);
    for (const at of [SPOT.D01, SPOT.D20, SPOT.D30, LODGING]) expect(keys).toContain(key(asCoord(at)));
  });
});

// =====================================================================
// §22 Q2 구간 끝: 첫 구간 출발 = 숙소, 마지막 구간 도착 = 숙소, 연습 중 구간이 바뀌면 다시 맞춘다 (실제 여행은 B10대로 안 맞춤)
// =====================================================================

const mid = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
// 첫 구간: 숙소 -> 1번. 지난 핀 없음, 1 다음 · 2·3 나중
const FIRST_LEG_PINS = [
  { ...basePins[0], state: 'next' },
  { ...basePins[1], state: 'later' },
  { ...basePins[2], state: 'later' },
];
const FIRST_LEG_AT = mid(LODGING, SPOT.D01);
// 마지막 구간: 3번 -> 숙소. 모두 지남
const LAST_LEG_PINS = basePins.map((pin) => ({ ...pin, state: 'done' }));
const LAST_LEG_AT = mid(SPOT.D30, LODGING);

describe('§22 Q2 구간 끝은 숙소', () => {
  test('T14_S22_Q2_첫_구간이면_지금_자리·숙소(출발)·1번(도착)', async () => {
    rehReply = () => nowView({ day: plannedDay, pins: FIRST_LEG_PINS, position: FIRST_LEG_AT, main: t02(), subs: [t03()] });
    withMap();
    await toRehearsal();
    const { coordinates } = await firstFit();
    expect(keysOf(coordinates)).toEqual(keysOf([asCoord(FIRST_LEG_AT), asCoord(LODGING), asCoord(SPOT.D01)]));
  });

  test('T14_S22_Q2_마지막_구간이면_지금_자리·3번(출발)·숙소(도착)', async () => {
    rehReply = () => nowView({ day: plannedDay, pins: LAST_LEG_PINS, position: LAST_LEG_AT });
    withMap();
    await toRehearsal();
    const { coordinates } = await firstFit();
    expect(keysOf(coordinates)).toEqual(keysOf([asCoord(LAST_LEG_AT), asCoord(SPOT.D30), asCoord(LODGING)]));
  });
});

describe('§22 Q2 연습 중 구간이 바뀌면 카메라를 다시 맞춘다', () => {
  const lastFit = () => mapControl.fits[mapControl.fits.length - 1];

  test('T14_S22_Q2_머묾에서_이동으로_바뀌면_이동_구간으로_다시_맞춘다', async () => {
    withMap();
    await toRehearsal();
    await firstFit();
    const before = mapControl.fits.length;
    rehReply = () => moveView();
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(before));
    expect(keysOf(lastFit().coordinates)).toEqual(keysOf([asCoord(POSITION), asCoord(SPOT.D01), asCoord(SPOT.D20)]));
    expect(Number(lastFit().options?.edgePadding?.bottom ?? 0)).toBeGreaterThanOrEqual(REH_SHEET + REH_CLOCK); // 여백 그대로
  });

  test('T14_S22_Q2_이동에서_도착해_머물면_그_장소_가운데로_다시_맞춘다', async () => {
    rehReply = () => moveView();
    withMap();
    await toRehearsal();
    await firstFit();
    const before = mapControl.fits.length;
    rehReply = () => stayView();
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(before));
    const lngs = lastFit().coordinates.map((p) => p.longitude);
    const lats = lastFit().coordinates.map((p) => p.latitude);
    expect(Math.abs((Math.min(...lats) + Math.max(...lats)) / 2 - SPOT.D20.lat) * METERS_PER_DEGREE).toBeLessThanOrEqual(1);
    expect(Math.abs((Math.min(...lngs) + Math.max(...lngs)) / 2 - SPOT.D20.lng) * METERS_PER_DEGREE * Math.cos((SPOT.D20.lat * Math.PI) / 180)).toBeLessThanOrEqual(1);
  });

  test('T14_S22_Q2_다음_구간으로_건너뛰면_새_구간으로_다시_맞춘다', async () => {
    // 1->2 이동 중에서 시계를 건너뛰어 2->3 이동 중으로 (같은 "이동 중"이어도 구간이 다르다)
    rehReply = () => moveView();
    withMap();
    await toRehearsal();
    await firstFit();
    const before = mapControl.fits.length;
    const between = mid(SPOT.D20, SPOT.D30);
    const nextLeg = [
      { ...basePins[0], state: 'done' },
      { ...basePins[1], state: 'done' },
      { ...basePins[2], state: 'next' },
    ];
    rehReply = () => moveView({ pins: nextLeg, position: between });
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(before));
    expect(keysOf(lastFit().coordinates)).toEqual(keysOf([asCoord(between), asCoord(SPOT.D20), asCoord(SPOT.D30)]));
  });
});

describe('§22 Q2 경계 실제 여행은 구간이 바뀌어도 다시 맞추지 않는다 (TASK-006 B10)', () => {
  test('T14_S22_Q2_실제_여행_머묾에서_이동으로_바뀌어도_맞춤은_처음_한_번', async () => {
    const todayDay = { ...demoDay, day_id: TODAY, date: '2026-12-02' };
    let liveView = () => nowView({ day: todayDay, at: '2026-12-02T12:00:00', pins: STAY_PINS });
    server.match(`GET /days/${TODAY}/now`, () => json(200, liveView()));
    server.match(`POST /days/${TODAY}/check`, () => json(200, liveView()));
    locationFake.permit('granted');
    locationFake.stayAt({ lat: POSITION.lat, lng: POSITION.lng, accuracy: 10 });
    withMap();
    await startHome();
    await tap(await screen.findByTestId(`day-row-${TODAY}`));
    await screen.findByTestId('trip-now-screen');
    await firstFit();
    const before = mapControl.fits.length;
    liveView = () => nowView({ day: todayDay, at: '2026-12-02T12:01:00', pins: MOVE_PINS });
    const checksBefore = server.sent(`POST /days/${TODAY}/check`).length;
    await act(async () => {
      locationFake.emit({ lat: POSITION.lat + 0.001, lng: POSITION.lng, accuracy: 10, timestamp: Date.now() });
    });
    await settleAll();
    await waitFor(() => expect(server.sent(`POST /days/${TODAY}/check`).length).toBeGreaterThan(checksBefore)); // 시험 자체 확인: 새 응답(이동 중)을 받았다
    await settleAll();
    expect(mapControl.fits).toHaveLength(before);
  });
});

// =====================================================================
// 2 D6 날짜 숫자: 나란한 별도 Text · DM Mono 13/18 (TASK-014 §21 2)
// =====================================================================

describe('§21 2 날짜 목록 숫자와 요일은 나란한 별도 글자', () => {
  const LIST_METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
  const DATES = ['2026-12-11', '2026-12-12', '2026-12-13']; // 금 · 토 · 일
  const SUMMARY = { end_time: '18:30', place_count: 8, move_min: 125 };
  const listDay = (n: number, state: string, chosen = state !== 'planning') => ({
    day_id: `d${n}`,
    date: DATES[n - 1],
    state,
    chosen_option_id: chosen ? `opt-${n}` : null,
    fixed_events: [] as unknown[],
    summary: chosen ? SUMMARY : null,
    must_visits: [],
  });
  const listTrip = (...days: ReturnType<typeof listDay>[]) => ({
    trip_id: 'trip-osaka-1',
    city_code: 'osaka',
    start_date: DATES[0],
    end_date: DATES[2],
    lodging_place_id: null,
    status: 'active',
    trip_days: days,
  });
  const ALL_PAST = listTrip(listDay(1, 'past'), listDay(2, 'past'), listDay(3, 'past', false));
  const MIXED = listTrip(listDay(1, 'planned'), listDay(2, 'planning'), listDay(3, 'planning'));
  const AFTER = '2026-12-20T03:00:00Z';
  const BEFORE = '2026-11-06T03:00:00Z';

  async function show(value: object, at: string) {
    freezeDate(at);
    const { TripDays } = require('@/trips/trip-days');
    await render(
      <SafeAreaProvider initialMetrics={LIST_METRICS}>
        <TripDays trip={value as never} onOpen={jest.fn()} onTripChange={() => {}} onNewTrip={() => {}} />
      </SafeAreaProvider>,
    );
  }
  const mono = () => require('@/planning/theme').text('num-md').fontFamily as string;
  const isMono = (family: unknown) => typeof family === 'string' && family.startsWith(mono().split('_')[0]);
  const insideText = (host: Host) => chain(host).slice(1).some((up) => up.type === 'Text');

  /** 그 날 줄에서 날짜 숫자 Text와 요일 Text */
  function dateParts(dayId: string, digits: string, weekday: string) {
    let row = (screen.queryByTestId(`day-row-${dayId}`) ?? screen.getByTestId(`row-locked-${dayId}`)) as unknown as Host;
    while (row.parent && !textHosts(row).some((host) => ownText(host).includes(digits))) row = row.parent;
    const digitHosts = textHosts(row).filter((host) => ownText(host).includes(digits));
    const dayHosts = textHosts(row).filter((host) => ownText(host).trim() === weekday);
    return { digitHosts, dayHosts };
  }

  const CASES = [
    ['끝난 여행 지난 날 줄', ALL_PAST, AFTER, 'd1', '12/11', '금'],
    ['끝난 여행 고른 코스 없는 줄', ALL_PAST, AFTER, 'd3', '12/13', '일'],
    ['여행 전 계획 완료 줄', MIXED, BEFORE, 'd1', '12/11', '금'],
    ['여행 전 계획 전 카드', MIXED, BEFORE, 'd2', '12/12', '토'],
  ] as const;

  test.each(CASES)('T14_S21_2_%s_숫자_Text는_다른_Text_안에_있지_않다', async (_name, value, at, dayId, digits, weekday) => {
    await show(value, at);
    const { digitHosts } = dateParts(dayId, digits, weekday);
    expect(digitHosts).toHaveLength(1);
    expect(ownText(digitHosts[0]).trim()).toBe(digits); // 숫자 Text에는 숫자만
    expect(insideText(digitHosts[0])).toBe(false);
  });

  test.each(CASES)('T14_S21_2_%s_요일은_따로_된_Text_숫자와_같은_부모_아래_나란히', async (_name, value, at, dayId, digits, weekday) => {
    await show(value, at);
    const { digitHosts, dayHosts } = dateParts(dayId, digits, weekday);
    expect(dayHosts).toHaveLength(1);
    expect(insideText(dayHosts[0])).toBe(false);
    expect(dayHosts[0].parent).toBe(digitHosts[0].parent);
    expect(styleOf(digitHosts[0].parent!).flexDirection).toBe('row');
    expect(isMono(styleOf(dayHosts[0]).fontFamily)).toBe(false); // 한글 요일은 DM Mono 아님 (DESIGN-001 §4-3)
  });

  test.each(CASES)('T14_S21_2_%s_숫자는_DM_Mono_13/18', async (_name, value, at, dayId, digits, weekday) => {
    await show(value, at);
    const { digitHosts } = dateParts(dayId, digits, weekday);
    const style = styleOf(digitHosts[0]);
    expect(isMono(style.fontFamily)).toBe(true);
    expect({ size: style.fontSize, line: style.lineHeight }).toEqual({ size: 13, line: 18 });
  });
});

// =====================================================================
// 3 [+10분] = 아이콘 + "10분" (TASK-014 §21 3, task-014-design §9-2)
// =====================================================================

describe('§21 3 연습 시계 [10분] 버튼', () => {
  test('T14_S21_3_보이는_글자는_10분', async () => {
    await toRehearsal();
    expect(within(screen.getByTestId('demo-plus-10')).getByText('10분')).toBeTruthy();
  });

  test('T14_S21_3_버튼_안_글자에_+가_없다_+는_아이콘_하나뿐', async () => {
    await toRehearsal();
    const button = byId('demo-plus-10');
    const texts = textHosts(button).map(ownText);
    expect(texts.length).toBeGreaterThan(0);
    for (const value of texts) expect(value).not.toContain('+');
    expect(svgsIn(button)).toHaveLength(1);
  });

  test('T14_S21_3_화면_읽기_이름은_10분을_담고_+가_없다', async () => {
    await toRehearsal();
    const label = byId('demo-plus-10').props.accessibilityLabel;
    expect(typeof label).toBe('string');
    expect(label).toContain('10분');
    expect(label.startsWith('+')).toBe(false);
    expect(label).not.toContain('+');
  });

  test('T14_S22_Q3_화면_읽기_이름은_정확히_10분_앞으로', async () => {
    await toRehearsal();
    expect(byId('demo-plus-10').props.accessibilityLabel).toBe('10분 앞으로'); // TASK-014 §22 Q3
  });

  test('T14_S21_3_경계_누르면_여전히_10분_뒤로', async () => {
    await toRehearsal();
    const before = server.requests.filter((r) => r.method === 'POST' && r.path === `/days/${PLANNED}/check`).length;
    const shown = () => ownText(byId('demo-time').queryAll((inner) => inner.type === 'Text')[0]);
    const first = shown();
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(shown()).not.toBe(first));
    const [h, m] = first.split(':').map(Number);
    const next = h * 60 + m + 10;
    expect(shown()).toBe(`${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`);
    await waitFor(() => expect(server.requests.filter((r) => r.method === 'POST' && r.path === `/days/${PLANNED}/check`).length).toBeGreaterThan(before));
  });
});
