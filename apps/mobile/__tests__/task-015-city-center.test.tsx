/// <reference types="jest" />
// TASK-015 §E ③ 지도 시작 가운데 = 여행 도시의 중심 (앱). 로직만 본다 (지도 모습은 보지 않는다).
// 근거: TASK-015 §E ③("지도 시작 가운데 = 여행 도시의 중심(빈 코스 날 일본 전체 대신 오사카). 응답에 city.center 추가") ·
//       TASK-014 §33("숙소 -> 첫 핀 -> (없으면) 일본 가운데 대신 여행 도시의 중심") · TASK-014 §29 ④(숙소 없으면 집 표시 없음 — 도시 중심은 숙소가 아니다).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   서버 응답 NowView.city.center = {lat, lng} (test_task015_city_center.py). 가짜 서버 응답에 손으로 넣는다 (api-types는 백엔드 뒤 생성, 손으로 고치지 않는다)
//   지도 시작 가운데 순서: day.lodging -> 첫 핀 -> city.center -> (응답에 city가 없으면) 지금처럼 일본 가운데
//   "시작 가운데" = 지도(map-view)의 initialRegion 가운데, 또는 응답 뒤 카메라를 옮긴 가운데(animateToRegion·animateCamera). 둘 중 하나면 된다
//   도시 중심에는 집 표시(map-home)를 그리지 않는다
import { act, render, screen, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { nowView, pins as basePins, t08 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const TODAY = 'day-t2';
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';
const CITY = { lat: 34.6937, lng: 135.5023 }; // 가짜 서버가 주는 도시 중심 (지어낸 값, 숙소·핀과 다름)
const JAPAN = { latitude: 36.2, longitude: 138.25 }; // 지금의 "일본 가운데"(map-adapter NO_CENTER)

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

const EMPTY = { pins: [], route: { done: [], remaining: [] }, main: t08({ lodging: null, map_url: null, go_home_min: null }), subs: [], reason: '오늘 코스가 비어 있어' };
const near = (a: { latitude: number; longitude: number }, b: { lat: number; lng: number }) => Math.abs(a.latitude - b.lat) < 1e-9 && Math.abs(a.longitude - b.lng) < 1e-9;

let server: FakeServer;

function serve(dayId: string, date: string, over: object) {
  server = new FakeServer().on('GET /trips/current', json(200, trip()));
  const view = nowView({ day: { ...demoDay, day_id: dayId, date }, at: `${date}T10:00:00`, ...over });
  server.match(`GET /days/${dayId}/now`, () => json(200, view));
  server.match(`POST /days/${dayId}/check`, () => json(200, view));
  server.on(`GET /days/${dayId}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
}

async function open(testId: string) {
  const Index = require('@/app/index').default;
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
  await tap(await screen.findByTestId(testId));
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
}

const initialCenter = () => {
  const region = screen.getByTestId('map-view').props.initialRegion as { latitude: number; longitude: number };
  return { latitude: region.latitude, longitude: region.longitude };
};
/** 지도 시작 가운데가 그곳인가: initialRegion 가운데 또는 카메라를 옮긴 가운데 */
const startsAt = (spot: { lat: number; lng: number }) => near(initialCenter(), spot) || mapControl.moves.some((move) => near(move, spot));

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { googleMapsKeyPresent: true } };
  jest.useFakeTimers({
    now: Date.parse(NOW_ISO),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const PLACES: [string, string, string][] = [
  ['연습', PLANNED, PLANNED_DATE],
  ['실제_오늘', TODAY, '2026-12-02'],
];
const entry = (dayId: string) => (dayId === PLANNED ? `rehearse-${PLANNED}` : `day-row-${TODAY}`);

describe('§E ③ 숙소도 핀도 없으면 지도는 도시 중심에서 시작한다', () => {
  test.each(PLACES)('T15_E3_%s_숙소·핀_없는_빈_코스_날은_city_center에서_시작', async (_name, dayId, date) => {
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(startsAt(CITY)).toBe(true));
    expect(screen.queryByTestId('map-home')).toBeNull(); // 도시 중심은 숙소가 아니다 (§29 ④)
  });

  test.each(PLACES)('T15_E3_%s_빈_코스_날에_일본_가운데에_머물지_않는다', async (_name, dayId, date) => {
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { center: CITY } });
    await open(entry(dayId));
    const last = mapControl.moves.at(-1);
    expect(last ? near(last, { lat: JAPAN.latitude, lng: JAPAN.longitude }) : near(initialCenter(), { lat: JAPAN.latitude, lng: JAPAN.longitude })).toBe(false);
  });
});

describe('§E ③ 경계: 앞 순서가 있으면 도시 중심을 쓰지 않는다', () => {
  test.each(PLACES)('T15_E3_경계_%s_숙소가_있으면_숙소에서_시작', async (_name, dayId, date) => {
    const lodging = demoDay.lodging;
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging }, city: { center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(near(initialCenter(), lodging)).toBe(true));
  });

  test.each(PLACES)('T15_E3_경계_%s_숙소가_없고_핀이_있으면_첫_핀에서_시작', async (_name, dayId, date) => {
    serve(dayId, date, { day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(near(initialCenter(), { lat: basePins[0].lat, lng: basePins[0].lng })).toBe(true));
  });

  test.each(PLACES)('T15_E3_경계_%s_응답에_city가_없어도_지도는_그려진다', async (_name, dayId, date) => {
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null } });
    await open(entry(dayId));
    expect(screen.getByTestId('map-view')).toBeTruthy();
    expect(screen.queryByTestId('map-home')).toBeNull();
  });
});
