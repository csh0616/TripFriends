/// <reference types="jest" />
// TASK-012 §19 F1: PKCE가 폰에서 plain으로 동작했다 (경고 "WebCrypto API is not supported") -> §15 S1 반쪽.
// 근거: TASK-012 §19 F1("crypto.subtle.digest(SHA-256)를 앱에 채운다. 테스트: authorize 주소의 code_challenge_method=s256, plain이면 실패"), §15 S1.
//
// 왜 지금까지 놓쳤나 (PR용):
//   1. 다른 테스트는 @supabase/supabase-js 전체를 가짜(test-support/supabase-mock)로 바꾼다 -> 라이브러리의 PKCE 계산 코드가 한 번도 돌지 않았다
//   2. 진짜 라이브러리를 돌려도 jest(Node)에는 crypto.subtle이 있어 s256이 나온다. 폰(React Native Hermes)에는 crypto.subtle이 없다
// 그래서 이 파일은 (1) 진짜 supabase-js를 쓰고 (2) 앱 실행 환경처럼 crypto.subtle을 지운 뒤 앱 모듈을 불러온다.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   '@/lib/auth'(Supabase 클라이언트를 만드는 모듈)를 불러오면 crypto.subtle.digest('SHA-256')가 채워져 있다 (crypto.subtle이 없던 환경에서도)
//   방법은 정하지 않는다 (expo-crypto 등). expo-crypto는 jest 가짜(Node crypto)로 바꿔 둔다 — 폰에서는 네이티브 모듈 (새로 넣으면 개발 빌드 재설치)
//   네트워크 0: 진짜 라이브러리의 fetch는 test-support/fake-server가 받는다
import { createHash } from 'node:crypto';

import { FakeServer, json } from '../test-support/fake-server';

jest.unmock('@supabase/supabase-js'); // 이 파일만 진짜 라이브러리

const REDIRECT = 'tripfriends://auth/callback';
const OAUTH = { provider: 'google', options: { redirectTo: REDIRECT, skipBrowserRedirect: true } } as const;
const realCrypto = globalThis.crypto;

const b64url = (buffer: NodeBuffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier, 'utf8').digest());
const param = (url: string, name: string) => new URL(url.replace(/^\/auth/, 'http://x/auth')).searchParams.get(name);

/** 기기 저장소 값(JSON 안의 글자까지) 가운데 이 challenge의 verifier가 있나 */
function storedVerifierFor(challenge: string): boolean {
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      strings.push(value);
      try {
        walk(JSON.parse(value));
      } catch {
        /* JSON 아님 */
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  // resetModules 뒤 앱이 쓰는 기기 저장소 가짜는 새로 불러온 것이다 (같은 모듈 묶음에서 다시 꺼낸다)
  require('../test-support/async-storage-mock').memoryStorage.values().forEach(walk);
  return strings.some((value) => challengeOf(value.replace(/\/recovery$/, '')) === challenge);
}

/** 앱 실행 환경(Hermes)처럼: crypto는 있어도 crypto.subtle이 없다 */
function withoutSubtle() {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });
}

let warnings: string[];

beforeEach(() => {
  jest.resetModules();
  require('../test-support/async-storage-mock').memoryStorage.clear();
  withoutSubtle();
  warnings = [];
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: realCrypto });
  jest.restoreAllMocks();
});

/** 기기에 익명 세션이 있는 것처럼 (linkIdentity는 지금 세션이 있어야 한다). 칸 이름은 앱이 정한 Supabase 기본 이름 */
async function keepAnonymousSession(storageKey: string) {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const now = Math.floor(Date.now() / 1000);
  const user = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
  await AsyncStorage.setItem(storageKey, JSON.stringify({ access_token: 'anon-access', refresh_token: 'anon-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user }));
}

function loadApp() {
  const auth = require('@/lib/auth');
  expect(typeof globalThis.crypto?.subtle?.digest).toBe('function'); // 앱이 채웠다
  const storageKey = `sb-${new URL(auth.supabaseEndpoint.url).hostname.split('.')[0]}-auth-token`;
  return { client: auth.authClient, storageKey };
}

test('T12_S19_F1_crypto_subtle이_없는_환경에서도_앱을_불러오면_SHA_256_digest가_있다', async () => {
  loadApp();
  const hashed = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
  expect(Buffer.from(hashed).toString('hex')).toBe(createHash('sha256').update('abc').digest('hex'));
});

test('T12_S19_F1_C2_linkIdentity의_authorize_요청은_s256이고_challenge는_verifier의_SHA_256_base64url', async () => {
  const server = new FakeServer().match('GET /auth/v1/user/identities/authorize', () => json(200, { url: 'https://accounts.google.test/o/oauth2/auth?x=1' }));
  const { client, storageKey } = loadApp();
  await keepAnonymousSession(storageKey);
  const started = await client.linkIdentity(OAUTH);
  expect(started.error).toBeNull();
  const [sent] = server.requests.filter((r) => r.path.startsWith('/auth/v1/user/identities/authorize'));
  expect(sent).toBeDefined();
  expect(param(sent.path, 'code_challenge_method')).toBe('s256');
  const challenge = param(sent.path, 'code_challenge')!;
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // SHA-256 32바이트의 base64url
  expect(storedVerifierFor(challenge)).toBe(true);
  expect(warnings.filter((line) => /WebCrypto API is not supported/.test(line))).toEqual([]);
});

test('T12_S19_F1_C4_signInWithOAuth_주소도_s256이고_challenge는_verifier의_SHA_256_base64url', async () => {
  new FakeServer();
  const { client } = loadApp();
  const started = await client.signInWithOAuth(OAUTH);
  expect(started.error).toBeNull();
  const url: string = started.data.url;
  expect(param(url.replace(/^https?:\/\/[^/]+/, ''), 'code_challenge_method')).toBe('s256');
  const challenge = param(url.replace(/^https?:\/\/[^/]+/, ''), 'code_challenge')!;
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(storedVerifierFor(challenge)).toBe(true);
  expect(warnings.filter((line) => /WebCrypto API is not supported/.test(line))).toEqual([]);
});
