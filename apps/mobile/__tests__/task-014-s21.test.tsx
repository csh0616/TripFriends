/// <reference types="jest" />
// TASK-014 §21 reviewer 점검 답 (11-15, 고칠 것 3건) — 1 연습 지도 "지금 구간"만 · 2 D6 날짜 숫자 DM Mono 13/18 나란한 별도 글자 · 3 [+10분] 아이콘 + "10분".
// 근거: TASK-014 §21 표 1~3, task-014-design §2 reh-clock·§9-1·§9-2, DESIGN-001 §4-13. 4(Maestro account-link 초기화)는 task-014-s21-account-reset.test.ts.
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   연습 카메라 = MapAdapter.fit 한 번(fitToCoordinates + edgePadding). 처음 맞출 때 animateToRegion·animateCamera(옮기기)는 없다
//     머무는 중(핀 중 state "now"가 있음): 맞춤 좌표의 상자 가운데 = 그 장소(1m 안), 상자 동서 폭 = 800m ± 5% (§21 "가설: 화면에 약 800m")
//     이동 중(state "now"가 없고 "next"가 있음): 맞춤 좌표 = { 지금 자리(reh-dot), 출발(마지막 done 핀), 도착(next 핀) } 정확히 이 셋
//   §29 ②·§33: reh-dot = 앱이 연습 시계·화면 응답의 pins·day.lodging으로 바로 계산한 자리(fake-position). 서버 응답 position은 쓰지 않는다
//     -> 응답 position은 일부러 엉뚱한 곳(SERVER_POSITION)으로 두고, 핀 시각을 잡아 시계 10:00(응답 day.start, §10 Q13)·10:10·10:20에 점이 원하는 자리에 오게 한다
//     장소 사이 점 = 출발 시각(다음 시작 − 이동 시간)까지 제자리, 그 뒤 이동 시간 동안 직선 이동 (§29 ③)
//     둘 다 아래 여백 >= 연습 시트 440 + 시계 판 112 (§19 하한 그대로)
//   실제 여행(연습 아님) 카메라는 그대로: 처음 맞출 때 모든 핀 + 숙소 (TASK-006 B10)
//   D6 날짜: 숫자 Text("12/11")와 요일 Text("금")가 같은 부모 아래 나란한 별도 Text. 숫자 Text는 다른 Text 안에 없다. 숫자 = DM Mono 13/18
//   [+10분] `demo-plus-10`: 보이는 글자는 "10분" 하나(버튼 안 글자에 "+" 없음, + 는 아이콘 하나), accessibilityLabel은 "10분"을 포함하고 "+"가 없다
//   테스트로 못 고정하는 것 (reviewer 스크린샷): DM Mono가 실제로 그려지는지 · 800m가 화면에서 어떻게 보이는지 · 경로·점이 시계 판에 가리지 않는지
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { FakeServer, json, type Sent } from '../test-support/fake-server';
import { locationFake } from '../test-support/expo-location-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay, SPOT } from '../test-support/planning-fixtures';
import { nowView, pins as basePins, POSITION, t02, t03, t08 } from '../test-support/trip-now-fixtures';

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
  lodging: null, // TASK-015 §11 Q10 응답 새 모양 (이전: lodging_place_id: null)
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

// ---------- §29 ②·§33: 앱 점이 원하는 자리에 오도록 핀 시각을 잡는다 ----------
const CLOCK_START = 10 * 60; // 연습 시계 시작 = 응답 day.start 10:00 (§10 Q13). [10분] 한 번 = 10:10, 두 번 = 10:20
const SERVER_POSITION = { lat: 35.05, lng: 135.05 }; // 서버 응답 position: 앱이 쓰면 안 되는 엉뚱한 자리 (§29 ②)
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
type Pin = (typeof basePins)[number];
/** 핀 셋의 [시작, 끝, 이동 분] (분) */
const timed = (pins: Pin[], times: [number, number, number][]) =>
  pins.map((pin, i) => ({ ...pin, start: hm(times[i][0]), end: hm(times[i][1]), travel_min: times[i][2] }));
const along = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, ratio: number) => ({
  lat: a.lat + (b.lat - a.lat) * ratio,
  lng: a.lng + (b.lng - a.lng) * ratio,
});
// 머묾: 10:00·10:10 모두 2번(D20, 09:20~11:00) 안
const STAY_TIMES: [number, number, number][] = [[480, 540, 12], [560, 660, 20], [690, 960, 30]];
// 이동: 1번 끝 09:20 = 출발(2번 시작 10:40 − 이동 80분). 10:00 = 절반(POSITION), 10:10 = 50/80, 10:20 = 60/80
const MOVE_DEPART = 560;
const MOVE_TRAVEL = 80;
const MOVE_TIMES: [number, number, number][] = [[480, MOVE_DEPART, 12], [MOVE_DEPART + MOVE_TRAVEL, 720, MOVE_TRAVEL], [750, 960, 30]];
const moveDotAt = (clock: number) => along(SPOT.D01, SPOT.D20, (clock - MOVE_DEPART) / MOVE_TRAVEL);

const plannedDay = { ...demoDay, day_id: PLANNED, date: '2026-12-03' };
const stayView = (over: object = {}) => nowView({ day: plannedDay, pins: timed(STAY_PINS, STAY_TIMES), position: SERVER_POSITION, ...over });
const moveView = (over: object = {}) =>
  nowView({ day: plannedDay, pins: timed(MOVE_PINS, MOVE_TIMES), position: SERVER_POSITION, main: t02(), subs: [t03()], ...over });

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

function startHome(metrics: typeof METRICS = METRICS) {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
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

const mid = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
// 첫 구간: 숙소 -> 1번. 지난 핀 없음, 1 다음 · 2·3 나중. 1번 10:10 시작 − 이동 20분 = 09:50 출발 -> 10:00 = 절반
const FIRST_LEG_PINS = timed(
  [
    { ...basePins[0], state: 'next' },
    { ...basePins[1], state: 'later' },
    { ...basePins[2], state: 'later' },
  ],
  [[610, 720, 20], [740, 840, 20], [870, 1140, 30]],
);
const FIRST_LEG_AT = mid(LODGING, SPOT.D01);
// 마지막 구간: 3번 -> 숙소. 모두 지남. 3번 끝 09:50, 숙소까지 20분(T-08 go_home_min) -> 10:00 = 절반
const LAST_LEG_PINS = timed(
  basePins.map((pin) => ({ ...pin, state: 'done' })),
  [[420, 480, 12], [500, 540, 20], [560, 590, 20]],
);
const LAST_LEG_AT = mid(SPOT.D30, LODGING);
// 다음 이동 구간(2번 -> 3번): 2번 끝 10:00 = 출발(3번 10:20 − 20분) -> 10:10 = 절반
const NEXT_LEG_TIMES: [number, number, number][] = [[420, 480, 12], [500, 600, 20], [620, 960, 20]];

// =====================================================================
// 1 연습 지도 = 지금 구간만 (TASK-014 §21 1) -> §24: fit 대신 우리가 계산한 영역(animateToRegion)
// 화면 테스트는 보드 402×874(안전 영역 위 62)에서 시트 영역 높이를 넣고, 보이는 띠를 기존 layout 값으로 따로 계산해 본다:
//   위 = 안전 영역 + 연습 띠(rehBand 52) + 머리(header 52) + 말풍선(pinBubble 24)
//   아래 = 연습 카드 시트 중간 단 윗변 − (시계 판 rehClock 112 + 시계 판과 시트 사이 space-3 12)
// 지도 view = 시트 영역 상자 전체 (폭 402, 높이 = 그 상자 onLayout 높이)
// =====================================================================

type Box = { width: number; height: number; top: number; bottom: number };
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const BOARD = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const MOVE_CAP_M = 3000; // §24 이동 중 동서 상한

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function project(region: Region, box: Box, at: { lat: number; lng: number }) {
  const x = box.width / 2 + ((at.lng - region.longitude) / region.longitudeDelta) * box.width;
  const top = mercY(region.latitude + region.latitudeDelta / 2);
  const bottom = mercY(region.latitude - region.latitudeDelta / 2);
  return { x, y: ((top - mercY(at.lat)) / (top - bottom)) * box.height };
}
const spanEW = (region: Region) => region.longitudeDelta * METERS_PER_DEGREE * Math.cos((region.latitude * Math.PI) / 180);
const nearRatio = (value: number, target: number) => value >= target * (1 - STAY_TOLERANCE) && value <= target * (1 + STAY_TOLERANCE);
const PIN_INSET = 30; // §26: 핀 반지름 22 + 여백 8. 화면은 띠 전체를 넘기고 함수가 안에서 줄인다
/** 줄어든 띠 [top + 30, bottom − 30] 안인가 (§26) */
const inBand = (y: number, box: Box) => y >= box.top + PIN_INSET - 0.5 && y <= box.bottom - PIN_INSET + 0.5;
const eastOf = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat, lng: from.lng + m / (METERS_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180)) });
// 3km 미만 짧은 구간: 1번(D01) -> 동쪽 500m·북쪽 150m의 2번. 150m는 띠 전체(120)엔 800m 폭으로 들어가지만 줄어든 띠(60)엔 안 들어가 약 1km가 된다
const SHORT_TO = { lat: SPOT.D01.lat + 150 / METERS_PER_DEGREE, lng: eastOf(SPOT.D01, 500).lng };
/** 짧은 구간 1 -> 2. depart = 1번 끝(= 출발), 이동 20분 */
const shortView = (depart: number) =>
  moveView({
    pins: timed(
      [
        { ...basePins[0], state: 'done' },
        { ...basePins[1], lat: SHORT_TO.lat, lng: SHORT_TO.lng, state: 'next' },
        { ...basePins[2], state: 'later' },
      ],
      [[480, depart, 12], [depart + 20, 720, 20], [750, 960, 30]],
    ),
  });
// TASK-015 §17 B3: 연습 시트 기본 윗변이 내려가(844 546 · 874 약 563) 보이는 띠가 높아졌다 -> D01 -> D20(남북 1.1km)은 띠에 넣어도 3km 상한에 안 걸린다(약 2.6km).
// 3km로 묶이는 구간이 필요한 시험(아래 두 개)은 D01에서 정북 3.9km(위도 +0.035)의 긴 구간을 쓴다. 시각(MOVE_TIMES)은 그대로.
// 3km 폭(402pt)이면 10:10 점(50/80)은 띠 가운데에서 약 65pt 위 = 줄어든 띠 안, 10:20 점(60/80)은 약 130pt 위 = 줄어든 띠 위로 벗어남
const LONG_TO = { lat: SPOT.D01.lat + 0.035, lng: SPOT.D01.lng };
const LONG_POSITION = along(SPOT.D01, LONG_TO, 0.5); // 10:00 앱 점 (절반, 이전 POSITION 자리)
const longDotAt = (clock: number) => along(SPOT.D01, LONG_TO, (clock - MOVE_DEPART) / MOVE_TRAVEL);
const longMoveView = () => moveView({ pins: timed([MOVE_PINS[0], { ...MOVE_PINS[1], lat: LONG_TO.lat, lng: LONG_TO.lng }, MOVE_PINS[2]], MOVE_TIMES) });
const snapPx = (point: unknown, area: number) => {
  if (typeof point === 'number') return point <= 1 ? point * area : point;
  const text = String(point);
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * area : Number(text);
};

/** 보드 화면에서 연습에 들어가 시트 영역 높이를 넣은 뒤 지도 준비 신호를 준다. 따로 계산한 보이는 띠를 돌려준다 */
async function toRehearsalOnBoard(): Promise<Box> {
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: 402, height: 874 }));
  mapControl.silent = true; // 띠를 넣기 전에 카메라를 맞추지 않게
  withMap();
  await startHome(BOARD);
  await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
  await screen.findByTestId('now-main');
  await settleAll();
  const bar = byId('input-bar');
  const field = bar.queryAll((inner) => typeof styleOf(inner).minHeight === 'number')[0];
  const area = 874 - (Number(styleOf(bar).paddingTop ?? 0) + Number(styleOf(field).minHeight) + Number(styleOf(bar).paddingBottom ?? 0));
  const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
  await act(async () => {
    fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 402, height: area } } });
  });
  const points = sheetControl.props?.snapPoints as unknown[];
  const sheetTop = area - snapPx(points[1], area);
  const { layout } = require('@/planning/layout');
  const { space } = require('@/planning/theme');
  await act(async () => mapControl.ready());
  await settleAll();
  return {
    width: 402,
    height: area,
    top: BOARD.insets.top + layout.rehBand + layout.header + layout.pinBubble,
    bottom: sheetTop - (layout.rehClock + space['space-3']),
  };
}

const lastRegion = (): Region => {
  expect(mapControl.regions.length).toBeGreaterThan(0);
  return mapControl.regions[mapControl.regions.length - 1];
};
/** 같은 영역인가: 가운데 1m 안, 폭 1% 안 */
function sameRegion(a: Region, b: Region) {
  const cos = Math.cos((a.latitude * Math.PI) / 180);
  expect(Math.abs(a.latitude - b.latitude) * METERS_PER_DEGREE).toBeLessThanOrEqual(1);
  expect(Math.abs(a.longitude - b.longitude) * METERS_PER_DEGREE * cos).toBeLessThanOrEqual(1);
  expect(Math.abs(a.longitudeDelta / b.longitudeDelta - 1)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(a.latitudeDelta / b.latitudeDelta - 1)).toBeLessThanOrEqual(0.01);
}
/** 기대 영역: 응답 핀 + 이 테스트가 정한 앱 점(dot). 서버 position이 아니다 (§29 ②) */
const expected = (view: { pins: unknown[] }, dot: { lat: number; lng: number }, box: Box): Region =>
  require('@/now/rehearsal-camera').rehearsalCamera(view.pins, dot, LODGING, box).region;

describe('§21 1·§24 연습 지도 카메라 (화면)', () => {
  test('T14_S24_화면_연습_카메라는_fit이_아니라_계산한_영역_하나', async () => {
    await toRehearsalOnBoard();
    expect(screen.queryByTestId('map-fallback')).toBeNull(); // 시험 자체 확인: 지도가 그려졌다
    expect(mapControl.fits).toEqual([]);
    expect(mapControl.regions).toHaveLength(1);
  });

  test('T14_S24_S25_화면_머무는_중_동서_800m·그_장소가_보이는_띠_가운데', async () => {
    const box = await toRehearsalOnBoard();
    expect(box.bottom).toBeGreaterThan(box.top); // 시험 자체 확인: 띠가 있다
    const region = lastRegion();
    expect(nearRatio(spanEW(region), STAY_SPAN_M)).toBe(true);
    const { x, y } = project(region, box, SPOT.D20);
    expect(Math.abs(y - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(1); // §25 Q2 띠 가운데 (±1pt)
    expect(Math.abs(x - box.width / 2)).toBeLessThanOrEqual(1);
  });

  test('T14_S24_S25_화면_이동_중_3km로_묶고_reh_dot이_보이는_띠_가운데', async () => {
    // 긴 구간(LONG_TO, 정북 3.9km): 띠 높이에 넣으면 3km를 넘는다 (TASK-015 §17: 이전 D01 -> D20은 새 띠에서 약 2.6km)
    rehReply = () => longMoveView();
    const box = await toRehearsalOnBoard();
    const region = lastRegion();
    expect(spanEW(region)).toBeLessThanOrEqual(MOVE_CAP_M * (1 + STAY_TOLERANCE));
    expect(spanEW(region)).toBeGreaterThanOrEqual(MOVE_CAP_M * (1 - STAY_TOLERANCE)); // 묶였다
    const { x, y } = project(region, box, LONG_POSITION);
    expect(Math.abs(y - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(1); // §25 Q2 띠 가운데 (±1pt)
    expect(Math.abs(x - box.width / 2)).toBeLessThanOrEqual(1);
  });

  test.each([
    ['머무는 중', () => stayView(), SPOT.D20],
    ['이동 중', () => moveView(), POSITION],
    ['첫 구간', () => nowView({ day: plannedDay, pins: FIRST_LEG_PINS, position: SERVER_POSITION, main: t02(), subs: [t03()] }), FIRST_LEG_AT],
    ['마지막 구간', () => nowView({ day: plannedDay, pins: LAST_LEG_PINS, position: SERVER_POSITION, subs: [t08({ go_home_min: 20 })] }), LAST_LEG_AT],
  ])('T14_S24_화면_%s_영역은_보이는_띠로_계산한_rehearsalCamera와_같다', async (_name, reply, dot) => {
    rehReply = reply;
    const box = await toRehearsalOnBoard();
    sameRegion(lastRegion(), expected(reply() as never, dot, box));
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

describe('§22 Q2·§24 연습 중 구간이 바뀌면 카메라를 다시 계산한다', () => {
  // §29 ①: [10분]을 누르면 점은 바로(화면의 이전 응답으로) 움직이고, 새 응답이 오면 다시 계산한다 -> 새 응답이 화면에 온 뒤를 본다
  async function jump(next: () => object) {
    const before = mapControl.regions.length;
    const checks = () => server.sent(`POST /days/${PLANNED}/check`).length;
    const sentBefore = checks();
    rehReply = next;
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(checks()).toBeGreaterThan(sentBefore)); // 시험 자체 확인: 새 응답을 받았다
    await settleAll();
    expect(mapControl.regions.length).toBeGreaterThan(before);
  }

  test('T14_S22_S24_머묾에서_이동으로_바뀌면_이동_구간으로_다시_계산', async () => {
    const box = await toRehearsalOnBoard();
    await jump(() => moveView());
    sameRegion(lastRegion(), expected(moveView() as never, moveDotAt(CLOCK_START + 10), box));
  });

  test('T14_S22_S24_이동에서_도착해_머물면_그_장소로_다시_계산', async () => {
    rehReply = () => moveView();
    const box = await toRehearsalOnBoard();
    await jump(() => stayView());
    const region = lastRegion();
    expect(nearRatio(spanEW(region), STAY_SPAN_M)).toBe(true);
    expect(Math.abs(project(region, box, SPOT.D20).y - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(1); // §25 Q2
  });

  test('T14_S22_S24_다음_이동_구간으로_건너뛰면_새_구간으로_다시_계산', async () => {
    rehReply = () => moveView();
    const box = await toRehearsalOnBoard();
    const between = mid(SPOT.D20, SPOT.D30); // 10:10의 앱 점 (NEXT_LEG_TIMES)
    const nextLeg = timed(
      [
        { ...basePins[0], state: 'done' },
        { ...basePins[1], state: 'done' },
        { ...basePins[2], state: 'next' },
      ],
      NEXT_LEG_TIMES,
    );
    const next = () => moveView({ pins: nextLeg });
    await jump(next);
    sameRegion(lastRegion(), expected(next() as never, between, box));
  });

  test('T14_S23_S24_S26_3km_미만_같은_구간에서_시각만_바뀌면_카메라는_그대로', async () => {
    // §26: 묶인 구간은 벗어날 때 다시 맞추므로, 이 경계는 3km 미만 구간으로 본다
    rehReply = () => shortView(CLOCK_START - 5); // 10:00 = 1/4, 10:10 = 3/4 (같은 응답, 시계만 바뀐다)
    await toRehearsalOnBoard();
    const before = mapControl.regions.length;
    expect(before).toBe(1); // 처음 한 번은 계산했다
    expect(spanEW(lastRegion())).toBeLessThan(MOVE_CAP_M); // 시험 자체 확인: 묶이지 않았다
    const checks = () => server.sent(`POST /days/${PLANNED}/check`).length;
    const sentBefore = checks();
    rehReply = () => shortView(CLOCK_START - 5); // 같은 1 -> 2 구간, 지금 자리만 앞으로
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(checks()).toBeGreaterThan(sentBefore)); // 시험 자체 확인: 새 응답을 받았다
    await settleAll();
    expect(mapControl.regions).toHaveLength(before);
  });
});

describe('§26 연습 카메라 (화면)', () => {
  const checks = () => server.sent(`POST /days/${PLANNED}/check`).length;
  async function plus(next: () => object) {
    const sentBefore = checks();
    rehReply = next;
    await tap(screen.getByTestId('demo-plus-10'));
    await waitFor(() => expect(checks()).toBeGreaterThan(sentBefore)); // 시험 자체 확인: 새 응답을 받았다
    await settleAll();
  }

  test('T14_S26_1_화면_묶인_구간은_reh_dot이_줄어든_띠_안이면_그대로_벗어나면_한_번', async () => {
    rehReply = () => longMoveView(); // 긴 구간(TASK-015 §17, 이전 D01 -> D20): 보드 띠에서 3km로 묶인다. 같은 응답, 시계만 간다
    const box = await toRehearsalOnBoard();
    const first = lastRegion();
    expect(spanEW(first)).toBeGreaterThanOrEqual(MOVE_CAP_M * (1 - STAY_TOLERANCE)); // 시험 자체 확인: 묶였다
    expect(mapControl.regions).toHaveLength(1);
    const inside = longDotAt(CLOCK_START + 10); // 10:10 앱 점 (북쪽으로 50/80)
    const outside = longDotAt(CLOCK_START + 20); // 10:20 앱 점 (60/80)
    expect(inBand(project(first, box, inside).y, box)).toBe(true); // 시험 자체 확인: 10:10 점은 줄어든 띠 안
    expect(project(first, box, outside).y).toBeLessThan(box.top + PIN_INSET); // 시험 자체 확인: 10:20 점은 줄어든 띠 위로 벗어남
    await plus(() => longMoveView());
    expect(mapControl.regions).toHaveLength(1); // 벗어나기 전엔 그대로
    await plus(() => longMoveView());
    expect(mapControl.regions).toHaveLength(2); // 벗어나는 순간 한 번
    const { x, y } = project(lastRegion(), box, outside);
    expect(Math.abs(y - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(x - box.width / 2)).toBeLessThanOrEqual(1);
  });

  test('T14_S26_2_화면_짧은_구간은_세_곳이_줄어든_띠_안_핀_전체가_보인다', async () => {
    const dot = mid(SPOT.D01, SHORT_TO); // 10:00 앱 점: 09:50 출발, 20분 중 10분
    rehReply = () => shortView(CLOCK_START - 10);
    const box = await toRehearsalOnBoard();
    const region = lastRegion();
    for (const at of [SPOT.D01, dot, SHORT_TO]) expect(inBand(project(region, box, at).y, box)).toBe(true);
  });

  test('T14_S26_3_지도_높이를_모르면_카메라를_계산하지_않고_높이를_안_뒤_한_번', async () => {
    const window = Dimensions.get('window');
    jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: 402, height: 874 }));
    withMap();
    await startHome(BOARD);
    await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
    await screen.findByTestId('now-main');
    await settleAll();
    await act(async () => mapControl.ready()); // 지도는 준비됐지만 시트 영역 높이(onLayout)는 아직
    await settleAll();
    expect(mapControl.regions).toEqual([]);
    expect(mapControl.fits).toEqual([]);
    const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
    await act(async () => {
      fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 800 } } });
    });
    await settleAll();
    expect(mapControl.regions).toHaveLength(1);
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
    lodging: null, // TASK-015 §11 Q10 응답 새 모양 (이전: lodging_place_id: null)
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
