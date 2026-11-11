/// <reference types="jest" />
// TASK-012 로그인 도구(src/lib/auth.ts) 단위 테스트. 로직만 본다 (돌연변이 점검 reviewer 지적).
// 근거: TASK-012 §B B1(처음 열면 익명 로그인 한 번, 세션은 기기에)·B4(401이면 한 번 새로 받고 다시)·§10 Q6(새로 받기 한 번, 세션이 있으면 새 익명 계정 없음,
//   새로 받기 실패면 안내)·Q7(익명 로그인 실패면 요청을 보내지 않음)·§11 Q1·API-001 인증 줄(토큰 없이 열린 길은 /health·/catalog뿐),
//   apps/mobile/CLAUDE.md(점검용 CHECK_SUPABASE_ 값이 있으면 먼저 읽음), TASK-004 §7·§13 "기기 저장 실패: 흐름은 계속, 콘솔 경고".
//
// 계약 (src/lib/auth.ts 지금 이름): ensureToken() -> 토큰 | null · renewToken(쓴 토큰) -> 새 토큰 | null · isOpenPath(path)
//   모듈마다 새로 읽는다 (jest.isolateModules): Supabase 가짜·기기 저장소 가짜도 그 안에서 새것
import type * as AuthModule from '@/lib/auth';
import type * as ApiModule from '@/lib/planning-api';

import type * as FakeModule from '../test-support/supabase-mock';

type Loaded = {
  auth: typeof AuthModule;
  api: typeof ApiModule;
  fake: typeof FakeModule;
  storage: { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> };
  server: import('../test-support/fake-server').FakeServer;
};

const ENV_NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'EXPO_PUBLIC_CHECK_SUPABASE_URL', 'EXPO_PUBLIC_CHECK_SUPABASE_KEY'] as const;
const saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function load(env: Partial<Record<(typeof ENV_NAMES)[number], string>> = { EXPO_PUBLIC_SUPABASE_URL: 'http://supabase.test', EXPO_PUBLIC_SUPABASE_KEY: 'public-test-key' }): Loaded {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, env);
  let loaded!: Loaded;
  jest.isolateModules(() => {
    const { FakeServer } = require('../test-support/fake-server');
    loaded = {
      fake: require('@supabase/supabase-js'),
      storage: require('@react-native-async-storage/async-storage').default,
      auth: require('@/lib/auth'),
      api: require('@/lib/planning-api'),
      server: new FakeServer(),
    };
  });
  loaded.fake.authFake.reset();
  return loaded;
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  jest.restoreAllMocks();
});

// ---------- B1·Q6 익명 로그인은 세션이 없을 때 한 번 ----------

describe('ensureToken', () => {
  test('T12_B1_세션이_없으면_익명_로그인_한_번_그_토큰', async () => {
    const { auth, fake } = load();
    const token = await auth.ensureToken();
    expect(token).toBe((await fake.authFake.session())?.access_token);
    expect(fake.authFake.signIns()).toBe(1);
  });

  test('T12_B1_Q6_세션이_있으면_로그인하지_않고_그_토큰', async () => {
    const { auth, fake } = load();
    const kept = await fake.authFake.keepSession();
    expect(await auth.ensureToken()).toBe(kept.access_token);
    expect(fake.authFake.signIns()).toBe(0);
  });

  test('T12_B1_동시에_여러_번_불러도_익명_로그인은_한_번_모두_같은_토큰', async () => {
    const { auth, fake } = load();
    const tokens = await Promise.all([auth.ensureToken(), auth.ensureToken(), auth.ensureToken()]);
    expect(fake.authFake.signIns()).toBe(1);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBeTruthy();
  });

  test('T12_B1_끝난_뒤_다시_부르면_저장된_세션을_쓴다_로그인_한_번_그대로', async () => {
    const { auth, fake } = load();
    const first = await auth.ensureToken();
    expect(await auth.ensureToken()).toBe(first);
    expect(fake.authFake.signIns()).toBe(1);
  });

  test('T12_Q7_익명_로그인이_실패하면_null_다음_부름에서_다시_한다', async () => {
    const { auth, fake } = load();
    fake.authFake.failSignIn(1);
    expect(await auth.ensureToken()).toBeNull();
    expect(await auth.ensureToken()).toBeTruthy(); // 실패를 붙잡아 두지 않는다
    expect(fake.authFake.signIns()).toBe(2);
  });
});

// ---------- B4·Q6 401 뒤 새로 받기 ----------

describe('renewToken', () => {
  test('T12_B4_쓴_토큰이_지금_토큰이면_한_번_새로_받아_새_토큰', async () => {
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    const renewed = await auth.renewToken(used);
    expect(renewed).toBeTruthy();
    expect(renewed).not.toBe(used);
    expect(renewed).toBe((await fake.authFake.session())?.access_token);
    expect(fake.authFake.refreshes()).toBe(1);
    expect(fake.authFake.signIns()).toBe(1); // 새 익명 계정 없음 (Q6)
  });

  test('T12_B4_동시에_두_요청이_401이면_새로_받기는_한_번_둘_다_같은_새_토큰', async () => {
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    const [a, b] = await Promise.all([auth.renewToken(used), auth.renewToken(used)]);
    expect(fake.authFake.refreshes()).toBe(1);
    expect(a).toBe(b);
    expect(a).not.toBe(used);
  });

  test('T12_B4_다른_요청이_이미_새로_받았으면_다시_받지_않고_그_토큰', async () => {
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    const renewed = await auth.renewToken(used);
    expect(await auth.renewToken(used)).toBe(renewed); // 옛 토큰으로 늦게 온 401
    expect(fake.authFake.refreshes()).toBe(1);
  });

  test('T12_B4_새_토큰으로도_401이면_그때는_다시_새로_받는다', async () => {
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    const renewed = (await auth.renewToken(used)) as string;
    const again = await auth.renewToken(renewed);
    expect(fake.authFake.refreshes()).toBe(2);
    expect(again).not.toBe(renewed);
  });

  test('T12_Q6_새로_받기가_실패하면_null_새_익명_계정은_만들지_않는다', async () => {
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    fake.authFake.failRefresh(1);
    expect(await auth.renewToken(used)).toBeNull();
    expect(fake.authFake.signIns()).toBe(1);
    expect(await auth.renewToken(used)).toBeTruthy(); // 실패를 붙잡아 두지 않는다
  });

  test('T12_Q6_세션이_없으면_새로_받기는_null', async () => {
    const { auth, fake } = load();
    expect(await auth.renewToken('아무_토큰')).toBeNull();
    expect(fake.authFake.signIns()).toBe(0);
  });
});

// ---------- §11 Q1·API-001 토큰 없이 열린 길은 /health·/catalog뿐 ----------

describe('isOpenPath', () => {
  test.each([
    ['/health', true],
    ['/catalog', true],
    ['/health?x=1', true],
    ['/catalog/', true],
    ['/healthz', false],
    ['/catalogs', false],
    ['/x/health', false],
    ['/health-check', false],
    ['health', false],
    ['/trips/current', false],
    ['/debug/seed-demo', false],
    ['/places/search?city_code=osaka&q=health', false],
  ])('T12_S11_%s_열린_길이면_%s', (path, open) => {
    const { auth } = load();
    expect(auth.isOpenPath(path)).toBe(open);
  });

  test.each(['/healthz', '/x/health', '/catalogs'])('T12_S11_%s_요청에는_Bearer가_붙는다', async (path) => {
    const { api, server } = load();
    server.on(`GET ${path}`, { kind: 'json', status: 200, body: {} });
    await api.send({ method: 'GET', path });
    expect(server.headers(server.requests[0]).authorization).toMatch(/^Bearer \S+$/);
  });

  test.each(['/health', '/catalog'])('T12_S11_%s_요청은_로그인_없이_토큰_없이', async (path) => {
    const { api, server, fake } = load();
    server.on(`GET ${path}`, { kind: 'json', status: 200, body: {} });
    await api.send({ method: 'GET', path });
    expect(server.headers(server.requests[0]).authorization).toBeUndefined();
    expect(fake.authFake.signIns()).toBe(0);
  });
});

// ---------- apps/mobile/CLAUDE.md 점검용 값이 있으면 먼저 ----------

describe('Supabase 설정', () => {
  test('T12_점검용_CHECK_값이_있으면_그것을_먼저', () => {
    const { fake } = load({
      EXPO_PUBLIC_SUPABASE_URL: 'http://cloud.test',
      EXPO_PUBLIC_SUPABASE_KEY: 'cloud-public-key',
      EXPO_PUBLIC_CHECK_SUPABASE_URL: 'http://127.0.0.1:54321',
      EXPO_PUBLIC_CHECK_SUPABASE_KEY: 'local-public-key',
    });
    const call = fake.createClientCalls.at(-1)!;
    expect([call.url, call.key]).toEqual(['http://127.0.0.1:54321', 'local-public-key']);
  });

  test('T12_점검용_값이_없으면_기본_값', () => {
    const { fake } = load({ EXPO_PUBLIC_SUPABASE_URL: 'http://cloud.test', EXPO_PUBLIC_SUPABASE_KEY: 'cloud-public-key' });
    const call = fake.createClientCalls.at(-1)!;
    expect([call.url, call.key]).toEqual(['http://cloud.test', 'cloud-public-key']);
  });

  test('T12_URL과_키는_따로_고른다_점검용_URL만_있으면_키는_기본', () => {
    const { fake } = load({ EXPO_PUBLIC_SUPABASE_URL: 'http://cloud.test', EXPO_PUBLIC_SUPABASE_KEY: 'cloud-public-key', EXPO_PUBLIC_CHECK_SUPABASE_URL: 'http://127.0.0.1:54321' });
    const call = fake.createClientCalls.at(-1)!;
    expect([call.url, call.key]).toEqual(['http://127.0.0.1:54321', 'cloud-public-key']);
  });

  test('T12_B1_세션은_기기_저장소에_둔다', async () => {
    const { auth, fake, storage } = load();
    const call = fake.createClientCalls.at(-1)!;
    expect(call.options.auth.persistSession).not.toBe(false);
    const token = (await auth.ensureToken()) as string;
    const keys = await (storage as unknown as { getAllKeys: () => Promise<string[]> }).getAllKeys();
    const values = await Promise.all(keys.map((k) => storage.getItem(k)));
    expect(values.some((value) => value?.includes(token))).toBe(true);
  });
});

// ---------- TASK-004 §7·§13 기기 저장 실패: 흐름은 계속, 콘솔 경고 ----------

describe('기기 저장 실패', () => {
  test('T12_저장이_실패해도_로그인은_되고_같은_토큰을_다시_쓴다_콘솔_경고', async () => {
    const { auth, fake, storage } = load();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('기기 저장 실패'));
    const token = await auth.ensureToken();
    expect(token).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    expect(await auth.ensureToken()).toBe(token); // 켜져 있는 동안은 이어 간다
    expect(fake.authFake.signIns()).toBe(1);
  });

  test('T12_읽기가_실패해도_로그인은_된다_콘솔_경고', async () => {
    const { auth, storage } = load();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(storage, 'getItem').mockRejectedValue(new Error('기기 읽기 실패'));
    expect(await auth.ensureToken()).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  test('T12_저장이_다시_되면_기기_저장소의_값을_쓴다', async () => {
    const { auth, fake, storage } = load();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('기기 저장 실패'));
    const first = (await auth.ensureToken()) as string;
    setItem.mockRestore();
    const renewed = (await auth.renewToken(first)) as string; // 새 세션은 기기 저장소에 저장된다
    expect(await auth.ensureToken()).toBe(renewed);
    expect(fake.authFake.signIns()).toBe(1);
  });
});

// ---------- 결정권자 지시 (11-11, PR 전): 익명 로그인·토큰 갱신 실패 이유를 개발 빌드에서만 console.warn (키·토큰 값은 찍지 않기) ----------
// 계약 (승인 대기): 실패 한 번에 console.warn 한 번, 인자 어딘가에 Supabase 오류 code 글자. __DEV__가 false면 이 경고 없음. 실패 동작(null·다시 시도)은 그대로

describe('실패 이유 경고 (개발 빌드만)', () => {
  const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  const setDev = (value: boolean) => ((globalThis as { __DEV__?: boolean }).__DEV__ = value);
  afterEach(() => setDev(realDev as boolean));

  const text = (calls: unknown[][]) =>
    calls
      .flat()
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg, Object.getOwnPropertyNames(arg ?? {}));
        } catch {
          return String(arg);
        }
      })
      .join(' ');

  const PUBLIC_KEY = 'public-test-key'; // load()의 기본 공개 키 값

  test.each([true, false])('T12_익명_로그인_실패_개발=%s', async (dev) => {
    setDev(dev);
    const { auth, fake } = load();
    fake.authFake.failSignIn(1, 'anonymous_provider_disabled');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await auth.ensureToken()).toBeNull(); // 동작 그대로
    if (dev) {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(text(warn.mock.calls)).toContain('anonymous_provider_disabled');
    } else {
      expect(text(warn.mock.calls)).not.toContain('anonymous_provider_disabled');
      expect(warn).not.toHaveBeenCalled();
    }
    expect(text(warn.mock.calls)).not.toContain(PUBLIC_KEY);
    warn.mockRestore();
    expect(await auth.ensureToken()).toBeTruthy(); // 다음 부름에서 다시 한다 (그대로)
    expect(fake.authFake.signIns()).toBe(2);
  });

  test.each([true, false])('T12_토큰_갱신_실패_개발=%s', async (dev) => {
    setDev(dev);
    const { auth, fake } = load();
    const used = (await auth.ensureToken()) as string;
    const stored = (await fake.authFake.session())!;
    fake.authFake.failRefresh(1, 'refresh_token_not_found');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await auth.renewToken(used)).toBeNull(); // 동작 그대로
    if (dev) {
      expect(warn).toHaveBeenCalledTimes(1);
      expect(text(warn.mock.calls)).toContain('refresh_token_not_found');
    } else {
      expect(text(warn.mock.calls)).not.toContain('refresh_token_not_found');
      expect(warn).not.toHaveBeenCalled();
    }
    const said = text(warn.mock.calls);
    for (const secret of [used, stored.access_token, stored.refresh_token, PUBLIC_KEY]) expect(said).not.toContain(secret);
    warn.mockRestore();
    expect(fake.authFake.signIns()).toBe(1); // 새 익명 계정 없음 (Q6, 그대로)
    expect(await auth.renewToken(used)).toBeTruthy(); // 다음에는 다시 받는다 (그대로)
  });

  test('T12_만료_세션_갱신_실패도_개발_빌드에서_이유_경고_토큰_값_없음', async () => {
    setDev(true);
    const { auth, fake } = load();
    const stale = await fake.authFake.keepSession({ expired: true });
    fake.authFake.failRefresh(1, 'refresh_token_already_used');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await auth.ensureToken();
    expect(text(warn.mock.calls)).toContain('refresh_token_already_used');
    for (const secret of [stale.access_token, stale.refresh_token, PUBLIC_KEY]) expect(text(warn.mock.calls)).not.toContain(secret);
  });
});

// ---------- §10 Q6 (진행 담당 답 11-11): 기기에 만료된 세션이 있고 자동 갱신이 실패해도 새 익명 계정은 만들지 않는다 ----------
// "기기에 세션이 있었는지"는 갱신을 시도하기 **전** 기기 저장소 기준이다. supabase-js가 실패하며 저장된 세션을 지워도 같다

describe('§10 Q6 만료 세션 갱신 실패', () => {
  test.each([
    ['저장된_세션이_남는_실패', false],
    ['실패하며_저장된_세션을_지우는_경우', true],
  ])('T12_Q6_%s도_새_익명_로그인_0_토큰_null', async (_name, clears) => {
    const { auth, fake } = load();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fake.authFake.keepSession({ expired: true });
    fake.authFake.failRefresh(1, 'refresh_token_not_found', { clears });
    expect(await auth.ensureToken()).toBeNull();
    expect(fake.authFake.signIns()).toBe(0);
  });

  test('T12_Q6_갱신이_다시_되면_같은_사용자로_이어_간다', async () => {
    const { auth, fake } = load();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const stale = await fake.authFake.keepSession({ expired: true });
    fake.authFake.failRefresh(1);
    expect(await auth.ensureToken()).toBeNull();
    const token = await auth.ensureToken();
    expect(token).toBeTruthy();
    expect((await fake.authFake.session())?.user.id).toBe(stale.user.id);
    expect(fake.authFake.signIns()).toBe(0);
  });
});
