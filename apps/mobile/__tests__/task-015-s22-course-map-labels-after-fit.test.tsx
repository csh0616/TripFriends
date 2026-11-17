/// <reference types="jest" />
// TASK-015 §22 막는 2 — 크게 보기 이름표는 지도 크기 · 떠 있는 판 크기를 안 뒤, 그리고 경로 맞춤이 끝난 영역을 받은 뒤에만 그린다. 그 전엔 핀만.
// 로직 · 가드레일만 본다 (모습은 보지 않는다). 가짜 지도 위 화면 테스트.
// 근거: TASK-015 §22 막는 2("2곳 데모 이름표가 가끔 SOS 밑, 약 12초 뒤 제자리" -> 규칙: 지도 크기와 떠 있는 판 크기를 모두 안 뒤에만 이름표를 그린다 —
//       그 전엔 핀만(잘못된 자리에 잠깐 보이는 것보다 낫다)) ·
//       승현 11-17 결정(진행 담당 전달): 맞춤이 끝난 뒤의 영역 = fitToCoordinates를 부른 뒤 처음 받은 onRegionChangeComplete. 그 전에 온 영역(첫 영역 0.05 등)으로는 그리지 않는다 ·
//       승현 11-17 추가 지시 A: 카메라가 움직이지 않아 맞춤 뒤 영역 보고가 안 오면 지금 영역으로 그린다(이름표가 영영 안 뜨는 일이 없게) ·
//       frontend 진단(11-17, iPhone 17 402×874, insets 62/34): 크기 · 판은 첫 렌더부터 맞고, 첫 영역(lngΔ 0.05) -> 맞춤 영역 순으로 영역이 두 번 이상 온다 ·
//       §20 #4 · §21(region은 mapPadding을 뺀 보이는 영역을 채운다 — task-015-s20-course-map-visible-area 계약)
//
// 계약 (이 파일이 정한 것):
//   "준비 신호" = 가짜 지도 mapControl.ready() (onMapReady · onMapLoaded). 화면은 이때 fitToCoordinates를 부른다 (mapControl.fits에 남는다 — 시험이 확인)
//   "맞춤 전 영역" = fitToCoordinates가 불리기 전에 온 regionChangeComplete. "맞춤 끝 영역" = 불린 뒤 처음 온 regionChangeComplete
//   이름표 = Marker testID `map-pin-label`. 번호 핀 = Marker testID `map-pin-<seq>` (이름표 규칙과 상관없이 늘 그린다)
//   맞춤 끝 영역을 받으면: 이름표 2개(2곳 데모), 이름표 좌표를 그 영역 · 보이는 영역 기준으로 화면 점으로 바꾸면 겹침 함수가 놓은 자리 가운데,
//     겹침 함수에 넘긴 핀 좌표도 그 영역 기준. 그 뒤 다른 영역이 오면 마지막 영역 기준으로 다시 계산
//   맞춤 끝 영역이 안 올 때(A): fitToCoordinates를 부른 때부터 COURSE_LABEL_FIT_WAIT_MS 미만이면 이름표 0개, 그 시간이 되면 마지막으로 받은 영역으로 그린다
//     영역 보고가 한 번도 없었으면 맞춤이 요청한 목표 영역(fitTargetRegion(맞춤에 넘긴 좌표, 보이는 영역 크기, 맞춤 edgePadding))으로 반드시 그리고,
//     목표 영역이 없으면(null, 예: 경로가 한 점) 처음 영역(MapView initialRegion)으로. 그 뒤 실제 영역이 오면 그 영역으로 다시 계산 (승현 11-17 보충 ①)
//     (시간 값 = '@/components/now/map-adapter'의 COURSE_LABEL_FIT_WAIT_MS, 1000ms로 시작 — frontend가 재서 바꿀 수 있어 시험은 상수를 읽어 쓴다, 보충 ②)
//   크기를 모름: 안전 영역을 모름(SafeAreaProvider 없음 -> 판 위치를 모름. 안전 영역 위쪽 0은 정상 값이라 기다리지 않고 그린다 — 승현 11-17 보충 ③) 또는 창 크기 폭 · 높이 중 하나라도 0 -> 맞춤 끝 영역이 와도 이름표 0개, 번호 핀은 그대로
//   맞춤 끝 영역 흉내: fitToCoordinates의 edgePadding은 보이는 영역(mapPadding을 뺀 곳) 안쪽 여백으로 보고, 경로 상자가 그 안쪽 끝에 닿는 region을 시험이 계산한다
//   데이터: testdata/demo/seed-two-places.json(2곳 데모) · 숙소 = 데모 중심(35.0, 135.0)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { COURSE_LABEL_FIT_WAIT_MS, type CourseStop } from '@/components/now/map-adapter';
import { CourseMapScreen } from '@/components/planning/course-map-screen';
import { fitTargetRegion, type Region } from '@/lib/map-project';
import { resolvePinOverlap, type PinOverlapInput, type PinOverlapResult, type Rect } from '@/lib/pin-overlap';

import { mapControl } from '../test-support/maps-mock';
import { REPO_ROOT } from '../test-support/source-files';

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
const ROW_TOP = INSET_TOP + 8; // 위 줄 = insets.top + space-2 (진단: 판 y70 h44)
const BUTTON = 44;
const PILL = 36;
const SIDE = 16;
const LABEL_H = 28;
const HOME = { lat: 35.0, lng: 135.0 }; // 데모 숙소 = 데모 중심 (planning/seed.py DEMO_CENTER)

type DemoPlace = { id: string; name: string; lat: number; lng: number };
const TWO_PLACES = (JSON.parse(readFileSync(join(REPO_ROOT, 'testdata', 'demo', 'seed-two-places.json'), 'utf8')) as { places: DemoPlace[] }).places;
const TWO: CourseStop[] = TWO_PLACES.map((p, i) => ({ seq: i + 1, name: p.name, lat: p.lat, lng: p.lng }));

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
type Pad = { top: number; bottom: number; left: number; right: number };
type F = { x: number; y: number; width: number; height: number };
const root = () => screen.root as unknown as Host;

const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/** 시험이 직접 계산하는 화면 점 (region이 보이는 영역 frame을 채운다) */
function toScreen(region: Region, frame: F, at: { latitude: number; longitude: number }) {
  const west = region.longitude - region.longitudeDelta / 2;
  const top = merc(region.latitude + region.latitudeDelta / 2);
  const bottom = merc(region.latitude - region.latitudeDelta / 2);
  return {
    x: frame.x + ((at.longitude - west) / region.longitudeDelta) * frame.width,
    y: frame.y + ((top - merc(at.latitude)) / (top - bottom)) * frame.height,
  };
}

/** 맞춤 끝 영역 흉내: 경로 상자가 보이는 영역 안 edgePadding 안쪽 끝에 닿는 region */
function fitRegion(points: { lat: number; lng: number }[], pad: Pad, frame: F): Region {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const x1 = pad.left / frame.width;
  const x2 = (frame.width - pad.right) / frame.width;
  const longitudeDelta = (Math.max(...lngs) - Math.min(...lngs)) / (x2 - x1);
  const west = Math.min(...lngs) - x1 * longitudeDelta;
  const y1 = pad.top / frame.height;
  const y2 = (frame.height - pad.bottom) / frame.height;
  const top = merc(Math.max(...lats));
  const bottom = merc(Math.min(...lats));
  const mercPer = (top - bottom) / (y2 - y1);
  const north = unmerc(top + y1 * mercPer);
  const south = unmerc(bottom - (1 - y2) * mercPer);
  return { latitude: (north + south) / 2, longitude: west + longitudeDelta / 2, latitudeDelta: north - south, longitudeDelta };
}

let windowSize = { width: WIDTH, height: HEIGHT };

let shownStops: CourseStop[] = TWO;

async function mount({ insetsKnown = true, metrics = METRICS, stops = TWO, home = HOME as typeof HOME | null }: { insetsKnown?: boolean; metrics?: typeof METRICS; stops?: CourseStop[]; home?: typeof HOME | null } = {}) {
  mapControl.silent = true; // 준비 신호는 시험이 직접 준다 (호출 순서를 시험이 정한다)
  shownStops = stops;
  const view = (
    <CourseMapScreen dayNumber={2} labelText="느긋하게" stops={stops} home={home} summary="2곳 · 이동 20분" busy={false} onClose={jest.fn()} onPick={jest.fn()} onFail={jest.fn()} />
  );
  await render(insetsKnown ? <SafeAreaProvider initialMetrics={metrics}>{view}</SafeAreaProvider> : view);
  const map = mapHost();
  expect(map).toBeDefined(); // 시험 자체 확인: 대체 그림이 아니라 지도
  return map;
}

const mapHost = () => root().queryAll((h) => h.props.mapElement === 'MapView' && h.props.testID === 'course-map')[0];

/** 보이는 영역 = 창에서 MapView mapPadding을 뺀 곳 */
function visibleFrame(): F {
  const mp = (mapHost().props.mapPadding ?? {}) as Partial<Pad>;
  const pad: Pad = { top: mp.top ?? 0, bottom: mp.bottom ?? 0, left: mp.left ?? 0, right: mp.right ?? 0 };
  return { x: pad.left, y: pad.top, width: windowSize.width - pad.left - pad.right, height: windowSize.height - pad.top - pad.bottom };
}

async function mapReady() {
  await act(async () => {
    mapControl.ready();
  });
}

async function tellRegion(region: Region) {
  await act(async () => {
    fireEvent(mapHost() as never, 'regionChangeComplete', region);
  });
}

/** 화면이 fitToCoordinates에 넘긴 edgePadding */
function fitPadding(): Pad {
  const fit = mapControl.fits[mapControl.fits.length - 1] as { options?: { edgePadding?: Pad } } | undefined;
  const pad = fit?.options?.edgePadding;
  expect(pad).toBeDefined(); // 시험 자체 확인: 준비 신호 뒤 경로 맞춤을 불렀다
  return pad as Pad;
}

const firstRegion = (): Region => mapHost().props.initialRegion as Region;
const fitEnd = (): Region => fitRegion([HOME, ...TWO], fitPadding(), visibleFrame());

const labelHosts = () => root().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label');
const numberPins = () => root().queryAll((h) => h.props.mapElement === 'Marker' && /^map-pin-\d+$/.test(String(h.props.testID)));

function lastInput(): PinOverlapInput {
  expect(overlap).toHaveBeenCalled();
  return overlap.mock.calls[overlap.mock.calls.length - 1][0] as PinOverlapInput;
}

function lastResult(): PinOverlapResult {
  const results = overlap.mock.results.filter((r) => r.type === 'return');
  expect(results.length).toBeGreaterThan(0);
  return results[results.length - 1].value as PinOverlapResult;
}

const round = (n: number) => Math.round(n * 100) / 100;
const touches = (a: Rect, b: Rect) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** 그린 이름표: Marker 좌표를 region · 보이는 영역 기준 화면 점으로 (anchor CENTER), 폭 = 말풍선 width */
function drawnLabels(region: Region): { name: string; center: { x: number; y: number }; rect: Rect }[] {
  const frame = visibleFrame();
  return labelHosts().map((h) => {
    const center = toScreen(region, frame, h.props.coordinate);
    const styled = h.queryAll((inner) => [inner.props.style].flat().some((s: any) => s && typeof s.width === 'number'))[0];
    const w = [styled?.props.style].flat().find((s: any) => s && typeof s.width === 'number')?.width as number;
    const name = String(h.queryAll((inner) => typeof inner.props.children === 'string')[0]?.props.children ?? '');
    return { name, center: { x: round(center.x), y: round(center.y) }, rect: { x: center.x - w / 2, y: center.y - LABEL_H / 2, width: w, height: LABEL_H } };
  });
}

/** 겹침 함수가 마지막에 놓은 이름표 가운데 (이름별) */
function placedCenters(): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const placed of lastResult().labels ?? []) {
    const stop = shownStops.find((s) => `p${s.seq}` === placed.pinId);
    if (stop?.name) out[stop.name] = { x: round(placed.rect.x + placed.rect.width / 2), y: round(placed.rect.y + placed.rect.height / 2) };
  }
  return out;
}

/** 그린 이름표가 마지막 겹침 결과 · 주어진 region과 맞는가 (이름 -> 가운데) */
function expectLabelsFrom(region: Region) {
  const drawn = drawnLabels(region);
  expect(drawn.map((l) => l.name).sort()).toEqual(shownStops.map((s) => s.name).sort());
  expect(Object.fromEntries(drawn.map((l) => [l.name, l.center]))).toEqual(placedCenters());
  const frame = visibleFrame();
  for (const stop of shownStops) {
    const pin = lastInput().pins.find((p) => p.id === `p${stop.seq}`);
    const at = toScreen(region, frame, { latitude: stop.lat, longitude: stop.lng });
    expect({ id: pin?.id, x: round(pin?.x ?? NaN), y: round(pin?.y ?? NaN) }).toEqual({ id: `p${stop.seq}`, x: round(at.x), y: round(at.y) });
  }
}

const CLOSE: Rect = { x: SIDE, y: ROW_TOP, width: BUTTON, height: BUTTON };
const SOS: Rect = { x: WIDTH - SIDE - BUTTON, y: ROW_TOP, width: BUTTON, height: BUTTON };
const PILL_MID: Rect = { x: WIDTH / 2, y: ROW_TOP + (BUTTON - PILL) / 2, width: 0, height: PILL };

beforeEach(() => {
  mapControl.reset();
  overlap.mockClear();
  windowSize = { width: WIDTH, height: HEIGHT };
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, ...windowSize }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('§22 막는 2 — 맞춤 끝 영역 전엔 핀만', () => {
  test('T15_S22_2_시험_자체_확인_2곳_데모는_장소_2곳이고_이름이_있다', () => {
    expect(TWO).toHaveLength(2);
    for (const stop of TWO) expect(stop.name).toBeTruthy();
  });

  test('T15_S22_2_처음_그린_직후(영역_없음)_이름표_0개_번호_핀은_2개', async () => {
    await mount();
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_준비_신호_전에_첫_영역(0.05)이_와도_이름표_0개_번호_핀은_2개', async () => {
    await mount();
    expect(firstRegion().longitudeDelta).toBe(0.05); // 시험 자체 확인: 진단의 첫 영역
    await tellRegion(firstRegion());
    expect(mapControl.fits).toHaveLength(0); // 시험 자체 확인: 아직 맞춤 전
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_경계_맞춤_전_영역을_받고_준비_신호(맞춤)가_와도_맞춤_끝_영역_전이면_이름표_0개', async () => {
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    expect(mapControl.fits).toHaveLength(1); // 시험 자체 확인: 맞춤을 불렀다
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_경계_준비_신호_전에_온_영역이_여러_개여도_이름표_0개', async () => {
    await mount();
    await tellRegion(firstRegion());
    await tellRegion({ ...firstRegion(), latitudeDelta: 0.02, longitudeDelta: 0.02 }); // 맞춤 전에 움직인 중간 영역
    expect(labelHosts()).toHaveLength(0);
  });
});

describe('§22 막는 2 — 맞춤 끝 영역을 받은 뒤', () => {
  test('T15_S22_2_맞춤_뒤_첫_영역이_오면_이름표_2개이고_좌표는_그_영역_기준', async () => {
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    const region = fitEnd();
    await tellRegion(region);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(region);
  });

  test('T15_S22_2_맞춤_끝_영역으로_그린_이름표는_위_줄(닫기·SOS·제목_알약)과_넘긴_판에_닿지_않는다', async () => {
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    const region = fitEnd();
    await tellRegion(region);
    const panels = lastInput().panels ?? [];
    const drawn = drawnLabels(region);
    expect(drawn).toHaveLength(2);
    for (const { name, rect } of drawn) {
      const hits = [
        ...panels.filter((panel) => touches(rect, panel)).map(() => '넘긴 판'),
        ...([['닫기', CLOSE], ['SOS', SOS], ['제목 알약', PILL_MID]] as const).filter(([, el]) => touches(rect, el)).map(([part]) => part),
      ];
      expect({ name, hits }).toEqual({ name, hits: [] });
    }
  });

  test('T15_S22_2_맞춤_끝_영역_다음에_다른_영역이_오면_이름표_좌표를_마지막_영역_기준으로_다시_계산', async () => {
    await mount();
    await mapReady();
    const fitted = fitEnd();
    await tellRegion(fitted);
    const before = drawnLabels(fitted).map((l) => l.center);
    const moved: Region = { ...fitted, latitude: fitted.latitude + fitted.latitudeDelta * 0.1, latitudeDelta: fitted.latitudeDelta * 1.5, longitudeDelta: fitted.longitudeDelta * 1.5 };
    await tellRegion(moved);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(moved);
    expect(labelHosts().map((h) => h.props.coordinate)).not.toEqual(before); // 시험 자체 확인: 좌표가 실제로 바뀌었다
  });
});

describe('§22 막는 2 (A) — 맞춤 끝 영역 보고가 안 오면(카메라가 안 움직임) 기다린 뒤 마지막 영역으로', () => {
  test('T15_S22_2_A_기다림_시간은_0보다_큰_유한한_값', () => {
    expect(Number.isFinite(COURSE_LABEL_FIT_WAIT_MS)).toBe(true);
    expect(COURSE_LABEL_FIT_WAIT_MS).toBeGreaterThan(0);
  });

  test('T15_S22_2_A_경계_맞춤_뒤_기다림_시간_1ms_전까지_영역_보고가_없으면_이름표_0개', async () => {
    jest.useFakeTimers();
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_A_경계_맞춤_뒤_기다림_시간이_되면_마지막으로_받은_영역으로_이름표_2개', async () => {
    jest.useFakeTimers();
    await mount();
    const last = firstRegion();
    await tellRegion(last);
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(last);
  });

  test('T15_S22_2_A_기다림_시간_전에_맞춤_끝_영역이_오면_바로_그리고_시간이_지나도_그_영역_그대로', async () => {
    jest.useFakeTimers();
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    const fitted = fitEnd();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.floor(COURSE_LABEL_FIT_WAIT_MS / 2));
    });
    await tellRegion(fitted);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(fitted);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS * 2);
    });
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(fitted); // 기다림이 끝나도 맞춤 전 영역으로 되돌아가지 않는다
  });

  test('T15_S22_2_A_기다림_뒤_늦게_맞춤_끝_영역이_오면_그_영역으로_다시_계산', async () => {
    jest.useFakeTimers();
    await mount();
    await tellRegion(firstRegion());
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    const fitted = fitEnd();
    await tellRegion(fitted);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(fitted);
  });
});

/** 화면이 맞춤에 넘긴 좌표 · edgePadding으로 계산한 목표 영역 (보이는 영역 크기 기준) */
function targetRegion(): Region | null {
  const fit = mapControl.fits[mapControl.fits.length - 1];
  expect(fit).toBeDefined(); // 시험 자체 확인: 맞춤을 불렀다
  const frame = visibleFrame();
  return fitTargetRegion(fit.coordinates, { width: frame.width, height: frame.height }, fit.options?.edgePadding as never);
}

describe('§22 막는 2 (A ①) — 영역 보고가 한 번도 없이 기다림이 끝나면 목표 영역(없으면 initialRegion)으로', () => {
  test('T15_S22_2_A1_경계_영역_보고_없이_기다림_시간_1ms_전이면_이름표_0개', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    expect(mapControl.fits).toHaveLength(1); // 시험 자체 확인: 맞춤을 불렀다
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_A1_경계_영역_보고_없이_기다림_시간이_되면_반드시_목표_영역_기준으로_이름표_2개', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    const target = targetRegion();
    expect(target).not.toBeNull(); // 시험 자체 확인: 2곳 + 숙소 경로는 목표 영역이 있다
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(target as Region);
  });

  test('T15_S22_2_A1_목표_영역이_없으면(경로가_한_점)_기다림_시간이_되면_처음_영역(initialRegion)_기준으로_이름표_1개', async () => {
    jest.useFakeTimers();
    const one: CourseStop[] = [TWO[0]];
    await mount({ stops: one, home: null });
    await mapReady();
    expect(targetRegion()).toBeNull(); // 시험 자체 확인: 한 점 경로는 목표 영역이 없다
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expect(labelHosts()).toHaveLength(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(labelHosts()).toHaveLength(1);
    expectLabelsFrom(firstRegion());
  });

  test('T15_S22_2_A1_처음_영역으로_그린_뒤_늦게_실제_영역이_오면_그_영역으로_다시_계산', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    const before = labelHosts().map((h) => h.props.coordinate);
    const fitted = fitEnd();
    await tellRegion(fitted);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(fitted);
    expect(labelHosts().map((h) => h.props.coordinate)).not.toEqual(before); // 시험 자체 확인: 좌표가 실제로 바뀌었다
  });
});

describe('§22 막는 2 — 지도 크기 · 떠 있는 판 크기를 모르면 이름표 0개', () => {
  test('T15_S22_2_안전_영역을_모르면(SafeAreaProvider_없음)_맞춤_끝_영역이_와도_이름표_0개_번호_핀은_2개', async () => {
    await mount({ insetsKnown: false });
    await mapReady();
    await tellRegion(fitEnd());
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test.each([
    ['폭·높이_0', 0, 0],
    ['폭만_0', 0, HEIGHT],
    ['높이만_0', WIDTH, 0],
  ])('T15_S22_2_창_크기_%s이면_맞춤_끝_영역이_와도_이름표_0개_번호_핀은_2개', async (_name, width, height) => {
    windowSize = { width, height };
    await mount();
    await mapReady();
    await tellRegion({ latitude: 35.0, longitude: 135.0, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_경계_안전_영역_위쪽_0은_정상_값이라_맞춤_끝_영역을_받으면_기다리지_않고_바로_이름표_2개', async () => {
    jest.useFakeTimers(); // 시간을 밀지 않는다 = 기다림 없이
    await mount({ metrics: { ...METRICS, insets: { ...METRICS.insets, top: 0 } } });
    await mapReady();
    const region = fitEnd();
    await tellRegion(region);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(region);
  });

  test('T15_S22_2_경계_안전_영역을_알고_창_크기도_있으면_같은_순서로_이름표_2개(위_두_시험의_짝)', async () => {
    await mount();
    await mapReady();
    await tellRegion(fitEnd());
    expect(labelHosts()).toHaveLength(2);
  });
});
