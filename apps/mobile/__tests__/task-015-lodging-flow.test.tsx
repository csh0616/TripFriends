/// <reference types="jest" />
// TASK-015 §13 Q2·Q4·Q5 숙소 지도 찍기 흐름 (여행 만들기 화면 SC-01 <-> a2). 로직·가드레일만 본다 (모습은 보지 않는다).
// 근거: TASK-015 §13 Q2("여행 만들기 화면이 받는 도시 정보에 center를 넣는다 ... 받는 곳이 없으면 GET /cities/{city_code} -> {code, name_ko, center} ·
//       a2가 같은 규칙(도시 중심 50km)을 앱에서 먼저 검사 · POST /trips가 그래도 too_far를 주면 a2로 돌아가 안내") ·
//       §13 Q3(다시 찍으면 다시 검사) · §13 Q4(이름 칸이 비면 label: null, 6칸 늘 있음) · §13 Q5(숙소 없이 만들면 lodging: null을 보낸다) ·
//       §11 Q1(400 INVALID_LODGING · error.detail.reason too_far -> a2 안내) · §A ③(Google 호출 없음) ·
//       docs/design/reviews/task-015-design.md §1(a3 "이름·주소 둘 다 못 찾음 -> 바로 [지도에서 찍기]" · a1·a3의 [지도에서 찍기]는 a2로) ·
//       §10 디자이너 제안(고른 뒤 숙소 칸 글: pin = 이름표 또는 "지도에서 찍은 곳") · §7 글
//
// 확인한 지금 상태 (§13 Q2 ①): 앱은 도시 정보를 서버에서 받지 않는다. 도시는 앱에 고정 —
//   src/trips/api.ts `CITY_CODE = 'osaka'` · src/lib/create-trip.ts `city_code: 'osaka'` · src/trips/create-trip-screen.tsx '오사카' 글자(testID city-osaka) ·
//   도시 이름 표 src/lib/day-list.ts CITY_NAME. 서버에도 도시 정보 길이 없다 -> §13 Q2대로 GET /cities/{city_code} 제안 (test_task015_cities.py)
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   여행 만들기 화면은 a2를 보이기 전에 GET /cities/osaka (토큰 필요 없음, §14 Q1)로 {code, name_ko, center}를 받아 a2의 center로 쓴다 (언제 부르는지는 frontend가 정함)
//   숙소 칸 `lodging-search`에 친 글이 이름(GET /places/lodging-search)·주소(GET /places/address-search) 둘 다 0건이면 a3 -> `btn-pick-map`(디자인 부품 이름) -> a2(`pick-map`)
//   a2에서 [여기로 정했어] -> SC-01로 돌아와 `lodging-picked`에 "지도에서 찍은 곳"(이름표가 없을 때). 이때 서버에 묻지 않는다 (여행이 아직 없다)
//   POST /trips 본문 lodging = { kind: 'pin', place_id: null, address_text: null, lat, lng, label: null } (6칸 늘 있음)
//   §14 Q2: 도시 정보를 못 받으면(끊김·500) 조용히 한 번 다시 받는다(GET /cities 모두 2번). 그래도 못 받으면 앱 거리 검사를 건너뛰고 핀이 있으면 [여기로 정했어] 켜짐.
//           서버(POST /trips)가 too_far면 아래처럼 a2로 돌아와 안내
//   §14 Q3: 이름 칸 글은 앞뒤 공백을 잘라 label로 보낸다(" 친구 집 " -> "친구 집"), 자른 뒤 빈 글이면 null
//   POST /trips 400 INVALID_LODGING detail.reason too_far -> a2(`pick-panel`)로 돌아가 "오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘" + [여기로 정했어] 비활성
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json, networkDown, type Reply } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const NOW_ISO = '2026-12-02T03:00:00Z';
const CURRENT = 'GET /trips/current';
const CREATE = 'POST /trips';
const CITY = 'GET /cities/osaka';
const TOO_FAR = '오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘';
const ROUGHLY = '대략이어도 괜찮아';
const KM_PER_LAT_DEG = (6371.0 * Math.PI) / 180;

const OSAKA_CENTER = { lat: 34.6662, lng: 135.501 }; // 시드 v3 (§9 Q6)
const KYOTO_CENTER = { lat: 34.9858, lng: 135.7588 }; // 서버가 다른 중심을 주는 경우 (앱이 고정값이 아니라 받은 값을 쓰는지)
const SPOT = { latitude: 34.657913, longitude: 135.506271 }; // 오사카 중심에서 약 1km (지어낸 값)
const OSAKA_SOUTH_45 = { latitude: OSAKA_CENTER.lat - 45 / KM_PER_LAT_DEG, longitude: OSAKA_CENTER.lng }; // 오사카에서 45km · 교토에서 약 84km
const KYOTO_NORTH_45 = { latitude: KYOTO_CENTER.lat + 45 / KM_PER_LAT_DEG, longitude: KYOTO_CENTER.lng }; // 교토에서 45km · 오사카에서 약 84km

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

const isDisabled = (id: string) => {
  const host = screen.getByTestId(id) as unknown as { props: Record<string, any> };
  return host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true;
};

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

let server: FakeServer;

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer();
  server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
  server.match('GET /places/lodging-search', () => json(200, []));
  server.match('GET /places/address-search', () => json(200, []));
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

async function fillDates(start = '2026-12-10', end = '2026-12-11') {
  await tap(await screen.findByTestId('field-start-date'));
  await screen.findByTestId('calendar-sheet');
  await tap(await screen.findByTestId(`cal-day-${start}`));
  await tap(await screen.findByTestId(`cal-day-${end}`));
  await tap(screen.getByTestId('calendar-confirm'));
  await settleAll();
}

/** 이름·주소 둘 다 0건 -> a3 [지도에서 찍기] -> a2 */
async function toPick() {
  await fireEvent.changeText(await screen.findByTestId('lodging-search'), '친구 집 근처');
  await settleAll();
  await tap(await screen.findByTestId('btn-pick-map'));
  await screen.findByTestId('pick-map');
}

async function longPress(at: { latitude: number; longitude: number }) {
  await act(async () => {
    fireEvent(screen.getByTestId('pick-map'), 'longPress', { nativeEvent: { coordinate: at } });
  });
}

const pinBody = (at: { latitude: number; longitude: number }, label: string | null = null) => ({ kind: 'pin', place_id: null, address_text: null, lat: at.latitude, lng: at.longitude, label });

describe('§13 Q2 도시 정보 center를 서버에서 받는다', () => {
  test('T15_S13_Q2_S14_Q1_a2를_보이기_전에_GET_cities_osaka를_부른다', async () => {
    // (이전 단언: Bearer 헤더를 붙인다 — §14 Q1 "토큰 필요 없음"으로 뺌. 붙이든 안 붙이든 frontend가 정한다)
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    await toForm();
    await fillDates();
    await toPick();
    expect(server.sent(CITY).length).toBeGreaterThanOrEqual(1);
  });

  test('T15_S13_Q2_a2의_50km_검사는_서버가_준_center로_한다_앱_고정값이_아니다', async () => {
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: KYOTO_CENTER }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(KYOTO_NORTH_45); // 받은 중심(교토)에서 45km -> 안
    expect(isDisabled('pick-confirm')).toBe(false);
    await longPress(OSAKA_SOUTH_45); // 받은 중심에서 약 84km -> 밖 (오사카 고정값이었다면 45km라 안)
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(true);
  });

  test('T15_S13_Q2_a2에서_여기로_정했어는_서버에_묻지_않고_여행_만들기로_돌아온다', async () => {
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(SPOT);
    const before = server.requests.length;
    await tap(screen.getByTestId('pick-confirm'));
    await settleAll();
    expect(server.requests.length).toBe(before);
    expect(within(await screen.findByTestId('lodging-picked')).getByText('지도에서 찍은 곳')).toBeTruthy();
    expect(server.sent(CREATE)).toHaveLength(0);
  });
});

describe('§13 Q4 찍은 숙소의 본문', () => {
  test('T15_S13_Q4_이름_칸이_비면_본문_lodging은_6칸_label_null', async () => {
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    server.on(CREATE, json(201, { ...created, lodging: pinBody(SPOT) }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(SPOT);
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    const body = server.sent(CREATE)[0].body as Record<string, unknown>;
    expect(body.lodging).toEqual(pinBody(SPOT));
    expect(body).not.toHaveProperty('lodging_place_id');
  });
});

describe('§13 Q2 POST /trips too_far -> a2로 돌아가 안내', () => {
  async function rejected() {
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    server.on(CREATE, apiError(400, 'INVALID_LODGING', { reason: 'too_far' }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(SPOT); // 앱 검사로는 안 (서버가 그래도 too_far를 주는 경우)
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    await settleAll();
  }

  test('T15_S13_Q2_too_far면_a2로_돌아가_안내하고_여기로_정했어가_비활성', async () => {
    await rejected();
    const panel = await screen.findByTestId('pick-panel');
    expect(within(panel).getByText(TOO_FAR)).toBeTruthy();
    expect(within(panel).queryByText(ROUGHLY)).toBeNull();
    expect(isDisabled('pick-confirm')).toBe(true);
    expect(screen.queryByTestId('day-row-day-t10')).toBeNull(); // 여행은 만들어지지 않았다
  });

  test('T15_S13_Q3_too_far로_돌아온_a2에서_안으로_다시_찍으면_켜지고_다시_만들면_새_자리를_보낸다', async () => {
    await rejected();
    await screen.findByTestId('pick-panel');
    server.on(CREATE, json(201, { ...created, lodging: pinBody({ latitude: OSAKA_CENTER.lat, longitude: OSAKA_CENTER.lng }) }));
    const moved = { latitude: OSAKA_CENTER.lat, longitude: OSAKA_CENTER.lng };
    await longPress(moved);
    expect(isDisabled('pick-confirm')).toBe(false);
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(2));
    expect((server.sent(CREATE)[1].body as Record<string, unknown>).lodging).toEqual(pinBody(moved));
  });

});

const TOKYO_STATION = { latitude: 35.6812, longitude: 139.7671 }; // 오사카 중심에서 약 404km (앱 검사가 있었다면 밖)
const FAILS: [string, Reply][] = [
  ['연결_끊김', networkDown],
  ['500', apiError(500, 'INTERNAL', null)],
];

describe('§14 Q2 도시 정보를 못 받으면 막지 않는다', () => {
  test.each(FAILS)('T15_S14_Q2_첫_번째가_%s이면_조용히_한_번_다시_받아_그_center로_검사한다', async (_name, fail) => {
    server.once(CITY, fail);
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: KYOTO_CENTER }));
    await toForm();
    await fillDates();
    await toPick();
    await settleAll();
    expect(server.sent(CITY)).toHaveLength(2);
    await longPress(OSAKA_SOUTH_45); // 다시 받은 중심(교토)에서 약 84km -> 밖
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(true);
  });

  test.each(FAILS)('T15_S14_Q2_두_번_다_%s이면_더_부르지_않고_앱_검사를_건너뛰어_먼_핀도_켜진다', async (_name, fail) => {
    server.on(CITY, fail);
    await toForm();
    await fillDates();
    await toPick();
    await settleAll();
    expect(server.sent(CITY)).toHaveLength(2); // 처음 + 다시 한 번
    expect(isDisabled('pick-confirm')).toBe(true); // 핀이 없으면 그대로 꺼짐 (§12 Q6)
    await longPress(TOKYO_STATION);
    expect(within(screen.getByTestId('pick-panel')).queryByText(TOO_FAR)).toBeNull();
    expect(isDisabled('pick-confirm')).toBe(false);
    await settleAll();
    expect(server.sent(CITY)).toHaveLength(2);
  });

  test('T15_S14_Q2_도시_정보_없이_보낸_먼_핀을_서버가_too_far로_돌려주면_a2로_돌아와_안내한다', async () => {
    server.on(CITY, networkDown);
    server.on(CREATE, apiError(400, 'INVALID_LODGING', { reason: 'too_far' }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(TOKYO_STATION);
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect((server.sent(CREATE)[0].body as Record<string, unknown>).lodging).toEqual(pinBody(TOKYO_STATION));
    await settleAll();
    const panel = await screen.findByTestId('pick-panel');
    expect(within(panel).getByText(TOO_FAR)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(true);
    expect(screen.queryByTestId('day-row-day-t10')).toBeNull();
  });
});

describe('§14 Q3 이름 앞뒤 공백을 잘라 보낸다', () => {
  test('T15_S14_Q3_이름_칸이_공백_친구_집_공백이면_본문_label은_친구_집', async () => {
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    server.on(CREATE, json(201, { ...created, lodging: pinBody(SPOT, '친구 집') }));
    await toForm();
    await fillDates();
    await toPick();
    await longPress(SPOT);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('pick-label'), ' 친구 집 ');
    });
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect((server.sent(CREATE)[0].body as Record<string, unknown>).lodging).toEqual(pinBody(SPOT, '친구 집'));
  });
});

// ---------- §17 이름 검색 자체가 실패해도 [지도에서 찍기] ----------
// 근거: TASK-015 §17 "frontend가 문서 없이 정한 것" 표("이름 검색 자체가 실패하면 [지도에서 찍기] 없이 알림만" -> 고친다:
//       이름 검색 실패도 주소 검색 실패(a3 ②)와 같이 [지도에서 찍기]를 준다. 막히지 않게 §6) · task-015-design §1-4 a3 btn-pick-map
// 계약: GET /places/lodging-search가 끊김·500·503이면 화면에 `btn-pick-map`이 보이고, 누르면 a2(`pick-map`).
//       주소 검색을 그때 부르는지는 문서에 없어 보지 않는다(질문). 안내 글은 지금 것(T10_6_Q13 "지금 숙소 검색을 못 해") 그대로 둔다

const NAME_FAILS: [string, Reply][] = [
  ['연결_끊김', networkDown],
  ['500', apiError(500, 'INTERNAL', null)],
  ['503', apiError(503, 'PROVIDER_UNAVAILABLE', null)],
];

/** beforeEach의 가짜 서버는 이름 검색을 늘 0건으로 답한다(먼저 건 match가 이긴다) -> 이 묶음은 이름 검색 답만 바꾼 새 가짜 서버로 */
function serverWithNameSearch(reply: () => Reply) {
  server = new FakeServer();
  server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
  server.match('GET /places/lodging-search', reply);
  server.match('GET /places/address-search', () => json(200, []));
}

describe('§17 이름 검색이 실패해도 지도에서 찍기로 갈 수 있다', () => {
  test.each(NAME_FAILS)('T15_S17_이름_검색이_%s이면_지도에서_찍기가_보인다', async (_name, fail) => {
    serverWithNameSearch(() => fail);
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    await toForm();
    await fillDates();
    await fireEvent.changeText(await screen.findByTestId('lodging-search'), '친구 집 근처');
    await settleAll();
    expect(await screen.findByTestId('btn-pick-map')).toBeTruthy();
  });

  test.each(NAME_FAILS)('T15_S17_이름_검색이_%s일_때_지도에서_찍기를_누르면_a2이고_찍은_숙소로_만들_수_있다', async (_name, fail) => {
    serverWithNameSearch(() => fail);
    server.on(CITY, json(200, { code: 'osaka', name_ko: '오사카', center: OSAKA_CENTER }));
    server.on(CREATE, json(201, { ...created, lodging: pinBody(SPOT) }));
    await toForm();
    await fillDates();
    await fireEvent.changeText(await screen.findByTestId('lodging-search'), '친구 집 근처');
    await settleAll();
    await tap(await screen.findByTestId('btn-pick-map'));
    await screen.findByTestId('pick-map');
    await longPress(SPOT);
    await tap(screen.getByTestId('pick-confirm'));
    await tap(await screen.findByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect((server.sent(CREATE)[0].body as Record<string, unknown>).lodging).toEqual(pinBody(SPOT));
  });

  test('T15_S17_경계_이름_검색이_결과를_주면_지도에서_찍기_대신_결과_줄', async () => {
    // 실패가 아니면 지금 흐름 그대로: ① 이름 결과 줄이 보이고 a3의 [지도에서 찍기]는 아직 없다
    serverWithNameSearch(() => json(200, [{ place_id: 'FAKE-lodging-1', name: '난바 테스트 호텔 1', address_short: '가짜구 테스트동 1' }]));
    await toForm();
    await fillDates();
    await fireEvent.changeText(await screen.findByTestId('lodging-search'), '난바');
    await settleAll();
    expect(await screen.findByTestId('lodging-result-FAKE-lodging-1')).toBeTruthy();
    expect(screen.queryByTestId('btn-pick-map')).toBeNull();
  });
});
