/// <reference types="jest" />
// TASK-014 §29 ① 응답 처리(요청 하나씩·최신 시각) · ② 연습 점은 앱 fake-position으로 바로 · ④ 숙소 없음(day.lodging null) 화면. 로직·가드레일만 본다.
// 근거: TASK-014 §29 표 ①("동시에 요청 하나만. 그사이 시계가 바뀌면 최신 시각만 들고 있다가 응답이 오면 한 번 보냄. 응답은 버리지 않고, 화면에 있는 것보다 오래된 것만 버림")
//       ②("연습 중 점은 앱의 fake-position으로 바로 그림(카메라도 그 점 기준), 카드만 서버 응답을 기다림") · ④("숙소가 없으면 T-08 숨김, 지도에 집 표시 없음, 첫 지도 맞춤에도 안 넣음")
//       §29 폰 확인("[▶ 재생]하면 시계만 가고 점·지도·카드가 안 움직임, [10분]은 빠르게 누르면 늦게 따라오다 한꺼번에 넘어감")·"배운 것"(느린 응답·선택 항목이 빈 데이터),
//       API-001 §2-3 (11-15) NowView.day.lodging null, TASK-006 B10(실제 여행 첫 맞춤 = 모든 핀 + 숙소), TASK-006 §7(지도 실패 대체 그림), TASK-014 A3(실제 여행 점 = 기기 위치).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   ① 연습 화면에서 시계(재생·[10분])가 부르는 POST /check는 한 번에 하나만 서버에 나가 있다 (응답 전 다음 check를 보내지 않는다)
//      응답을 기다리는 동안 시계가 여러 번 바뀌면 마지막 시각 하나만 들고 있다가, 응답이 온 뒤 그 시각으로 check 하나 (중간 시각은 보내지 않는다)
//      돌아온 응답은 화면에 반영한다 (보낸 뒤 시계가 바뀌었어도). 응답 뒤 다음 check가 나가기까지 기다림은 300ms 디바운스 이하로 본다(400ms 안)
//   ② 연습 중 지도 점(map-reh-dot) = fakePosition(지금 시계, 화면에 있는 응답의 핀·day.lodging) — 시계가 바뀐 그 차례에(서버 응답 전) 바뀐다.
//      서버 응답의 position 칸은 연습 점에 쓰지 않는다. 연습 카메라(rehearsalCamera)의 둘째 인자도 그 점. 카드·이유 줄은 응답이 와야 바뀐다
//   ④ 응답 day.lodging = null: 카드 T-08(testID card-T-08)을 그리지 않는다 · 지도 map-home 없음 · 실제 여행 첫 fit 좌표 = 핀만 ·
//      지도 실패 대체 그림(route-diagram)은 집 그림(route-home) 없이 핀만 · 연습 첫 check 위치 = 1번 장소(첫 일정 전)
//   가짜 서버 응답에서 lodging: null을 쓴다 (api-types는 백엔드 뒤 생성, 손으로 고치지 않는다)
//   재생·응답 지연은 jest 가짜 시계로 돌린다(실제로 몇 초 기다리지 않음). 연습에 들어가기까지는 진짜 시계 + 바로 오는 응답
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { locationFake } from '../test-support/expo-location-mock';
import { FakeServer, json, type Reply, type Sent } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay, SPOT } from '../test-support/planning-fixtures';
import { nowView, pins as basePins, t02, t03, t08 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const TODAY = 'day-t2';
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';
// 서버가 응답 position 칸에 넣는 값: 코스 어느 자리와도 먼 곳. 연습 점이 이 값이면 앱이 서버 값을 쓴 것 (②)
const SERVER_SPOT = { lat: 35.9, lng: 135.9 };
const LODGING = demoDay.lodging; // { lat: 35, lng: 135 }

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

const hhmmOf = (at: unknown) => {
  const found = /T(\d{2}:\d{2})/.exec(String(at));
  return found ? found[1] : '??:??';
};
const reasonFor = (at: unknown) => `서버_이유_${hhmmOf(at)}`;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// ---------- 공용 ----------

const REAL_TIMERS_KEEP = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate'] as const;

function freezeDate(iso: string) {
  jest.useFakeTimers({ now: Date.parse(iso), doNotFake: [...REAL_TIMERS_KEEP, 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
}
/** 연습에 들어간 뒤: setTimeout·setInterval도 가짜 시계로 (재생 1초·디바운스·응답 지연을 실제로 기다리지 않는다) */
function fakeClock() {
  jest.useFakeTimers({ now: Date.now(), doNotFake: [...REAL_TIMERS_KEEP] });
}
async function advance(ms: number, step = 50) {
  for (let passed = 0; passed < ms; passed += step) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - passed));
    });
  }
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

const withMap = () => {
  (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { googleMapsKeyPresent: true } };
};

type Host = { type: unknown; props: Record<string, any>; parent: Host | null; queryAll: (pick: (host: Host) => boolean) => Host[] };
const byId = (id: string) => screen.getByTestId(id) as unknown as Host;
const coordOf = (id: string) => byId(id).props.coordinate as { latitude: number; longitude: number };

// ---------- 가짜 서버: 연습 check 응답 방식 ----------

type Mode = { kind: 'now' } | { kind: 'manual' } | { kind: 'delay'; ms: number };
let server: FakeServer;
let mode: Mode;
let dayOver: object; // 응답 day (lodging을 바꿔 끼운다)
let viewOver: (sent: Sent | null) => object;
let inFlight = 0;
let maxInFlight = 0;
let waiting: { sent: Sent; resolve: () => void }[] = [];
const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;

const rehView = (sent: Sent | null) =>
  nowView({
    day: { ...demoDay, day_id: PLANNED, date: PLANNED_DATE, ...dayOver },
    at: sent ? body(sent).at : `${PLANNED_DATE}T10:00:00`,
    reason: reasonFor(sent ? body(sent).at : `${PLANNED_DATE}T10:00:00`),
    position: SERVER_SPOT,
    ...viewOver(sent),
  });

function checkReply(sent: Sent): Reply | Promise<Reply> {
  const reply = json(200, rehView(sent));
  if (mode.kind === 'now') return reply;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise<Reply>((done) => {
    const finish = () => {
      inFlight -= 1;
      done(reply);
    };
    if (mode.kind === 'delay') setTimeout(finish, mode.ms);
    else waiting.push({ sent, resolve: finish });
  });
}

const checks = () => server.requests.filter((r) => `${r.method} ${r.path}`.startsWith(`POST /days/${PLANNED}/check`));
const shownReason = (): string | null => {
  const found = within(screen.getByTestId('now-reason')).queryByText(/^서버_이유_/);
  return found ? String(found.props.children) : null;
};
/** 기다리는 응답 하나를 돌려준다 (가장 먼저 보낸 것부터) */
async function answerOldest() {
  const next = waiting.shift();
  if (!next) throw new Error('기다리는 check가 없다');
  await act(async () => {
    next.resolve();
  });
  await advance(0);
}

async function toRehearsal() {
  await startHome();
  await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  await settleAll();
  await waitFor(() => expect(checks().length).toBeGreaterThanOrEqual(1)); // 하루 시작 시각 첫 check (§10 Q13)
  await settleAll();
}

async function pressPlus() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('demo-plus-10'));
  });
}

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  (Constants as unknown as { expoConfig: unknown }).expoConfig = null;
  freezeDate(NOW_ISO);
  mode = { kind: 'now' };
  dayOver = {};
  viewOver = () => ({});
  inFlight = 0;
  maxInFlight = 0;
  waiting = [];
  server = new FakeServer().on(CURRENT, json(200, trip()));
  server.match(`GET /days/${PLANNED}/now`, () => json(200, rehView(null)));
  server.match(`POST /days/${PLANNED}/check`, (sent) => checkReply(sent));
  server.on(`GET /days/${PLANNED}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// ① 응답 처리: 동시에 하나만 · 최신 시각만 · 응답은 버리지 않는다
// =====================================================================

describe('§29 ① 연습 check는 하나씩, 기다리는 동안은 최신 시각 하나만', () => {
  test('T14_S29_1_응답을_기다리는_동안_10분을_여러_번_눌러도_check를_더_보내지_않는다', async () => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'manual' };
    const before = checks().length;
    await pressPlus(); // 10:10
    await advance(400);
    expect(checks().length).toBe(before + 1);
    for (let i = 0; i < 3; i += 1) {
      await pressPlus(); // 10:20 · 10:30 · 10:40
      await advance(400); // 디바운스(300)보다 길게 눌러도
    }
    expect(checks().length).toBe(before + 1);
    expect(maxInFlight).toBe(1);
  });

  test('T14_S29_1_응답이_오면_그동안_들고_있던_마지막_시각으로_한_번만_보낸다_중간_시각은_안_보낸다', async () => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'manual' };
    const before = checks().length;
    await pressPlus();
    await advance(400);
    for (let i = 0; i < 3; i += 1) {
      await pressPlus();
      await advance(400);
    }
    await answerOldest();
    await advance(400);
    const sentAfter = checks().slice(before).map((sent) => hhmmOf(body(sent).at));
    expect(sentAfter).toEqual(['10:10', '10:40']);
    expect(maxInFlight).toBe(1);
  });

  test('T14_S29_1_보낸_뒤_시계가_바뀌었어도_돌아온_응답은_화면에_반영한다', async () => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'manual' };
    await pressPlus();
    await advance(400);
    await pressPlus(); // 10:20을 들고 있는 동안 10:10 응답이 온다
    await advance(400);
    expect(shownReason()).toBe(reasonFor('T10:00'));
    await answerOldest();
    expect(shownReason()).toBe(reasonFor('T10:10')); // 버리지 않는다
    await advance(400);
    await answerOldest();
    expect(shownReason()).toBe(reasonFor('T10:20'));
  });

  test('T14_S29_1_10분_연타_800ms_응답이면_중간_화면이_보이고_마지막은_마지막_시각', async () => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'delay', ms: 800 };
    const seen = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      await pressPlus(); // 10:10 · 10:20 · 10:30 · 10:40, 400ms마다
      for (let t = 0; t < 400; t += 50) {
        await advance(50);
        const now = shownReason();
        if (now) seen.add(now);
      }
    }
    for (let t = 0; t < 4000; t += 50) {
      await advance(50);
      const now = shownReason();
      if (now) seen.add(now);
    }
    const middle = [...seen].filter((reason) => reason !== reasonFor('T10:00') && reason !== reasonFor('T10:40'));
    expect(middle.length).toBeGreaterThanOrEqual(1); // 한꺼번에 넘어가지 않고 중간 화면이 있었다
    expect(shownReason()).toBe(reasonFor('T10:40'));
    expect(maxInFlight).toBe(1);
  });

  // 재현: 폰에서 [▶ 재생]하면 시계만 가고 카드가 안 움직임 (§29). 재생 = 1초에 5분
  test.each([800, 1500])('T14_S29_1_재현_check_응답이_%sms_걸려도_재생_중에_카드가_실제로_바뀐다', async (ms) => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'delay', ms };
    await act(async () => {
      fireEvent.press(screen.getByTestId('demo-play'));
    });
    const seen: string[] = [];
    for (let t = 0; t < 6000; t += 50) {
      await advance(50);
      const now = shownReason();
      if (now && now !== seen[seen.length - 1]) seen.push(now);
    }
    // 6초 재생 = 시계 30분. 시작 화면 말고도 재생 중에 바뀐 화면이 둘 이상
    const changed = seen.filter((reason) => reason !== reasonFor('T10:00'));
    expect(changed.length).toBeGreaterThanOrEqual(2);
    // 보여 준 시각은 앞으로만 간다
    const shownMinutes = seen.map((reason) => minutesOf(reason.slice(-5)));
    expect([...shownMinutes].sort((a, b) => a - b)).toEqual(shownMinutes);
    expect(maxInFlight).toBe(1);
  });

  test('T14_S29_1_재생을_멈추면_마지막_응답_뒤_화면이_멈춘_시각을_따라잡는다', async () => {
    await toRehearsal();
    fakeClock();
    mode = { kind: 'delay', ms: 1500 };
    await act(async () => {
      fireEvent.press(screen.getByTestId('demo-play'));
    });
    await advance(4000);
    await act(async () => {
      fireEvent.press(screen.getByTestId('demo-play')); // 멈춤
    });
    await advance(5000);
    const last = checks()[checks().length - 1];
    expect(shownReason()).toBe(reasonFor(body(last).at));
    expect(within(screen.getByTestId('demo-time')).queryByText(hhmmOf(body(last).at))).not.toBeNull();
  });
});

// =====================================================================
// ② 연습 점은 앱 fake-position으로 바로, 카드는 응답을 기다린다
// =====================================================================

describe('§29 ② 연습 점은 시계가 바뀌는 즉시', () => {
  // 핀 1 D01 10:12~12:00(이동 12 → 출발 10:00) · 2 D20 12:20~14:00 · 3 D30 14:30~19:00, 숙소 (35, 135)
  const at1010 = { lat: LODGING.lat + ((SPOT.D01.lat - LODGING.lat) * 10) / 12, lng: LODGING.lng + ((SPOT.D01.lng - LODGING.lng) * 10) / 12 };

  async function mapRehearsal() {
    withMap();
    await toRehearsal();
    const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
    await act(async () => {
      fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 763 } } });
    });
    await settleAll();
  }

  test('T14_S29_2_10분을_누르면_응답_전에_점이_새_시각의_코스_자리로_간다', async () => {
    await mapRehearsal();
    fakeClock();
    mode = { kind: 'manual' };
    await pressPlus();
    await advance(50); // 디바운스(300) 전, 응답 전
    const dot = coordOf('map-reh-dot');
    expect(dot.latitude).toBeCloseTo(at1010.lat, 9);
    expect(dot.longitude).toBeCloseTo(at1010.lng, 9);
    expect(shownReason()).toBe(reasonFor('T10:00')); // 카드는 아직 그대로
  });

  test('T14_S29_2_응답이_와도_점은_서버_position이_아니라_앱이_계산한_자리', async () => {
    await mapRehearsal();
    expect(coordOf('map-reh-dot')).not.toEqual({ latitude: SERVER_SPOT.lat, longitude: SERVER_SPOT.lng });
    fakeClock();
    mode = { kind: 'manual' };
    await pressPlus();
    await advance(400);
    await answerOldest();
    expect(shownReason()).toBe(reasonFor('T10:10')); // 카드는 응답으로
    const dot = coordOf('map-reh-dot');
    expect(dot.latitude).toBeCloseTo(at1010.lat, 9);
    expect(dot.longitude).toBeCloseTo(at1010.lng, 9);
  });

  test('T14_S29_2_첫_화면의_점도_하루_시작_시각의_코스_자리_숙소', async () => {
    await mapRehearsal();
    const dot = coordOf('map-reh-dot');
    expect(dot.latitude).toBeCloseTo(LODGING.lat, 9); // 10:00 = 1번 출발 시각, 아직 숙소
    expect(dot.longitude).toBeCloseTo(LODGING.lng, 9);
  });

  test('T14_S29_2_연습_카메라도_응답_전에_그_점으로_계산한다', async () => {
    const cameraModule = require('@/now/rehearsal-camera');
    const spy = jest.spyOn(cameraModule, 'rehearsalCamera');
    await mapRehearsal();
    fakeClock();
    mode = { kind: 'manual' };
    await pressPlus();
    await advance(50);
    expect(spy).toHaveBeenCalled();
    const position = spy.mock.calls[spy.mock.calls.length - 1][1] as { lat: number; lng: number };
    expect(position.lat).toBeCloseTo(at1010.lat, 9);
    expect(position.lng).toBeCloseTo(at1010.lng, 9);
  });

  test('T14_S29_2_재생_중_1500ms_응답이어도_점은_매_초_움직인다', async () => {
    await mapRehearsal();
    fakeClock();
    mode = { kind: 'delay', ms: 1500 };
    await act(async () => {
      fireEvent.press(screen.getByTestId('demo-play'));
    });
    const lats: number[] = [];
    for (let t = 0; t < 3000; t += 500) {
      await advance(500);
      lats.push(coordOf('map-reh-dot').latitude);
    }
    // 10:00 -> 10:15: 숙소에서 1번(북쪽)으로 가는 중이라 위도가 3번 이상 바뀐다 (응답을 기다리지 않는다)
    expect(new Set(lats.map((v) => v.toFixed(9))).size).toBeGreaterThanOrEqual(3);
  });
});

// =====================================================================
// ④ 숙소 없음 (응답 day.lodging = null)
// =====================================================================

describe('§29 ④ 연습: 숙소 없음', () => {
  beforeEach(() => {
    dayOver = { lodging: null };
  });

  test('T14_S29_4_숙소_없으면_연습_첫_check_위치는_1번_장소', async () => {
    await toRehearsal();
    const first = checks()[0];
    expect(body(first).lat).toBeCloseTo(SPOT.D01.lat, 9);
    expect(body(first).lng).toBeCloseTo(SPOT.D01.lng, 9);
  });

  test('T14_S29_4_숙소_없으면_지도에_집_표시가_없고_점은_1번_장소', async () => {
    withMap();
    await toRehearsal();
    expect(screen.queryByTestId('map-home')).toBeNull();
    const dot = coordOf('map-reh-dot');
    expect(dot.latitude).toBeCloseTo(SPOT.D01.lat, 9);
    expect(dot.longitude).toBeCloseTo(SPOT.D01.lng, 9);
  });

  test('T14_S29_4_숙소_없으면_T_08을_그리지_않는다_보조든_메인이든', async () => {
    viewOver = () => ({ subs: [t02(), t08()] });
    await toRehearsal();
    expect(screen.queryByTestId('card-T-08')).toBeNull();
    expect(screen.getByTestId('now-main')).toBeTruthy();
  });

  test('T14_S29_4_숙소_없으면_메인이_T_08이어도_그리지_않고_화면은_깨지지_않는다', async () => {
    viewOver = () => ({ main: t08(), subs: [] });
    await toRehearsal();
    expect(screen.queryByTestId('card-T-08')).toBeNull();
    expect(screen.getByTestId('now-reason')).toBeTruthy();
  });

  test('T14_S29_4_경계_숙소가_있으면_T_08은_그대로_보이고_집_표시도_있다', async () => {
    dayOver = {};
    viewOver = () => ({ subs: [t02(), t08()] });
    withMap();
    await toRehearsal();
    expect(screen.getByTestId('card-T-08')).toBeTruthy();
    expect(screen.getByTestId('map-home')).toBeTruthy();
  });

  test('T14_S29_4_숙소_없어도_지도_실패_대체_그림은_집_없이_핀만_그린다', async () => {
    await toRehearsal(); // 지도 키 없음 = 대체 그림 (TASK-006 §7)
    expect(screen.getByTestId('map-fallback')).toBeTruthy();
    expect(screen.getByTestId('route-diagram')).toBeTruthy();
    expect(screen.queryByTestId('route-home')).toBeNull();
    for (const pin of basePins) {
      expect(screen.getByTestId(`route-stop-${pin.seq}`)).toBeTruthy();
      expect(screen.getByTestId(`fallback-stop-${pin.seq}`)).toBeTruthy();
    }
  });

  test('T14_S29_4_숙소_없어도_10분으로_마지막_뒤까지_가도_점은_마지막_장소', async () => {
    withMap();
    viewOver = (sent) => (sent && minutesOf(hhmmOf(body(sent).at)) >= 19 * 60 ? { main: t03({ items: [] }), subs: [], pins: basePins.map((pin) => ({ ...pin, state: 'done' })) } : {});
    await toRehearsal();
    fakeClock();
    for (let i = 0; i < 61; i += 1) await pressPlus(); // 10:00 + 610분 → 하루 끝 20:00에서 멈춤
    await advance(3000);
    const dot = coordOf('map-reh-dot');
    expect(dot.latitude).toBeCloseTo(SPOT.D30.lat, 9);
    expect(dot.longitude).toBeCloseTo(SPOT.D30.lng, 9);
  });
});

describe('§29 ④ 실제 여행(live): 숙소 없음', () => {
  const todayDay = { ...demoDay, day_id: TODAY, date: '2026-12-02', lodging: null };
  const HERE = { lat: 34.668713, lng: 135.501327 };

  beforeEach(() => {
    server.match(`GET /days/${TODAY}/now`, () => json(200, nowView({ day: todayDay, at: '2026-12-02T12:00:00' })));
    server.match(`POST /days/${TODAY}/check`, () => json(200, nowView({ day: todayDay, at: '2026-12-02T12:00:00' })));
  });

  async function openToday() {
    await startHome();
    await tap(await screen.findByTestId(`day-row-${TODAY}`));
    await screen.findByTestId('trip-now-screen');
    await screen.findByTestId('now-main');
    await settleAll();
  }

  test('T14_S29_4_실제_여행_첫_지도_맞춤에_숙소를_넣지_않는다_핀만', async () => {
    withMap();
    await openToday();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    const keys = mapControl.fits[0].coordinates.map((c) => `${c.latitude},${c.longitude}`).sort();
    expect(keys).toEqual(basePins.map((pin) => `${pin.lat},${pin.lng}`).sort());
    expect(screen.queryByTestId('map-home')).toBeNull();
  });

  test('T14_S29_4_경계_숙소가_있으면_실제_여행_첫_맞춤은_핀_+_숙소_그대로', async () => {
    const withLodging = { ...todayDay, lodging: LODGING };
    // FakeServer.match는 먼저 건 것이 이긴다 -> 앞의 match를 지우고 다시 건다
    server = new FakeServer().on(CURRENT, json(200, trip()));
    server.match(`GET /days/${TODAY}/now`, () => json(200, nowView({ day: withLodging, at: '2026-12-02T12:00:00' })));
    server.match(`POST /days/${TODAY}/check`, () => json(200, nowView({ day: withLodging, at: '2026-12-02T12:00:00' })));
    withMap();
    await openToday();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    const keys = mapControl.fits[0].coordinates.map((c) => `${c.latitude},${c.longitude}`).sort();
    expect(keys).toEqual([...basePins.map((pin) => `${pin.lat},${pin.lng}`), `${LODGING.lat},${LODGING.lng}`].sort());
  });

  test('T14_S29_4_숙소_없어도_실제_위치_모드는_기기_위치_점_그대로이고_깨지지_않는다', async () => {
    locationFake.permit('granted');
    withMap();
    await openToday();
    await act(async () => {
      locationFake.emit({ ...HERE, accuracy: 10, timestamp: Date.now() });
    });
    await settleAll();
    await waitFor(() => expect(screen.getByTestId('map-my-position')).toBeTruthy());
    expect(coordOf('map-my-position')).toEqual({ latitude: HERE.lat, longitude: HERE.lng });
    expect(screen.queryByTestId('map-reh-dot')).toBeNull();
    expect(screen.queryByTestId('map-home')).toBeNull();
  });

  test('T14_S29_4_숙소_없으면_실제_여행에서도_T_08을_그리지_않는다', async () => {
    server = new FakeServer().on(CURRENT, json(200, trip()));
    server.match(`GET /days/${TODAY}/now`, () => json(200, nowView({ day: todayDay, subs: [t02(), t08()] })));
    server.match(`POST /days/${TODAY}/check`, () => json(200, nowView({ day: todayDay, subs: [t02(), t08()] })));
    await openToday();
    expect(screen.queryByTestId('card-T-08')).toBeNull();
  });
});
