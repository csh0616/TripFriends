/// <reference types="jest" />
// TASK-010 앱 로직 (화면 모습이 아니라 규칙만). 근거: TASK-010 §B1·§B3·§B4·§B5·§C2·§C3·§C6·§6, ADR-015 §3-5,
// DESIGN-001 §4-8(장소 그림 색)·§4-9(날 상태 4가지), TASK-005 A3(하루 꼭 갈 곳 5).
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   src/lib/create-trip.ts
//     type TripForm = { startDate: string | null; endDate: string | null; lodging: { place_id: string; name: string } | null;
//                       mustVisits: Record<string /* YYYY-MM-DD */, string[] /* place_id */> }
//     emptyForm(): TripForm
//     createBlocker(form): string | null           날짜가 없으면 이유 한 줄(빈 글 아님), 있으면 null
//     tripDates(start, end): string[]              시작~끝 날짜 (끝 포함). 날 탭(tab-day)에 쓴다
//     canAddMustVisit(form, date): boolean         그날 5곳 미만일 때만
//     mustVisitDayNumber(form, placeId): number | null  그 장소가 담긴 날이 몇 일째인지 (1부터). 다른 날에 담긴 곳은 addMustVisit가 그대로 둔다 (§11 D1)
//     addMustVisit(form, date, placeId): TripForm  5곳이면 그대로 (새 객체, 원본은 안 바꿈)
//     createTripBody(form)                         POST /trips 본문 (§B1). 숙소가 없으면 lodging_place_id를 싣지 않는다
//     placeQueryReady(q) / lodgingQueryReady(q)    꼭 갈 곳은 한 글자부터(§B4), 숙소는 두 글자부터(§B5)
//     LODGING_TIMEOUT_MS = 3000                    숙소 검색 시간 초과 (§6)
//     fixedEventError(status, code): string | null 409 PLAN_EXISTS -> "계획을 다시 짜야 해"가 든 안내 (§B3)
//   src/lib/day-list.ts
//     dayPill(state): string                       planning 계획 전 · planned 계획 완료 · today 오늘 · 여행 중 · past 지난 날
//     dayDestination(state, hasCourse): 'planning' | 'course' | 'now' | 'review'
//                                                  오늘인데 고른 코스가 없으면 계획 대화부터 (§9 Q6, DESIGN-001 §4-9)
//   src/lib/calendar.ts (§9 Q17: JS 달력 시트, 한 달 칸, 시작 -> 끝 두 번 누르기. 날짜 규칙은 순수 함수)
//     cityToday(nowMs, timezone = 'Asia/Tokyo'): 'YYYY-MM-DD'   도시 시간대의 오늘 (§9 Q18)
//     monthGrid('YYYY-MM'): (string | null)[][]                한 달 칸: 주마다 7칸(일요일부터, §10 Q28), 그 달 밖은 null
//     startSelectable(date, today): boolean                    시작일 = 오늘 ~ 180일 뒤 (§B1)
//     endSelectable(date, start): boolean                      끝 = 시작 ~ 시작 + 6일 (기간 1~7일, §B1)
//     pickDate({start, end}, date): {start, end}               첫 번째 누름 = 시작, 두 번째(시작 이후, 범위 안) = 끝,
//                                                              두 번째가 시작보다 앞이면 그 날이 새 시작 (§10 Q28)
// 새 모듈은 테스트 안에서 require 한다 (구현 전에도 이 파일의 다른 테스트가 돈다).
import fc from 'fast-check';

type TripForm = {
  startDate: string | null;
  endDate: string | null;
  lodging: { place_id: string; name: string } | null;
  mustVisits: Record<string, string[]>;
};
const lib = () => require('@/lib/create-trip');
const days = () => require('@/lib/day-list');
const form = (over: Partial<TripForm> = {}): TripForm => ({ ...lib().emptyForm(), ...over });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `osaka-fake-${i}`);

// ---------- C6 출처 이름 (ADR-015 §3-5) ----------

describe('C6 출처 이름', () => {
  const sourceLabel = (type: string): string => require('@/lib/source-label').sourceLabel(type);
  test.each([
    ['google', 'Google Maps'], // §11 G1: 번역 금지 (ADR-015 v1.1 §3-5)
    ['serper', '검색 결과 · 미확인'],
    ['user', '내가 확인'],
    ['curated', 'Tripfriends'],
    ['demo', '데모 데이터'],
    ['estimate', '출처 정보'], // DATA-001 B에는 있지만 ADR-015 §3-5 표에 없다 = 그 밖 (§9 Q3)
    ['official', '출처 정보'],
    ['api', '출처 정보'],
    ['', '출처 정보'],
    ['Google', '출처 정보'],
  ])('T10_C6_source_type_%s는_%s', (type, label) => {
    expect(sourceLabel(type)).toBe(label);
  });

  test('T10_C6_속성_표에_없는_값은_모두_출처_정보', () => {
    const known = new Set(['google', 'serper', 'user', 'curated', 'demo']);
    fc.assert(
      fc.property(fc.string(), (type) => {
        fc.pre(!known.has(type));
        expect(sourceLabel(type)).toBe('출처 정보');
      }),
    );
  });
});

// ---------- C5 장소 그림 색 (DESIGN-001 §4-8) ----------

describe('C5 장소 그림 색', () => {
  const placeholderFor = (category: string): [string, string] => require('@/lib/placeholder-for').placeholderFor(category);
  const TABLE: Record<string, [string, string]> = {
    cafe: ['#8D75B7', '#5B457F'],
    food: ['#476C94', '#1B3C60'],
    walk: ['#3A8989', '#005757'],
    museum: ['#746C5C', '#443D2F'],
    landmark: ['#87919C', '#576069'],
    shop: ['#975388', '#612555'],
    experience: ['#4373D5', '#184098'],
    night: ['#403F79', '#191345'],
  };
  test.each(Object.entries(TABLE))('T10_C5_%s는_밝은_끝_깊은_끝', (category, colours) => {
    expect(placeholderFor(category).map((c) => c.toUpperCase())).toEqual(colours);
  });

  test('T10_C5_모르는_종류는_landmark', () => {
    for (const unknown of ['', 'hotel', 'CAFE', '서버_모르는_종류']) expect(placeholderFor(unknown).map((c) => c.toUpperCase())).toEqual(TABLE.landmark);
  });
});

// ---------- C2 여행 만들기 폼 ----------

describe('C2 여행 만들기 폼', () => {
  test('T10_C2_날짜가_없으면_못_만들고_이유_한_줄', () => {
    for (const partial of [{}, { startDate: '2026-12-10' }, { endDate: '2026-12-12' }]) {
      const reason = lib().createBlocker(form(partial));
      expect(typeof reason).toBe('string');
      expect((reason as string).trim().length).toBeGreaterThan(0);
      expect(reason).not.toContain('\n');
    }
  });

  test('T10_C2_날짜가_있으면_막지_않는다_숙소_꼭_갈_곳은_선택', () => {
    expect(lib().createBlocker(form({ startDate: '2026-12-10', endDate: '2026-12-12' }))).toBeNull();
  });

  test.each([
    ['2026-12-10', '2026-12-10', ['2026-12-10']],
    ['2026-12-30', '2027-01-02', ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']],
    ['2027-02-27', '2027-03-01', ['2027-02-27', '2027-02-28', '2027-03-01']],
  ])('T10_C2_날_탭_날짜_%s부터_%s', (start, end, expected) => {
    expect(lib().tripDates(start, end)).toEqual(expected);
  });

  test('T10_C2_A3_하루_꼭_갈_곳은_5곳까지_4곳이면_더할_수_있고_5곳이면_못_더한다', () => {
    const day = '2026-12-10';
    const four = form({ startDate: day, endDate: day, mustVisits: { [day]: ids(4) } });
    expect(lib().canAddMustVisit(four, day)).toBe(true);
    const five = lib().addMustVisit(four, day, 'osaka-fake-kuromon') as TripForm;
    expect(five.mustVisits[day]).toHaveLength(5);
    expect(lib().canAddMustVisit(five, day)).toBe(false);
    const still = lib().addMustVisit(five, day, 'osaka-fake-sky') as TripForm;
    expect(still.mustVisits[day]).toEqual(five.mustVisits[day]);
    expect(four.mustVisits[day]).toHaveLength(4); // 원본은 그대로
  });

  test('T10_D1_다른_날에_담긴_곳은_담을_수_없고_몇_일째인지_안다', () => {
    const f = form({ startDate: '2026-12-10', endDate: '2026-12-12', mustVisits: { '2026-12-10': [], '2026-12-11': ['osaka-fake-kuromon'], '2026-12-12': [] } });
    expect(lib().mustVisitDayNumber(f, 'osaka-fake-kuromon')).toBe(2); // 1부터 센다: "2일째에 담김"
    expect(lib().mustVisitDayNumber(f, 'osaka-fake-sky')).toBeNull();
    const same = lib().addMustVisit(f, '2026-12-12', 'osaka-fake-kuromon') as TripForm;
    expect(same.mustVisits['2026-12-12']).toEqual([]);
    expect(lib().createTripBody(same).must_visits).toEqual([{ date: '2026-12-11', place_id: 'osaka-fake-kuromon' }]);
  });

  test('T10_C2_꼭_갈_곳은_날마다_센다', () => {
    const f = form({ startDate: '2026-12-10', endDate: '2026-12-11', mustVisits: { '2026-12-10': ids(5) } });
    expect(lib().canAddMustVisit(f, '2026-12-10')).toBe(false);
    expect(lib().canAddMustVisit(f, '2026-12-11')).toBe(true);
  });

  test('T10_B1_만들기_본문_숙소_없음', () => {
    const f = form({ startDate: '2026-12-10', endDate: '2026-12-11', mustVisits: { '2026-12-10': ['osaka-fake-kuromon'], '2026-12-11': [] } });
    expect(lib().createTripBody(f)).toEqual({
      city_code: 'osaka',
      start_date: '2026-12-10',
      end_date: '2026-12-11',
      must_visits: [{ date: '2026-12-10', place_id: 'osaka-fake-kuromon' }],
    });
  });

  test('T10_B1_B5_만들기_본문_숙소는_place_id만', () => {
    const f = form({ startDate: '2026-12-10', endDate: '2026-12-10', lodging: { place_id: 'FAKE-lodging-1', name: '난바 테스트 호텔 1' } });
    const body = lib().createTripBody(f);
    expect(body.lodging_place_id).toBe('FAKE-lodging-1');
    expect(JSON.stringify(body)).not.toContain('난바 테스트 호텔 1');
  });

  test('T10_B1_속성_본문의_꼭_갈_곳은_폼의_날마다_목록을_순서대로_펼친_것', () => {
    const dates = ['2026-12-10', '2026-12-11', '2026-12-12'];
    fc.assert(
      fc.property(fc.array(fc.array(fc.constantFrom(...ids(8)), { maxLength: 5 }), { minLength: 3, maxLength: 3 }), (lists) => {
        // §11 D1: 같은 장소는 한 날에만 (앞 날에 있으면 뒤 날에서 뺀다)
        const seen = new Set<string>();
        const mustVisits = Object.fromEntries(
          dates.map((d, i) => [d, [...new Set(lists[i])].filter((id) => !seen.has(id) && (seen.add(id), true))]),
        );
        const body = lib().createTripBody(form({ startDate: dates[0], endDate: dates[2], mustVisits }));
        expect(body.must_visits).toEqual(dates.flatMap((d) => mustVisits[d].map((place_id: string) => ({ date: d, place_id }))));
      }),
    );
  });

  test.each([
    ['', false],
    ['   ', false],
    ['도', true],
    [' 도 ', true],
    ['도톤', true],
  ])('T10_B4_Q14_꼭_갈_곳_검색은_공백을_지우고_한_글자부터_%j', (q, ok) => {
    expect(lib().placeQueryReady(q)).toBe(ok);
  });

  test.each([
    ['', false],
    ['호', false],
    [' 호 ', false],
    ['호텔', true],
    ['  호텔  ', true],
  ])('T10_B5_Q14_숙소_검색은_공백을_지우고_두_글자부터_%j', (q, ok) => {
    expect(lib().lodgingQueryReady(q)).toBe(ok);
  });

  test('T10_6_숙소_검색_시간_초과는_3초', () => {
    expect(lib().LODGING_TIMEOUT_MS).toBe(3000);
  });

  test('T10_B3_계획을_고른_날의_고정_일정_409는_계획을_다시_짜야_해', () => {
    expect(lib().fixedEventError(409, 'PLAN_EXISTS')).toContain('계획을 다시 짜야 해');
  });
});

// ---------- C3 날짜 목록 ----------

describe('C3 날짜 목록 (DESIGN-001 §4-9)', () => {
  test.each([
    ['planning', '계획 전', 'planning'],
    ['planned', '계획 완료', 'course'],
    ['today', '오늘 · 여행 중', 'now'],
    ['past', '지난 날', 'review'],
  ])('T10_C3_%s는_알약_%s_이동_%s', (state, pill, destination) => {
    expect(days().dayPill(state)).toBe(pill);
    expect(days().dayDestination(state, state !== 'planning')).toBe(destination);
  });

  test('T10_C3_Q6_오늘인데_고른_코스가_없으면_계획_대화부터', () => {
    expect(days().dayPill('today')).toBe('오늘 · 여행 중');
    expect(days().dayDestination('today', false)).toBe('planning');
    expect(days().dayDestination('today', true)).toBe('now');
  });
});

// ---------- Q17 달력 시트 (날짜 규칙) ----------

describe('Q17 달력 시트', () => {
  const cal = () => require('@/lib/calendar');
  const addDays = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  test.each([
    ['2026-11-30T14:59:59Z', '2026-11-30'],
    ['2026-11-30T15:00:00Z', '2026-12-01'],
    ['2026-12-31T15:00:00Z', '2027-01-01'],
  ])('T10_Q18_도시_시간대의_오늘_%s는_%s', (iso, day) => {
    expect(cal().cityToday(Date.parse(iso), 'Asia/Tokyo')).toBe(day);
  });

  test.each([
    ['2026-12', 31],
    ['2027-02', 28],
    ['2028-02', 29],
    ['2026-11', 30],
  ])('T10_Q17_한_달_칸_%s에는_그_달_날짜가_순서대로_%i개', (month, count) => {
    const grid = cal().monthGrid(month) as (string | null)[][];
    expect(grid.length).toBeGreaterThanOrEqual(4);
    for (const week of grid) expect(week).toHaveLength(7);
    const flat = grid.flat();
    const dates = flat.filter((d): d is string => d !== null);
    expect(dates).toEqual(Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`));
    // 그 달 밖 칸(null)은 앞과 뒤에만, 앞쪽은 7칸 미만
    const first = flat.indexOf(dates[0]);
    const last = flat.lastIndexOf(dates[dates.length - 1]);
    expect(flat.slice(first, last + 1).every((d) => d !== null)).toBe(true);
    expect(first).toBeLessThan(7);
    expect(flat.length - 1 - last).toBeLessThan(7);
  });

  test('T10_Q28_속성_한_달_칸은_일요일부터', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2026, max: 2030 }), fc.integer({ min: 1, max: 12 }), (year, m) => {
        const month = `${year}-${String(m).padStart(2, '0')}`;
        const flat = (cal().monthGrid(month) as (string | null)[][]).flat();
        const dates = flat.filter((d): d is string => d !== null);
        // 같은 요일은 7칸 간격
        for (let i = 7; i < dates.length; i += 1) expect(flat.indexOf(dates[i]) - flat.indexOf(dates[i - 7])).toBe(7);
        const offset = flat.indexOf(dates[0]);
        const weekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
        expect(offset).toBe(weekday); // 0 = 일요일 칸 (§10 Q28)
      }),
    );
  });

  test.each([
    [-1, false],
    [0, true],
    [180, true],
    [181, false],
  ])('T10_Q17_B1_시작일은_오늘부터_180일_뒤까지_%i일', (offset, ok) => {
    expect(cal().startSelectable(addDays('2026-12-01', offset), '2026-12-01')).toBe(ok);
  });

  test.each([
    [-1, false],
    [0, true],
    [6, true],
    [7, false],
  ])('T10_Q17_B1_끝은_시작부터_7일_안_%i일_뒤', (offset, ok) => {
    expect(cal().endSelectable(addDays('2026-12-28', offset), '2026-12-28')).toBe(ok);
  });

  test('T10_Q17_두_번_누르면_시작과_끝', () => {
    const first = cal().pickDate({ start: null, end: null }, '2026-12-10');
    expect(first).toEqual({ start: '2026-12-10', end: null });
    expect(cal().pickDate(first, '2026-12-12')).toEqual({ start: '2026-12-10', end: '2026-12-12' });
  });

  test('T10_Q28_두_번째로_시작보다_앞_날을_누르면_그_날이_새_시작', () => {
    const first = cal().pickDate({ start: null, end: null }, '2026-12-10');
    expect(cal().pickDate(first, '2026-12-08')).toEqual({ start: '2026-12-08', end: null });
  });

  test('T10_Q17_B1_같은_날을_두_번_누르면_하루_여행', () => {
    const first = cal().pickDate({ start: null, end: null }, '2026-12-10');
    expect(cal().pickDate(first, '2026-12-10')).toEqual({ start: '2026-12-10', end: '2026-12-10' });
  });

  test('T10_Q17_B1_두_번째로_7일을_넘는_날은_끝이_되지_않는다', () => {
    const first = cal().pickDate({ start: null, end: null }, '2026-12-10');
    expect(cal().pickDate(first, '2026-12-17').end).not.toBe('2026-12-17');
  });
});

// ---------- §11 G3 Roboto는 JS 글꼴 불러오기로 ----------

describe('G3 Roboto', () => {
  test('T10_G3_글꼴_묶음에_Roboto_400이_있다', () => {
    const { fontAssets } = require('@/planning/fonts');
    expect(Object.keys(fontAssets)).toContain('Roboto_400Regular');
  });
});

// ---------- §13 O4 늘 열림·우리가 정한 시간대 ----------

describe('§13 O4 열린 장소 글자', () => {
  const hoursText = (fact: object) => {
    const facts = [{ field: 'stay_min', value: '{}', status: 'confirmed', source_type: 'curated' }, fact];
    return require('@/lib/today-hours-text').todayHoursText(facts as never) as { text: string; chip: string };
  };
  const sourceLabel = (type: string): string => require('@/lib/source-label').sourceLabel(type);

  test('T10_S13_O4_늘_열림은_늘_열려_있어_확인됨_출처_Tripfriends', () => {
    const found = hoursText({ field: 'opening_hours', value: '00:00-24:00', status: 'confirmed', source_type: 'curated', source_url: null, checked_at: null });
    expect(found).toEqual({ text: '늘 열려 있어', chip: 'confirmed' });
    expect(sourceLabel('curated')).toBe('Tripfriends');
  });

  test('T10_S13_O4_우리가_정한_시간대는_시각_그대로_확인됨', () => {
    const found = hoursText({ field: 'opening_hours', value: '17:00-24:00', status: 'confirmed', source_type: 'curated', source_url: null, checked_at: null });
    expect(found).toEqual({ text: '17:00-24:00', chip: 'confirmed' });
  });

  test('T10_S13_O4_다른_시각은_전과_같다', () => {
    expect(hoursText({ field: 'opening_hours', value: '06:00-22:00', status: 'confirmed', source_type: 'google', source_url: null, checked_at: null })).toEqual({ text: '06:00-22:00', chip: 'confirmed' });
    expect(hoursText({ field: 'opening_hours', value: null, status: 'unknown', source_type: 'google', source_url: null, checked_at: null })).toEqual({ text: '영업시간 모름', chip: 'unknown' });
  });
});
