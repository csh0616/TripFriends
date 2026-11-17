/// <reference types="jest" />
// TASK-015 §22 막는 2 — "같은 영역" 판정(sameRegionOnScreen) · 지도가 보여 주는 영역(shownRegion) 순수 함수.
// 근거: 승현 11-17 결정(원문 요지): "화면 0.5pt 기준. 가운데만 보지 말고 넓이도 같이 — 가운데 차이가 0.5pt 이내 그리고 네 모서리도 각각 0.5pt 이내.
//       가운데는 같고 넓이(확대)가 다른 진짜 맞춤 영역은 거르지 않아야. 경계: 0.027pt 차이(실제 측정값)는 걸러짐 · 0.5pt 경계 · 가운데 같고 넓이만 다른 영역은 안 걸러짐" ·
//       frontend 시뮬레이터 측정(맞춤 뒤 먼저 오는 처음 영역: initialRegion과 가운데 위도 3.35e-6도, 경도 폭 상대 5.4e-6 차)
//
// 계약 (이 파일이 정한 것):
//   pt 환산 = project(base, size, 점) (map-project, 보이는 영역 크기 · 웹 메르카토르). 모서리 = 위도 ± 위도 폭/2, 경도 ± 경도 폭/2. 가운데 = (latitude, longitude)
//   거리 = 화면 두 점 사이 직선 거리(pt). 0.5pt "정각"은 같음(≤)
//   shownRegion: 가운데 그대로 · 가로 축척(size.width / 경도 폭 라디안) = 세로 축척(size.height / 메르카토르 세로 폭) · 원래 두 폭 이상이고 한쪽은 원래 폭 그대로
import fc from 'fast-check';

import { project, type Region, type Size } from '@/lib/map-project';
import { sameRegionOnScreen, SAME_REGION_TOLERANCE_PT, shownRegion } from '@/lib/region-match';

const SIZE: Size = { width: 402, height: 672 }; // iPhone 17 크게 보기 보이는 영역
const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** 처음 영역(35.0, 135.0, 경도 폭 0.05)을 지도가 보여 주는 모양 — 위도 폭은 한 배율로 계산 */
function initialShown(size: Size = SIZE): Region {
  const lngDelta = 0.05;
  const mercHalf = (rad(lngDelta) * (size.height / size.width)) / 2;
  const north = unmerc(merc(35.0) + mercHalf);
  const south = unmerc(merc(35.0) - mercHalf);
  return { latitude: 35.0, longitude: 135.0, latitudeDelta: north - south, longitudeDelta: lngDelta };
}

/** base 화면에서 dx · dy pt 옮긴 영역 (가운데만 옮김, 두 폭 그대로) */
function shifted(base: Region, size: Size, dx: number, dy: number): Region {
  const perLng = base.longitudeDelta / size.width;
  const c = project(base, size, base);
  const topMerc = merc(base.latitude + base.latitudeDelta / 2);
  const bottomMerc = merc(base.latitude - base.latitudeDelta / 2);
  const centerMerc = topMerc - ((c.y + dy) / size.height) * (topMerc - bottomMerc);
  const shift = unmerc(centerMerc) - base.latitude;
  return { ...base, longitude: base.longitude + dx * perLng, latitude: base.latitude + shift };
}

test('T15_S22_2_M_허용_오차는_0.5pt', () => {
  expect(SAME_REGION_TOLERANCE_PT).toBe(0.5);
});

describe('§22 막는 2 — sameRegionOnScreen 예시 · 경계', () => {
  test('T15_S22_2_M_같은_값이면_같다', () => {
    expect(sameRegionOnScreen(initialShown(), initialShown(), SIZE)).toBe(true);
  });

  test('T15_S22_2_M_실제_측정값(가운데_위도_3.35e-6도·경도_폭_상대_5.4e-6)은_같다(걸러짐)', () => {
    const base = initialShown();
    const other = { ...base, latitude: base.latitude + 3.35e-6, longitudeDelta: base.longitudeDelta * (1 + 5.4e-6) };
    expect(sameRegionOnScreen(base, other, SIZE)).toBe(true);
  });

  test('T15_S22_2_M_경계_가로_정각_0.5pt_옮김은_같다(이하)', () => {
    // 2진수로 딱 떨어지는 값: 폭 512pt · 경도 폭 2^-4 -> 0.5pt = 2^-14도
    const size = { width: 512, height: 512 };
    const base: Region = { latitude: 0, longitude: 135, latitudeDelta: 0.0625, longitudeDelta: 0.0625 };
    expect(sameRegionOnScreen(base, { ...base, longitude: 135 + 2 ** -14 }, size)).toBe(true);
  });

  test.each([
    ['가로', 0.49, 0, true],
    ['가로', 0.51, 0, false],
    ['가로_반대쪽', -0.51, 0, false],
    ['세로', 0, 0.49, true],
    ['세로', 0, 0.51, false],
    ['대각선_거리_0.49', 0.49 / Math.SQRT2, 0.49 / Math.SQRT2, true],
    ['대각선_거리_0.51(축마다는_0.5_안)', 0.51 / Math.SQRT2, 0.51 / Math.SQRT2, false],
  ])('T15_S22_2_M_경계_가운데를_%s로_(%s,%s)pt_옮기면_같음=%s', (_name, dx, dy, expected) => {
    const base = initialShown();
    expect(sameRegionOnScreen(base, shifted(base, SIZE, dx as number, dy as number), SIZE)).toBe(expected);
  });

  test.each([
    // 가운데 그대로, 경도 폭만 키움: 왼쪽 · 오른쪽 모서리가 (폭/2)·(k−1) pt 벌어진다
    ['경도_폭_모서리_0.49pt_벌어지면_같다', 1 + 0.49 / (SIZE.width / 2), true],
    ['경도_폭_모서리_0.51pt_벌어지면_다르다', 1 + 0.51 / (SIZE.width / 2), false],
  ])('T15_S22_2_M_경계_가운데_같고_%s', (_name, k, expected) => {
    const base = initialShown();
    expect(sameRegionOnScreen(base, { ...base, longitudeDelta: base.longitudeDelta * (k as number) }, SIZE)).toBe(expected);
  });

  test('T15_S22_2_M_가운데_같고_위도_폭만_1%_다르면(모서리_약_3pt)_다르다', () => {
    const base = initialShown();
    expect(sameRegionOnScreen(base, { ...base, latitudeDelta: base.latitudeDelta * 1.01 }, SIZE)).toBe(false);
  });

  test('T15_S22_2_M_가운데_같고_넓이만_다른_진짜_맞춤_영역(경도_폭_0.0114)은_다르다(안_걸러짐)', () => {
    const base = initialShown();
    const k = 0.0114 / 0.05;
    expect(sameRegionOnScreen(base, { ...base, latitudeDelta: base.latitudeDelta * k, longitudeDelta: 0.0114 }, SIZE)).toBe(false);
  });

  test('T15_S22_2_M_속성_가운데를_0.5pt_넘게_옮기면_늘_다르다', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: 0.52, max: 50, noNaN: true }), (angle, dist) => {
        const base = initialShown();
        expect(sameRegionOnScreen(base, shifted(base, SIZE, dist * Math.cos(angle), dist * Math.sin(angle)), SIZE)).toBe(false);
      }),
    );
  });

  test('T15_S22_2_M_속성_가운데를_0.48pt_안으로_옮기면_늘_같다(두_폭_그대로)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: 0, max: 0.48, noNaN: true }), (angle, dist) => {
        const base = initialShown();
        expect(sameRegionOnScreen(base, shifted(base, SIZE, dist * Math.cos(angle), dist * Math.sin(angle)), SIZE)).toBe(true);
      }),
    );
  });
});

describe('§22 막는 2 — shownRegion (지도가 처음 영역을 보여 주는 모양)', () => {
  test('T15_S22_2_M_세로로_긴_화면에서_처음_영역(0.05×0.05)은_경도_폭_그대로_위도_폭만_넓어진다', () => {
    const shown = shownRegion({ latitude: 35.0, longitude: 135.0, latitudeDelta: 0.05, longitudeDelta: 0.05 }, SIZE) as Region;
    expect(shown).not.toBeNull();
    expect(shown.latitude).toBe(35.0);
    expect(shown.longitude).toBe(135.0);
    expect(shown.longitudeDelta).toBeCloseTo(0.05, 12);
    expect(shown.latitudeDelta).toBeGreaterThan(0.05);
    expect(sameRegionOnScreen(initialShown(), shown, SIZE)).toBe(true);
  });

  test('T15_S22_2_M_속성_가운데_그대로·한_배율·원래_영역이_다_들어감·한쪽_폭은_그대로', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 30, max: 40, noNaN: true }),
        fc.double({ min: 0.005, max: 0.2, noNaN: true }),
        fc.double({ min: 0.005, max: 0.2, noNaN: true }),
        fc.integer({ min: 200, max: 900 }),
        fc.integer({ min: 200, max: 900 }),
        (lat, latDelta, lngDelta, width, height) => {
          const region = { latitude: lat, longitude: 135, latitudeDelta: latDelta, longitudeDelta: lngDelta };
          const shown = shownRegion(region, { width, height }) as Region;
          expect(shown).not.toBeNull();
          expect(shown.latitude).toBeCloseTo(lat, 9);
          expect(shown.longitude).toBe(135);
          const perLng = width / rad(shown.longitudeDelta);
          const perMerc = height / (merc(shown.latitude + shown.latitudeDelta / 2) - merc(shown.latitude - shown.latitudeDelta / 2));
          expect(Math.abs(perLng / perMerc - 1)).toBeLessThan(1e-6);
          expect(shown.longitudeDelta).toBeGreaterThanOrEqual(lngDelta * (1 - 1e-9));
          expect(shown.latitudeDelta).toBeGreaterThanOrEqual(latDelta * (1 - 1e-9));
          const keepsOne = Math.abs(shown.longitudeDelta / lngDelta - 1) < 1e-9 || Math.abs(shown.latitudeDelta / latDelta - 1) < 1e-6;
          expect(keepsOne).toBe(true);
        },
      ),
    );
  });

  test.each<[string, Size, Region]>([
    ['폭_0', { width: 0, height: 672 }, { latitude: 35, longitude: 135, latitudeDelta: 0.05, longitudeDelta: 0.05 }],
    ['높이_0', { width: 402, height: 0 }, { latitude: 35, longitude: 135, latitudeDelta: 0.05, longitudeDelta: 0.05 }],
    ['경도_폭_0', SIZE, { latitude: 35, longitude: 135, latitudeDelta: 0.05, longitudeDelta: 0 }],
    ['위도_폭_0', SIZE, { latitude: 35, longitude: 135, latitudeDelta: 0, longitudeDelta: 0.05 }],
  ])('T15_S22_2_M_shownRegion_%s이면_null', (_name, size, region) => {
    expect(shownRegion(region, size)).toBeNull();
  });
});

// ---------- 승현 11-17 조건: 보이는 지도 영역 크기로, 화면 비율 여러 가지에서 같은 규칙 ----------

const INITIAL: Region = { latitude: 35.0, longitude: 135.0, latitudeDelta: 0.05, longitudeDelta: 0.05 }; // 크게 보기 initialRegion (layout.mapDelta)
/** frontend 시뮬레이터 실측 알림 (보이는 지도 영역 402×672) */
const MEASURED_ALERT: Region = { latitude: 34.99999664825308, longitude: 135, latitudeDelta: 0.06846607929220738, longitudeDelta: 0.04999972879886627 };

/** 시험 쪽 "보여 주는 모양" (가운데 그대로 · 작은 축척 한 배율 · 남는 축만 넓힘) */
function shownOracle(r: Region, size: Size): Region {
  const lngRad = rad(r.longitudeDelta);
  const top = merc(r.latitude + r.latitudeDelta / 2);
  const bottom = merc(r.latitude - r.latitudeDelta / 2);
  const scale = Math.min(size.width / lngRad, size.height / (top - bottom));
  const mid = (top + bottom) / 2;
  const half = size.height / scale / 2;
  return { latitude: r.latitude, longitude: r.longitude, latitudeDelta: unmerc(mid + half) - unmerc(mid - half), longitudeDelta: ((size.width / scale) * 180) / Math.PI };
}

/** base 화면에서 other의 가운데 · 네 모서리 중 가장 먼 차 (pt) */
function gap(base: Region, other: Region, size: Size): number {
  const pts = (r: Region) => [
    { latitude: r.latitude, longitude: r.longitude },
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => ({ latitude: r.latitude + (a * r.latitudeDelta) / 2, longitude: r.longitude + (b * r.longitudeDelta) / 2 }))),
  ];
  const mine = pts(base).map((p) => project(base, size, p));
  const theirs = pts(other).map((p) => project(base, size, p));
  return Math.max(...mine.map((m, i) => Math.hypot(m.x - theirs[i].x, m.y - theirs[i].y)));
}

describe('§22 막는 2 — 실측 알림 (402×672)', () => {
  test('T15_S22_2_M_실측_알림은_보여_주는_처음_영역과_같다(걸러짐)', () => {
    const size = { width: 402, height: 672 };
    const shown = shownRegion(INITIAL, size) as Region;
    expect(gap(shownOracle(INITIAL, size), MEASURED_ALERT, size)).toBeLessThan(0.05); // 시험 자체 확인: frontend 보고 0.031~0.035pt
    expect(sameRegionOnScreen(shown, MEASURED_ALERT, size)).toBe(true);
  });

  test('T15_S22_2_M_실측_알림을_initialRegion_값(0.05×0.05)_그대로와_비교하면_다르다(그래서_보여_주는_모양으로_맞춘다)', () => {
    expect(sameRegionOnScreen(INITIAL, MEASURED_ALERT, { width: 402, height: 672 })).toBe(false);
  });
});

// 0.05 × 0.05 (위도 35)는 메르카토르 세로 폭이 경도 폭의 약 1.22배 -> 높이 < 폭 × 1.22면 세로가, 아니면 가로가 맞춤(작은 축척)을 정한다
describe.each<[string, Size, 'lng' | 'lat']>([
  ['지금_크기_402×672(가로가_정함)', { width: 402, height: 672 }, 'lng'],
  ['더_긴_화면_402×1000(가로가_정함)', { width: 402, height: 1000 }, 'lng'],
  ['낮은_화면_402×450(세로가_정함)', { width: 402, height: 450 }, 'lat'],
])('§22 막는 2 — 화면 비율 %s', (_name, size, binding) => {
  test('T15_S22_2_M_비율_보여_주는_모양은_정하는_축_폭이_그대로이고_시험_계산과_같다', () => {
    const shown = shownRegion(INITIAL, size) as Region;
    expect(shown).not.toBeNull();
    if (binding === 'lng') expect(shown.longitudeDelta).toBeCloseTo(0.05, 12);
    else expect(shown.latitudeDelta).toBeCloseTo(0.05, 12);
    expect(gap(shownOracle(INITIAL, size), shown, size)).toBeLessThan(1e-6);
  });

  test('T15_S22_2_M_비율_실측만큼의_흔들림(가운데_약_0.03pt)은_같다(걸러짐)', () => {
    const base = shownRegion(INITIAL, size) as Region;
    const other = { ...base, latitude: base.latitude - 3.35e-6 * (base.latitudeDelta / 0.0685), longitudeDelta: base.longitudeDelta * (1 - 5.4e-6) };
    expect(gap(base, other, size)).toBeLessThan(0.1); // 시험 자체 확인
    expect(sameRegionOnScreen(base, other, size)).toBe(true);
  });

  test.each([
    ['0.49pt_같다', 0.49, true],
    ['0.51pt_다르다', 0.51, false],
  ])('T15_S22_2_M_비율_경계_가운데를_가로로_%s', (_n, dx, expected) => {
    const base = shownRegion(INITIAL, size) as Region;
    const other = { ...base, longitude: base.longitude + ((dx as number) * base.longitudeDelta) / size.width };
    expect(sameRegionOnScreen(base, other, size)).toBe(expected);
  });

  test('T15_S22_2_M_비율_가운데_같고_넓이만_다른_영역(두_폭_×1.01)은_다르다', () => {
    const base = shownRegion(INITIAL, size) as Region;
    expect(sameRegionOnScreen(base, { ...base, latitudeDelta: base.latitudeDelta * 1.01, longitudeDelta: base.longitudeDelta * 1.01 }, size)).toBe(false);
  });
});
