/// <reference types="jest" />
// TASK-015 §E ③ 지도 시작 가운데 = 여행 도시의 중심 (앱). 로직만 본다 (지도 모습은 보지 않는다).
// 근거: TASK-015 §E ③("지도 시작 가운데 = 여행 도시의 중심(빈 코스 날 일본 전체 대신 오사카). 응답에 city.center 추가") ·
//       TASK-014 §33("숙소 -> 첫 핀 -> (없으면) 일본 가운데 대신 여행 도시의 중심") · TASK-014 §29 ④(숙소 없으면 집 표시 없음 — 도시 중심은 숙소가 아니다).
//
//       TASK-015 §9 Q7(NowView.city = {code, center: {lat, lng}}, 값은 도시 팩 center의 우리 값 — 시드 v3 34.6662, 135.5010) ·
//       §9 Q9(숙소·핀이 없을 때 city.center가 첫 응답에 오면 initialRegion이 아니라 카메라 이동(animateCamera 등)으로) · §7 AC-4.
//
// 계약 (§9 Q7·Q9 반영):
//   서버 응답 NowView.city = {code, center: {lat, lng}} (test_task015_city_center.py). 가짜 서버 응답에 손으로 넣는다 (api-types는 백엔드 뒤 생성, 손으로 고치지 않는다)
//   지도 시작 가운데 순서: day.lodging -> 첫 핀 -> city.center -> (응답에 city가 없으면) 지금처럼 일본 가운데
//   city.center로 갈 때는 응답 뒤 **카메라 이동**(animateToRegion·animateCamera — 가짜 지도 mapControl.moves에 남는다). initialRegion만 바꾸는 것으로는 안 된다
//     (진짜 지도는 initialRegion을 처음 한 번만 읽어 첫 응답 뒤 바꿔도 움직이지 않는다 — Q9)
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
const CITY = { lat: 34.6662, lng: 135.501 }; // 시드 v3 center (§9 Q6·Q7). 숙소·핀 값과 다르다
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
  lodging: null, // TASK-015 §9 Q2: 응답에 lodging_place_id 없음
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
/** 카메라를 그곳으로 옮겼나 (§9 Q9: 도시 중심은 initialRegion이 아니라 카메라 이동. 이전엔 initialRegion 가운데도 받았다) */
const cameraMovedTo = (spot: { lat: number; lng: number }) => mapControl.moves.some((move) => near(move, spot));

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
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { code: 'osaka', center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(cameraMovedTo(CITY)).toBe(true));
    expect(screen.queryByTestId('map-home')).toBeNull(); // 도시 중심은 숙소가 아니다 (§29 ④)
  });

  test.each(PLACES)('T15_Q9_%s_도시_중심으로는_첫_응답_뒤_카메라를_옮긴다', async (_name, dayId, date) => {
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { code: 'osaka', center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(mapControl.moves.some((move) => near(move, CITY))).toBe(true)); // initialRegion만으로는 통과하지 않는다
    expect(near(mapControl.moves.at(-1)!, CITY)).toBe(true); // 마지막 카메라가 도시 중심 (일본 가운데로 되돌아가지 않는다)
  });

  test.each(PLACES)('T15_E3_%s_빈_코스_날에_일본_가운데에_머물지_않는다', async (_name, dayId, date) => {
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { code: 'osaka', center: CITY } });
    await open(entry(dayId));
    // TASK-015 §20 Q4 불안정 고침: 가짜 지도는 준비 신호를 setTimeout(0)으로 주고, open()은 setImmediate 한 번만 기다린다.
    // Node에서 둘의 순서가 정해져 있지 않아 신호 전에 보면 카메라 이동이 0건 -> initialRegion(일본 가운데)을 보고 실패했다.
    // 지도 준비 신호 뒤를 보도록 setTimeout(0) 한 차례를 더 기다린다 (가짜 지도의 타이머보다 뒤에 걸려 늘 그 뒤에 돈다). 단언은 그대로
    await act(async () => {
      await new Promise<void>((done) => setTimeout(done, 0));
    });
    const last = mapControl.moves.at(-1);
    expect(last ? near(last, { lat: JAPAN.latitude, lng: JAPAN.longitude }) : near(initialCenter(), { lat: JAPAN.latitude, lng: JAPAN.longitude })).toBe(false);
  });
});

describe('§E ③ 경계: 앞 순서가 있으면 도시 중심을 쓰지 않는다', () => {
  test.each(PLACES)('T15_E3_경계_%s_숙소가_있으면_숙소에서_시작', async (_name, dayId, date) => {
    const lodging = demoDay.lodging;
    serve(dayId, date, { ...EMPTY, day: { ...demoDay, day_id: dayId, date, lodging }, city: { code: 'osaka', center: CITY } });
    await open(entry(dayId));
    await waitFor(() => expect(near(initialCenter(), lodging)).toBe(true));
  });

  test.each(PLACES)('T15_E3_경계_%s_숙소가_없고_핀이_있으면_첫_핀에서_시작', async (_name, dayId, date) => {
    serve(dayId, date, { day: { ...demoDay, day_id: dayId, date, lodging: null }, city: { code: 'osaka', center: CITY } });
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
