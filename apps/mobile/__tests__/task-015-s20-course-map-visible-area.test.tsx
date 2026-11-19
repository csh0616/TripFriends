/// <reference types="jest" />
// TASK-015 §20 #4 코스 크게 보기: 핀 화면 좌표를 "mapPadding을 뺀 보이는 영역" 기준으로 계산해 겹침 함수에 넘기고, 이름표를 그 기준으로 되돌려 그린다.
// 로직·가드레일만 본다 (모습은 보지 않는다). 가짜 지도 위 화면 테스트.
// 근거: TASK-015 §20 표 #4(크게 보기에서 떠 있는 판 검사가 안 먹음, §B6 · §18 Q3) · §B6(겹침 함수 입력 = 핀 화면 좌표) ·
//       승현이 받아들인 frontend 시뮬레이터 진단(11-17, iPhone 17 402×874): 지도 크기 402×874, mapPadding.bottom 202, 아래 시트 판 y 672~874.
//       onRegionChangeComplete의 region은 mapPadding을 뺀 보이는 영역(세로 672) -> 보이는 영역 가운데 y = 336인데 화면은 437로 계산해
//       이름표가 실제 핀보다 위로 밀려 SOS · 제목 알약 밑에 깔림. 고치는 방향: 좌표 계산 크기 = mapPadding을 뺀 보이는 영역(위 여백이 있으면 원점도).
//
// 계약 (이 파일이 정한 것):
//   보이는 영역 F = { x: mapPadding.left, y: mapPadding.top, width: 화면 폭 − left − right, height: 화면 높이 − top − bottom }
//     (mapPadding은 화면이 MapView에 넘긴 값 그대로 읽는다. 값 자체는 이 파일이 정하지 않는다)
//   가짜 지도가 regionChangeComplete로 F를 채우는 region을 알려 주면:
//     겹침 함수(resolvePinOverlap) input.pins의 x · y = F 기준으로 계산한 화면 좌표(화면 왼쪽 위 0,0 — 떠 있는 판과 같은 좌표계)
//     그린 이름표(`map-pin-label` Marker 좌표)를 F 기준으로 다시 화면 점으로 바꾸면 겹침 함수가 놓은 이름표 사각형 가운데와 같다
//     그렇게 그린 이름표는 넘긴 떠 있는 판 · 닫기 · SOS · 제목 알약 · 아래 시트와 4 넘게 떨어진다 (TASK-015 §24: 판 여유 0 -> 4)
//   region 흉내: fitToCoordinates(경로, edgePadding = 화면이 넘긴 값)가 경로 상자를 화면 위 edgePadding 안쪽 끝에 놓는다고 보고,
//     그 화면 자리가 그대로 보이도록 F를 채우는 region을 계산한다 (가짜 지도는 바꾸지 않고 시험이 region을 넣는다)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CourseMapScreen } from '@/components/planning/course-map-screen';
import type { CourseStop } from '@/components/now/map-adapter';
import type { Region } from '@/lib/map-project';
import { resolvePinOverlap, type PinOverlapInput, type PinOverlapResult, type Rect } from '@/lib/pin-overlap';

import { mapControl } from '../test-support/maps-mock';

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

// iPhone 17 (frontend 진단)
const WIDTH = 402;
const HEIGHT = 874;
const INSET_TOP = 62;
const INSET_BOTTOM = 34;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, insets: { top: INSET_TOP, left: 0, right: 0, bottom: INSET_BOTTOM } };
const ROW_TOP = INSET_TOP + 8;
const BUTTON = 44;
const PILL = 36;
const SIDE = 16;
const SHEET_TOP = HEIGHT - (134 + INSET_BOTTOM); // 706 — §24: course-bar 168은 아래 안전영역 34 포함 (옛 진단 672 = 874 − 202)
const LABEL_H = 28;
const HOME = { lat: 35.0, lng: 135.0 };

// demo_city.json (데모 도시, 지어낸 값) — task-015-s20-course-map-panels와 같은 4곳 · 5곳
const D03 = { name: '정원 카페 C', lat: 35.00772, lng: 135.01229 };
const D14 = { name: '미술관 B', lat: 34.99752, lng: 135.00431 };
const D22 = { name: '향초 교실 B', lat: 34.99306, lng: 135.00589 };
const D17 = { name: '잡화점 A', lat: 34.98571, lng: 135.00072 };
const D05 = { name: '국수집 A', lat: 35.01632, lng: 134.98733 };
const D24 = { name: '염색 공방 D', lat: 35.00751, lng: 135.016 };
const D20 = { name: '소품 가게 D', lat: 34.98444, lng: 134.97724 };
const D09 = { name: '강변 산책로 A', lat: 34.99061, lng: 135.00473 };
const D28 = { name: '야시장 A', lat: 34.99799, lng: 134.99318 };

const FOUR: CourseStop[] = [D14, D22, D17, D03].map((p, i) => ({ seq: i + 1, ...p }));
const FIVE: CourseStop[] = [D05, D24, D09, D20, D28].map((p, i) => ({ seq: i + 1, ...p }));

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
type Pad = { top: number; bottom: number; left: number; right: number };
type F = { x: number; y: number; width: number; height: number };
const root = () => screen.root as unknown as Host;

const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** 시험이 직접 계산하는 화면 점 (region이 frame을 채운다) */
function toScreen(region: Region, frame: F, at: { latitude: number; longitude: number }) {
  const west = region.longitude - region.longitudeDelta / 2;
  const top = merc(region.latitude + region.latitudeDelta / 2);
  const bottom = merc(region.latitude - region.latitudeDelta / 2);
  return {
    x: frame.x + ((at.longitude - west) / region.longitudeDelta) * frame.width,
    y: frame.y + ((top - merc(at.latitude)) / (top - bottom)) * frame.height,
  };
}

/** 경로 상자가 화면 위 edgePadding 안쪽 끝에 놓이도록, frame을 채우는 region */
function fitRegion(points: { lat: number; lng: number }[], pad: Pad, frame: F): Region {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const x1 = (pad.left - frame.x) / frame.width;
  const x2 = (WIDTH - pad.right - frame.x) / frame.width;
  const lngPer = (Math.max(...lngs) - Math.min(...lngs)) / (x2 - x1);
  const west = Math.min(...lngs) - x1 * lngPer;
  const longitudeDelta = lngPer;
  const y1 = (pad.top - frame.y) / frame.height;
  const y2 = (HEIGHT - pad.bottom - frame.y) / frame.height;
  const top = merc(Math.max(...lats));
  const bottom = merc(Math.min(...lats));
  const mercPer = (top - bottom) / (y2 - y1);
  const north = unmerc(top + y1 * mercPer);
  const south = unmerc(bottom - (1 - y2) * mercPer);
  return { latitude: (north + south) / 2, longitude: west + longitudeDelta / 2, latitudeDelta: north - south, longitudeDelta };
}

async function mount(stops: CourseStop[]) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CourseMapScreen dayNumber={2} labelText="느긋하게" stops={stops} home={HOME} summary={`${stops.length}곳 · 이동 45분`} busy={false} onClose={jest.fn()} onPick={jest.fn()} onFail={jest.fn()} />
    </SafeAreaProvider>,
  );
  const map = root().queryAll((h) => h.props.mapElement === 'MapView' && h.props.testID === 'course-map')[0];
  expect(map).toBeDefined(); // 시험 자체 확인: 대체 그림이 아니라 지도
  await act(async () => {
    fireEvent(map as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: HEIGHT } } });
    mapControl.ready(); // 준비 신호 -> 화면이 경로 맞춤(fitToCoordinates)을 부른다
  });
  const mp = (map.props.mapPadding ?? {}) as Partial<Pad>;
  const pad: Pad = { top: mp.top ?? 0, bottom: mp.bottom ?? 0, left: mp.left ?? 0, right: mp.right ?? 0 };
  const frame: F = { x: pad.left, y: pad.top, width: WIDTH - pad.left - pad.right, height: HEIGHT - pad.top - pad.bottom };
  return { map, frame, mapPadding: pad };
}

async function tellRegion(map: Host, region: Region) {
  await act(async () => {
    fireEvent(map as never, 'regionChangeComplete', region);
  });
}

/** 화면이 fitToCoordinates에 넘긴 edgePadding */
function fitPadding(): Pad {
  const fit = mapControl.fits[mapControl.fits.length - 1] as { options?: { edgePadding?: Pad } } | undefined;
  const pad = fit?.options?.edgePadding;
  expect(pad).toBeDefined(); // 시험 자체 확인: 지도 준비 뒤 경로 맞춤을 불렀다
  return pad as Pad;
}

function lastInput(): PinOverlapInput {
  expect(overlap).toHaveBeenCalled();
  return overlap.mock.calls[overlap.mock.calls.length - 1][0] as PinOverlapInput;
}

function lastResult(): PinOverlapResult {
  const results = overlap.mock.results.filter((r) => r.type === 'return');
  expect(results.length).toBeGreaterThan(0);
  return results[results.length - 1].value as PinOverlapResult;
}

/** §24: 판 여유 4 — 두 사각형 사이 거리가 4 이하면 겹침과 같다 (옛 여유 0: 닿으면 겹침) */
const near = (a: Rect, b: Rect) => Math.hypot(Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0), Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0)) <= 4;

/** 그린 이름표: Marker 좌표를 보이는 영역 기준으로 화면 점으로 (anchor CENTER), 폭 = 말풍선 width */
function drawnLabels(region: Region, frame: F): { name: string; center: { x: number; y: number }; rect: Rect }[] {
  return root()
    .queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label')
    .map((h) => {
      const center = toScreen(region, frame, h.props.coordinate);
      const styled = h.queryAll((inner) => [inner.props.style].flat().some((s: any) => s && typeof s.width === 'number'))[0];
      const w = [styled?.props.style].flat().find((s: any) => s && typeof s.width === 'number')?.width as number;
      const name = String(h.queryAll((inner) => typeof inner.props.children === 'string')[0]?.props.children ?? '');
      return { name, center, rect: { x: center.x - w / 2, y: center.y - LABEL_H / 2, width: w, height: LABEL_H } };
    });
}

const CLOSE: Rect = { x: SIDE, y: ROW_TOP, width: BUTTON, height: BUTTON };
const SOS: Rect = { x: WIDTH - SIDE - BUTTON, y: ROW_TOP, width: BUTTON, height: BUTTON };
const PILL_MID: Rect = { x: WIDTH / 2, y: ROW_TOP + (BUTTON - PILL) / 2, width: 0, height: PILL };
const SHEET: Rect = { x: 0, y: SHEET_TOP, width: WIDTH, height: HEIGHT - SHEET_TOP };

beforeEach(() => {
  mapControl.reset();
  overlap.mockClear();
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: WIDTH, height: HEIGHT }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('§20 #4 핀 화면 좌표 = 보이는 영역 기준', () => {
  test('T15_S20_4_시험_자체_확인_크게_보기는_아래_mapPadding이_있다(0이면_이_파일이_아무것도_못_잡음)', async () => {
    const { mapPadding, frame } = await mount(FOUR);
    expect(mapPadding.bottom).toBeGreaterThan(0);
    expect(frame.height).toBeLessThan(HEIGHT);
  });

  test('T15_S20_4_region_가운데_좌표의_핀은_보이는_영역_가운데(y_=_mapPadding.top_+_보이는_높이/2)', async () => {
    const { map, frame } = await mount(FOUR);
    // 1번 핀(미술관 B)을 가운데에 둔 region
    await tellRegion(map, { latitude: D14.lat, longitude: D14.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 });
    const pin = lastInput().pins.find((p) => p.id === 'p1');
    expect(pin).toBeDefined();
    expect(pin!.x).toBeCloseTo(frame.x + frame.width / 2, 3);
    expect(pin!.y).toBeCloseTo(frame.y + frame.height / 2, 0); // 진단 사례: 336 (화면 전체로 계산하면 437)
  });

  test.each<[string, (r: Region) => { latitude: number; longitude: number }, 'x' | 'y', (f: F) => number]>([
    ['북쪽_끝_핀은_y_=_보이는_영역_위(mapPadding.top)', (r) => ({ latitude: r.latitude + r.latitudeDelta / 2, longitude: r.longitude }), 'y', (f) => f.y],
    ['남쪽_끝_핀은_y_=_보이는_영역_아래(화면_높이_−_mapPadding.bottom)', (r) => ({ latitude: r.latitude - r.latitudeDelta / 2, longitude: r.longitude }), 'y', (f) => f.y + f.height],
    ['서쪽_끝_핀은_x_=_mapPadding.left', (r) => ({ latitude: r.latitude, longitude: r.longitude - r.longitudeDelta / 2 }), 'x', (f) => f.x],
    ['동쪽_끝_핀은_x_=_화면_폭_−_mapPadding.right', (r) => ({ latitude: r.latitude, longitude: r.longitude + r.longitudeDelta / 2 }), 'x', (f) => f.x + f.width],
  ])('T15_S20_4_경계_%s', async (_name, edge, axis, expected) => {
    const base: Region = { latitude: 35.0, longitude: 135.0, latitudeDelta: 0.03, longitudeDelta: 0.03 };
    const at = edge(base);
    const stops: CourseStop[] = [{ seq: 1, name: '끝 핀', lat: at.latitude, lng: at.longitude }];
    const { map, frame } = await mount(stops);
    await tellRegion(map, base);
    const pin = lastInput().pins.find((p) => p.id === 'p1');
    expect(pin![axis]).toBeCloseTo(expected(frame), 3);
  });

  test('T15_S20_4_숙소_핀도_같은_기준(region_가운데_숙소는_보이는_영역_가운데)', async () => {
    const { map, frame } = await mount(FOUR);
    await tellRegion(map, { latitude: HOME.lat, longitude: HOME.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 });
    const home = lastInput().pins.find((p) => p.id === 'home');
    expect(home).toBeDefined();
    expect(home!.x).toBeCloseTo(frame.x + frame.width / 2, 3);
    expect(home!.y).toBeCloseTo(frame.y + frame.height / 2, 0);
  });
});

describe('§20 #4 이름표: 겹침 함수가 놓은 자리에 그대로 그려지고 떠 있는 판과 닿지 않는다', () => {
  test.each([
    ['4곳_정원_카페_C', FOUR],
    ['5곳_국수집_A', FIVE],
  ] as const)('T15_S20_4_%s_그린_이름표_가운데_=_겹침_함수가_놓은_이름표_가운데(보이는_영역_기준)', async (_name, stops) => {
    const { map, frame } = await mount(stops);
    const region = fitRegion([HOME, ...stops], fitPadding(), frame);
    await tellRegion(map, region);
    const placed = lastResult().labels ?? [];
    const drawn = drawnLabels(region, frame);
    expect(drawn.length).toBeGreaterThanOrEqual(1); // 시험 자체 확인
    for (const label of drawn) {
      const stop = stops.find((s) => s.name === label.name)!;
      const rect = placed.find((p) => p.pinId === `p${stop.seq}`)!.rect;
      expect({ name: label.name, x: Math.round(label.center.x * 100) / 100, y: Math.round(label.center.y * 100) / 100 }).toEqual({
        name: label.name,
        x: Math.round((rect.x + rect.width / 2) * 100) / 100,
        y: Math.round((rect.y + rect.height / 2) * 100) / 100,
      });
    }
  });

  test.each([
    ['4곳_정원_카페_C', FOUR],
    ['5곳_국수집_A', FIVE],
  ] as const)('T15_S24_%s_그린_이름표가_넘긴_판·닫기·SOS·제목_알약·아래_시트와_4_넘게_떨어진다', async (_name, stops) => {
    const { map, frame } = await mount(stops);
    const region = fitRegion([HOME, ...stops], fitPadding(), frame);
    await tellRegion(map, region);
    const panels = lastInput().panels ?? [];
    const drawn = drawnLabels(region, frame);
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    for (const { name, rect } of drawn) {
      const hits = [
        ...panels.filter((panel) => near(rect, panel)).map(() => '넘긴 판'),
        ...([['닫기', CLOSE], ['SOS', SOS], ['제목 알약', PILL_MID], ['아래 시트', SHEET]] as const).filter(([, el]) => near(rect, el)).map(([part]) => part),
      ];
      expect({ name, hits }).toEqual({ name, hits: [] });
    }
  });
});
