/// <reference types="jest" />
// TASK-010 §12 답 3 (앱): 계획 완료·지난 날 = 고른 코스 읽기만, 계획 대화의 "‹ 날짜" 뒤로 -> 날짜 목록, 대화 상태 유지.
// 근거: TASK-010 §12 답 3, §C3, DESIGN-001 §4-9(지난 날 = 읽기만), TASK-004(GET 이어 가기). 모습(색·간격)은 시험하지 않는다.
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   planned·past 날 줄을 누르면 GET /days/{day_id}/course (헤더 X-Device-Id). 응답 = 코스안 카드와 같은 모양 (CourseResultOption)
//     읽기만 화면 testID `course-readonly`: 코스 줄은 코스안 카드와 같은 `course-row-{seq}`.
//     없는 것: 머무는 시간 조정(`stay-minus-*`·`stay-plus-*`), 확정(`select-confirm`, "이걸로 할래"), "다시 계획할래", 다른 안 탭(`option-*`)
//   계획 대화 머리 뒤로 = 기존 머리 뒤로 단추 `header-back`, 글자 "날짜" (TASK-011 back-day: ‹는 아이콘 20, 글자는 "날짜". 주황 아님)
//     누르면 날짜 목록. 같은 날을 다시 누르면 새 세션을 만들지 않고 GET /planning/{session_id}로 이어 간다
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FakeServer, json } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { course, relaxed, session, SID } from '../test-support/planning-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z';

const tripDay = (n: number, state: string, chosen: boolean) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
});
const FOUR = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging_place_id: null,
  status: 'active',
  trip_days: [tripDay(1, 'past', true), tripDay(2, 'today', true), tripDay(3, 'planned', true), tripDay(4, 'planning', false)],
};
const CHOSEN = relaxed('opt-3');

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

async function startHome() {
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

let server: FakeServer;

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer().on(CURRENT, json(200, FOUR));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- 고른 코스 읽기만 ----------

describe('§12 답 3 고른 코스 읽기만', () => {
  test.each([
    ['day-t3', '계획 완료'],
    ['day-t1', '지난 날'],
  ])('T10_S12_%s(%s)는_GET_course로_고른_코스를_읽기만', async (dayId) => {
    server.on(`GET /days/${dayId}/course`, json(200, CHOSEN));
    await startHome();
    await tap(await screen.findByTestId(`day-row-${dayId}`));
    const view = await screen.findByTestId('course-readonly');
    const sent = server.sent(`GET /days/${dayId}/course`);
    expect(sent).toHaveLength(1);
    expect((server.headers(sent[0])['x-device-id'] ?? '').length).toBeGreaterThan(0);
    for (const item of CHOSEN.items as { seq: number }[]) expect(within(view).getByTestId(`course-row-${item.seq}`)).toBeTruthy();
  });

  test.each(['day-t3', 'day-t1'])('T10_S12_%s_읽기만_화면에는_바꾸는_단추가_없다', async (dayId) => {
    server.on(`GET /days/${dayId}/course`, json(200, CHOSEN));
    await startHome();
    await tap(await screen.findByTestId(`day-row-${dayId}`));
    await screen.findByTestId('course-readonly');
    expect(screen.queryAllByTestId(/^stay-(minus|plus)-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^option-/)).toEqual([]);
    expect(screen.queryByTestId('select-confirm')).toBeNull();
    expect(screen.queryByText('이걸로 할래')).toBeNull();
    expect(screen.queryByText(/다시 계획할래/)).toBeNull();
    expect(server.requests.filter((r) => r.method === 'POST')).toEqual([]); // 아무것도 바꾸지 않는다
  });

  test('T10_S12_읽기만_화면에서_날짜_목록으로_돌아간다', async () => {
    server.on('GET /days/day-t3/course', json(200, CHOSEN));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t3'));
    await screen.findByTestId('course-readonly');
    await tap(screen.getByTestId('header-back'));
    expect(await screen.findByTestId('day-row-day-t4')).toBeTruthy();
  });
});

// ---------- 계획 대화에서 "‹ 날짜" ----------

describe('§12 답 3 계획 대화에서 나가기', () => {
  beforeEach(() => {
    server.on('POST /days/day-t4/planning', json(201, session)).on(`GET /planning/${SID}`, json(200, session));
  });

  test('T10_S12_계획_대화_머리에_‹_날짜_뒤로', async () => {
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    const back = await screen.findByTestId('header-back');
    expect(within(back).getByText('날짜')).toBeTruthy(); // TASK-011 back-day: ‹는 아이콘
  });

  test('T10_S12_‹_날짜를_누르면_날짜_목록', async () => {
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await tap(await screen.findByTestId('header-back'));
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(screen.getByTestId('day-row-day-t4')).toBeTruthy();
  });

  test('T10_S12_같은_날로_다시_들어가면_새로_만들지_않고_GET으로_이어_간다', async () => {
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await waitFor(() => expect(server.sent('POST /days/day-t4/planning')).toHaveLength(1));
    await tap(await screen.findByTestId('header-back'));
    const before = server.sent(`GET /planning/${SID}`).length;
    await tap(await screen.findByTestId('day-row-day-t4'));
    await waitFor(() => expect(server.sent(`GET /planning/${SID}`).length).toBeGreaterThan(before));
    await settleAll();
    expect(server.sent('POST /days/day-t4/planning')).toHaveLength(1);
  });
});

// ---------- §13 질문 답 2: 코스안(P3)에서도 "‹ 날짜" ----------

describe('§13 코스안에서 나가기', () => {
  test('T10_S13_Q2_코스안_머리에도_‹_날짜_누르면_날짜_목록', async () => {
    // 그날 세션이 코스안 단계에 있다 (자동 모드 시작 응답 = CourseResult)
    server.on('POST /days/day-t4/planning', json(201, course())).on(`GET /planning/${SID}`, json(200, course()));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await screen.findByTestId('option-relaxed');
    const back = await screen.findByTestId('header-back');
    expect(within(back).getByText('날짜')).toBeTruthy(); // TASK-011 back-day: ‹는 아이콘
    await tap(back);
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
  });
});
