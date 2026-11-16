/// <reference types="jest" />
// TASK-015 §20 #7 데모 시드 새 선택지 두 개(가까운 핀 · 장소 2곳)를 앱 첫 화면에서 고른다 + 선택지 전용 데이터가 도식 벌리기를 실제로 일으키는지.
// 로직·가드레일만 본다 (모습은 보지 않는다).
// 근거: TASK-015 §20 표 #7("가까운 핀 데모 데이터 -> 도식 벌리기 · 2곳 이름표 스크린샷", frontend(데모)) ·
//       결정권자 답 11-16(① POST /debug/seed-demo에 새 선택지 "핀이 가까운 날" · "장소 2곳만 있는 날" ② 선택지 전용 데이터 파일 — 기존 가짜 팩 · demo_city.json과 섞지 않음
//       ③ 개발 모드에서만, 운영에서는 꺼짐 ④ 앱에서 고르는 버튼이 필요하면 그 앱 테스트도) ·
//       TASK-015 §19(도식 핀 벌리기: 핀 중심 거리 < 28이면 벌림, 값은 diagram-spread.ts) · TASK-010 §C1(데모 버튼은 개발 빌드에서만) ·
//       TASK-012 §11 Q2(데모 시드 요청에 Bearer, as_current 없음)
//
// 계약 (이 파일이 정한 것 — 문서 없이 정함, 승인 대기):
//   빈 첫 화면, __DEV__일 때만 [데모 여행 시작] 아래에 버튼 두 개 더:
//     `home-demo-close-pins` "가까운 핀 데모" -> POST /debug/seed-demo 본문 {demo_places: "close_pins"}
//     `home-demo-two-places` "2곳 데모"      -> POST /debug/seed-demo 본문 {demo_places: "two_places"}
//     두 버튼은 보조 버튼(SecondaryButton) small 모양 — 결정권자 11-17 "보조 버튼 모양으로 작게" (bg-2 바탕, 높이 btn-sm)
//     그 뒤는 [데모 여행 시작]과 같다(시드 응답 day_ids[1]로 계획 시작). as_current는 보내지 않는다
//   [데모 여행 시작]은 지금 그대로 demo_places를 보내지 않는다 (서버는 값이 없으면 지금 데모 도시 30곳)
//   데이터: testdata/demo/seed-close-pins.json · seed-two-places.json (서버 test_task015_s20_demo_seed.py와 같은 파일을 읽는다).
//     서버 테스트가 "그 선택지로 만든 둘째 날 코스 = 파일의 장소 전부, 숙소 = 데모 중심"을 지키므로, 여기서는 그 점들로 도식을 그렸을 때를 본다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DIAGRAM_GAP, spreadDiagramPins } from '@/lib/diagram-spread';
import { projectRoute } from '@/lib/project-route';
import { layout } from '@/planning/layout';
import { color, control } from '@/planning/theme';

import { apiError, FakeServer, json } from '../test-support/fake-server';
import { R, resetDevice, tap } from '../test-support/planning-driver';
import { seed, session } from '../test-support/planning-fixtures';
import { REPO_ROOT } from '../test-support/source-files';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type DemoPlace = { id: string; name: string; lat: number; lng: number };
const load = (file: string) => (JSON.parse(readFileSync(join(REPO_ROOT, 'testdata', 'demo', file), 'utf8')) as { places: DemoPlace[] }).places;
const CLOSE = load('seed-close-pins.json');
const TWO = load('seed-two-places.json');
const HOME = { lat: 35.0, lng: 135.0 }; // 데모 숙소 = 데모 중심 (planning/seed.py DEMO_CENTER)

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NO_TRIP = apiError(404, 'NOT_FOUND', { resource: 'trip' });
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

let server: FakeServer;

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  resetDevice();
  server = new FakeServer().on(CURRENT, NO_TRIP).on(R.seed, json(201, seed)).on(R.start, json(201, session)).on(R.get, json(200, session));
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.restoreAllMocks();
});

const body = () => (server.sent(R.seed)[0]?.body ?? {}) as Record<string, unknown>;

describe('§20 #7 첫 화면 데모 선택지 버튼 (개발 빌드만)', () => {
  test.each([
    ['가까운_핀', 'home-demo-close-pins', '가까운 핀 데모', 'close_pins'],
    ['장소_2곳', 'home-demo-two-places', '2곳 데모', 'two_places'],
  ])('T15_S20_7_%s_버튼을_누르면_시드에_demo_places를_보내고_둘째_날로_계획을_시작한다', async (_name, id, label, value) => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    await startHome();
    const button = await screen.findByTestId(id);
    expect(screen.getByText(label)).toBeTruthy();
    await tap(button);
    await waitFor(() => expect(server.sent(R.seed)).toHaveLength(1));
    expect(body().demo_places).toBe(value);
    expect(body().as_current).toBeUndefined();
    await waitFor(() => expect(server.sent(R.start)).toHaveLength(1)); // seed.day_ids[1] = day-2
  });

  test.each(['home-demo-close-pins', 'home-demo-two-places'])('T15_S20_7_%s는_보조_버튼_small_모양(bg_2·btn_sm)', async (id) => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    await startHome();
    const style = StyleSheet.flatten((await screen.findByTestId(id)).props.style) ?? {};
    expect(style.backgroundColor).toBe(color['bg-2']);
    expect(style.minHeight).toBe(control['btn-sm']);
  });

  test('T15_S20_7_경계_데모_여행_시작은_지금처럼_demo_places를_보내지_않는다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    await startHome();
    await tap(await screen.findByTestId('home-demo'));
    await waitFor(() => expect(server.sent(R.seed)).toHaveLength(1));
    expect(body().demo_places).toBeUndefined();
  });

  test('T15_S20_7_경계_개발_빌드가_아니면_선택지_버튼이_없다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    await startHome();
    await screen.findByTestId('home-create');
    expect(screen.queryByTestId('home-demo-close-pins')).toBeNull();
    expect(screen.queryByTestId('home-demo-two-places')).toBeNull();
  });
});

// ---------- 선택지 전용 데이터 자체 (초록이어야 함: test-writer가 넣었다) ----------

const WIDTHS = [280, 350, 390]; // 도식 폭 = 화면 폭 − 좌우 20씩 (320 · 390 · 430 화면)
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function diagram(width: number, places: DemoPlace[]) {
  const projected = projectRoute([HOME, ...places], width, layout.routeDiagram, layout.routePad);
  const stops = projected.slice(1).map((p, i) => ({ seq: i + 1, ...p }));
  return { home: projected[0], stops };
}

describe('§20 #7 가까운 핀 데이터는 P3 도식에서 실제로 벌어진다', () => {
  test.each(WIDTHS)('T15_S20_7_도식_폭_%s에서_핀_중심_거리_28_미만인_쌍이_있다', (width) => {
    const { stops } = diagram(width, CLOSE);
    const pairs = stops.flatMap((a, i) => stops.slice(i + 1).map((b) => dist(a, b)));
    expect(Math.min(...pairs)).toBeLessThan(DIAGRAM_GAP);
  });

  test.each(WIDTHS)('T15_S20_7_도식_폭_%s에서_벌리기가_핀을_옮긴다', (width) => {
    const { home, stops } = diagram(width, CLOSE);
    const spread = spreadDiagramPins({ frame: { width, height: layout.routeDiagram }, stops, home });
    const moved = spread.stops.filter((s, i) => dist(s, stops[i]) > 1e-6);
    expect(moved.length).toBeGreaterThanOrEqual(1);
  });

  test('T15_S20_7_가까운_핀_데이터는_3곳_이상_5곳_이하이고_id가_데모_도시와_겹치지_않는다', () => {
    expect(CLOSE.length).toBeGreaterThanOrEqual(3);
    expect(CLOSE.length).toBeLessThanOrEqual(5); // 크게 보기 모든 이름표 모드(5곳 이하)
    expect(CLOSE.every((p) => !/^D\d+$/.test(p.id))).toBe(true);
  });
});

describe('§20 #7 장소 2곳 데이터', () => {
  test('T15_S20_7_장소가_정확히_2곳이고_도식에서_서로_28_이상', () => {
    expect(TWO).toHaveLength(2);
    for (const width of WIDTHS) {
      const { stops } = diagram(width, TWO);
      expect(dist(stops[0], stops[1])).toBeGreaterThanOrEqual(DIAGRAM_GAP); // 2곳 이름표를 보는 날이라 벌리기와 섞이지 않게
    }
    expect(TWO.every((p) => !/^D\d+$/.test(p.id))).toBe(true);
  });
});
