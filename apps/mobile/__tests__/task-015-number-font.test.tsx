/// <reference types="jest" />
// TASK-015 §B7·§17 숫자 글꼴 나머지 — task-014-design.md §13-1 규칙 목록 전부 (이미 있는 테스트는 뺐다). 글꼴 이름만 본다 (크기·간격·밑선은 스크린샷 몫).
// 근거: TASK-015 §B7("혼자 값으로 서는 숫자(날짜·날짜 범위·시각·D-day·'n일 중 k일')는 숫자만 DM Mono 500, 글자는 Noto. 문장 안 숫자는 Noto") ·
//       §17("B7 숫자 글꼴은 날짜 목록 머리만 -> 나머지도 한다 — §13-1 규칙 목록 전부(AC-4)") ·
//       task-014-design §13-1 표(혼자 값 / 문장 안 숫자) · "숫자에 붙은 : / – ~는 숫자와 같이 DM Mono" · §13-2(달력 머리 "2026년 12월" · 날짜 한 줄 "12월 11일 (금)" ·
//       ①-23·24 다른 여행 줄 "1월 8일 ~ 11일") · §13-3 6(입력 칸이 아니라 글자 칸이면 DM Mono) · §12-2 표("큰 버튼 밑 한 줄 1일째 · 12/11 금")
// 이미 있는 것 (여기서 다시 쓰지 않음): 날 줄 날짜 "12/11"(task-014-s19-design · task-014-s21) · 연습 시계 시각(task-014-rehearsal) · 코스 줄 시각(task-005-polish)
//
// 계약 (이 테스트가 정한 것):
//   글자 하나하나의 글꼴 = 그 글자를 담은 가장 안쪽 Text의 fontFamily (없으면 바깥 Text에서 물려받음). DM Mono 여부 = 글꼴 이름에 "mono"(대소문자 무시)
//   혼자 값: 숫자 글자는 DM Mono · 한글과 로마자(D-day의 D)는 DM Mono 아님 · 숫자 사이의 : / –는 DM Mono
//   문장 안 숫자: 그 글 전체에 DM Mono 글자가 없다
//   읽기 도구에는 한 문장으로 읽혀야 하므로 글자를 찾는 단위는 바깥 Text 하나(getByText가 찾는 것)
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PickSheet } from '@/account/pick-sheet';
import { CalendarSheet } from '@/trips/calendar-sheet';
import { TripDays } from '@/trips/trip-days';

import { resetDevice, tap } from '../test-support/planning-driver';
import { FakeServer, apiError } from '../test-support/fake-server';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };

type Host = { type: unknown; props: Record<string, any>; children: (Host | string)[] };
const familyOf = (host: Host, inherited: string): string => String((StyleSheet.flatten(host.props.style) ?? {}).fontFamily ?? inherited);
const isMono = (family: string) => /mono/i.test(family);

/** Text 하나 -> [글자, 글꼴] (안쪽 Text는 자기 글꼴, 없으면 바깥 것을 물려받음) */
function glyphs(host: Host, inherited = ''): [string, string][] {
  const family = familyOf(host, inherited);
  const out: [string, string][] = [];
  for (const child of host.children ?? []) {
    if (typeof child === 'string') for (const ch of child) out.push([ch, family]);
    else out.push(...glyphs(child, family));
  }
  return out;
}

const DIGIT = /[0-9]/;
const LETTER = /[가-힣A-Za-z]/;
const JOINER = /[:/–]/;

/** 혼자 값: 숫자(와 숫자 사이 : / –)만 DM Mono, 한글·로마자는 아님. 틀린 글자를 돌려준다 (빈 목록이면 통과) */
function valueMistakes(host: Host): string[] {
  const list = glyphs(host);
  const wrong: string[] = [];
  list.forEach(([ch, family], i) => {
    const between = JOINER.test(ch) && DIGIT.test(list[i - 1]?.[0] ?? '') && DIGIT.test(list[i + 1]?.[0] ?? '');
    if ((DIGIT.test(ch) || between) && !isMono(family)) wrong.push(`${i}:${ch} DM Mono 아님`);
    if (LETTER.test(ch) && isMono(family)) wrong.push(`${i}:${ch} DM Mono임`);
  });
  return wrong;
}

/** 문장: DM Mono 글자가 하나도 없다 */
const sentenceMistakes = (host: Host) => glyphs(host).filter(([, family]) => isMono(family)).map(([ch]) => ch);

const textHost = (value: string | RegExp) => screen.getByText(value) as unknown as Host;

// ---------- 날짜 목록 (TripDays) ----------

const DATES = ['2026-12-11', '2026-12-12', '2026-12-13'];
const tripDay = (n: number, state: string, events: unknown[] = []) => ({
  day_id: `d${n}`,
  date: DATES[n - 1],
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: events,
  summary: state === 'planning' ? null : { end_time: '18:30', place_count: 8, move_min: 125 },
  must_visits: [],
});
const trip = (...days: ReturnType<typeof tripDay>[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: DATES[0],
  end_date: DATES[2],
  lodging: null,
  status: 'active',
  trip_days: days,
});
const AT = { before: '2026-11-06T03:00:00Z', day2: '2026-12-12T03:00:00Z' };
const EVENT = { fixed_event_id: 'fe-1', trip_day_id: 'd2', title: '저녁 예약', start_at: '2026-12-12T12:00:00+09:00', end_at: '2026-12-12T13:00:00+09:00', place_id: null };

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

async function showDays(value: object, at: string) {
  freezeDate(at);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripDays trip={value as never} onOpen={() => {}} onTripChange={() => {}} onNewTrip={() => {}} />
    </SafeAreaProvider>,
  );
}

const MIXED = trip(tripDay(1, 'planned'), tripDay(2, 'planning', [EVENT]), tripDay(3, 'planning'));
const DURING = trip(tripDay(1, 'past'), tripDay(2, 'today'), tripDay(3, 'planning'));
const ALL_PLANNED = trip(tripDay(1, 'planned'), tripDay(2, 'planned'), tripDay(3, 'planned'));

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('§13-1 혼자 값 — 날짜 목록', () => {
  test('T15_B7_머리_D-35_·_3일_중_1일_계획_완료는_숫자만_DM_Mono', async () => {
    await showDays(MIXED, AT.before);
    expect(valueMistakes(textHost('D-35 · 3일 중 1일 계획 완료'))).toEqual([]);
  });

  test('T15_B7_여행_중_·_3일_중_k일도_숫자만_DM_Mono', async () => {
    await showDays(DURING, AT.day2);
    expect(valueMistakes(textHost(/^여행 중 · 3일 중 \d일 계획 완료$/))).toEqual([]);
  });

  test('T15_B7_머리_위_날짜_범위_12월_11일_~_13일은_숫자만_DM_Mono', async () => {
    await showDays(MIXED, AT.before);
    expect(valueMistakes(textHost('12월 11일 ~ 13일'))).toEqual([]);
  });

  test('T15_B7_고정_일정_시각_12:00–13:00은_콜론·대시까지_DM_Mono', async () => {
    await showDays(MIXED, AT.before);
    const host = textHost(/12:00–13:00/);
    expect(valueMistakes(host)).toEqual([]);
    const marks = glyphs(host).filter(([ch]) => ch === ':' || ch === '–');
    expect(marks.length).toBeGreaterThanOrEqual(3); // 시험 자체 확인: : 둘 · – 하나
  });

  test('T15_B7_큰_버튼_밑_한_줄_2일째_·_12/12_토는_숫자만_DM_Mono', async () => {
    await showDays(MIXED, AT.before);
    const sub = textHost(/^2일째 · 12\/12 토$/);
    expect(valueMistakes(sub)).toEqual([]);
  });
});

describe('§13-1 문장 안 숫자는 Noto — 날짜 목록', () => {
  test('T15_B7_제목_오사카_2박_3일은_DM_Mono_없음', async () => {
    await showDays(MIXED, AT.before);
    expect(sentenceMistakes(textHost('오사카 2박 3일'))).toEqual([]);
  });

  test('T15_B7_끝맺음_3일_모두_정했어는_DM_Mono_없음', async () => {
    await showDays(ALL_PLANNED, AT.before);
    expect(sentenceMistakes(textHost('3일 모두 정했어'))).toEqual([]);
  });
});

// ---------- 여행 고르기 줄 (①-23·24 다른 여행 줄) ----------

describe('§13-1 혼자 값 — 여행 고르기 시트', () => {
  test('T15_B7_다른_여행_줄_1월_8일_~_11일_·_4일_중_3일_계획_완료는_숫자만_DM_Mono', async () => {
    const choices = [
      { origin: 'account', trip_id: 'trip-a', name: '오사카 3박 4일', start_date: '2027-01-08', end_date: '2027-01-11', total_days: 4, planned_days: 3 },
      { origin: 'device', trip_id: 'trip-d', name: '오사카 2박 3일', start_date: '2026-12-11', end_date: '2026-12-13', total_days: 3, planned_days: 1 },
    ];
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <PickSheet email="someone@example.com" choices={choices as never} busy={false} onConfirm={() => {}} onCancel={() => {}} />
      </SafeAreaProvider>,
    );
    expect(valueMistakes(textHost('1월 8일 ~ 11일 · 4일 중 3일 계획 완료'))).toEqual([]);
    expect(valueMistakes(textHost('12월 11일 ~ 13일 · 3일 중 1일 계획 완료'))).toEqual([]);
  });

  test('T15_B7_다른_여행_이름_오사카_3박_4일은_문장이라_DM_Mono_없음', async () => {
    const choices = [{ origin: 'account', trip_id: 'trip-a', name: '오사카 3박 4일', start_date: '2027-01-08', end_date: '2027-01-11', total_days: 4, planned_days: 3 }];
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <PickSheet email="someone@example.com" choices={choices as never} busy={false} onConfirm={() => {}} onCancel={() => {}} />
      </SafeAreaProvider>,
    );
    expect(sentenceMistakes(textHost('오사카 3박 4일'))).toEqual([]);
  });
});

// ---------- 달력 시트 (①-04 날짜 한 줄 · 달력 머리) ----------

describe('§13-1 혼자 값 — 달력 시트', () => {
  async function showCalendar(initial: { start: string | null; end: string | null }) {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <CalendarSheet initial={initial} today="2026-11-06" onConfirm={() => {}} onClose={() => {}} />
      </SafeAreaProvider>,
    );
  }

  test('T15_B7_달력_머리_2026년_12월은_숫자만_DM_Mono', async () => {
    await showCalendar({ start: '2026-12-11', end: '2026-12-13' });
    expect(valueMistakes(textHost('2026년 12월'))).toEqual([]);
  });

  test.each([
    ['가는 날', '12월 11일 (금)'],
    ['오는 날', '12월 13일 (일)'],
  ])('T15_B7_달력_%s_날짜_한_줄은_숫자만_DM_Mono', async (_name, label) => {
    await showCalendar({ start: '2026-12-11', end: '2026-12-13' });
    expect(valueMistakes(textHost(label))).toEqual([]);
  });
});

// ---------- 여행 만들기 날짜 칸 (§13-3 6: 입력 칸이 아니라 글자 칸이면 DM Mono) ----------

describe('§13-3 6 여행 만들기 날짜 칸', () => {
  test('T15_B7_고른_날짜_칸_12월_10일_(목)은_글자_칸이라_숫자만_DM_Mono', async () => {
    resetDevice();
    freezeDate('2026-12-02T03:00:00Z'); // 달력이 12월로 열린다 (task-015-lodging-flow와 같은 날)
    new FakeServer().on('GET /trips/current', apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    const Index = require('@/app/index').default;
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <Index />
      </SafeAreaProvider>,
    );
    await tap(await screen.findByText('여행 만들기'));
    await tap(await screen.findByTestId('field-start-date'));
    await screen.findByTestId('calendar-sheet');
    await tap(await screen.findByTestId('cal-day-2026-12-10'));
    await tap(await screen.findByTestId('cal-day-2026-12-11'));
    await tap(screen.getByTestId('calendar-confirm'));
    const field = within(screen.getByTestId('field-start-date'));
    const inside = [field.getByText('12월 10일 (목)') as unknown as Host];
    expect(valueMistakes(inside[0])).toEqual([]);
  });
});
