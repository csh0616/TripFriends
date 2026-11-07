/// <reference types="jest" />
// TASK-006 §13(E1~E7)·§14, DESIGN-001 §4-6. 값·토큰만 본다. 지도가 실제로 그 색으로 보이는지, iOS에서 점선이 그려지는지는 시뮬레이터 몫(E3)이다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet, View } from 'react-native';

import { contrast } from '@/lib/contrast';

import { COLORS, LISTS, NUMBERS } from '../test-support/design-table';
import { json, networkDown } from '../test-support/fake-server';
import { happyServer, pressId, pressText, R, resetDevice, restart, startApp } from '../test-support/planning-driver';
import { seed } from '../test-support/planning-fixtures';
import { MOBILE_ROOT, REPO_ROOT } from '../test-support/source-files';
import { buildConfig, expectDashedAlong, installConfig, nowServer, TEST_KEY, toNow, type LatLng } from '../test-support/trip-now-driver';
import { chosenSeed, HOME_URL, nowView, pins, route, t02, t03, t07, t08 } from '../test-support/trip-now-fixtures';
import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const DESIGN = join(REPO_ROOT, 'docs', 'design');
const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const inCard = (id: string) => within(byId(id) as never);
const root = () => screen.container as unknown as Tree;
const upper = (value: unknown) => String(value).toUpperCase();
const coords = (list: number[][]): LatLng[] => list.map(([latitude, longitude]) => ({ latitude, longitude }));
const AT = (clock: string) => `2026-12-02T${clock}:00`;

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

// ---------- E1 지도 스타일 ----------

function filesNamed(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesNamed(path, name);
    return entry === name ? [path] : [];
  });
}

describe('E1 지도 스타일', () => {
  const ORIGINAL = join(DESIGN, 'google-map-style.json');
  const original = () => JSON.parse(readFileSync(ORIGINAL, 'utf8'));

  test('T6_E1_앱_안에_복사본이_하나이고_원본과_내용이_같다', () => {
    const copies = [...filesNamed(join(MOBILE_ROOT, 'src'), 'google-map-style.json'), ...filesNamed(join(MOBILE_ROOT, 'assets'), 'google-map-style.json')];
    expect(copies).toHaveLength(1);
    expect(JSON.parse(readFileSync(copies[0], 'utf8'))).toEqual(original());
  });

  test('T6_E1_지도에_원본과_같은_customMapStyle이_넘어간다', async () => {
    await toNow();
    expect(byId('map-view').props.customMapStyle).toEqual(original());
  });

  test('T6_E1_시각이_바뀌어도_스타일은_그대로', async () => {
    const control = nowServer();
    await toNow(control);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('10:10')));
    expect(byId('map-view').props.customMapStyle).toEqual(original());
  });
});

// ---------- E2 핀 4상태 ----------

describe('E2 핀 4상태', () => {
  const fourPins = [
    { ...pins[0], state: 'done' },
    { ...pins[1], state: 'now' },
    { ...pins[2], state: 'next' },
    { ...pins[2], seq: 4, place_id: 'D04', name: '서버_넷째_장소', state: 'later' },
  ];
  const open = () => toNow(nowServer(nowView({ pins: fourPins })));

  const views = (seq: number) => byId(`map-pin-${seq}`).queryAll((host) => host.type === 'View');
  const sized = (seq: number, size: number) => views(seq).filter((host) => styleOf(host).width === size && styleOf(host).height === size);

  test('T6_E2_지난_핀은_route_done_채움_32', async () => {
    await open();
    expect(NUMBERS['pin-done']).toBe(32);
    expect(sized(1, 32).filter((host) => upper(styleOf(host).backgroundColor) === COLORS['route-done'])).toHaveLength(1);
  });

  test('T6_E2_지금_핀은_ink_채움_32', async () => {
    await open();
    expect(NUMBERS['pin-now']).toBe(32);
    expect(sized(2, 32).filter((host) => upper(styleOf(host).backgroundColor) === COLORS.ink)).toHaveLength(1);
  });

  test('T6_E2_다음_핀은_brand_고리_36이고_brand로_채우지_않는다', async () => {
    await open();
    expect(NUMBERS['pin-next']).toBe(36);
    const ring = sized(3, 36).filter((host) => upper(styleOf(host).borderColor) === COLORS.brand && Number(styleOf(host).borderWidth) > 0);
    expect(ring).toHaveLength(1);
    expect(upper(styleOf(ring[0]).backgroundColor)).not.toBe(COLORS.brand);
  });

  test('T6_E2_나중_핀은_흰_채움_ink_테두리_28', async () => {
    await open();
    expect(NUMBERS['pin-later']).toBe(28);
    const face = sized(4, 28).filter((host) => upper(styleOf(host).backgroundColor) === COLORS.surface && upper(styleOf(host).borderColor) === COLORS.ink);
    expect(face).toHaveLength(1);
    expect(Number(styleOf(face[0]).borderWidth)).toBeGreaterThan(0);
  });

  test.each([1, 2, 4])('T6_E2_옛_모양_%i번_핀에_brand가_없다_brand는_다음_핀에만', async (seq) => {
    await open();
    const brandy = views(seq).filter((host) => [styleOf(host).backgroundColor, styleOf(host).borderColor].some((value) => upper(value) === COLORS.brand));
    expect(brandy).toEqual([]);
  });

  test('T6_E2_이름_말풍선은_다음_핀에만', async () => {
    await open();
    expect(inCard('map-pin-3').getByText(fourPins[2].name)).toBeTruthy();
    expect(inCard('map-pin-1').queryByText(fourPins[0].name)).toBeNull();
    expect(inCard('map-pin-2').queryByText(fourPins[1].name)).toBeNull();
    expect(inCard('map-pin-4').queryByText(fourPins[3].name)).toBeNull();
  });

  test.each([1, 2, 3, 4])('T6_E2_%i번_핀의_누르는_영역은_44', async (seq) => {
    await open();
    const marker = byId(`map-pin-${seq}`);
    const slop = marker.props.hitSlop ?? {};
    const box = views(seq).filter((host) => Number(styleOf(host).width) >= 44 && Number(styleOf(host).height) >= 44);
    const slopFits = sized(seq, seq === 3 ? 36 : seq === 4 ? 28 : 32).length > 0 && (seq === 3 ? 36 : seq === 4 ? 28 : 32) + Number(slop.top ?? 0) + Number(slop.bottom ?? 0) >= 44;
    expect(box.length > 0 || slopFits).toBe(true);
  });

  test('T6_E2_상태가_바뀌면_모양도_바뀐다', async () => {
    const control = nowServer(nowView({ pins: fourPins }));
    await toNow(control);
    control.show(nowView({ pins: fourPins.map((pin) => (pin.seq === 3 ? { ...pin, state: 'now' } : pin)) }));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(sized(3, 32).filter((host) => upper(styleOf(host).backgroundColor) === COLORS.ink)).toHaveLength(1));
    expect(inCard('map-pin-3').queryByText(fourPins[2].name)).toBeNull();
  });
});

// ---------- E2·E3 동선 ----------

describe('E2·E3 동선', () => {
  const lines = (prefix: string) => screen.getAllByTestId(new RegExp(`^${prefix}`)) as unknown as Tree[];
  const polylines = () => byId('map-view').queryAll((host) => host.props.mapElement === 'Polyline');

  test('T6_E2_토큰_값', () => {
    expect([NUMBERS['route-width'], NUMBERS['route-casing'], LISTS['route-dash']]).toEqual([5, 9, [10, 8]]);
  });

  test('T6_E2_지난_길은_route_done_실선_굵기_route_width', async () => {
    await toNow();
    const done = byId('map-route-done');
    expect(upper(done.props.strokeColor)).toBe(COLORS['route-done']);
    expect(done.props.strokeWidth).toBe(NUMBERS['route-width']);
    expect(done.props.lineDashPattern ?? []).toEqual([]);
  });

  test('T6_E2_남은_길은_brand_굵기_route_width', async () => {
    await toNow();
    for (const line of lines('map-route-remaining')) {
      expect(upper(line.props.strokeColor)).toBe(COLORS.brand);
      expect(line.props.strokeWidth).toBe(NUMBERS['route-width']);
    }
  });

  test('T6_E3_남은_길은_점선_방식_둘_중_하나', async () => {
    await toNow();
    expect(['pattern', 'segments']).toContain(expectDashedAlong(lines('map-route-remaining'), coords(route.remaining), LISTS['route-dash']));
  });

  test('T6_E2_흰_테두리는_surface_굵기_route_casing이고_남은_길_처음부터_끝까지', async () => {
    await toNow();
    const casing = lines('map-route-casing');
    for (const line of casing) {
      expect(upper(line.props.strokeColor)).toBe(COLORS.surface);
      expect(line.props.strokeWidth).toBe(NUMBERS['route-casing']);
      expect(line.props.lineDashPattern ?? []).toEqual([]);
    }
    const path = coords(route.remaining);
    expect(casing[0].props.coordinates[0]).toEqual(path[0]);
    const tail = casing[casing.length - 1].props.coordinates;
    expect(tail[tail.length - 1]).toEqual(path[path.length - 1]);
  });

  test('T6_E3_흰_테두리가_남은_길_아래에_깔린다', async () => {
    await toNow();
    const all = polylines();
    const isCasing = (host: Tree) => String(host.props.testID).startsWith('map-route-casing');
    const isRemaining = (host: Tree) => String(host.props.testID).startsWith('map-route-remaining');
    const lastCasing = all.reduce((found, host, index) => (isCasing(host) ? index : found), -1);
    const firstRemaining = all.findIndex(isRemaining);
    const casingZ = Math.max(...all.filter(isCasing).map((host) => Number(host.props.zIndex ?? 0)));
    const remainingZ = Math.min(...all.filter(isRemaining).map((host) => Number(host.props.zIndex ?? 0)));
    expect(lastCasing).toBeGreaterThanOrEqual(0);
    expect(remainingZ > casingZ || (remainingZ === casingZ && lastCasing < firstRemaining)).toBe(true);
  });

  test('T6_E2_남은_길이_없으면_흰_테두리도_없다', async () => {
    await toNow(nowServer(nowView({ route: { done: route.done, remaining: [] } })));
    expect(screen.queryAllByTestId(/^map-route-casing/)).toEqual([]);
    expect(screen.queryAllByTestId(/^map-route-remaining/)).toEqual([]);
  });

  // 도구 검사: 둘 중 어느 방식도 통과하고, 점선이 아니면 잡는다
  describe('E3 검사 도구', () => {
    const path: LatLng[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
    ];
    const line = (from: number, to: number) => ({
      props: {
        coordinates: [
          { latitude: 0, longitude: from },
          { latitude: 0, longitude: to },
        ],
      },
    });

    test('T6_E3_도구_lineDashPattern이면_pattern', () => {
      expect(expectDashedAlong([{ props: { coordinates: path, lineDashPattern: [10, 8] } }], path, [10, 8])).toBe('pattern');
    });

    test('T6_E3_도구_끊어진_조각이면_segments', () => {
      expect(expectDashedAlong([line(0, 2), line(4, 6), line(8, 10)], path, [10, 8])).toBe('segments');
    });

    test.each([
      ['점선 값 없는 선 하나', [{ props: { coordinates: path } }]],
      ['점선 값이 다른 선 하나', [{ props: { coordinates: path, lineDashPattern: [8, 8] } }]],
      ['이어진 조각', [line(0, 5), line(5, 10)]],
      ['경로를 벗어난 조각', [line(0, 2), { props: { coordinates: [{ latitude: 1, longitude: 4 }, { latitude: 1, longitude: 6 }] } }]],
    ])('T6_E3_도구_%s은_잡는다', (_name, hosts) => {
      expect(() => expectDashedAlong(hosts, path, [10, 8])).toThrow();
    });
  });

  test('T6_S4_6_지난_길은_땅_위_대비_3_이상', () => {
    expect(contrast(COLORS['route-done'], COLORS['map-land'])).toBeGreaterThanOrEqual(3);
  });
});

// ---------- E4 숙소로 길 안내 ----------

describe('E4 T-08 숙소로 길 안내', () => {
  const LABEL = '숙소로 길 안내';
  const shows = () => toNow(nowServer(nowView({ main: t08(), subs: [] })));

  test('T6_E4_T_08에_버튼이_있다', async () => {
    await shows();
    expect(inCard('card-T-08').getByText(LABEL)).toBeTruthy();
    expect(inCard('card-T-08').getByTestId('home-directions-button')).toBeTruthy();
  });

  test('T6_E4_누르면_서버의_map_url을_연다', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(undefined);
    await shows();
    await pressId('home-directions-button');
    await waitFor(() => expect(open).toHaveBeenCalledWith(HOME_URL));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('T6_E4_S7_열기_실패면_같은_안내', async () => {
    jest.spyOn(Linking, 'openURL').mockClear().mockRejectedValue(new Error('열 수 없음'));
    await shows();
    await pressId('home-directions-button');
    expect(await screen.findByText('구글 지도를 열 수 없어')).toBeTruthy();
    expect(screen.getByTestId('card-T-08')).toBeTruthy();
  });

  test('T6_E4_다른_카드에는_이_버튼이_없다', async () => {
    await toNow(nowServer(nowView({ main: t02(), subs: [t03()] })));
    expect(screen.queryByTestId('home-directions-button')).toBeNull();
  });
});

// ---------- E5 ----------

describe('E5 알약', () => {
  test.each<[string, string, string]>([
    ['on_track', 'ok', 'ok-bg'],
    ['delayed', 'alert', 'alert-bg'],
    ['free', 'ink', 'bg-2'],
  ])('T6_E5_B3_%s_글자_%s_바탕_%s', async (status, fg, bg) => {
    await toNow(nowServer(nowView({ status, status_text: '서버_상태' })));
    expect(upper(styleOf(byId('status-pill')).backgroundColor)).toBe(COLORS[bg]);
    expect(upper(styleOf(inCard('status-pill').getByText('서버_상태') as unknown as Tree).color)).toBe(COLORS[fg]);
  });

  test('T6_E5_늦어짐_알약의_분은_앱이_만들지_않는다_서버_글자_그대로', async () => {
    await toNow(nowServer(nowView({ status: 'delayed', status_text: '늦어지는 중' })));
    expect(inCard('status-pill').getByText('늦어지는 중')).toBeTruthy();
  });
});

describe('E5 데모 패널', () => {
  test('T6_E5_패널에_주황이_없다', async () => {
    await toNow();
    await pressId('demo-toggle');
    const colours = byId('demo-panel')
      .queryAll(() => true)
      .flatMap((host) => {
        const style = styleOf(host);
        return [style.backgroundColor, style.color, style.borderColor, host.props.stroke, host.props.fill, host.props.tintColor];
      })
      .filter((value): value is string => typeof value === 'string');
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter((value) => [COLORS.brand, COLORS['brand-soft'], COLORS['sunset-start'], COLORS['sunset-end']].includes(upper(value)))).toEqual([]);
  });
});

describe('E5 끊김 띠', () => {
  const BAND = '연결이 안 돼, 저장된 일정만 보여';

  async function offline() {
    const control = nowServer();
    await toNow(control);
    control.once(networkDown);
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await screen.findByText(BAND);
  }

  test('T6_E5_글자는_warn', async () => {
    await offline();
    expect(upper(styleOf(screen.getByText(BAND) as unknown as Tree).color)).toBe(COLORS.warn);
  });

  test('T6_E5_바탕은_warn_bg', async () => {
    await offline();
    let host = (screen.getByText(BAND) as unknown as Tree).parent;
    while (host && styleOf(host).backgroundColor === undefined) host = host.parent;
    expect(upper(styleOf(host as Tree).backgroundColor)).toBe(COLORS['warn-bg']);
  });
});

// ---------- E6 앱 아이콘·스플래시 ----------

describe('E6 앱 설정', () => {
  const asset = (path: string) => (path.startsWith('/') ? path : join(MOBILE_ROOT, path));
  const sameFile = (path: string, name: string) => {
    expect(existsSync(asset(path))).toBe(true);
    expect(statSync(asset(path)).isDirectory()).toBe(false); // 지금 ios.icon은 폴더(assets/expo.icon)
    return readFileSync(asset(path)).equals(readFileSync(join(DESIGN, name)));
  };
  const splash = () => {
    const entry = (buildConfig(null).plugins as unknown[]).find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') as [string, Record<string, unknown>];
    expect(entry).toBeDefined();
    return entry[1];
  };

  test('T6_E6_앱_아이콘은_원본과_같은_파일', () => {
    expect(sameFile(buildConfig(null).icon, 'app-icon-1024.png')).toBe(true);
  });

  test('T6_E6_iOS_아이콘도_같은_파일', () => {
    const config = buildConfig(null);
    expect(sameFile(config.ios.icon ?? config.icon, 'app-icon-1024.png')).toBe(true);
  });

  test('T6_E6_스플래시_바탕은_흰색', () => {
    expect(upper(splash().backgroundColor)).toBe('#FFFFFF');
  });

  test('T6_E6_스플래시_그림은_logo_ink', () => {
    expect(sameFile(String(splash().image), 'logo-ink.png')).toBe(true);
  });

  test('T6_S4_6_ink_strong은_on_brand와_같은_값', () => {
    expect(COLORS['ink-strong']).toBe(COLORS['on-brand']);
  });
});

// ---------- E7 진행 막대 ----------

describe('E7 진행 막대', () => {
  /** 주황으로 채운 칸의 바로 위 바탕. 없으면 빈 목록 */
  const brandOnLine = () =>
    root()
      .queryAll((host) => host.type === 'View' && upper(styleOf(host).backgroundColor) === COLORS.brand)
      .filter((host) => {
        let up = host.parent;
        while (up && styleOf(up).backgroundColor === undefined) up = up.parent;
        return up !== null && upper(styleOf(up).backgroundColor) !== COLORS.surface && host.props.accessibilityRole !== 'button';
      })
      .map((host) => host.props.testID ?? '(이름 없음)');

  test('T6_E7_도구_검사_line_트랙_위_주황을_잡고_surface_트랙은_통과', async () => {
    await render(
      <View testID="box">
        <View style={{ backgroundColor: COLORS.line }}>
          <View testID="bad" style={{ backgroundColor: COLORS.brand }} />
        </View>
        <View style={{ backgroundColor: COLORS.surface }}>
          <View testID="good" style={{ backgroundColor: COLORS.brand }} />
        </View>
      </View>,
    );
    expect(brandOnLine()).toEqual(['bad']);
  });

  test.each<[string, object]>([
    ['T-01', nowView()],
    ['T-07', nowView({ main: t07(), subs: [t02()] })],
  ])('T6_E7_SC_04_%s_주황_채움의_트랙은_surface', async (_name, view) => {
    await toNow(nowServer(view));
    await pressId('demo-toggle');
    expect(brandOnLine()).toEqual([]);
  });
});

// ---------- §14 S0 바로 보기 ----------

describe('§14 여행 중 데모 바로 보기', () => {
  const LABEL = '여행 중 데모 바로 보기';
  const asDev = async (dev: boolean, run: () => Promise<void>) => {
    const global_ = globalThis as unknown as { __DEV__: boolean };
    const saved = global_.__DEV__;
    try {
      global_.__DEV__ = dev;
      await run();
    } finally {
      global_.__DEV__ = saved;
    }
  };

  test('T6_S14_개발_빌드의_S0에_버튼이_있고_일반_버튼도_그대로', async () => {
    happyServer();
    await startApp();
    await screen.findByText('데모 여행 시작');
    expect(screen.getByText(LABEL)).toBeTruthy();
    expect(screen.getByTestId('s0-now-demo')).toBeTruthy();
  });

  test('T6_S14_개발_빌드가_아니면_없다_일반_버튼은_있다', async () => {
    await asDev(false, async () => {
      happyServer();
      await startApp();
      await screen.findByText('데모 여행 시작');
      expect(screen.queryByText(LABEL)).toBeNull();
      expect(screen.queryByTestId('s0-now-demo')).toBeNull();
    });
  });

  async function pressed(reply: object = chosenSeed()) {
    const control = nowServer();
    control.server.on(R.seed, json(201, reply));
    const app = await startApp();
    await pressId('s0-now-demo');
    await screen.findByTestId('now-main');
    await waitFor(() => expect(control.requests().length).toBeGreaterThanOrEqual(2));
    return { control, app };
  }

  test('T6_S14_누르면_chosen_시드를_한_번_보낸다', async () => {
    const { control } = await pressed();
    const sent = control.server.sent(R.seed);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ chosen: true });
  });

  test('T6_S14_둘째_날_SC_04를_17시_50분부터', async () => {
    const { control } = await pressed();
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(control.requests()[0].path.startsWith('/days/day-2/now')).toBe(true);
    expect(control.requests()[0].at).toBe(AT('17:50'));
    await pressId('demo-toggle');
    expect(byId('demo-time').queryAll((host) => host.type === 'Text').map((host) => host.props.children).join('')).toBe('17:50');
  });

  // Q1 결정: 시각과 화면은 시드 응답의 day로 만든다. 값을 앱에 박은 구현은 여기서 걸린다
  test('T6_S14_Q1_at의_날짜는_시드_응답의_day에서_온다', async () => {
    const { control } = await pressed(chosenSeed({ date: '2027-03-04' }));
    expect(control.requests()[0].at).toBe('2027-03-04T17:50:00');
    expect(control.requests()[1].at).toBe('2027-03-04T17:50:00');
  });

  test('T6_S14_Q1_시각_막대의_끝은_시드_응답의_day에서_온다', async () => {
    const { control } = await pressed(chosenSeed({ end: '18:00' }));
    await pressId('demo-toggle');
    for (let i = 0; i < 3; i += 1) await pressId('demo-plus-10');
    expect(byId('demo-time').queryAll((host) => host.type === 'Text').map((host) => host.props.children).join('')).toBe('18:00');
    await waitFor(() => expect(control.requests().at(-1)?.at).toBe(AT('18:00')));
  });

  test('T6_S14_Q1_다시_켜도_시드_응답의_날짜', async () => {
    const { control, app } = await pressed(chosenSeed({ date: '2027-03-04' }));
    await restart(app);
    await screen.findByTestId('now-main');
    expect(control.requests().at(-1)?.at).toBe('2027-03-04T17:50:00');
  });

  test('T6_S14_Q1_일반_시드_값은_그대로_day가_없다', () => {
    expect(Object.keys(seed).sort()).toEqual(['day_ids', 'trip_id']);
    expect(Object.keys(chosenSeed()).sort()).toEqual(['day', 'day_ids', 'trip_id']);
  });

  test('T6_S14_계획_세션을_시작하지_않는다', async () => {
    const { control } = await pressed();
    expect(control.server.sent(R.start)).toEqual([]);
  });

  test('T6_S14_S12_R10_시드로_만든_날이라_다시_켜도_SC_04와_마지막_시각', async () => {
    const { control, app } = await pressed();
    await restart(app);
    await screen.findByTestId('now-main');
    expect(control.requests().at(-1)?.at).toBe(AT('17:50'));
  });

  test('T6_S14_일반_데모_여행_시작은_그대로_본문_없이_시드_후_세션', async () => {
    const server = happyServer();
    await startApp();
    await pressText('데모 여행 시작');
    await screen.findByTestId('choice-walk_alley');
    const sent = server.sent(R.seed);
    expect(sent).toHaveLength(1);
    expect(sent[0].body === undefined || JSON.stringify(sent[0].body) === '{}').toBe(true);
    expect(server.sent(R.start)).toHaveLength(1);
  });

  test('T6_S14_버튼의_누르는_영역은_44', async () => {
    happyServer();
    await startApp();
    await screen.findByTestId('s0-now-demo');
    const style = styleOf(byId('s0-now-demo'));
    expect(Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0))).toBeGreaterThanOrEqual(44);
  });
});
