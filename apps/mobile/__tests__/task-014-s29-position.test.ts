/// <reference types="jest" />
// TASK-014 §29 ③ 장소 사이 가짜 위치(출발 시각까지 제자리) · ④ 숙소 없음(day.lodging null)의 가짜 위치·연습 카메라. 순수 함수만 본다.
// 근거: TASK-014 §29 표 ③("출발 시각(다음 시작 − 이동 시간)까지 제자리, 그 뒤 이동 시간 동안 이동 — 서버의 'N분 뒤 출발'과 맞춤. TASK-006 R6 기존 테스트 변경 승인")
//       ④("앱 fallback: 첫 일정 전 = 1번 장소, 마지막 뒤 = 마지막 장소"), §28 ③(15:10 "11분 뒤 출발"인데 점은 이미 떠남), API-001 §2-3 (11-15) NowView.day.lodging null,
//       §22 Q2(첫 구간 출발점 = 숙소 · 마지막 구간 도착점 = 숙소 → 숙소가 없으면 1번·마지막 장소, §29 ④), §25 Q2(머무는 곳·한 점은 띠 가운데).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   '@/lib/fake-position'
//     FakeCourse.lodging: {lat,lng} | null  (null = 숙소 없는 여행, 응답 day.lodging 그대로 넘긴다)
//     fakePosition(at, course)
//       - 장소 i 끝 ~ (다음 시작 − 다음 travel_min) = 장소 i 제자리 (출발 시각 정각도 제자리, 비율 0)
//       - 출발 시각 ~ 다음 시작 = travel_min을 분모로 직선 보간. 다음 시작 정각 = 다음 장소
//       - lodging null: 첫 일정 시작 전(출발 전·이동 중 모두) = 1번 장소, 마지막 끝 뒤 = 마지막 장소 (go_home_min과 상관없이)
//     delayedPosition(at, delayMin, course): lodging null이면 "첫 일정 전 = 숙소" 자리가 1번 장소. 지연 0은 fakePosition 그대로
//   '@/now/rehearsal-camera'
//     rehearsalCamera(pins, position, lodging: {lat,lng} | null, box, previous?) — lodging null이면 첫 구간 출발 = 1번 장소, 마지막 구간 도착 = 마지막 장소
//   빈 시간이 이동 시간보다 짧은 경우(출발 시각이 앞 장소 끝보다 앞)는 문서에 없어 정하지 않는다 (질문). 생성기는 빈 시간 ≥ 이동 시간만 만든다
import fc from 'fast-check';

type Spot = { lat: number; lng: number };
type Item = Spot & { start: string; end: string; travel_min: number };
type Course = { lodging: Spot | null; items: Item[]; go_home_min: number | null };
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Box = { width: number; height: number; top: number; bottom: number };
type Result = { key: string; region: Region };

const lib = () => require('@/lib/fake-position');
const fakePosition = (at: string, course: Course): Spot | null => lib().fakePosition(at, course);
const delayedPosition = (at: string, delay: number, course: Course): Spot | null => lib().delayedPosition(at, delay, course);
const camera = (pins: unknown[], position: Spot | null, lodging: Spot | null, box: Box, previous?: Result): Result =>
  require('@/now/rehearsal-camera').rehearsalCamera(pins, position, lodging, box, previous);

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const at = (minutes: number) => `2026-12-02T${clock(minutes)}:00`;
const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const HOME = { lat: 35, lng: 135 };
const A = { lat: 35.1, lng: 135.2 };
const B = { lat: 35.3, lng: 135.6 };
const C = { lat: 35.5, lng: 135.1 };

// 1번 A 10:12~12:00 · 2번 B 13:00~14:00(이동 20 → 출발 12:40) · 3번 C 15:00~19:00(이동 30 → 출발 14:30), 숙소까지 25분
const WAITING = (lodging: Spot | null = HOME): Course => ({
  lodging,
  go_home_min: 25,
  items: [
    { ...A, start: '10:12', end: '12:00', travel_min: 12 },
    { ...B, start: '13:00', end: '14:00', travel_min: 20 },
    { ...C, start: '15:00', end: '19:00', travel_min: 30 },
  ],
});

const between = (from: Spot, to: Spot, ratio: number): Spot => ({ lat: from.lat + (to.lat - from.lat) * ratio, lng: from.lng + (to.lng - from.lng) * ratio });

const expectAt = (actual: Spot | null, expected: Spot) => {
  expect(actual).not.toBeNull();
  expect((actual as Spot).lat).toBeCloseTo(expected.lat, 9);
  expect((actual as Spot).lng).toBeCloseTo(expected.lng, 9);
};

// =====================================================================
// ③ 출발 시각(다음 시작 − 이동 시간)까지 제자리, 그 뒤 이동 시간 동안 이동
// =====================================================================

describe('§29 ③ 장소 사이: 출발 시각까지 제자리', () => {
  test.each([
    ['앞 장소 끝 정각', '12:00', A],
    ['끝 1분 뒤', '12:01', A],
    ['기다리는 중', '12:30', A],
    ['출발 1분 전', '12:39', A],
    ['출발 정각(비율 0)', '12:40', A],
  ])('T14_S29_3_출발_전이면_앞_장소_제자리_%s', (_name, time, spot) => {
    expectAt(fakePosition(at(min(time)), WAITING()), spot);
  });

  test.each([
    ['출발 1분 뒤', '12:41', 1 / 20],
    ['이동 시간 절반', '12:50', 1 / 2],
    ['다음 시작 1분 전', '12:59', 19 / 20],
  ])('T14_S29_3_출발_뒤는_이동_시간을_분모로_보간_%s', (_name, time, ratio) => {
    expectAt(fakePosition(at(min(time)), WAITING()), between(A, B, ratio));
  });

  test('T14_S29_3_다음_시작_정각은_다음_장소', () => {
    expectAt(fakePosition(at(min('13:00')), WAITING()), B);
  });

  test('T14_S29_3_두_번째_구간도_같다_출발_14시30분까지_B_그_뒤_30분_동안_C로', () => {
    expectAt(fakePosition(at(min('14:29')), WAITING()), B);
    expectAt(fakePosition(at(min('14:30')), WAITING()), B);
    expectAt(fakePosition(at(min('14:45')), WAITING()), between(B, C, 1 / 2));
    expectAt(fakePosition(at(min('15:00')), WAITING()), C);
  });

  test('T14_S29_3_S28_N분_뒤_출발이면_점은_아직_앞_장소에_있다', () => {
    // §28 ③: "11분 뒤 출발" = 출발 시각 12:40의 11분 전(12:29). 점은 아직 떠나지 않았다
    expectAt(fakePosition(at(min('12:40') - 11), WAITING()), A);
  });

  test('T14_S29_3_경계_빈_시간이_이동_시간과_같으면_끝나자마자_출발_예전과_같다', () => {
    const tight: Course = { lodging: HOME, go_home_min: 25, items: [{ ...A, start: '10:12', end: '12:00', travel_min: 12 }, { ...B, start: '12:20', end: '14:00', travel_min: 20 }] };
    expectAt(fakePosition(at(min('12:00')), tight), A);
    expectAt(fakePosition(at(min('12:10')), tight), between(A, B, 1 / 2));
  });
});

const legs = fc.array(
  fc.record({
    stay: fc.integer({ min: 1, max: 90 }),
    wait: fc.integer({ min: 0, max: 60 }), // 빈 시간 = 이동 + 기다림 (기다림 ≥ 0)
    travel: fc.integer({ min: 1, max: 40 }),
    lat: fc.double({ min: 30, max: 40, noNaN: true }),
    lng: fc.double({ min: 130, max: 140, noNaN: true }),
  }),
  { minLength: 1, maxLength: 5 },
);

function build(parts: { stay: number; wait: number; travel: number; lat: number; lng: number }[], lodging: Spot | null = HOME, home: number | null = 30): Course {
  let now = 8 * 60;
  const items = parts.map(({ stay, wait, travel, lat, lng }) => {
    const start = now + wait + travel;
    now = start + stay;
    return { lat, lng, start: clock(start), end: clock(now), travel_min: travel };
  });
  return { lodging, items, go_home_min: home };
}

const fraction = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });

describe('§29 ③ 속성', () => {
  test('T14_S29_3_속성_앞_장소_끝부터_출발_시각까지는_앞_장소', () => {
    fc.assert(
      fc.property(legs.filter((p) => p.length >= 2), fc.nat(), fraction, (parts, which, pick) => {
        const course = build(parts);
        const index = which % (course.items.length - 1);
        const [from, to] = [course.items[index], course.items[index + 1]];
        const leave = min(to.start) - to.travel_min;
        const moment = min(from.end) + Math.floor(pick * (leave - min(from.end) + 1)); // [끝, 출발] 양끝 포함
        expectAt(fakePosition(at(moment), course), from);
      }),
    );
  });

  test('T14_S29_3_속성_출발_뒤는_이동_시간_비율대로', () => {
    fc.assert(
      fc.property(legs.filter((p) => p.length >= 2), fc.nat(), fraction, (parts, which, pick) => {
        const course = build(parts);
        const index = which % (course.items.length - 1);
        const [from, to] = [course.items[index], course.items[index + 1]];
        const passed = Math.floor(pick * to.travel_min);
        const moment = min(to.start) - to.travel_min + passed;
        expectAt(fakePosition(at(moment), course), between(from, to, passed / to.travel_min));
      }),
    );
  });
});

// =====================================================================
// ④ 숙소 없음: 첫 일정 전 = 1번 장소, 마지막 뒤 = 마지막 장소
// =====================================================================

describe('§29 ④ fakePosition 숙소 없음', () => {
  test.each(['00:00', '09:00', '09:59', '10:00', '10:06', '10:11'])('T14_S29_4_숙소_없으면_첫_일정_전_%s는_1번_장소', (time) => {
    // 10:00 = 1번 출발 시각(10:12 − 12), 10:06·10:11 = 숙소가 있었다면 길 위
    expectAt(fakePosition(at(min(time)), WAITING(null)), A);
  });

  test('T14_S29_4_숙소_없어도_1번_시작_정각부터는_일정대로', () => {
    expectAt(fakePosition(at(min('10:12')), WAITING(null)), A);
    expectAt(fakePosition(at(min('12:50')), WAITING(null)), between(A, B, 1 / 2));
  });

  test.each(['19:00', '19:01', '19:10', '19:25', '23:59'])('T14_S29_4_숙소_없으면_마지막_뒤_%s는_마지막_장소', (time) => {
    expectAt(fakePosition(at(min(time)), WAITING(null)), C);
  });

  test('T14_S29_4_숙소_없고_go_home_min이_null이어도_마지막_장소', () => {
    expectAt(fakePosition(at(min('20:00')), { ...WAITING(null), go_home_min: null }), C);
  });

  test('T14_S29_4_경계_숙소가_있으면_지금처럼_첫_일정_전은_숙소·마지막_뒤는_숙소로', () => {
    expectAt(fakePosition(at(min('09:00')), WAITING()), HOME);
    expectAt(fakePosition(at(min('10:06')), WAITING()), between(HOME, A, 1 / 2));
    expectAt(fakePosition(at(min('19:10')), WAITING()), between(C, HOME, 10 / 25));
    expectAt(fakePosition(at(min('19:25')), WAITING()), HOME);
  });

  test('T14_S29_4_속성_숙소_없으면_결과는_늘_코스_장소이거나_두_장소_사이이고_null이_아니다', () => {
    fc.assert(
      fc.property(legs, fc.integer({ min: 0, max: 23 * 60 + 59 }), (parts, moment) => {
        const course = build(parts, null);
        const spot = fakePosition(at(moment), course) as Spot;
        expect(spot).not.toBeNull();
        expect(Number.isFinite(spot.lat) && Number.isFinite(spot.lng)).toBe(true);
        const first = course.items[0];
        const last = course.items[course.items.length - 1];
        if (moment < min(first.start)) expectAt(spot, first);
        if (moment >= min(last.end)) expectAt(spot, last);
      }),
    );
  });
});

describe('§29 ④ delayedPosition 숙소 없음', () => {
  test.each([
    ['지연 10, 기준 09:50', '10:00', 10],
    ['지연 30, 기준 10:05', '10:35', 30],
    ['지연 60, 기준 09:00', '10:00', 60],
  ])('T14_S29_4_숙소_없으면_지연_중_첫_일정_전은_1번_장소_%s', (_name, time, delay) => {
    expectAt(delayedPosition(at(min(time)), delay, WAITING(null)), A);
  });

  test('T14_S29_4_숙소_없어도_지연_중_이동은_앞_장소_마지막_뒤는_마지막_장소', () => {
    expectAt(delayedPosition(at(min('12:50') + 10), 10, WAITING(null)), A);
    expectAt(delayedPosition(at(min('19:30') + 10), 10, WAITING(null)), C);
  });

  test.each(['09:00', '10:06', '19:10', '23:00'])('T14_S29_4_숙소_없어도_지연_0이면_fakePosition_그대로_%s', (time) => {
    expect(delayedPosition(at(min(time)), 0, WAITING(null))).toEqual(fakePosition(at(min(time)), WAITING(null)));
  });

  test('T14_S29_4_경계_숙소가_있으면_지연_중_첫_일정_전은_숙소_그대로', () => {
    expectAt(delayedPosition(at(min('10:00')), 10, WAITING()), HOME);
  });
});

// =====================================================================
// ④ 연습 카메라: 숙소가 없으면 첫 구간 출발 = 1번 · 마지막 구간 도착 = 마지막 장소
// =====================================================================

const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function project(region: Region, box: Box, spot: Spot) {
  const x = box.width / 2 + ((spot.lng - region.longitude) / region.longitudeDelta) * box.width;
  const north = merc(region.latitude + region.latitudeDelta / 2);
  const south = merc(region.latitude - region.latitudeDelta / 2);
  return { x, y: ((north - merc(spot.lat)) / (north - south)) * box.height };
}
const spanEW = (region: Region) => region.longitudeDelta * METERS_PER_DEGREE * Math.cos((region.latitude * Math.PI) / 180);
const BOX: Box = { width: 390, height: 763, top: 175, bottom: 295 };
const P1 = { lat: 34.6687, lng: 135.5013 };
const P2 = { lat: 34.6725, lng: 135.5051 };
const P3 = { lat: 34.6651, lng: 135.4979 };
const pin = (seq: number, spot: Spot, state: 'done' | 'now' | 'next' | 'later') => ({
  seq,
  place_id: `P${seq}`,
  name: `장소${seq}`,
  ...spot,
  start: '10:00',
  end: '11:00',
  travel_min: 10,
  state,
});

/** 한 점만 맞출 때: 그 점이 띠 가운데(§25 Q2, ±1pt), 동서 폭은 800m 하한(§26 작은 것, ±5%) */
function centeredOn(result: Result, spot: Spot) {
  const { region } = result;
  for (const value of Object.values(region)) expect(Number.isFinite(value)).toBe(true);
  const { x, y } = project(region, BOX, spot);
  expect(Math.abs(x - BOX.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(y - (BOX.top + BOX.bottom) / 2)).toBeLessThanOrEqual(1);
  expect(spanEW(region)).toBeGreaterThanOrEqual(800 * 0.95);
  expect(spanEW(region)).toBeLessThanOrEqual(800 * 1.05);
}

describe('§29 ④ rehearsalCamera 숙소 없음', () => {
  const FIRST_LEG = [pin(1, P1, 'next'), pin(2, P2, 'later'), pin(3, P3, 'later')];
  const LAST_LEG = [pin(1, P1, 'done'), pin(2, P2, 'done'), pin(3, P3, 'done')];

  test('T14_S29_4_숙소_없으면_첫_구간은_1번_장소_하나만_맞춘다_지금_자리_모름', () => {
    centeredOn(camera(FIRST_LEG, null, null, BOX), P1);
  });

  test('T14_S29_4_숙소_없으면_첫_구간_지금_자리가_1번이면_1번_가운데', () => {
    centeredOn(camera(FIRST_LEG, P1, null, BOX), P1);
  });

  test('T14_S29_4_숙소_없으면_마지막_구간은_마지막_장소_하나만_맞춘다', () => {
    centeredOn(camera(LAST_LEG, null, null, BOX), P3);
    centeredOn(camera(LAST_LEG, P3, null, BOX), P3);
  });

  test('T14_S29_4_숙소_없어도_머무는_중과_가운데_구간은_숙소와_상관없이_같다', () => {
    const stay = [pin(1, P1, 'done'), pin(2, P2, 'now'), pin(3, P3, 'later')];
    const move = [pin(1, P1, 'done'), pin(2, P2, 'next'), pin(3, P3, 'later')];
    expect(camera(stay, P2, null, BOX)).toEqual(camera(stay, P2, HOME, BOX));
    const middle = { lat: (P1.lat + P2.lat) / 2, lng: (P1.lng + P2.lng) / 2 };
    expect(camera(move, middle, null, BOX)).toEqual(camera(move, middle, HOME, BOX));
  });

  test('T14_S29_4_경계_숙소가_있으면_첫_구간에_숙소가_들어간다_지금_그대로', () => {
    // 숙소(35, 135)는 P1에서 수십 km: 숙소가 들어가면 폭이 3km로 묶이고 1번이 띠 가운데(§25 Q5 지금 자리 모름 -> 도착할 곳)
    const result = camera(FIRST_LEG, null, HOME, BOX);
    expect(spanEW(result.region)).toBeGreaterThan(800 * 1.05);
  });
});
