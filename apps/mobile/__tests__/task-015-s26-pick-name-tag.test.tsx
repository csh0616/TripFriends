/// <reference types="jest" />
// TASK-015 §26 막는 1 + §27 a2 이름표 4가지: a2 "지도에서 찍기" — 찍은 핀 옆에 사용자가 쓴 이름표가 보인다.
// 로직 · 가드레일만 본다 (이름표가 있나 · 글 · 자리 후보 · 모양 값 28 · 테두리). 가짜 지도 위 화면 테스트 — 실제로 보이는지는 Maestro · 스크린샷 몫.
// 근거: TASK-015 §26 "막는 1건"(reviewer 6차 78장: 지도 코드에 이름표 자체가 없음 -> §1-3대로 보인다. ②-06a 이름표 모양 · 자리 후보(위 -> 오른쪽 -> 왼쪽 -> 아래),
//       이름 칸이 비면 이름표 없음, 치는 대로 바뀜) · docs/design/reviews/task-015-design.md §1-3 이름표 줄("②-06a name tag(흰 알약 28 · 12/16·600) ·
//       위치 후보 순서 위→오른쪽→왼쪽→아래 · 사용자가 쓴 이름이 있으면 보임") · §1-3 pin-pick(지름 32, 중심 = 찍은 좌표) · pick-area(반지름 64) ·
//       §13-6 "a2 키보드 열림: 범위 원 · 이름표 '친구 집' 보임" · §13-6 크게 보기 "이름표 높이 28 + 테두리 #E5E7EB 1" · §12 하-2(보드 B6 = 28 + #E5E7EB 1) ·
//       task-014-design §11-3 B6 이름표 자리(높이 28 · 핀과 위 4 · 옆 6 · 화면 가장자리에서 8 안쪽 · 모두 안 되면 뺌) ·
//       TASK-015 §14 Q3(이름은 앞뒤 공백을 자른다, 자른 뒤 빈 글이면 없음 — @/lib/create-trip trimLabel)
//
// 계약 (이 파일이 정한 것):
//   이름표 = `pick-map`(MapView) 안의 Marker testID `map-pin-label` (크게 보기 · 지금 화면과 같은 ②-06a 이름표 부품). 많아야 1개
//     Marker coordinate = 이름표 가운데 (anchor CENTER). 안쪽에 style.width가 숫자인 상자(= 이름표 폭)가 있고, 높이는 28
//     글 = 이름 칸(`pick-label`) 글의 앞뒤 공백을 자른 것. 자른 뒤 비면 이름표 없음. 글을 바꾸면 다음 그림에서 바로 바뀐다(지도 영역 알림을 다시 기다리지 않는다)
//   지도 영역: `pick-map`의 onRegionChangeComplete로 받는다. region은 보이는 영역(화면 390×844에서 MapView mapPadding을 뺀 곳)을 채운다
//     (__tests__/task-015-s20-course-map-visible-area.test.tsx와 같은 계약). 알림 전에는 이름표 없음(§27 ③)
//   자리: 찍은 핀(지름 32, 반지름 16) 화면 점 (px, py), 이름표 폭 w, 높이 28.
//     위 (px − w/2, py − 16 − 4 − 28) -> 오른쪽 (px + 16 + 6, py − 14) -> 왼쪽 (px − 16 − 6 − w, py − 14) -> 아래 (px − w/2, py + 16 + 4)
//     화면 가장자리에서 8 안쪽이 아닌 후보는 건너뛴다(밀어 넣지 않는다, §12 중-4)
//   범위 원(pick-area 반지름 64)은 막는 것이 아니다 — 네 후보 모두 핀 중심에서 64 안이라 막는 것이면 이름표가 늘 빠진다(§1-3 "보임"과 어긋남)
//   **§27(11-19 결정권자 "추천대로")**: ① 위 버튼 줄 · 시트(키보드로 올라간 시트 포함)는 장애물, 여유 4(간격 4 이하면 다음 후보 — 크게 보기와 같은 판정)
//     위 버튼 줄 = y insets.top + 8 ~ + 52 (뒤로 x 16–60, 가운데 알약). 판을 몇 개로 나누든(줄 전체 · 부품마다) 결과가 같은 자리만 골랐다.
//     시트 윗변 = 844 − 키보드 − 258 (pick-panel 높이를 잰 값이 없을 때 258). 로고는 SDK가 그려 자리를 몰라 보지 않는다
//   ② 범위 원은 막지 않음, 그리는 순서(zIndex) 범위 원 < 이름표 < 핀
//   ③ 지도 영역 알림 전에는 핀만(이름표 없음). 단 이미 그린 이름표는 키보드가 열려 지도가 움직이는 동안에도 빼지 않는다(마지막 테스트, §26 뜻 그대로)
//   ④ 네 후보가 모두 안 되면 이름표를 뺀다(핀은 그대로)
//   **§28 질문 5(11-19)**: Google 로고도 장애물, 여유 4 (약관: 로고 · 출처 표시를 가리면 안 됨). 로고 자리 = '@/lib/map-logo' googleLogoRect(화면 크기, 지금 mapPadding)
//     로고 크기 · 안쪽 여백 값은 SDK가 정해 문서에 없다(질문) -> 시험은 함수가 준 사각형을 그대로 쓰고, 문서에서 온 성질만 본다:
//     보이는 영역(mapPadding 안쪽) 왼쪽 아래 (design §1-3 "시트가 가리지 않게 mapPadding.bottom", 코드 주석 "Google 로고가 가려지지 않게 mapPadding.bottom")
//     이름표 폭은 지금 160 + "…" 그대로 (200은 디자이너 확인)
//   키보드: 이름 칸 포커스 -> 키보드 336 -> 시트가 올라가고 지도는 핀을 띠 가운데로 민다(§24). 그 뒤 영역 알림이 오면 이름표가 새 핀 화면 자리 옆에 있다
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import fc from 'fast-check';
import { DeviceEventEmitter, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { googleLogoRect } from '@/lib/map-logo';
import { project, unproject, type Region } from '@/lib/map-project';
import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

import { mapControl } from '../test-support/maps-mock';

const WIDTH = 390;
const HEIGHT = 844;
const METRICS = { frame: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CENTER = { lat: 34.6662, lng: 135.501 }; // 시드 v3 center (§9 Q6)
const SPOT = { lat: 34.657913, lng: 135.506271 }; // 찍은 자리 (지어낸 값, 도시 중심에서 약 1km)
const KEYBOARD = 336;
const PIN_R = 16; // pin-pick 지름 32 (§1-3)
const LABEL_H = 28; // ②-06a 이름표 높이 (§13-6 · §12 하-2)
const GAP_TOP = 4; // B6: 핀과 위 4
const GAP_SIDE = 6; // B6: 옆 6
const EDGE = 8; // B6: 화면 가장자리에서 8 안쪽
const LNG_DELTA = 0.02; // 시험이 고른 지도 축척 (값 자체는 상관없다)
const NAME = '친구 집'; // §13-6 · §12 중-2의 예

type Host = { props: Record<string, any>; queryAll: (pick: (host: Host) => boolean) => Host[] };
type Rect = { x: number; y: number; width: number; height: number };
type Frame = { x: number; y: number; width: number; height: number };
type Side = 'top' | 'right' | 'left' | 'bottom';

const root = () => screen.root as unknown as Host;
const rad = (deg: number) => (deg * Math.PI) / 180;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const unmerc = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

const keyboardEvent = (height: number) => ({
  endCoordinates: { height, screenY: HEIGHT - height, screenX: 0, width: WIDTH },
  startCoordinates: { height: 0, screenY: HEIGHT, screenX: 0, width: WIDTH },
  duration: 0,
  easing: 'keyboard',
  isEventFromThisApp: true,
});

function pickMap(): Host {
  const map = root().queryAll((h) => h.props.mapElement === 'MapView' && h.props.testID === 'pick-map')[0];
  expect(map).toBeDefined(); // 시험 자체 확인: a4가 아니라 지도
  return map;
}

/** 지금 MapView mapPadding을 뺀 보이는 영역 (화면 좌표) */
function frameNow(): Frame {
  const mp = (pickMap().props.mapPadding ?? {}) as Record<string, number | undefined>;
  const [top, bottom, left, right] = [mp.top ?? 0, mp.bottom ?? 0, mp.left ?? 0, mp.right ?? 0];
  return { x: left, y: top, width: WIDTH - left - right, height: HEIGHT - top - bottom };
}

/** 좌표 at이 보이는 영역 frame 안에서 화면 점 (px, py)에 오는 지도 영역 (가로 · 세로 축척 같음) */
function regionPutting(at: { lat: number; lng: number }, point: { x: number; y: number }, frame: Frame): Region {
  const west = at.lng - ((point.x - frame.x) / frame.width) * LNG_DELTA;
  const span = rad(LNG_DELTA) * (frame.height / frame.width);
  const topMerc = merc(at.lat) + ((point.y - frame.y) / frame.height) * span;
  const north = unmerc(topMerc);
  const south = unmerc(topMerc - span);
  return { latitude: (north + south) / 2, longitude: west + LNG_DELTA / 2, latitudeDelta: north - south, longitudeDelta: LNG_DELTA };
}

async function regionSettles(region: Region) {
  await act(async () => {
    fireEvent(pickMap() as never, 'regionChangeComplete', region);
  });
}

/** 찍은 핀이 화면 점 point에 오게 지도 영역 알림을 준다. 돌려준 값으로 화면 점을 다시 계산한다 */
async function pinSettlesAt(pin: { lat: number; lng: number }, point: { x: number; y: number }) {
  const frame = frameNow();
  const region = regionPutting(pin, point, frame);
  await regionSettles(region);
  return { region, frame };
}

const styleOf = (host: Host | undefined) => (StyleSheet.flatten(host?.props.style) ?? {}) as Record<string, any>;

function tags(): Host[] {
  return pickMap().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'map-pin-label');
}

function tagBox(tag: Host): Host | undefined {
  return tag.queryAll((inner) => typeof styleOf(inner).width === 'number')[0];
}

function tagText(tag: Host): string {
  const texts = tag.queryAll((inner) => typeof inner.props.children === 'string' || (Array.isArray(inner.props.children) && inner.props.children.every((c: unknown) => typeof c === 'string')));
  const node = texts[0];
  if (!node) return '';
  return [node.props.children].flat().join('');
}

/** 그린 이름표의 화면 사각형 (Marker 좌표 = 가운데) */
function tagRect(tag: Host, region: Region, frame: Frame): Rect {
  const at = project(region, frame, tag.props.coordinate);
  const width = styleOf(tagBox(tag)).width as number;
  return { x: at.x - width / 2, y: at.y - LABEL_H / 2, width, height: LABEL_H };
}

function candidate(side: Side, pin: { x: number; y: number }, w: number): Rect {
  switch (side) {
    case 'top':
      return { x: pin.x - w / 2, y: pin.y - PIN_R - GAP_TOP - LABEL_H, width: w, height: LABEL_H };
    case 'right':
      return { x: pin.x + PIN_R + GAP_SIDE, y: pin.y - LABEL_H / 2, width: w, height: LABEL_H };
    case 'left':
      return { x: pin.x - PIN_R - GAP_SIDE - w, y: pin.y - LABEL_H / 2, width: w, height: LABEL_H };
    case 'bottom':
      return { x: pin.x - w / 2, y: pin.y + PIN_R + GAP_TOP, width: w, height: LABEL_H };
  }
}

const inside = (r: Rect) => r.x >= EDGE && r.y >= EDGE && r.x + r.width <= WIDTH - EDGE && r.y + r.height <= HEIGHT - EDGE;

/** 이름표 하나가 있고, 글이 name, 자리가 핀 화면 점 pin의 side 후보 (0.5 이내) */
function expectTagAt(side: Side, pin: { x: number; y: number }, region: Region, frame: Frame, name = NAME) {
  const all = tags();
  expect(all).toHaveLength(1);
  expect(tagText(all[0])).toBe(name);
  const drawn = tagRect(all[0], region, frame);
  expect(drawn.width).toBeGreaterThan(0);
  const want = candidate(side, pin, drawn.width);
  expect(Math.abs(drawn.x - want.x)).toBeLessThan(0.5);
  expect(Math.abs(drawn.y - want.y)).toBeLessThan(0.5);
  return drawn;
}

async function show(label: string | null = NAME, pin: { lat: number; lng: number } | null = SPOT) {
  const confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LodgingPickScreen cityCode="osaka" center={CENTER} onConfirm={confirm} onBack={jest.fn()} initial={pin ? { pin, label, tooFar: false } : undefined} />
    </SafeAreaProvider>,
  );
}

async function type(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('pick-label'), text);
  });
}

async function keyboardShow() {
  await act(async () => {
    fireEvent(screen.getByTestId('pick-label'), 'focus');
  });
  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillShow', keyboardEvent(KEYBOARD));
  });
  await act(async () => {
    DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(KEYBOARD));
  });
}

async function keyboardHide() {
  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillHide', keyboardEvent(0));
  });
  await act(async () => {
    DeviceEventEmitter.emit('keyboardDidHide', keyboardEvent(0));
  });
  await act(async () => {
    fireEvent(screen.getByTestId('pick-label'), 'blur');
  });
}

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  mapControl.reset();
  const window = Dimensions.get('window');
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: WIDTH, height: HEIGHT }));
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
    throw new Error('a2 화면은 네트워크를 부르지 않는다');
  }) as never);
});
afterEach(() => {
  fetchSpy.mockRestore();
  jest.restoreAllMocks();
});

describe('§26 a2 이름표 — 이름이 있으면 찍은 핀 옆에 보인다', () => {
  test('T15_S26_이름_칸에_친구_집이면_찍은_핀_위에_이름표_친구_집', async () => {
    await show(NAME);
    const point = { x: 195, y: 300 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    expect(frame.height).toBeGreaterThan(0); // 시험 자체 확인
    const pinAt = project(region, frame, { latitude: SPOT.lat, longitude: SPOT.lng });
    expect(Math.abs(pinAt.x - point.x)).toBeLessThan(0.01); // 시험 자체 확인: 핀이 고른 화면 점에
    expect(Math.abs(pinAt.y - point.y)).toBeLessThan(0.01);
    expectTagAt('top', point, region, frame);
  });

  test('T15_S26_앞뒤_공백은_잘라서_보인다_가운데_공백은_그대로', async () => {
    await show(null);
    const point = { x: 195, y: 300 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    await type('  친구 집 \t');
    expectTagAt('top', point, region, frame, '친구 집');
  });

  test('T15_S26_범위_원(반지름_64)_안이어도_위_후보를_쓴다(범위_원은_막는_것이_아니다)', async () => {
    await show(NAME);
    const point = { x: 195, y: 300 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    const drawn = expectTagAt('top', point, region, frame);
    // 시험 자체 확인: 위 후보 가운데는 핀 중심에서 64 안 (범위 원 안)
    expect(Math.hypot(drawn.x + drawn.width / 2 - point.x, drawn.y + LABEL_H / 2 - point.y)).toBeLessThan(64);
  });
});

describe('§26 a2 이름표 모양 — ②-06a 이름표 (높이 28 + 테두리 #E5E7EB 1, 흰 면, 12/16)', () => {
  test('T15_S26_이름표_높이_28_테두리_1_line색_흰_면_글자_12_16', async () => {
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    const all = tags();
    expect(all).toHaveLength(1);
    const box = styleOf(tagBox(all[0]));
    expect(box.height).toBe(LABEL_H);
    expect(box.borderWidth).toBe(1);
    expect(String(box.borderColor).toUpperCase()).toBe('#E5E7EB');
    expect(String(box.backgroundColor).toUpperCase()).toBe('#FFFFFF');
    const label = all[0].queryAll((inner) => inner.props.children === NAME)[0];
    const font = styleOf(label);
    expect(font.fontSize).toBe(12);
    expect(font.lineHeight).toBe(16);
  });
});

describe('§26 a2 이름표 자리 후보 — 위 -> 오른쪽 -> 왼쪽 -> 아래 (밀어 넣지 않는다)', () => {
  // 화면 390×844 · 키보드 없음 · 시트 258(윗변 586). 위 버튼 줄 = 뒤로 x16–60 · 가운데 알약, y 55–99 (insets.top 47 + 8, 높이 44)
  test('T15_S26_위가_되면_위', async () => {
    await show(NAME);
    const point = { x: 195, y: 400 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    expectTagAt('top', point, region, frame);
  });

  test('T15_S26_위가_화면_왼쪽_8_밖이면_오른쪽', async () => {
    await show(NAME);
    const point = { x: 20, y: 400 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    const drawn = expectTagAt('right', point, region, frame);
    expect(inside(candidate('top', point, drawn.width))).toBe(false); // 시험 자체 확인
  });

  test('T15_S26_위_오른쪽이_화면_오른쪽_8_밖이면_왼쪽', async () => {
    await show(NAME);
    const point = { x: 375, y: 400 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    const drawn = expectTagAt('left', point, region, frame);
    expect(inside(candidate('top', point, drawn.width))).toBe(false); // 시험 자체 확인
    expect(inside(candidate('right', point, drawn.width))).toBe(false);
  });

  test('T15_S26_경계_위_후보_오른쪽_끝이_화면_8_안쪽에_딱_닿으면_위_0.5_넘으면_왼쪽', async () => {
    // 위 후보 오른쪽 끝 = px + w/2. 382(= 390 − 8)면 안쪽(위), 382.5면 밖 -> 오른쪽도 밖 -> 왼쪽
    await show(NAME);
    const first = await pinSettlesAt(SPOT, { x: 195, y: 400 });
    const w = tagRect(tags()[0], first.region, first.frame).width;
    expect(w).toBeGreaterThan(0);
    const on = { x: WIDTH - EDGE - w / 2, y: 400 };
    const atEdge = await pinSettlesAt(SPOT, on);
    expectTagAt('top', on, atEdge.region, atEdge.frame);
    const past = { x: WIDTH - EDGE - w / 2 + 0.5, y: 400 };
    const over = await pinSettlesAt(SPOT, past);
    expectTagAt('left', past, over.region, over.frame);
  });

  test('T15_S26_네_후보가_모두_안_되면_이름표를_뺀다(핀은_그대로)', async () => {
    // §27 ④: 오른쪽 위 구석 — 위(화면 위) · 오른쪽(화면 오른쪽) · 왼쪽(화면 위) · 아래(화면 오른쪽) 모두 8 안쪽을 벗어남
    await show(NAME);
    const first = await pinSettlesAt(SPOT, { x: 195, y: 400 });
    const w = tagRect(tags()[0], first.region, first.frame).width;
    const corner = { x: 375, y: 20 };
    for (const side of ['top', 'right', 'left', 'bottom'] as const) expect(inside(candidate(side, corner, w))).toBe(false); // 시험 자체 확인
    await pinSettlesAt(SPOT, corner);
    expect(tags()).toHaveLength(0);
    expect(pickMap().queryAll((h) => h.props.testID === 'pin-pick')).not.toHaveLength(0);
  });
});

describe('§27 ① a2 이름표는 위 버튼 줄 · 시트와 4 넘게 띄운다 (간격 4 이하면 다음 후보)', () => {
  test('T15_S27_경계_위_후보가_위_버튼_줄(뒤로)과_간격_4면_오른쪽_4.5면_위', async () => {
    // 핀 x 60: 위 후보(가로 60 ± w/2)가 뒤로 버튼(x 16–60) 아래. 위 후보 윗변 = py − 48, 버튼 아랫변 99 -> py 151이면 간격 4, 151.5면 4.5
    await show(NAME);
    const touching = { x: 60, y: 151 };
    const a = await pinSettlesAt(SPOT, touching);
    expectTagAt('right', touching, a.region, a.frame);
    const apart = { x: 60, y: 151.5 };
    const b = await pinSettlesAt(SPOT, apart);
    expectTagAt('top', apart, b.region, b.frame);
  });

  test('T15_S27_위_버튼_줄_바로_아래_가운데_핀은_위·오른쪽·왼쪽이_막혀_아래', async () => {
    // 핀 (195, 110): 위 후보는 줄과 겹치고, 옆 후보(y 96–124)는 가운데 알약(y 59–95, 가운데 195)과 간격 1
    await show(NAME);
    const point = { x: 195, y: 110 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    expectTagAt('bottom', point, region, frame);
  });

  // §28: Google 로고(보이는 영역 왼쪽 아래)를 피하게 되어 시트 경계는 오른쪽 끝 핀으로 본다 (옛: x 20 · 오른쪽 후보)
  test('T15_S27_경계_시트_윗변(586)과_간격_4면_뺌_4.5면_왼쪽', async () => {
    // 핀 x 375(위 · 오른쪽은 화면 밖). 왼쪽 후보 아랫변 = py + 14 -> py 568이면 시트와 4(막힘), 아래 후보는 시트 안 -> 이름표 없음. 567.5면 4.5 -> 왼쪽
    await show(NAME);
    const touching = { x: 375, y: HEIGHT - 258 - 4 - 14 };
    await pinSettlesAt(SPOT, touching);
    expect(tags()).toHaveLength(0);
    const apart = { x: 375, y: HEIGHT - 258 - 4.5 - 14 };
    const b = await pinSettlesAt(SPOT, apart);
    expectTagAt('left', apart, b.region, b.frame);
  });

  test('T15_S27_키보드로_올라간_시트(윗변_844−336−258=250)도_장애물', async () => {
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    await keyboardShow();
    const sheetTop = HEIGHT - KEYBOARD - 258;
    const touching = { x: 375, y: sheetTop - 4 - 14 }; // §28: 로고를 피하려고 옛 x 20 · 오른쪽 -> x 375 · 왼쪽
    await pinSettlesAt(SPOT, touching);
    expect(tags()).toHaveLength(0);
    const apart = { x: 375, y: sheetTop - 4.5 - 14 };
    const b = await pinSettlesAt(SPOT, apart);
    expectTagAt('left', apart, b.region, b.frame);
  });
});

describe('§27 ② ③ a2 그리는 순서 · 영역 알림 전', () => {
  test('T15_S27_그리는_순서는_범위_원_->_이름표_->_핀(zIndex)', async () => {
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    const z = (id: string) => {
      const found = pickMap().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === id);
      expect(found).toHaveLength(1);
      return Number(found[0].props.zIndex ?? 0);
    };
    expect(z('pick-area')).toBeLessThan(z('map-pin-label'));
    expect(z('map-pin-label')).toBeLessThan(z('pin-pick'));
  });

  test('T15_S27_지도_영역_알림_전에는_핀만(이름표_없음)_알림_뒤에_이름표', async () => {
    await show(NAME);
    expect(pickMap().queryAll((h) => h.props.mapElement === 'Marker' && h.props.testID === 'pin-pick')).toHaveLength(1);
    expect(tags()).toHaveLength(0);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    expect(tags()).toHaveLength(1);
  });
});

describe('§26 a2 이름 칸이 비면 이름표 없음', () => {
  test.each([
    ['이름을 안 쳤음(null)', null],
    ['빈 글', ''],
    ['공백만', '   '],
    ['탭 · 줄바꿈만', ' \t\n '],
  ])('T15_S26_이름_칸_%s이면_이름표_없음', async (_what, label) => {
    await show(label);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    expect(pickMap().queryAll((h) => h.props.testID === 'pin-pick')).not.toHaveLength(0); // 시험 자체 확인: 핀은 있다
    expect(tags()).toHaveLength(0);
  });

  test('T15_S26_핀을_찍기_전에는_이름표_없음', async () => {
    await show(null, null);
    await regionSettles(regionPutting(CENTER, { x: 195, y: 300 }, frameNow()));
    expect(tags()).toHaveLength(0);
  });
});

describe('§26 a2 이름표는 치는 대로 바뀐다', () => {
  test('T15_S26_글을_바꾸면_이름표_글이_바로_바뀌고_지우면_사라지고_다시_치면_돌아온다', async () => {
    await show(null);
    const point = { x: 195, y: 300 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    expect(tags()).toHaveLength(0);
    await type('친');
    expectTagAt('top', point, region, frame, '친');
    await type('친구 집');
    expectTagAt('top', point, region, frame, '친구 집');
    await type('친구 집 2층');
    expectTagAt('top', point, region, frame, '친구 집 2층');
    await type('');
    expect(tags()).toHaveLength(0);
    await type('  ');
    expect(tags()).toHaveLength(0);
    await type('민박');
    expectTagAt('top', point, region, frame, '민박');
  });

  test('T15_S26_속성_어떤_글이든_이름표는_자른_글이_있을_때만_있고_글이_자른_글과_같다', async () => {
    await show(null);
    const point = { x: 195, y: 400 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    const char = fc.constantFrom(' ', '\t', '\n', '친', '구', '집', 'A', 'b', '1', '·');
    await fc.assert(
      fc.asyncProperty(fc.array(char, { maxLength: 30 }), async (chars) => {
        const text = chars.join('');
        await type(text);
        const trimmed = text.trim();
        if (trimmed === '') expect(tags()).toHaveLength(0);
        else expectTagAt('top', point, region, frame, trimmed);
      }),
      { numRuns: 40 },
    );
  });
});

describe('§26 a2 핀을 다시 찍으면 이름표가 새 핀 옆으로', () => {
  test('T15_S26_다시_길게_누르면_이름표가_새_핀_위로_옮겨_간다(글은_그대로)', async () => {
    await show(NAME);
    const first = { x: 195, y: 300 };
    const { region, frame } = await pinSettlesAt(SPOT, first);
    expectTagAt('top', first, region, frame);
    // 지도는 움직이지 않고(길게 누름은 카메라를 옮기지 않는다) 다른 자리를 찍는다
    const second = { x: 120, y: 460 };
    const at = unproject(region, frame, second);
    await act(async () => {
      fireEvent(pickMap() as never, 'longPress', { nativeEvent: { coordinate: at } });
    });
    expectTagAt('top', second, region, frame);
  });

  test('T15_S26_새_핀이_화면_오른쪽_끝이면_새_자리에서_다시_후보를_고른다(왼쪽)', async () => {
    await show(NAME);
    const { region, frame } = await pinSettlesAt(SPOT, { x: 195, y: 300 });
    const edge = { x: 375, y: 420 };
    await act(async () => {
      fireEvent(pickMap() as never, 'longPress', { nativeEvent: { coordinate: unproject(region, frame, edge) } });
    });
    expectTagAt('left', edge, region, frame);
  });
});

describe('§26 a2 이름표는 키보드 열림 · 닫힘 모두에서 보인다', () => {
  test('T15_S26_키보드_닫힘_열림_닫힘_세_장면_모두_이름표_친구_집이_핀_위', async () => {
    await show(NAME);
    // 닫힘
    const closed = { x: 195, y: 300 };
    const a = await pinSettlesAt(SPOT, closed);
    expectTagAt('top', closed, a.region, a.frame);
    // 열림: 시트가 키보드 위로, 지도는 핀을 띠(위 버튼 줄 아래 ~ 시트 윗변) 가운데로 민다 (§24 · §12 중-2)
    await keyboardShow();
    const band = frameNow();
    expect(band.y).toBeGreaterThan(0); // 시험 자체 확인: 띠가 생겼다 (mapPadding.top)
    expect(band.height).toBeGreaterThan(0);
    const open = { x: WIDTH / 2, y: band.y + band.height / 2 };
    const b = await pinSettlesAt(SPOT, open);
    expectTagAt('top', open, b.region, b.frame);
    // 열린 채로 글을 바꿔도 바로 바뀐다
    await type('친구 집 ');
    expectTagAt('top', open, b.region, b.frame, '친구 집');
    // 닫힘 (다시)
    await keyboardHide();
    const again = { x: 195, y: 320 };
    const c = await pinSettlesAt(SPOT, again);
    expectTagAt('top', again, c.region, c.frame, '친구 집');
  });

  test('T15_S26_키보드가_열린_채_영역_알림이_오기_전에도_이름표가_사라지지_않는다', async () => {
    // 키보드가 열리면 지도가 움직인다. 움직이는 동안 자리는 보지 않지만, 이름이 있는 한 이름표를 빼지는 않는다 (§13-6 "a2 키보드 열림 · 이름표 보임")
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    expect(tags()).toHaveLength(1);
    await keyboardShow();
    expect(tags()).toHaveLength(1);
    expect(tagText(tags()[0])).toBe(NAME);
  });
});

describe('§28 질문 5 — Google 로고 자리 (googleLogoRect, 순수 함수)', () => {
  const SIZE = { width: WIDTH, height: HEIGHT };
  const CLOSED = { top: 0, bottom: 258, left: 0, right: 0 };

  test('T15_S28_로고는_보이는_영역(mapPadding_안쪽)_왼쪽_아래에_있다', () => {
    const logo = googleLogoRect(SIZE, CLOSED);
    expect(logo.width).toBeGreaterThan(0);
    expect(logo.height).toBeGreaterThan(0);
    expect(logo.x).toBeGreaterThanOrEqual(CLOSED.left);
    expect(logo.x + logo.width).toBeLessThanOrEqual(WIDTH / 2);
    expect(logo.y).toBeGreaterThanOrEqual(HEIGHT / 2);
    expect(logo.y + logo.height).toBeLessThanOrEqual(HEIGHT - CLOSED.bottom);
  });

  test('T15_S28_mapPadding이_바뀌면_로고가_같은_크기로_따라간다(키보드_띠)', () => {
    const closed = googleLogoRect(SIZE, CLOSED);
    const band = { top: 99, bottom: HEIGHT - 250, left: 0, right: 0 }; // 키보드 336 + 시트 258 -> 보이는 띠 99~250
    const open = googleLogoRect(SIZE, band);
    expect({ width: open.width, height: open.height }).toEqual({ width: closed.width, height: closed.height });
    expect(open.x).toBe(closed.x);
    expect(open.y).toBeCloseTo(closed.y - (band.bottom - CLOSED.bottom), 6);
    expect(open.y + open.height).toBeLessThanOrEqual(250);
    expect(open.y).toBeGreaterThanOrEqual(band.top);
    const shifted = googleLogoRect(SIZE, { ...CLOSED, left: 10 });
    expect(shifted.x).toBeCloseTo(closed.x + 10, 6);
  });
});

describe('§28 질문 5 — a2 이름표는 Google 로고와 4 넘게 띄운다', () => {
  const gapOf = (a: Rect, b: Rect) => Math.hypot(Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0), Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0));
  const logoNow = () => {
    const mp = (pickMap().props.mapPadding ?? {}) as Record<string, number | undefined>;
    return googleLogoRect({ width: WIDTH, height: HEIGHT }, { top: mp.top ?? 0, bottom: mp.bottom ?? 0, left: mp.left ?? 0, right: mp.right ?? 0 });
  };
  async function widthOfTag() {
    const first = await pinSettlesAt(SPOT, { x: 195, y: 400 });
    const w = tagRect(tags()[0], first.region, first.frame).width;
    expect(w).toBeGreaterThan(0); // 시험 자체 확인
    return w;
  }
  /** 위 후보가 로고와 가로로 겹치고, 위 후보 아랫변이 로고 윗변에서 gap 위에 오는 핀 자리 */
  const aboveLogo = (logo: Rect, w: number, gap: number) => {
    const x = Math.min(Math.max(logo.x + logo.width / 2, EDGE + w / 2 + 1), WIDTH - EDGE - w / 2 - 1);
    return { x, y: logo.y - gap + PIN_R + GAP_TOP };
  };

  test('T15_S28_위_후보가_로고에_걸리면_위가_아닌_자리_또는_뺌_어느_쪽이든_로고와_4_넘게', async () => {
    await show(NAME);
    const w = await widthOfTag();
    const logo = logoNow();
    // 위 후보 가운데 = 로고 가운데 높이
    const base = aboveLogo(logo, w, 0);
    const point = { x: base.x, y: logo.y + logo.height / 2 + PIN_R + GAP_TOP + LABEL_H / 2 };
    expect(gapOf(candidate('top', point, w), logo)).toBe(0); // 시험 자체 확인: 위 후보가 로고와 겹친다
    const { region, frame } = await pinSettlesAt(SPOT, point);
    const all = tags();
    expect(all.length).toBeLessThanOrEqual(1);
    if (all.length === 1) expect(gapOf(tagRect(all[0], region, frame), logo)).toBeGreaterThan(4);
    expect(pickMap().queryAll((h) => h.props.testID === 'pin-pick')).not.toHaveLength(0);
  });

  test('T15_S28_경계_위_후보가_로고_위로_간격_4면_위가_아님_4.5면_위', async () => {
    await show(NAME);
    const w = await widthOfTag();
    const logo = logoNow();
    const touching = aboveLogo(logo, w, 4);
    expect(gapOf(candidate('top', touching, w), logo)).toBeCloseTo(4, 6); // 시험 자체 확인: 로고 바로 위(가로로 겹침)
    const a = await pinSettlesAt(SPOT, touching);
    const drawn = tags();
    if (drawn.length === 1) {
      const rect = tagRect(drawn[0], a.region, a.frame);
      expect(Math.abs(rect.y - candidate('top', touching, w).y) < 0.5 && Math.abs(rect.x - candidate('top', touching, w).x) < 0.5).toBe(false);
      expect(gapOf(rect, logo)).toBeGreaterThan(4);
    }
    const apart = aboveLogo(logo, w, 4.5);
    expect(gapOf(candidate('top', apart, w), logo)).toBeCloseTo(4.5, 6);
    const b = await pinSettlesAt(SPOT, apart);
    expectTagAt('top', apart, b.region, b.frame);
  });

  test('T15_S28_키보드가_열려_로고가_띠_아래로_올라가도_이름표가_로고와_4_넘게', async () => {
    await show(NAME);
    const w = await widthOfTag();
    await keyboardShow();
    const logo = logoNow();
    expect(logo.y + logo.height).toBeLessThanOrEqual(HEIGHT - KEYBOARD - 258); // 시험 자체 확인: 올라간 시트 위
    const point = { x: aboveLogo(logo, w, 0).x, y: logo.y + logo.height / 2 + PIN_R + GAP_TOP + LABEL_H / 2 };
    const { region, frame } = await pinSettlesAt(SPOT, point);
    for (const tag of tags()) expect(gapOf(tagRect(tag, region, frame), logo)).toBeGreaterThan(4);
  });
});

// ---------- TASK-015 §30 중 1: mapPadding이 바뀌면 영역은 "확정 전" -> 지도에 지금 경계를 직접 묻고(getMapBoundaries) 그 답으로 다시 계산 ----------
// 근거: TASK-015 §30 "a2에서 키보드를 닫은 직후 핀을 다시 찍으면 위 자리가 비었는데도 이름표가 아래로 가거나 빠짐 · 원인 추정: 지도 여백이 바뀌는데 영역 알림이 안 옴 ·
//   규칙: mapPadding이 바뀌면 그때의 영역을 '확정 전'으로 보고, 지도에 지금 경계를 직접 물어(getMapBoundaries 등) 다시 계산한다. 알림을 기다리지 않음"
// 계약 (정한 것):
//   MapView ref getMapBoundaries() -> { northEast, southWest } (react-native-maps). 답 = 지금 보이는 영역(mapPadding 안쪽)의 북동 · 남서 모서리 -> region(가운데 · 폭)으로 바꿔 쓴다
//   mapPadding이 바뀌면 한 번 이상 묻는다. 답이 오기 전(확정 전)에는 새 자리를 계산하지 않는다:
//     핀이 그대로면 이미 그린 이름표를 그대로 둔다(§26 "키보드 열림 때 빠지지 않음" 뜻) · 핀을 새로 찍으면 답이 올 때까지 이름표 없음(§22 · §27 ③ "확정 전엔 핀만"과 같은 원칙)
//   답이 오면 그 영역으로 다시 계산한다. 그 뒤 온 영역 알림은 지금처럼 쓴다
describe('§30 a2 키보드를 닫은 직후 — 지도에 경계를 물어 다시 계산', () => {
  const boundsOf = (region: Region) => ({
    northEast: { latitude: region.latitude + region.latitudeDelta / 2, longitude: region.longitude + region.longitudeDelta / 2 },
    southWest: { latitude: region.latitude - region.latitudeDelta / 2, longitude: region.longitude - region.longitudeDelta / 2 },
  });
  function deferAnswer() {
    let answer!: (value: ReturnType<typeof boundsOf>) => void;
    const promise = new Promise<ReturnType<typeof boundsOf>>((done) => (answer = done));
    mapControl.boundaries = () => promise;
    return answer;
  }

  async function openThenClose() {
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    await keyboardShow();
    const band = frameNow();
    const open = { x: WIDTH / 2, y: band.y + band.height / 2 };
    const opened = await pinSettlesAt(SPOT, open); // 키보드 열림 때 영역 알림 (지도가 핀을 띠 가운데로)
    expectTagAt('top', open, opened.region, opened.frame);
    const answer = deferAnswer();
    const asked = mapControl.boundaryAsks;
    await keyboardHide(); // mapPadding이 시트 258로 돌아감. 영역 알림은 오지 않는다
    const closed = frameNow();
    expect(closed.height).toBeGreaterThan(band.height); // 시험 자체 확인: 여백이 바뀌었다
    // 지도 SDK는 카메라 가운데(핀)를 바뀐 여백 안쪽 가운데로 둔다 -> 핀이 새 보이는 영역 가운데로 옮겨 보인다. 그 기준의 진짜 영역 (옛 영역과 화면 자리가 다르다)
    const now = { x: WIDTH / 2, y: closed.y + closed.height / 2 };
    const truth = regionPutting(SPOT, now, closed);
    return { opened, open, now, closed, truth, answer, asked };
  }

  test('T15_S30_mapPadding이_바뀌면_지도에_경계를_묻는다', async () => {
    const { asked } = await openThenClose();
    expect(mapControl.boundaryAsks).toBeGreaterThan(asked);
  });

  test('T15_S30_답이_오면_새_경계로_다시_계산(핀은_그대로_위_자리)', async () => {
    const { now, closed, truth, answer } = await openThenClose();
    await act(async () => {
      answer(boundsOf(truth));
    });
    expectTagAt('top', now, truth, closed);
  });

  test('T15_S30_키보드를_닫은_직후_다시_찍으면_답이_오기_전엔_이름표_없음_답이_오면_새_핀_위', async () => {
    const { opened, closed, truth, answer } = await openThenClose();
    const next = { x: 195, y: 420 };
    const at = unproject(truth, closed, next);
    // 시험 자체 확인: 옛(키보드 열렸을 때) 영역으로 보면 이 좌표는 다른 화면 자리다 -> 옛 영역으로 계산하면 이름표가 틀린 자리
    const stale = project(opened.region, opened.frame, at);
    expect(Math.hypot(stale.x - next.x, stale.y - next.y)).toBeGreaterThan(1);
    await act(async () => {
      fireEvent(pickMap() as never, 'longPress', { nativeEvent: { coordinate: at } });
    });
    expect(tags()).toHaveLength(0); // 확정 전엔 새 자리를 계산하지 않는다
    await act(async () => {
      answer(boundsOf(truth));
    });
    expectTagAt('top', next, truth, closed);
  });

  test('T15_S30_답이_오기_전_핀이_그대로면_그린_이름표는_빠지지_않는다(§26_뜻)', async () => {
    await openThenClose();
    expect(tags()).toHaveLength(1);
    expect(tagText(tags()[0])).toBe(NAME);
  });
});

// ---------- TASK-015 §31 중-9 (task-015-design §17-3): 시트 높이 · 키보드가 바뀐 직후에도 다시 계산 ----------
// 규칙(디자이너): 이름표 자리는 "카메라가 멈춘 뒤"만이 아니라 시트 높이 · 키보드가 바뀐 직후(레이아웃이 자리잡은 다음 프레임)에도 다시 계산한다
// 계약 (정한 것): pick-panel 높이(onLayout)가 바뀌거나 키보드 높이가 바뀌면 mapPadding이 그대로여도 지도에 경계를 다시 묻고(getMapBoundaries),
//   답이 오면 새 시트 윗변(844 − 키보드 − 잰 시트 높이)을 장애물로 다시 계산한다 (여유 4 그대로)
describe('§31 a2 시트 높이 · 키보드 높이가 바뀌면 경계를 다시 묻고 다시 계산', () => {
  const boundsOf = (region: Region) => ({
    northEast: { latitude: region.latitude + region.latitudeDelta / 2, longitude: region.longitude + region.longitudeDelta / 2 },
    southWest: { latitude: region.latitude - region.latitudeDelta / 2, longitude: region.longitude - region.longitudeDelta / 2 },
  });
  async function panelHeight(height: number) {
    await act(async () => {
      (screen.getByTestId('pick-panel') as unknown as Host).props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: HEIGHT - height, width: WIDTH, height } } });
    });
  }

  test('T15_S31_키보드_없이_시트가_300으로_커지면_묻고_새_시트_윗변(544)으로_다시_계산', async () => {
    await show(NAME);
    // 핀 x 375: 위 · 오른쪽은 화면 밖, 왼쪽 후보 아랫변 = py + 14. py 530 -> 544(새 시트 윗변)와 간격 0, 옛 시트 윗변 586과는 42
    const point = { x: 375, y: 530 };
    const settled = await pinSettlesAt(SPOT, point);
    expectTagAt('left', point, settled.region, settled.frame); // 옛 시트(258)로는 왼쪽이 된다
    const asked = mapControl.boundaryAsks;
    mapControl.boundaries = () => Promise.resolve(boundsOf(settled.region));
    await panelHeight(300);
    expect(mapControl.boundaryAsks).toBeGreaterThan(asked);
    await act(async () => undefined);
    expect(tags()).toHaveLength(0); // 왼쪽은 새 시트와 닿고 아래는 시트 안 -> 뺌
  });

  test('T15_S31_키보드_높이가_바뀌면(336_->_300)_다시_묻는다', async () => {
    await show(NAME);
    await pinSettlesAt(SPOT, { x: 195, y: 300 });
    await keyboardShow();
    const asked = mapControl.boundaryAsks;
    await act(async () => {
      DeviceEventEmitter.emit('keyboardWillShow', keyboardEvent(300));
    });
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(300));
    });
    expect(mapControl.boundaryAsks).toBeGreaterThan(asked);
  });
});
