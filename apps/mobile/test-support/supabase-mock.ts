// TASK-012 B1·B4: Supabase 클라이언트(@supabase/supabase-js) 가짜. 실제 Supabase에 붙지 않는다 (네트워크 0, fetch도 쓰지 않는다).
// 진짜처럼 세션을 createClient의 options.auth.storage(기기 저장소)에 둔다. storage를 안 넘기면 앱이 켜져 있는 동안만 기억한다.
// 판단 로직 없음: 로그인·새로 받기 결과를 테스트가 정한다. jest.fn 대신 보통 함수라 restoreAllMocks에도 그대로다.

type User = { id: string; is_anonymous: boolean };
export type FakeSession = { access_token: string; refresh_token: string; token_type: 'bearer'; expires_in: number; expires_at: number; user: User };
type Storage = { getItem: (key: string) => Promise<string | null> | string | null; setItem: (key: string, value: string) => Promise<void> | void; removeItem: (key: string) => Promise<void> | void };
type Listener = (event: string, session: FakeSession | null) => void;

const DEFAULT_KEY = 'sb-fake-auth-token';
const failure = () => ({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 });

const state = {
  memory: null as FakeSession | null, // storage가 없을 때만
  issued: 0,
  users: 0,
  signInFails: 0,
  refreshFails: 0,
  signIns: 0,
  refreshes: 0,
  listeners: [] as Listener[],
};

/** createClient를 부른 기록 (모듈을 불러올 때 한 번 부르므로 reset이 지우지 않는다) */
export const createClientCalls: { url: unknown; key: unknown; options: any }[] = [];
let storage: Storage | null = null;
let storageKey = DEFAULT_KEY;

async function read(): Promise<FakeSession | null> {
  if (!storage) return state.memory;
  const raw = await storage.getItem(storageKey);
  return raw ? (JSON.parse(raw) as FakeSession) : null;
}

async function write(session: FakeSession | null) {
  if (!storage) {
    state.memory = session;
    return;
  }
  if (session) await storage.setItem(storageKey, JSON.stringify(session));
  else await storage.removeItem(storageKey);
}

function issue(user: User): FakeSession {
  state.issued += 1;
  return {
    access_token: `fake-access-${state.issued}`,
    refresh_token: `fake-refresh-${state.issued}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

const newUser = (): User => {
  state.users += 1;
  return { id: `00000000-0000-4000-8000-${String(state.users).padStart(12, '0')}`, is_anonymous: true };
};

const notify = (event: string, session: FakeSession | null) => state.listeners.forEach((listener) => listener(event, session));

const auth = {
  async getSession() {
    return { data: { session: await read() }, error: null };
  },
  async getUser() {
    const session = await read();
    return { data: { user: session?.user ?? null }, error: null };
  },
  async signInAnonymously() {
    state.signIns += 1;
    if (state.signInFails > 0) {
      state.signInFails -= 1;
      return { data: { session: null, user: null }, error: failure() };
    }
    const session = issue(newUser());
    await write(session);
    notify('SIGNED_IN', session);
    return { data: { session, user: session.user }, error: null };
  },
  async refreshSession() {
    state.refreshes += 1;
    const current = await read();
    if (state.refreshFails > 0 || !current) {
      state.refreshFails = Math.max(0, state.refreshFails - 1);
      return { data: { session: null, user: null }, error: failure() };
    }
    const session = issue(current.user); // 같은 사용자, 새 토큰
    await write(session);
    notify('TOKEN_REFRESHED', session);
    return { data: { session, user: session.user }, error: null };
  },
  async signOut() {
    await write(null);
    notify('SIGNED_OUT', null);
    return { error: null };
  },
  onAuthStateChange(listener: Listener) {
    state.listeners.push(listener);
    return { data: { subscription: { unsubscribe: () => (state.listeners = state.listeners.filter((l) => l !== listener)) } } };
  },
  async startAutoRefresh() {},
  async stopAutoRefresh() {},
};

const directDb = () => {
  throw new Error('앱은 DB를 직접 읽고 쓰지 않는다 (TASK-012 §8, ADR-016 §3-3)');
};

export function createClient(url: unknown, key: unknown, options?: any) {
  createClientCalls.push({ url, key, options });
  storage = options?.auth?.storage ?? null;
  storageKey = options?.auth?.storageKey ?? DEFAULT_KEY;
  return { auth, from: directDb, rpc: directDb, storage: { from: directDb } };
}

/** 테스트가 쓰는 손잡이 */
export const authFake = {
  /** 기기 초기화와 함께: 세션·실패 예약·셈을 비운다 (createClient 기록은 남긴다) */
  reset() {
    state.memory = null;
    state.signInFails = 0;
    state.refreshFails = 0;
    state.signIns = 0;
    state.refreshes = 0;
    state.listeners = [];
  },
  /** 이미 이 기기에 세션이 있는 것처럼 (앱을 전에 연 적 있음) */
  async keepSession(): Promise<FakeSession> {
    const session = issue(newUser());
    await write(session);
    return session;
  },
  /** 다음 n번 익명 로그인이 네트워크로 실패 */
  failSignIn(times = 1) {
    state.signInFails = times;
  },
  failRefresh(times = 1) {
    state.refreshFails = times;
  },
  signIns: () => state.signIns,
  refreshes: () => state.refreshes,
  session: () => read(),
};
