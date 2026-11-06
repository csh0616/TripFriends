/// <reference types="jest" />
// fakePosition 순수 함수. 근거: TASK-006 B7, §8 AC-5 (일정 안 = 그 장소, 이동 중 = 두 점 사이, 시각 단조).
// 위치 입력의 코스 모양은 질문 Q15 (NowView에는 일정 시각이 없다). 여기서는 필요한 값만 넣는다.
import fc from 'fast-check';

type Spot = { lat: number; lng: number };
type Item = Spot & { start: string; end: string; travel_min: number };
type Course = { lodging: Spot; items: Item[] };

// 아직 없는 파일이라 테스트마다 불러온다
const fakePosition = (at: string, course: Course): Spot | null => require('@/lib/fake-position').fakePosition(at, course);

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const at = (minutes: number) => `2026-12-02T${clock(minutes)}:00`;
const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const HOME = { lat: 35, lng: 135 };
const A = { lat: 35.1, lng: 135.2 };
const B = { lat: 35.3, lng: 135.6 };
const C = { lat: 35.5, lng: 135.1 };
const COURSE: Course = {
  lodging: HOME,
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

describe('AC-5 예시', () => {
  test.each([
    ['1번 시작 정각', '10:12', A],
    ['1번 안', '11:00', A],
    ['1번 끝 1분 전', '11:59', A],
    ['2번 시작 정각', '12:20', B],
    ['2번 끝 1분 전', '13:59', B],
    ['3번 안', '15:00', C],
    ['마지막 일정 끝 1분 전', '18:59', C],
  ])('T6_AC5_일정_안이면_그_장소_%s', (_name, time, spot) => {
    expectAt(fakePosition(at(min(time)), COURSE), spot);
  });

  test('T6_AC5_일정_끝_정각은_앞_장소에서_막_떠난_자리', () => {
    expectAt(fakePosition(at(min('12:00')), COURSE), A);
  });

  test('T6_AC5_이동_시간의_절반이면_두_점의_가운데', () => {
    expectAt(fakePosition(at(min('12:10')), COURSE), { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 });
  });

  test('T6_AC5_이동_시간의_4분의_1이면_4분의_1_지점', () => {
    expectAt(fakePosition(at(min('12:05')), COURSE), { lat: A.lat + (B.lat - A.lat) / 4, lng: A.lng + (B.lng - A.lng) / 4 });
  });

  test('T6_AC5_다음_일정_시작_1분_전은_아직_도착_전', () => {
    const position = fakePosition(at(min('12:19')), COURSE) as Spot;
    expect(position.lat).toBeLessThan(B.lat);
    expect(position.lat).toBeCloseTo(A.lat + ((B.lat - A.lat) * 19) / 20, 9);
  });

  test('T6_AC5_순수_함수_같은_입력은_같은_출력이고_입력을_바꾸지_않는다', () => {
    const before = JSON.stringify(COURSE);
    const one = fakePosition(at(min('12:10')), COURSE);
    expect(fakePosition(at(min('12:10')), COURSE)).toEqual(one);
    expect(JSON.stringify(COURSE)).toBe(before);
  });
});

// ---------- 속성 ----------

const legs = fc.array(
  fc.record({
    stay: fc.integer({ min: 1, max: 120 }),
    travel: fc.integer({ min: 1, max: 60 }),
    lat: fc.double({ min: 30, max: 40, noNaN: true }),
    lng: fc.double({ min: 130, max: 140, noNaN: true }),
  }),
  { minLength: 2, maxLength: 5 },
);

function build(parts: { stay: number; travel: number; lat: number; lng: number }[]): Course {
  let now = 10 * 60;
  const items = parts.map(({ stay, travel, lat, lng }) => {
    const start = now + travel;
    now = start + stay;
    return { lat, lng, start: clock(start), end: clock(now), travel_min: travel };
  });
  return { lodging: HOME, items };
}

const fraction = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });

describe('AC-5 속성', () => {
  test('T6_AC5_속성_일정_안이면_어느_시각이든_그_장소', () => {
    fc.assert(
      fc.property(legs, fraction, fraction, (parts, pickItem, pickTime) => {
        const course = build(parts);
        const item = course.items[Math.floor(pickItem * course.items.length)];
        const inside = min(item.start) + Math.floor(pickTime * (min(item.end) - min(item.start)));
        expectAt(fakePosition(at(inside), course), item);
      }),
    );
  });

  test('T6_AC5_속성_이동_중이면_앞뒤_장소를_잇는_선_위이고_시간_비율대로', () => {
    fc.assert(
      fc.property(legs, fraction, fraction, (parts, pickLeg, pickTime) => {
        const course = build(parts);
        const index = Math.floor(pickLeg * (course.items.length - 1));
        const [from, to] = [course.items[index], course.items[index + 1]];
        const [leave, arrive] = [min(from.end), min(to.start)];
        const moment = leave + Math.floor(pickTime * (arrive - leave));
        const ratio = (moment - leave) / (arrive - leave);
        expectAt(fakePosition(at(moment), course), {
          lat: from.lat + (to.lat - from.lat) * ratio,
          lng: from.lng + (to.lng - from.lng) * ratio,
        });
      }),
    );
  });

  test('T6_AC5_속성_시각_단조_북쪽으로만_가는_코스에서_시각이_늦으면_위도가_줄지_않는다', () => {
    const northward = fc.array(fc.record({ stay: fc.integer({ min: 1, max: 60 }), travel: fc.integer({ min: 1, max: 60 }) }), {
      minLength: 2,
      maxLength: 5,
    });
    fc.assert(
      fc.property(northward, fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 0, max: 100000 }), (parts, x, y) => {
        const course = build(parts.map((part, i) => ({ ...part, lat: 35 + i * 0.1, lng: 135 })));
        const begin = min(course.items[0].start);
        const span = min(course.items[course.items.length - 1].end) - begin;
        const [early, late] = [x % span, y % span].sort((a, b) => a - b);
        const one = fakePosition(at(begin + early), course) as Spot;
        const two = fakePosition(at(begin + late), course) as Spot;
        expect(two.lat).toBeGreaterThanOrEqual(one.lat - 1e-9);
      }),
    );
  });
});

// ---------- 문서가 비어 있는 곳 ----------

describe('질문 Q15', () => {
  test.skip('Q15_첫_일정_전_위치_숙소에_있나_숙소에서_1번_사이인가', () => {
    expectAt(fakePosition(at(min('09:00')), COURSE), HOME);
  });

  test.skip('Q15_마지막_일정_뒤_위치_마지막_장소인가_숙소_쪽으로_가나', () => {
    expectAt(fakePosition(at(min('19:30')), COURSE), C);
  });

  test.skip('Q15_기다림이_있으면_비율의_분모는_이동_시간인가_전체_빈_시간인가', () => {
    const waiting: Course = {
      lodging: HOME,
      items: [
        { ...A, start: '10:12', end: '12:00', travel_min: 12 },
        { ...B, start: '13:00', end: '14:00', travel_min: 20 },
      ],
    };
    expectAt(fakePosition(at(min('12:30')), waiting), { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 });
  });

  test.skip('Q6_Q15_좌표_없는_고정_일정_안이면_null인가', () => {
    const course = { lodging: HOME, items: [{ lat: null, lng: null, start: '10:12', end: '12:00', travel_min: 0 }] } as unknown as Course;
    expect(fakePosition(at(min('11:00')), course)).toBeNull();
  });
});
