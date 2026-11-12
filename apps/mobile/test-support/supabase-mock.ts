// TASK-012 B1·B4: Supabase 클라이언트(@supabase/supabase-js) 가짜. 실제 Supabase에 붙지 않는다 (네트워크 0, fetch도 쓰지 않는다).
// 진짜처럼 세션을 createClient의 options.auth.storage(기기 저장소)에 둔다. storage를 안 넘기면 앱이 켜져 있는 동안만 기억한다.
// 판단 로직 없음: 로그인·새로 받기 결과를 테스트가 정한다. jest.fn 대신 보통 함수라 restoreAllMocks에도 그대로다.

type User = { id: string; is_anonymous: boolean; email?: string };
export type FakeSession = { access_token: string; refresh_token: string; token_type: 'bearer'; expires_in: number; expires_at: number; user: User };
type Storage = { getItem: (key: string) => Promise<string | null> | string | null; setItem: (key: string, value: string) => Promise<void> | void; removeItem: (key: string) => Promise<void> | void };
type Listener = (event: string, session: FakeSession | null) => void;

const DEFAULT_KEY = 'sb-fake-auth-token';
export const GOOGLE_EMAIL = 'seunghyun@gmail.com';
export const FAKE_AUTHORIZE = 'https://fake-project.supabase.test/auth/v1/authorize';
/** 이미 다른 Supabase 사용자에 붙어 있는 Google 계정 (C4 "이미 있는 계정") */
export const EXISTING_USER_ID = '00000000-0000-4000-9000-000000000001';
/** 앱 안 브라우저에서 사용자가 하는 일: 계정 고름 / 취소(닫기) / 공급자 오류로 돌아옴 */
export type BrowserStep = 'pick' | 'cancel' | 'dismiss' | 'error' | 'hang'; // hang = 브라우저가 떠 있는 채로 앱이 꺼짐 (§18 빈틈 1)
// 오류 code가 있으면 supabase-js의 AuthApiError 모양 (예: anonymous_provider_disabled), 없으면 네트워크 실패 모양
const failure = (code?: string) =>
  code ? { name: 'AuthApiError', message: `fake auth error: ${code}`, status: 422, code } : { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };

const state = {
  memory: null as FakeSession | null, // storage가 없을 때만
  issued: 0,
  users: 0,
  signInFails: 0,
  refreshFails: 0,
  signInCode: undefined as string | undefined,
  refreshCode: undefined as string | undefined,
  refreshClears: false, // 갱신 실패 때 저장된 세션도 지운다 (supabase-js가 되돌릴 수 없는 오류에서 그렇게 하는 경우)
  signIns: 0,
  refreshes: 0,
  listeners: [] as Listener[],
  // TASK-012 2단계: Google 연결 (linkIdentity -> 앱 안 브라우저 -> 돌아온 code -> exchangeCodeForSession)
  byRefresh: new Map<string, User>(), // 발급한 refresh token -> 사용자 (setSession으로 되돌릴 때)
  byAccess: new Map<string, User>(), // 발급한 access token -> 사용자 (claim 본문 토큰이 누구 것인지 테스트가 본다)
  passwordCalls: [] as any[],
  // 실제 Supabase처럼: 로그아웃한 세션의 토큰은 무효 (그 뒤 그 토큰으로 setSession·refresh 실패). access·refresh는 한 쌍으로 무효가 된다
  revoked: new Set<string>(),
  pair: new Map<string, string>(), // access <-> refresh (양쪽 방향)
  logoutCalls: [] as { access_token: string; scope: string }[],
  updateUserCalls: [] as any[],
  codes: new Map<string, User>(), // 브라우저가 돌려준 code -> 그 code로 받을 세션의 사용자
  google: { existing: false, email: GOOGLE_EMAIL } as { existing: boolean; email: string },
  browserSteps: [] as BrowserStep[],
  linkFails: 0,
  setSessionFails: 0,
  oauthFails: 0,
  exchangeFails: 0,
  linkCalls: [] as any[],
  oauthCalls: [] as any[],
  exchangeCalls: [] as string[],
  setSessionCalls: [] as any[],
  browserCalls: [] as { url: string; redirectUrl: unknown }[],
  signOuts: 0,
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

function pairUp(access: string, refresh: string) {
  state.pair.set(access, refresh);
  state.pair.set(refresh, access);
}

/** 그 세션(access·refresh 한 쌍)을 무효로 */
function revoke(token: string | undefined) {
  if (!token) return;
  state.revoked.add(token);
  const other = state.pair.get(token);
  if (other) state.revoked.add(other);
}

/** supabase-js AuthSessionMissingError 모양 (끊긴 세션으로 setSession·refresh) */
const missing = () => ({ name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400, code: 'session_not_found' });

function issue(user: User): FakeSession {
  state.issued += 1;
  pairUp(`fake-access-${state.issued}`, `fake-refresh-${state.issued}`);
  state.byRefresh.set(`fake-refresh-${state.issued}`, user);
  state.byAccess.set(`fake-access-${state.issued}`, user);
  return {
    access_token: `fake-access-${state.issued}`,
    refresh_token: `fake-refresh-${state.issued}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

const newUser = (anonymous = true, email?: string): User => {
  state.users += 1;
  const user: User = { id: `00000000-0000-4000-8000-${String(state.users).padStart(12, '0')}`, is_anonymous: anonymous };
  return email ? { ...user, email } : user;
};

const notify = (event: string, session: FakeSession | null) => state.listeners.forEach((listener) => listener(event, session));

const auth = {
  async getSession() {
    // supabase-js v2와 같게: 저장된 세션의 access token이 만료됐으면 refresh token으로 새로 받아 돌려준다 (autoRefreshToken과 상관없이)
    const stored = await read();
    if (stored && stored.expires_at * 1000 <= Date.now()) {
      state.refreshes += 1;
      if (state.refreshFails > 0) {
        state.refreshFails -= 1;
        if (state.refreshClears) await write(null);
        return { data: { session: null }, error: failure(state.refreshCode) };
      }
      const session = issue(stored.user);
      await write(session);
      notify('TOKEN_REFRESHED', session);
      return { data: { session }, error: null };
    }
    return { data: { session: stored }, error: null };
  },
  async getUser() {
    const session = await read();
    return { data: { user: session?.user ?? null }, error: null };
  },
  async signInAnonymously() {
    state.signIns += 1;
    if (state.signInFails > 0) {
      state.signInFails -= 1;
      return { data: { session: null, user: null }, error: failure(state.signInCode) };
    }
    const session = issue(newUser());
    await write(session);
    notify('SIGNED_IN', session);
    return { data: { session, user: session.user }, error: null };
  },
  async refreshSession(given?: { refresh_token?: string }) {
    // supabase-js와 같게: refresh_token을 주면 그 세션을 새로 받아 지금 세션으로 둔다 (없으면 지금 세션)
    state.refreshes += 1;
    const stored = await read();
    const givenUser = given?.refresh_token ? state.byRefresh.get(given.refresh_token) : undefined;
    const current = given?.refresh_token ? (givenUser ? ({ ...(stored ?? issue(givenUser)), user: givenUser } as FakeSession) : null) : stored;
    const usedRefresh = given?.refresh_token ?? current?.refresh_token;
    if (usedRefresh && state.revoked.has(usedRefresh)) return { data: { session: null, user: null }, error: missing() };
    if (state.refreshFails > 0 || !current) {
      state.refreshFails = Math.max(0, state.refreshFails - 1);
      return { data: { session: null, user: null }, error: failure(state.refreshCode) };
    }
    const session = issue(current.user); // 같은 사용자, 새 토큰
    await write(session);
    notify('TOKEN_REFRESHED', session);
    return { data: { session, user: session.user }, error: null };
  },
  async signOut(_options?: unknown) {
    // 실제처럼: scope와 상관없이 지금 세션은 서버에서 끊긴다 (local은 이 세션만, global은 그 사용자의 모든 세션 — 가짜는 지금 세션만)
    state.signOuts += 1;
    const current = await read();
    revoke(current?.refresh_token);
    revoke(current?.access_token);
    await write(null);
    notify('SIGNED_OUT', null);
    return { error: null };
  },
  onAuthStateChange(listener: Listener) {
    state.listeners.push(listener);
    return { data: { subscription: { unsubscribe: () => (state.listeners = state.listeners.filter((l) => l !== listener)) } } };
  },
  /** 익명 사용자에 Google을 붙인다 (같은 user_id). skipBrowserRedirect면 브라우저로 갈 주소만 돌려준다 (supabase-js v2와 같은 모양) */
  async linkIdentity(credentials: any) {
    state.linkCalls.push(credentials);
    const current = await read();
    if (state.linkFails > 0 || !current) {
      state.linkFails = Math.max(0, state.linkFails - 1);
      return { data: { provider: credentials?.provider, url: null }, error: failure() };
    }
    return { data: { provider: credentials?.provider, url: authorizeUrl('link', credentials, current.user.id) }, error: null };
  },
  /** 이미 있는 Google 계정으로 로그인 (C4). skipBrowserRedirect면 주소만 */
  async signInWithOAuth(credentials: any) {
    state.oauthCalls.push(credentials);
    if (state.oauthFails > 0) {
      state.oauthFails -= 1;
      return { data: { provider: credentials?.provider, url: null }, error: failure() };
    }
    return { data: { provider: credentials?.provider, url: authorizeUrl('signin', credentials) }, error: null };
  },
  /** PKCE: 브라우저가 돌려준 code를 세션으로 바꾼다. 모르는 code면 오류 */
  async exchangeCodeForSession(code: string) {
    state.exchangeCalls.push(code);
    const user = state.codes.get(code);
    if (state.exchangeFails > 0 || !user) {
      state.exchangeFails = Math.max(0, state.exchangeFails - 1);
      return { data: { session: null, user: null }, error: failure(user ? undefined : 'bad_code_verifier') };
    }
    state.codes.delete(code);
    const session = issue(user);
    await write(session);
    notify('SIGNED_IN', session);
    return { data: { session, user }, error: null };
  },
  /** 보관해 둔 세션으로 되돌린다 (§9 3 [연결 취소]). refresh token을 모르면 오류 */
  async setSession(tokens: { access_token: string; refresh_token: string }) {
    state.setSessionCalls.push(tokens);
    const user = tokens?.refresh_token ? state.byRefresh.get(tokens.refresh_token) : undefined;
    if (state.setSessionFails > 0) {
      state.setSessionFails -= 1;
      return { data: { session: null, user: null }, error: failure() };
    }
    if (!user) return { data: { session: null, user: null }, error: failure('refresh_token_not_found') };
    if (state.revoked.has(tokens.refresh_token) || state.revoked.has(tokens.access_token)) return { data: { session: null, user: null }, error: missing() };
    const session: FakeSession = { ...issue(user), access_token: tokens.access_token, refresh_token: tokens.refresh_token };
    pairUp(tokens.access_token, tokens.refresh_token);
    state.byRefresh.set(tokens.refresh_token, user);
    await write(session);
    notify('SIGNED_IN', session);
    return { data: { session, user }, error: null };
  },
  /** §16 Q11 개발용 가짜 공급자 "새 계정": 익명 사용자에 테스트 이메일·비밀번호를 붙인다 (같은 user_id) */
  async updateUser(attributes: any) {
    state.updateUserCalls.push(attributes);
    const current = await read();
    if (!current) return { data: { user: null }, error: failure('session_not_found') };
    const user: User = { ...current.user, ...(attributes?.email ? { email: attributes.email, is_anonymous: false } : {}) };
    const session = { ...current, user };
    state.byRefresh.set(session.refresh_token, user);
    state.byAccess.set(session.access_token, user);
    await write(session);
    notify('USER_UPDATED', session);
    return { data: { user }, error: null };
  },
  /** §16 Q11 개발용 가짜 공급자 "이미 있는 계정": 시드된 테스트 계정으로 로그인 */
  async signInWithPassword(credentials: any) {
    state.passwordCalls.push(credentials);
    const session = issue({ id: EXISTING_USER_ID, is_anonymous: false, email: String(credentials?.email) });
    await write(session);
    notify('SIGNED_IN', session);
    return { data: { session, user: session.user }, error: null };
  },
  async startAutoRefresh() {},
  async stopAutoRefresh() {},
};

function authorizeUrl(flow: 'link' | 'signin', credentials: any, userId?: string) {
  const redirect = String(credentials?.options?.redirectTo ?? '');
  const params = [`provider=${encodeURIComponent(String(credentials?.provider))}`, `flow=${flow}`, `redirect_to=${encodeURIComponent(redirect)}`];
  if (userId) params.push(`user=${userId}`);
  return `${FAKE_AUTHORIZE}?${params.join('&')}`;
}

function param(url: string, name: string): string | null {
  const found = url.split(/[?#&]/).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

let codeSeq = 0;
function codeFor(user: User): string {
  codeSeq += 1;
  const code = `fake-code-${codeSeq}`;
  state.codes.set(code, user);
  return code;
}

/** expo-web-browser 가짜 (jest.setup이 끼운다). 진짜 Google·브라우저 없음. 사용자의 행동은 authFake.browser()로 정한다 */
export const webBrowser = {
  async openAuthSessionAsync(url: string, redirectUrl?: string, _options?: unknown) {
    state.browserCalls.push({ url, redirectUrl });
    const step = state.browserSteps.shift() ?? 'pick';
    if (step === 'hang') return new Promise<never>(() => undefined);
    if (step === 'cancel' || step === 'dismiss') return { type: step };
    const back = String(redirectUrl ?? '');
    if (step === 'error') return { type: 'success', url: `${back}?error=server_error&error_code=unexpected_failure&error_description=fake+provider+error` };
    const flow = param(url, 'flow');
    if (flow === 'link') {
      // Supabase: 이미 다른 사용자에 붙은 Google 계정이면 연결하지 않고 오류로 돌아온다
      if (state.google.existing) return { type: 'success', url: `${back}?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user` };
      return { type: 'success', url: `${back}?code=${codeFor({ id: String(param(url, 'user')), is_anonymous: false, email: state.google.email })}` };
    }
    const user: User = state.google.existing ? { id: EXISTING_USER_ID, is_anonymous: false, email: state.google.email } : newUser(false, state.google.email);
    return { type: 'success', url: `${back}?code=${codeFor(user)}` };
  },
  maybeCompleteAuthSession: () => ({ type: 'failed', message: 'fake' }),
  dismissAuthSession: () => undefined,
  warmUpAsync: async () => ({}),
  coolDownAsync: async () => ({}),
  openBrowserAsync: async () => ({ type: 'opened' }),
  WebBrowserResultType: { CANCEL: 'cancel', DISMISS: 'dismiss', OPENED: 'opened', LOCKED: 'locked' },
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
    state.signInCode = undefined;
    state.refreshCode = undefined;
    state.refreshClears = false;
    state.signIns = 0;
    state.refreshes = 0;
    state.listeners = [];
    state.codes.clear();
    state.google = { existing: false, email: GOOGLE_EMAIL };
    state.browserSteps = [];
    state.linkFails = 0;
    state.setSessionFails = 0;
    state.oauthFails = 0;
    state.exchangeFails = 0;
    state.linkCalls = [];
    state.oauthCalls = [];
    state.exchangeCalls = [];
    state.setSessionCalls = [];
    state.browserCalls = [];
    state.signOuts = 0;
    state.passwordCalls = [];
    state.revoked.clear();
    state.pair.clear();
    state.byAccess.clear(); // 앞 테스트에서 발급한 토큰이 섞이지 않게 (accessTokensOf)
    state.byRefresh.clear();
    state.logoutCalls = [];
    state.updateUserCalls = [];
  },
  /** 이미 이 기기에 세션이 있는 것처럼 (앱을 전에 연 적 있음) */
  async keepSession(options: { expired?: boolean; email?: string; expiresIn?: number } = {}): Promise<FakeSession> {
    const made = issue(options.email ? newUser(false, options.email) : newUser()); // email이 있으면 이미 Google에 연결된 기기
    const nowSec = Math.floor(Date.now() / 1000);
    // expired: 오래 백그라운드에 있다 돌아온 것처럼 · expiresIn: 그만큼(초) 뒤 만료 (§16 Q6 "만료 60초 안이면 먼저 갱신")
    const session = options.expired ? { ...made, expires_at: nowSec - 3600 } : options.expiresIn !== undefined ? { ...made, expires_in: options.expiresIn, expires_at: nowSec + options.expiresIn } : made;
    await write(session);
    return session;
  },
  /** 다음 n번 익명 로그인이 네트워크로 실패 */
  failSignIn(times = 1, code?: string) {
    state.signInFails = times;
    state.signInCode = code;
  },
  failRefresh(times = 1, code?: string, options: { clears?: boolean } = {}) {
    state.refreshFails = times;
    state.refreshCode = code;
    state.refreshClears = options.clears ?? false;
  },
  /** 앱 안 브라우저에서 고를 Google 계정. existing = 이미 다른 사용자에 붙은 계정 (C4) */
  googleAccount(options: { existing?: boolean; email?: string } = {}) {
    state.google = { existing: options.existing ?? false, email: options.email ?? GOOGLE_EMAIL };
  },
  /** 다음 브라우저 열기마다 사용자가 할 일 (차례대로, 다 쓰면 'pick') */
  browser(...steps: BrowserStep[]) {
    state.browserSteps.push(...steps);
  },
  failLink(times = 1) {
    state.linkFails = times;
  },
  failOAuth(times = 1) {
    state.oauthFails = times;
  },
  /** 다음 n번 setSession(보관한 세션으로 되돌리기)이 실패 (§18 빈틈 2) */
  failSetSession(times = 1) {
    state.setSessionFails = times;
  },
  failExchange(times = 1) {
    state.exchangeFails = times;
  },
  linkCalls: () => state.linkCalls,
  passwordCalls: () => state.passwordCalls,
  updateUserCalls: () => state.updateUserCalls,
  /** 이 access token을 받은 사용자 (모르면 undefined) */
  userOfAccess: (token: unknown) => (typeof token === 'string' ? state.byAccess.get(token) : undefined),
  oauthCalls: () => state.oauthCalls,
  exchangeCalls: () => state.exchangeCalls,
  setSessionCalls: () => state.setSessionCalls,
  browserCalls: () => state.browserCalls,
  signOuts: () => state.signOuts,
  /** 이 토큰의 세션이 끊겼나 (로그아웃됨) */
  isRevoked: (token: unknown) => typeof token === 'string' && state.revoked.has(token),
  /** 이 사용자에게 발급한 access token 전부 (옛 계정 세션이 모두 끊겼는지 볼 때) */
  accessTokensOf: (userId: string) => [...state.byAccess.entries()].filter(([, user]) => user.id === userId).map(([token]) => token),
  /**
   * Supabase `POST {SUPABASE_URL}/auth/v1/logout?scope=local` (헤더 Authorization: Bearer <그 세션의 access token>) 가짜:
   * 지금 클라이언트 세션이 아닌 **옛 계정 세션**을 따로 끊는 길. 가짜 서버(FakeServer)가 이 함수로 답한다 (fetch는 가짜 서버가 받는다)
   */
  logoutByToken(accessToken: string, scope = 'local') {
    state.logoutCalls.push({ access_token: accessToken, scope });
    if (!state.byAccess.has(accessToken) || state.revoked.has(accessToken)) return 401;
    revoke(accessToken);
    return 204;
  },
  logoutCalls: () => state.logoutCalls,
  signIns: () => state.signIns,
  refreshes: () => state.refreshes,
  session: () => read(),
};
