/// <reference types="jest" />
// delayedPosition 순수 함수. 근거: TASK-007 §14 (데모 지연 위치), §13 ([+10분 늦게]의 뜻 = "아직 앞 장소에 머물러 있다"), 승현 결정(앱을 고친다).
// 계약: delayedPosition(at, delayMin, course) — at은 fakePosition과 같은 'YYYY-MM-DDTHH:MM:SS', delayMin은 분, course는 FakeCourse.
//  - delayMin = 0 → fakePosition(at, course) 그대로 (길 위 보간 유지)
//  - delayMin > 0, 기준 시각 t = at − delayMin:
//      t가 일정 안 → 그 장소 / t가 이동 중(앞 장소 끝 ~ 다음 장소 시작) → 막 떠난 앞 장소 / t가 첫 일정 전 → 숙소
import fc from 'fast-check';

type Spot = { lat: number; lng: number };
type Item = Spot & { start: string; end: string; travel_min: number };
type Course = { lodging: Spot; items: Item[]; go_home_min: number | null };

const lib = () => require('@/lib/fake-position');
const delayedPosition = (at: string, delayMin: number, course: Course): Spot | null => lib().delayedPosition(at, delayMin, course);
const fakePosition = (at: string, course: Course): Spot | null => lib().fakePosition(at, course);

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const at = (minutes: number) => `2026-12-02T${clock(minutes)}:00`;
const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const HOME = { lat: 35, lng: 135 };
const A = { lat: 35.1, lng: 135.2 };
const B = { lat: 35.3, lng: 135.6 };
const C = { lat: 35.5, lng: 135.1 };
// 1번 10:12~12:00(출발 10:00), 2번 12:20~14:00, 3번 14:30~19:00, 숙소까지 25분
const COURSE: Course = {
  lodging: HOME,
  go_home_min: 25,
  items: [
    { ...A, start: '10:12', end: '12:00', travel_min: 12 },
    { ...B, start: '12:20', end: '14:00', travel_min: 20 },
    { ...C, start: '14:30', end: '19:00', travel_min: 30 },
  ],
};

const expectAt = (actual: Spot | null, expected: Spot) => {
  expect(actual).not.toBeNull();
  expect((actual as Spot).lat).toBeCloseTo(expected.lat, 9);
  expect((actual as Spot).lng).toBeCloseTo(expected.lng, 9);
};

/** 기준 시각 t(HH:MM)가 되도록 지금 = t + 지연 */
const shifted = (t: string, delay: number) => delayedPosition(at(min(t) + delay), delay, COURSE);

describe('§14 예시 (지연 10분, 기준 시각 t = 지금 − 10분)', () => {
  test.each([
    ['1번 시작 정각', '10:12', A],
    ['1번 안', '11:00', A],
    ['1번 끝 1분 전', '11:59', A],
    ['2번 시작 정각', '12:20', B],
    ['2번 끝 1분 전', '13:59', B],
    ['3번 안', '15:00', C],
  ])('T7_S14_일정_안이면_그_장소_%s', (_name, t, spot) => {
    expectAt(shifted(t, 10), spot);
  });

  test.each([
    ['이동 시작 정각(1번 끝)', '12:00', A],
    ['이동 처음 1분', '12:01', A],
    ['이동 중간', '12:10', A],
    ['다음 시작 1분 전', '12:19', A],
    ['2→3 이동 시작 정각(2번 끝)', '14:00', B],
    ['2→3 이동 중간', '14:15', B],
    ['2→3 다음 시작 1분 전', '14:29', B],
  ])('T7_S14_이동_중이면_막_떠난_앞_장소_%s', (_name, t, spot) => {
    expectAt(shifted(t, 10), spot);
  });

  test('T7_S14_다음_시작_정각이면_다음_장소', () => {
    expectAt(shifted('12:20', 10), B);
    expectAt(shifted('14:30', 10), C);
  });

  test('T7_S14_마지막_일정_끝_정각은_마지막_장소', () => {
    expectAt(shifted('19:00', 10), C);
  });

  test.each(['19:01', '19:12', '19:24'])('T7_S14_마지막_뒤_숙소로_가는_중_%s는_마지막_장소', (t) => {
    expectAt(shifted(t, 10), C);
  });

  test('T7_S14_숙소까지_시간을_모르면_마지막_뒤도_마지막_장소', () => {
    expectAt(delayedPosition(at(min('19:40')), 10, { ...COURSE, go_home_min: null }), C);
  });

  test.each([
    ['아주 이른 시각', '07:00'],
    ['1번 출발 1분 전', '09:59'],
    ['1번 출발 정각', '10:00'],
    ['숙소→1번 이동 중간', '10:06'],
    ['1번 시작 1분 전', '10:11'],
  ])('T7_S14_첫_일정_전이면_숙소_%s', (_name, t) => {
    expectAt(shifted(t, 10), HOME);
  });

  test('T7_S14_첫_일정_전_숙소는_fakePosition의_길_위_보간과_다르다', () => {
    // 10:06은 fakePosition이면 숙소와 1번의 가운데. §14는 숙소
    const position = shifted('10:06', 10) as Spot;
    expect(position.lat).not.toBeCloseTo((HOME.lat + A.lat) / 2, 6);
    expectAt(position, HOME);
  });

  test('T7_S14_지연이_자정을_넘겨_앞으로_가도_첫_일정_전이라_숙소', () => {
    expectAt(delayedPosition(at(5), 10, COURSE), HOME);
  });
});

describe('§14 지연 0 = fakePosition 그대로', () => {
  test.each(['09:00', '10:06', '11:00', '12:00', '12:10', '12:19', '12:20', '19:10', '19:30'])('T7_S14_지연_0이면_fakePosition과_같다_%s', (t) => {
    expect(delayedPosition(at(min(t)), 0, COURSE)).toEqual(fakePosition(at(min(t)), COURSE));
  });

  test('T7_S14_지연_0의_이동_중은_길_위_보간_유지', () => {
    expectAt(delayedPosition(at(min('12:10')), 0, COURSE), { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 });
  });
});

describe('§14 지연 크기', () => {
  test('T7_S14_지연_10과_20은_기준_시각만_다르다', () => {
    // 지금 12:30: 지연 10 → 12:20 (2번 시작 정각, 2번) / 지연 20 → 12:10 (이동 중, 1번)
    expectAt(delayedPosition(at(min('12:30')), 10, COURSE), B);
    expectAt(delayedPosition(at(min('12:30')), 20, COURSE), A);
  });

  test('T7_S14_지연_60과_70의_경계', () => {
    // 지금 13:20: 지연 60 → 12:20 (2번 시작 정각) / 지연 70 → 12:10 (이동 중, 1번)
    expectAt(delayedPosition(at(min('13:20')), 60, COURSE), B);
    expectAt(delayedPosition(at(min('13:20')), 70, COURSE), A);
  });

  test('T7_S14_1분_지연도_길_위가_아니다', () => {
    expectAt(delayedPosition(at(min('12:11')), 1, COURSE), A);
  });

  test('T7_S14_순수_함수_같은_입력은_같은_출력이고_입력을_바꾸지_않는다', () => {
    const before = JSON.stringify(COURSE);
    const one = delayedPosition(at(min('12:20')), 10, COURSE);
    expect(delayedPosition(at(min('12:20')), 10, COURSE)).toEqual(one);
    expect(JSON.stringify(COURSE)).toBe(before);
  });
});

// ---------- 속성 ----------

const legs = fc.array(
  fc.record({
    stay: fc.integer({ min: 1, max: 90 }),
    gap: fc.integer({ min: 0, max: 30 }), // 이동 분보다 빈 시간이 길 수 있다 (기다림)
    travel: fc.integer({ min: 1, max: 40 }),
    lat: fc.double({ min: 30, max: 40, noNaN: true }),
    lng: fc.double({ min: 130, max: 140, noNaN: true }),
  }),
  { minLength: 1, maxLength: 5 },
);

function build(parts: { stay: number; gap: number; travel: number; lat: number; lng: number }[], home: number | null = 30): Course {
  let now = 8 * 60; // 가장 긴 코스 + 숙소 60분 + 지연 60분도 23:59 안
  const items = parts.map(({ stay, gap, travel, lat, lng }) => {
    const start = now + travel + gap;
    now = start + stay;
    return { lat, lng, start: clock(start), end: clock(now), travel_min: travel };
  });
  return { lodging: HOME, items, go_home_min: home };
}

/** t에 "머무는" 장소 = 시작이 t 이하인 마지막 장소 (§14: 일정 안 → 그 장소, 이동 중 → 앞 장소). 없으면 숙소 */
function stayingAt(course: Course, t: number): Spot {
  const started = course.items.filter((item) => min(item.start) <= t);
  return started.length ? started[started.length - 1] : course.lodging;
}

const delay = fc.integer({ min: 1, max: 60 });
const goHome = fc.option(fc.integer({ min: 0, max: 60 }), { nil: null });

describe('§14 속성', () => {
  test('T7_S14_속성_지연이_있으면_결과는_코스_장소_좌표_하나이고_첫_일정_전에만_숙소', () => {
    fc.assert(
      fc.property(legs, goHome, delay, fc.double({ min: 0, max: 1, noNaN: true }), (parts, home, late, pick) => {
        const course = build(parts, home);
        const end = min(course.items[course.items.length - 1].end);
        // 기준 시각 t: 07:00 ~ 숙소로 가는 중의 끝. 숙소 도착 뒤·숙소까지 0분의 끝 정각은 §14에 없어 뺀다 (질문)
        const last = home === null ? end + 60 : home > 0 ? end + home - 1 : end - 1;
        const t = 7 * 60 + Math.floor(pick * (last - 7 * 60));
        const position = delayedPosition(at(t + late), late, course) as Spot;
        expectAt(position, stayingAt(course, t));
        const onPlace = course.items.some((item) => item.lat === position.lat && item.lng === position.lng);
        if (t < min(course.items[0].start)) expectAt(position, HOME);
        else expect(onPlace).toBe(true);
      }),
    );
  });

  test('T7_S14_속성_이동_구간_어디서든_막_떠난_앞_장소', () => {
    fc.assert(
      fc.property(legs.filter((parts) => parts.length >= 2), delay, fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), fc.nat(), (parts, late, pick, which) => {
        const course = build(parts);
        const index = which % (course.items.length - 1);
        const [from, to] = [course.items[index], course.items[index + 1]];
        const t = min(from.end) + Math.floor(pick * (min(to.start) - min(from.end)));
        expectAt(delayedPosition(at(t + late), late, course), from);
      }),
    );
  });

  test('T7_S14_속성_결과는_지금_빼기_지연에만_달려_있다', () => {
    fc.assert(
      fc.property(legs, delay, delay, fc.integer({ min: 9 * 60, max: 18 * 60 }), (parts, one, two, t) => {
        const course = build(parts);
        expect(delayedPosition(at(t + one), one, course)).toEqual(delayedPosition(at(t + two), two, course));
      }),
    );
  });

  test('T7_S14_속성_지연_0이면_어느_시각이든_fakePosition과_같다', () => {
    fc.assert(
      fc.property(legs, goHome, fc.integer({ min: 0, max: 23 * 60 + 59 }), (parts, home, t) => {
        const course = build(parts, home);
        expect(delayedPosition(at(t), 0, course)).toEqual(fakePosition(at(t), course));
      }),
    );
  });
});
