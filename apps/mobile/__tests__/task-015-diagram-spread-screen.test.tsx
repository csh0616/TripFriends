/// <reference types="jest" />
// TASK-015 §19 P3 코스안 — [크게 보기] 알약 자리 · 도식 + 요약 줄 한 버튼 · 도식 핀 벌리기. 자리·구조·눌림만 본다(색·높이·간격은 스크린샷 몫).
// 근거: TASK-015 §19("[크게 보기] 알약을 지도 밖 요약 줄 오른쪽 끝으로(bg-2 24, 줄 안 모양). 요약 줄 글자를 눌러도 크게 보기가 열림. 화면 높이 변화 없음" ·
//       "도식 핀 벌리기 … 순수 함수") · task-014-design.md §15-4 표("알약 자리 = 지도 밖, 도식 아래 요약 줄 오른쪽 끝" ·
//       "누르는 영역: 도식 + 요약 줄 = 버튼 하나(350×152). 알약은 눌림 표시일 뿐(aria-hidden). 화면 읽기 라벨 '코스 지도 크게 보기, 5곳 · 이동 45분'") ·
//       task-015-design.md §11-1 표 · §2 표(`btn-expand-map` 이름)
//
// 계약 (이 테스트가 정한 것):
//   testID 'btn-expand-map' = 지금처럼 눌러지는 버튼(이제 도식 + 요약 줄을 함께 감쌈). accessibilityLabel "코스 지도 크게 보기, {요약 글}"
//   testID 'course-summary' (새) = 요약 줄(요약 글 + 알약). testID 'expand-pill' (새) = "크게 보기" 알약 (aria-hidden)
//   도식의 번호 원(route-stop-{seq}) · 집 원(route-home) · 번호 글자 x = spreadDiagramPins(projectRoute 결과) — projectRoute(집 + 핀, 도식 폭, layout.routeDiagram, layout.routePad)
import { screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { spreadDiagramPins } from '@/lib/diagram-spread';
import { projectRoute } from '@/lib/project-route';
import { layout } from '@/planning/layout';

import { happyServer, R, resetDevice, tap, toP3 } from '../test-support/planning-driver';
import { json } from '../test-support/fake-server';
import { course, day, relaxed } from '../test-support/planning-fixtures';

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; children: (Tree | string)[]; queryAll: (p: (h: Tree) => boolean) => Tree[] };
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const inside = (host: Tree) => host.queryAll(() => true);
const isInside = (inner: Tree, outer: Tree) => {
  for (let up: Tree | null = inner; up; up = up.parent) if (up === outer) return true;
  return false;
};

beforeEach(() => {
  resetDevice();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const SUMMARY = '3곳 · 이동 80분'; // relaxed(): 3곳 · total_travel_min 80

describe('§19 [크게 보기] 알약 자리 · 한 버튼', () => {
  test('T15_S19_알약은_요약_줄_안에_있고_도식_안에는_없다', async () => {
    happyServer();
    await toP3();
    const pill = byId('expand-pill');
    expect(isInside(pill, byId('course-summary'))).toBe(true);
    expect(isInside(pill, byId('route-diagram'))).toBe(false);
    expect(within(screen.getByTestId('route-diagram')).queryByText('크게 보기')).toBeNull();
    expect(within(screen.getByTestId('expand-pill')).getByText('크게 보기')).toBeTruthy();
  });

  test('T15_S19_요약_줄에_요약_글과_알약이_함께_있고_알약이_요약_글_뒤_오른쪽_끝', async () => {
    happyServer();
    await toP3();
    const row = byId('course-summary');
    const order = inside(row).filter((h) => h.props.testID === 'expand-pill' || (h.type === 'Text' && h.children.includes(SUMMARY)));
    expect(order.map((h) => (h.props.testID === 'expand-pill' ? 'pill' : 'summary'))).toEqual(['summary', 'pill']);
    expect(StyleSheet.flatten(row.props.style)?.flexDirection).toBe('row');
  });

  test('T15_S19_알약은_aria_hidden이고_따로_눌러지는_버튼이_아니다', async () => {
    happyServer();
    await toP3();
    const pill = byId('expand-pill');
    const hidden =
      pill.props['aria-hidden'] === true ||
      pill.props.accessibilityElementsHidden === true ||
      pill.props.importantForAccessibility === 'no-hide-descendants';
    expect(hidden).toBe(true);
    expect(pill.props.accessibilityRole).not.toBe('button');
    expect(pill.props.onPress).toBeUndefined();
  });

  test('T15_S19_도식과_요약_줄이_한_버튼_btn_expand_map_안에_있다', async () => {
    happyServer();
    await toP3();
    const button = byId('btn-expand-map');
    expect(isInside(byId('route-diagram'), button)).toBe(true);
    expect(isInside(byId('course-summary'), button)).toBe(true);
    expect(button.props.accessibilityRole).toBe('button');
  });

  test('T15_S19_버튼의_화면_읽기_라벨은_코스_지도_크게_보기_쉼표_요약', async () => {
    happyServer();
    await toP3();
    expect(byId('btn-expand-map').props.accessibilityLabel).toBe(`코스 지도 크게 보기, ${SUMMARY}`);
  });

  test('T15_S19_크게_보기_버튼은_하나뿐', async () => {
    happyServer();
    await toP3();
    expect(screen.getAllByRole('button', { name: /크게 보기/ })).toHaveLength(1);
  });

  test('T15_S19_요약_줄_글자를_눌러도_크게_보기가_열린다', async () => {
    happyServer();
    await toP3();
    expect(screen.queryByTestId('course-map-screen')).toBeNull();
    await tap(within(screen.getByTestId('course-summary')).getByText(SUMMARY));
    expect(await screen.findByTestId('course-map-screen')).toBeTruthy();
  });

  test('T15_S19_알약_글자를_눌러도_크게_보기가_열린다', async () => {
    happyServer();
    await toP3();
    await tap(within(screen.getByTestId('expand-pill')).getByText('크게 보기'));
    expect(await screen.findByTestId('course-map-screen')).toBeTruthy();
  });

  test('T15_S19_도식을_눌러도_그대로_크게_보기가_열린다', async () => {
    happyServer();
    await toP3();
    await tap(screen.getByTestId('route-diagram'));
    expect(await screen.findByTestId('course-map-screen')).toBeTruthy();
  });

  test('T15_S19_요약_글은_한_번만_보인다', async () => {
    happyServer();
    await toP3();
    expect(screen.getAllByText(SUMMARY)).toHaveLength(1);
  });
});

// ---------- 도식 핀 벌리기 ----------

describe('§19 도식이 벌린 좌표로 핀을 그린다', () => {
  // 숙소(35, 135). 1번 · 2번은 경도 0.0001 차이 -> 도식에서 거의 같은 자리. 3번은 숙소와 거의 같은 자리
  const CROWDED = [
    { lat: 35.01, lng: 135.01 },
    { lat: 35.01, lng: 135.0101 },
    { lat: 35.0001, lng: 135.0001 },
  ];
  const crowdedCourse = () => {
    const base = relaxed();
    return course([relaxed('opt-relaxed', { items: base.items.map((item, i) => ({ ...item, ...CROWDED[i] })) })]);
  };

  async function toCrowdedP3() {
    const server = happyServer();
    server.on(R.compose, json(200, crowdedCourse()));
    await toP3();
  }

  const circle = (id: string) => ({ x: Number(byId(id).props.cx), y: Number(byId(id).props.cy) });
  const diagramWidth = () => Number(StyleSheet.flatten(byId('route-diagram').props.style).width);

  function expected() {
    const width = diagramWidth();
    const height = layout.routeDiagram;
    const projected = projectRoute([day.lodging, ...CROWDED], width, height, layout.routePad);
    return spreadDiagramPins({
      frame: { width, height },
      stops: projected.slice(1).map((p, i) => ({ seq: i + 1, ...p })),
      home: projected[0],
    });
  }

  test('T15_S19_번호_원과_집_원은_벌리기_함수_결과_자리', async () => {
    await toCrowdedP3();
    const want = expected();
    for (const stop of want.stops) {
      const got = circle(`route-stop-${stop.seq}`);
      expect(got.x).toBeCloseTo(stop.x, 6);
      expect(got.y).toBeCloseTo(stop.y, 6);
    }
    const home = circle('route-home');
    expect(home.x).toBeCloseTo(want.home!.x, 6);
    expect(home.y).toBeCloseTo(want.home!.y, 6);
  });

  test('T15_S19_그린_핀과_집은_모든_쌍_28_이상이고_틀_안쪽_18', async () => {
    await toCrowdedP3();
    const width = diagramWidth();
    const points = [circle('route-home'), circle('route-stop-1'), circle('route-stop-2'), circle('route-stop-3')];
    for (let i = 0; i < points.length; i += 1) {
      expect(points[i].x).toBeGreaterThanOrEqual(18 - 1e-6);
      expect(points[i].x).toBeLessThanOrEqual(width - 18 + 1e-6);
      expect(points[i].y).toBeGreaterThanOrEqual(18 - 1e-6);
      expect(points[i].y).toBeLessThanOrEqual(layout.routeDiagram - 18 + 1e-6);
      for (let j = i + 1; j < points.length; j += 1) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThanOrEqual(28 - 1e-6);
      }
    }
  });

  test('T15_S19_번호_글자도_벌린_핀_가운데에_있어_1_3이_다_보인다', async () => {
    await toCrowdedP3();
    const want = expected();
    const labels = inside(byId('route-diagram')).filter((h) => h.type === 'Text' && /^[0-9]+$/.test(String(h.props.children)));
    expect(labels.map((h) => h.props.children)).toEqual(['1', '2', '3']);
    for (const stop of want.stops) {
      const label = labels.find((h) => h.props.children === String(stop.seq))!;
      expect(Number(label.props.x)).toBeCloseTo(stop.x, 6);
    }
  });
});
