/// <reference types="jest" />
// TASK-014 §19 디자이너 구현 검수 반영 (docs/design/reviews/task-014-design.md §9-1·§9-2·§9-3·§9-8 표, 캔버스 V115).
// 근거: TASK-014 §19, task-014-design §2(reh-band·reh-clock 값)·§9, DESIGN-001 §4-11(btn-new-trip 끝난 여행 = 주 버튼)·§4-12(head-avatar)·§4-13(reh-band 맨 위까지),
//       TASK-011 §9 Q1(11-14 고침). T-01 시트 모양(§9-4)은 범위 밖이라 쓰지 않는다.
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 질문 목록 참고):
//   연습 띠 `rehearsal-band` = ink 바탕 상자 하나가 화면 맨 위(top 0)부터 높이 안전 영역 + 52 (METRICS top 47 -> 99)
//   상태 표시줄: expo-status-bar. 연습 중에만 style "light" (<StatusBar style="light" /> 또는 setStatusBarStyle('light')). 연습을 끝내면 light가 남지 않는다
//   연습 카드 시트 기본 윗변 = 앱 844 화면에서 y 546, 위로 끌면 417 (TASK-015 §B3, 이전 874 화면 434). 지도 카메라 아래 여백 >= 440 + 시계 판 112 (§20 Q3 하한)
//   시계 판: "연습 시계"(12/16 muted)와 시각이 위아래 두 줄. [10분](§21 3, 옛 "+10분") `demo-plus-10`·[재생] `demo-play` 안에 아이콘(Svg) 하나씩.
//           막대 손잡이 testID `demo-thumb` = 보이는 28, 그 손잡이를 받는 상자(onStartShouldSetResponder)의 높이 44 이상
//   SOS 시트(`sheet-scrim`·`sos-sheet`): 스크림이 위쪽 컨트롤(SOS·연습 띠)보다 위에 그려진다 = Modal 안이거나,
//           공통 조상 아래에서 스크림 쪽 zIndex 최댓값 > 컨트롤 쪽 zIndex 최댓값 그리고 elevation >= (Android)
//           시트 안 손잡이 36×4. 글자 "경찰 110 · 구급·소방 119" 한 줄, 누를 수 없음(onPress·onClick·link 없음)
//   날짜 목록: 날짜 숫자(예 "12/11")는 DM Mono, 요일 글자(금)는 DM Mono 아님. 머리 아바타 `head-avatar` 안 = 사람 아이콘(Svg 24, 선 #333333), 웃는 얼굴 아님
//           끝난 여행(지난 날만)의 [새 여행 만들기] `new-trip` = 주 버튼(brand 바탕 · 52 · r16 · 17/24·700 · 글자 #1A1A1A). 여행 전 모두 계획 완료는 보조 그대로
//   값으로 못 고정하는 것: D6 머리 위치 16~20pt 차이(안전 영역 값 확인) — reviewer 스크린샷 확인 항목
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { COLORS } from '../test-support/design-table';
import { FakeServer, json, type Sent } from '../test-support/fake-server';
import { locationFake } from '../test-support/expo-location-mock';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice, tap } from '../test-support/planning-driver';
import { day as demoDay } from '../test-support/planning-fixtures';
import { nowView } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

// 상태 표시줄 가짜: 선언형(<StatusBar style>)은 화면 나무에 남기고, 명령형(setStatusBarStyle)은 기록한다
const mockStatusCalls: string[] = [];
jest.mock('expo-status-bar', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    StatusBar: (props: { style?: string }) => createElement(View, { testID: 'status-bar', statusBarStyle: props.style }),
    setStatusBarStyle: (style: string) => {
      mockStatusCalls.push(style);
    },
    setStatusBarHidden: () => undefined,
    setStatusBarBackgroundColor: () => undefined,
    setStatusBarTranslucent: () => undefined,
    setStatusBarNetworkActivityIndicatorVisible: () => undefined,
  };
});

const INSET_TOP = 47;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: INSET_TOP, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (day-t2가 오늘)
const PLANNED = 'day-t3';
const PLANNED_DATE = '2026-12-03';
const BAND = 52; // DESIGN-001 §4-13 reh-band 띠 내용 높이
const REH_SHEET = 440; // task-014-design §2 "높이 516 -> 440" (카메라 여백 하한에만 쓴다, §20 Q3)
const APP_WIDTH = 390; // TASK-015 §B3: 앱 844 기준 (METRICS와 같은 폰)
const APP_HEIGHT = 844;
const REH_SHEET_TOP = 546; // TASK-015 §B3 · task-014-design §12-1: 앱 844에서 연습 카드 시트 기본 윗변 y (이전 874 화면 434)
const REH_SHEET_TOP_UP = 417; // 같은 곳: 위로 끌면 이 윗변까지 (이전 기본 단 값)
const REH_CLOCK = 112; // DESIGN-001 §4-13 reh-clock 높이
const EMERGENCY = '경찰 110 · 구급·소방 119'; // TASK-014 §19

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const trip = (states: string[] = ['past', 'today', 'planned', 'planning']) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: `2026-12-0${states.length}`,
  lodging: null, // TASK-015 §11 Q10 응답 새 모양 (이전: lodging_place_id: null)
  status: 'active',
  is_demo: false,
  trip_days: states.map((state, index) => tripDay(index + 1, state)),
});
const plannedDay = { ...demoDay, day_id: PLANNED, date: PLANNED_DATE };
const rehearsalView = (over: object = {}) => nowView({ day: plannedDay, ...over });

// ---------- 화면 나무 도구 ----------

type Host = { type: unknown; props: Record<string, any>; parent: Host | null; children: (Host | string)[]; queryAll: (pick: (host: Host) => boolean) => Host[] };
const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Host;
const root = () => screen.root as unknown as Host;
const chain = (host: Host): Host[] => {
  const list: Host[] = [];
  for (let now: Host | null = host; now; now = now.parent) list.push(now);
  return list;
};
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toUpperCase() === b.toUpperCase();
const svgsIn = (host: Host) => host.queryAll((inner) => inner.props.svgElement === 'Svg');
const pathsIn = (host: Host) => host.queryAll((inner) => inner.props.svgElement === 'Path');
/** 이 상자가 직접 가진 글자 (안에 든 다른 Text는 빼고) */
const ownText = (host: Host) =>
  (Array.isArray(host.props.children) ? host.props.children : [host.props.children]).filter((part: unknown) => typeof part === 'string' || typeof part === 'number').join('');
const textHosts = (under: Host) => under.queryAll((inner) => inner.type === 'Text');
const commonAncestor = (a: Host, b: Host): Host => {
  const outer = chain(b);
  const found = chain(a).find((host) => outer.includes(host));
  if (!found) throw new Error('같은 화면 나무가 아니다');
  return found;
};
/** host에서 위로 올라가며 ancestor 바로 아래까지 (ancestor는 빼고) */
const pathBelow = (host: Host, ancestor: Host) => chain(host).slice(0, chain(host).indexOf(ancestor));
const maxOf = (path: Host[], key: 'zIndex' | 'elevation') => Math.max(0, ...path.map((one) => Number(styleOf(one)[key] ?? 0)));
const inModal = (host: Host) => chain(host).some((one) => one.type === 'Modal' || one.type === 'RCTModalHostView');
/** 위에 그려지는가: Modal 안이면 늘 위. 아니면 공통 조상 아래에서 zIndex가 더 크고 elevation이 같거나 크다 */
function drawnAbove(top: Host, under: Host): boolean {
  if (inModal(top)) return true;
  const common = commonAncestor(top, under);
  const mine = pathBelow(top, common);
  const theirs = pathBelow(under, common);
  return maxOf(mine, 'zIndex') > maxOf(theirs, 'zIndex') && maxOf(mine, 'elevation') >= maxOf(theirs, 'elevation');
}

// ---------- 연습 화면까지 ----------

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

function startHome(metrics: typeof METRICS = METRICS) {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Index />
    </SafeAreaProvider>,
  );
}

let server: FakeServer;
let nowReply: () => ReturnType<typeof json>;
const body = (sent: Sent) => (sent.body ?? {}) as Record<string, unknown>;

async function toRehearsal(metrics: typeof METRICS = METRICS) {
  await startHome(metrics);
  await tap(await screen.findByTestId(`rehearse-${PLANNED}`));
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  await settleAll();
}

const statusLight = () =>
  screen.queryAllByTestId('status-bar').some((host) => host.props.statusBarStyle === 'light') || mockStatusCalls[mockStatusCalls.length - 1] === 'light';

/** 시트 단 값 -> 영역 안 높이(px). '44%'·0.44는 영역 비율, 1보다 큰 수·'440'은 그대로 */
const snapPx = (point: unknown, area: number) => {
  if (typeof point === 'number') return point <= 1 ? point * area : point;
  const text = String(point);
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * area : Number(text);
};

beforeEach(() => {
  resetDevice();
  locationFake.reset();
  mapControl.reset();
  sheetControl.reset();
  mockStatusCalls.length = 0;
  (Constants as unknown as { expoConfig: unknown }).expoConfig = null;
  freezeDate(NOW_ISO);
  server = new FakeServer().on(CURRENT, json(200, trip()));
  nowReply = () => json(200, rehearsalView());
  server.match(`GET /days/${PLANNED}/now`, () => nowReply());
  server.match(`POST /days/${PLANNED}/check`, (sent) => json(200, rehearsalView({ at: body(sent).at })));
  server.on(`GET /days/${PLANNED}/course`, json(200, require('../test-support/planning-fixtures').relaxed('opt-3')));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// =====================================================================
// 상: 연습 띠 맨 위까지 · 상태 표시줄 light (연습 중만) · 카메라 아래 여백
// 근거: TASK-014 §19 상, task-014-design §9-2 상·§9-8 1·2줄, DESIGN-001 §4-13 reh-band
// =====================================================================

describe('§19 상 연습 띠는 화면 맨 위까지', () => {
  test('T14_S19_띠_바탕은_맨_위_0부터_안전_영역_더하기_52', async () => {
    await toRehearsal();
    const band = styleOf(byId('rehearsal-band'));
    expect(band.top ?? 0).toBe(0);
    expect(band.height ?? band.minHeight).toBe(INSET_TOP + BAND);
    expect(within(screen.getByTestId('rehearsal-band')).getByText('연습 중')).toBeTruthy(); // 띠 글자는 그대로
  });

  test('T14_S19_연습_중에는_상태_표시줄이_light', async () => {
    await toRehearsal();
    expect(statusLight()).toBe(true);
  });

  test('T14_S19_경계_연습에_들어가기_전_날짜_목록은_light가_아니다', async () => {
    await startHome();
    await screen.findByTestId(`rehearse-${PLANNED}`);
    expect(statusLight()).toBe(false);
  });

  test('T14_S19_연습을_끝내면_light가_남지_않는다', async () => {
    await toRehearsal();
    await tap(await screen.findByText('연습 끝내기'));
    await screen.findByTestId(`day-row-${PLANNED}`);
    await settleAll();
    expect(screen.queryByTestId('trip-now-screen')).toBeNull(); // 시험 자체 확인: 연습 화면을 떠났다
    expect(statusLight()).toBe(false);
  });
});

describe('§19 상 연습 지도 카메라 아래 여백 = 시트 + 시계 판', () => {
  // TASK-014 §24: 연습 카메라는 fit 여백 대신 우리가 계산한 영역(보이는 띠 = 시계 판·시트 위). 띠 안인지는 task-014-s21 T14_S24_화면_* 이 본다
  test('T14_S19_S24_연습_카메라는_fit_여백이_아니라_계산한_영역', async () => {
    (Constants as unknown as { expoConfig: unknown }).expoConfig = { extra: { googleMapsKeyPresent: true } };
    await toRehearsal();
    expect(screen.queryByTestId('map-fallback')).toBeNull(); // 시험 자체 확인: 지도가 그려졌다
    // §26 3: 지도 높이(시트 영역 onLayout)를 안 뒤에 계산한다
    const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
    await act(async () => {
      fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 770 } } });
    });
    await waitFor(() => expect(mapControl.regions.length).toBeGreaterThan(0));
    expect(mapControl.fits).toEqual([]);
  });
});

// =====================================================================
// 중: 시계 판 reh-clock 값 · 연습 카드 시트 440
// 근거: TASK-014 §19 중, task-014-design §2 reh-clock("윗줄 이름 12/16·600 muted + 시각 22/28", "손잡이 28")·§9-2 중, DESIGN-001 §4-13
// =====================================================================

describe('§19 중 연습 시계 판 (reh-clock)', () => {
  test('T14_S19_이름과_시각은_위아래_두_줄_이름이_위', async () => {
    await toRehearsal();
    const panel = byId('demo-panel');
    const name = within(panel as never).getByText('연습 시계') as unknown as Host;
    const time = byId('demo-time');
    const box = commonAncestor(name, time);
    expect([undefined, 'column']).toContain(styleOf(box).flexDirection);
    const order = [box, ...box.queryAll(() => true)];
    expect(order.indexOf(name)).toBeLessThan(order.indexOf(time));
    expect({ size: styleOf(name).fontSize, line: styleOf(name).lineHeight }).toEqual({ size: 12, line: 16 });
    expect(same(styleOf(name).color, COLORS.muted)).toBe(true);
  });

  test.each(['demo-plus-10', 'demo-play'])('T14_S19_%s_버튼_안에_아이콘이_하나', async (id) => {
    await toRehearsal();
    expect(svgsIn(byId(id))).toHaveLength(1);
  });

  test('T14_S19_S21_버튼_글자는_10분·재생', async () => {
    // TASK-014 §21 3: 아이콘(+)과 글자 "+10분"이 겹쳐 + 가 두 번 -> 글자는 "10분" (승인된 §19 "+10분"을 바꿈)
    await toRehearsal();
    expect(within(screen.getByTestId('demo-plus-10')).getByText('10분')).toBeTruthy();
    expect(within(screen.getByTestId('demo-play')).getByText('재생')).toBeTruthy();
  });

  test('T14_S19_막대_손잡이는_보이는_28_누르는_높이_44_이상', async () => {
    await toRehearsal();
    const thumb = byId('demo-thumb');
    expect({ width: styleOf(thumb).width, height: styleOf(thumb).height }).toEqual({ width: 28, height: 28 });
    const catcher = chain(thumb).find((host) => typeof host.props.onStartShouldSetResponder === 'function');
    expect(catcher).toBeDefined();
    const style = styleOf(catcher!);
    const slop = catcher!.props.hitSlop ?? {};
    const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
    expect(Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0)) + extra).toBeGreaterThanOrEqual(44);
  });
});

describe('TASK-015 §B3 연습 카드 시트 기본 윗변은 앱 844 화면에서 y 546 (위로 끌면 417)', () => {
  // TASK-015 §B3·§17(11-16) · task-014-design §12-1 정본: 874 보드 434 -> 563, 앱 844 417 -> 546. 기준은 높이가 아니라 윗변 위치.
  // (이전: 874 화면에서 중간 단 윗변 434 — TASK-014 §20 Q2. 제안 A로 바뀌어 옛 단언을 고쳤다)
  // 시험이 넣는 것 (jest에는 실제 배치가 없어서):
  //   화면 390×844, 안전 영역 위 47 · 아래 34 (§11-1 "띠 99 = 47 + 52" 계산과 같은 폰). Dimensions 창 높이도 844
  //   입력창 자리 = 그려진 input-bar 스타일의 위 여백 + 입력 칸 최소 높이 + 아래 여백 — 앱이 그린 값에서 읽는다
  //   시트 영역(지도·시트가 있는 상자, 화면 맨 위 y 0부터) = 844 − 입력창 자리. 그 상자의 onLayout으로 넣는다
  //   시트 윗변 y = 시트 영역 높이 − 단 높이
  async function rehearsalSnapTops() {
    const window = Dimensions.get('window');
    jest.spyOn(Dimensions, 'get').mockImplementation(() => ({ ...window, width: APP_WIDTH, height: APP_HEIGHT }));
    await toRehearsal(METRICS);
    expect(screen.queryByTestId('action-bar')).toBeNull(); // 시험 자체 확인: 확정 줄 없음 (입력창만 시트 아래)
    const bar = byId('input-bar');
    const field = bar.queryAll((inner) => typeof styleOf(inner).minHeight === 'number')[0];
    expect(field).toBeDefined();
    const inputBar = Number(styleOf(bar).paddingTop ?? 0) + Number(styleOf(field).minHeight) + Number(styleOf(bar).paddingBottom ?? 0);
    expect(Number(styleOf(bar).paddingBottom)).toBeGreaterThanOrEqual(34); // 시험 자체 확인: 아래 안전 영역이 들어갔다
    const area = APP_HEIGHT - inputBar;
    const host = byId('trip-now-screen').queryAll((inner) => typeof inner.props.onLayout === 'function')[0];
    expect(host).toBeDefined();
    await act(async () => {
      fireEvent(host as never, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: APP_WIDTH, height: area } } });
    });
    const points = sheetControl.props?.snapPoints as unknown[];
    expect(points.length).toBeGreaterThanOrEqual(3);
    return points.map((point) => area - snapPx(point, area));
  }

  test('T15_B3_844_화면_연습_시트_기본_윗변은_546', async () => {
    const tops = await rehearsalSnapTops();
    expect(Math.abs(tops[1] - REH_SHEET_TOP)).toBeLessThanOrEqual(1);
  });

  test('T15_B3_844_화면_연습_시트를_위로_끌면_윗변_417_단이_있다', async () => {
    const tops = await rehearsalSnapTops();
    // 기본 단(1)보다 위(윗변 y가 더 작은) 단 가운데 하나가 417
    expect(tops.slice(2).some((top) => Math.abs(top - REH_SHEET_TOP_UP) <= 1)).toBe(true);
  });
});

// =====================================================================
// 중·하: SOS "준비 중" 시트 — 스크림 화면 전체 · 손잡이 36×4 · 긴급 전화 한 줄(글자만)
// 근거: TASK-014 §19 중·"SOS 준비 중 시트에 일본 긴급 전화 한 줄", task-014-design §9-3, DESIGN-001 §4-11 sheet-confirm(손잡이 36×4)
// =====================================================================

describe('§19 SOS 준비 중 시트', () => {
  async function openSos() {
    await tap(screen.getByTestId('sos-button'));
    await screen.findByTestId('sos-sheet');
  }

  test('T14_S19_스크림이_SOS_버튼보다_위에_그려진다', async () => {
    await toRehearsal();
    await openSos();
    expect(drawnAbove(byId('sheet-scrim'), byId('sos-button'))).toBe(true);
  });

  test('T14_S19_스크림이_연습_띠보다_위에_그려진다', async () => {
    await toRehearsal();
    await openSos();
    expect(drawnAbove(byId('sheet-scrim'), byId('rehearsal-band'))).toBe(true);
  });

  test('T14_S19_시트_손잡이는_36×4', async () => {
    await toRehearsal();
    await openSos();
    const handles = byId('sos-sheet').queryAll((host) => styleOf(host).width === 36 && styleOf(host).height === 4);
    expect(handles).toHaveLength(1);
  });

  test.each([
    ['위치 확인됨이 있을 때', {}],
    ['위치를 모를 때', { position: null }],
  ])('T14_S19_%s도_긴급_전화_한_줄이_있다', async (_name, over) => {
    nowReply = () => json(200, rehearsalView(over));
    server.match(`POST /days/${PLANNED}/check`, (sent) => json(200, rehearsalView({ ...over, at: body(sent).at })));
    await toRehearsal();
    await openSos();
    expect(within(screen.getByTestId('sos-sheet')).getByText(EMERGENCY)).toBeTruthy();
    expect(within(screen.getByTestId('sos-sheet')).getByText('긴급 도움은 준비 중이야')).toBeTruthy(); // 준비 중 글은 그대로
  });

  test('T14_S19_긴급_전화_줄은_글자만_누르는_곳이_아니다', async () => {
    await toRehearsal();
    await openSos();
    const line = within(screen.getByTestId('sos-sheet')).getByText(EMERGENCY) as unknown as Host;
    const sheet = byId('sos-sheet');
    for (const host of pathBelow(line, sheet)) {
      expect(typeof host.props.onPress).not.toBe('function');
      expect(typeof host.props.onClick).not.toBe('function');
      expect(['link', 'button']).not.toContain(host.props.accessibilityRole ?? host.props.role);
    }
    // 안에 다른 누르는 것도 없다 (전화 걸기는 TASK-016)
    expect(line.queryAll((host) => typeof host.props.onPress === 'function' || typeof host.props.onClick === 'function')).toEqual([]);
  });
});

// =====================================================================
// 날짜 목록 (D6): 끝난 여행 [새 여행 만들기] 주 버튼 · 날짜 숫자 DM Mono · 머리 아바타 사람 아이콘
// 근거: TASK-014 §19 승인·중·하, task-014-design §9-1, DESIGN-001 §4-11 btn-new-trip(11-14)·§4-12 head-avatar, TASK-011 §9 Q1(11-14 고침)
// =====================================================================

describe('§19 날짜 목록 (D6)', () => {
  const LIST_METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
  const DATES = ['2026-12-11', '2026-12-12', '2026-12-13']; // 금 · 토 · 일
  const SUMMARY = { end_time: '18:30', place_count: 8, move_min: 125 };
  const listDay = (n: number, state: string, chosen = state !== 'planning') => ({
    day_id: `d${n}`,
    date: DATES[n - 1],
    state,
    chosen_option_id: chosen ? `opt-${n}` : null,
    fixed_events: [] as unknown[],
    summary: chosen ? SUMMARY : null,
    must_visits: [],
  });
  const listTrip = (...days: ReturnType<typeof listDay>[]) => ({
    trip_id: 'trip-osaka-1',
    city_code: 'osaka',
    start_date: DATES[0],
    end_date: DATES[2],
    lodging: null, // TASK-015 §11 Q10 응답 새 모양 (이전: lodging_place_id: null)
    status: 'active',
    trip_days: days,
  });
  const ALL_PAST = listTrip(listDay(1, 'past'), listDay(2, 'past'), listDay(3, 'past', false));
  const NONE_PAST = listTrip(listDay(1, 'past', false), listDay(2, 'past', false), listDay(3, 'past', false));
  const ALL_PLANNED = listTrip(listDay(1, 'planned'), listDay(2, 'planned'), listDay(3, 'planned'));
  const MIXED = listTrip(listDay(1, 'planned'), listDay(2, 'planning'), listDay(3, 'planning'));
  const AFTER = '2026-12-20T03:00:00Z';
  const BEFORE = '2026-11-06T03:00:00Z';

  async function show(value: object, at: string) {
    freezeDate(at);
    const { TripDays } = require('@/trips/trip-days');
    await render(
      <SafeAreaProvider initialMetrics={LIST_METRICS}>
        <TripDays trip={value as never} onOpen={jest.fn()} onTripChange={() => {}} onNewTrip={() => {}} />
      </SafeAreaProvider>,
    );
  }
  const pressableOf = (host: Host): Host => chain(host).find((h) => typeof h.props.onClick === 'function') ?? host.queryAll((h) => typeof h.props.onClick === 'function')[0] ?? host;
  const mono = () => require('@/planning/theme').text('num-md').fontFamily as string;
  const isMono = (family: unknown) => typeof family === 'string' && family.startsWith(mono().split('_')[0]);

  describe('끝난 여행 [새 여행 만들기] = 주 버튼 (DESIGN-001 §4-11 11-14)', () => {
    test.each([
      ['지난 날만(코스 있는 날 포함)', ALL_PAST],
      ['지난 날만(모두 고른 코스 없음)', NONE_PAST],
    ])('T14_S19_%s이면_brand_바탕·52·r16·17/24·700·글자_1A1A1A', async (_name, value) => {
      await show(value, AFTER);
      const button = pressableOf(byId('new-trip'));
      const style = styleOf(button);
      expect(same(style.backgroundColor, COLORS.brand)).toBe(true);
      expect(Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0))).toBeGreaterThanOrEqual(52);
      expect(style.borderRadius).toBe(16);
      const label = within(screen.getByTestId('new-trip')).getByText('새 여행 만들기') as unknown as Host;
      const text = styleOf(label);
      expect({ size: text.fontSize, line: text.lineHeight }).toEqual({ size: 17, line: 24 });
      expect(String(text.fontWeight ?? '') === '700' || String(text.fontFamily ?? '').includes('700')).toBe(true);
      expect(same(text.color, COLORS['on-brand'])).toBe(true);
    });

    test('T14_S19_끝난_여행의_주황_눌리는_상자는_새_여행_만들기_하나', async () => {
      await show(ALL_PAST, AFTER);
      const orange = root().queryAll((host) => typeof host.props.onClick === 'function' && same(styleOf(host).backgroundColor, COLORS.brand));
      expect(orange).toHaveLength(1);
      expect(chain(orange[0]).includes(byId('new-trip')) || chain(byId('new-trip')).includes(orange[0])).toBe(true);
      expect(screen.queryByTestId('bottom-primary')).toBeNull(); // 자리는 그대로 목록 맨 끝 (아래 큰 버튼 아님)
    });

    test('T14_S19_경계_여행_전_모두_계획_완료면_보조_bg_2_그대로', async () => {
      await show(ALL_PLANNED, BEFORE);
      expect(same(styleOf(pressableOf(byId('new-trip'))).backgroundColor, COLORS['bg-2'])).toBe(true);
    });
  });

  describe('날짜 숫자는 DM Mono (task-014-design §9-1 "숫자만 DM Mono")', () => {
    test.each([
      ['끝난 여행 지난 날 줄', ALL_PAST, AFTER, 'd1', '12/11', '금'],
      ['끝난 여행 고른 코스 없는 줄', ALL_PAST, AFTER, 'd3', '12/13', '일'],
      ['여행 전 계획 완료 줄', MIXED, BEFORE, 'd1', '12/11', '금'],
      ['여행 전 계획 전 카드', MIXED, BEFORE, 'd2', '12/12', '토'],
    ])('T14_S19_%s의_날짜_숫자는_DM_Mono_요일은_아니다', async (_name, value, at, dayId, digits, weekday) => {
      await show(value, at);
      const rowHost = screen.queryByTestId(`day-row-${dayId}`) ?? screen.getByTestId(`row-locked-${dayId}`);
      let row = rowHost as unknown as Host;
      // 날짜 글자가 줄 바깥 상자에 있으면 한 칸씩 올라가며 찾는다
      while (row.parent && !textHosts(row).some((host) => ownText(host).includes(digits))) row = row.parent;
      const digitHosts = textHosts(row).filter((host) => ownText(host).includes(digits));
      expect(digitHosts.length).toBeGreaterThanOrEqual(1);
      for (const host of digitHosts) expect(isMono(styleOf(host).fontFamily)).toBe(true);
      const dayHosts = textHosts(row).filter((host) => ownText(host).includes(weekday));
      expect(dayHosts.length).toBeGreaterThanOrEqual(1);
      for (const host of dayHosts) expect(isMono(styleOf(host).fontFamily)).toBe(false); // 한글은 font-text (DESIGN-001 §4-3)
    });
  });

  describe('머리 아바타는 head-avatar 사람 아이콘 (DESIGN-001 §4-12)', () => {
    test('T14_S19_머리_아바타_안에_사람_아이콘_Svg_24_선_333333', async () => {
      await show(ALL_PAST, AFTER);
      const avatar = byId('head-avatar');
      const svgs = svgsIn(avatar);
      expect(svgs).toHaveLength(1);
      expect({ width: Number(svgs[0].props.width), height: Number(svgs[0].props.height) }).toEqual({ width: 24, height: 24 });
      const strokes = pathsIn(avatar).map((path) => path.props.stroke);
      expect(strokes.length).toBeGreaterThanOrEqual(1);
      for (const stroke of strokes) expect(same(stroke, COLORS.ink)).toBe(true);
    });

    test('T14_S19_머리_아바타는_웃는_얼굴_친구_아바타가_아니다', async () => {
      await show(ALL_PAST, AFTER);
      const avatar = byId('head-avatar');
      // FriendAvatar(눈 둘 + 입, ink 바탕 원)가 안에 없다
      expect(avatar.queryAll((host) => same(styleOf(host).backgroundColor, COLORS['ink-strong']) || same(styleOf(host).backgroundColor, COLORS.ink))).toEqual([]);
      expect(within(screen.getByTestId('head-avatar')).queryByTestId('friend-avatar')).toBeNull();
    });

    test('T14_S19_아바타_이름과_바탕은_그대로_내_프로필·bg_2', async () => {
      await show(ALL_PAST, AFTER);
      const avatar = pressableOf(byId('head-avatar'));
      expect(byId('head-avatar').props.accessibilityLabel ?? avatar.props.accessibilityLabel).toBe('내 프로필');
      expect(same(styleOf(avatar).backgroundColor, COLORS['bg-2'])).toBe(true);
    });
  });
});

// =====================================================================
// 하: 연습 띠 아이콘 = 보드의 길(route) 18 (걷는 사람 아님)
// 근거: TASK-014 §19 하("연습 띠 아이콘은 보드(길 route 18)로"), task-014-design §2 reh-band("아이콘 18 흰색")·§9-2 하
// =====================================================================

describe('§19 하 연습 띠 아이콘', () => {
  test('T14_S19_띠_아이콘은_18_하나이고_걷는_사람_아이콘이_아니다', async () => {
    const { WalkIcon } = require('@/components/planning/icons');
    const walkPath = (WalkIcon({ color: '#FFFFFF', size: 18 }) as { props: { d?: string } }).props.d; // 걷는 사람 아이콘의 선 모양
    expect(typeof walkPath).toBe('string'); // 시험 자체 확인: 걷는 사람 모양을 읽었다

    await toRehearsal();
    const band = byId('rehearsal-band');
    const svgs = svgsIn(band);
    expect(svgs).toHaveLength(1);
    expect(Number(svgs[0].props.width)).toBe(18);
    expect(pathsIn(band).map((path) => path.props.d)).not.toContain(walkPath);
  });
});
