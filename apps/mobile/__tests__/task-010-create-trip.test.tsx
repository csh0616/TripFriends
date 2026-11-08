/// <reference types="jest" />
// TASK-010 앱 흐름: 첫 화면 · SC-01 여행 만들기 · 날짜 목록 · 실제 여행의 오늘. 로직·가드레일만 본다 (모습은 Maestro·스크린샷).
// 근거: TASK-010 §B2(X-Device-Id, 여행 하나)·§C1~§C4·§C7·§6 실패 표·§9(Q6·Q13·Q14·Q16·Q17·Q18), DESIGN-001 §4-7·§4-9,
// TASK-006 R10(데모 아닌 날엔 데모 버튼 없음).
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   첫 화면 = src/app/index.tsx 기본 내보내기. 켜면 GET /trips/current (헤더 X-Device-Id = 첫 실행 때 만든 UUID,
//     기존 기기 저장소에 두고 늘 같은 값, §9 Q16)
//     404 -> 빈 상태 + 주 버튼 글자 '여행 만들기'. 개발 빌드(__DEV__)에서만 그 아래 '데모 여행 시작'
//     200 -> 날짜 목록: 날 줄 testID `day-row-{day_id}`, 줄 안에 알약 글자(계획 전·계획 완료·오늘 · 여행 중·지난 날)
//   SC-01: 도시 글자 '오사카' · 날짜 칸 testID `field-start-date`·`field-end-date` = 누르면 달력 시트(§9 Q17, 글자 입력 아님)
//     달력 시트 `calendar-sheet` · 날 칸 `cal-day-{YYYY-MM-DD}`(못 고르는 날은 disabled) · 다음·이전 달 `cal-next`·`cal-prev`
//     · 확정 주 버튼 `calendar-confirm`(DESIGN-001 §4-7: 확정은 시트 아래 주 버튼 하나). 시트는 오늘(도시 시간대)의 달로 열린다
//     숙소 검색 칸 `lodging-search` · 날 탭 `tab-day-{YYYY-MM-DD}` · 꼭 갈 곳 검색 칸 `must-search` · 결과는 장소 이름 글자를 누른다
//     주 버튼 `create-trip-submit`(못 누르면 accessibilityState.disabled) · 못 누르는 이유 한 줄 `create-trip-reason` · 틀린 칸 오류 `field-error`
//   날 줄을 누르면: planning -> POST /days/{id}/planning · today -> GET /days/{id}/now (고른 코스가 없으면 계획 대화부터, §9 Q6)
//     · past·planned -> 계획 대화도 /now도 부르지 않는다. 고른 코스 = trip_days[].chosen_option_id
//   400 VALIDATION_ERROR detail.field -> 그 칸에 `field-error` (§9 Q13). 칸 묶음 testID = `field-{칸}-box` (예: start_date -> `field-start-date-box`)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json, networkDown, type Sent } from '../test-support/fake-server';
import { resetDevice, storedValues, tap } from '../test-support/planning-driver';
import { session } from '../test-support/planning-fixtures';
import { nowView } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const CREATE = 'POST /trips';

const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (FOUR의 오늘 = day-t2)
const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planned' || state === 'past' || state === 'today' ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
});
const trip = (states: string[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: `2026-12-0${states.length}`,
  lodging_place_id: null,
  status: 'active',
  trip_days: states.map((state, i) => tripDay(i + 1, state)),
});
const FOUR = trip(['past', 'today', 'planned', 'planning']);
const kuromon = {
  id: 'osaka-fake-kuromon',
  name: '구로몬 시장',
  category: 'food',
  lat: 34.6651,
  lng: 135.5065,
  crowd_level: 4,
  price_level: 2,
  mood_tags: ['현지'],
  image: { category: 'food' },
  facts: [{ field: 'opening_hours', value: '09:00-18:00', status: 'confirmed', source_type: 'google', source_url: null, checked_at: '2026-11-10' }],
};

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

const isDisabled = (id: string) => {
  const host = screen.getByTestId(id) as unknown as { props: Record<string, any> };
  return host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true;
};

type Host = { props: Record<string, any>; parent: Host | null };
const isUnder = (host: unknown, ancestorId: string) => {
  let now = (host as Host).parent;
  while (now) {
    if (now.props.testID === ancestorId) return true;
    now = now.parent;
  }
  return false;
};

const sentTo = (server: FakeServer, prefix: string): Sent[] => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(prefix));

/** Date만 고정한다 (타이머는 진짜 그대로, 화면 기다리기가 멈추지 않게) */
function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

async function type(id: string, value: string) {
  fireEvent.changeText(await screen.findByTestId(id), value);
  await settleAll();
}

let server: FakeServer;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer();
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- C1 첫 화면 ----------

describe('C1 첫 화면', () => {
  test('T10_C1_B2_켜면_X_Device_Id로_지금_여행을_묻는다', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    await screen.findByText('여행 만들기');
    const asked = server.sent(CURRENT);
    expect(asked).toHaveLength(1);
    const id = server.headers(asked[0])['x-device-id'] ?? '';
    expect(id).toMatch(UUID); // §9 Q16
    expect(storedValues().some((value) => value.includes(id))).toBe(true); // 기기 저장소에 둔다
  });

  test('T10_C1_B2_기기_ID는_다시_켜도_같다', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    const first = await startHome();
    await screen.findByText('여행 만들기');
    await first.unmount();
    await startHome();
    await screen.findByText('여행 만들기');
    const [a, b] = server.sent(CURRENT).map((r) => server.headers(r)['x-device-id']);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
  });

  test('T10_C1_여행이_없으면_빈_상태와_여행_만들기_개발_빌드면_데모_버튼도', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    expect(await screen.findByText('여행 만들기')).toBeTruthy();
    expect(screen.getByText('데모 여행 시작')).toBeTruthy();
  });

  test('T10_C1_운영_빌드에는_데모_버튼이_없다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    await screen.findByText('여행 만들기');
    expect(screen.queryByText('데모 여행 시작')).toBeNull();
    expect(screen.queryByText('여행 중 데모 바로 보기')).toBeNull();
  });

  test('T10_C1_여행이_있으면_날짜_목록_알약_네_가지', async () => {
    server.on(CURRENT, json(200, FOUR));
    await startHome();
    const pills: Record<string, string> = { 'day-t1': '지난 날', 'day-t2': '오늘 · 여행 중', 'day-t3': '계획 완료', 'day-t4': '계획 전' };
    for (const [dayId, pill] of Object.entries(pills)) {
      const row = await screen.findByTestId(`day-row-${dayId}`);
      expect(within(row).getByText(pill)).toBeTruthy();
    }
    expect(screen.queryByText('여행 만들기')).toBeNull();
  });
});

// ---------- C3 날짜 목록에서 들어가기 ----------

describe('C3 날짜 목록', () => {
  beforeEach(() => {
    server.on(CURRENT, json(200, FOUR));
  });

  test('T10_C3_계획_전_날은_계획_대화를_시작한다', async () => {
    server.on('POST /days/day-t4/planning', json(201, session));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await waitFor(() => expect(server.sent('POST /days/day-t4/planning')).toHaveLength(1));
  });

  test('T10_C3_Q6_오늘인데_고른_코스가_없으면_계획_대화부터', async () => {
    const noCourse = { ...FOUR, trip_days: FOUR.trip_days.map((d) => (d.day_id === 'day-t2' ? { ...d, chosen_option_id: null } : d)) };
    server.on(CURRENT, json(200, noCourse)).on('POST /days/day-t2/planning', json(201, session));
    await startHome();
    const row = await screen.findByTestId('day-row-day-t2');
    expect(within(row).getByText('오늘 · 여행 중')).toBeTruthy(); // 상태는 today 그대로
    await tap(row);
    await waitFor(() => expect(server.sent('POST /days/day-t2/planning')).toHaveLength(1));
    expect(sentTo(server, 'GET /days/day-t2/now')).toEqual([]);
  });

  test('T10_C3_C4_C7_오늘은_여행_중_화면_시계만_쓰고_위치를_보내지_않으며_데모_버튼이_없다', async () => {
    server.match('GET /days/day-t2/now', () => json(200, nowView()));
    server.match('POST /days/day-t2/check', () => json(200, nowView()));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t2'));
    await screen.findByTestId('trip-now-screen');
    await waitFor(() => expect(sentTo(server, 'GET /days/day-t2/now')).toHaveLength(1));
    // §9 Q18: 시각은 도시 시간대(Asia/Tokyo)의 지금. NOW_ISO = 도쿄 12:00
    const at = decodeURIComponent(sentTo(server, 'GET /days/day-t2/now')[0].path.split('at=')[1] ?? '');
    expect(at.startsWith('2026-12-02T12:00')).toBe(true);
    expect(screen.queryByTestId('demo-toggle')).toBeNull(); // C7·TASK-006 R10: 실제 여행의 날엔 데모 시계·버튼 없음 (개발 빌드여도)
    for (const sent of [...sentTo(server, 'GET /days/day-t2/now'), ...sentTo(server, 'POST /days/day-t2/check')]) {
      expect(sent.path).not.toMatch(/[?&](lat|lng)=/);
      expect(JSON.stringify(sent.body ?? {})).not.toMatch(/"(lat|lng)"/);
    }
  });

  test.each(['day-t1', 'day-t3'])('T10_C3_지난_날·계획_완료_날(%s)은_계획_대화도_여행_중도_부르지_않는다', async (dayId) => {
    await startHome();
    await tap(await screen.findByTestId(`day-row-${dayId}`));
    await settleAll();
    expect(sentTo(server, `POST /days/${dayId}/planning`)).toEqual([]);
    expect(sentTo(server, `GET /days/${dayId}/now`)).toEqual([]);
    expect(server.unexpected).toEqual([]);
  });
});

// ---------- C2 SC-01 여행 만들기 ----------

async function toForm() {
  server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
  await startHome();
  await tap(await screen.findByText('여행 만들기'));
  await screen.findByTestId('create-trip-submit');
}

/** §9 Q17 달력 시트: 날짜 칸을 누르면 시트가 열리고, 시작 -> 끝 두 번 누른 뒤 확정 (같은 달 안의 날짜만 쓴다) */
async function fillDates(start = '2026-12-10', end = '2026-12-11') {
  await tap(await screen.findByTestId('field-start-date'));
  await screen.findByTestId('calendar-sheet');
  await tap(await screen.findByTestId(`cal-day-${start}`));
  await tap(await screen.findByTestId(`cal-day-${end}`));
  await tap(screen.getByTestId('calendar-confirm'));
  await settleAll();
}

describe('C2 여행 만들기', () => {
  test('T10_C2_도시는_오사카_고정_날짜_전에는_못_누르고_이유_한_줄', async () => {
    await toForm();
    expect(screen.getByText('오사카')).toBeTruthy();
    expect(isDisabled('create-trip-submit')).toBe(true);
    expect(screen.getByTestId('create-trip-reason')).toBeTruthy();
    await tap(screen.getByTestId('create-trip-submit'));
    expect(server.sent(CREATE)).toEqual([]);
  });

  test('T10_Q17_날짜_칸은_글자_입력이_아니라_달력_시트를_연다', async () => {
    await toForm();
    for (const id of ['field-start-date', 'field-end-date']) {
      const field = screen.getByTestId(id) as unknown as { props: Record<string, any> };
      expect(field.props.onChangeText).toBeUndefined();
      expect(field.props.editable === true).toBe(false);
    }
    await tap(screen.getByTestId('field-start-date'));
    expect(await screen.findByTestId('calendar-sheet')).toBeTruthy();
  });

  test('T10_Q17_Q18_오늘_전_날은_못_고르고_오늘은_고를_수_있다', async () => {
    await toForm();
    await tap(screen.getByTestId('field-start-date'));
    await screen.findByTestId('calendar-sheet');
    expect(isDisabled('cal-day-2026-12-01')).toBe(true); // 도시 시간대 오늘 = 12-02
    expect(isDisabled('cal-day-2026-12-02')).toBe(false);
  });

  test('T10_Q17_B1_시작을_고르면_7일을_넘는_끝은_못_고른다', async () => {
    await toForm();
    await tap(screen.getByTestId('field-start-date'));
    await screen.findByTestId('calendar-sheet');
    await tap(await screen.findByTestId('cal-day-2026-12-10'));
    expect(isDisabled('cal-day-2026-12-16')).toBe(false);
    expect(isDisabled('cal-day-2026-12-17')).toBe(true);
  });

  test('T10_Q17_다음_달로_넘겨_고를_수_있다', async () => {
    server.on(CREATE, json(201, trip(['planning', 'planning'])));
    await toForm();
    await tap(screen.getByTestId('field-start-date'));
    await screen.findByTestId('calendar-sheet');
    expect(screen.queryByTestId('cal-day-2027-01-05')).toBeNull(); // 열린 달 = 오늘의 달(12월)
    await tap(screen.getByTestId('cal-next'));
    await tap(await screen.findByTestId('cal-day-2027-01-05'));
    await tap(await screen.findByTestId('cal-day-2027-01-06'));
    await tap(screen.getByTestId('calendar-confirm'));
    await settleAll();
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect(server.sent(CREATE)[0].body).toMatchObject({ start_date: '2027-01-05', end_date: '2027-01-06' });
  });

  test('T10_C2_날짜만_넣으면_누를_수_있다_숙소_꼭_갈_곳은_선택', async () => {
    await toForm();
    await fillDates();
    expect(isDisabled('create-trip-submit')).toBe(false);
    expect(screen.queryByTestId('create-trip-reason')).toBeNull();
  });

  test('T10_C2_B1_날짜_꼭_갈_곳_1곳_만들기_본문과_날짜_목록', async () => {
    server.match('GET /places/search', () => json(200, [kuromon]));
    server.on(CREATE, json(201, trip(['planning', 'planning'])));
    await toForm();
    await fillDates('2026-12-03', '2026-12-04');
    await tap(await screen.findByTestId('tab-day-2026-12-03'));
    await type('must-search', '구로');
    await waitFor(() => expect(sentTo(server, 'GET /places/search')).not.toHaveLength(0));
    const search = sentTo(server, 'GET /places/search').at(-1)!;
    expect(search.path).toContain('city_code=osaka');
    expect(decodeURIComponent(search.path)).toContain('q=구로');
    await tap(await screen.findByText('구로몬 시장'));
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    const sent = server.sent(CREATE)[0];
    expect(sent.body).toEqual({
      city_code: 'osaka',
      start_date: '2026-12-03',
      end_date: '2026-12-04',
      must_visits: [{ date: '2026-12-03', place_id: 'osaka-fake-kuromon' }],
    });
    expect(server.headers(sent)['x-device-id'] ?? '').toMatch(UUID);
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(screen.getAllByText('계획 전')).toHaveLength(2);
  });

  test('T10_6_Q13_400이면_detail_field_칸에_오류_입력값은_그대로', async () => {
    server.once(CREATE, apiError(400, 'VALIDATION_ERROR', { field: 'start_date' }, '서버_400_문장'));
    await toForm();
    await fillDates('2026-12-10', '2026-12-11');
    await tap(screen.getByTestId('create-trip-submit'));
    const error = await screen.findByTestId('field-error');
    expect(isUnder(error, 'field-start-date-box')).toBe(true); // 시작일 칸 묶음 안
    expect(screen.queryByTestId('day-row-day-t1')).toBeNull();
    server.on(CREATE, json(201, trip(['planning', 'planning'])));
    await tap(screen.getByTestId('create-trip-submit')); // 입력값이 그대로라 같은 본문
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(2));
    expect(server.sent(CREATE)[1].body).toEqual(server.sent(CREATE)[0].body);
  });

  test.each([
    ['끊김', networkDown],
    ['500', apiError(500, 'INTERNAL_ERROR')],
  ])('T10_6_%s이면_아무것도_만들어지지_않고_다시_누르면_새로_보낸다', async (_name, failure) => {
    server.once(CREATE, failure).on(CREATE, json(201, trip(['planning', 'planning'])));
    await toForm();
    await fillDates();
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    await settleAll();
    expect(screen.queryByTestId('day-row-day-t1')).toBeNull();
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(2));
    expect(server.sent(CREATE)[1].body).toEqual(server.sent(CREATE)[0].body);
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
  });

  test.each([
    ['끊김', networkDown],
    ['503', apiError(503, 'PROVIDER_UNAVAILABLE')],
  ])('T10_6_Q13_숙소_검색이_%s이면_안내하고_숙소_없이_만들_수_있다', async (_name, failure) => {
    server.match('GET /places/lodging-search', () => failure);
    server.on(CREATE, json(201, trip(['planning', 'planning'])));
    await toForm();
    await fillDates();
    await type('lodging-search', '호텔');
    expect(await screen.findByText(/지금 숙소 검색을 못 해/)).toBeTruthy();
    expect(isDisabled('create-trip-submit')).toBe(false);
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect(server.sent(CREATE)[0].body).not.toHaveProperty('lodging_place_id');
  });

  test.each(['호', ' 호 '])('T10_B5_Q14_숙소는_공백을_지우고_한_글자면_검색하지_않는다_%j', async (q) => {
    server.match('GET /places/lodging-search', () => json(200, []));
    await toForm();
    await type('lodging-search', q);
    await settleAll();
    expect(sentTo(server, 'GET /places/lodging-search')).toEqual([]);
  });

  test('T10_C2_A3_하루_5곳을_고르면_그날은_더_고를_수_없다', async () => {
    const five = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ({ ...kuromon, id: `osaka-fake-${k}`, name: `가짜 장소 ${i + 1}` }));
    server.match('GET /places/search', () => json(200, five));
    server.on(CREATE, json(201, trip(['planning'])));
    await toForm();
    await fillDates('2026-12-05', '2026-12-05');
    await tap(await screen.findByTestId('tab-day-2026-12-05'));
    await type('must-search', '가짜');
    for (let i = 1; i <= 6; i += 1) {
      const item = screen.queryByText(`가짜 장소 ${i}`);
      if (item) await tap(item);
    }
    await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE)).toHaveLength(1));
    expect((server.sent(CREATE)[0].body as { must_visits: unknown[] }).must_visits).toHaveLength(5);
  });
});
