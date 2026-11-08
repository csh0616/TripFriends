/// <reference types="jest" />
// TASK-011 A1 날짜 목록 + B2 알약 아이콘 + AC-3(주황 면). 로직·가드레일만 본다 (크기·간격·색 모습은 디자이너 재검수 몫).
// 근거: TASK-011 §A A0·A1·§B B2·§6·AC-2·AC-3, DESIGN-001 §4-11(날짜 목록·알약), task-011-review.md §2 3·5·11·13번 줄, §1 PM 답 1·4.
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   TripDays는 오늘을 도시 시계(cityToday(Date.now()))로 읽는다. props는 지금 그대로 (trip, onOpen, onTripChange, onNewTrip)
//   아래 큰 버튼 testID `bottom-primary` (dayListPrimary가 null이면 없음). 글자 = label, 밑 한 줄 = sublabel
//     누르면 onOpen(그날, dayDestination(그날 state, 고른 코스 있음))
//   계획 전 카드 안 버튼: [같이 고르기] `card-plan-{day_id}`, [알아서 짜 줘] `card-auto-{day_id}`
//     [알아서 짜 줘]는 "지금 할 일 카드"(아래 큰 버튼이 가리키는 계획 전 날)에만. 그 밖 계획 전 날은 [같이 고르기]만
//     오늘인데 코스 없음 = 계획 전으로 보고 [같이 고르기]가 있다 (PM 답 1). 계획 완료·지난 날·오늘(코스 있음)에는 없다
//     카드 [같이 고르기]를 누르면 onOpen(그날, 'planning')
//   알약 아이콘 상자 `day-pill-icon-{day_id}`: 네 알약 모두 알약 안에. 계획 전의 점선 원 `day-pill-dot-{day_id}`는 그 상자 안
//   머리: tripHeader의 title·line 글자가 화면에 보인다
//   AC-3: 화면 전체에서 바탕이 brand인 상자는 bottom-primary 하나 이하 (카드 안 버튼에 주황 0)
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripDays } from '@/trips/trip-days';

import { COLORS } from '../test-support/design-table';
import { apiError, FakeServer, networkDown } from '../test-support/fake-server';
import { resetDevice } from '../test-support/planning-driver';
import { filledWith, isInside, pressableOf, styleOf, type Host } from '../test-support/screen-tree';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };

type State = 'planning' | 'planned' | 'today' | 'past';
const DATES = ['2026-12-11', '2026-12-12', '2026-12-13']; // 금 · 토 · 일
const tripDay = (n: number, state: State, chosen = state !== 'planning') => ({
  day_id: `d${n}`,
  date: DATES[n - 1],
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
});
const trip = (...days: ReturnType<typeof tripDay>[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: DATES[0],
  end_date: DATES[2],
  lodging_place_id: null,
  status: 'active',
  trip_days: days,
});

// 도쿄 정오로 시계를 고정한다 (도시 시간대의 오늘)
const AT = {
  before: '2026-11-06T03:00:00Z', // 11/06 -> D-35
  day1: '2026-12-11T03:00:00Z',
  day2: '2026-12-12T03:00:00Z',
  after: '2026-12-20T03:00:00Z',
};

// 여행 전, 계획 전·계획 완료 섞임 (§D 스크린샷 1번 상황)
const MIXED = trip(tripDay(1, 'planned'), tripDay(2, 'planning'), tripDay(3, 'planning'));
const ALL_PLANNED = trip(tripDay(1, 'planned'), tripDay(2, 'planned'), tripDay(3, 'planned'));
const ALL_PAST = trip(tripDay(1, 'past'), tripDay(2, 'past'), tripDay(3, 'past', false));
const TODAY_WITH_COURSE = trip(tripDay(1, 'past'), tripDay(2, 'today', true), tripDay(3, 'planning'));
const TODAY_NO_COURSE = trip(tripDay(1, 'past'), tripDay(2, 'today', false), tripDay(3, 'planned'));

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

async function show(value: object, at: string, onOpen: jest.Mock = jest.fn()) {
  freezeDate(at);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripDays trip={value as never} onOpen={onOpen} onTripChange={() => {}} onNewTrip={() => {}} />
    </SafeAreaProvider>,
  );
  return onOpen;
}

const byId = (id: string) => screen.getByTestId(id) as unknown as Host;
const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- A0·A1 아래 큰 버튼 (review 13번 줄, AC-2) ----------

describe('A1 아래 큰 버튼 bottom-primary', () => {
  test('T11_A1_여행_전이면_다음_계획_전_날의_같이_고르기와_어느_날인지_한_줄', async () => {
    await show(MIXED, AT.before);
    const button = screen.getByTestId('bottom-primary');
    expect(within(button).getByText('같이 고르기')).toBeTruthy();
    expect(screen.getByText('2일째 · 12/12 토')).toBeTruthy();
  });

  test('T11_A1_같이_고르기를_누르면_그날_계획_대화', async () => {
    const onOpen = await show(MIXED, AT.before);
    await press('bottom-primary');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ day_id: 'd2' });
    expect(onOpen.mock.calls[0][1]).toBe('planning');
  });

  test('T11_A1_오늘_여행_중이면_오늘_여행_보기_누르면_여행_중_화면', async () => {
    const onOpen = await show(TODAY_WITH_COURSE, AT.day2);
    expect(within(screen.getByTestId('bottom-primary')).getByText('오늘 여행 보기')).toBeTruthy();
    expect(within(screen.getByTestId('bottom-primary')).queryByText('같이 고르기')).toBeNull();
    await press('bottom-primary');
    expect(onOpen.mock.calls[0][0]).toMatchObject({ day_id: 'd2' });
    expect(onOpen.mock.calls[0][1]).toBe('now');
  });

  test('T11_S6_오늘인데_코스가_없으면_오늘_여행_보기를_눌러도_계획_대화', async () => {
    const onOpen = await show(TODAY_NO_COURSE, AT.day2);
    expect(within(screen.getByTestId('bottom-primary')).getByText('오늘 여행 보기')).toBeTruthy();
    await press('bottom-primary');
    expect(onOpen.mock.calls[0][0]).toMatchObject({ day_id: 'd2' });
    expect(onOpen.mock.calls[0][1]).toBe('planning');
  });

  test('T11_A1_모두_계획_완료면_주_버튼이_없다', async () => {
    await show(ALL_PLANNED, AT.before);
    expect(screen.queryByTestId('bottom-primary')).toBeNull();
    expect(screen.queryByText('같이 고르기')).toBeNull();
  });

  test('T11_A1_지난_날만_남으면_주_버튼이_없다', async () => {
    await show(ALL_PAST, AT.after);
    expect(screen.queryByTestId('bottom-primary')).toBeNull();
  });

  test('T11_A1_여행_시작_버튼은_없다(review_13번_줄)', async () => {
    await show(MIXED, AT.before);
    expect(screen.queryByText('여행 시작')).toBeNull();
  });
});

// ---------- §6 날짜 목록 불러오기 실패: 기존 오류 처리 그대로, 주 버튼 없음 ----------

describe('§6 날짜 목록을 못 불러오면 주 버튼 없음', () => {
  async function startHome() {
    const Index = require('@/app/index').default;
    return render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
  }

  test.each([
    ['서버 오류', apiError(500, 'INTERNAL')],
    ['연결 끊김', networkDown],
  ])('T11_S6_%s면_bottom_primary가_없다', async (_name, reply) => {
    resetDevice();
    new FakeServer().on('GET /trips/current', reply);
    await startHome();
    await screen.findByTestId('home-create'); // 기존 오류 처리 (빈 첫 화면 + 안내) 그대로
    expect(screen.queryByTestId('bottom-primary')).toBeNull();
  });
});

// ---------- A1 계획 전 카드 안 버튼 (review 3번 줄, PM 답 1·7) ----------

describe('A1 카드 안 버튼', () => {
  test('T11_A1_지금_할_일_카드에는_같이_고르기와_알아서_짜_줘', async () => {
    await show(MIXED, AT.before);
    const row = screen.getByTestId('day-row-d2');
    expect(within(row).getByTestId('card-plan-d2')).toBeTruthy();
    expect(within(row).getByTestId('card-auto-d2')).toBeTruthy();
    expect(within(screen.getByTestId('card-plan-d2')).getByText('같이 고르기')).toBeTruthy();
    expect(within(screen.getByTestId('card-auto-d2')).getByText('알아서 짜 줘')).toBeTruthy();
  });

  test('T11_A1_그_밖의_계획_전_카드는_같이_고르기만', async () => {
    await show(MIXED, AT.before);
    expect(within(screen.getByTestId('day-row-d3')).getByTestId('card-plan-d3')).toBeTruthy();
    expect(screen.queryByTestId('card-auto-d3')).toBeNull();
  });

  test('T11_A1_알아서_짜_줘는_화면에_하나뿐', async () => {
    await show(trip(tripDay(1, 'planning'), tripDay(2, 'planning'), tripDay(3, 'planning')), AT.before);
    expect(screen.queryAllByTestId(/^card-auto-/).map((node) => node.props.testID)).toEqual(['card-auto-d1']);
  });

  test.each([
    ['계획 완료', MIXED, AT.before, 'd1'],
    ['지난 날', TODAY_WITH_COURSE, AT.day2, 'd1'],
    ['오늘(코스 있음)', TODAY_WITH_COURSE, AT.day2, 'd2'],
  ])('T11_A1_%s_줄에는_카드_안_버튼이_없다', async (_name, value, at, dayId) => {
    await show(value, at);
    expect(screen.queryByTestId(`card-plan-${dayId}`)).toBeNull();
    expect(screen.queryByTestId(`card-auto-${dayId}`)).toBeNull();
  });

  test('T11_A1_오늘인데_코스_없음이면_카드_안에_같이_고르기(PM_답_1)', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    expect(within(screen.getByTestId('day-row-d2')).getByTestId('card-plan-d2')).toBeTruthy();
  });

  test('T11_A1_카드_같이_고르기를_누르면_그날_계획_대화', async () => {
    const onOpen = await show(MIXED, AT.before);
    await press('card-plan-d3');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ day_id: 'd3' });
    expect(onOpen.mock.calls[0][1]).toBe('planning');
  });
});

// ---------- AC-3 주황 면 = 주 버튼 하나 이하, 카드 안 버튼 주황 0 ----------

describe('AC-3 날짜 목록의 주황', () => {
  test.each([
    ['여행 전 섞임', MIXED, AT.before, true],
    ['오늘 여행 중', TODAY_WITH_COURSE, AT.day2, true],
    ['오늘인데 코스 없음', TODAY_NO_COURSE, AT.day2, true],
    ['모두 계획 완료', ALL_PLANNED, AT.before, false],
    ['지난 날만', ALL_PAST, AT.after, false],
  ])('T11_AC3_%s_주황_바탕은_bottom_primary_하나뿐', async (_name, value, at, hasPrimary) => {
    await show(value, at);
    const orange = filledWith(COLORS.brand);
    if (!hasPrimary) {
      expect(orange).toEqual([]);
      return;
    }
    const primary = byId('bottom-primary');
    expect(orange.length).toBeGreaterThanOrEqual(1);
    for (const host of orange) expect(isInside(host, primary) || isInside(primary, host)).toBe(true);
    expect(orange.filter((host) => typeof host.props.onClick === 'function')).toHaveLength(1);
  });

  test('T11_AC3_카드_안_버튼에는_주황이_없다', async () => {
    await show(trip(tripDay(1, 'planning'), tripDay(2, 'planning'), tripDay(3, 'planning')), AT.before);
    const inCards = screen.queryAllByTestId(/^card-(plan|auto)-/) as unknown as Host[];
    expect(inCards.length).toBeGreaterThanOrEqual(4); // d1 둘 + d2·d3 하나씩
    for (const node of inCards) {
      expect(filledWith(COLORS.brand, node)).toEqual([]);
      expect(styleOf(pressableOf(node)).backgroundColor).not.toBe(COLORS.brand);
    }
  });

  test('T11_AC3_bottom_primary_글자는_on_brand(주황_위_흰_글자_금지)', async () => {
    await show(MIXED, AT.before);
    const label = within(screen.getByTestId('bottom-primary')).getByText('같이 고르기') as unknown as Host;
    expect(String(styleOf(label).color).toUpperCase()).toBe(COLORS['on-brand']);
  });
});

// ---------- A1 머리 (review 5번 줄) ----------

describe('A1 머리', () => {
  test('T11_A1_머리는_오사카_2박_3일과_D-35_진행', async () => {
    await show(MIXED, AT.before);
    expect(screen.getByText('오사카 2박 3일')).toBeTruthy();
    expect(screen.getByText('D-35 · 3일 중 1일 계획 완료')).toBeTruthy();
    expect(screen.queryByText('오사카 여행')).toBeNull();
  });

  test('T11_A1_여행_중이면_머리에_D-숫자_대신_여행_중', async () => {
    await show(TODAY_WITH_COURSE, AT.day2);
    expect(screen.getByText(/^여행 중 · 3일 중 \d일 계획 완료$/)).toBeTruthy();
    expect(screen.queryByText(/^D-\d+/)).toBeNull();
  });

  test('T11_A1_머리에_친구랑이_없다(FR-01에_칸_없음)', async () => {
    await show(MIXED, AT.before);
    expect(screen.queryByText(/친구랑/)).toBeNull();
  });
});

// ---------- B2 알약 아이콘 4개 (review 11번 줄) ----------

describe('B2 알약 아이콘', () => {
  // 네 상태가 한 화면에: d1 지난 날, d2 오늘, d3 계획 완료 + 계획 전 하나를 더한다
  const FOUR = {
    ...trip(tripDay(1, 'past'), tripDay(2, 'today', true), tripDay(3, 'planned')),
    end_date: '2026-12-14',
    trip_days: [tripDay(1, 'past'), tripDay(2, 'today', true), tripDay(3, 'planned'), { ...tripDay(3, 'planning'), day_id: 'd4', date: '2026-12-14' }],
  };

  test.each(['d1', 'd2', 'd3', 'd4'])('T11_B2_%s_알약_안에_아이콘_상자가_있다', async (dayId) => {
    await show(FOUR, AT.day2);
    expect(within(screen.getByTestId(`day-pill-${dayId}`)).getByTestId(`day-pill-icon-${dayId}`)).toBeTruthy();
  });

  test('T11_B2_계획_전_점선_원은_아이콘_상자_안', async () => {
    await show(FOUR, AT.day2);
    expect(within(screen.getByTestId('day-pill-icon-d4')).getByTestId('day-pill-dot-d4')).toBeTruthy();
  });

  test('T11_B2_알약_글자는_그대로(지난_날·오늘_·_여행_중)', async () => {
    await show(FOUR, AT.day2);
    expect(within(screen.getByTestId('day-pill-d1')).getByText('지난 날')).toBeTruthy();
    expect(within(screen.getByTestId('day-pill-d2')).getByText('오늘 · 여행 중')).toBeTruthy();
  });
});
