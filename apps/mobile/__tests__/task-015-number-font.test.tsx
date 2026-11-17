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
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PickSheet } from '@/account/pick-sheet';
import { NowCardView } from '@/components/now/now-cards';
import { CourseMapScreen } from '@/components/planning/course-map-screen';
import { CalendarSheet } from '@/trips/calendar-sheet';
import { TripDays } from '@/trips/trip-days';

import { resetDevice, tap } from '../test-support/planning-driver';
import { FakeServer, apiError, json } from '../test-support/fake-server';
import { t01, t02, t07 } from '../test-support/trip-now-fixtures';

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

// =====================================================================
// TASK-015 §18 — 숫자 글꼴 남은 곳 + reviewer 막는 것 3 (T-01 시각)
// 근거: TASK-015 §18 reviewer "막는 것" 3("T-01 '11:14에 끝나'의 시각이 Noto(now-cards.tsx:186·190) -> 시각 숫자만 DM Mono(§B1·§B7)") ·
//       §B1("'16:00에 끝나'(시각만 DM Mono)") · §18 남은 질문 6("task-014-design §13-1 규칙 + §13-3 디자이너 판단 6곳을 따른다. 입력 칸 안 날짜는 Noto 그대로") ·
//       task-014-design §13-1(시각 = 혼자 값) · §13-3 1(N일째 머리말 · 칩 "1일째 12/11" = DM Mono, 문장 제목은 Noto) · §13-3 3("확인: 11월 2일" = 날짜 값) ·
//       §13-3 4(T-02 줄 "16:00 출발 · 전철 12분") · §13-3 5("끝 · 4곳 · 이동 55분" 모양은 그대로 DM Mono) · §13-2 Noto로 남긴 것("2일째에 담김") ·
//       §14-3(사실 줄 "시각 DM Mono": T-02 "16:00 출발 …" · T-07 "18:42 출발") · task-015-design §9("N일째 · 시각 · 날짜 숫자 DM Mono 500")
// 계약 (이 묶음이 정한 것):
//   시각 섞인 문장("12:20에 시작해" · "12:00에 출발 · 5분 뒤" · "14:40까지 출발해야 해"): HH:MM 글자(숫자와 그 사이 :)는 DM Mono, 한글은 DM Mono 아님.
//     그 밖의 숫자("5분 뒤"의 5)는 보지 않는다 — §13-3 4 "앱 줄에서 12분이 DM Mono인지 확인 필요"(질문)
//   이미 있는 것은 다시 쓰지 않는다 (위 머리 주석 목록 + 이 파일 §17 묶음). 입력 칸(TextInput) 안 날짜는 보지 않는다(§18 Q6: Noto 그대로)
// =====================================================================

const TIME = /\d{1,2}:\d{2}/g;

/** 시각(HH:MM)만 DM Mono, 한글·로마자는 DM Mono 아님. 다른 숫자는 보지 않는다. 시각이 하나도 없으면 시험 자체가 틀린 것 */
function timeMistakes(host: Host): string[] {
  const list = glyphs(host);
  const whole = list.map(([ch]) => ch).join('');
  const inTime = new Set<number>();
  for (const found of whole.matchAll(TIME)) for (let i = 0; i < found[0].length; i += 1) inTime.add((found.index ?? 0) + i);
  if (inTime.size === 0) return ['시각 없음'];
  const wrong: string[] = [];
  list.forEach(([ch, family], i) => {
    if (inTime.has(i) && !isMono(family)) wrong.push(`${i}:${ch} DM Mono 아님`);
    if (LETTER.test(ch) && isMono(family)) wrong.push(`${i}:${ch} DM Mono임`);
  });
  return wrong;
}

async function showCard(card: object) {
  await render(<NowCardView card={card as never} main onOpenFailed={() => {}} />);
}

describe('§18 막는 것 3 — T-01 시각은 숫자만 DM Mono', () => {
  test('T15_S18_T01_끝나는_시각_HH:MM에_끝나는_시각만_DM_Mono', async () => {
    await showCard(t01());
    expect(timeMistakes(textHost(/^\d{1,2}:\d{2}에 끝나$/))).toEqual([]);
  });

  test('T15_S18_T01_아직_시작_전이면_HH:MM에_시작해도_시각만_DM_Mono', async () => {
    await showCard(t01({ ends_in_min: null }));
    expect(timeMistakes(textHost(/^\d{1,2}:\d{2}에 시작해$/))).toEqual([]);
    expect(timeMistakes(textHost(/^\d{1,2}:\d{2}에 끝나$/))).toEqual([]);
  });

  test('T15_S18_T01_도구_확인_시각_글자가_한_Text로_읽힌다', async () => {
    // 읽기 도구에는 "12:20에 시작해" 한 문장 (글자를 나눠도 바깥 Text 하나)
    await showCard(t01({ ends_in_min: null }));
    expect(screen.getByText('12:20에 시작해')).toBeTruthy();
    expect(screen.getByText('14:00에 끝나')).toBeTruthy();
  });
});

describe('§13-3 4 · §14-3 사실 줄 시각 — T-02 · T-07', () => {
  test('T15_S18_T02_출발_줄_HH:MM에_출발_·_N분_뒤의_시각만_DM_Mono', async () => {
    await showCard(t02());
    expect(timeMistakes(textHost(/^12:00에 출발 · 5분 뒤$/))).toEqual([]);
  });

  test('T15_S18_T02_경계_지금_나설_때_HH:MM에_출발,_지금_나서자도_시각만_DM_Mono', async () => {
    await showCard(t02({ leave_in_min: 0 }));
    expect(timeMistakes(textHost('12:00에 출발, 지금 나서자'))).toEqual([]);
  });

  // TASK-015 §24(T-07 보드대로): 옛 "14:40까지 출발해야 해" -> "14:40 출발"(§14-3 사실 줄 "18:42 출발" 시각 DM Mono)
  test('T15_S24_T07_HH:MM_출발_줄의_시각만_DM_Mono', async () => {
    await showCard(t07());
    expect(timeMistakes(textHost('14:40 출발'))).toEqual([]);
  });

  // §24: 제목은 제목만(옛 "제목 · 15:00–16:00"). 장소 줄에 시작 시각을 붙이는지는 질문 -> 카드에 보이는 다른 시각 글자도 시각만 DM Mono인지 본다
  test('T15_S24_T07_카드_안_시각_글자는_모두_시각만_DM_Mono', async () => {
    await showCard(t07());
    const hosts = screen.queryAllByText(/\d{1,2}:\d{2}/) as unknown as Host[];
    expect(hosts.length).toBeGreaterThanOrEqual(1); // 시험 자체 확인: 적어도 "14:40 출발"
    for (const host of hosts) expect(timeMistakes(host)).toEqual([]);
  });
});

describe('§13-3 3 확인 날짜는 날짜 값', () => {
  test('T15_S18_T05_사실_줄_확인:_날짜의_숫자는_DM_Mono_글자는_아님', async () => {
    const t05 = {
      type: 'T-05',
      place: { place_id: 'D02', name: '서버_확인할_곳' },
      facts: [{ field: 'opening_hours', value: '10:00-18:00', status: 'confirmed', source_type: 'user', checked_at: '2026-11-02T09:00:00+09:00' }],
      map_url: 'https://www.google.com/maps/search/?api=1&query=35.02,134.99',
    };
    await showCard(t05);
    const host = textHost(/확인: /);
    const list = glyphs(host);
    const at = list.map(([ch]) => ch).join('').indexOf('확인: ');
    const wrong = list.slice(at).filter(([ch, family]) => (DIGIT.test(ch) && !isMono(family)) || (LETTER.test(ch) && isMono(family)));
    expect(wrong.map(([ch]) => ch)).toEqual([]);
  });
});

describe('§13-3 1 N일째 머리말 — 여행 만들기 날 칩 · 크게 보기 머리', () => {
  async function toCreateWithDates() {
    resetDevice();
    freezeDate('2026-12-02T03:00:00Z');
    const server = new FakeServer().on('GET /trips/current', apiError(404, 'NOT_FOUND', { resource: 'trip' }));
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
    return server;
  }

  test.each([
    ['2026-12-10', '1일째 12/10'],
    ['2026-12-11', '2일째 12/11'],
  ])('T15_S18_날_칩_%s_%s는_숫자만_DM_Mono', async (date, label) => {
    await toCreateWithDates();
    const chip = within(await screen.findByTestId(`tab-day-${date}`));
    expect(valueMistakes(chip.getByText(label) as unknown as Host)).toEqual([]);
  });

  test('T15_S18_다른_날에_담김_N일째에_담김은_문장이라_DM_Mono_없음', async () => {
    const server = await toCreateWithDates();
    const kuromon = {
      id: 'osaka-fake-kuromon', name: '구로몬 시장', category: 'food', lat: 34.6651, lng: 135.5065, crowd_level: 4, price_level: 2, mood_tags: ['현지'],
      image: { category: 'food' }, facts: [{ field: 'opening_hours', value: '09:00-18:00', status: 'confirmed', source_type: 'google', source_url: null, checked_at: '2026-11-10' }],
    };
    server.match('GET /places/search', () => json(200, [kuromon]));
    await tap(await screen.findByTestId('tab-day-2026-12-10'));
    await fireEvent.changeText(await screen.findByTestId('must-search'), '구로');
    await tap(await screen.findByText('구로몬 시장'));
    await tap(await screen.findByTestId('tab-day-2026-12-11'));
    await fireEvent.changeText(screen.getByTestId('must-search'), '구로몬');
    const row = within(await screen.findByTestId('must-result-osaka-fake-kuromon'));
    expect(sentenceMistakes(row.getByText('1일째에 담김') as unknown as Host)).toEqual([]);
  });

  async function showCourseMap() {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <CourseMapScreen
          dayNumber={2}
          labelText="느긋하게"
          stops={[{ seq: 1, lat: 34.6687, lng: 135.5013, name: '가' }, { seq: 2, lat: 34.6651, lng: 135.5065, name: '나' }]}
          home={null}
          summary="5곳 · 이동 45분"
          busy={false}
          onClose={() => {}}
          onPick={() => {}}
          onFail={() => {}}
        />
      </SafeAreaProvider>,
    );
  }

  test('T15_S18_크게_보기_머리_2일째_·_느긋하게는_숫자만_DM_Mono', async () => {
    await showCourseMap();
    expect(valueMistakes(textHost('2일째 · 느긋하게'))).toEqual([]);
  });

  test('T15_S18_크게_보기_요약_5곳_·_이동_45분은_§13-3_5대로_숫자만_DM_Mono', async () => {
    await showCourseMap();
    expect(valueMistakes(textHost('5곳 · 이동 45분'))).toEqual([]);
  });
});
