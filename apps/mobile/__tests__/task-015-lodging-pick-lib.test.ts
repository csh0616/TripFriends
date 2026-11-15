/// <reference types="jest" />
// TASK-015 §13 Q2·Q3 a2 거리 검사 · [여기로 정했어] 켜짐 판단 (앱, 순수 함수). 로직만 본다.
// 근거: TASK-015 §13 Q2("a2가 같은 규칙(도시 중심 50km)을 앱에서 먼저 검사해 바로 안내·비활성 ... 거리 계산은 lib 순수 함수(서버와 같은 공식, 경계 50km는 밖 = 400과 같게)") ·
//       §13 Q3("다시 검사해서 50km 안이면 [여기로 정했어] 켜짐. 핀을 옮길 때마다 같은 검사") · §9 Q5(pin이 city.center에서 50km 밖이면 400) ·
//       §12 Q6(핀 없음 -> [여기로 정했어] 비활성) · §9 Q6(city.center = 시드 v3 난바역 34.6662, 135.5010)
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   모듈 '@/lib/lodging-pick'
//     distanceMeters(a, b)       두 {lat, lng} 사이 거리 m. 서버와 같은 공식: 하버사인, 지구 반지름 6371km (apps/server/trip/detect.py _distance_m)
//     isTooFar(pin, center)      거리 >= 50km 이면 true. **정확히 50km는 밖** (서버 400 too_far와 같게)
//                                부동소수점: 정확히 50km로 만든 점은 49999.9999999998m처럼 나온다 -> 서버 detect._within처럼 소수 6자리(마이크로미터)로 반올림해 비교해야 경계가 지켜진다
//     canConfirmPin(pin, center) 핀이 있고(null 아님) && isTooFar가 아니면 true
//   기대 거리 값은 서버 공식(파이썬)으로 계산한 값이다 (test_task015_lodging.py의 north_of_center와 같은 방법으로 만든 점)
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canConfirmPin, distanceMeters, EARTH_RADIUS_KM, isTooFar, LODGING_MAX_DISTANCE_M, type LatLng } from '@/lib/lodging-pick';

import { REPO_ROOT } from '../test-support/source-files';

const CENTER: LatLng = { lat: 34.6662, lng: 135.501 }; // 시드 v3 (§9 Q6)
const KYOTO: LatLng = { lat: 34.9858, lng: 135.7588 }; // 교토역 약 42km (§9 Q5 "교토 숙소 정도는 들어오게")
const TOKYO: LatLng = { lat: 35.6812, lng: 139.7671 }; // 도쿄역 (서버 테스트 FAR와 같은 점)
const PIN: LatLng = { lat: 34.657913, lng: 135.506271 }; // 서버 테스트 PIN과 같은 점
const KM_PER_LAT_DEG = (6371.0 * Math.PI) / 180; // 경도가 같으면 거리 = 위도 차 x 이 값 (서버 테스트와 같은 식)
const north = (km: number, from: LatLng = CENTER): LatLng => ({ lat: from.lat + km / KM_PER_LAT_DEG, lng: from.lng });
const south = (km: number, from: LatLng = CENTER): LatLng => ({ lat: from.lat - km / KM_PER_LAT_DEG, lng: from.lng });

describe('§13 Q2 거리 공식 = 서버와 같다', () => {
  test('T15_S13_Q2_지구_반지름은_서버_거리_공식의_earth_km와_같은_6371', () => {
    const detect = readFileSync(join(REPO_ROOT, 'apps', 'server', 'trip', 'detect.py'), 'utf8');
    const found = detect.match(/earth_km=([\d.]+)/);
    expect(found).not.toBeNull(); // 서버 쪽 이름이 바뀌어 못 찾으면 실패 (조용히 통과하지 않게)
    expect(EARTH_RADIUS_KM).toBe(Number(found![1]));
    expect(LODGING_MAX_DISTANCE_M).toBe(50_000);
  });

  // 기대 값 = apps/server/trip/detect.py _distance_m 공식으로 파이썬이 계산한 값
  test.each<[string, LatLng, number]>([
    ['교토역', KYOTO, 42622.50993624602],
    ['도쿄역', TOKYO, 403804.2693106764],
    ['서버_테스트_PIN', PIN, 1039.9608804451366],
    ['동쪽_경도_0_5도', { lat: CENTER.lat, lng: CENTER.lng + 0.5 }, 45727.739570777674],
  ])('T15_S13_Q2_도시_중심에서_%s까지_서버와_같은_거리', (_name, to, meters) => {
    expect(distanceMeters(CENTER, to)).toBeCloseTo(meters, 3);
  });

  test('T15_S13_Q2_같은_점은_0', () => {
    expect(distanceMeters(CENTER, CENTER)).toBe(0);
  });

  test('T15_S13_Q2_P_거리는_순서와_상관없고_경도가_같으면_위도_차_x_KM_PER_LAT_DEG', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true }), fc.boolean(), (km, up) => {
        const at = up ? north(km) : south(km);
        expect(distanceMeters(CENTER, at)).toBeCloseTo(distanceMeters(at, CENTER), 6);
        expect(distanceMeters(CENTER, at)).toBeCloseTo(km * 1000, 3);
      }),
    );
  });
});

describe('§13 Q2 50km 검사 (경계는 밖)', () => {
  test.each<[string, LatLng]>([
    ['도시_중심_그_자리', CENTER],
    ['북쪽_49_5km', north(49.5)],
    ['남쪽_49_5km', south(49.5)],
    ['북쪽_49_999km', north(49.999)],
    ['남쪽_49_999km', south(49.999)],
    ['교토역_약_42km', KYOTO],
  ])('T15_S13_Q2_%s는_50km_안', (_name, at) => {
    expect(isTooFar(at, CENTER)).toBe(false);
  });

  test.each<[string, LatLng]>([
    ['북쪽_정확히_50km', north(50)],
    ['남쪽_정확히_50km', south(50)],
    ['북쪽_50_001km', north(50.001)],
    ['남쪽_50_5km', south(50.5)],
    ['도쿄역', TOKYO],
  ])('T15_S13_Q2_경계_%s는_밖_too_far', (_name, at) => {
    expect(isTooFar(at, CENTER)).toBe(true);
  });

  // §14 본문: 서버 detect._within처럼 소수 6자리로 반올림한 뒤 비교. 기대 m = 서버 공식(파이썬) 값
  //   north(49.9999999994) = 49999.99999940069m -> 49999.999999 -> 안 (정수·소수 3자리 반올림이면 50000이라 밖이 된다)
  //   north(49.9999999996) = 49999.99999960015m -> 50000.000000 -> 밖 (반올림 없이 비교하면 안이 된다)
  //   south(50)            = 49999.99999999979m -> 50000.000000 -> 밖 (위 '남쪽_정확히_50km'와 같은 이유)
  test.each<[string, LatLng, boolean]>([
    ['북쪽_49_9999999994km는_6자리_반올림_49999_999999m라_안', north(49.9999999994), false],
    ['남쪽_49_9999999994km는_6자리_반올림_49999_999999m라_안', south(49.9999999994), false],
    ['북쪽_49_9999999996km는_6자리_반올림_50000m라_밖', north(49.9999999996), true],
    ['남쪽_49_9999999996km는_6자리_반올림_50000m라_밖', south(49.9999999996), true],
  ])('T15_S14_경계_%s', (_name, at, far) => {
    expect(isTooFar(at, CENTER)).toBe(far);
  });

  test('T15_S13_Q2_기준은_넘겨받은_도시_중심이다_앱에_고정된_오사카가_아니다', () => {
    // 교토를 중심으로 주면: 교토 북쪽 45km(오사카에서 약 84km)는 안, 오사카 남쪽 45km(교토에서 약 84km)는 밖
    expect(isTooFar(north(45, KYOTO), KYOTO)).toBe(false);
    expect(isTooFar(south(45), KYOTO)).toBe(true);
  });

  test('T15_S13_Q2_P_50km_미만은_안_50km_이상은_밖', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 49.99, noNaN: true }), fc.double({ min: 50, max: 1000, noNaN: true }), fc.boolean(), (inside, outside, up) => {
        const move = up ? north : south;
        expect(isTooFar(move(inside), CENTER)).toBe(false);
        expect(isTooFar(move(outside), CENTER)).toBe(true);
      }),
    );
  });
});

describe('§13 Q2·Q3 · §12 Q6 [여기로 정했어] 켜짐', () => {
  test('T15_S13_Q3_핀이_없으면_꺼짐', () => {
    expect(canConfirmPin(null, CENTER)).toBe(false);
  });

  test.each<[string, LatLng, boolean]>([
    ['도시_중심', CENTER, true],
    ['북쪽_49_999km', north(49.999), true],
    ['북쪽_정확히_50km', north(50), false],
    ['남쪽_50_5km', south(50.5), false],
    ['도쿄역', TOKYO, false],
  ])('T15_S13_Q3_경계_핀이_%s면_%s', (_name, at, on) => {
    expect(canConfirmPin(at, CENTER)).toBe(on);
  });

  test('T15_S13_Q3_P_켜짐은_핀_있음_그리고_too_far_아님과_같다', () => {
    fc.assert(
      fc.property(
        fc.option(fc.record({ lat: fc.double({ min: 33, max: 37, noNaN: true }), lng: fc.double({ min: 133, max: 138, noNaN: true }) }), { nil: null }),
        (pin) => {
          expect(canConfirmPin(pin, CENTER)).toBe(pin !== null && !isTooFar(pin, CENTER));
        },
      ),
    );
  });
});
