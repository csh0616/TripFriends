/// <reference types="jest" />
// TASK-014 §24: 연습 지도 카메라를 우리가 직접 계산한다 (fit 대신). 계산된 값으로 확대 정도·보이는 띠 안인지를 본다.
// 근거: TASK-014 §24(머무는 동안 동서 800m + 그 장소가 보이는 띠 안 / 이동 중 세 곳 맞추되 동서 상한 3km, 넘으면 reh-dot을 띠 안에),
//       §22 Q1(±5%), §22 Q2(첫 구간 출발 = 숙소, 마지막 도착 = 숙소), §23(이동 중 지금 자리를 모르면 출발·도착 두 곳), §21 1(나중 장소·숙소는 넣지 않음).
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 참고):
//   모듈 '@/now/rehearsal-camera' (아직 없다 — src를 만들지 않아 require로 부른다. 없으면 각 테스트가 빨강)
//   rehearsalCamera(pins: NowPin[], position: {lat,lng} | null, lodging: {lat,lng}, box: ViewBox) -> { key: string, region: CameraRegion }
//     ViewBox     = { width, height, top, bottom } : 지도 view 크기(pt)와 보이는 띠의 위·아래 y (view 맨 위 0 기준)
//     CameraRegion = react-native-maps Region { latitude, longitude, latitudeDelta, longitudeDelta } — 지도 view 전체의 가운데와 폭
//     key: 같은 구간이면 같은 값, 구간이 바뀌면 다른 값 (§22 Q2·§23 "같은 구간이면 그대로")
//   해석 (테스트가 따로 계산): 화면 x = 선형 경도, 화면 y = 메르카토르 ln(tan(π/4 + φ/2)) 선형, 북쪽이 위.
//     동서 폭(m) = longitudeDelta × (π/180 × 6371000) × cos(가운데 위도). 위아래·좌우 1pt가 같은 땅 길이(±5%) — 지도가 다른 쪽 폭으로 멀어지지 않게
//   머무는 중(state "now" 핀): 동서 폭 800m ±5%, 가운데 경도 = 그 장소(1m 안), 그 장소의 화면 y가 [top, bottom] 안
//   이동 중: 세 곳(지금 자리·출발·도착)이 모두 x ∈ [mapEdge 60, width − 60], y ∈ [top, bottom] 안에 들어가는 가장 작은 폭 — 그 폭이 3km를 넘으면
//            동서 폭 3km ±5%, reh-dot(지금 자리)이 x ∈ [0, width], y ∈ [top, bottom] 안
import fc from 'fast-check';

type At = { lat: number; lng: number };
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Box = { width: number; height: number; top: number; bottom: number };
type Camera = (pins: unknown[], position: At | null, lodging: At, box: Box) => { key: string; region: Region };

const camera: Camera = (...args) => (require('@/now/rehearsal-camera') as { rehearsalCamera: Camera }).rehearsalCamera(...args);

const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;
const STAY_M = 800; // §21 1·§24
const MOVE_CAP_M = 3000; // §24 "동서 폭 상한 3km(가설)"
const TOL = 0.05; // §22 Q1
const MAP_EDGE = 60; // layout.mapEdge (§14 승인: 카메라 맞춤 좌우 여백)

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function project(region: Region, box: Box, at: At) {
  const x = box.width / 2 + ((at.lng - region.longitude) / region.longitudeDelta) * box.width;
  const north = merc(region.latitude + region.latitudeDelta / 2);
  const south = merc(region.latitude - region.latitudeDelta / 2);
  const y = ((north - merc(at.lat)) / (north - south)) * box.height;
  return { x, y };
}
const spanEW = (region: Region) => region.longitudeDelta * METERS_PER_DEGREE * Math.cos((region.latitude * Math.PI) / 180);
/** 위아래 1pt 땅 길이 / 좌우 1pt 땅 길이 */
const aspect = (region: Region, box: Box) => (region.latitudeDelta * METERS_PER_DEGREE) / box.height / (spanEW(region) / box.width);

const near = (value: number, target: number) => value >= target * (1 - TOL) && value <= target * (1 + TOL);
const inBand = (y: number, box: Box) => y >= box.top - 0.5 && y <= box.bottom + 0.5;

// 연습 화면과 비슷한 띠: 390×763 지도에 보이는 띠 175~211 (36pt, §24 "약 36pt") — 띠가 지도 가운데(381.5)보다 위
const BOX: Box = { width: 390, height: 763, top: 175, bottom: 211 };
const LODGING: At = { lat: 35.0, lng: 135.0 };

const pin = (seq: number, at: At, state: 'done' | 'now' | 'next' | 'later') => ({
  seq,
  place_id: `P${seq}`,
  name: `장소${seq}`,
  lat: at.lat,
  lng: at.lng,
  start: '10:00',
  end: '11:00',
  travel_min: 10,
  state,
});
const east = (from: At, m: number): At => ({ lat: from.lat, lng: from.lng + m / (METERS_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180)) });
const north = (from: At, m: number): At => ({ lat: from.lat + m / METERS_PER_DEGREE, lng: from.lng });
const mid = (a: At, b: At): At => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

// =====================================================================
// 머무는 동안: 동서 800m · 그 장소가 보이는 띠 안
// =====================================================================

describe('§24 머무는 동안', () => {
  const PLACE: At = { lat: 35.02, lng: 134.99 };
  const pins = [pin(1, { lat: 35.01, lng: 135.01 }, 'done'), pin(2, PLACE, 'now'), pin(3, { lat: 35.0, lng: 135.02 }, 'next')];

  test('T14_S24_1_머무는_중_계산된_동서_폭은_800m', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    expect(near(spanEW(region), STAY_M)).toBe(true);
  });

  test('T14_S24_1_머무는_중_위아래도_같은_축척_다른_쪽_폭으로_멀어지지_않는다', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    expect(aspect(region, BOX)).toBeGreaterThanOrEqual(1 - TOL);
    expect(aspect(region, BOX)).toBeLessThanOrEqual(1 + TOL);
  });

  test('T14_S24_1_머무는_중_가운데_경도는_그_장소', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    expect(Math.abs(region.longitude - PLACE.lng) * METERS_PER_DEGREE * Math.cos((PLACE.lat * Math.PI) / 180)).toBeLessThanOrEqual(1);
  });

  test('T14_S24_1_머무는_중_그_장소의_화면_y는_보이는_띠_안', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    const { x, y } = project(region, BOX, PLACE);
    expect(inBand(y, BOX)).toBe(true);
    expect(Math.abs(x - BOX.width / 2)).toBeLessThanOrEqual(1);
  });

  test('T14_S24_1_머무는_중_띠가_가운데보다_위면_가운데를_남쪽으로_옮긴다', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    expect(region.latitude).toBeLessThan(PLACE.lat); // 띠 175~211은 지도 가운데 381.5보다 위
  });

  test('T14_S24_1_경계_띠가_가운데보다_아래면_가운데를_북쪽으로_옮긴다', () => {
    const low: Box = { width: 390, height: 763, top: 600, bottom: 640 };
    const { region } = camera(pins, PLACE, LODGING, low);
    expect(region.latitude).toBeGreaterThan(PLACE.lat);
    expect(inBand(project(region, low, PLACE).y, low)).toBe(true);
  });

  test('T14_S24_1_속성_어떤_화면·띠·위도에서도_800m_띠_안_같은_축척', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 430 }),
        fc.integer({ min: 560, max: 932 }),
        fc.double({ min: 0, max: 0.8, noNaN: true }),
        fc.integer({ min: 20, max: 200 }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (width, height, topRatio, bandHeight, lat, lng) => {
          const top = Math.floor(topRatio * (height - bandHeight));
          const box: Box = { width, height, top, bottom: top + bandHeight };
          const place = { lat, lng };
          const { region } = camera([pin(1, place, 'now')], place, LODGING, box);
          expect(near(spanEW(region), STAY_M)).toBe(true);
          expect(inBand(project(region, box, place).y, box)).toBe(true);
          expect(Math.abs(aspect(region, box) - 1)).toBeLessThanOrEqual(TOL);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =====================================================================
// 이동 중: 세 곳 맞추기 · 동서 상한 3km · 넘으면 reh-dot이 띠 안
// =====================================================================

describe('§24 이동 중', () => {
  const inside = (region: Region, box: Box, at: At) => {
    const { x, y } = project(region, box, at);
    return x >= MAP_EDGE - 0.5 && x <= box.width - MAP_EDGE + 0.5 && inBand(y, box);
  };

  test('T14_S24_2_가까운_동서_구간이면_세_곳이_모두_보이는_띠_안·3km보다_좁다', () => {
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 700);
    const dot = mid(from, to);
    const pins = [pin(1, from, 'done'), pin(2, to, 'next'), pin(3, north(from, 5000), 'later')];
    const { region } = camera(pins, dot, LODGING, BOX);
    for (const at of [dot, from, to]) expect(inside(region, BOX, at)).toBe(true);
    expect(spanEW(region)).toBeLessThan(MOVE_CAP_M);
    expect(Math.abs(aspect(region, BOX) - 1)).toBeLessThanOrEqual(TOL);
  });

  test('T14_S24_2_가까운_구간은_필요한_만큼만_넓다_두_배_넘게_멀지_않다', () => {
    // 700m를 좌우 여백 60씩 뺀 270pt에 넣으면 약 1011m. 그보다 작을 수 없고, 두 배(2022m)를 넘지 않는다
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 700);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], mid(from, to), LODGING, BOX);
    const need = (700 * BOX.width) / (BOX.width - 2 * MAP_EDGE);
    expect(spanEW(region)).toBeGreaterThanOrEqual(need * (1 - TOL));
    expect(spanEW(region)).toBeLessThanOrEqual(need * 2);
  });

  test('T14_S24_2_동서로_긴_구간이면_3km로_묶고_reh_dot은_띠_안', () => {
    const from = { lat: 35.0, lng: 135.0 };
    const to = east(from, 6000);
    const dot = east(from, 1500);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    const { x, y } = project(region, BOX, dot);
    expect(inBand(y, BOX)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(BOX.width);
  });

  test('T14_S24_2_남북으로_긴_구간도_3km로_묶고_reh_dot은_띠_안', () => {
    const from = { lat: 35.0, lng: 135.0 };
    const to = north(from, 5000);
    const dot = north(from, 3500);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    const { x, y } = project(region, BOX, dot);
    expect(inBand(y, BOX)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(BOX.width);
    expect(Math.abs(aspect(region, BOX) - 1)).toBeLessThanOrEqual(TOL);
  });

  test('T14_S24_2_경계_남북_300m만_돼도_36pt_띠엔_못_넣어_3km로_묶는다', () => {
    // 300m를 36pt에 넣으려면 동서 폭이 약 3250m — 상한을 넘는다
    const from = { lat: 35.0, lng: 135.0 };
    const to = north(from, 300);
    const dot = mid(from, to);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    expect(inBand(project(region, BOX, dot).y, BOX)).toBe(true);
  });

  test('T14_S24_2_속성_이동_중_폭은_3km_이하이고_reh_dot은_늘_띠_안', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (eastM, northM, ratio) => {
          const from = { lat: 34.7, lng: 135.5 };
          const to = north(east(from, eastM), northM);
          if (Math.hypot(eastM, northM) < 50) return; // 거의 같은 자리는 뺀다
          const dot = { lat: from.lat + (to.lat - from.lat) * ratio, lng: from.lng + (to.lng - from.lng) * ratio };
          const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
          expect(spanEW(region)).toBeLessThanOrEqual(MOVE_CAP_M * (1 + TOL));
          expect(inBand(project(region, BOX, dot).y, BOX)).toBe(true);
          expect(Math.abs(aspect(region, BOX) - 1)).toBeLessThanOrEqual(TOL);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// =====================================================================
// 구간 끝 · 넣지 않는 곳 · 지금 자리를 모를 때 · 구간 키
// =====================================================================

describe('§24 구간 (§21 1·§22 Q2·§23)', () => {
  const inside = (region: Region, at: At) => {
    const { x, y } = project(region, BOX, at);
    return x >= MAP_EDGE - 0.5 && x <= BOX.width - MAP_EDGE + 0.5 && inBand(y, BOX);
  };

  test('T14_S24_Q2_첫_구간은_숙소에서_출발_숙소·지금_자리·1번이_띠_안', () => {
    const first = east(LODGING, 600);
    const dot = mid(LODGING, first);
    const { region } = camera([pin(1, first, 'next'), pin(2, north(first, 4000), 'later')], dot, LODGING, BOX);
    for (const at of [LODGING, dot, first]) expect(inside(region, at)).toBe(true);
  });

  test('T14_S24_Q2_마지막_구간은_숙소에_도착_마지막_장소·지금_자리·숙소가_띠_안', () => {
    const last = east(LODGING, -600);
    const dot = mid(last, LODGING);
    const { region } = camera([pin(1, north(LODGING, 4000), 'done'), pin(2, last, 'done')], dot, LODGING, BOX);
    for (const at of [last, dot, LODGING]) expect(inside(region, at)).toBe(true);
  });

  test('T14_S24_경계_나중_장소·멀리_있는_숙소는_계산에_넣지_않는다', () => {
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 700);
    const dot = mid(from, to);
    const base = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX).region;
    const more = camera([pin(1, from, 'done'), pin(2, to, 'next'), pin(3, north(from, 9000), 'later')], dot, north(LODGING, -9000), BOX).region;
    expect(more).toEqual(base);
  });

  test('T14_S24_S23_이동_중_지금_자리를_모르면_출발·도착_두_곳이_띠_안', () => {
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 700);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], null, LODGING, BOX);
    for (const at of [from, to]) expect(inside(region, at)).toBe(true);
  });

  test('T14_S24_같은_구간이면_지금_자리가_달라도_키가_같다', () => {
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 700);
    const pins = [pin(1, from, 'done'), pin(2, to, 'next')];
    expect(camera(pins, east(from, 100), LODGING, BOX).key).toBe(camera(pins, east(from, 600), LODGING, BOX).key);
  });

  test('T14_S24_구간이_바뀌면_키가_다르다_머묾·이동·다음_이동', () => {
    const a = { lat: 35.0, lng: 135.01 };
    const b = east(a, 700);
    const c = east(b, 700);
    const keys = [
      camera([pin(1, a, 'now'), pin(2, b, 'next'), pin(3, c, 'later')], a, LODGING, BOX).key,
      camera([pin(1, a, 'done'), pin(2, b, 'next'), pin(3, c, 'later')], mid(a, b), LODGING, BOX).key,
      camera([pin(1, a, 'done'), pin(2, b, 'now'), pin(3, c, 'next')], b, LODGING, BOX).key,
      camera([pin(1, a, 'done'), pin(2, b, 'done'), pin(3, c, 'next')], mid(b, c), LODGING, BOX).key,
    ];
    expect(new Set(keys).size).toBe(4);
  });
});
