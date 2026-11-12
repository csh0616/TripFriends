/// <reference types="jest" />
// TASK-014 A3·A4 위치 규칙 (순수 함수). 근거: TASK-014 §A A3("가설: 50m 넘게 움직였거나 1분이 지났을 때 -> check 본문으로")·
// A4("정확도가 100m보다 나쁘면(가설) 그 위치는 쓰지 않고 시계만")·§6 "위치가 부정확·오래됨 -> 그 값은 버리고 시계만".
//
// 계약 (이 테스트가 정한 이름, 승인 대기): src/lib/live-location.ts
//   distanceM(a, b) 두 점 사이 거리(m) · isAccurate(reading) · shouldSend(lastSent | null, reading)
//   reading = {lat, lng, accuracy(m) | null, timestamp(ms)}, lastSent = {lat, lng, timestamp(ms)}
// 가설 값은 상수를 불러오지 않고 문서 숫자(50·60000·100)를 그대로 쓴다: 상수를 바꾸면 테스트가 잡게.
// 거리 경계: 계산식(구면 하버사인·반지름 6371km 등)은 문서에 없다 -> 정각 50m는 식에 따라 ±0.3m 흔들려서 49.5m / 50.5m로 양쪽을 본다 (질문 목록).
// 시간 경계: "1분이 지났을 때" = 마지막으로 보낸 뒤 60000ms 이상으로 읽었다 (59999 = 안 보냄, 60000 = 보냄. 질문 목록).
// 정확도 경계: "100m보다 나쁘면" = 100 초과면 버림 (100 = 씀, 100.01 = 버림).
import fc from 'fast-check';

import { distanceM, isAccurate, shouldSend, type Reading, type SentSpot } from '@/lib/live-location';

const OSAKA = { lat: 34.6687, lng: 135.5013 };
const METERS_PER_DEG_LAT = (6371000 * Math.PI) / 180; // 약 111195m

/** 북쪽으로 m미터 */
const north = (from: { lat: number; lng: number }, m: number) => ({ lat: from.lat + m / METERS_PER_DEG_LAT, lng: from.lng });
/** 동쪽으로 m미터 */
const east = (from: { lat: number; lng: number }, m: number) => ({
  lat: from.lat,
  lng: from.lng + m / (METERS_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180)),
});

const T0 = Date.parse('2026-12-02T03:00:00Z');
const sent = (over: Partial<SentSpot> = {}): SentSpot => ({ ...OSAKA, timestamp: T0, ...over });
const reading = (over: Partial<Reading> = {}): Reading => ({ ...OSAKA, accuracy: 10, timestamp: T0, ...over });

describe('distanceM', () => {
  test('T14_A3_같은_점은_0m', () => {
    expect(distanceM(OSAKA, OSAKA)).toBeCloseTo(0, 6);
  });

  test.each([10, 50, 100, 1000])('T14_A3_북쪽으로_%dm는_그만큼(±0.5%%)', (m) => {
    expect(Math.abs(distanceM(OSAKA, north(OSAKA, m)) - m)).toBeLessThanOrEqual(m * 0.005);
  });

  test.each([10, 50, 100])('T14_A3_동쪽으로_%dm는_그만큼(±0.5%%)', (m) => {
    expect(Math.abs(distanceM(OSAKA, east(OSAKA, m)) - m)).toBeLessThanOrEqual(m * 0.005);
  });

  test('T14_A3_속성_거리는_대칭이고_0_이상', () => {
    const spot = fc.record({ lat: fc.double({ min: 30, max: 40, noNaN: true }), lng: fc.double({ min: 130, max: 140, noNaN: true }) });
    fc.assert(
      fc.property(spot, spot, (a, b) => {
        const ab = distanceM(a, b);
        expect(ab).toBeGreaterThanOrEqual(0);
        expect(Math.abs(ab - distanceM(b, a))).toBeLessThan(1e-6);
      }),
    );
  });
});

describe('A4 isAccurate: 정확도가 100m보다 나쁘면 버린다', () => {
  test.each([
    [5, true],
    [99.99, true],
    [100, true],
    [100.01, false],
    [150, false],
    [5000, false],
  ])('T14_A4_정확도_%sm면_%s', (accuracy, expected) => {
    expect(isAccurate(reading({ accuracy }))).toBe(expected);
  });

  test('T14_A4_속성_100_초과는_모두_버린다', () => {
    fc.assert(fc.property(fc.double({ min: 100.000001, max: 1e6, noNaN: true }), (accuracy) => expect(isAccurate(reading({ accuracy }))).toBe(false)));
  });

  test('T14_A4_속성_0~100은_모두_쓴다', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (accuracy) => expect(isAccurate(reading({ accuracy }))).toBe(true)));
  });
});

describe('A3 shouldSend: 50m 넘게 움직였거나 1분이 지났으면 보낸다', () => {
  test('T14_A3_처음_읽은_좋은_위치는_보낸다', () => {
    expect(shouldSend(null, reading())).toBe(true);
  });

  test('T14_A4_처음이어도_부정확하면_안_보낸다', () => {
    expect(shouldSend(null, reading({ accuracy: 150 }))).toBe(false);
  });

  test.each([
    [0, false],
    [30, false],
    [49.5, false],
    [50.5, true],
    [80, true],
  ])('T14_A3_10초_뒤_%sm_움직이면_%s', (m, expected) => {
    expect(shouldSend(sent(), reading({ ...north(OSAKA, m), timestamp: T0 + 10_000 }))).toBe(expected);
  });

  test.each([
    [0, false],
    [59_999, false],
    [60_000, true],
    [60_001, true],
    [5 * 60_000, true],
  ])('T14_A3_제자리에서_%sms_지나면_%s', (ms, expected) => {
    expect(shouldSend(sent(), reading({ timestamp: T0 + ms }))).toBe(expected);
  });

  test('T14_A4_1분이_지나도_부정확하면_안_보낸다', () => {
    expect(shouldSend(sent(), reading({ timestamp: T0 + 120_000, accuracy: 100.01 }))).toBe(false);
  });

  test('T14_A4_50m_넘게_움직여도_부정확하면_안_보낸다', () => {
    expect(shouldSend(sent(), reading({ ...north(OSAKA, 500), timestamp: T0 + 10_000, accuracy: 300 }))).toBe(false);
  });

  test('T14_A3_속성_정확하고_50.5m_넘게_움직이면_시간과_상관없이_보낸다', () => {
    fc.assert(
      fc.property(fc.double({ min: 50.5, max: 5000, noNaN: true }), fc.integer({ min: 0, max: 59_999 }), fc.double({ min: 0, max: 100, noNaN: true }), (m, ms, accuracy) =>
        expect(shouldSend(sent(), reading({ ...north(OSAKA, m), timestamp: T0 + ms, accuracy }))).toBe(true),
      ),
    );
  });

  test('T14_A3_속성_49.5m_안이고_1분_전이면_보내지_않는다', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 49.5, noNaN: true }), fc.integer({ min: 0, max: 59_999 }), (m, ms) =>
        expect(shouldSend(sent(), reading({ ...east(OSAKA, m), timestamp: T0 + ms }))).toBe(false),
      ),
    );
  });

  test('T14_A3_속성_정확하면_1분_뒤에는_제자리여도_보낸다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 60_000, max: 3_600_000 }), fc.double({ min: 0, max: 49.5, noNaN: true }), (ms, m) =>
        expect(shouldSend(sent(), reading({ ...north(OSAKA, m), timestamp: T0 + ms }))).toBe(true),
      ),
    );
  });
});
