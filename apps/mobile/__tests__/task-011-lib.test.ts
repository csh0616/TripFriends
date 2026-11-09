/// <reference types="jest" />
// TASK-011 A0 화면 규칙 함수 (모습이 아니라 규칙만). 근거: TASK-011 §A A0·§6·AC-2, DESIGN-001 §4-11(날 이름·날짜 목록·시각 범위),
// task-011-review.md §2 13번 줄(아래 큰 버튼)·5번 줄(머리)·20번 줄(엔 대시), DESIGN-001 §4-9(오늘인데 계획 전이면 계획 대화부터).
//
// 계약 (이 테스트가 정한 이름·모양, 승인 대기):
//   src/lib/day-list.ts
//     dayListPrimary(days, today): { label, dayId, sublabel } | null
//       today = 도시 시간대의 오늘 'YYYY-MM-DD'. days = Trip.trip_days (서버가 계산한 state 그대로)
//       오늘이 여행 중(그날 state 'today') -> label '오늘 여행 보기', dayId = 그날, sublabel "1일째 · 12/11 금" (§9 Q4, 코스가 없어도 같다)
//       아니면 다음 계획 전 날(state 'planning' 중 맨 앞) -> label '같이 고르기', sublabel "2일째 · 12/12 토"
//       둘 다 없으면(모두 계획 완료·지난 날) -> null (주 버튼 없음)
//     tripHeader(trip, today): { title, dots, line }
//       §9 Q5: title "오사카 2박 3일"(하루면 "오사카 당일 여행", 끝난 뒤에도 그대로)
//              dots = 날 순서대로 한 자리씩, 그날 고른 코스(chosen_option_id)가 있으면 ●, 없으면 ○ (오늘·지난 날 포함)
//              line = "{오른쪽 말} · N일 중 K일 계획 완료", K = 고른 코스가 있는 날 수. 오른쪽 말 = 여행 전 "D-35" · 여행 중 "여행 중"
//       §10 E2·§11 Q3·§15 Q2: 여행 끝 = line "여행 끝"만 (계획 완료 수 없음). 점은 여행 끝에도 같은 규칙(고른 코스가 있는 날만 ●)
//   src/planning/format.ts (화면 글자 함수가 모인 곳. dayName이 이미 여기 있다)
//     dayName(n): "N일째" (n = 1부터 세는 날 번호, 서버 day_number와 같다)
//     timeRange(a, b): "a–b" (엔 대시 U+2013)
// 새 함수는 테스트 안에서 require 한다 (구현 전에도 이 파일의 다른 테스트가 돈다).
import fc from 'fast-check';

type Day = { day_id: string; date: string; state: 'planning' | 'planned' | 'today' | 'past'; chosen_option_id: string | null; fixed_events: unknown[] };
type Primary = { label: string; dayId: string; sublabel: string | null } | null;
type Header = { title: string; dots: string; line: string };

const days = () => require('@/lib/day-list');
const format = () => require('@/planning/format');
const primary = (list: Day[], today: string): Primary => days().dayListPrimary(list, today);
const header = (trip: object, today: string): Header => days().tripHeader(trip, today);

const EN_DASH = '–';
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** "12/12 토" */
const shortWithWeekday = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;

// 보드 F04의 예: 12/11 금 ~ 12/13 일, 2박 3일 (2026-12-01이 화요일, task-011-review §2 5번 줄)
const START = '2026-12-11';
const day = (n: number, state: Day['state'], chosen = state !== 'planning'): Day => ({
  day_id: `d${n}`,
  date: addDays(START, n - 1),
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [],
});
const trip = (list: Day[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: list[0].date,
  end_date: list[list.length - 1].date,
  lodging_place_id: null,
  status: 'active',
  trip_days: list,
});

const BEFORE = '2026-11-06'; // 12/11까지 35일 -> D-35 (review §2 5번 줄의 예)

// ---------- dayName / timeRange ----------

describe('A0 dayName: 모든 화면 "N일째"', () => {
  test.each([
    [1, '1일째'],
    [2, '2일째'],
    [5, '5일째'],
    [6, '6일째'],
    [7, '7일째'],
    [10, '10일째'],
  ])('T11_A0_dayName(%i)은_%s', (n, name) => {
    expect(format().dayName(n)).toBe(name);
  });

  test('T11_A0_dayName은_어떤_날도_첫째_날·Day_N을_쓰지_않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
        const name: string = format().dayName(n);
        expect(name).toBe(`${n}일째`);
        expect(name).not.toMatch(/째 날|Day|첫째|둘째|셋째|넷째|다섯째/);
      }),
    );
  });
});

describe('A0 timeRange: 시각 범위는 엔 대시', () => {
  test.each([
    ['17:00', '23:00', '17:00–23:00'],
    ['13:00', '21:00', '13:00–21:00'],
    ['00:00', '24:00', '00:00–24:00'],
    ['09:00', '17:00', '09:00–17:00'],
  ])('T11_A0_timeRange(%s,%s)는_%s', (a, b, expected) => {
    expect(format().timeRange(a, b)).toBe(expected);
    expect(expected).toContain(EN_DASH); // 표 자체가 하이픈이 아닌지
  });

  test('T11_A0_timeRange는_하이픈·물결을_쓰지_않고_사이에_엔_대시_하나', () => {
    const clock = fc.tuple(fc.integer({ min: 0, max: 24 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    fc.assert(
      fc.property(clock, clock, (a, b) => {
        const out: string = format().timeRange(a, b);
        expect(out).toBe(`${a}${EN_DASH}${b}`);
        expect(out).not.toMatch(/[-~]/);
      }),
    );
  });
});

// ---------- dayListPrimary (AC-2 경계) ----------

describe('A0 dayListPrimary: 아래 큰 버튼 하나 (AC-2)', () => {
  test('T11_AC2_다음_계획_전_날_1일째_계획_완료면_2일째_같이_고르기', () => {
    const found = primary([day(1, 'planned'), day(2, 'planning'), day(3, 'planning')], BEFORE);
    expect(found).toEqual({ label: '같이 고르기', dayId: 'd2', sublabel: '2일째 · 12/12 토' });
  });

  test('T11_AC2_다음_계획_전_날_첫날부터_계획_전이면_1일째', () => {
    const found = primary([day(1, 'planning'), day(2, 'planning'), day(3, 'planning')], BEFORE);
    expect(found).toEqual({ label: '같이 고르기', dayId: 'd1', sublabel: '1일째 · 12/11 금' });
  });

  test('T11_AC2_다음_계획_전_날_사이가_비어도_앞에서부터_첫_계획_전', () => {
    const found = primary([day(1, 'planned'), day(2, 'planned'), day(3, 'planning')], BEFORE);
    expect(found).toEqual({ label: '같이 고르기', dayId: 'd3', sublabel: '3일째 · 12/13 일' });
  });

  test('T11_AC2_다음_계획_전_날_앞의_날이_계획_전이고_뒤가_계획_완료여도_앞의_날', () => {
    const found = primary([day(1, 'planned'), day(2, 'planning'), day(3, 'planned')], BEFORE);
    expect(found?.dayId).toBe('d2');
  });

  test('T11_AC2_모두_계획_완료면_주_버튼_없음(null)', () => {
    expect(primary([day(1, 'planned'), day(2, 'planned'), day(3, 'planned')], BEFORE)).toBeNull();
  });

  test('T11_AC2_오늘_여행_중(코스_있음)이면_오늘_여행_보기', () => {
    const found = primary([day(1, 'past'), day(2, 'today', true), day(3, 'planning')], '2026-12-12');
    expect(found).toEqual({ label: '오늘 여행 보기', dayId: 'd2', sublabel: '2일째 · 12/12 토' }); // §9 Q4
  });

  test('T11_AC2_오늘_여행_중이면_뒤에_계획_전_날이_있어도_오늘이_먼저', () => {
    const found = primary([day(1, 'today', true), day(2, 'planning'), day(3, 'planning')], '2026-12-11');
    expect(found).toEqual({ label: '오늘 여행 보기', dayId: 'd1', sublabel: '1일째 · 12/11 금' }); // §9 Q4의 예
  });

  test('T11_AC2_오늘인데_코스_없음이어도_버튼은_오늘_여행_보기_누르면_계획_대화', () => {
    const today = day(2, 'today', false);
    const found = primary([day(1, 'past'), today, day(3, 'planned')], '2026-12-12');
    expect(found).toEqual({ label: '오늘 여행 보기', dayId: 'd2', sublabel: '2일째 · 12/12 토' });
    // §6: 오늘 코스가 없는데 [오늘 여행 보기] -> 계획 대화 (TASK-010 Q6과 같음)
    expect(days().dayDestination(today.state, today.chosen_option_id !== null)).toBe('planning');
  });

  test('T11_AC2_마지막_날이_오늘이면_오늘_여행_보기', () => {
    const found = primary([day(1, 'past'), day(2, 'past'), day(3, 'today', true)], '2026-12-13');
    expect(found).toEqual({ label: '오늘 여행 보기', dayId: 'd3', sublabel: '3일째 · 12/13 일' });
  });

  test('T11_AC2_지난_날만_남으면_주_버튼_없음(null)', () => {
    expect(primary([day(1, 'past'), day(2, 'past'), day(3, 'past')], '2026-12-14')).toBeNull();
  });

  test('T11_AC2_지난_날만_남음_계획_안_한_지난_날이_있어도_null', () => {
    expect(primary([day(1, 'past', false), day(2, 'past', true), day(3, 'past', false)], '2026-12-20')).toBeNull();
  });

  // 경계: 여행 첫날 하루 전(D-1)은 아직 여행 전, 첫날(D-0)은 여행 중
  test('T11_AC2_경계_첫날_하루_전은_같이_고르기', () => {
    expect(primary([day(1, 'planning'), day(2, 'planning')], '2026-12-10')).toMatchObject({ label: '같이 고르기', dayId: 'd1' });
  });

  test('T11_AC2_경계_첫날_당일은_오늘_여행_보기', () => {
    expect(primary([day(1, 'today', false), day(2, 'planning')], '2026-12-11')).toMatchObject({ label: '오늘 여행 보기', dayId: 'd1' });
  });

  test('T11_AC2_경계_마지막_날_다음_날은_null', () => {
    expect(primary([day(1, 'past'), day(2, 'past')], '2026-12-13')).toBeNull();
  });

  test('T11_AC2_하루짜리_여행_계획_전이면_1일째_같이_고르기', () => {
    expect(primary([day(1, 'planning')], BEFORE)).toEqual({ label: '같이 고르기', dayId: 'd1', sublabel: '1일째 · 12/11 금' });
  });

  test('T11_AC2_같은_입력이면_원본_목록을_바꾸지_않는다', () => {
    const list = [day(1, 'planned'), day(2, 'planning'), day(3, 'planning')];
    const copy = JSON.parse(JSON.stringify(list));
    primary(list, BEFORE);
    expect(list).toEqual(copy);
  });

  test('T11_AC2_속성_어떤_날짜_어떤_계획이든_규칙이_같다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }),
        fc.integer({ min: -40, max: 10 }),
        fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
        (count, offset, plans) => {
          const today = addDays(START, offset);
          const list: Day[] = Array.from({ length: count }, (_, i) => {
            const date = addDays(START, i);
            const state: Day['state'] = date < today ? 'past' : date === today ? 'today' : plans[i] ? 'planned' : 'planning';
            return { day_id: `d${i + 1}`, date, state, chosen_option_id: plans[i] ? `opt-${i + 1}` : null, fixed_events: [] };
          });
          const found = primary(list, today);
          const todayIndex = list.findIndex((one) => one.state === 'today');
          const nextIndex = list.findIndex((one) => one.state === 'planning');
          if (todayIndex >= 0) {
            expect(found).toEqual({
              label: '오늘 여행 보기',
              dayId: list[todayIndex].day_id,
              sublabel: `${todayIndex + 1}일째 · ${shortWithWeekday(list[todayIndex].date)}`,
            });
          } else if (nextIndex >= 0) {
            expect(found).toEqual({
              label: '같이 고르기',
              dayId: list[nextIndex].day_id,
              sublabel: `${nextIndex + 1}일째 · ${shortWithWeekday(list[nextIndex].date)}`,
            });
          } else {
            expect(found).toBeNull();
          }
          // 주 버튼은 계획 완료·지난 날을 가리키지 않는다
          if (found) expect(['planned', 'past']).not.toContain(list.find((one) => one.day_id === found.dayId)?.state);
        },
      ),
    );
  });
});

// ---------- tripHeader ----------

describe('A0 tripHeader: 머리 (task-011-review §2 5번 줄)', () => {
  const three = (states: Day['state'][]) => trip(states.map((state, i) => day(i + 1, state)));

  test('T11_A0_tripHeader_여행_전_보드_예_그대로', () => {
    expect(header(three(['planned', 'planning', 'planning']), BEFORE)).toEqual({
      title: '오사카 2박 3일',
      dots: '●○○',
      line: 'D-35 · 3일 중 1일 계획 완료',
    });
  });

  test('T11_A0_tripHeader_아무것도_계획_안_했으면_빈_점과_0일', () => {
    expect(header(three(['planning', 'planning', 'planning']), BEFORE)).toEqual({
      title: '오사카 2박 3일',
      dots: '○○○',
      line: 'D-35 · 3일 중 0일 계획 완료',
    });
  });

  test('T11_A0_tripHeader_모두_계획_완료면_찬_점_셋', () => {
    expect(header(three(['planned', 'planned', 'planned']), BEFORE)).toEqual({
      title: '오사카 2박 3일',
      dots: '●●●',
      line: 'D-35 · 3일 중 3일 계획 완료',
    });
  });

  test('T11_A0_tripHeader_경계_첫날_하루_전은_D-1', () => {
    expect(header(three(['planned', 'planning', 'planning']), '2026-12-10').line).toBe('D-1 · 3일 중 1일 계획 완료');
  });

  test('T11_A0_tripHeader_경계_첫날_당일은_D-숫자_대신_여행_중', () => {
    // 첫날 오늘(코스 있음) -> 오늘도 계획 완료로 센다 (§9 Q5)
    expect(header(three(['today', 'planning', 'planning']), '2026-12-11')).toEqual({ title: '오사카 2박 3일', dots: '●○○', line: '여행 중 · 3일 중 1일 계획 완료' });
  });

  test('T11_Q5_오늘인데_코스_없음은_빈_자리', () => {
    const list = [day(1, 'past', true), day(2, 'today', false), day(3, 'planned')];
    expect(header(trip(list), '2026-12-12')).toEqual({ title: '오사카 2박 3일', dots: '●○●', line: '여행 중 · 3일 중 2일 계획 완료' });
  });

  test('T11_Q5_점은_날_순서_자리(앞에서부터_채우지_않는다)', () => {
    expect(header(three(['planning', 'planned', 'planning']), BEFORE).dots).toBe('○●○');
    expect(header(three(['planning', 'planning', 'planned']), BEFORE).dots).toBe('○○●');
  });

  test('T11_Q5_지난_날도_고른_코스가_있으면_센다', () => {
    const list = [day(1, 'past', true), day(2, 'past', false), day(3, 'today', true)];
    expect(header(trip(list), '2026-12-13')).toEqual({ title: '오사카 2박 3일', dots: '●○●', line: '여행 중 · 3일 중 2일 계획 완료' });
  });

  test('T11_A0_tripHeader_경계_마지막_날도_여행_중', () => {
    expect(header(three(['past', 'past', 'today']), '2026-12-13').line).toMatch(/^여행 중 · 3일 중 \d일 계획 완료$/);
  });

  test('T11_E2_경계_마지막_날_다음_날은_여행_끝_모두_코스_있으면_점_전부_제목은_그대로', () => {
    const found = header(three(['past', 'past', 'past']), '2026-12-14'); // 세 날 모두 고른 코스 있음
    expect(found.title).toBe('오사카 2박 3일');
    expect(found.dots).toBe('●●●');
    expect(found.line).toBe('여행 끝');
  });

  // §15 Q2: 여행 끝에도 예외 없음. 코스 없이 지난 날은 빈 점
  test('T11_S15_Q2_여행_끝_코스_없는_지난_날이_섞이면_그_날은_빈_점', () => {
    const list = [day(1, 'past', true), day(2, 'past', false), day(3, 'past', false)];
    const found = header(trip(list), '2027-03-01');
    expect(found.dots).toBe('●○○');
    expect(found.line).toBe('여행 끝');
  });

  test('T11_S15_Q2_여행_끝_가운데_날만_코스_없으면_가운데만_빈_점', () => {
    const list = [day(1, 'past', true), day(2, 'past', false), day(3, 'past', true)];
    expect(header(trip(list), '2026-12-14').dots).toBe('●○●');
  });

  test('T11_S15_Q2_여행_끝_모든_날_코스_없으면_점_모두_빈_점', () => {
    const list = [day(1, 'past', false), day(2, 'past', false), day(3, 'past', false)];
    expect(header(trip(list), '2026-12-14')).toEqual({ title: '오사카 2박 3일', dots: '○○○', line: '여행 끝' });
  });

  test('T11_S15_Q2_속성_여행_끝_점은_고른_코스가_있는_날만', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 200 }), fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), (count, after, plans) => {
        const list = Array.from({ length: count }, (_, i) => day(i + 1, 'past', plans[i]));
        const found = header(trip(list), addDays(list[count - 1].date, after));
        expect(found.line).toBe('여행 끝');
        expect(found.dots).toBe(list.map((one) => (one.chosen_option_id ? '●' : '○')).join(''));
      }),
    );
  });

  test('T11_Q5_하루_여행_제목은_오사카_당일_여행', () => {
    expect(header(trip([day(1, 'planning')]), BEFORE)).toEqual({ title: '오사카 당일 여행', dots: '○', line: 'D-35 · 1일 중 0일 계획 완료' });
    expect(header(trip([day(1, 'past', true)]), '2026-12-12').title).toBe('오사카 당일 여행');
  });

  test.each([
    [2, '오사카 1박 2일'],
    [3, '오사카 2박 3일'],
    [7, '오사카 6박 7일'],
  ])('T11_A0_tripHeader_%i일_여행_제목은_%s', (count, title) => {
    const list = Array.from({ length: count }, (_, i) => day(i + 1, 'planning'));
    expect(header(trip(list), BEFORE).title).toBe(title);
  });

  test('T11_A0_tripHeader_속성_여행_전에는_D-남은_날과_계획_완료_수', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), fc.integer({ min: 1, max: 180 }), fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), (count, before, plans) => {
        const list = Array.from({ length: count }, (_, i) => day(i + 1, plans[i] ? 'planned' : 'planning'));
        const planned = list.filter((one) => one.state === 'planned').length;
        const found = header(trip(list), addDays(START, -before));
        expect(found.title).toBe(`오사카 ${count - 1}박 ${count}일`);
        expect(found.dots).toBe(list.map((one) => (one.chosen_option_id ? '●' : '○')).join(''));
        expect(found.line).toBe(`D-${before} · ${count}일 중 ${planned}일 계획 완료`);
      }),
    );
  });

  test('T11_Q5_속성_여행_중에는_어느_날이든_여행_중_계획_완료는_고른_코스_수', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 6 }), fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), (count, at, plans) => {
        const index = at % count;
        const list = Array.from({ length: count }, (_, i) => day(i + 1, i < index ? 'past' : i === index ? 'today' : plans[i] ? 'planned' : 'planning', plans[i]));
        const chosen = list.filter((one) => one.chosen_option_id !== null).length;
        const found = header(trip(list), list[index].date);
        expect(found.line).toBe(`여행 중 · ${count}일 중 ${chosen}일 계획 완료`);
        expect(found.dots).toBe(list.map((one) => (one.chosen_option_id ? '●' : '○')).join(''));
      }),
    );
  });
});

// ---------- §13 3: 머리는 날 상태와 같은 시계 ----------
// 계약 (이 테스트가 정한 것): 서버 응답(Trip/TripDay)에 "오늘" 칸이 없으므로, 여행 중·여행 끝은 서버가 계산한 날 state로 정한다.
//   어느 날이 'today'면 "여행 중", 모든 날이 'past'면 "여행 끝" — today 인자(기기 시계)가 달라도 같다. D-숫자만 today 인자로 센다
describe('§13 3 tripHeader·dayListPrimary는 날 상태를 따른다', () => {
  const three = (states: Day['state'][]) => trip(states.map((state, i) => day(i + 1, state)));

  test('T11_S13_3_데모처럼_날_상태가_오늘이면_기기_시계가_22일_전이어도_여행_중', () => {
    const found = header(three(['past', 'today', 'planning']), addDays(START, -22));
    expect(found.line).toBe('여행 중 · 3일 중 2일 계획 완료');
    expect(found.line).not.toMatch(/D-/);
  });

  test('T11_S13_3_기기_시계가_여행_뒤여도_날_상태가_오늘이면_여행_중', () => {
    expect(header(three(['past', 'past', 'today']), '2027-01-30').line).toMatch(/^여행 중 · /);
  });

  test('T11_S13_3_모든_날이_지난_날이면_기기_시계가_여행_전이어도_여행_끝', () => {
    expect(header(three(['past', 'past', 'past']), BEFORE)).toEqual({ title: '오사카 2박 3일', dots: '●●●', line: '여행 끝' });
  });

  test('T11_S13_3_오늘_버튼도_날_상태를_따른다(기기_시계와_달라도)', () => {
    const found = primary([day(1, 'past'), day(2, 'today', true), day(3, 'planning')], addDays(START, -22));
    expect(found).toEqual({ label: '오늘 여행 보기', dayId: 'd2', sublabel: '2일째 · 12/12 토' });
  });

  test('T11_S13_3_속성_오늘_상태가_있으면_어떤_기기_날짜든_여행_중', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: -200, max: 200 }), (count, at, shift) => {
        const index = at % count;
        const list = Array.from({ length: count }, (_, i) => day(i + 1, i < index ? 'past' : i === index ? 'today' : 'planning'));
        const found = header(trip(list), addDays(START, shift));
        expect(found.line.startsWith('여행 중 · ')).toBe(true);
      }),
    );
  });
});

// ---------- §14 N9: "늘 열려 있어"에도 "확인됨" 칩 (§9 Q10 고침) ----------
// 근거: TASK-011 §14 N9·§9 Q10(고친 줄), DESIGN-001 §4-11 재검수로 정한 것, task-011-review.md §9-3 N9.
// 계약: hoursView(facts).chip = 화면 칩. curated 늘 열림("00:00-24:00")은 데이터 status 그대로(여기서는 'confirmed' -> "확인됨"), 밤거리(curated 시간대)는 그대로 'hint'

describe('§14 N9 hoursView 늘 열림 칩', () => {
  const view = (over: object) => require('@/lib/today-hours-text').hoursView([{ field: 'opening_hours', status: 'confirmed', ...over }]);

  test('T11_S14_N9_늘_열림은_확인됨_칩과_늘_열려_있어', () => {
    expect(view({ source_type: 'curated', value: '00:00-24:00' })).toEqual({ text: '늘 열려 있어', chip: 'confirmed' });
  });

  test('T11_S14_N9_밤거리_curated_시간대는_그대로_추천_시간대', () => {
    expect(view({ source_type: 'curated', value: '17:00-24:00' })).toEqual({ text: `17:00${EN_DASH}24:00`, chip: 'hint' });
  });

  test('T11_S14_N9_경계_24시간이_아닌_00:00-23:59는_늘_열림이_아니라_추천_시간대', () => {
    expect(view({ source_type: 'curated', value: '00:00-23:59' }).chip).toBe('hint');
  });
});

// ---------- §14 N13 + (a): 후보 카드 높이를 이루는 값 ----------
// 근거: TASK-011 §14 N13 + (a), task-011-review.md §9-4 (a)·§12-4 1(카드 433 = 316 + 12 + 46 + 12 + 24 + 4 + 19), DESIGN-001 §4-11 재검수로 정한 것.
// 계약: src/planning/candidate-fit.ts
//   candidateCardParts() = { photo 316, photoGap 12, nameWhy 46, factGap 12, factLine 24, sourceGap 4, source 19 }
//   candidateCardHeight() = 합 = 433
// TASK-011 v1.8 §16 "776"·§15 작은 질문: 화면 고정 높이 합(776 → 실측 817 → 고친 뒤 805)은 테스트하지 않는다.
//   그래서 candidateRoom(776 기준 남는 자리)·sourceClearsBar(남는 자리 ≥ 12) 테스트를 뺐다 (리뷰 §12-3은 간격 = 막대 위 12 + 남는 자리로 셈이 다르다).
// 실제 간격(출처 줄 아랫변 ≤ 막대 윗변 − 12, iPhone 17 처음 화면)은 r3-06 스크린샷으로 확인한다 (§16 촬영).

describe('§14 N13 (a) 후보 카드 자리 규칙', () => {
  const fit = () => require('@/planning/candidate-fit');
  const { FIT, LISTS, NUMBERS } = require('../test-support/design-table');

  test('T11_S14_a_카드_높이를_이루는_값은_리뷰_9-4_그대로', () => {
    expect(fit().candidateCardParts()).toEqual({ photo: 316, photoGap: 12, nameWhy: 46, factGap: 12, factLine: 24, sourceGap: 4, source: 19 });
  });

  test('T11_S14_a_값은_토큰과_같다(큰_카드_316·space-3·fact-line)', () => {
    const parts = fit().candidateCardParts();
    expect(parts.photo).toBe(LISTS['cover-lg'][1]);
    expect(parts.photoGap).toBe(NUMBERS['space-3']);
    expect(parts.factGap).toBe(NUMBERS['space-3']);
    expect(parts.factLine).toBe(FIT['fact-line'].height);
    expect(parts.sourceGap).toBe(FIT['fact-line'].sourceGap);
    expect(parts.source).toBe(FIT['fact-line'].sourceHeight);
  });

  test('T11_S14_a_카드_높이는_433이고_값들의_합', () => {
    const parts = fit().candidateCardParts();
    const sum = Object.values(parts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(fit().candidateCardHeight()).toBe(433);
    expect(fit().candidateCardHeight()).toBe(sum);
  });
});
