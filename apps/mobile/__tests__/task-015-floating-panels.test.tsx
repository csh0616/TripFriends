/// <reference types="jest" />
// TASK-015 §17 떠 있는 판을 핀 겹침 함수에 넘긴다 (화면 테스트, 가짜 지도). 로직·가드레일만 본다.
// 근거: TASK-015 §17 "frontend가 문서 없이 정한 것" 표("떠 있는 판을 겹침 함수에 안 넘김(빈 목록)" -> 고친다:
//       화면에 실제로 떠 있는 판(연습 시계 판 · 아래 시트 · 위 버튼 줄)의 사각형을 넘긴다) ·
//       task-014-design §11-3 "이름표 자리"(다른 핀 · 내 위치 점 · 떠 있는 판과 겹치면 다음 후보) · TASK-015 §12 Q5·§13 Q1(떠 있는 판 여유 0, 맞닿음도 겹침) ·
//       세로 값: task-014-design §11-1(앱 844: 띠 99 = 안전 영역 47 + 52, 떠 있는 줄 48) · §12-1(연습 시트 기본 윗변 546, 시계 판 윗변 = 시트 윗변 − 120, 시계 판 112)
//
// 계약 (이 테스트가 정한 것):
//   화면은 '@/lib/pin-overlap'의 resolvePinOverlap을 부를 때 input.panels에 떠 있는 판의 사각형(지도 화면 좌표 pt, 왼쪽 위 0,0 = 화면 맨 위)을 넣는다
//   시험은 판의 사각형을 하나하나 맞추지 않고 "이 점이 어느 판 안에 드는가"로 본다 (판을 몇 개로 나눠 넘기든 상관없다):
//     위 버튼 줄: 실제 여행·데모 = 안전 영역 아래 48줄(47 ~ 95), 연습 = 연습 띠 아래 48줄(99 ~ 147). 왼쪽(프로필)·오른쪽(SOS) 자리가 판 안
//     아래 시트: 시트 영역 높이 − 기본 단 높이(snapPoints[1]) ~ 시트 영역 바닥
//     연습 시계 판: 시트 윗변 − 120 ~ 그 + 112 (연습 중만)
//   판 밖이어야 하는 점: 위 버튼 줄과 시계 판(실제 여행이면 시트) 사이 지도 띠 가운데 — 화면 전체를 판 하나로 넘기면 이름표가 늘 빠진다
//   지도 영역은 가짜 지도에 onRegionChangeComplete로 넣는다(가짜 지도는 경계를 주지 않는다). 시트 영역 높이는 onLayout으로 넣는다(TASK-014 §19 시험과 같은 방식)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolvePinOverlap, type PinOverlapInput, type Rect } from '@/lib/pin-overlap';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json, type Sent } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay, relaxed } from '../test-support/planning-fixtures';
import { installConfig, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { delayedView, nowView, pins as basePins } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

// 진짜 함수를 그대로 쓰되 받은 입력을 기록한다
jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

const WIDTH = 390;
const HEIGHT = 844;
const INSET_TOP = 47;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, insets: { top: INSET_TOP, left: 0, right: 0, bottom: 34 } };
const BAND = 52; // reh-band 내용 높이 (DESIGN-001 §4-13) -> 띠 99
const ROW = 48; // 떠 있는 줄 (task-014-design §11-1)
const CLOCK_ABOVE_SHEET = 120; // 시계 판 윗변 = 시트 윗변 − 120 (§12-1)
const CLOCK = 112; // reh-clock 높이
const LEFT_X = 30; // 프로필 자리
const RIGHT_X = WIDTH - 30; // SOS 자리
const MID_X = WIDTH / 2;

const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 12:00 (day-t2가 오늘)
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
const root = () => screen.root as unknown as Host;
const byId = (id: string) => screen.getByTestId(id) as unknown as Host;

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
  lodging: null,
  status: 'active',
  is_demo: false,
  trip_days: ['past', 'today', 'planned', 'planning'].map((state, index) => tripDay(index + 1, state)),
});
const plannedDay = { ...demoDay, day_id: PLANNED, date: PLANNED_DATE };
const rehearsalView = (over: object = {}) => nowView({ day: plannedDay, ...over });
const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;

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

const snapPx = (point: unknown, area: number) => {
  if (typeof point === 'number') return point <= 1 ? point * area : point;
  const text = String(point);
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * area : Number(text);
};

/** 핀이 다 들어오는 지도 영역 (가짜 지도는 스스로 알려 주지 않는다) */
function regionAround(points: { lat: number; lng: number }[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 3 + 0.01,
    longitudeDelta: (Math.max(...lngs) - Math.min(...lngs)) * 3 + 0.01,
  };
}

/** 시트 영역 높이를 알리고, 지도 영역을 알려 겹침 계산이 돌게 한다. 시트 영역 높이를 돌려준다 */
async function layoutAndRegion(): Promise<number> {
  const area = HEIGHT - 120; // 입력창 자리를 뺀 시트 영역 (값은 아무 것이나 된다 — 아래 점들은 이 값에서 다시 계산한다)
  const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
  expect(host).toBeDefined();
  await act(async () => {
    fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: area } } });
  });
  const map = root().queryAll((inner) => inner.props.mapElement === 'MapView')[0];
  expect(map).toBeDefined(); // 시험 자체 확인: 대체 그림이 아니라 지도
  await act(async () => {
    fireEvent(map as never, 'regionChangeComplete', regionAround(basePins));
  });
  await settleAll();
  return area;
}

/** 마지막으로 받은 판 목록 */
function lastPanels(): Rect[] {
  expect(overlap).toHaveBeenCalled();
  const input = overlap.mock.calls[overlap.mock.calls.length - 1][0] as PinOverlapInput;
  return input.panels ?? [];
}

const covers = (panels: Rect[], x: number, y: number) => panels.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);

function sheetTopOf(area: number): number {
  const points = sheetControl.props?.snapPoints as unknown[];
  expect(points.length).toBeGreaterThanOrEqual(2);
  return area - snapPx(points[1], area);
}

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  sheetControl.reset();
  overlap.mockClear();
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: WIDTH, height: HEIGHT }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- 연습: 위 버튼 줄 · 시계 판 · 아래 시트 ----------

describe('§17 연습 화면은 떠 있는 판 셋을 겹침 함수에 넘긴다', () => {
  let server: FakeServer;

  async function toRehearsal(viewOf: (over?: object) => object = rehearsalView) {
    (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { googleMapsKeyPresent: true } };
    freezeDate(NOW_ISO);
    server = new FakeServer().on(CURRENT, json(200, trip()));
    server.match(`GET /days/${PLANNED}/now`, () => json(200, viewOf()));
    server.match(`POST /days/${PLANNED}/check`, (sent) => json(200, viewOf({ at: body(sent).at })));
    server.on(`GET /days/${PLANNED}/course`, json(200, relaxed('opt-3')));
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
    await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
    await screen.findByTestId('trip-now-screen');
    await screen.findByTestId('now-main');
    await settleAll();
  }

  test('T15_S17_연습_판_목록이_비어_있지_않다', async () => {
    await toRehearsal();
    await layoutAndRegion();
    expect(lastPanels().length).toBeGreaterThan(0);
  });

  test('T15_S17_연습_위_버튼_줄(띠_아래_48)이_판_안', async () => {
    await toRehearsal();
    await layoutAndRegion();
    const panels = lastPanels();
    const rowMid = INSET_TOP + BAND + ROW / 2; // 123
    expect(covers(panels, LEFT_X, rowMid)).toBe(true);
    expect(covers(panels, RIGHT_X, rowMid)).toBe(true);
  });

  test('T15_S17_연습_시계_판(시트_윗변_−_120부터_112)이_판_안', async () => {
    await toRehearsal();
    const area = await layoutAndRegion();
    const clockTop = sheetTopOf(area) - CLOCK_ABOVE_SHEET;
    const panels = lastPanels();
    expect(covers(panels, MID_X, clockTop + CLOCK / 2)).toBe(true);
    expect(covers(panels, MID_X, clockTop + 2)).toBe(true);
    expect(covers(panels, MID_X, clockTop + CLOCK - 2)).toBe(true);
  });

  test('T15_S17_연습_아래_시트(기본_단_윗변부터_바닥까지)가_판_안', async () => {
    await toRehearsal();
    const area = await layoutAndRegion();
    const top = sheetTopOf(area);
    const panels = lastPanels();
    expect(covers(panels, MID_X, top + 2)).toBe(true);
    expect(covers(panels, MID_X, area - 2)).toBe(true);
  });

  test('T15_S17_연습_경계_위_줄과_시계_판_사이_지도_띠_가운데는_판_밖', async () => {
    await toRehearsal();
    const area = await layoutAndRegion();
    const stripTop = INSET_TOP + BAND + ROW; // 147
    const stripBottom = sheetTopOf(area) - CLOCK_ABOVE_SHEET;
    expect(stripBottom - stripTop).toBeGreaterThan(40); // 시험 자체 확인: 띠가 있다
    expect(covers(lastPanels(), MID_X, (stripTop + stripBottom) / 2)).toBe(false);
  });
  // ---------- §18 Q3 notice-info도 떠 있는 판 ----------
  // 근거: TASK-015 §18 test-writer 남은 질문 표 3("notice-info도 떠 있는 판? -> 예 — 지도 위에 그려지는 것은 모두") · §B3(notice-info는 떠 있는 줄 아래 8)
  // 계약: 연습 중 안내 한 줄(notice-info, "연습이라 저장하지 않았어")이 보이는 동안 그 사각형이 판 안. 자리는 그려진 notice-info의 style top · height로 잰다
  test('T15_S18_Q3_연습_안내_한_줄_notice_info가_보이는_동안_판_안', async () => {
    await toRehearsal((over = {}) => delayedView({ day: plannedDay, ...over }));
    await tap(await screen.findByTestId('event-dismiss'));
    const notice = await screen.findByTestId('notice-info');
    await layoutAndRegion();
    const style = require('react-native').StyleSheet.flatten((notice as unknown as Host).props.style) as Record<string, number>;
    expect(typeof style.top).toBe('number'); // 시험 자체 확인: 위에서 잰 자리
    const height = typeof style.height === 'number' ? style.height : 44;
    const panels = lastPanels();
    expect(covers(panels, MID_X, style.top + height / 2)).toBe(true);
    expect(covers(panels, MID_X, style.top + 2)).toBe(true);
    expect(covers(panels, MID_X, style.top + height - 2)).toBe(true);
  });
});

// ---------- 데모 여행 중 화면: 위 버튼 줄 · 아래 시트 (시계 판은 접혀 있다) ----------

describe('§17 여행 중 화면은 위 버튼 줄과 아래 시트를 겹침 함수에 넘긴다', () => {
  async function toTripNow() {
    installConfig(TEST_KEY);
    await toNow();
  }

  test('T15_S17_여행_중_위_버튼_줄(안전_영역_아래_48)이_판_안', async () => {
    await toTripNow();
    await layoutAndRegion();
    const panels = lastPanels();
    const rowMid = INSET_TOP + ROW / 2; // 71
    expect(covers(panels, LEFT_X, rowMid)).toBe(true);
    expect(covers(panels, RIGHT_X, rowMid)).toBe(true);
  });

  test('T15_S17_여행_중_아래_시트가_판_안', async () => {
    await toTripNow();
    const area = await layoutAndRegion();
    const top = sheetTopOf(area);
    const panels = lastPanels();
    expect(covers(panels, MID_X, top + 2)).toBe(true);
    expect(covers(panels, MID_X, area - 2)).toBe(true);
  });

  test('T15_S17_여행_중_경계_위_줄과_시트_사이_지도_가운데는_판_밖', async () => {
    await toTripNow();
    const area = await layoutAndRegion();
    const stripTop = INSET_TOP + ROW; // 95
    const stripBottom = sheetTopOf(area);
    expect(stripBottom - stripTop).toBeGreaterThan(40);
    expect(covers(lastPanels(), MID_X, (stripTop + stripBottom) / 2)).toBe(false);
  });
});
