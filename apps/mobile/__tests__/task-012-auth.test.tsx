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
//   401 -> auth.refreshSession() 한 번 -> 같은 요청을 새 토큰으로 다시.
//     §10 Q6: 그래도 401(또는 새로 받기 실패)이면 "로그인 정보를 확인하지 못했어" + [다시](retry-button). 기기에 세션이 있으면
//     새 익명 계정을 만들지 않는다 (새 익명 로그인은 세션이 없을 때만)
//   §6 익명 로그인 실패 -> 빈 첫 화면(여행 만들기)은 보인다. 여행 만들기에서 다시 로그인. 데모도 로그인 뒤 (§11: 토큰 없이 열린 길 0)
//   §11 Q2 데모 버튼: 시드 요청에 Bearer, 본문에 as_current 없음(지금 여행으로 붙이기는 점검 전용). 앱은 시드 응답의 day_ids로 데모에 들어간다
//     §10 Q7: 여행 만들기에서 다시 해도 실패하면 "지금 연결이 안 돼. 잠시 뒤에 다시 해 줘" + [다시], 입력값 그대로
//   §6·§10 Q3·Q12 DB 연결 실패 = 서버 503 STORAGE_UNAVAILABLE -> "지금 저장소에 못 붙었어" + [다시] (첫 화면, 여행 만들기는 입력값 그대로)
//   §10 Q4: Bearer는 여행·계획·여행 중·장소 검색 요청 모두에
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
const AUTH_FAILED = '로그인 정보를 확인하지 못했어'; // §10 Q6
const SIGNIN_DOWN = '지금 연결이 안 돼. 잠시 뒤에 다시 해 줘'; // §10 Q7
const CREATE = 'POST /trips';
const STORAGE_503 = apiError(503, 'STORAGE_UNAVAILABLE');
const NOW_ISO = '2026-12-02T03:00:00Z'; // 도시 시간대 2026-12-02 12:00 (달력에서 12-10·12-11을 고를 수 있다)
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

/** 빈 첫 화면 -> [여행 만들기] -> 날짜 두 개 고르기 (task-010-create-trip과 같은 방법) */
async function toFormWithDates() {
  server.on(CURRENT, NO_TRIP);
  await startHome();
  await tap(await screen.findByText('여행 만들기'));
  await screen.findByTestId('create-trip-submit');
  await tap(await screen.findByTestId('field-start-date'));
  await screen.findByTestId('calendar-sheet');
  await tap(await screen.findByTestId('cal-day-2026-12-10'));
  await tap(await screen.findByTestId('cal-day-2026-12-11'));
  await tap(screen.getByTestId('calendar-confirm'));
  await settleAll();
}

const DATES_BODY = { city_code: 'osaka', start_date: '2026-12-10', end_date: '2026-12-11', must_visits: [] };

/** [다시]를 누른다. 다시 보내지 않았으면(로그인만 다시 했으면) 주 버튼을 한 번 더 */
async function retryCreate(before: number) {
  await tap(screen.getByTestId('retry-button'));
  await settleAll();
  if (server.sent(CREATE).length === before) await tap(screen.getByTestId('create-trip-submit'));
  await waitFor(() => expect(server.sent(CREATE).length).toBe(before + 1));
}

const auth = (server: FakeServer, route: string) => server.sent(route).map((sent) => server.headers(sent).authorization);
const tokenOf = async () => (await authFake.session())?.access_token;

let server: FakeServer;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer();
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.useRealTimers();
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
  test.each([
    ['데모 여행 시작', 'home-demo', R.seed],
    ['여행 중 데모 바로 보기', 's0-now-demo', R.seed],
  ])('T12_S11_Q2_%s_시드_요청에_Bearer_as_current_없음', async (_name, button, route) => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    server.on(CURRENT, NO_TRIP).on(route, json(201, seed)).on(R.start, json(201, session)).on(R.get, json(200, session));
    await startHome();
    await tap(await screen.findByTestId(button));
    await waitFor(() => expect(server.sent(route).length).toBeGreaterThan(0));
    const [sent] = server.sent(route);
    expect(server.headers(sent).authorization).toBe(`Bearer ${await tokenOf()}`);
    expect((sent.body as { as_current?: unknown } | undefined)?.as_current).toBeUndefined();
  });

  test('T12_Q4_계획_대화_시작_요청에도_Bearer', async () => {
    server.on(CURRENT, json(200, TRIP)).on('POST /days/day-t1/planning', json(201, session));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t1'));
    await waitFor(() => expect(server.sent('POST /days/day-t1/planning')).toHaveLength(1));
    expect(auth(server, 'POST /days/day-t1/planning')).toEqual([`Bearer ${await tokenOf()}`]);
  });

  test('T12_Q4_장소_검색_요청에도_Bearer', async () => {
    server.match('GET /places/search', () => json(200, []));
    await toFormWithDates();
    await tap(await screen.findByTestId('tab-day-2026-12-10'));
    await fireEvent.changeText(await screen.findByTestId('must-search'), '구로');
    await settleAll();
    const sent = await waitFor(() => {
      const found = server.requests.filter((r) => r.path.startsWith('/places/search'));
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const one of sent) expect(server.headers(one).authorization).toBe(`Bearer ${await tokenOf()}`);
  });

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

  // §10 Q6로 바뀜 (이전: 그래도 401이면 익명 로그인부터). 세션이 있는 기기에서 새 익명 계정을 만들면 연결 전 여행을 잃는다
  test('T12_B4_Q6_새로_받아도_401이면_안내와_다시_새_익명_계정을_만들지_않는다', async () => {
    server.on(CURRENT, apiError(401, 'UNAUTHORIZED'));
    await startHome();
    expect(await screen.findByText(AUTH_FAILED)).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
    expect(authFake.refreshes()).toBe(1);
    expect(authFake.signIns()).toBe(1); // 처음 (세션이 없던 때) 한 번뿐
    expect(server.sent(CURRENT)).toHaveLength(2); // 처음 + 새 토큰으로 한 번 더
    expect(screen.queryByTestId('app-loading')).toBeNull();
  });

  test('T12_B4_Q6_새로_받기가_실패해도_같은_안내_다시_보내지_않는다', async () => {
    authFake.failRefresh(1);
    server.on(CURRENT, apiError(401, 'UNAUTHORIZED'));
    await startHome();
    expect(await screen.findByText(AUTH_FAILED)).toBeTruthy();
    expect(authFake.signIns()).toBe(1);
    expect(server.sent(CURRENT)).toHaveLength(1);
  });

  test('T12_B4_Q6_기기에_있던_세션이면_401이_이어져도_익명_로그인_0', async () => {
    await authFake.keepSession();
    server.on(CURRENT, apiError(401, 'UNAUTHORIZED'));
    await startHome();
    await screen.findByText(AUTH_FAILED);
    expect(authFake.signIns()).toBe(0);
  });

  test('T12_B4_Q6_안내의_다시를_누르면_다시_묻고_되면_날짜_목록', async () => {
    server.once(CURRENT, apiError(401, 'UNAUTHORIZED')).once(CURRENT, apiError(401, 'UNAUTHORIZED')).on(CURRENT, json(200, TRIP));
    await startHome();
    await screen.findByText(AUTH_FAILED);
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(authFake.signIns()).toBe(1);
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

  test('T12_S6_Q7_여행_만들기에서_다시_로그인하고_또_실패하면_안내·다시_입력값_그대로', async () => {
    authFake.failSignIn(99);
    await toFormWithDates();
    await tap(screen.getByTestId('create-trip-submit'));
    expect(await screen.findByText(SIGNIN_DOWN)).toBeTruthy();
    expect(authFake.signIns()).toBeGreaterThanOrEqual(2); // 처음 + 여행 만들기에서 다시
    expect(server.sent(CREATE)).toEqual([]); // 토큰 없이 보내지 않는다
    authFake.failSignIn(0); // 연결이 돌아옴
    await retryCreate(0);
    expect(server.sent(CREATE)[0].body).toEqual(DATES_BODY); // 고른 날짜 그대로
    expect(server.headers(server.sent(CREATE)[0]).authorization).toBe(`Bearer ${await tokenOf()}`);
  });

  test('T12_S6_S11_로그인이_안_되면_데모_시드를_토큰_없이_보내지_않는다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    authFake.failSignIn(99);
    server.on(CURRENT, NO_TRIP).on(R.seed, json(201, seed)).on(R.start, json(201, session)).on(R.get, json(200, session));
    await startHome();
    await tap(await screen.findByTestId('home-demo'));
    await settleAll();
    expect(server.sent(R.seed).filter((sent) => !server.headers(sent).authorization)).toEqual([]);
  });
});

describe('§6 DB 연결 실패 (서버 503)', () => {
  test('T12_S6_지금_여행이_503이면_저장소_안내와_다시_버튼', async () => {
    server.once(CURRENT, STORAGE_503).on(CURRENT, json(200, TRIP));
    await startHome();
    expect(await screen.findByText(STORAGE_DOWN)).toBeTruthy();
    await tap(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(server.sent(CURRENT)).toHaveLength(2);
  });

  test('T12_S6_503은_로그인_문제가_아니라_토큰을_다시_받지_않는다', async () => {
    server.on(CURRENT, STORAGE_503);
    await startHome();
    await screen.findByText(STORAGE_DOWN);
    expect(authFake.refreshes()).toBe(0);
    expect(authFake.signIns()).toBe(1);
  });
});

describe('§10 Q12 여행 만들기 503', () => {
  test('T12_Q12_만들기가_503이면_저장소_안내·다시_입력값_그대로', async () => {
    server.once(CREATE, STORAGE_503).on(CREATE, json(201, TRIP));
    await toFormWithDates();
    await tap(screen.getByTestId('create-trip-submit'));
    expect(await screen.findByText(STORAGE_DOWN)).toBeTruthy();
    expect(screen.queryByTestId('day-row-day-t1')).toBeNull();
    await retryCreate(1);
    expect(server.sent(CREATE)[1].body).toEqual(server.sent(CREATE)[0].body);
    expect(server.sent(CREATE)[0].body).toEqual(DATES_BODY);
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
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
