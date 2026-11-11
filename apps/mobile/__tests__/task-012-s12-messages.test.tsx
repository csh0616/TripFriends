/// <reference types="jest" />
// TASK-012 §12 1·6: 실패 안내 문장은 **모든 화면에서 같다**. 로직만 본다 (문장·[다시]·다시 보내기).
// 근거: TASK-012 §12 1(두 번째 401 · 503 STORAGE_UNAVAILABLE · 그 밖 500), §12 6(503 AUTH_UNAVAILABLE), §10 Q6·Q7·Q12, §6, API-001 인증·저장소 오류 줄.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   서버 응답 -> 화면 문장
//     401이 두 번(새로 받은 토큰으로 다시 보내도 401)  -> "로그인 정보를 확인하지 못했어"
//     503 STORAGE_UNAVAILABLE                         -> "지금 저장소에 못 붙었어"
//     503 AUTH_UNAVAILABLE (로그인 확인 서버에 못 붙음) -> "지금 연결이 안 돼. 잠시 뒤에 다시 해 줘"
//     500                                             -> "잠깐 문제가 생겼어"
//   화면: 첫 화면(GET /trips/current) · 여행 만들기(POST /trips) · 계획 대화(코스 짜기) · 여행 중(GET /now) · 고른 코스 읽기(GET course)
//     · 고정 일정 시트(POST fixed-events). 문장과 함께 [다시](retry-button)가 있고, 누르면 같은 요청을 다시 보내 이어 간다.
//     여행 만들기는 [다시]가 없으면 주 버튼으로 다시 보낸다 (500은 TASK-010 §6 그대로). 어느 쪽이든 입력값 그대로
//     고정 일정 시트는 지금처럼 시트 안 한 줄(fixed-banner) + 주 버튼으로 다시 보낸다 (시트 안 [다시] 단추는 정하지 않음 -> 질문)
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripDays } from '@/trips/trip-days';
import { CourseReadonly } from '@/trips/course-readonly';

import { apiError, FakeServer, json, type Reply } from '../test-support/fake-server';
import { happyServer, pressId, pressText, R, resetDevice, tap, toP2, toS9 } from '../test-support/planning-driver';
import { course } from '../test-support/planning-fixtures';
import { ENTER, nowServer } from '../test-support/trip-now-driver';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const CREATE = 'POST /trips';
const NO_TRIP = apiError(404, 'NOT_FOUND', { resource: 'trip' });
const unauthorized = () => apiError(401, 'UNAUTHORIZED');

const CASES: [string, Reply[], string][] = [
  ['두_번째도_401', [unauthorized(), unauthorized()], '로그인 정보를 확인하지 못했어'],
  ['503_STORAGE_UNAVAILABLE', [apiError(503, 'STORAGE_UNAVAILABLE')], '지금 저장소에 못 붙었어'],
  ['503_AUTH_UNAVAILABLE', [apiError(503, 'AUTH_UNAVAILABLE')], '지금 연결이 안 돼. 잠시 뒤에 다시 해 줘'],
  ['500', [apiError(500, 'INTERNAL_ERROR')], '잠깐 문제가 생겼어'],
];

const DATES = ['2026-12-11', '2026-12-12', '2026-12-13'];
const tripDay = (n: number, state: string) => ({
  day_id: `d${n}`,
  date: DATES[n - 1],
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
  summary: state === 'planning' ? null : { end_time: '18:30', place_count: 3, move_min: 40 },
  must_visits: [] as unknown[],
});
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: DATES[0],
  end_date: DATES[2],
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: [tripDay(1, 'planned'), tripDay(2, 'planning'), tripDay(3, 'planning')],
};

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

const wrap = (node: React.ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

function startHome() {
  const Index = require('@/app/index').default;
  return wrap(<Index />);
}

const queue = (server: FakeServer, route: string, replies: Reply[]) => replies.forEach((reply) => server.once(route, reply));

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(CASES)('§12 %s', (_name, replies, message) => {
  test('T12_S12_첫_화면', async () => {
    const server = new FakeServer();
    queue(server, CURRENT, replies);
    server.on(CURRENT, json(200, TRIP));
    await startHome();
    expect(await screen.findByText(message)).toBeTruthy();
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('day-row-d2')).toBeTruthy();
  });

  test('T12_S12_여행_만들기_입력값_그대로', async () => {
    freezeDate('2026-12-02T03:00:00Z');
    const server = new FakeServer().on(CURRENT, NO_TRIP);
    queue(server, CREATE, replies);
    server.on(CREATE, json(201, TRIP));
    await startHome();
    await tap(await screen.findByText('여행 만들기'));
    await tap(await screen.findByTestId('field-start-date'));
    await tap(await screen.findByTestId('cal-day-2026-12-10'));
    await tap(await screen.findByTestId('cal-day-2026-12-11'));
    await tap(screen.getByTestId('calendar-confirm'));
    await settleAll();
    await tap(screen.getByTestId('create-trip-submit'));
    expect(await screen.findByText(message)).toBeTruthy();
    const before = server.sent(CREATE).length;
    const retry = screen.queryByTestId('retry-button'); // 500은 지금처럼 주 버튼으로 다시 보내도 된다 (TASK-010 §6)
    if (retry) await tap(retry);
    await settleAll();
    if (server.sent(CREATE).length === before) await tap(screen.getByTestId('create-trip-submit'));
    await waitFor(() => expect(server.sent(CREATE).length).toBe(before + 1));
    expect(server.sent(CREATE).at(-1)!.body).toEqual(server.sent(CREATE)[0].body);
  });

  test('T12_S12_계획_대화_코스_짜기', async () => {
    const server = happyServer();
    await toP2();
    queue(server, R.compose, replies);
    await pressId('compose-button');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByText('코스 짜 봤어')).toBeTruthy();
  });

  test('T12_S12_여행_중_화면', async () => {
    const control = nowServer();
    replies.forEach((reply) => control.once(reply));
    await toS9();
    await pressText(ENTER);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByTestId('sos-button')).toBeTruthy(); // 실패해도 SOS 자리 그대로
    await pressId('retry-button');
    expect(await screen.findByTestId('now-main')).toBeTruthy();
  });

  test('T12_S12_고른_코스_읽기', async () => {
    const server = new FakeServer();
    queue(server, 'GET /days/d1/course', replies);
    server.on('GET /days/d1/course', json(200, course().options[0]));
    await wrap(<CourseReadonly dayId="d1" date={DATES[0]} number={1} onBack={() => {}} />);
    expect(await screen.findByText(message)).toBeTruthy();
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('course-readonly')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
  });

  test('T12_S12_고정_일정_시트', async () => {
    freezeDate('2026-11-06T03:00:00Z');
    const route = `POST /trips/${TRIP.trip_id}/fixed-events`;
    const server = new FakeServer();
    queue(server, route, replies);
    server.on(route, json(201, { fixed_event_id: 'fe-1', trip_day_id: 'd2', title: '저녁 예약', start_at: '2026-12-12T18:30:00+09:00', end_at: '2026-12-12T20:00:00+09:00', place_id: null }));
    await wrap(<TripDays trip={TRIP as never} onOpen={jest.fn()} onTripChange={() => {}} onNewTrip={() => {}} />);
    await tap(screen.getByTestId('add-fixed-d2'));
    await fireEvent.changeText(await screen.findByTestId('fixed-title'), '저녁 예약');
    await fireEvent.changeText(screen.getByTestId('fixed-start'), '18:30');
    await fireEvent.changeText(screen.getByTestId('fixed-end'), '20:00');
    await settleAll();
    await tap(screen.getByTestId('fixed-submit'));
    expect(await screen.findByText(message)).toBeTruthy();
    const before = server.sent(route).length;
    await tap(screen.getByTestId('fixed-submit')); // 입력값 그대로 다시
    await waitFor(() => expect(server.sent(route).length).toBe(before + 1));
    expect(server.sent(route).at(-1)!.body).toEqual(server.sent(route)[0].body);
  });
});
