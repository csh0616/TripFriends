/// <reference types="jest" />
// TASK-015 §20 #4 코스 크게 보기: SOS 버튼 · 제목 알약 · 닫기 · 아래 시트(course-bar)를 떠 있는 판으로 겹침 함수에 넘기고, 이름표가 그 판과 겹치지 않는다.
// 로직·가드레일만 본다 (모습은 보지 않는다). 가짜 지도 위 화면 테스트.
// 근거: TASK-015 §20 표 #4(reviewer: 4곳 "정원 카페 C" 이름표가 SOS 밑, 5곳 "국수집 A"가 가운데 알약에 닿음 ->
//       SOS 버튼 · 제목 알약 · 닫기 · 아래 시트를 떠 있는 판으로 넘긴다, §B6 · §18 Q3) · §18 Q3("지도 위에 그려지는 것은 모두" 떠 있는 판) ·
//       §17("화면에 실제로 떠 있는 판의 사각형을 넘긴다") · §18 frontend 정한 것(승인: 크게 보기 위 줄 insets.top + 8 ~ 44, 폭 화면 전체) ·
//       task-014-design §11-3(이름표는 떠 있는 판과 겹치면 다음 후보) · TASK-015 §12 Q5 · §13 Q1(판 여유 0, 맞닿음도 겹침) ·
//       task-015-design §2(크게 보기: 위 닫기 · 제목 알약 · SOS, 아래 course-bar) · DESIGN 토큰(SOS 44, 닫기 touch-min 44, 제목 알약 36)
//
// 계약 (이 파일이 정한 것):
//   '@/lib/pin-overlap'의 resolvePinOverlap(input)에서 input.panels가 아래 점을 모두 덮는다(판을 몇 개로 나눠 넘기든 상관없다):
//     닫기(왼쪽, x 16~60) · SOS(오른쪽, x 330~374) · 제목 알약(가운데 x 195, 세로 59~95) — 위 줄 y = insets.top + 8 ~ + 44 (390×844, insets.top 47 -> 55~99)
//     아래 시트 course-bar: y = 844 − (168 + insets.bottom 34) = 642 ~ 844
//   그린 이름표(`map-pin-label` Marker 좌표를 같은 지도 영역으로 다시 화면 점으로, 폭 = width prop, 높이 28)가 넘긴 판 어느 것과도 닿지 않는다
//   지도 영역(region)은 가짜 지도에 regionChangeComplete로 넣는다. 값은 fitToCoordinates(경로, edgePadding = 화면이 넘긴 padding)를 흉내 내어
//   경로 상자가 padding 안쪽 끝에 닿게 계산한다 -> 맨 위 핀은 y = padding.top. 그 핀의 "위" 이름표는 위 줄과 닿는 자리다 (reviewer 사례)
//   (§20 #4 frontend 진단 뒤 고침, 11-17) region은 MapView mapPadding을 뺀 보이는 영역을 채운다. 시험이 화면 점을 계산할 때도 그 영역 기준
//   (계약: __tests__/task-015-s20-course-map-visible-area.test.tsx)
//   데이터: engine/fixtures/demo_city.json(데모 도시)의 장소 이름·좌표, 숙소 = 데모 중심(35.0, 135.0). 어떤 4곳 · 5곳이었는지는 reviewer 보고에 없어 골라 넣었다:
//     4곳 = 정원 카페 C가 경로 상자 오른쪽 위 끝(SOS 쪽), 5곳 = 국수집 A가 맨 위이고 가로로 가운데 근처(알약 쪽)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CourseMapScreen } from '@/components/planning/course-map-screen';
import type { CourseStop } from '@/components/now/map-adapter';
import { project, type Region } from '@/lib/map-project';
import { resolvePinOverlap, type PinOverlapInput, type Rect } from '@/lib/pin-overlap';

import { mapControl } from '../test-support/maps-mock';

jest.mock('@/lib/pin-overlap', () => {
  const actual = jest.requireActual('@/lib/pin-overlap');
  return { __esModule: true, ...actual, resolvePinOverlap: jest.fn(actual.resolvePinOverlap) };
});

const overlap = resolvePinOverlap as unknown as jest.Mock;

const WIDTH = 390;
const HEIGHT = 844;
const INSET_TOP = 47;
const INSET_BOTTOM = 34;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, insets: { top: INSET_TOP, left: 0, right: 0, bottom: INSET_BOTTOM } };
const ROW_TOP = INSET_TOP + 8; // 위 줄 top = insets.top + space-2
const BUTTON = 44; // 닫기 · SOS 지름
const PILL = 36; // 제목 알약 높이 (layout.titlePill)
const SIDE = 16; // 위 줄 좌우 = space-4
const SHEET_TOP = HEIGHT - (168 + INSET_BOTTOM); // course-bar
const LABEL_H = 28;
const HOME = { lat: 35.0, lng: 135.0 }; // 데모 도시 중심 = 숙소 (planning/seed.py DEMO_CENTER)

// demo_city.json (데모 도시, 지어낸 값)
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
const root = () => screen.root as unknown as Host;

const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

type Frame = { x: number; y: number; width: number; height: number };
/** 지도가 region을 알려 주는 보이는 영역 = 화면에서 MapView mapPadding을 뺀 곳 (§20 #4) */
let frame: Frame = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

/** fitToCoordinates(points, edgePadding)를 흉내 낸 지도 영역: 점 상자가 화면 위 padding 안쪽 끝에 닿고, region은 보이는 영역을 채운다 */
function fitRegion(points: { lat: number; lng: number }[], pad: { top: number; bottom: number; left: number; right: number }): Region {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const x1 = (pad.left - frame.x) / frame.width;
  const x2 = (WIDTH - pad.right - frame.x) / frame.width;
  const longitudeDelta = (Math.max(...lngs) - Math.min(...lngs)) / (x2 - x1);
  const west = Math.min(...lngs) - x1 * longitudeDelta;
  const y1 = (pad.top - frame.y) / frame.height;
  const y2 = (HEIGHT - pad.bottom - frame.y) / frame.height;
  const top = merc(Math.max(...lats));
  const bottom = merc(Math.min(...lats));
  const mercPer = (top - bottom) / (y2 - y1);
  const north = unmerc(top + y1 * mercPer);
  const south = unmerc(bottom - (1 - y2) * mercPer);
  return { latitude: (north + south) / 2, longitude: west + longitudeDelta / 2, latitudeDelta: north - south, longitudeDelta };
}

async function showMap(stops: CourseStop[]) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CourseMapScreen dayNumber={2} labelText="느긋하게" stops={stops} home={HOME} summary={`${stops.length}곳 · 이동 45분`} busy={false} onClose={jest.fn()} onPick={jest.fn()} onFail={jest.fn()} />
    </SafeAreaProvider>,
  );
  const map = root().queryAll((h) => h.props.mapElement === 'MapView' && h.props.testID === 'course-map')[0];
  expect(map).toBeDefined(); // 시험 자체 확인: 대체 그림이 아니라 지도
  const mp = (map.props.mapPadding ?? {}) as Record<string, number | undefined>;
  const [top, bottom, left, right] = [mp.top ?? 0, mp.bottom ?? 0, mp.left ?? 0, mp.right ?? 0];
  frame = { x: left, y: top, width: WIDTH - left - right, height: HEIGHT - top - bottom };
  const padding = map.props.mapPadding !== undefined ? fitPaddingOf() : null;
  const region = fitRegion([HOME, ...stops], padding ?? { top: INSET_TOP + 52 + 28, bottom: 168 + INSET_BOTTOM + 40, left: 24, right: 24 });
  // (§22 막는 2, 11-17) 이름표는 경로 맞춤(fitToCoordinates) 뒤 처음 온 영역으로만 그린다 -> 준비 신호(맞춤)를 먼저 주고 영역을 넣는다.
  // 영역 값은 바꾸지 않으려고 맞춤 전에 위에서 계산해 둔 값 그대로 쓴다 (이 파일은 처음부터 맞춤 전 padding 대체값으로 계산해 왔다)
  await act(async () => {
    mapControl.ready();
  });
  await act(async () => {
    fireEvent(map as never, 'regionChangeComplete', region);
  });
  return region;
}

/** 화면이 fitToCoordinates에 넘긴 edgePadding (지도 준비 신호 뒤). 없으면 null */
function fitPaddingOf(): { top: number; bottom: number; left: number; right: number } | null {
  const fit = mapControl.fits[mapControl.fits.length - 1] as { options?: { edgePadding?: Record<string, number> } } | undefined;
  const pad = fit?.options?.edgePadding;
  return pad && ['top', 'bottom', 'left', 'right'].every((k) => typeof pad[k] === 'number') ? (pad as never) : null;
}

function lastPanels(): Rect[] {
  expect(overlap).toHaveBeenCalled();
  const input = overlap.mock.calls[overlap.mock.calls.length - 1][0] as PinOverlapInput;
  return input.panels ?? [];
}

const covers = (panels: Rect[], x: number, y: number) => panels.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
const touches = (a: Rect, b: Rect) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** 그린 이름표의 화면 사각형 (Marker 좌표 = 이름표 가운데, anchor CENTER) */
function drawnLabels(region: Region): { name: string; rect: Rect }[] {
  return root()
    .queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label')
    .map((h) => {
      const at = project(region, frame, h.props.coordinate);
      const width = h.queryAll((inner) => typeof inner.props.style !== 'undefined' && [inner.props.style].flat().some((s: any) => s && typeof s.width === 'number'))[0];
      const w = [width?.props.style].flat().find((s: any) => s && typeof s.width === 'number')?.width as number;
      const name = String(h.queryAll((inner) => typeof inner.props.children === 'string')[0]?.props.children ?? '');
      return { name, rect: { x: at.x - w / 2, y: at.y - LABEL_H / 2, width: w, height: LABEL_H } };
    });
}

/** 위 줄 세 부품의 사각형 (판이 덮어야 하는 곳) */
const CLOSE: Rect = { x: SIDE, y: ROW_TOP, width: BUTTON, height: BUTTON };
const SOS: Rect = { x: WIDTH - SIDE - BUTTON, y: ROW_TOP, width: BUTTON, height: BUTTON };
const PILL_MID: Rect = { x: WIDTH / 2, y: ROW_TOP + (BUTTON - PILL) / 2, width: 0, height: PILL }; // 가운데 세로 선 (알약 폭은 글자에 따라 다름)
const SHEET: Rect = { x: 0, y: SHEET_TOP, width: WIDTH, height: HEIGHT - SHEET_TOP };
const corners = (r: Rect): [number, number][] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x, r.y + r.height],
  [r.x + r.width, r.y + r.height],
];

beforeEach(() => {
  mapControl.reset();
  overlap.mockClear();
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: WIDTH, height: HEIGHT }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('§20 #4 크게 보기의 떠 있는 판 (판이 덮는 곳)', () => {
  test.each([
    ['닫기', CLOSE],
    ['SOS', SOS],
    ['제목_알약_가운데', PILL_MID],
    ['아래_시트_course_bar', SHEET],
  ] as const)('T15_S20_4_%s_사각형_네_모서리가_판_안', async (_name, rect) => {
    await showMap(FOUR);
    const panels = lastPanels();
    for (const [x, y] of corners(rect)) expect(covers(panels, x, y)).toBe(true);
  });

  test('T15_S20_4_겹침_함수는_모든_이름표_모드로_불린다', async () => {
    await showMap(FOUR);
    const input = overlap.mock.calls[overlap.mock.calls.length - 1][0] as PinOverlapInput;
    expect(input.labelMode).toBe('all');
  });

  test('T15_S20_4_경계_위_줄과_아래_시트_사이_지도_가운데는_판_밖', async () => {
    await showMap(FOUR);
    const panels = lastPanels();
    expect(covers(panels, WIDTH / 2, (ROW_TOP + BUTTON + SHEET_TOP) / 2)).toBe(false);
    expect(covers(panels, WIDTH / 2, ROW_TOP + BUTTON + 1)).toBe(false); // 위 줄 바로 아래
    expect(covers(panels, WIDTH / 2, SHEET_TOP - 1)).toBe(false); // 시트 바로 위
  });
});

describe('§20 #4 reviewer 사례: 그린 이름표가 위 줄 · 시트와 닿지 않는다', () => {
  test.each([
    ['4곳_정원_카페_C', FOUR],
    ['5곳_국수집_A', FIVE],
  ] as const)('T15_S20_4_%s_그린_이름표가_닫기·SOS·제목_알약·아래_시트와_닿지_않는다', async (_name, stops) => {
    const region = await showMap(stops);
    const labels = drawnLabels(region);
    expect(labels.length).toBeGreaterThanOrEqual(1); // 시험 자체 확인: 모든 이름표 모드라 적어도 하나는 그린다
    for (const { name, rect } of labels) {
      for (const [part, element] of [['닫기', CLOSE], ['SOS', SOS], ['제목 알약', PILL_MID], ['아래 시트', SHEET]] as const) {
        expect({ name, part, touches: touches(rect, element) }).toEqual({ name, part, touches: false });
      }
    }
  });

  test.each([
    ['4곳_정원_카페_C', FOUR],
    ['5곳_국수집_A', FIVE],
  ] as const)('T15_S20_4_%s_그린_이름표는_넘긴_판_어느_것과도_닿지_않는다', async (_name, stops) => {
    const region = await showMap(stops);
    const panels = lastPanels();
    for (const { name, rect } of drawnLabels(region)) {
      expect({ name, touching: panels.filter((panel) => touches(rect, panel)).length }).toEqual({ name, touching: 0 });
    }
  });

  test('T15_S20_4_경계_4곳에서_정원_카페_C는_경로_상자_맨_위라_위_이름표_자리가_위_줄과_닿는다(시험_자체_확인)', async () => {
    const region = await showMap(FOUR);
    const pin = project(region, frame, { latitude: D03.lat, longitude: D03.lng });
    const topLabel: Rect = { x: pin.x - 40, y: pin.y - 14 - 4 - LABEL_H, width: 80, height: LABEL_H }; // 지난 핀 28 기준 "위" 자리
    expect(touches(topLabel, { x: 0, y: ROW_TOP, width: WIDTH, height: BUTTON })).toBe(true);
  });
});
