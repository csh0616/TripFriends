/// <reference types="jest" />
// TASK-014 §30 Q7: 장소 사이 빈 시간이 이동 시간보다 짧으면 앞 장소가 끝나자마자 출발하고, 빈 시간 동안 이동한다 (분모 = 빈 시간). 순수 함수만 본다.
// 근거: TASK-014 §30 표 Q7("빈 시간 < 이동 시간: 앞 장소가 끝나자마자 출발, 빈 시간 동안 이동") · §29 표 ③(출발 시각 = 다음 시작 − 이동 시간까지 제자리, 그 뒤 이동 시간 동안 이동).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   '@/lib/fake-position' fakePosition(at, course)
//     장소 i 끝 E, 다음 시작 S, 다음 travel_min T, 빈 시간 G = S − E
//       G < T  -> 출발 = E. E ~ S 동안 G를 분모로 직선 보간 (E 정각 = 앞 장소 · 비율 0, S 정각 = 다음 장소)
//       G = T  -> §29와 같다 (출발 = E = S − T)
//       G = 0  -> E(= S) 정각부터 다음 장소
//     첫 장소(숙소 -> 1번)는 앞 장소가 없어 이 규칙과 상관없다 (§29 그대로)
//   delayedPosition은 지연 0이면 fakePosition 그대로라 같은 규칙을 따른다
import fc from 'fast-check';

type Spot = { lat: number; lng: number };
type Item = Spot & { start: string; end: string; travel_min: number };
type Course = { lodging: Spot | null; items: Item[]; go_home_min: number | null };

const lib = () => require('@/lib/fake-position');
const fakePosition = (at: string, course: Course): Spot | null => lib().fakePosition(at, course);
const delayedPosition = (at: string, delay: number, course: Course): Spot | null => lib().delayedPosition(at, delay, course);

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const at = (minutes: number) => `2026-12-02T${clock(minutes)}:00`;
const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const HOME = { lat: 35, lng: 135 };
const A = { lat: 35.1, lng: 135.2 };
const B = { lat: 35.3, lng: 135.6 };
const C = { lat: 35.5, lng: 135.1 };

const between = (from: Spot, to: Spot, ratio: number): Spot => ({ lat: from.lat + (to.lat - from.lat) * ratio, lng: from.lng + (to.lng - from.lng) * ratio });
const expectAt = (actual: Spot | null, expected: Spot) => {
  expect(actual).not.toBeNull();
  expect((actual as Spot).lat).toBeCloseTo(expected.lat, 9);
  expect((actual as Spot).lng).toBeCloseTo(expected.lng, 9);
};

// 1번 A 10:12~12:00 · 2번 B 12:10~14:00(이동 20, 빈 시간 10) · 3번 C 14:30~19:00(이동 30, 빈 시간 30 = 같음)
const SHORT = (lodging: Spot | null = HOME): Course => ({
  lodging,
  go_home_min: 25,
  items: [
    { ...A, start: '10:12', end: '12:00', travel_min: 12 },
    { ...B, start: '12:10', end: '14:00', travel_min: 20 },
    { ...C, start: '14:30', end: '19:00', travel_min: 30 },
  ],
});

describe('§30 Q7 빈 시간 < 이동 시간: 끝나자마자 출발, 빈 시간 동안 이동', () => {
  test.each([
    ['끝 1분 전(아직 일정 안)', '11:59', A],
    ['앞 장소 끝 정각(비율 0)', '12:00', A],
  ])('T14_S30_Q7_%s는_앞_장소', (_name, time, spot) => {
    expectAt(fakePosition(at(min(time)), SHORT()), spot);
  });

  test.each([
    ['끝 1분 뒤', '12:01', 1 / 10],
    ['빈 시간 절반', '12:05', 1 / 2],
    ['다음 시작 1분 전', '12:09', 9 / 10],
  ])('T14_S30_Q7_%s는_빈_시간을_분모로_보간', (_name, time, ratio) => {
    expectAt(fakePosition(at(min(time)), SHORT()), between(A, B, ratio));
  });

  test('T14_S30_Q7_다음_시작_정각은_다음_장소', () => {
    expectAt(fakePosition(at(min('12:10')), SHORT()), B);
  });

  test('T14_S30_Q7_출발_시각이_앞_장소_끝보다_앞이어도_그_사이_자리를_쓰지_않는다', () => {
    // 다음 시작 − 이동 = 11:50 (1번 일정 안). 11:50~11:59는 이동이 아니라 1번 그대로
    for (const time of ['11:50', '11:55', '11:59']) expectAt(fakePosition(at(min(time)), SHORT()), A);
  });

  test('T14_S30_Q7_경계_빈_시간이_이동_시간과_같은_구간은_§29와_같다', () => {
    expectAt(fakePosition(at(min('14:00')), SHORT()), B);
    expectAt(fakePosition(at(min('14:15')), SHORT()), between(B, C, 1 / 2));
    expectAt(fakePosition(at(min('14:30')), SHORT()), C);
  });

  test('T14_S30_Q7_경계_빈_시간이_이동_시간보다_1분_짧으면_끝나자마자_출발', () => {
    const tight: Course = { lodging: HOME, go_home_min: 25, items: [{ ...A, start: '10:12', end: '12:00', travel_min: 12 }, { ...B, start: '12:19', end: '14:00', travel_min: 20 }] };
    expectAt(fakePosition(at(min('12:00')), tight), A);
    expectAt(fakePosition(at(min('12:01')), tight), between(A, B, 1 / 19));
    expectAt(fakePosition(at(min('12:19')), tight), B);
  });

  test('T14_S30_Q7_경계_빈_시간_0이면_끝_정각부터_다음_장소', () => {
    const none: Course = { lodging: HOME, go_home_min: 25, items: [{ ...A, start: '10:12', end: '12:00', travel_min: 12 }, { ...B, start: '12:00', end: '14:00', travel_min: 15 }] };
    expectAt(fakePosition(at(min('11:59')), none), A);
    expectAt(fakePosition(at(min('12:00')), none), B);
  });

  test('T14_S30_Q7_숙소_없는_여행도_같다', () => {
    expectAt(fakePosition(at(min('12:00')), SHORT(null)), A);
    expectAt(fakePosition(at(min('12:05')), SHORT(null)), between(A, B, 1 / 2));
    expectAt(fakePosition(at(min('12:10')), SHORT(null)), B);
  });

  test.each(['12:00', '12:05', '12:09'])('T14_S30_Q7_지연_0이면_delayedPosition도_같은_자리_%s', (time) => {
    expect(delayedPosition(at(min(time)), 0, SHORT())).toEqual(fakePosition(at(min(time)), SHORT()));
  });
});

const shortLegs = fc.array(
  fc.record({
    stay: fc.integer({ min: 1, max: 90 }),
    travel: fc.integer({ min: 2, max: 40 }),
    short: fc.integer({ min: 1, max: 39 }), // 빈 시간 = 이동 − short (≥ 1, < 이동)
    lat: fc.double({ min: 30, max: 40, noNaN: true }),
    lng: fc.double({ min: 130, max: 140, noNaN: true }),
  }),
  { minLength: 2, maxLength: 5 },
);

function build(parts: { stay: number; travel: number; short: number; lat: number; lng: number }[], lodging: Spot | null): Course {
  let now = 8 * 60;
  const items = parts.map(({ stay, travel, short, lat, lng }, index) => {
    const gap = index === 0 ? travel : Math.max(1, travel - Math.min(short, travel - 1));
    const start = now + gap;
    now = start + stay;
    return { lat, lng, start: clock(start), end: clock(now), travel_min: travel };
  });
  return { lodging, items, go_home_min: 30 };
}

describe('§30 Q7 속성', () => {
  test('T14_S30_Q7_속성_빈_시간이_이동_시간보다_짧으면_끝부터_다음_시작까지_빈_시간_비율대로', () => {
    fc.assert(
      fc.property(shortLegs, fc.nat(), fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), fc.boolean(), (parts, which, pick, home) => {
        const course = build(parts, home ? HOME : null);
        const index = which % (course.items.length - 1);
        const [from, to] = [course.items[index], course.items[index + 1]];
        const gap = min(to.start) - min(from.end);
        expect(gap).toBeLessThan(to.travel_min);
        const passed = Math.floor(pick * gap); // [0, gap)
        expectAt(fakePosition(at(min(from.end) + passed), course), between(from, to, passed / gap));
        expectAt(fakePosition(at(min(to.start)), course), to);
      }),
    );
  });

  test('T14_S30_Q7_속성_점은_늘_앞뒤_두_장소를_잇는_선_위이고_앞_장소를_넘지_않는다', () => {
    fc.assert(
      fc.property(shortLegs, fc.nat(), fc.nat(), (parts, which, offset) => {
        const course = build(parts, HOME);
        const index = which % (course.items.length - 1);
        const [from, to] = [course.items[index], course.items[index + 1]];
        const gap = min(to.start) - min(from.end);
        const moment = min(from.end) + (offset % (gap + 1));
        const spot = fakePosition(at(moment), course) as Spot;
        const ratio = Math.abs(to.lat - from.lat) > 1e-9 ? (spot.lat - from.lat) / (to.lat - from.lat) : (spot.lng - from.lng) / (to.lng - from.lng || 1);
        expect(ratio).toBeGreaterThanOrEqual(-1e-9);
        expect(ratio).toBeLessThanOrEqual(1 + 1e-9);
      }),
    );
  });
});
