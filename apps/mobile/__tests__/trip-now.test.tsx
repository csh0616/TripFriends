/// <reference types="jest" />
// 여행 중 화면 SC-04 (로직·가드레일). 근거: TASK-006 B1~B10, §6, §7, §8 AC-5·AC-6·AC-7, SCREEN-001 §2·§3-2·§6, ADR-014, DESIGN-001 §4.
// 지도·시트는 가짜 부품(test-support/maps-mock, bottom-sheet-mock)이다. 이 파일이 통과해도 지도가 실제로 보인다는 뜻이 아니다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, screen, waitFor, within } from '@testing-library/react-native';
import fc from 'fast-check';
import { Linking, StyleSheet } from 'react-native';

import { contrast } from '@/lib/contrast';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { COLORS, STRINGS } from '../test-support/design-table';
import { apiError, hang, json, networkDown, notJson } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { pressId, pressText, resetDevice, restart, tap, toS9 } from '../test-support/planning-driver';
import { hits, MOBILE_ROOT, sourceFiles } from '../test-support/source-files';
import { advance, buildConfig, ENTER, flow, installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { first, MAP_URL, nowItem, nowView, pins, POSITION, route, second, t01, t02, t03, t07, t08, third } from '../test-support/trip-now-fixtures';
import { day } from '../test-support/planning-fixtures';

// app.config가 만든 설정을 시험마다 바꿔 끼운다 (키 있음·없음). trip-now-driver의 installConfig 참고
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const root = () => screen.container as unknown as Tree;
const inCard = (id: string) => within(byId(id) as never);
const textOf = (host: Tree) => {
  const flat = (value: unknown): string => (Array.isArray(value) ? value.map(flat).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  return flat(host.props.children);
};
const textsUnder = (host: Tree) => host.queryAll((inner) => inner.type === 'Text');
const isUnder = (host: Tree, ancestorId: string) => {
  let now = host.parent;
  while (now) {
    if (now.props.testID === ancestorId) return true;
    now = now.parent;
  }
  return false;
};
const cardIds = () =>
  root()
    .queryAll((host) => typeof host.props.testID === 'string' && /^card-T-\d+$/.test(host.props.testID) && host.type === 'View')
    .map((host) => host.props.testID as string);

const AT = (clock: string) => `2026-12-02T${clock}:00`;
const nowCard = (card: object, over: object = {}) => nowView({ main: card, subs: [], ...over });

const ALL_MAINS: [string, object][] = [
  ['T-01', t01()],
  ['T-02', t02()],
  ['T-03', t03()],
  ['T-07', t07()],
  ['T-08', t08()],
];

beforeEach(() => {
  resetDevice();
  mapControl.reset();
  sheetControl.reset();
  installConfig(TEST_KEY);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- B1 개발 빌드 설정 (키는 시험용 가짜 값을 주입. env 파일은 읽지 않는다) ----------

describe('B1 설정', () => {
  // 값이 찍히지 않게 있다·없다만 비교한다
  const hasKey = (config: object, key: string) => JSON.stringify(config).includes(key);

  test('T6_B1_앱_이름과_번들_ID', () => {
    const config = buildConfig(TEST_KEY);
    expect(config.name).toBe('Tripfriends');
    expect(config.ios.bundleIdentifier).toBe('com.csh0616.tripfriends');
  });

  test('T6_B1_ADR014_환경값의_키가_설정에_들어간다', () => {
    expect(hasKey(buildConfig(TEST_KEY), TEST_KEY)).toBe(true);
  });

  test('T6_B1_키가_없어도_설정이_만들어지고_빌드가_막히지_않는다', () => {
    const config = buildConfig(null);
    expect(config.ios.bundleIdentifier).toBe('com.csh0616.tripfriends');
    expect(hasKey(config, TEST_KEY)).toBe(false);
  });

  test('T6_B1_개발_빌드_패키지가_의존성에_있다', () => {
    const manifest = JSON.parse(readFileSync(join(MOBILE_ROOT, 'package.json'), 'utf8'));
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(all)).toEqual(expect.arrayContaining(['expo-dev-client', 'react-native-maps']));
  });

  test('T6_S9_ADR014_키_이름은_EXPO_PUBLIC이_아니고_코드에_키_값이_없다', () => {
    expect(hits(sourceFiles(), /EXPO_PUBLIC_GOOGLE/)).toEqual([]);
    expect(hits(sourceFiles(), /AIza[0-9A-Za-z_-]{20,}/)).toEqual([]);
    for (const name of ['app.json', 'app.config.ts']) {
      const path = join(MOBILE_ROOT, name);
      if (existsSync(path)) expect(/AIza[0-9A-Za-z_-]{20,}/.test(readFileSync(path, 'utf8'))).toBe(false);
    }
  });

  test('T6_ADR014_env_local은_저장소에_안_들어간다', () => {
    expect(readFileSync(join(MOBILE_ROOT, '.gitignore'), 'utf8')).toMatch(/^\.env\*\.local$/m);
  });
});

// ---------- B2 MapAdapter ----------

describe('B2 MapAdapter', () => {
  const IMPORT = /(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]react-native-maps(?:\/[^'"]*)?['"]/;

  test('T6_B2_도구_검사_import를_잡고_글자만_있는_것은_안_잡는다', () => {
    for (const line of ["import MapView from 'react-native-maps';", "const m = require('react-native-maps');", "import 'react-native-maps';", "import { Marker } from 'react-native-maps/lib/x';", "const m = await import('react-native-maps');"]) {
      expect(IMPORT.test(line)).toBe(true);
    }
    for (const line of ['// react-native-maps를 감싼다', "const name = 'react-native-maps-lite';"]) {
      expect(IMPORT.test(line)).toBe(false);
    }
  });

  test('T6_AC6_B2_react_native_maps는_MapAdapter_한_파일에서만_import', () => {
    const importing = sourceFiles().filter((file) => file.text.split('\n').some((line) => IMPORT.test(line)));
    expect(importing.map((file) => file.path)).toHaveLength(1);
    expect(importing[0].path).toMatch(/(^|\/)map-adapter\.tsx$/);
  });

  test('T6_ADR014_Google_제공자로_그린다', async () => {
    await toNow();
    expect(byId('map-view').props.provider).toBe('google');
  });
});

// ---------- B3 화면 틀, AC-6 고정 ----------

describe('B3 화면 틀', () => {
  test('T6_B3_프로필_알약_SOS_내_위치가_있다', async () => {
    await toNow();
    for (const id of ['profile-avatar', 'status-pill', 'sos-button', 'my-location-button']) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
  });

  test.each(['서버_상태_글자', '동선대로 가는 중', '늦어지는 중', '다음까지 여유 있음'])('T6_B3_S6_알약_글자는_서버가_준_%s_그대로', async (text) => {
    await toNow(nowServer(nowView({ status_text: text })));
    expect(inCard('status-pill').getByText(text)).toBeTruthy();
  });

  const expectNotInside = (id: string, ...ancestors: string[]) => {
    const host = byId(id);
    for (const ancestor of ancestors) expect(isUnder(host, ancestor)).toBe(false);
    let now = host.parent;
    while (now) {
      expect(now.type).not.toBe('RCTScrollView');
      now = now.parent;
    }
  };

  test('T6_AC6_B3_SOS와_입력창은_시트_지도_스크롤_밖이고_하나씩', async () => {
    await toNow();
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
    expect(screen.getAllByTestId('input-bar')).toHaveLength(1);
    expectNotInside('sos-button', 'card-sheet', 'map-view');
    expectNotInside('input-bar', 'card-sheet', 'map-view');
  });

  test.each(ALL_MAINS)('T6_AC6_메인이_%s여도_SOS와_입력창은_그대로', async (_name, card) => {
    const control = nowServer();
    await toNow(control);
    control.show(nowCard(card));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId(`card-${(card as { type: string }).type}`);
    expect(screen.getAllByTestId('sos-button')).toHaveLength(1);
    expect(screen.getAllByTestId('input-bar')).toHaveLength(1);
    expectNotInside('sos-button', 'card-sheet', 'map-view');
    expectNotInside('input-bar', 'card-sheet', 'map-view');
  });

  test('T6_AC6_SOS를_누르면_같은_준비_중_시트_서버_요청_없음', async () => {
    const { control } = await toNow();
    const before = control.server.requests.length;
    await pressId('sos-button');
    expect(await screen.findByText('긴급 도움은 준비 중이야')).toBeTruthy();
    await tap(screen.getByText('닫기'));
    expect(screen.queryByText('긴급 도움은 준비 중이야')).toBeNull();
    expect(control.server.requests).toHaveLength(before);
  });
});

// ---------- B4 지도 내용 (가짜 지도에 넘긴 값만 본다) ----------

describe('B4 지도에 넘기는 값', () => {
  const coords = (list: number[][]) => list.map(([latitude, longitude]) => ({ latitude, longitude }));

  test('T6_B4_지난_길과_남은_길은_서버_route_그대로', async () => {
    await toNow();
    expect(byId('map-route-done').props.coordinates).toEqual(coords(route.done));
    expect(byId('map-route-remaining').props.coordinates).toEqual(coords(route.remaining));
  });

  test('T6_B4_남은_길만_점선', async () => {
    await toNow();
    expect(byId('map-route-remaining').props.lineDashPattern?.length).toBeGreaterThan(0);
    expect(byId('map-route-done').props.lineDashPattern ?? []).toEqual([]);
  });

  test('T6_B4_핀은_서버_pins마다_하나_숙소도_하나', async () => {
    await toNow();
    for (const pin of pins) {
      expect(byId(`map-pin-${pin.seq}`).props.coordinate).toEqual({ latitude: pin.lat, longitude: pin.lng });
    }
    expect(byId('map-home').props.coordinate).toEqual({ latitude: day.lodging.lat, longitude: day.lodging.lng });
    expect(root().queryAll((h) => h.props.mapElement === 'Marker' && /^map-pin-/.test(String(h.props.testID)))).toHaveLength(pins.length);
  });

  test('T6_B4_번호_핀에는_번호_글자가_있다', async () => {
    await toNow();
    for (const pin of pins) expect(inCard(`map-pin-${pin.seq}`).getByText(String(pin.seq))).toBeTruthy();
  });

  test('T6_B4_시각이_바뀌면_핀과_선이_서버_값으로_바뀐다', async () => {
    const control = nowServer();
    await toNow(control);
    const moved = { done: [[35, 135]], remaining: [[35, 135], [35.3, 135.3]] };
    control.show(nowView({ route: moved, pins: [{ ...pins[0], lat: 35.3, lng: 135.3 }] }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(byId('map-route-remaining').props.coordinates).toEqual(coords(moved.remaining)));
    expect(byId('map-pin-1').props.coordinate).toEqual({ latitude: 35.3, longitude: 135.3 });
    expect(screen.queryByTestId('map-pin-2')).toBeNull();
  });

  test('T6_B4_내_위치_점은_서버_position', async () => {
    await toNow();
    expect(byId('map-my-position').props.coordinate).toEqual({ latitude: POSITION.lat, longitude: POSITION.lng });
  });
});

// ---------- B5 시트, 입력창 ----------

describe('B5 카드 시트', () => {
  test('T6_B5_3단이고_기본은_중간', async () => {
    await toNow();
    const sheet = byId('card-sheet');
    expect(sheet.props.snapPoints).toHaveLength(3);
    expect(sheet.props.index).toBe(1);
  });

  test('T6_B5_카드는_시트_안에', async () => {
    await toNow();
    expect(isUnder(byId('now-main'), 'card-sheet')).toBe(true);
    expect(isUnder(byId('now-reason'), 'card-sheet')).toBe(true);
  });

  test('T6_B5_입력창은_비활성이고_안내_문구', async () => {
    await toNow();
    expect(byId('input-text').props.editable).toBe(false);
    expect(inCard('input-bar').getByText('곧 말로도 바꿀 수 있어')).toBeTruthy();
  });

  test('T6_B5_입력창을_눌러도_서버_요청이_없다', async () => {
    const { control } = await toNow();
    const before = control.server.requests.length;
    await pressId('mic-button');
    expect(control.server.requests).toHaveLength(before);
  });
});

// ---------- B6 카드 ----------

describe('B6 카드 부품', () => {
  async function shows(card: object) {
    await toNow(nowServer(nowCard(card)));
  }

  test('T6_B6_T_01_라벨_장소_남은_분_끝_시각', async () => {
    await shows(t01());
    const card = inCard('card-T-01');
    expect(card.getByText('지금 할 일')).toBeTruthy();
    expect(card.getByText(second.name)).toBeTruthy();
    expect(card.getByText(/^40(분)?$/)).toBeTruthy();
    expect(card.getByText(/14:00/)).toBeTruthy();
  });

  test('T6_B6_A2_T_01_미리보기는_남은_분이_null이어도_글자가_깨지지_않는다', async () => {
    await shows(t01({ item: first, ends_in_min: null }));
    const words = textsUnder(byId('card-T-01')).map(textOf).join(' ');
    expect(words).toContain(first.name);
    expect(words).not.toMatch(/null|undefined|NaN/);
  });

  test('T6_B6_T_02_이름_출발_시각_이동_분', async () => {
    await shows(t02());
    const card = inCard('card-T-02');
    expect(card.getByText(second.name)).toBeTruthy();
    expect(card.getByText(/12:00/)).toBeTruthy();
    expect(card.getByText(/20/)).toBeTruthy();
  });

  test('T6_B6_T_02_길_안내는_서버의_map_url을_연다', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await shows(t02());
    await pressId('directions-button');
    await waitFor(() => expect(open).toHaveBeenCalledWith(MAP_URL));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('T6_B6_T_03_남은_일정이_줄마다', async () => {
    await shows(t03());
    expect(inCard('rest-row-2').getByText(second.name)).toBeTruthy();
    expect(inCard('rest-row-3').getByText(third.name)).toBeTruthy();
    expect(screen.queryByTestId('rest-row-1')).toBeNull();
  });

  test('T6_B6_T_07_이름과_출발_시각_남은_분', async () => {
    await shows(t07());
    const card = inCard('card-T-07');
    expect(card.getByText('서버_예약_공연')).toBeTruthy();
    expect(card.getByText(/14:40/)).toBeTruthy();
    expect(card.getByText(/15/)).toBeTruthy();
  });

  test('T6_B6_T_08_숙소까지_분', async () => {
    await shows(t08());
    expect(inCard('card-T-08').getByText(/25/)).toBeTruthy();
  });

  test('T6_B6_S6_바뀐_이유는_서버_문장_그대로', async () => {
    await shows(t01());
    expect(inCard('now-reason').getByText('서버_바뀐_이유')).toBeTruthy();
  });

  // SCREEN-001 §3-2, AC-3 상태 칩
  const STATUS: ['confirmed' | 'unverified' | 'unknown', string][] = [
    ['confirmed', '확인됨'],
    ['unverified', '미확인'],
    ['unknown', '모름'],
  ];

  test.each(STATUS)('T6_S3_2_T_01에_%s_상태_글자_%s', async (status, label) => {
    await shows(t01({ item: nowItem(2, '장소', '12:20', '14:00', status) }));
    expect(inCard('card-T-01').getByText(label)).toBeTruthy();
  });

  test.each(STATUS)('T6_S3_2_T_02에_%s_상태_글자_%s', async (status, label) => {
    await shows(t02({ next_item: nowItem(2, '장소', '12:20', '14:00', status) }));
    expect(inCard('card-T-02').getByText(label)).toBeTruthy();
  });

  test('T6_S3_2_T_03은_줄마다_자기_상태_글자', async () => {
    await shows(t03());
    expect(inCard('rest-row-2').getByText('미확인')).toBeTruthy();
    expect(inCard('rest-row-3').getByText('모름')).toBeTruthy();
  });

  test.skip('Q21_T_07_고정_일정에_상태_칩이_필요한가_fixed에는_facts가_없다', async () => {
    await shows(t07());
    expect(inCard('card-T-07').getByText('확인됨')).toBeTruthy();
  });
});

describe('카드 개수 (SCREEN-001 §2, §5)', () => {
  test('T6_S5_메인과_보조는_서버가_준_순서대로', async () => {
    await toNow(nowServer(nowView({ main: t01(), subs: [t02(), t03()] })));
    expect(cardIds()).toEqual(['card-T-01', 'card-T-02', 'card-T-03']);
    expect(isUnder(byId('card-T-01'), 'now-main')).toBe(true);
    expect(isUnder(byId('card-T-02'), 'now-main')).toBe(false);
  });

  test('T6_S5_보조가_없으면_메인만', async () => {
    await toNow(nowServer(nowCard(t08())));
    expect(cardIds()).toEqual(['card-T-08']);
  });

  test('T6_S2_조합_영역은_서버가_더_보내도_최대_4장', async () => {
    await toNow(nowServer(nowView({ main: t01(), subs: [t02(), t03(), t07(), t08()] })));
    expect(cardIds().length).toBeLessThanOrEqual(4);
    expect(cardIds()[0]).toBe('card-T-01');
  });
});

// ---------- B7 데모 시계 ----------

const demoTime = () => textsUnder(byId('demo-time')).map(textOf).join('');

describe('B7 데모 시계', () => {
  test('T6_B7_패널은_처음엔_닫혀_있고_데모_버튼으로_연다', async () => {
    await toNow();
    expect(screen.queryByTestId('demo-panel')).toBeNull();
    await pressId('demo-toggle');
    for (const id of ['demo-panel', 'demo-bar', 'demo-time', 'demo-plus-10', 'demo-play']) expect(byId(id)).toBeTruthy();
  });

  test('T6_B7_개발_빌드가_아니면_데모_버튼이_없다', async () => {
    const global_ = globalThis as unknown as { __DEV__: boolean };
    const saved = global_.__DEV__;
    try {
      global_.__DEV__ = false;
      await toNow();
      expect(screen.queryByTestId('demo-toggle')).toBeNull();
    } finally {
      global_.__DEV__ = saved;
    }
  });

  test('T6_B7_S9_처음_시각은_그날_시작', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    expect(demoTime()).toBe('10:00');
    expect(control.requests()[0].at).toBe(AT('10:00'));
  });

  test('T6_B7_더하기_10분', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(demoTime()).toBe('10:10');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('10:10')));
  });

  test('T6_B7_Q22_더하기는_하루_끝을_넘지_않는다', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    for (let i = 0; i < 61; i += 1) await pressId('demo-plus-10');
    expect(demoTime()).toBe('20:00');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('20:00')));
    expect(control.requests().every((request) => (request.at as string) <= AT('20:00'))).toBe(true);
  });

  test('T6_B7_재생은_1초에_5분_999ms에는_아직', async () => {
    await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    await pressId('demo-play');
    await advance(999);
    expect(demoTime()).toBe('10:00');
    await advance(1);
    expect(demoTime()).toBe('10:05');
    await advance(2000);
    expect(demoTime()).toBe('10:15');
  });

  test('T6_B7_B8_재생하면_시각마다_요청이_간다', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    await pressId('demo-play');
    await flow(3000 + 300);
    expect(control.requests().map((request) => request.at)).toEqual(
      expect.arrayContaining([AT('10:05'), AT('10:10'), AT('10:15')]),
    );
  });

  test('T6_B7_Q22_재생해도_하루_끝을_넘지_않는다', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    await pressId('demo-play');
    await flow(125 * 1000);
    expect(demoTime()).toBe('20:00');
    await flow(300);
    expect(control.requests().every((request) => (request.at as string) <= AT('20:00'))).toBe(true);
  });

  // 시각 막대의 끌기 자체는 Maestro 몫. 위치 → 시각 계산만 본다 (함수 이름은 이 테스트가 정한 계약)
  describe('시각 막대 계산', () => {
    const barTime = (ratio: number, start: string, end: string): string => require('@/lib/demo-clock').barTime(ratio, start, end);
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

    test.each([
      [0, '10:00'],
      [1, '20:00'],
      [0.5, '15:00'],
    ])('T6_B7_막대_위치_%d는_%s', (ratio, expected) => {
      expect(barTime(ratio, '10:00', '20:00')).toBe(expected);
    });

    test('T6_B7_속성_5분_단위이고_하루_안이고_뒤로_갈수록_늦다', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (x, y) => {
          const [low, high] = [Math.min(x, y), Math.max(x, y)];
          const [early, late] = [toMin(barTime(low, '10:00', '20:00')), toMin(barTime(high, '10:00', '20:00'))];
          expect(early % 5).toBe(0);
          expect(early).toBeGreaterThanOrEqual(600);
          expect(late).toBeLessThanOrEqual(1200);
          expect(late).toBeGreaterThanOrEqual(early);
        }),
      );
    });
  });

  test.skip('Q15_요청에_fakePosition_위치가_실려_간다_앱이_일정_시각을_어디서_받는지_문서에_없다', async () => {
    const { control } = await toNow();
    expect(control.requests()[0].lat).not.toBeNull();
  });
});

// ---------- B8 요청 규칙 ----------

describe('B8 시각이 바뀔 때 요청', () => {
  async function ready() {
    const { control } = await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    return control;
  }

  test('T6_B8_디바운스_299ms에는_안_가고_300ms에_한_번', async () => {
    const control = await ready();
    const before = control.requests().length;
    await pressId('demo-plus-10');
    await advance(299);
    expect(control.requests()).toHaveLength(before);
    await advance(1);
    expect(control.requests()).toHaveLength(before + 1);
  });

  test('T6_B8_연달아_바꾸면_마지막_시각으로_한_번만', async () => {
    const control = await ready();
    const before = control.requests().length;
    await pressId('demo-plus-10');
    await advance(100);
    await pressId('demo-plus-10');
    await advance(100);
    await pressId('demo-plus-10');
    await advance(300);
    expect(control.requests()).toHaveLength(before + 1);
    expect(control.requests().at(-1)?.at).toBe(AT('10:30'));
  });

  test('T6_B8_앞_요청이_늦게_와도_마지막_것만_반영', async () => {
    const control = await ready();
    const release = control.defer();
    await pressId('demo-plus-10');
    await advance(300);
    control.show(nowCard(t08()));
    await pressId('demo-plus-10');
    await advance(300);
    release(json(200, nowCard(t07())));
    await advance(0);
    expect(screen.queryByTestId('card-T-07')).toBeNull();
    await advance(300);
    expect(screen.getByTestId('card-T-08')).toBeTruthy();
    expect(screen.queryByTestId('card-T-07')).toBeNull();
    expect(control.requests().at(-1)?.at).toBe(AT('10:20'));
  });

  test('T6_B8_S6_이번엔_깜빡임_규칙이_없어_짧은_사이에_또_바뀌어도_바로_반영', async () => {
    const control = await ready();
    control.show(nowCard(t02()));
    await pressId('demo-plus-10');
    await advance(300);
    expect(screen.getByTestId('card-T-02')).toBeTruthy();
    control.show(nowCard(t01()));
    await pressId('demo-plus-10');
    await advance(300);
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(screen.queryByTestId('card-T-02')).toBeNull();
  });
});

// ---------- B9 진입 ----------

describe('B9 진입과 다시 켜기', () => {
  test('T6_B9_S9에_데모_진입_버튼이_있고_아직_요청은_없다', async () => {
    const control = nowServer();
    await toS9();
    expect(screen.getByText(ENTER)).toBeTruthy();
    expect(control.requests()).toHaveLength(0);
  });

  test('T6_B9_누르면_그날_시작_시각으로_SC_04', async () => {
    const control = nowServer();
    await toS9();
    await pressText(ENTER);
    await screen.findByTestId('now-main');
    expect(control.requests()[0].at).toBe(AT('10:00'));
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(screen.queryByText('코스 저장했어')).toBeNull();
  });

  test('T6_B9_마지막_화면이_SC_04면_다시_켜도_SC_04', async () => {
    const { app, control } = await toNow();
    const before = control.requests().length;
    await restart(app);
    await screen.findByTestId('trip-now-screen');
    await screen.findByTestId('now-main');
    expect(control.requests().length).toBeGreaterThan(before);
    expect(control.requests().at(-1)?.path.startsWith('/days/day-2/now')).toBe(true);
  });

  test('T6_B9_SC_04에_안_갔으면_다시_켜도_S9', async () => {
    const control = nowServer();
    const app = await toS9();
    await restart(app);
    await screen.findByText('코스 저장했어');
    expect(screen.queryByTestId('trip-now-screen')).toBeNull();
    expect(control.requests()).toHaveLength(0);
  });

  test.skip('Q16_다시_켠_뒤_시각은_마지막_시각인가_그날_시작인가', async () => {
    const { app, control } = await toNow();
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('10:10')));
    await restart(app);
    await screen.findByTestId('now-main');
    expect(control.requests().at(-1)?.at).toBe(AT('10:10'));
  });
});

// ---------- B10 카메라 ----------

describe('B10 카메라', () => {
  test('T6_B10_처음엔_코스_전체와_숙소가_보이게_맞춘다', async () => {
    await toNow();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    const { coordinates } = mapControl.fits[0];
    for (const point of [...pins.map((pin) => ({ latitude: pin.lat, longitude: pin.lng })), { latitude: day.lodging.lat, longitude: day.lodging.lng }]) {
      expect(coordinates).toContainEqual(point);
    }
  });

  test('T6_B10_시트_높이만큼_아래_여백', async () => {
    await toNow();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    expect(mapControl.fits[0].options?.edgePadding?.bottom).toBeGreaterThan(0);
  });

  test('T6_B10_시각이_바뀌어도_다시_맞추지_않는다', async () => {
    const { control } = await toNow();
    await waitFor(() => expect(mapControl.fits.length).toBeGreaterThan(0));
    const before = mapControl.fits.length;
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('10:10')));
    await act(async () => undefined);
    expect(mapControl.fits).toHaveLength(before);
  });

  test('T6_B10_내_위치를_누르면_위치로_간다', async () => {
    await toNow();
    await pressId('my-location-button');
    expect(mapControl.moves.at(-1)).toEqual({ latitude: POSITION.lat, longitude: POSITION.lng });
  });
});

// ---------- §6 겹치면 ----------

describe('§6 겹치면', () => {
  test.each(ALL_MAINS)('T6_S6_앱은_카드를_고르지_않는다_서버_main이_%s면_그대로', async (name, card) => {
    await toNow(nowServer(nowCard(card)));
    expect(isUnder(byId(`card-${name}`), 'now-main')).toBe(true);
    expect(cardIds()).toEqual([`card-${name}`]);
  });

  test('T6_S6_시각과_맞지_않아_보여도_서버_main을_따른다', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(() => json(200, nowCard(t08())));
    await pressId('demo-toggle');
    await pressId('demo-plus-10'); // 10:10인데 "일정 끝난 뒤" 카드
    await screen.findByTestId('card-T-08');
    expect(cardIds()).toEqual(['card-T-08']);
  });

  test('T6_S6_재생_중_시트를_끌어도_재생은_계속되고_앱이_시트를_움직이지_않는다', async () => {
    const { control } = await toNow();
    await pressId('demo-toggle');
    jest.useFakeTimers();
    await pressId('demo-play');
    await flow(1000);
    await act(async () => sheetControl.onChange?.(0)); // 사용자가 낮게로 끌었다
    await flow(2000 + 300);
    expect(demoTime()).toBe('10:15');
    expect(control.requests().at(-1)?.at).toBe(AT('10:15'));
    expect(sheetControl.commands).toEqual([]);
  });

  test('T6_S6_시각이_바뀌어_카드가_바뀌어도_시트_높이는_사용자_것', async () => {
    const control = nowServer();
    await toNow(control);
    await pressId('demo-toggle');
    await act(async () => sheetControl.onChange?.(2));
    control.show(nowCard(t07()));
    await pressId('demo-plus-10');
    await screen.findByTestId('card-T-07');
    expect(sheetControl.commands).toEqual([]);
  });

  test('T6_S6_R1은_데모_시계만_기기_시각을_쓰지_않는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2030-01-01T09:30:00').getTime());
    const { control } = await toNow();
    expect(control.requests()[0].at).toBe(AT('10:00'));
  });
});

// ---------- §7 실패하면, 줄마다 (AC-7) ----------

describe('§7 줄 1 지도 키 없음·로드 실패', () => {
  const MESSAGE = '지도를 불러오지 못했어';

  const expectFallback = () => {
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('map-fallback')).toBeTruthy();
    expect(screen.queryByTestId('map-view')).toBeNull();
    // TASK-005 RouteDiagram 재사용. 숙소 + 핀 수만 본다 (실제로 보이는지는 시뮬레이터 몫: 중첩 Svg 사건)
    expect(screen.getByTestId('route-diagram')).toBeTruthy();
    expect(screen.getByTestId('route-home')).toBeTruthy();
    expect(screen.getAllByTestId(/^route-stop-/)).toHaveLength(pins.length);
  };

  const expectCardsWork = async (control: ReturnType<typeof nowServer>) => {
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    control.show(nowCard(t07()));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId('card-T-07');
  };

  test('T6_AC7_S7_키가_없으면_안내와_동선_도식이고_카드는_동작', async () => {
    installConfig(null);
    const control = nowServer();
    await toNow(control);
    expectFallback();
    await expectCardsWork(control);
  });

  test('T6_AC7_S7_지도_부품이_그릴_때_터져도_같다', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mapControl.failRender = true;
    const control = nowServer();
    await toNow(control);
    expectFallback();
    await expectCardsWork(control);
  });

  test('T6_AC7_키가_있고_지도가_뜨면_안내가_없다', async () => {
    await toNow();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(screen.queryByTestId('map-fallback')).toBeNull();
    expect(screen.getByTestId('map-view')).toBeTruthy();
  });

  test.skip('Q17_지도가_로드_신호를_주지_않으면_실패로_보는_시간이_문서에_없다', async () => {
    await toNow();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });
});

describe('§7 줄 2 끊김·시간 초과', () => {
  const BAND = '연결이 안 돼, 저장된 일정만 보여';

  async function failOnce(reply: Parameters<ReturnType<typeof nowServer>['once']>[0]) {
    const control = nowServer();
    await toNow(control);
    control.once(reply);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    return control;
  }

  test('T6_AC7_S7_끊기면_마지막_화면_유지와_띠와_다시', async () => {
    await failOnce(networkDown);
    expect(await screen.findByText(BAND)).toBeTruthy();
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(screen.getByTestId('now-band')).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
    expect(screen.getByTestId('sos-button')).toBeTruthy();
  });

  test('T6_AC7_S7_다시는_같은_GET이고_성공하면_띠가_사라진다', async () => {
    const control = await failOnce(networkDown);
    await screen.findByText(BAND);
    const failed = control.requests().at(-1)?.path;
    control.show(nowCard(t07()));
    await pressId('retry-button');
    await screen.findByTestId('card-T-07');
    expect(control.requests().at(-1)?.path).toBe(failed);
    expect(screen.queryByText(BAND)).toBeNull();
  });

  test('T6_AC7_S7_다시도_끊기면_띠가_남는다', async () => {
    const control = await failOnce(networkDown);
    await screen.findByText(BAND);
    control.once(networkDown);
    await pressId('retry-button');
    await waitFor(() => expect(screen.getByText(BAND)).toBeTruthy());
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
  });

  test('T6_AC7_S7_시간_초과도_같다', async () => {
    const control = nowServer();
    await toNow(control);
    await pressId('demo-toggle');
    jest.useFakeTimers();
    control.once(hang);
    await pressId('demo-plus-10');
    await advance(300);
    expect(screen.queryByText(BAND)).toBeNull();
    await advance(10000);
    expect(screen.getByText(BAND)).toBeTruthy();
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
  });

  test('T6_S7_띠는_끊긴_동안_지도도_그대로', async () => {
    await failOnce(networkDown);
    await screen.findByText(BAND);
    expect(screen.getByTestId('map-view')).toBeTruthy();
    expect(byId('map-pin-1')).toBeTruthy();
  });

  test.skip('Q22_첫_요청부터_끊기면_마지막_화면이_없다_무엇을_보여_주나', async () => {
    const control = nowServer();
    control.once(networkDown);
    await toS9();
    await pressText(ENTER);
    expect(await screen.findByText(BAND)).toBeTruthy();
  });
});

describe('§7 줄 3 404 course', () => {
  const noCourse = apiError(404, 'NOT_FOUND', { resource: 'course' });
  const MESSAGE = '고른 코스가 없어';

  async function failed() {
    const control = nowServer();
    control.reply(noCourse);
    const app = await toS9();
    await pressText(ENTER);
    await screen.findByText(MESSAGE);
    return { control, app };
  }

  test('T6_AC7_S7_문구와_계획_다시_하기', async () => {
    await failed();
    expect(screen.getByText('계획 다시 하기')).toBeTruthy();
  });

  test('T6_AC7_S7_계획_다시_하기를_누르면_S0', async () => {
    await failed();
    await pressText('계획 다시 하기');
    expect(await screen.findByText('데모 여행 시작')).toBeTruthy();
  });

  test('T6_AC7_S7_다시_켜도_S0이고_now를_다시_부르지_않는다', async () => {
    const { control, app } = await failed();
    await pressText('계획 다시 하기');
    await screen.findByText('데모 여행 시작');
    const before = control.requests().length;
    await restart(app);
    await screen.findByText('데모 여행 시작');
    expect(control.requests()).toHaveLength(before);
  });

  test('T6_AC7_S7_보던_중에_404가_와도_같다', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(noCourse);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(screen.getByText('계획 다시 하기')).toBeTruthy();
  });

  test.skip('Q22_course가_아닌_404_day_route는_어떻게_보여_주나', async () => {
    const control = nowServer();
    control.reply(apiError(404, 'NOT_FOUND', { resource: 'day' }));
    await toS9();
    await pressText(ENTER);
    expect(await screen.findByText('잠깐 문제가 생겼어')).toBeTruthy();
  });
});

describe('§7 줄 4 500', () => {
  const MESSAGE = '잠깐 문제가 생겼어';

  test.each([
    ['500 공통 오류', apiError(500, 'INTERNAL_ERROR')],
    ['JSON이 아닌 응답', notJson(502)],
  ])('T6_AC7_S7_%s_마지막_화면_유지와_문구와_다시', async (_name, reply) => {
    const control = nowServer();
    await toNow(control);
    control.once(reply);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
  });

  test('T6_AC7_S7_다시는_같은_GET', async () => {
    const control = nowServer();
    await toNow(control);
    control.once(apiError(500, 'INTERNAL_ERROR'));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByText(MESSAGE);
    const failed = control.requests().at(-1)?.path;
    control.show(nowCard(t07()));
    await pressId('retry-button');
    await screen.findByTestId('card-T-07');
    expect(control.requests().at(-1)?.path).toBe(failed);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});

describe('§7 줄 5 map_url 열기 실패', () => {
  const MESSAGE = '구글 지도를 열 수 없어';

  async function failing() {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('열 수 없음'));
    await toNow(nowServer(nowCard(t02())));
    jest.useFakeTimers();
    await pressId('directions-button');
    await advance(0);
  }

  test('T6_AC7_S7_안내가_나오고_2초_뒤_사라진다_1999ms에는_남아_있다', async () => {
    await failing();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    await advance(1999);
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    await advance(1);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  test('T6_AC7_S7_실패해도_카드는_그대로', async () => {
    await failing();
    expect(screen.getByTestId('card-T-02')).toBeTruthy();
  });

  test('T6_AC7_열_수_있으면_안내가_없다', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await toNow(nowServer(nowCard(t02())));
    await pressId('directions-button');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});

describe('§7 줄 6 위치 값 없음', () => {
  const noPosition = () => nowServer(nowView({ position: null }));

  test('T6_AC7_S7_내_위치_점을_숨긴다', async () => {
    await toNow(noPosition());
    expect(screen.queryByTestId('map-my-position')).toBeNull();
  });

  test('T6_AC7_S7_내_위치_버튼이_비활성', async () => {
    await toNow(noPosition());
    expect(byId('my-location-button').props.accessibilityState?.disabled).toBe(true);
  });

  test('T6_AC7_S7_눌러도_카메라가_움직이지_않는다', async () => {
    await toNow(noPosition());
    await pressId('my-location-button');
    expect(mapControl.moves).toEqual([]);
  });

  test('T6_AC7_위치가_있으면_버튼이_활성', async () => {
    await toNow();
    expect(byId('my-location-button').props.accessibilityState?.disabled ?? false).toBe(false);
  });

  test('T6_S7_위치가_없어져도_카드는_그대로', async () => {
    const control = nowServer();
    await toNow(control);
    control.show(nowView({ position: null }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(screen.queryByTestId('map-my-position')).toBeNull());
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
  });
});

// ---------- AC-6 가드레일 (그려진 값으로) ----------

const allowed = new Set([...Object.values(COLORS), STRINGS.scrim.toUpperCase(), 'TRANSPARENT', 'NONE']);
const COLOUR_STYLES = ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'tintColor'];
const COLOUR_PROPS = ['stroke', 'fill', 'strokeColor', 'pinColor', 'tintColor', 'placeholderTextColor'];

function usedColours(): string[] {
  return root()
    .queryAll(() => true)
    .flatMap((host) => {
      const style = styleOf(host);
      return [...COLOUR_STYLES.map((name) => style[name]), ...COLOUR_PROPS.map((name) => host.props[name])];
    })
    .filter((value): value is string => typeof value === 'string');
}

function paintBehind(host: Tree): string {
  let now = host.parent;
  while (now) {
    const fill = styleOf(now).backgroundColor;
    if (typeof fill === 'string' && fill !== 'transparent') return fill;
    now = now.parent;
  }
  return COLORS.surface;
}

type Reach = { height?: number; width?: number };

function reach(host: Tree): Reach {
  const style = styleOf(host);
  const slop = host.props.hitSlop ?? {};
  const add = (a: unknown, b: unknown) => (typeof slop === 'number' ? 2 * slop : Number(typeof a === 'number' ? a : 0) + Number(typeof b === 'number' ? b : 0));
  const size = (value: unknown, min: unknown) => {
    const numeric = [value, min].filter((v): v is number => typeof v === 'number');
    return numeric.length ? Math.max(...numeric) : undefined;
  };
  const height = size(style.height, style.minHeight);
  const width = size(style.width, style.minWidth);
  return {
    height: height === undefined ? undefined : height + add(slop.top, slop.bottom),
    width: width === undefined ? undefined : width + add(slop.left, slop.right),
  };
}

function smallTargets() {
  return root()
    .queryAll((host) => host.type === 'View' && typeof host.props.onClick === 'function')
    .map((host) => ({ id: host.props.testID ?? host.props.accessibilityLabel ?? '(이름 없음)', ...reach(host) }))
    .filter(({ height, width }) => height === undefined || height < 44 || (width !== undefined && width < 44));
}

const STATES: [string, object][] = [
  ['T-01 + 보조', nowView()],
  ['T-02', nowCard(t02(), { status: 'free', status_text: '다음까지 여유 있음' })],
  ['T-03', nowCard(t03())],
  ['T-07', nowCard(t07(), { status: 'delayed', status_text: '늦어지는 중' })],
  ['T-08', nowCard(t08(), { position: null })],
];

describe('AC-6 가드레일', () => {
  async function open(view: object) {
    await toNow(nowServer(view));
    await pressId('demo-toggle');
  }

  test.each(STATES)('T6_AC6_%s_그려진_색이_모두_토큰', async (_name, view) => {
    await open(view);
    expect(usedColours().length).toBeGreaterThan(0);
    expect(usedColours().filter((value) => !allowed.has(value.toUpperCase()))).toEqual([]);
  });

  test('T6_AC6_키가_없는_화면도_그려진_색이_모두_토큰', async () => {
    installConfig(null);
    await open(nowView());
    expect(usedColours().filter((value) => !allowed.has(value.toUpperCase()))).toEqual([]);
  });

  test.each(STATES)('T6_AC6_%s_누르는_부품이_모두_44_이상', async (_name, view) => {
    await open(view);
    expect(screen.getByTestId('demo-play')).toBeTruthy();
    expect(smallTargets()).toEqual([]);
  });

  test('T6_AC6_길_안내_내_위치_다시도_44_이상', async () => {
    const control = nowServer(nowCard(t02()));
    await toNow(control);
    control.once(networkDown);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByTestId('retry-button');
    for (const id of ['directions-button', 'my-location-button', 'retry-button', 'sos-button']) {
      const size = reach(byId(id));
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
    expect(reach(byId('my-location-button')).width).toBeGreaterThanOrEqual(44);
  });

  test.each(STATES)('T6_AC6_%s_모든_글자가_바탕과_대비_4_5_이상', async (_name, view) => {
    await open(view);
    const low = textsUnder(root())
      .filter((host) => typeof styleOf(host).color === 'string')
      .map((host) => ({ text: textOf(host), ratio: contrast(styleOf(host).color, paintBehind(host)) }))
      .filter(({ ratio }) => ratio < 4.5);
    expect(low).toEqual([]);
  });

  test.each(STATES)('T6_AC6_%s_DM_Mono에_한글이_섞인_글이_없고_주황_글자가_없다', async (_name, view) => {
    await open(view);
    const texts = textsUnder(root());
    expect(texts.filter((host) => /mono/i.test(String(styleOf(host).fontFamily)) && /[가-힣]/.test(textOf(host))).map(textOf)).toEqual([]);
    expect(texts.filter((host) => String(styleOf(host).color).toUpperCase() === COLORS.brand).map(textOf)).toEqual([]);
  });

  test('T6_DESIGN_danger는_SOS_부품_밖에서_쓰이지_않는다_새_파일_포함', async () => {
    await toNow();
    const painted = root()
      .queryAll((host) => styleOf(host).backgroundColor === COLORS.danger)
      .map((host) => host.props.testID);
    expect(painted).toEqual(['sos-button']);
  });

  test('T6_D4_SC_04의_모든_글자에_maxFontSizeMultiplier_1_3', async () => {
    await open(nowView());
    const texts = root().queryAll((host) => (host.type === 'Text' || host.type === 'TextInput') && host.props.svgElement === undefined);
    expect(texts.filter((host) => host.props.maxFontSizeMultiplier !== 1.3).map(textOf)).toEqual([]);
  });
});
