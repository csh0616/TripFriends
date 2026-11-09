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
//   §9 v1.1:
//     Q1 [새 여행 만들기] `new-trip` = btn-new-trip (bg-2 바탕, 높이 52 이상)
//     Q2 고른 코스가 있는 날(계획 완료·지난 날) 줄에 요약 "18:30 끝 · 8곳 · 이동 125분" (서버 summary 그대로). 계획 전 카드에 꼭 갈 곳 이름
//        날짜 목록을 그릴 때 GET /days/{id}/course 를 부르지 않는다
//     Q3 카드 [알아서 짜 줘]를 누르면 바로 POST /days/{id}/planning {mode: 'auto'} -> 코스안(`option-relaxed`). 오늘인데 코스 없는 카드도 버튼 둘
//     Q4 [오늘 여행 보기] 밑 줄 "2일째 · 12/12 토"
//   §12 Q1 머리 제목 = title-trip 값 · Q3 코스 없는 지난 날 = 누를 수 없는 줄 testID `row-locked`(또는 `row-locked-{day_id}`):
//     요약 자리 "고른 코스 없음", › 없음, 누를 수 없음 표시, 눌러도 onOpen·GET course 없음
//   §10 E1: 주 버튼이 없으면(모든 날 계획 완료·지난 날) 마지막 날 줄 아래 `end-note` 끝맺음 글, 그 아래 맨 끝 [새 여행 만들기]
//   §14 (재검수, 승인 대기):
//     8  이웃한 날 줄 사이 간격 = 둘을 담은 상자의 gap(rowGap) + 앞 줄 아래 여백 + 뒷 줄 위 여백 = 12
//     N1 화면 나무 순서: 표지(accessibilityLabel "오사카 표지") -> 머리 글(제목·진행 줄) -> 첫 날 줄
//     N2 지금 할 날 카드(아래 큰 버튼이 가리키는 계획 전 카드) 바탕 = brand-soft. 주황 링(테두리 굵기 > 0 + brand)은 state 'today' 줄에만.
//        다른 계획 전 카드 바탕 = bg-2. 바탕·링은 day-row-{id}의 눌리는 상자 스타일
//     N3 계획 전 카드: 고정 일정이 없으면 글자 "고정 일정 없음"과 [+ 일정] `add-fixed-{id}`가 같은 가로 줄(가장 가까운 공통 상자 flexDirection row), 글자가 앞(왼쪽).
//        고정 일정이 하나 있으면 "고정 일정 없음" 대신 그 시각(엔 대시)·제목이 [+ 일정]과 같은 가로 줄
//     9-5 모든 지난 날이 "고른 코스 없음"이면 end-note는 제목 "여행이 끝났어"만 (설명 줄 없음)
//         › 아이콘 `day-chevron-{id}`: 코스가 있는 계획 완료·지난 날 줄에만, row-locked에는 없음
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripDays } from '@/trips/trip-days';

import { COLORS, FIT } from '../test-support/design-table';
import { apiError, FakeServer, json, networkDown } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { course, SID } from '../test-support/planning-fixtures';
import { childOn, commonAncestor, filledWith, isInside, pressableOf, same, styleOf, treeIndex, type Host } from '../test-support/screen-tree';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };

type State = 'planning' | 'planned' | 'today' | 'past';
const DATES = ['2026-12-11', '2026-12-12', '2026-12-13']; // 금 · 토 · 일
// §9 Q2: 서버가 날마다 summary(고른 코스가 있을 때)와 must_visits를 함께 준다
const SUMMARY = { end_time: '18:30', place_count: 8, move_min: 125 }; // §4-11 요약 줄의 예
const SUMMARY_TEXT = '18:30 끝 · 8곳 · 이동 125분';
const MUST = [{ place_id: 'osaka-fake-kuromon', name: '구로몬 시장' }];
const tripDay = (n: number, state: State, chosen = state !== 'planning') => ({
  day_id: `d${n}`,
  date: DATES[n - 1],
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
  summary: chosen ? SUMMARY : null,
  must_visits: MUST,
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
    expect(screen.getByText('2일째 · 12/12 토')).toBeTruthy(); // §9 Q4
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

  test('T11_Q3_오늘인데_코스_없음이면_카드_안에_같이_고르기와_알아서_짜_줘', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    expect(within(screen.getByTestId('day-row-d2')).getByTestId('card-plan-d2')).toBeTruthy();
    expect(within(screen.getByTestId('day-row-d2')).getByTestId('card-auto-d2')).toBeTruthy();
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

// ---------- §9 v1.1 Q1·Q2·Q3 ----------

describe('§9 Q1 [새 여행 만들기]는 btn-new-trip', () => {
  test('T11_Q1_바탕은_bg_2_높이_52_이상', async () => {
    await show(ALL_PLANNED, AT.before);
    const button = pressableOf(byId('new-trip'));
    const style = styleOf(button);
    expect(String(style.backgroundColor).toUpperCase()).toBe(COLORS['bg-2']);
    expect(Math.max(...[style.height, style.minHeight].filter((v): v is number => typeof v === 'number'))).toBeGreaterThanOrEqual(52);
    expect(within(screen.getByTestId('new-trip')).getByText('새 여행 만들기')).toBeTruthy();
  });
});

describe('§9 Q2 날 요약과 꼭 갈 곳 (서버 값 그대로)', () => {
  test.each([
    ['계획 완료', MIXED, AT.before, 'd1'],
    ['지난 날', TODAY_WITH_COURSE, AT.day2, 'd1'],
  ])('T11_Q2_%s_줄에_요약_한_줄', async (_name, value, at, dayId) => {
    await show(value, at);
    expect(within(screen.getByTestId(`day-row-${dayId}`)).getByText(SUMMARY_TEXT)).toBeTruthy();
  });

  test('T11_Q2_요약은_서버_숫자를_그대로', async () => {
    const other = { ...tripDay(1, 'planned'), summary: { end_time: '21:05', place_count: 3, move_min: 0 } };
    await show(trip(other, tripDay(2, 'planning'), tripDay(3, 'planning')), AT.before);
    expect(within(screen.getByTestId('day-row-d1')).getByText('21:05 끝 · 3곳 · 이동 0분')).toBeTruthy();
  });

  test('T11_Q2_계획_전_카드에는_요약이_없고_꼭_갈_곳_이름', async () => {
    await show(MIXED, AT.before);
    const row = within(screen.getByTestId('day-row-d2'));
    expect(row.queryByText(/끝 · \d+곳/)).toBeNull();
    expect(row.getByText(/구로몬 시장/)).toBeTruthy();
  });

  test('T11_Q2_꼭_갈_곳이_없으면_그_줄이_없다', async () => {
    await show(trip(tripDay(1, 'planned'), { ...tripDay(2, 'planning'), must_visits: [] }, tripDay(3, 'planning')), AT.before);
    expect(within(screen.getByTestId('day-row-d2')).queryByText(/구로몬 시장/)).toBeNull();
  });

  test('T11_Q2_걷기_km는_쓰지_않는다', async () => {
    await show(MIXED, AT.before);
    expect(screen.queryByText(/km/)).toBeNull();
  });
});

describe('§9 Q2·Q3 첫 화면 흐름', () => {
  async function startHome() {
    const Index = require('@/app/index').default;
    return render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
  }

  test('T11_Q2_날짜_목록은_코스를_따로_부르지_않는다', async () => {
    resetDevice();
    freezeDate(AT.before);
    const server = new FakeServer().on('GET /trips/current', json(200, MIXED));
    await startHome();
    await screen.findByTestId('day-row-d1');
    await act(async () => {
      await new Promise<void>((done) => setImmediate(done));
    });
    expect(screen.getByText(SUMMARY_TEXT)).toBeTruthy();
    expect(server.requests.filter((one) => /\/course$/.test(one.path))).toEqual([]);
  });

  test('T11_Q3_알아서_짜_줘를_누르면_바로_자동_계획_코스안', async () => {
    resetDevice();
    freezeDate(AT.before);
    const server = new FakeServer()
      .on('GET /trips/current', json(200, MIXED))
      .on('POST /days/d2/planning', json(201, course()))
      .on(`GET /planning/${SID}`, json(200, course()));
    await startHome();
    await tap(await screen.findByTestId('card-auto-d2'));
    expect(await screen.findByTestId('option-relaxed')).toBeTruthy();
    const sent = server.sent('POST /days/d2/planning');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ mode: 'auto' });
  });
});

describe('§9 Q8 날짜 목록 고정 일정도 엔 대시', () => {
  test('T11_Q8_고정_일정_시각은_12:00–13:00', async () => {
    const event = { fixed_event_id: 'fe-1', trip_day_id: 'd2', title: '저녁 예약', start_at: '2026-12-12T12:00:00+09:00', end_at: '2026-12-12T13:00:00+09:00', place_id: null };
    await show(trip(tripDay(1, 'planned'), { ...tripDay(2, 'planning'), fixed_events: [event] }, tripDay(3, 'planning')), AT.before);
    expect(within(screen.getByTestId('day-row-d2')).getByText('12:00–13:00')).toBeTruthy();
    expect(screen.queryByText(/\d{2}:\d{2}\s*[-~]\s*\d{2}:\d{2}/)).toBeNull();
  });
});

// ---------- §10 E1 끝맺음 글 ----------

describe('§10 E1 주 버튼이 없으면 end-note', () => {
  /** 화면 나무에서 testID가 나오는 순서 */
  const order = () =>
    (screen.root as unknown as Host)
      .queryAll((host) => typeof host.props.testID === 'string')
      .map((host) => host.props.testID as string)
      .filter((id, index, all) => all.indexOf(id) === index);

  test('T11_E1_모두_계획_완료(여행_전)면_n일_모두_정했어', async () => {
    await show(ALL_PLANNED, AT.before);
    const note = within(screen.getByTestId('end-note'));
    expect(note.getByText('3일 모두 정했어')).toBeTruthy();
    expect(note.getByText('여행 첫날부터 아래에 \u2018오늘 여행 보기\u2019 버튼이 나와')).toBeTruthy(); // §11 Q4: 작은따옴표 U+2018·U+2019
  });

  test('T11_E1_날_수는_실제_값', async () => {
    const two = { ...trip(tripDay(1, 'planned'), tripDay(2, 'planned')), end_date: DATES[1] };
    await show(two, AT.before);
    expect(within(screen.getByTestId('end-note')).getByText('2일 모두 정했어')).toBeTruthy();
  });

  test('T11_E1_모두_지난_날(여행_끝)이면_여행이_끝났어', async () => {
    await show(ALL_PAST, AT.after);
    const note = within(screen.getByTestId('end-note'));
    expect(note.getByText('여행이 끝났어')).toBeTruthy();
    expect(note.getByText('날짜를 누르면 고른 코스를 볼 수 있어')).toBeTruthy();
    expect(note.queryByText(/모두 정했어/)).toBeNull();
  });

  test.each([
    ['여행 전 섞임', MIXED, AT.before],
    ['오늘 여행 중', TODAY_WITH_COURSE, AT.day2],
    ['오늘인데 코스 없음', TODAY_NO_COURSE, AT.day2],
  ])('T11_E1_%s(주_버튼_있음)에는_end_note가_없다', async (_name, value, at) => {
    await show(value, at);
    expect(screen.getByTestId('bottom-primary')).toBeTruthy();
    expect(screen.queryByTestId('end-note')).toBeNull();
  });

  test.each([
    ['모두 계획 완료', ALL_PLANNED, AT.before],
    ['모두 지난 날', ALL_PAST, AT.after],
  ])('T11_E1_%s_순서는_마지막_날_줄_→_end_note_→_새_여행_만들기', async (_name, value, at) => {
    await show(value, at);
    const ids = order();
    const lastRow = ids.indexOf('day-row-d3');
    const note = ids.indexOf('end-note');
    const newTrip = ids.indexOf('new-trip');
    expect(lastRow).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThan(lastRow);
    expect(newTrip).toBeGreaterThan(note);
    expect(screen.queryByTestId('bottom-primary')).toBeNull();
  });

  test('T11_E1_end_note에는_주황이_없다', async () => {
    await show(ALL_PLANNED, AT.before);
    expect(filledWith(COLORS.brand, byId('end-note'))).toEqual([]);
  });
});

// ---------- §12 Q1 머리 제목 title-trip ----------

describe('§12 Q1 머리 제목은 title-trip', () => {
  test('T11_S12_Q1_오사카_2박_3일은_28/36·700·ink-strong·왼쪽', async () => {
    await show(MIXED, AT.before);
    const title = screen.getByText('오사카 2박 3일') as unknown as Host;
    const style = styleOf(title);
    const token = FIT['title-trip'] as { size: number; lineHeight: number; weight: number; fg: string };
    expect(style.fontSize).toBe(token.size);
    expect(style.lineHeight).toBe(token.lineHeight);
    expect(String(style.fontWeight ?? '') === String(token.weight) || String(style.fontFamily ?? '').includes(String(token.weight))).toBe(true);
    expect(String(style.color).toUpperCase()).toBe(token.fg);
    expect([undefined, 'left', 'auto']).toContain(style.textAlign);
  });
});

// ---------- §12 Q3 코스 없는 지난 날 = 누를 수 없는 줄 row-locked ----------

describe('§12 Q3 코스 없는 지난 날은 row-locked', () => {
  // ALL_PAST: d1·d2 지난 날(코스 있음), d3 지난 날(코스 없음)
  const locked = () => screen.getByTestId(/^row-locked/) as unknown as Host;

  test('T11_S12_Q3_코스_없는_지난_날만_row_locked', async () => {
    await show(ALL_PAST, AT.after);
    expect(screen.getAllByTestId(/^row-locked/)).toHaveLength(1);
    expect(within(locked() as never).getByText('3일째', { exact: false })).toBeTruthy();
  });

  test('T11_S12_Q3_요약_자리에_고른_코스_없음_›_없음', async () => {
    await show(ALL_PAST, AT.after);
    const row = within(locked() as never);
    expect(row.getByText('고른 코스 없음')).toBeTruthy();
    expect(row.queryByText(/›/)).toBeNull();
    expect(row.queryByText(/끝 · \d+곳/)).toBeNull();
  });

  test('T11_S12_Q3_누를_수_없음_표시(aria-disabled)', async () => {
    await show(ALL_PAST, AT.after);
    const hosts = [locked(), pressableOf(locked())];
    expect(hosts.some((h) => h.props.accessibilityState?.disabled === true || h.props['aria-disabled'] === true || h.props.disabled === true)).toBe(true);
  });

  test('T11_S12_Q3_눌러도_onOpen이_불리지_않는다', async () => {
    const onOpen = await show(ALL_PAST, AT.after);
    await act(async () => {
      fireEvent.press(screen.getByTestId(/^row-locked/));
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('T11_S12_Q3_코스_있는_지난_날은_잠기지_않고_요약', async () => {
    await show(ALL_PAST, AT.after);
    expect(within(screen.getByTestId('day-row-d1')).getByText(SUMMARY_TEXT)).toBeTruthy();
    expect(isInside(byId('day-row-d1'), locked())).toBe(false);
  });

  test('T11_S12_Q3_첫_화면에서_눌러도_읽기만·코스_요청_없음', async () => {
    resetDevice();
    freezeDate(AT.after);
    const server = new FakeServer().on('GET /trips/current', json(200, ALL_PAST));
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
    await screen.findByTestId(/^row-locked/);
    await act(async () => {
      fireEvent.press(screen.getByTestId(/^row-locked/));
      await new Promise<void>((done) => setImmediate(done));
    });
    expect(screen.queryByTestId('course-readonly')).toBeNull();
    expect(server.requests.filter((one) => /\/course$/.test(one.path))).toEqual([]);
    expect(screen.getByTestId('day-row-d1')).toBeTruthy(); // 날짜 목록 그대로
  });
});

// ---------- §13 3: 데모 여행처럼 기기 시계와 날 상태가 다를 때 ----------

describe('§13 3 머리는 날 상태와 같은 시계', () => {
  test('T11_S13_3_기기_시계는_여행_22일_전인데_날_상태가_오늘이면_머리도_여행_중', async () => {
    await show(TODAY_WITH_COURSE, '2026-11-20T03:00:00Z'); // 12/12까지 22일
    expect(screen.getByText(/^여행 중 · 3일 중 \d일 계획 완료$/)).toBeTruthy();
    expect(screen.queryByText(/D-\d+/)).toBeNull();
    expect(within(screen.getByTestId('bottom-primary')).getByText('오늘 여행 보기')).toBeTruthy();
  });

  test('T11_S13_3_기기_시계는_여행_전인데_모든_날이_지난_날이면_여행_끝', async () => {
    await show(ALL_PAST, AT.before);
    expect(screen.getByText('여행 끝')).toBeTruthy();
    expect(screen.queryByText(/D-\d+/)).toBeNull();
    expect(within(screen.getByTestId('end-note')).getByText('여행이 끝났어'));
  });
});

// ---------- §14 재검수 (task-011-review.md §9) ----------

/** 날 줄의 눌리는 상자(바탕·테두리가 있는 곳) */
const rowBox = (dayId: string) => pressableOf(byId(`day-row-${dayId}`));
const hasRing = (host: Host) => {
  const style = styleOf(host);
  return typeof style.borderWidth === 'number' && style.borderWidth > 0 && same(style.borderColor, COLORS.brand);
};
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
/** 날 줄 testID의 가장 바깥 상자 (row-locked이면 그것) */
const outerRow = (dayId: string) => (screen.queryByTestId(`row-locked-${dayId}`) ?? screen.getByTestId(`day-row-${dayId}`)) as unknown as Host;

describe('§14 8 날 카드 사이 간격 12', () => {
  const gapBetween = (a: string, b: string) => {
    const first = outerRow(a);
    const second = outerRow(b);
    const parent = commonAncestor(first, second);
    const prev = styleOf(childOn(parent, first));
    const next = styleOf(childOn(parent, second));
    // 테스트 환경의 ScrollView: 안쪽 상자(View)는 스타일이 없고, 바깥 RCTScrollView가 contentContainerStyle을 prop으로 들고 있다
    const scroll = parent.props.style === undefined ? parent.parent : null;
    const own = { ...styleOf(parent), ...(StyleSheet.flatten(parent.props.contentContainerStyle ?? scroll?.props.contentContainerStyle) ?? {}) } as Record<string, unknown>;
    return num(own.rowGap ?? own.gap) + num(prev.marginBottom ?? prev.marginVertical ?? prev.margin) + num(next.marginTop ?? next.marginVertical ?? next.margin);
  };

  test.each([
    ['여행 전 섞임(줄 → 카드 → 카드)', MIXED, AT.before],
    ['오늘 여행 중(지난 날 → 오늘 → 카드)', TODAY_WITH_COURSE, AT.day2],
    ['지난 날만(코스 없는 지난 날 포함)', ALL_PAST, AT.after],
  ])('T11_S14_8_%s_이웃한_날_사이는_12', async (_name, value, at) => {
    await show(value, at);
    expect(gapBetween('d1', 'd2')).toBe(12);
    expect(gapBetween('d2', 'd3')).toBe(12);
  });
});

describe('§14 N1 머리 순서: 표지 → 글 → 날 줄', () => {
  test.each([
    ['여행 전', MIXED, AT.before, 'D-35 · 3일 중 1일 계획 완료'],
    ['여행 끝', ALL_PAST, AT.after, '여행 끝'],
  ])('T11_S14_N1_%s_표지가_제목·진행_줄보다_먼저', async (_name, value, at, line) => {
    await show(value, at);
    const cover = screen.getByLabelText('오사카 표지') as unknown as Host;
    const title = screen.getByText('오사카 2박 3일') as unknown as Host;
    const progress = screen.getByText(line) as unknown as Host;
    const firstDay = outerRow('d1');
    expect(treeIndex(cover)).toBeLessThan(treeIndex(title));
    expect(treeIndex(title)).toBeLessThan(treeIndex(progress));
    expect(treeIndex(progress)).toBeLessThan(treeIndex(firstDay));
  });
});

describe('§14 N2 지금 할 날 카드 = 연주황, 링은 오늘만', () => {
  test('T11_S14_N2_여행_전에도_지금_할_날_카드는_연주황_링_없음', async () => {
    await show(MIXED, AT.before);
    expect(String(styleOf(rowBox('d2')).backgroundColor).toUpperCase()).toBe(COLORS['brand-soft']);
    expect(hasRing(rowBox('d2'))).toBe(false);
  });

  test('T11_S14_N2_다른_계획_전_카드는_회색(bg_2)_링_없음', async () => {
    await show(MIXED, AT.before);
    expect(String(styleOf(rowBox('d3')).backgroundColor).toUpperCase()).toBe(COLORS['bg-2']);
    expect(hasRing(rowBox('d3'))).toBe(false);
  });

  test('T11_S14_N2_모두_계획_전이면_첫_날만_연주황', async () => {
    await show(trip(tripDay(1, 'planning'), tripDay(2, 'planning'), tripDay(3, 'planning')), AT.before);
    expect(String(styleOf(rowBox('d1')).backgroundColor).toUpperCase()).toBe(COLORS['brand-soft']);
    for (const id of ['d2', 'd3']) expect(String(styleOf(rowBox(id)).backgroundColor).toUpperCase()).toBe(COLORS['bg-2']);
  });

  test('T11_S14_N2_오늘인데_코스_없는_카드는_연주황_+_주황_링(오늘_알약과_함께)', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    expect(String(styleOf(rowBox('d2')).backgroundColor).toUpperCase()).toBe(COLORS['brand-soft']);
    expect(hasRing(rowBox('d2'))).toBe(true);
    expect(within(screen.getByTestId('day-pill-d2')).getByText('오늘 · 여행 중')).toBeTruthy();
  });

  test('T11_S14_N2_오늘_여행_중이면_뒤의_계획_전_카드는_회색', async () => {
    await show(TODAY_WITH_COURSE, AT.day2);
    expect(String(styleOf(rowBox('d3')).backgroundColor).toUpperCase()).toBe(COLORS['bg-2']);
    expect(hasRing(rowBox('d3'))).toBe(false);
  });

  test.each([
    ['여행 전 섞임', MIXED, AT.before],
    ['오늘 여행 중', TODAY_WITH_COURSE, AT.day2],
    ['오늘인데 코스 없음', TODAY_NO_COURSE, AT.day2],
    ['모두 계획 완료', ALL_PLANNED, AT.before],
    ['지난 날만', ALL_PAST, AT.after],
  ])('T11_S14_N2_%s_주황_링은_오늘_줄에만', async (_name, value, at) => {
    await show(value, at);
    const days = (value as { trip_days: { day_id: string; state: string }[] }).trip_days;
    for (const day of days) {
      const box = pressableOf(outerRow(day.day_id));
      const ringed = [box, ...box.queryAll(() => true)].some(hasRing) || hasRing(outerRow(day.day_id));
      expect(ringed).toBe(day.state === 'today');
    }
  });
});

// ---------- §16 앱 2: 오늘 카드 주황 링은 레이아웃을 밀지 않는다 (task-011-review.md §12-5 N18, DESIGN-001 §4-11 r2 재검수로 정한 것) ----------
// 렌더 트리로 본다: 카드 눌리는 상자의 네 변 "안쪽 차지" = 안쪽 여백 + 테두리 굵기. 링 있는 오늘 카드와 링 없는 지금 할 날 카드가 같아야
//   안쪽 글 자리가 같고 카드 높이가 늘지 않는다(186 유지). 링을 겹쳐 그리는 안쪽 상자가 있으면 그 상자는 자리를 먹지 않는다(position absolute).
//   방법(겹친 상자 / 테두리만큼 안쪽 여백 줄이기)은 정하지 않는다.
describe('§16 앱 2 (N18) 오늘 카드 링은 레이아웃을 밀지 않는다', () => {
  const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const;
  const inset = (host: Host) => {
    const style = styleOf(host);
    return SIDES.map((at) => {
      const axis = at === 'Top' || at === 'Bottom' ? 'Vertical' : 'Horizontal';
      const padding = num(style[`padding${at}`] ?? style[`padding${axis}`] ?? style.padding);
      const border = num(style[`border${at}Width`] ?? style.borderWidth);
      return padding + border;
    });
  };
  const sizeOf = (host: Host) => ({ height: styleOf(host).height, minHeight: styleOf(host).minHeight });

  test('T11_S16_N18_오늘_카드(링)의_네_변_안쪽_차지는_링_없는_지금_할_날_카드와_같다', async () => {
    await show(MIXED, AT.before); // d2 = 지금 할 날 카드, 링 없음
    const plain = inset(rowBox('d2'));
    const plainSize = sizeOf(rowBox('d2'));
    await show(TODAY_NO_COURSE, AT.day2); // d2 = 오늘인데 코스 없음, 링 있음
    expect(inset(rowBox('d2'))).toEqual(plain);
    expect(sizeOf(rowBox('d2'))).toEqual(plainSize);
  });

  test('T11_S16_N18_링은_그대로_있고_굵기_2', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    const box = rowBox('d2');
    const rings = [box, ...box.queryAll(() => true)].filter(hasRing);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(styleOf(ring).borderWidth).toBe(2);
  });

  test('T11_S16_N18_링을_겹쳐_그리는_안쪽_상자는_자리를_먹지_않는다(absolute)', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    const box = rowBox('d2');
    for (const ring of box.queryAll(() => true).filter(hasRing)) expect(styleOf(ring).position).toBe('absolute');
  });
});

describe('§14 N3 카드 안 "고정 일정 없음" + [+ 일정] 한 줄', () => {
  const sameRow = (a: Host, b: Host) => styleOf(commonAncestor(a, b)).flexDirection === 'row';

  test.each(['d2', 'd3'])('T11_S14_N3_고정_일정이_없으면_%s_카드에_고정_일정_없음(왼쪽)_+_일정(오른쪽)', async (dayId) => {
    await show(MIXED, AT.before);
    const label = within(screen.getByTestId(`day-row-${dayId}`)).getByText('고정 일정 없음') as unknown as Host;
    const add = byId(`add-fixed-${dayId}`);
    expect(sameRow(label, add)).toBe(true);
    expect(treeIndex(label)).toBeLessThan(treeIndex(add));
  });

  test('T11_S14_N3_오늘인데_코스_없는_카드도_같은_줄', async () => {
    await show(TODAY_NO_COURSE, AT.day2);
    const label = within(screen.getByTestId('day-row-d2')).getByText('고정 일정 없음') as unknown as Host;
    expect(sameRow(label, byId('add-fixed-d2'))).toBe(true);
  });

  test('T11_S14_N3_고정_일정이_있으면_그_시각·제목이_+_일정과_같은_줄', async () => {
    const event = { fixed_event_id: 'fe-1', trip_day_id: 'd2', title: '저녁 예약', start_at: '2026-12-12T12:00:00+09:00', end_at: '2026-12-12T13:00:00+09:00', place_id: null };
    await show(trip(tripDay(1, 'planned'), { ...tripDay(2, 'planning'), fixed_events: [event] }, tripDay(3, 'planning')), AT.before);
    const row = within(screen.getByTestId('day-row-d2'));
    expect(row.queryByText('고정 일정 없음')).toBeNull();
    const time = row.getByText('12:00–13:00') as unknown as Host;
    const title = row.getByText('저녁 예약') as unknown as Host;
    const add = byId('add-fixed-d2');
    expect(sameRow(time, add)).toBe(true);
    expect(sameRow(title, add)).toBe(true);
    expect(treeIndex(time)).toBeLessThan(treeIndex(add));
    expect(within(screen.getByTestId('day-row-d3')).getByText('고정 일정 없음')).toBeTruthy(); // 다른 날은 그대로
  });

  test.each([
    ['계획 완료', MIXED, AT.before, 'd1'],
    ['지난 날', ALL_PAST, AT.after, 'd1'],
    ['오늘(코스 있음)', TODAY_WITH_COURSE, AT.day2, 'd2'],
  ])('T11_S14_N3_%s_줄에는_고정_일정_없음_글자가_없다(+_일정이_없는_줄)', async (_name, value, at, dayId) => {
    await show(value, at);
    expect(within(outerRow(dayId) as never).queryByText('고정 일정 없음')).toBeNull();
  });
});

describe('§14 9-5 모든 지난 날이 고른 코스 없음이면 끝맺음 글은 제목만', () => {
  const NONE_PAST = trip(tripDay(1, 'past', false), tripDay(2, 'past', false), tripDay(3, 'past', false));
  const textsIn = (host: Host) =>
    host
      .queryAll((h) => h.type === 'Text')
      .map((h) => (h.children ?? []).filter((c): c is string => typeof c === 'string').join(''))
      .filter((value) => value.trim() !== '');

  test('T11_S14_9-5_모두_고른_코스_없음이면_여행이_끝났어만', async () => {
    await show(NONE_PAST, AT.after);
    const note = byId('end-note');
    expect(within(screen.getByTestId('end-note')).getByText('여행이 끝났어')).toBeTruthy();
    expect(screen.queryByText('날짜를 누르면 고른 코스를 볼 수 있어')).toBeNull();
    expect(textsIn(note)).toEqual(['여행이 끝났어']);
  });

  test('T11_S14_9-5_경계_코스가_있는_지난_날이_하나라도_있으면_설명_줄도', async () => {
    await show(trip(tripDay(1, 'past', true), tripDay(2, 'past', false), tripDay(3, 'past', false)), AT.after);
    expect(within(screen.getByTestId('end-note')).getByText('날짜를 누르면 고른 코스를 볼 수 있어')).toBeTruthy();
  });

  test('T11_S14_9-5_모두_고른_코스_없음이어도_맨_아래_새_여행_만들기·주황_0', async () => {
    await show(NONE_PAST, AT.after);
    expect(screen.getByTestId('new-trip')).toBeTruthy();
    expect(screen.queryByTestId('bottom-primary')).toBeNull();
    expect(filledWith(COLORS.brand)).toEqual([]);
  });

  test('T11_S14_9-5_여행_전_모두_정했어는_그대로_설명_줄_있음', async () => {
    await show(ALL_PLANNED, AT.before);
    expect(textsIn(byId('end-note'))).toHaveLength(2);
  });
});

// ---------- §14 04: 리뷰 §9-5 표(지난 날만 남은 날짜 목록)에서 기존 테스트가 안 보던 것 ----------
// 이미 있는 것: 주 버튼 없음(T11_A1_지난_날만), 주황 0(T11_AC3_지난_날만), 끝맺음 글 글자·순서(T11_E1), 여행 끝(T11_S13_3·lib E2),
//               코스 없는 줄 "고른 코스 없음"·잠김(T11_S12_Q3), 코스 있는 지난 날 요약(T11_S12_Q3), 지난 날 알약 아이콘(B2)
// 크기(68·28·40·300·34)는 모습 값이라 쓰지 않는다

describe('§14 04 지난 날만 남은 날짜 목록 (리뷰 §9-5 표)', () => {
  test('T11_S14_04_머리는_제목_그대로와_여행_끝', async () => {
    await show(ALL_PAST, AT.after);
    expect(screen.getByText('오사카 2박 3일')).toBeTruthy();
    expect(screen.getByText('여행 끝')).toBeTruthy();
  });

  test.each(['d1', 'd2', 'd3'])('T11_S14_04_%s_지난_날_줄은_N일째와_날짜·지난_날_알약', async (dayId) => {
    await show(ALL_PAST, AT.after);
    const n = Number(dayId.slice(1));
    const row = within(outerRow(dayId) as never);
    expect(row.getByText(`${n}일째`)).toBeTruthy();
    expect(row.getByText(['12/11 금', '12/12 토', '12/13 일'][n - 1])).toBeTruthy();
    expect(within(screen.getByTestId(`day-pill-${dayId}`)).getByText('지난 날')).toBeTruthy();
  });

  test('T11_S14_04_›는_코스가_있는_지난_날_줄에만', async () => {
    await show(ALL_PAST, AT.after);
    expect(within(screen.getByTestId('day-row-d1')).getByTestId('day-chevron-d1')).toBeTruthy();
    expect(within(screen.getByTestId('day-row-d2')).getByTestId('day-chevron-d2')).toBeTruthy();
    expect(screen.queryByTestId('day-chevron-d3')).toBeNull();
  });

  test('T11_S14_04_계획_완료_줄에도_›', async () => {
    await show(MIXED, AT.before);
    expect(within(screen.getByTestId('day-row-d1')).getByTestId('day-chevron-d1')).toBeTruthy();
    expect(screen.queryByTestId('day-chevron-d2')).toBeNull(); // 계획 전 카드에는 없다
  });

  test('T11_S14_04_새_여행_만들기는_btn_new_trip(bg_2·52_이상)', async () => {
    await show(ALL_PAST, AT.after);
    const style = styleOf(pressableOf(byId('new-trip')));
    expect(String(style.backgroundColor).toUpperCase()).toBe(COLORS['bg-2']);
    expect(Math.max(...[style.height, style.minHeight].filter((v): v is number => typeof v === 'number'))).toBeGreaterThanOrEqual(52);
  });
});
