/// <reference types="jest" />
// TASK-014 §C "이 날 미리 걸어 보기"(연습 모드, 앱) · §6 실패 표(연습 줄). 로직·가드레일만 본다 (띠·버튼의 모습·자리는 §D3·§D4 보드).
// 근거: TASK-014 §C C1~C4·C6·§6·§7 AC-3·AC-5, TASK-006 B7(데모 시계 [+10분]·[재생], fakePosition 코스대로), TASK-007 B-4(check 본문)·C1,
// TASK-008 A5(T-05 [열었어]/[닫혔어]), TASK-009 A1(제안 고르기 -> [이걸로 할래]), 절대 규칙 3(일정 변경은 사용자가 고른 뒤).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   날짜 목록 계획 완료 줄의 [미리 걸어 보기] = testID `rehearse-{day_id}`, 글자 "미리 걸어 보기". 오늘·지난 날·계획 전 날·데모 여행(is_demo)엔 없다
//   누르면 여행 중 화면(testID trip-now-screen)과 같은 화면 + 글자 "연습 중" + [연습 끝내기]. 첫 요청은 GET /days/{id}/now (읽기)
//   연습 중 서버에 묻는 것은 POST /days/{id}/check 본문 {at, lat, lng, rehearsal: true} 뿐 (서버 쓰기 0). 위치는 fakePosition(코스대로)
//   시계 막대는 데모 시계 재사용 = 기존 testID demo-plus-10([+10분]) · demo-play([재생]) · demo-time(시각). §10 Q13: 처음부터 펼쳐져 있고 하루 시작 시각부터
//   §10 Q5: 계산하는 요청(check, [닫혔어] 뒤 대안 = POST /places/{place_id}/visit-checks 본문 {day_id, at, was_open:false})은 본문에 rehearsal: true.
//     고르고 확정하는 행동([이걸로 할래] 반영, [그대로 갈래], [열었어] = 영업 확인했어)은 서버 요청 0, 화면에서만 바뀐다
//     ([이걸로 할래] = 고른 제안의 일정으로 남은 화면, [열었어] = 그 장소 칩이 화면에서만 "확인됨"). 연습 한 번에 첫 행동에만 안내 한 줄
//   [대안 고르기]·[그대로 갈래]·[열었어]/[닫혔어] = 기존 testID proposal-{id}·select-confirm·event-dismiss·visit-open·visit-closed
//   연습 중 실패 = 글자 "지금 연습을 못 해" + [다시](기존 Notice의 retry-button)
// §9·§10(v1.2)으로 문구·규칙이 확정돼 [보드] 표시는 뺐다. 누르는 영역 44(E2·task-014-design §2)는 height·minHeight + hitSlop으로 센다.
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fakePosition } from '@/lib/fake-position';

import { locationFake } from '../test-support/expo-location-mock';
import { apiError, FakeServer, json, networkDown, type Reply, type Sent } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { delayedView, nowView, t02 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const trip = (states: string[] = ['past', 'today', 'planned', 'planning'], over: object = {}) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: `2026-12-0${states.length}`,
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: states.map((state, index) => tripDay(index + 1, state)),
  ...over,
});
const plannedDay = { ...demoDay, day_id: PLANNED, date: PLANNED_DATE };
const rehearsalView = (over: object = {}) => nowView({ day: plannedDay, ...over });

const REHEARSAL_NOTE = '연습이라 저장하지 않았어';
const REHEARSAL_FAILED = '지금 연습을 못 해';

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
let checkReply: (sent: Sent) => Reply;
let nowReply: () => Reply;

const sentTo = (prefix: string): Sent[] => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(prefix));
const checks = () => sentTo(`POST /days/${PLANNED}/check`);
const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;
/** GET 말고 서버에 보낸 것 (쓰기일 수 있는 요청) */
const writes = () => server.requests.filter((r) => r.method !== 'GET');

async function toRehearsal() {
  await startHome();
  await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  await settleAll();
}

/** 시계 막대의 [+10분] (§10 Q13: 처음부터 펼쳐져 있다) */
async function plusTen() {
  await tap(await screen.findByTestId('demo-plus-10'));
}

type Host = { props: Record<string, any>; parent: Host | null };
const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
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

const minutesOf = (at: unknown) => {
  const found = /T(\d{2}):(\d{2})/.exec(String(at));
  return found ? Number(found[1]) * 60 + Number(found[2]) : NaN;
};

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  freezeDate(NOW_ISO);
  server = new FakeServer().on(CURRENT, json(200, trip()));
  checkReply = (sent) => json(200, rehearsalView({ at: body(sent).at }));
  nowReply = () => json(200, rehearsalView());
  server.match(`GET /days/${PLANNED}/now`, () => nowReply());
  server.match(`POST /days/${PLANNED}/check`, (sent) => checkReply(sent));
  server.on(`GET /days/${PLANNED}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// C1 들어가는 곳
// =====================================================================

describe('C1 들어가는 곳: 계획 완료 날 줄만', () => {
  test('T14_C1_계획_완료_날에만_미리_걸어_보기가_있다_오늘·지난_날·계획_전엔_없다', async () => {
    await startHome();
    const button = await screen.findByTestId(`rehearse-${PLANNED}`);
    expect(within(button).getByText('미리 걸어 보기')).toBeTruthy();
    for (const other of ['day-t1', 'day-t2', 'day-t4']) expect(screen.queryByTestId(`rehearse-${other}`)).toBeNull();
    expect(screen.getAllByText('미리 걸어 보기')).toHaveLength(1);
  });

  test('T14_C1_계획_완료_날이_여럿이면_날마다_하나씩', async () => {
    server.on(CURRENT, json(200, trip(['today', 'planned', 'planned', 'planning'])));
    await startHome();
    await screen.findByTestId('rehearse-day-t2');
    expect(screen.getByTestId('rehearse-day-t3')).toBeTruthy();
    expect(screen.queryByTestId('rehearse-day-t1')).toBeNull();
    expect(screen.queryByTestId('rehearse-day-t4')).toBeNull();
    expect(screen.getAllByText('미리 걸어 보기')).toHaveLength(2);
  });

  test('T14_C1_데모_여행엔_미리_걸어_보기가_없다', async () => {
    server.on(CURRENT, json(200, trip(['past', 'today', 'planned', 'planning'], { is_demo: true })));
    await startHome();
    await screen.findByTestId(`day-row-${PLANNED}`);
    expect(screen.queryByText('미리 걸어 보기')).toBeNull();
    expect(screen.queryByTestId(`rehearse-${PLANNED}`)).toBeNull();
  });

  test('T14_C1_여행이_끝나_지난_날만_있으면_없다', async () => {
    server.on(CURRENT, json(200, trip(['past', 'past', 'past'])));
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    expect(screen.queryByText('미리 걸어 보기')).toBeNull();
  });

  test('T14_C1_날짜_목록을_여는_것만으로는_연습_요청이_없다', async () => {
    await startHome();
    await screen.findByTestId(`rehearse-${PLANNED}`);
    await settleAll();
    expect(sentTo(`GET /days/${PLANNED}/now`)).toEqual([]);
    expect(checks()).toEqual([]);
  });
});

// =====================================================================
// C2·C3 화면과 요청: 같은 화면 + "연습 중", check는 rehearsal: true, 위치는 코스대로
// =====================================================================

describe('C2·C3 연습 화면', () => {
  test('T14_C2_여행_중_화면에_연습_중과_연습_끝내기가_보인다', async () => {
    await toRehearsal();
    expect(screen.getByText('연습 중')).toBeTruthy();
    expect(screen.getByText('연습 끝내기')).toBeTruthy();
    expect(screen.getByTestId('sos-button')).toBeTruthy(); // 같은 화면: SOS 고정 (가드레일)
  });

  test('T14_C3_연습_중_check는_모두_rehearsal_true', async () => {
    await toRehearsal();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(1));
    await plusTen();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(2));
    for (const sent of checks()) expect(body(sent).rehearsal).toBe(true);
  });

  test('T14_C3_연습_중_서버_쓰기는_rehearsal_check뿐이다', async () => {
    await toRehearsal();
    await plusTen();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(2));
    for (const sent of writes()) {
      expect(`${sent.method} ${sent.path}`).toBe(`POST /days/${PLANNED}/check`);
      expect(body(sent).rehearsal).toBe(true);
    }
  });

  test('T14_C2_시계_막대_+10분이면_10분_뒤_시각으로_다시_묻는다', async () => {
    await toRehearsal();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(1));
    const before = minutesOf(body(checks()[checks().length - 1]).at);
    await plusTen();
    await waitFor(() => expect(minutesOf(body(checks()[checks().length - 1]).at)).toBe(before + 10));
    expect(String(body(checks()[checks().length - 1]).at).startsWith(PLANNED_DATE)).toBe(true); // 그날의 시각 (오늘 아님)
  });

  test('T14_C2_위치는_fake_position_코스대로', async () => {
    await toRehearsal();
    await plusTen();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(2));
    const view = rehearsalView();
    const course = {
      lodging: view.day.lodging,
      go_home_min: null,
      items: view.pins.map((pin: { lat: number; lng: number; start: string; end: string; travel_min: number }) => ({ lat: pin.lat, lng: pin.lng, start: pin.start, end: pin.end, travel_min: pin.travel_min })),
    };
    for (const sent of checks()) {
      const expected = fakePosition(String(body(sent).at), course);
      expect(expected).not.toBeNull();
      expect({ lat: body(sent).lat, lng: body(sent).lng }).toEqual({ lat: expected!.lat, lng: expected!.lng });
    }
  });

  test('T14_C3_주소창에는_위치를_싣지_않는다', async () => {
    await toRehearsal();
    await plusTen();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(2));
    for (const sent of server.requests) expect(sent.path).not.toMatch(/[?&](lat|lng|rehearsal)=/);
  });

  test('T14_C2_연습_끝내기를_누르면_날짜_목록이_그대로_나온다_AC_5', async () => {
    await toRehearsal();
    await plusTen();
    await tap(await screen.findByText('연습 끝내기'));
    const row = await screen.findByTestId(`day-row-${PLANNED}`);
    expect(within(row).getByText('계획 완료')).toBeTruthy();
    expect(screen.getByTestId(`rehearse-${PLANNED}`)).toBeTruthy();
    for (const sent of writes()) expect(body(sent).rehearsal).toBe(true); // 끝낼 때도 저장 요청 없음
  });
});

// =====================================================================
// C6 연습 중에는 실제 위치를 읽지 않는다
// =====================================================================

describe('C6 연습 중 실제 위치 0', () => {
  test.each(['undetermined', 'granted', 'denied'] as const)('T14_C6_권한이_%s여도_연습_중에는_묻지도_읽지도_않는다', async (status) => {
    locationFake.permit(status);
    await toRehearsal();
    await plusTen();
    await act(async () => {
      locationFake.emit({ lat: 34.123457, lng: 135.987653, accuracy: 5 });
    });
    await settleAll();
    expect(locationFake.askCount()).toBe(0);
    expect(locationFake.readCount()).toBe(0);
    expect(locationFake.backgroundCount()).toBe(0);
    expect(screen.queryByText('위치 켜기')).toBeNull();
    for (const sent of checks()) expect(body(sent).lat).not.toBe(34.123457);
  });
});

// =====================================================================
// C4 연습 중 행동은 화면에서만, "연습이라 저장하지 않았어"
// =====================================================================

const t05 = { type: 'T-05', place: { place_id: 'D02', name: '서버_확인할_곳' }, facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'unverified', source_type: '서버_출처', checked_at: null }], map_url: 'https://www.google.com/maps/search/?api=1&query=35.02,134.99' };

describe('C4 연습 중 행동', () => {
  test('T14_C4_대안을_고르고_이걸로_할래를_눌러도_서버에_반영_요청이_없다', async () => {
    const view = delayedView({ day: plannedDay });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    await toRehearsal();
    await tap(await screen.findByTestId('proposal-prop-relaxed'));
    await tap(screen.getByTestId('select-confirm'));
    expect(await screen.findByText(REHEARSAL_NOTE)).toBeTruthy();
    expect(sentTo('POST /proposals/')).toEqual([]);
    for (const sent of writes()) expect(body(sent).rehearsal).toBe(true);
  });

  test('T14_C4_그대로_갈래도_서버에_보내지_않는다', async () => {
    const view = delayedView({ day: plannedDay });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    await toRehearsal();
    await tap(await screen.findByTestId('event-dismiss'));
    expect(await screen.findByText(REHEARSAL_NOTE)).toBeTruthy();
    expect(sentTo('POST /events/')).toEqual([]);
  });

  test('T14_C4_Q5_열었어(영업_확인했어)는_서버에_보내지_않고_칩만_화면에서_확인됨', async () => {
    const view = rehearsalView({ main: t05, subs: [t02()] }); // t02의 다음 장소 = D02 (미확인)
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    await toRehearsal();
    expect(within(screen.getByTestId('card-T-02')).getByText('미확인')).toBeTruthy(); // 시험 자체 확인
    await tap(await screen.findByTestId('visit-open'));
    expect(await screen.findByText(REHEARSAL_NOTE)).toBeTruthy();
    expect(sentTo('POST /places/')).toEqual([]);
    await waitFor(() => expect(within(screen.getByTestId('card-T-02')).getByText('확인됨')).toBeTruthy());
    for (const sent of writes()) expect(body(sent).rehearsal).toBe(true);
  });

  test('T14_C4_Q5_닫혔어는_대안_계산이라_visit_checks를_rehearsal_true로_보낸다', async () => {
    const view = rehearsalView({ main: t05, subs: [t02()] });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    server.on('POST /places/D02/visit-checks', json(200, rehearsalView()));
    await toRehearsal();
    await tap(await screen.findByTestId('visit-closed'));
    await waitFor(() => expect(sentTo('POST /places/D02/visit-checks')).toHaveLength(1));
    const sent = body(sentTo('POST /places/D02/visit-checks')[0]);
    expect(sent).toMatchObject({ day_id: PLANNED, was_open: false, rehearsal: true });
    expect(String(sent.at).startsWith(PLANNED_DATE)).toBe(true);
    for (const one of writes()) expect(body(one).rehearsal).toBe(true);
  });

  test('T14_C4_Q5_고른_대안의_일정으로_남은_연습_화면이_바뀐다', async () => {
    const view = delayedView({ day: plannedDay });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    await toRehearsal();
    expect(screen.queryByText('서버_제안_장소')).toBeNull(); // 고르기 전에는 제안 일정이 화면에 없다 (TASK-007 C6)
    await tap(await screen.findByTestId('proposal-prop-relaxed'));
    await tap(screen.getByTestId('select-confirm'));
    expect((await screen.findAllByText('서버_제안_장소')).length).toBeGreaterThan(0);
    expect(sentTo('POST /proposals/')).toEqual([]);
  });

  test('T14_C4_연습에서_고른_뒤_끝내고_실제_오늘이_아닌_그날을_다시_열어도_저장_요청은_0', async () => {
    const view = delayedView({ day: plannedDay });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
    await toRehearsal();
    await tap(await screen.findByTestId('proposal-prop-relaxed'));
    await tap(screen.getByTestId('select-confirm'));
    await tap(await screen.findByText('연습 끝내기'));
    await tap(await screen.findByTestId(`day-row-${PLANNED}`)); // 계획 완료 줄 = 고른 코스 읽기 (TASK-010 §12 답 3)
    await settleAll();
    expect(writes().filter((sent) => body(sent).rehearsal !== true)).toEqual([]);
  });
});

describe('§9 답 7·4: 안내 한 줄은 연습 한 번에 처음 한 번만, [내 위치] 없음', () => {
  const delayed = () => {
    const view = delayedView({ day: plannedDay });
    nowReply = () => json(200, view);
    checkReply = (sent) => json(200, { ...view, at: body(sent).at });
  };

  test('T14_S9_7_두_번째_행동에는_한_줄을_다시_띄우지_않는다', async () => {
    delayed();
    await toRehearsal();
    await tap(await screen.findByTestId('proposal-prop-relaxed'));
    await tap(screen.getByTestId('select-confirm'));
    await tap(await screen.findByText(REHEARSAL_NOTE)); // 누르면 닫힘
    await waitFor(() => expect(screen.queryByText(REHEARSAL_NOTE)).toBeNull());
    await tap(await screen.findByTestId('event-dismiss'));
    await settleAll();
    expect(screen.queryByText(REHEARSAL_NOTE)).toBeNull();
  });

  test('T14_S9_7_한_줄은_누르면_닫힌다', async () => {
    delayed();
    await toRehearsal();
    await tap(await screen.findByTestId('event-dismiss'));
    await tap(await screen.findByText(REHEARSAL_NOTE));
    await waitFor(() => expect(screen.queryByText(REHEARSAL_NOTE)).toBeNull());
  });

  test('T14_S9_7_한_줄은_6초_뒤_사라진다', async () => {
    delayed();
    await toRehearsal();
    await tap(await screen.findByTestId('event-dismiss'));
    await screen.findByText(REHEARSAL_NOTE);
    await new Promise((done) => setTimeout(done, 4000));
    expect(screen.getByText(REHEARSAL_NOTE)).toBeTruthy(); // 경계: 4초엔 아직 있다
    await waitFor(() => expect(screen.queryByText(REHEARSAL_NOTE)).toBeNull(), { timeout: 4000 });
  }, 20000);

  test('T14_S9_7_새_연습에서는_다시_처음_한_번', async () => {
    delayed();
    await toRehearsal();
    await tap(await screen.findByTestId('event-dismiss'));
    await screen.findByText(REHEARSAL_NOTE);
    await tap(await screen.findByText('연습 끝내기'));
    await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
    await screen.findByTestId('now-main');
    await tap(await screen.findByTestId('event-dismiss'));
    expect(await screen.findByText(REHEARSAL_NOTE)).toBeTruthy();
  });

  test('T14_S9_4_연습_중엔_내_위치_버튼이_없다', async () => {
    await toRehearsal();
    expect(screen.queryByTestId('my-location-button')).toBeNull();
  });

  test('T14_S9_8_연습_끝내기는_확인_없이_바로_날짜_목록', async () => {
    await toRehearsal();
    await tap(await screen.findByText('연습 끝내기'));
    expect(await screen.findByTestId(`day-row-${PLANNED}`)).toBeTruthy();
    expect(screen.queryByText('연습 중')).toBeNull();
  });
});

// =====================================================================
// §10 Q13 연습 시계 · E2 누르는 영역
// =====================================================================

describe('§10 Q13 연습 시계 · E2 누르는 영역', () => {
  test('T14_Q13_연습_시계는_처음부터_펼쳐져_있다', async () => {
    await toRehearsal();
    expect(screen.getByTestId('demo-plus-10')).toBeTruthy();
    expect(screen.getByTestId('demo-play')).toBeTruthy();
  });

  test('T14_Q13_연습은_하루_시작_시각부터', async () => {
    await toRehearsal();
    await waitFor(() => expect(within(screen.getByTestId('demo-time')).getByText(plannedDay.start)).toBeTruthy());
    const asked = [...sentTo(`GET /days/${PLANNED}/now`), ...checks()];
    const last = asked[asked.length - 1];
    const at = last.method === 'GET' ? decodeURIComponent(last.path.split('at=')[1] ?? '') : String(body(last).at);
    expect(at.startsWith(`${PLANNED_DATE}T${plannedDay.start}`)).toBe(true);
  });

  test('T14_E2_미리_걸어_보기의_누르는_높이는_44_이상', async () => {
    await startHome();
    const button = pressableOf((await screen.findByTestId(`rehearse-${PLANNED}`)) as unknown as Host);
    expect(reachHeight(button)).toBeGreaterThanOrEqual(44);
  });

  test('T14_E2_일정_추가_알약은_보이는_36_그대로_누르는_높이는_44_이상', async () => {
    await startHome();
    const add = pressableOf((await screen.findByTestId('add-fixed-day-t4')) as unknown as Host);
    expect(styleOf(add).height).toBe(36);
    expect(reachHeight(add)).toBeGreaterThanOrEqual(44);
  });

  test('T14_E2_연습_끝내기의_누르는_높이는_44_이상', async () => {
    await toRehearsal();
    const end = pressableOf(screen.getByText('연습 끝내기') as unknown as Host);
    expect(reachHeight(end)).toBeGreaterThanOrEqual(44); // task-014-design §2 reh-band: 눌리는 44 · 보이는 36
  });
});

// =====================================================================
// §6 연습 중 서버 실패 -> "지금 연습을 못 해" + [다시], 실제 여행은 그대로
// =====================================================================

describe('§6 연습 중 실패', () => {
  test('T14_S6_연습_check가_500이면_지금_연습을_못_해와_다시', async () => {
    checkReply = () => apiError(500, 'INTERNAL_ERROR');
    await toRehearsal();
    await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(1));
    expect(await screen.findByText(REHEARSAL_FAILED)).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
  });

  test('T14_S6_다시를_누르면_연습_check를_다시_보내고_되면_안내가_사라진다', async () => {
    checkReply = () => apiError(500, 'INTERNAL_ERROR');
    await toRehearsal();
    await screen.findByText(REHEARSAL_FAILED);
    const before = checks().length;
    checkReply = (sent) => json(200, rehearsalView({ at: body(sent).at }));
    await tap(screen.getByTestId('retry-button'));
    await waitFor(() => expect(checks().length).toBeGreaterThan(before));
    expect(body(checks()[checks().length - 1]).rehearsal).toBe(true);
    await waitFor(() => expect(screen.queryByText(REHEARSAL_FAILED)).toBeNull());
  });

  test('T14_S6_연습_화면_첫_요청이_500이어도_지금_연습을_못_해', async () => {
    nowReply = () => apiError(500, 'INTERNAL_ERROR');
    await startHome();
    await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
    expect(await screen.findByText(REHEARSAL_FAILED)).toBeTruthy();
  });

  test('T14_S6_연습이_실패해도_실제_여행에_쓰는_요청이_없다', async () => {
    checkReply = () => apiError(500, 'INTERNAL_ERROR');
    await toRehearsal();
    await screen.findByText(REHEARSAL_FAILED);
    await tap(screen.getByTestId('retry-button'));
    await settleAll();
    for (const sent of writes()) expect(body(sent).rehearsal).toBe(true);
  });

  test('T14_S6_연습_중_연결이_끊겨도_연습_못_함_안내', async () => {
    // §10 Q12: 연결 끊김도 "지금 연습을 못 해"
    checkReply = () => networkDown;
    await toRehearsal();
    expect(await screen.findByText(REHEARSAL_FAILED)).toBeTruthy();
  });
});
