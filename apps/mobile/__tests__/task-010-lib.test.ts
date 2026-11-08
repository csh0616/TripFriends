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
//     addMustVisit(form, date, placeId): TripForm  5곳이면 그대로 (새 객체, 원본은 안 바꿈)
//     createTripBody(form)                         POST /trips 본문 (§B1). 숙소가 없으면 lodging_place_id를 싣지 않는다
//     placeQueryReady(q) / lodgingQueryReady(q)    꼭 갈 곳은 한 글자부터(§B4), 숙소는 두 글자부터(§B5)
//     LODGING_TIMEOUT_MS = 3000                    숙소 검색 시간 초과 (§6)
//     fixedEventError(status, code): string | null 409 PLAN_EXISTS -> "계획을 다시 짜야 해"가 든 안내 (§B3)
//   src/lib/day-list.ts
//     dayPill(state): string                       planning 계획 전 · planned 계획 완료 · today 오늘 · 여행 중 · past 지난 날
//     dayDestination(state): 'planning' | 'course' | 'now' | 'review'
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
    ['google', 'Google 지도'],
    ['serper', '검색 결과 · 미확인'],
    ['user', '내가 확인'],
    ['curated', 'Tripfriends'],
    ['demo', '데모 데이터'],
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
        const mustVisits = Object.fromEntries(dates.map((d, i) => [d, [...new Set(lists[i])]]));
        const body = lib().createTripBody(form({ startDate: dates[0], endDate: dates[2], mustVisits }));
        expect(body.must_visits).toEqual(dates.flatMap((d) => mustVisits[d].map((place_id: string) => ({ date: d, place_id }))));
      }),
    );
  });

  test.each([
    ['', false],
    ['도', true],
    ['도톤', true],
  ])('T10_B4_꼭_갈_곳_검색은_한_글자부터_%j', (q, ok) => {
    expect(lib().placeQueryReady(q)).toBe(ok);
  });

  test.each([
    ['', false],
    ['호', false],
    ['호텔', true],
  ])('T10_B5_숙소_검색은_두_글자부터_%j', (q, ok) => {
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
    expect(days().dayDestination(state)).toBe(destination);
  });
});
