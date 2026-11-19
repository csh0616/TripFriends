/// <reference types="jest" />
// TASK-015 §25 — 크게 보기: ① 6곳 이상이면 번호만(이름표 없음), 5곳은 이름표 · ② 이름표와 축척 막대는 같은 프레임에 함께 나온다.
// 로직 · 가드레일만 본다 (모습은 보지 않는다). 가짜 지도 위 화면 테스트.
// 근거: TASK-015 §25 PM 정정("7곳 이상 번호만" -> 6곳 이상, 경계: 5곳 이름표 있음 · 6곳 없음) ·
//       §25 디자이너 확인 "새 하 1건: 57장에서 축척은 나왔는데 이름표가 아직 없음 — 같은 확정 영역을 읽으므로 이름표와 축척은 같은 프레임에 함께 나온다
//       (이름표 계산이 늦으면 축척도 그때까지 기다림)" · task-015-design §13-3 하-10 · §13-4 2(5곳 = 이름표 · 6곳 = 없음, 크게 보기에는 다음 핀이 없다) ·
//       §22 막는 2(지도 크기와 떠 있는 판 크기를 모두 안 뒤에만 이름표, 그 전엔 핀만) · §17(5곳 이하 모든 핀 · 6곳 이상 다음 핀 규칙)
//
// 계약 (이 파일이 정한 것 — 화면 계약은 task-015-s22-course-map-labels-after-fit 그대로):
//   이름표 = Marker testID `map-pin-label` · 번호 핀 = Marker testID `map-pin-<seq>` · 축척 = testID `map-scale` · 맞춤 = 준비 신호 뒤 fitToCoordinates
//   "프레임" = React가 화면에 반영(commit)한 한 번. Profiler onRender마다 그 순간의 화면을 본다
//   5곳 이하(이름이 있는 장소): 어느 프레임에서도 "이름표 1개 이상"과 "축척 있음"이 같다 (둘 다 있거나 둘 다 없음)
//   이름표 계산이 기다리는 동안(창 크기를 아직 모름 -> 알게 됨)에는 축척도 기다리고, 알게 된 그 프레임에 함께 나온다
//   6곳 이상: 이름표는 늘 0개, 축척은 확정 영역이 있으면 나온다(번호만 규칙이라 축척만 나오는 게 맞다)
//   데이터: 시험이 직접 만든 장소(숙소 = 데모 중심 35.0, 135.0 둘레). 저장소 바깥 파일은 읽지 않는다
import { Profiler, type ReactNode } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { COURSE_LABEL_FIT_WAIT_MS, type CourseStop } from '@/components/now/map-adapter';
import { CourseMapScreen } from '@/components/planning/course-map-screen';
import { type Region } from '@/lib/map-project';
import { ALL_LABELS_MAX, resolvePinOverlap, type PinOverlapResult } from '@/lib/pin-overlap';

import { mapControl } from '../test-support/maps-mock';

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

// iPhone 17 (§22 진단 값)
const WIDTH = 402;
const HEIGHT = 874;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const HOME = { lat: 35.0, lng: 135.0 };

// 숙소 둘레에 넓게 벌린 장소 (이름표끼리 · 판과 닿지 않게). 6번째는 6곳 경계용
const SPOTS: { name: string; lat: number; lng: number }[] = [
  { name: '북서 카페', lat: 35.012, lng: 134.99 },
  { name: '북동 서점', lat: 35.012, lng: 135.01 },
  { name: '동쪽 공원', lat: 35.0, lng: 135.012 },
  { name: '남동 시장', lat: 34.988, lng: 135.01 },
  { name: '남서 빵집', lat: 34.988, lng: 134.99 },
  { name: '서쪽 신사', lat: 35.0, lng: 134.988 },
];
const stopsOf = (n: number): CourseStop[] => SPOTS.slice(0, n).map((s, i) => ({ seq: i + 1, name: s.name, lat: s.lat, lng: s.lng }));

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
const root = () => screen.root as unknown as Host;
const labelHosts = () => root().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label');
const numberPins = () => root().queryAll((h) => h.props.mapElement === 'Marker' && /^map-pin-\d+$/.test(String(h.props.testID)));
const scaleHosts = () => root().queryAll((h) => h.props.testID === 'map-scale');
const mapHost = () => root().queryAll((h) => h.props.mapElement === 'MapView' && h.props.testID === 'course-map')[0];

type FrameSeen = { labels: number; scale: boolean };
let frames: FrameSeen[] = [];

/** 프레임마다 화면을 본다 (처음 그리기가 끝나기 전엔 screen이 없어 건너뛴다) */
function onCommit() {
  try {
    frames.push({ labels: labelHosts().length, scale: scaleHosts().length > 0 });
  } catch {
    // render()가 아직 끝나지 않아 screen이 없다
  }
}

const Watch = ({ children }: { children: ReactNode }) => (
  <Profiler id="course-map" onRender={onCommit}>
    {children}
  </Profiler>
);

let windowSize = { width: WIDTH, height: HEIGHT };

async function mount(stops: CourseStop[]) {
  mapControl.silent = true; // 준비 신호는 시험이 준다
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Watch>
        <CourseMapScreen dayNumber={2} labelText="느긋하게" stops={stops} home={HOME} summary={`${stops.length}곳 · 이동 40분`} busy={false} onClose={jest.fn()} onPick={jest.fn()} onFail={jest.fn()} />
      </Watch>
    </SafeAreaProvider>,
  );
  expect(mapHost()).toBeDefined(); // 시험 자체 확인: 대체 그림이 아니라 지도
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

/** 맞춤 끝 영역 흉내: 숙소와 장소가 모두 들어가는 넉넉한 영역 (화면이 거르는 처음 영역 0.05와는 다르다) */
function fitLike(stops: CourseStop[]): Region {
  const lats = [HOME.lat, ...stops.map((s) => s.lat)];
  const lngs = [HOME.lng, ...stops.map((s) => s.lng)];
  const lat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const lng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  return { latitude: lat, longitude: lng, latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 1.8, longitudeDelta: (Math.max(...lngs) - Math.min(...lngs)) * 1.6 };
}

function lastResult(): PinOverlapResult {
  const results = overlap.mock.results.filter((r) => r.type === 'return');
  expect(results.length).toBeGreaterThan(0);
  return results[results.length - 1].value as PinOverlapResult;
}

/** 하나만 있는 프레임 (이름표만 · 축척만) */
const lopsided = () => frames.filter((f) => (f.labels > 0) !== f.scale);

async function setWindow(size: { width: number; height: number }) {
  windowSize = size;
  await act(async () => {
    Dimensions.set({ window: { ...Dimensions.get('window'), ...size }, screen: { ...Dimensions.get('screen'), ...size } } as never);
  });
}

beforeEach(() => {
  mapControl.reset();
  overlap.mockClear();
  frames = [];
  windowSize = { width: WIDTH, height: HEIGHT };
  const real = Dimensions.get.bind(Dimensions);
  jest.spyOn(Dimensions, 'get').mockImplementation((dim) => ({ ...real(dim), ...windowSize }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- ① 6곳 이상 번호만 (경계 5 · 6) ----------
describe('§25 ① 크게 보기 이름표 — 5곳은 있음 · 6곳은 번호만', () => {
  test('T15_S25_시험_자체_확인_기준_수는_5곳이고_데이터는_6곳까지_있다', () => {
    expect(ALL_LABELS_MAX).toBe(5);
    expect(stopsOf(6)).toHaveLength(6);
  });

  test('T15_S25_경계_5곳이면_맞춤_끝_영역을_받은_뒤_이름표_5개와_축척', async () => {
    const stops = stopsOf(5);
    await mount(stops);
    await mapReady();
    await tellRegion(fitLike(stops));
    expect(lastResult().labels ?? []).toHaveLength(5); // 시험 자체 확인: 고른 자리에서 다섯 이름표 모두 놓인다
    expect(labelHosts()).toHaveLength(5);
    expect(numberPins()).toHaveLength(5);
    expect(scaleHosts()).toHaveLength(1);
  });

  test('T15_S25_경계_6곳이면_맞춤_끝_영역을_받아도_이름표_0개_번호_핀_6개_축척은_있음', async () => {
    const stops = stopsOf(6);
    await mount(stops);
    await mapReady();
    await tellRegion(fitLike(stops));
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(6);
    expect(scaleHosts()).toHaveLength(1);
  });

  test('T15_S25_경계_6곳이면_기다림_시간으로_그려도_이름표_0개_축척은_있음', async () => {
    jest.useFakeTimers();
    await mount(stopsOf(6));
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS);
    });
    expect(labelHosts()).toHaveLength(0);
    expect(numberPins()).toHaveLength(6);
    expect(scaleHosts()).toHaveLength(1);
  });
});

// ---------- ② 이름표와 축척은 같은 프레임에 ----------
describe('§25 ② 이름표와 축척 막대는 같은 프레임에 함께 나온다 (5곳 이하)', () => {
  test.each([2, 5])('T15_S25_%i곳_맞춤_전_영역→준비→맞춤_끝_영역→움직인_영역_어느_프레임에도_하나만_있는_때가_없다', async (n) => {
    jest.useFakeTimers();
    const stops = stopsOf(n);
    await mount(stops);
    await tellRegion({ latitude: HOME.lat, longitude: HOME.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    await mapReady();
    const fitted = fitLike(stops);
    await tellRegion(fitted);
    await tellRegion({ ...fitted, latitudeDelta: fitted.latitudeDelta * 1.5, longitudeDelta: fitted.longitudeDelta * 1.5 });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS * 2);
    });
    expect(frames.some((f) => f.labels > 0 && f.scale)).toBe(true); // 시험 자체 확인: 둘이 나온 프레임이 있다
    expect(lopsided()).toEqual([]);
  });

  test.each([2, 5])('T15_S25_%i곳_영역_보고_없이_기다림_시간으로_그릴_때도_하나만_있는_프레임이_없다', async (n) => {
    jest.useFakeTimers();
    await mount(stopsOf(n));
    await mapReady();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(COURSE_LABEL_FIT_WAIT_MS - 1);
    });
    expect(scaleHosts()).toHaveLength(0);
    expect(labelHosts()).toHaveLength(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(labelHosts().length).toBeGreaterThan(0);
    expect(scaleHosts()).toHaveLength(1);
    expect(lopsided()).toEqual([]);
  });

  test('T15_S25_이름표_계산이_창_크기를_기다리는_동안(맞춤_끝_영역은_받음)_축척도_없다', async () => {
    windowSize = { width: 0, height: 0 };
    const stops = stopsOf(2);
    await mount(stops);
    await mapReady();
    await tellRegion(fitLike(stops));
    expect(labelHosts()).toHaveLength(0); // §22 막는 2: 크기를 모르면 이름표 없음
    expect(scaleHosts()).toHaveLength(0); // §25: 이름표가 기다리면 축척도 기다린다
    expect(numberPins()).toHaveLength(2);
  });

  test('T15_S25_창_크기를_늦게_알게_되면_그_프레임에_이름표와_축척이_함께_나온다', async () => {
    windowSize = { width: 0, height: 0 };
    const stops = stopsOf(2);
    await mount(stops);
    await mapReady();
    const fitted = fitLike(stops);
    await tellRegion(fitted);
    await setWindow({ width: WIDTH, height: HEIGHT });
    await tellRegion({ ...fitted, latitude: fitted.latitude + 1e-4 }); // 크기를 안 뒤의 영역 보고 (구현이 크기 바뀜 뒤 영역을 다시 기다려도 되게)
    expect(labelHosts().length).toBeGreaterThan(0);
    expect(scaleHosts()).toHaveLength(1);
    expect(lopsided()).toEqual([]);
  });
});

describe('§25 ② 경계 — 6곳 이상은 번호만이라 축척만 나오는 게 맞다', () => {
  test('T15_S25_경계_6곳_어느_프레임에도_이름표는_0개이고_확정_영역_뒤엔_축척이_있다', async () => {
    jest.useFakeTimers();
    const stops = stopsOf(6);
    await mount(stops);
    await mapReady();
    const fitted = fitLike(stops);
    await tellRegion(fitted);
    await tellRegion({ ...fitted, latitudeDelta: fitted.latitudeDelta * 1.5, longitudeDelta: fitted.longitudeDelta * 1.5 });
    expect(frames.length).toBeGreaterThan(0); // 시험 자체 확인: 프레임을 봤다
    expect(frames.every((f) => f.labels === 0)).toBe(true);
    expect(frames[frames.length - 1].scale).toBe(true);
    expect(lopsided().length).toBeGreaterThan(0); // 시험 자체 확인: 프레임 보기가 '축척만 있는 프레임'을 잡아낸다 (5곳 이하 시험이 헛돌지 않는다)
  });
});
