/// <reference types="jest" />
// TASK-012 1단계 앱: 익명 계정(B1) · 요청에 Bearer(B2) · 401 다시 받기(B4) · 실패 표(§6) · 가드레일(§8, AC-4). 로직·가드레일만 본다.
// 근거: TASK-012 §B B1·B2·B4·§6 실패 표·§7 AC-4·§8, ADR-016 §2 C안(로그인 화면 없음)·§3-3(앱은 Supabase를 로그인에만, 공개 키만),
// API-001 공통(인증), apps/mobile/CLAUDE.md(비밀값 금지).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   Supabase 클라이언트 = @supabase/supabase-js의 createClient (테스트에서는 test-support/supabase-mock 가짜, 네트워크 0)
//     세션 저장은 createClient(url, key, { auth: { storage: 기기 저장소(AsyncStorage) } })에 맡긴다 -> 기기 저장소 값에 토큰이 보인다
//   첫 화면(src/app/index.tsx)을 켜면: 기기에 세션이 없으면 auth.signInAnonymously() 한 번, 있으면 부르지 않는다. 로그인 화면 없음
//   서버 요청 헤더 Authorization = `Bearer <지금 세션의 access_token>`. X-Device-Id는 보내지 않는다
//   401 -> auth.refreshSession() 한 번 -> 같은 요청을 새 토큰으로 다시. 그래도 401 -> signInAnonymously()부터 (끝없이 되풀이하지 않음)
//   §6 익명 로그인 실패 -> 빈 첫 화면(여행 만들기)은 보인다. [여행 만들기]를 누르면 다시 로그인. 데모는 로그인 없이 시작
//   §6 DB 연결 실패 = 서버 503 -> 첫 화면에 "지금 저장소에 못 붙었어" + [다시](retry-button). 503의 code 값은 정해지지 않아 보지 않는다
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json } from '../test-support/fake-server';
import { R, resetDevice, storedValues, tap } from '../test-support/planning-driver';
import { seed, session } from '../test-support/planning-fixtures';
import { hits, sourceFiles } from '../test-support/source-files';
import { authFake, createClientCalls } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NO_TRIP = apiError(404, 'NOT_FOUND', { resource: 'trip' });
const STORAGE_DOWN = '지금 저장소에 못 붙었어'; // §6
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-11',
  end_date: '2026-12-11',
  lodging_place_id: null,
  status: 'active',
  trip_days: [{ day_id: 'day-t1', date: '2026-12-11', state: 'planning', chosen_option_id: null, fixed_events: [], summary: null, must_visits: [] }],
};

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

const auth = (server: FakeServer, route: string) => server.sent(route).map((sent) => server.headers(sent).authorization);
const tokenOf = async () => (await authFake.session())?.access_token;

let server: FakeServer;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

beforeEach(() => {
  resetDevice();
  server = new FakeServer();
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.restoreAllMocks();
});

// ---------- B1 처음 열면 익명 로그인, 화면 없음 ----------

describe('B1 익명 로그인', () => {
  test('T12_B1_처음_열면_익명_로그인_한_번_로그인_화면_없이_빈_첫_화면', async () => {
    server.on(CURRENT, NO_TRIP);
    await startHome();
    expect(await screen.findByText('여행 만들기')).toBeTruthy();
    expect(authFake.signIns()).toBe(1);
    expect(screen.queryByText(/로그인/)).toBeNull(); // ADR-016 C안: 사용자에게 화면 없음
  });

  test('T12_B1_세션은_기기_저장소에_두고_다시_켜면_로그인을_다시_하지_않는다', async () => {
    server.on(CURRENT, NO_TRIP);
    const first = await startHome();
    await screen.findByText('여행 만들기');
    const token = await tokenOf();
    expect(token).toBeTruthy();
    expect(storedValues().some((value) => value.includes(token as string))).toBe(true);
    await first.unmount();
    await startHome();
    await screen.findByText('여행 만들기');
    expect(authFake.signIns()).toBe(1);
    expect(auth(server, CURRENT)).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
  });

  test('T12_B1_기기에_세션이_이미_있으면_로그인하지_않고_그_토큰을_쓴다', async () => {
    // createClient가 기기 저장소를 받았는지 먼저 본다 (가짜는 받은 저장소에 세션을 둔다)
    server.on(CURRENT, NO_TRIP);
    await startHome();
    await screen.findByText('여행 만들기');
    expect(typeof createClientCalls.at(-1)?.options?.auth?.storage?.getItem).toBe('function');
    resetDevice();
    const kept = await authFake.keepSession();
    server = new FakeServer().on(CURRENT, NO_TRIP);
    await startHome();
    await screen.findByText('여행 만들기');
    expect(authFake.signIns()).toBe(0);
    expect(auth(server, CURRENT)).toEqual([`Bearer ${kept.access_token}`]);
  });
});

// ---------- B2 요청에 Bearer, X-Device-Id 없음 ----------

describe('B2 요청 헤더', () => {
  test('T12_B2_지금_여행_요청에_Bearer_지금_토큰_X_Device_Id_없음', async () => {
    server.on(CURRENT, json(200, TRIP));
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    const [sent] = server.sent(CURRENT);
    expect(server.headers(sent).authorization).toBe(`Bearer ${await tokenOf()}`);
    expect(server.headers(sent)['x-device-id']).toBeUndefined();
  });
});

// ---------- B4 401이면 한 번 새로 받고 다시, 그래도 401이면 익명 로그인부터 ----------

describe('B4 401', () => {
  test('T12_B4_401이면_토큰을_한_번_새로_받아_같은_요청을_다시_보낸다', async () => {
    server.once(CURRENT, apiError(401, 'UNAUTHORIZED')).on(CURRENT, json(200, TRIP));
    await startHome();
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(authFake.refreshes()).toBe(1);
    expect(authFake.signIns()).toBe(1); // 처음 한 번뿐 (401 한 번에 다시 로그인하지 않는다)
    const [first, second] = auth(server, CURRENT);
    expect(second).not.toBe(first);
    expect(second).toBe(`Bearer ${await tokenOf()}`);
  });

  test('T12_B4_새로_받아도_401이면_익명_로그인부터_끝없이_되풀이하지_않는다', async () => {
    server.on(CURRENT, apiError(401, 'UNAUTHORIZED'));
    await startHome();
    await waitFor(() => expect(authFake.signIns()).toBe(2)); // 처음 + "익명 로그인부터"
    expect(authFake.refreshes()).toBe(1);
    await act(async () => {
      await new Promise<void>((done) => setTimeout(done, 50));
    });
    expect(server.sent(CURRENT).length).toBeLessThanOrEqual(3);
    expect(screen.queryByTestId('app-loading')).toBeNull(); // 멈춘 로딩이 아니다
  });

  test('T12_B4_한_번_401뒤_성공하면_그_뒤_요청은_새_토큰', async () => {
    server.once(CURRENT, apiError(401, 'UNAUTHORIZED')).on(CURRENT, json(200, TRIP));
    const first = await startHome();
    await screen.findByTestId('day-row-day-t1');
    await first.unmount();
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    const sent = auth(server, CURRENT);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toBe(sent[1]);
    expect(authFake.refreshes()).toBe(1);
  });
});

// ---------- §6 실패 표 ----------

describe('§6 익명 로그인 실패', () => {
  test('T12_S6_익명_로그인이_실패해도_첫_화면은_보이고_로딩에_멈추지_않는다', async () => {
    authFake.failSignIn(1);
    server.on(CURRENT, NO_TRIP);
    await startHome();
    expect(await screen.findByText('여행 만들기')).toBeTruthy();
    expect(screen.queryByTestId('app-loading')).toBeNull();
  });

  test('T12_S6_여행_만들기를_누르면_익명_로그인을_다시_한다', async () => {
    authFake.failSignIn(1);
    server.on(CURRENT, NO_TRIP);
    await startHome();
    await tap(await screen.findByTestId('home-create'));
    await waitFor(() => expect(authFake.signIns()).toBe(2));
  });

  test('T12_S6_데모는_로그인_없이_시작된다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    authFake.failSignIn(99);
    server.on(CURRENT, NO_TRIP).on(R.seed, json(201, seed)).on(R.start, json(201, session)).on(R.get, json(200, session));
    await startHome();
    await tap(await screen.findByTestId('home-demo'));
    await waitFor(() => expect(server.sent(R.seed)).toHaveLength(1));
    expect(await screen.findByTestId('choice-walk_alley')).toBeTruthy(); // 데모 계획 대화 첫 질문
  });
});

describe('§6 DB 연결 실패 (서버 503)', () => {
  test('T12_S6_지금_여행이_503이면_저장소_안내와_다시_버튼', async () => {
    server.once(CURRENT, apiError(503, 'CODE_미정')).on(CURRENT, json(200, TRIP));
    await startHome();
    expect(await screen.findByText(STORAGE_DOWN)).toBeTruthy();
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(server.sent(CURRENT)).toHaveLength(2);
  });

  test('T12_S6_503은_로그인_문제가_아니라_토큰을_다시_받지_않는다', async () => {
    server.on(CURRENT, apiError(503, 'CODE_미정'));
    await startHome();
    await screen.findByText(STORAGE_DOWN);
    expect(authFake.refreshes()).toBe(0);
    expect(authFake.signIns()).toBe(1);
  });
});

// ---------- 가드레일 (소스 읽기): §8 앱이 DB 직접 읽고 쓰기 금지 · AC-4 앱에 비밀 키 0 · B2 X-Device-Id 대체 ----------

describe('가드레일', () => {
  const files = sourceFiles();

  test('T12_AC4_앱_소스에_비밀_키_이름·값_모양이_없다', () => {
    expect(hits(files, /service_role|SERVICE_ROLE|sb_secret_|SUPABASE_SECRET|JWT_SECRET|DATABASE_URL|postgres(ql)?:\/\//)).toEqual([]);
  });

  test('T12_S8_앱은_Supabase를_로그인에만_DB_직접_읽기·쓰기_없음', () => {
    expect(hits(files, /\.rpc\(|\.from\(\s*['"`]|rest\/v1|\.channel\(/)).toEqual([]);
  });

  test('T12_B2_앱_소스에_X_Device_Id_헤더가_남지_않는다', () => {
    expect(hits(files, /X-Device-Id/i)).toEqual([]);
  });

  test('T12_AC4_앱이_읽는_EXPO_PUBLIC_이름에_비밀_뜻이_없다', () => {
    expect(hits(files, /EXPO_PUBLIC_\w*(SECRET|SERVICE|PASSWORD|DATABASE|JWT)/)).toEqual([]);
  });
});
