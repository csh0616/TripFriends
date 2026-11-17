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
//   맞춤 끝 영역이 안 올 때(A, 승현 11-17 최종): fitToCoordinates를 부른 때부터 COURSE_LABEL_FIT_WAIT_MS 미만이면 이름표 0개, 그 시간이 되면 반드시 그린다.
//     기준 순서 = 맞춤이 요청한 목표 영역(fitTargetRegion(맞춤에 넘긴 좌표, 보이는 영역 크기, 맞춤 edgePadding)) -> (없으면) 마지막 받은 영역 -> (없으면) initialRegion.
//     맞춤 "전"에 받은 영역은 이름표 계산에 쓰지 않는다 -> "마지막 받은 영역"은 맞춤 뒤 영역뿐인데, 그게 오면 이미 바로 그리므로 기다림이 끝나는 경우엔 없다.
//     그래서 목표 영역이 없고(null, 예: 경로가 한 점) 맞춤 전 영역만 받았으면 initialRegion으로 그린다 (시험 T15_S22_2_A1_목표_영역이_없고_맞춤_전_영역만…).
//     그 뒤 맞춤 뒤 실제 영역이 늦게 오면 그 영역으로 다시 계산
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
import { fitTargetRegion, metersPerPoint, scaleBar, type Region } from '@/lib/map-project';
import { resolvePinOverlap, type PinOverlapInput, type PinOverlapResult, type Rect } from '@/lib/pin-overlap';
import { sameRegionOnScreen, shownRegion } from '@/lib/region-match';

import { mapControl } from '../test-support/maps-mock';
import { REPO_ROOT } from '../test-support/source-files';

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

// 진짜 판정 함수를 그대로 쓰되 받은 크기를 기록한다 (승현 11-17: 보여 주는 모양 · 같은 영역 판정은 화면 전체가 아니라 보이는 지도 영역 크기로)
jest.mock('@/lib/region-match', () => {
  const actual = jest.requireActual('@/lib/region-match');
  return { __esModule: true, ...actual, shownRegion: jest.fn(actual.shownRegion), sameRegionOnScreen: jest.fn(actual.sameRegionOnScreen) };
});

const shownSpy = shownRegion as unknown as jest.Mock;
const sameSpy = sameRegionOnScreen as unknown as jest.Mock;

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
  shownSpy.mockClear();
  sameSpy.mockClear();
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

describe('§22 막는 2 (A) — 맞춤 끝 영역 보고가 안 오면(카메라가 안 움직임) 기다린 뒤 목표 영역으로 (맞춤 전 영역은 안 씀)', () => {
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

  test('T15_S22_2_A_경계_맞춤_전_영역(0.05)만_받고_기다림_시간이_되면_맞춤_전_영역이_아니라_목표_영역_기준으로_이름표_2개', async () => {
    jest.useFakeTimers();
    await mount();
    await tellRegion(firstRegion()); // 맞춤 전 영역 — 이름표 계산에 쓰지 않는다
    await mapReady();
    const target = targetRegion();
    expect(target).not.toBeNull(); // 시험 자체 확인
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(target as Region);
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

  test('T15_S22_2_A1_목표_영역이_없고_맞춤_전_영역만_받았으면_맞춤_전_영역이_아니라_initialRegion_기준으로_이름표_1개', async () => {
    jest.useFakeTimers();
    const one: CourseStop[] = [TWO[0]];
    await mount({ stops: one, home: null });
    const beforeFit: Region = { ...firstRegion(), latitudeDelta: 0.02, longitudeDelta: 0.02 }; // initialRegion과 다른 맞춤 전 영역
    await tellRegion(beforeFit);
    await mapReady();
    expect(targetRegion()).toBeNull(); // 시험 자체 확인: 한 점 경로는 목표 영역이 없다
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
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
    // 늦게 온 실제 영역은 목표 영역과 다른 값(움직인 영역)으로 넣는다: 2곳 데모는 목표 영역과 fitEnd()가 같은 이름표 자리를 줘서 "바뀌었다"를 볼 수 없다
    const target = targetRegion() as Region;
    const late: Region = { ...target, latitude: target.latitude + target.latitudeDelta * 0.1, latitudeDelta: target.latitudeDelta * 1.5, longitudeDelta: target.longitudeDelta * 1.5 };
    await tellRegion(late);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(late);
    expect(labelHosts().map((h) => h.props.coordinate)).not.toEqual(before); // 시험 자체 확인: 좌표가 실제로 바뀌었다
  });
});

// ---------- 맞춤 뒤 initialRegion과 같은 알림 거르기 (승현 11-17, 시뮬레이터 8번 중 2번) ----------
// "같은 영역" (승현 11-17, 판정 함수 계약: __tests__/task-015-s22-region-match.test.ts): 보이는 영역 화면에서 가운데와 네 모서리가 각각 0.5pt 이내(정각 포함).
//   비교 기준 = 지도가 initialRegion을 실제로 보여 주는 모양(shownRegion: 가운데 · 경도 폭 그대로, 위도 폭은 한 배율로 넓어짐 — 세로로 긴 화면).
//   initialRegion 값(0.05 × 0.05) 그대로와 네 모서리를 비교하면 위도 폭이 달라 늘 "다름"이 된다 (질문으로 올림)

/** 도 단위 가운데 lat에서 위 · 아래로 같은 도만큼 넓혀 메르카토르 세로 폭이 span이 되는 위도 폭 (반으로 나눠 찾기) */
function latDeltaFor(lat: number, span: number): number {
  let lo = 0;
  let hi = 2 * (90 - Math.abs(lat)) - 1e-9;
  for (let i = 0; i < 200; i += 1) {
    const d = (lo + hi) / 2;
    if (merc(lat + d / 2) - merc(lat - d / 2) < span) lo = d;
    else hi = d;
  }
  return (lo + hi) / 2;
}

/** 시험 쪽 "보여 주는 모양": 도 단위 가운데 그대로 · 작은 축척 한 배율 · 남는 축만 넓힘 (task-015-s22-region-match와 같은 계산) */
function shownOracle(r: Region, size: { width: number; height: number }): Region {
  const lngRad = rad(r.longitudeDelta);
  const mercSpan = merc(r.latitude + r.latitudeDelta / 2) - merc(r.latitude - r.latitudeDelta / 2);
  const scale = Math.min(size.width / lngRad, size.height / mercSpan);
  return { latitude: r.latitude, longitude: r.longitude, latitudeDelta: latDeltaFor(r.latitude, size.height / scale), longitudeDelta: ((size.width / scale) * 180) / Math.PI };
}

/** 지도가 보여 주는 처음 영역 (보이는 지도 영역 크기로) */
function shownInitial(): Region {
  const frame = visibleFrame();
  return shownOracle(firstRegion(), { width: frame.width, height: frame.height });
}

/** 맞춤 뒤 먼저 오는 처음 영역 알림: frontend 시뮬레이터 실제 측정 차(가운데 위도 3.35e-6도, 경도 폭 상대 5.4e-6) */
const reportedInitial = (): Region => {
  const shown = shownInitial();
  return { ...shown, latitude: shown.latitude + 3.35e-6, longitudeDelta: shown.longitudeDelta * (1 + 5.4e-6) };
};

/** 시험 쪽 판정: base 화면에서 other의 가운데 · 네 모서리가 각각 몇 pt 떨어졌나 (가장 큰 값) */
function screenGap(base: Region, other: Region): number {
  const frame = visibleFrame();
  const size = { width: frame.width, height: frame.height };
  const points = (r: Region) => [
    { latitude: r.latitude, longitude: r.longitude },
    ...[-1, 1].flatMap((a) => [-1, 1].map((b) => ({ latitude: r.latitude + (a * r.latitudeDelta) / 2, longitude: r.longitude + (b * r.longitudeDelta) / 2 }))),
  ];
  const mine = points(base).map((p) => toScreen(base, { x: 0, y: 0, ...size }, p));
  const theirs = points(other).map((p) => toScreen(base, { x: 0, y: 0, ...size }, p));
  return Math.max(...mine.map((m, i) => Math.hypot(m.x - theirs[i].x, m.y - theirs[i].y)));
}

/** base 화면에서 가로로 dx pt 옮긴 영역 */
function shiftedX(base: Region, dx: number): Region {
  return { ...base, longitude: base.longitude + (dx * base.longitudeDelta) / visibleFrame().width };
}

async function remount(options: Parameters<typeof mount>[0]) {
  await screen.unmount();
  mapControl.reset();
  overlap.mockClear();
  return mount(options);
}

/** frontend 시뮬레이터 실측 알림(11-17, 16번 중 3번 같은 값, 보이는 영역 402×672) */
const MEASURED_ALERT: Region = { latitude: 34.99999664825308, longitude: 135, latitudeDelta: 0.06846607929220738, longitudeDelta: 0.04999972879886627 };

describe('§22 막는 2 — 맞춤 뒤에 온 initialRegion과 같은 알림은 이름표 계산에 쓰지 않는다 (목표가 다를 때)', () => {
  test('T15_S22_2_F_실측_알림_값(402×672)이_맞춤_뒤에_먼저_와도_이름표_0개', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    expect(visibleFrame()).toEqual({ x: 0, y: 0, width: 402, height: 672 }); // 시험 자체 확인: 실측과 같은 보이는 영역
    expect(firstRegion()).toMatchObject({ latitude: 35.0, longitude: 135.0 }); // 시험 자체 확인: 실측과 같은 처음 영역
    await tellRegion(MEASURED_ALERT);
    expect(labelHosts()).toHaveLength(0);
  });

  test('T15_S22_2_F_보여_주는_모양·같은_영역_판정에_넘기는_크기는_화면_전체가_아니라_보이는_지도_영역', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    const frame = visibleFrame();
    expect(frame.height).toBeLessThan(HEIGHT); // 시험 자체 확인: 화면 전체와 다르다
    const want = { width: frame.width, height: frame.height };
    expect(shownSpy).toHaveBeenCalled();
    expect(sameSpy).toHaveBeenCalled();
    for (const call of shownSpy.mock.calls) expect({ width: call[1]?.width, height: call[1]?.height }).toEqual(want);
    for (const call of sameSpy.mock.calls) expect({ width: call[2]?.width, height: call[2]?.height }).toEqual(want);
  });

  test('T15_S22_2_F_목표가_다를_때_맞춤_뒤_initialRegion과_같은_알림이_먼저_와도_이름표_0개', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S22_2_F_목표가_다를_때_같은_알림_뒤_50ms에_실제_맞춤_영역이_오면_그_영역으로_이름표_2개', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    const fitted = fitEnd();
    await tellRegion(fitted);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(fitted);
  });

  test('T15_S22_2_F_목표가_다를_때_거른_알림만_오고_기다림_시간이_되면_목표_영역_기준', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expect(labelHosts()).toHaveLength(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(targetRegion() as Region);
  });

  test('T15_S22_2_F_시험_자체_확인_실제_측정값_알림은_보여_주는_처음_영역과_0.5pt_안(약_0.03pt)', async () => {
    await mount();
    expect(screenGap(shownInitial(), reportedInitial())).toBeLessThan(0.1);
  });

  test.each<[string, (r: Region) => Region]>([
    ['실제_측정값(약_0.03pt)', (r) => r],
    ['가로_0.49pt_더_옮김', (r) => shiftedX(r, 0.49 - 0.03)],
  ])('T15_S22_2_F_경계_0.5pt_안(%s)이면_같은_영역이라_거른다', async (_name, nudge) => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    const region = nudge(reportedInitial());
    expect(screenGap(shownInitial(), region)).toBeLessThanOrEqual(0.5); // 시험 자체 확인
    await tellRegion(region);
    expect(labelHosts()).toHaveLength(0);
  });

  test.each<[string, (r: Region) => Region]>([
    ['가로_0.51pt_옮김', (r) => shiftedX(r, 0.51)],
    ['가운데_같고_경도_폭만_1%_넓음(모서리_약_2pt)', (r) => ({ ...r, longitudeDelta: r.longitudeDelta * 1.01 })],
    ['가운데_같고_두_폭이_진짜_맞춤처럼_좁음(경도_폭_0.0114)', (r) => ({ ...r, latitudeDelta: (r.latitudeDelta * 0.0114) / r.longitudeDelta, longitudeDelta: 0.0114 })],
  ])('T15_S22_2_F_경계_0.5pt_밖(%s)이면_다른_영역이라_바로_그_영역으로_그린다', async (_name, nudge) => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    const region = nudge(shownInitial());
    expect(screenGap(shownInitial(), region)).toBeGreaterThan(0.5); // 시험 자체 확인
    await tellRegion(region);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(region);
  });
});

describe('§22 막는 2 — 맞춤 목표 영역이 initialRegion과 같으면(카메라가 안 움직임) 거르지 않고 바로', () => {
  /**
   * 목표 영역이 initialRegion(숙소 가운데, 경도 폭 0.05)과 같아지는 경로. 경도 폭이 맞춤을 정하게 동서로 한 곳씩 두고,
   * 맞춤 안쪽 칸은 위 · 아래 여백이 달라 칸 가운데가 보이는 영역 가운데보다 (top − bottom)/2 아래에 있으므로, 점 상자 가운데가 그만큼 숙소 아래로 오게 동쪽 곳을 남쪽에 둔다
   */
  async function sameTargetStops(): Promise<CourseStop[]> {
    await mount();
    await mapReady();
    const pad = fitPadding();
    const frame = visibleFrame();
    const half = (0.05 / 2) * ((frame.width - pad.left - pad.right) / frame.width);
    const mercPerPt = rad(0.05) / frame.width; // 한 배율: 가로 축척 = 세로 축척
    let south = unmerc(merc(HOME.lat) - (pad.top - pad.bottom) * mercPerPt);
    // region 가운데 위도(북 · 남 끝의 가운데, 도)가 숙소에 오도록 목표 영역을 보며 남쪽 곳을 조금씩 맞춘다 (점 상자 가운데는 남쪽 끝 이동의 절반만 움직인다)
    for (let i = 0; i < 30; i += 1) {
      const path = [{ latitude: HOME.lat, longitude: HOME.lng }, { latitude: HOME.lat, longitude: HOME.lng - half }, { latitude: south, longitude: HOME.lng + half }, { latitude: HOME.lat, longitude: HOME.lng }];
      const target = fitTargetRegion(path, { width: frame.width, height: frame.height }, pad);
      if (!target) break;
      south -= 2 * (target.latitude - HOME.lat);
    }
    return [
      { seq: 1, name: '서쪽 가게', lat: HOME.lat, lng: HOME.lng - half },
      { seq: 2, name: '동쪽 가게', lat: south, lng: HOME.lng + half },
    ];
  }

  test('T15_S22_2_F_목표가_같을_때_맞춤_뒤_initialRegion과_같은_알림이_오면_기다리지_않고_바로_이름표_2개', async () => {
    jest.useFakeTimers(); // 시간을 밀지 않는다 = 기다림 없이
    const stops = await sameTargetStops();
    await remount({ stops });
    await mapReady();
    const target = targetRegion() as Region;
    // 시험 자체 확인: 목표 영역과 처음 영역을 둘 다 보여 주는 모양으로 맞추면 "같은 영역"(0.5pt)이다.
    // 처음 영역 값(0.05 × 0.05) 그대로와는 위도 폭이 달라 다르다 -> 화면이 그대로 비교하면 알림을 걸러 기다리게 되어 아래 단언이 깨진다
    const frame = visibleFrame();
    expect(screenGap(shownInitial(), shownOracle(target, { width: frame.width, height: frame.height }))).toBeLessThanOrEqual(0.5);
    expect(screenGap(firstRegion(), target)).toBeGreaterThan(0.5);
    const region = reportedInitial();
    await tellRegion(region);
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(region);
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

// ---------- 축척 막대도 이름표와 같은 "확정된 영역" (승현 11-17) ----------
// 근거(원문 요지): "축척 막대도 이름표와 같은 확정된 영역(맞춤 뒤 영역, 걸러진 알림 제외)을 써. 그 전엔 축척 막대를 그리지 마.
//   기다림 시간이 지나 목표 영역으로 그릴 때도 이름표와 같은 영역. 이름표와 축척이 확정된 영역을 한 곳에서 받아 쓰게".
// 계약 (이 파일이 정한 것): 축척 막대 = testID `map-scale`(accessibilityLabel "축척 <글>", 안의 막대 View style.width).
//   기대 막대 = scaleBar(metersPerPoint(R, 보이는 지도 영역 폭)). 확정된 영역이 없으면 `map-scale` 없음.
//   "한 곳에서 받음"은 매 단계마다 이름표(expectLabelsFrom)와 축척이 같은 R로 계산됐는지(둘 다 없거나 둘 다 R)로 본다

const scaleHost = () => root().queryAll((h) => h.props.testID === 'map-scale')[0];

function expectScaleFrom(region: Region | null) {
  const host = scaleHost();
  if (region === null) {
    expect(host).toBeUndefined();
    return;
  }
  expect(host).toBeDefined();
  const bar = scaleBar(metersPerPoint(region, visibleFrame().width));
  expect(bar).not.toBeNull(); // 시험 자체 확인
  const barView = host.queryAll((inner) => [inner.props.style].flat().some((st: any) => st && typeof st.width === 'number'))[0];
  const width = [barView?.props.style].flat().find((st: any) => st && typeof st.width === 'number')?.width;
  expect({ label: host.props.accessibilityLabel, width: Math.round((width ?? NaN) * 100) / 100 }).toEqual({ label: `축척 ${bar!.label}`, width: Math.round(bar!.width * 100) / 100 });
}

/** 이름표와 축척이 둘 다 없거나, 둘 다 region으로 계산됐다 */
function expectBothFrom(region: Region | null) {
  if (region === null) expect(labelHosts()).toHaveLength(0);
  else {
    expect(labelHosts()).toHaveLength(2);
    expectLabelsFrom(region);
  }
  expectScaleFrom(region);
}

describe('§22 막는 2 — 축척 막대는 확정된 영역(이름표와 같은 영역)으로만', () => {
  test('T15_S22_2_S_시험_자체_확인_처음_영역과_맞춤_영역의_축척_막대가_다르다', async () => {
    await mount();
    await mapReady();
    const w = visibleFrame().width;
    expect(scaleBar(metersPerPoint(shownInitial(), w))).not.toEqual(scaleBar(metersPerPoint(fitEnd(), w)));
  });

  test('T15_S22_2_S_처음_그린_직후(확정_전)_축척_막대_없음', async () => {
    await mount();
    expectScaleFrom(null);
  });

  test('T15_S22_2_S_맞춤_전_영역이_와도_축척_막대_없음', async () => {
    await mount();
    await tellRegion(firstRegion());
    expectBothFrom(null);
  });

  test('T15_S22_2_S_맞춤_뒤_걸러진_처음_영역(0.05)_알림_뒤에도_축척_막대_없음', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    expectBothFrom(null);
  });

  test('T15_S22_2_S_맞춤_영역이_오면_그_영역의_축척_(이름표와_같은_영역)', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    const fitted = fitEnd();
    await tellRegion(fitted);
    expectBothFrom(fitted);
  });

  test('T15_S22_2_S_영역_보고_없이_기다림_시간이_되면_목표_영역의_축척_(1ms_전엔_없음)', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    const target = targetRegion() as Region;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expectBothFrom(null);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expectBothFrom(target);
  });

  test('T15_S22_2_S_걸러진_알림만_오고_기다림_시간이_되면_목표_영역의_축척', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await tellRegion(reportedInitial());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    expectBothFrom(targetRegion() as Region);
  });

  test('T15_S22_2_S_목표_영역으로_그린_뒤_늦은_실제_영역이_오면_축척도_그_영역으로_다시', async () => {
    jest.useFakeTimers();
    await mount();
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    const target = targetRegion() as Region;
    const late: Region = { ...target, latitude: target.latitude + target.latitudeDelta * 0.1, latitudeDelta: target.latitudeDelta * 3, longitudeDelta: target.longitudeDelta * 3 };
    expect(scaleBar(metersPerPoint(late, visibleFrame().width))).not.toEqual(scaleBar(metersPerPoint(target, visibleFrame().width))); // 시험 자체 확인
    await tellRegion(late);
    expectBothFrom(late);
  });

  test('T15_S22_2_S_한_곳에서_받음_맞춤_전_영역→준비→걸러진_알림→맞춤_영역→움직인_영역_매_단계_이름표와_축척이_같은_영역', async () => {
    jest.useFakeTimers();
    await mount();
    await tellRegion(firstRegion());
    expectBothFrom(null);
    await mapReady();
    expectBothFrom(null);
    await tellRegion(reportedInitial());
    expectBothFrom(null);
    const fitted = fitEnd();
    await tellRegion(fitted);
    expectBothFrom(fitted);
    const moved: Region = { ...fitted, latitude: fitted.latitude + fitted.latitudeDelta * 0.1, latitudeDelta: fitted.latitudeDelta * 3, longitudeDelta: fitted.longitudeDelta * 3 };
    await tellRegion(moved);
    expectBothFrom(moved);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS * 2);
    });
    expectBothFrom(moved); // 기다림 시간이 지나도 목표 영역으로 돌아가지 않는다
  });
});
