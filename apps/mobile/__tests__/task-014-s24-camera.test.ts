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
//            동서 폭 3km ±5%, reh-dot(지금 자리)이 띠 가운데 (§25 Q2: x = width/2, y = (top+bottom)/2, ±1pt). 지금 자리를 모르면 도착할 곳(§25 Q5)
//   머무는 장소도 띠 가운데 (§25 Q2)
// §26 (승인 대기 계약):
//   box는 지금처럼 "보이는 띠 전체"를 받는다. 함수가 안에서 위·아래 30씩(핀 반지름 22 + 여백 8) 줄인 띠에 넣는다 (가운데는 같다)
//     -> 세 곳·reh-dot이 "띠 안"이라는 단언은 모두 줄어든 띠 [top + 30, bottom − 30] 기준
//   이동 중에도 동서 폭을 800m보다 좁히지 않는다 (§26 작은 것, §25 Q4 "두 배 이하"의 예외)
//   다섯째 인자 previous(이전 결과 { key, region }, 없어도 됨): 같은 구간 키면
//     - 3km로 묶인 구간: reh-dot이 previous 영역에서 줄어든 띠 안(그리고 화면 x 0~width 안)이면 previous를 그대로(같은 객체) 돌려준다. 벗어나면 새로 계산(reh-dot이 띠 가운데)
//     - 3km 미만 구간·머묾: previous 그대로 (지금 규칙)
//   다른 구간 키면 새로 계산
import fc from 'fast-check';

type At = { lat: number; lng: number };
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type Box = { width: number; height: number; top: number; bottom: number };
type Result = { key: string; region: Region };
type Camera = (pins: unknown[], position: At | null, lodging: At, box: Box, previous?: Result) => Result;

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
const PIN_INSET = 30; // §26: 핀 반지름 22 + 여백 8
/** 줄어든 띠 [top + 30, bottom − 30] 안인가 (§26) */
const inBand = (y: number, box: Box) => y >= box.top + PIN_INSET - 0.5 && y <= box.bottom - PIN_INSET + 0.5;
// §25 Q2: 머무는 장소와 3km로 묶을 때의 reh-dot(지금 자리를 모르면 도착할 곳, Q5)은 띠 가운데. 허용 오차 1pt (문서에 없어 이 테스트가 정함)
const CENTER_TOL = 1;
function atBandCenter(region: Region, box: Box, at: At) {
  const { x, y } = project(region, box, at);
  expect(Math.abs(y - (box.top + box.bottom) / 2)).toBeLessThanOrEqual(CENTER_TOL);
  expect(Math.abs(x - box.width / 2)).toBeLessThanOrEqual(CENTER_TOL);
}

// 연습 화면과 비슷한 띠: 390×763 지도에 보이는 띠 175~295 (120pt, §26 "지금 띠 118·120") — 줄어든 띠 205~265(60pt). 띠가 지도 가운데(381.5)보다 위
const BOX: Box = { width: 390, height: 763, top: 175, bottom: 295 };
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

  test('T14_S24_S25_머무는_중_그_장소는_보이는_띠_가운데', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    atBandCenter(region, BOX, PLACE);
  });

  test('T14_S24_1_머무는_중_띠가_가운데보다_위면_가운데를_남쪽으로_옮긴다', () => {
    const { region } = camera(pins, PLACE, LODGING, BOX);
    expect(region.latitude).toBeLessThan(PLACE.lat); // 띠 175~211은 지도 가운데 381.5보다 위
  });

  test('T14_S24_1_경계_띠가_가운데보다_아래면_가운데를_북쪽으로_옮긴다', () => {
    const low: Box = { width: 390, height: 763, top: 600, bottom: 640 };
    const { region } = camera(pins, PLACE, LODGING, low);
    expect(region.latitude).toBeGreaterThan(PLACE.lat);
    atBandCenter(region, low, PLACE);
  });

  test('T14_S24_S25_속성_어떤_화면·띠·위도에서도_800m_띠_가운데_같은_축척', () => {
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
          atBandCenter(region, box, place);
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

  test('T14_S26_아주_짧은_이동이면_800m보다_좁히지_않는다', () => {
    // 100m는 필요한 폭이 약 144m지만 800m로 둔다 — §25 Q4 "두 배 이하"의 예외 (§26 승인)
    const from = { lat: 35.0, lng: 135.01 };
    const to = east(from, 100);
    const dot = mid(from, to);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), STAY_M)).toBe(true);
    for (const at of [from, dot, to]) expect(inBand(project(region, BOX, at).y, BOX)).toBe(true);
  });

  test('T14_S26_경계_남북으로_조금_긴_구간도_세_곳이_줄어든_띠_안', () => {
    // 남북 200m: 줄어든 띠 60pt에 넣으면 약 1300m (3km 미만) — 핀 전체가 보이게 위·아래 30 안쪽
    const from = { lat: 35.0, lng: 135.01 };
    const to = north(from, 200);
    const dot = mid(from, to);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(spanEW(region)).toBeLessThan(MOVE_CAP_M);
    for (const at of [from, dot, to]) expect(inBand(project(region, BOX, at).y, BOX)).toBe(true);
  });

  test('T14_S24_S25_동서로_긴_구간이면_3km로_묶고_reh_dot은_띠_가운데', () => {
    const from = { lat: 35.0, lng: 135.0 };
    const to = east(from, 6000);
    const dot = east(from, 1500);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, dot);
  });

  test('T14_S24_S25_남북으로_긴_구간도_3km로_묶고_reh_dot은_띠_가운데', () => {
    const from = { lat: 35.0, lng: 135.0 };
    const to = north(from, 5000);
    const dot = north(from, 3500);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, dot);
    expect(Math.abs(aspect(region, BOX) - 1)).toBeLessThanOrEqual(TOL);
  });

  test('T14_S26_경계_남북_500m만_돼도_줄어든_띠_60pt엔_못_넣어_3km로_묶고_reh_dot은_가운데', () => {
    // 500m를 줄어든 띠 60pt에 넣으려면 동서 폭이 약 3250m — 상한을 넘는다 (§26 전에는 36pt 띠에 300m)
    const from = { lat: 35.0, lng: 135.0 };
    const to = north(from, 500);
    const dot = mid(from, to);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], dot, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, dot);
  });

  test('T14_S25_Q5_지금_자리를_모르고_3km를_넘으면_도착할_곳이_띠_가운데', () => {
    const from = { lat: 35.0, lng: 135.0 };
    const to = north(east(from, 2000), 4000);
    const { region } = camera([pin(1, from, 'done'), pin(2, to, 'next')], null, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, to);
  });

  test('T14_S25_Q5_첫_구간_지금_자리를_모르고_3km를_넘으면_1번이_띠_가운데', () => {
    const first = north(LODGING, 5000);
    const { region } = camera([pin(1, first, 'next'), pin(2, east(first, 900), 'later')], null, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, first);
  });

  test('T14_S25_Q5_마지막_구간_지금_자리를_모르고_3km를_넘으면_숙소가_띠_가운데', () => {
    const last = north(LODGING, -5000);
    const { region } = camera([pin(1, east(last, 900), 'done'), pin(2, last, 'done')], null, LODGING, BOX);
    expect(near(spanEW(region), MOVE_CAP_M)).toBe(true);
    atBandCenter(region, BOX, LODGING);
  });

  test('T14_S24_S25_속성_이동_중_폭은_3km_이하·reh_dot은_띠_안·묶이면_가운데', () => {
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
          // 세 곳을 띠에 넣는 데 필요한 폭 (테스트가 따로 셈): 동서는 좌우 60씩 뺀 폭, 남북은 띠 높이에 넣는다
          const need = Math.max((Math.abs(eastM) * BOX.width) / (BOX.width - 2 * MAP_EDGE), (Math.abs(northM) * BOX.width) / (BOX.bottom - BOX.top - 2 * PIN_INSET));
          if (need > MOVE_CAP_M * (1 + TOL)) atBandCenter(region, BOX, dot); // 3km로 묶을 때만 가운데 (§25 Q2)
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

// =====================================================================
// §26 1: 3km로 묶인 구간은 reh-dot이 줄어든 띠를 벗어날 때만 다시 맞춘다
// =====================================================================

describe('§26 1 묶인 구간은 벗어날 때만 다시', () => {
  const from = { lat: 35.0, lng: 135.0 };
  const to = north(from, 5000); // 남북 5km: 3km로 묶인다
  const pins = [pin(1, from, 'done'), pin(2, to, 'next')];
  /** previous 영역에서 화면 y가 target이 되는 위도 (메르카토르 역산) */
  function latAtY(region: Region, box: Box, y: number) {
    const top = merc(region.latitude + region.latitudeDelta / 2);
    const bottom = merc(region.latitude - region.latitudeDelta / 2);
    const m = top - (y / box.height) * (top - bottom);
    return ((2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180) / Math.PI;
  }
  const start = () => camera(pins, north(from, 1000), LODGING, BOX);

  test('T14_S26_1_시험_자체_확인_처음은_3km로_묶이고_reh_dot이_가운데', () => {
    const first = start();
    expect(near(spanEW(first.region), MOVE_CAP_M)).toBe(true);
    atBandCenter(first.region, BOX, north(from, 1000));
  });

  test('T14_S26_1_줄어든_띠_안에서_움직이면_이전_영역_그대로', () => {
    const first = start();
    const inside = { lat: latAtY(first.region, BOX, BOX.top + PIN_INSET + 2), lng: from.lng }; // 줄어든 띠 위 경계 바로 안
    expect(camera(pins, inside, LODGING, BOX, first)).toBe(first);
  });

  test('T14_S26_1_경계_줄어든_띠_아래_경계_바로_안도_그대로', () => {
    const first = start();
    const inside = { lat: latAtY(first.region, BOX, BOX.bottom - PIN_INSET - 2), lng: from.lng };
    expect(camera(pins, inside, LODGING, BOX, first)).toBe(first);
  });

  test.each([
    ['위로', (box: Box) => box.top + PIN_INSET - 2],
    ['아래로', (box: Box) => box.bottom - PIN_INSET + 2],
    ['위 띠 밖 화면 위쪽으로', () => 40],
  ])('T14_S26_1_reh_dot이_줄어든_띠_%s_벗어나면_다시_맞추고_가운데', (_name, yOf) => {
    const first = start();
    const outside = { lat: latAtY(first.region, BOX, yOf(BOX)), lng: from.lng };
    const next = camera(pins, outside, LODGING, BOX, first);
    expect(next).not.toBe(first);
    expect(next.key).toBe(first.key); // 같은 구간
    expect(near(spanEW(next.region), MOVE_CAP_M)).toBe(true);
    atBandCenter(next.region, BOX, outside);
  });

  test('T14_S26_1_reh_dot이_화면_좌우_밖으로_나가면_다시_맞춘다', () => {
    const first = start();
    const far = east(north(from, 1000), 3000); // 3km 폭 화면의 가운데에서 동쪽 3km = 화면 밖
    expect(project(first.region, BOX, far).x).toBeGreaterThan(BOX.width); // 시험 자체 확인
    const next = camera(pins, far, LODGING, BOX, first);
    expect(next).not.toBe(first);
    atBandCenter(next.region, BOX, far);
  });

  test('T14_S26_1_경계_3km_미만_구간은_같은_구간이면_reh_dot이_움직여도_그대로', () => {
    const a = { lat: 35.0, lng: 135.01 };
    const b = east(a, 700);
    const short = [pin(1, a, 'done'), pin(2, b, 'next')];
    const first = camera(short, east(a, 100), LODGING, BOX);
    expect(spanEW(first.region)).toBeLessThan(MOVE_CAP_M); // 시험 자체 확인: 묶이지 않았다
    expect(camera(short, east(a, 600), LODGING, BOX, first)).toBe(first);
  });

  test('T14_S26_1_경계_머무는_중은_같은_구간이면_그대로', () => {
    const place = { lat: 35.02, lng: 134.99 };
    const stay = [pin(1, place, 'now')];
    const first = camera(stay, place, LODGING, BOX);
    expect(camera(stay, north(place, 300), LODGING, BOX, first)).toBe(first);
  });

  test('T14_S26_1_구간이_바뀌면_previous가_있어도_새로_계산', () => {
    const first = start();
    const arrived = camera([pin(1, from, 'done'), pin(2, to, 'now')], to, LODGING, BOX, first);
    expect(arrived).not.toBe(first);
    expect(arrived.key).not.toBe(first.key);
    expect(near(spanEW(arrived.region), STAY_M)).toBe(true);
  });
});
