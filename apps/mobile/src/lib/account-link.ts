// TASK-012 2단계 C2·C4: 익명 계정을 Google 계정에 잇는다. 앱은 Supabase를 로그인에만 쓰고 (ADR-016 §3-3) 여행 옮기기는 서버가 한다.
//   새 Google 계정: linkIdentity(skipBrowserRedirect) -> 앱 안 브라우저(openAuthSessionAsync) -> 돌아온 code를 exchangeCodeForSession (PKCE). 같은 user_id
//   이미 있는 계정: 익명 세션을 기기에 보관 -> 그 계정으로 로그인(signInWithOAuth) -> POST /account/claim (헤더 = 계정 토큰, 본문 anonymous_token = 보관한 익명 토큰)
//     moved   -> 지금 여행을 다시 묻는다 / choose -> 어느 여행 시트 -> POST /account/claim/choose
//     [연결 취소] = 서버 호출 없이 보관한 익명 세션으로 (새 익명 계정을 만들지 않는다). claim 실패 = 계정 로그아웃 + 익명 복원
// 토큰·code·이메일은 console에 남기지 않는다 (§15 S4): 실패 이유는 개발 빌드에서 장소 이름과 오류 code만.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import type { components } from 'api-types';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { isTrip, type Trip } from '@/trips/api';

import { authClient, readStoredSession } from './auth';
import { send } from './planning-api';

export type Choice = components['schemas']['TripChoice'];

/** Supabase 대시보드 Redirect URL에 좁혀 등록하는 값 (TASK-012 §15 S2) */
export const REDIRECT_URL = 'tripfriends://auth/callback';

const OAUTH = { provider: 'google', options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true } } as const;
const BACKUP_KEY = 'tripfriends.account.anonymous-session'; // §16 Q6·§18: 이미 있는 계정으로 갈 때 익명 세션 전체를 기기에 보관 (SecureStore, 토큰이라 AsyncStorage에 두지 않는다)
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const ASKED_KEY = 'tripfriends.account.save-asked'; // C1: 저장 권유 시트는 한 번만
const RENEW_WITHIN_SEC = 60; // §16 Q6: claim·choose 직전 만료까지 60초 안이면 먼저 갱신

export type Outcome =
  | { kind: 'linked' } // 같은 user_id로 연결됨 (서버에 옮길 것 없음)
  | { kind: 'cancelled' } // 브라우저를 닫음: 알림 없음, 시트 그대로
  | { kind: 'failed' }
  | { kind: 'moved' }
  | { kind: 'choose'; choices: Choice[]; email: string };

// ---------- 작은 도구 ----------

function warn(where: string, error?: unknown) {
  if (!__DEV__) return;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  console.warn('LINK_FAILED', where, typeof code === 'string' ? code : 'no_code');
}

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}
async function write(key: string, value: string) {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    warn('storage');
  }
}
async function remove(key: string) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    warn('storage');
  }
}

async function currentSession(): Promise<Session | null> {
  const { data } = await authClient.getSession();
  return data.session;
}

async function readBackup(): Promise<Session | null> {
  let raw: string | null = null;
  try {
    raw = await SecureStore.getItemAsync(BACKUP_KEY, SECURE);
  } catch {
    warn('secure-read');
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return typeof parsed.access_token === 'string' && typeof parsed.refresh_token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
async function writeBackup(session: Session) {
  await SecureStore.setItemAsync(BACKUP_KEY, JSON.stringify(session), SECURE); // 못 쓰면 던진다: 보관 없이 계정으로 넘어가지 않는다
}
async function clearBackup() {
  try {
    await SecureStore.deleteItemAsync(BACKUP_KEY, SECURE);
  } catch {
    warn('secure-clear');
  }
}

/** 돌아온 주소의 값 (query와 # 뒤 둘 다) */
function callbackParams(url: string): URLSearchParams {
  const out = new URLSearchParams();
  const [head, hash] = url.split('#');
  for (const part of [head.split('?')[1], hash]) {
    if (part) new URLSearchParams(part).forEach((value, key) => out.set(key, value));
  }
  return out;
}

/** 앱 안 브라우저를 열고 돌아온 값. 닫으면 'cancelled' */
async function browse(url: string): Promise<URLSearchParams | 'cancelled'> {
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URL);
  return result.type === 'success' ? callbackParams(result.url) : 'cancelled';
}

type Signed = 'ok' | 'cancelled' | 'failed';

/** 돌아온 값의 code를 세션으로 바꾼다 (PKCE) */
async function exchange(back: URLSearchParams, where: string): Promise<Signed> {
  const code = back.get('code');
  if (back.get('error') || back.get('error_code') || !code) {
    warn(where, { code: back.get('error_code') });
    return 'failed';
  }
  const result = await authClient.exchangeCodeForSession(code);
  if (result.error) {
    warn(`${where}:exchange`, result.error);
    return 'failed';
  }
  return 'ok';
}

/** 이미 있는 Google 계정으로 로그인 (C4) */
async function signInWithGoogle(): Promise<Signed> {
  const started = await authClient.signInWithOAuth(OAUTH);
  if (started.error || !started.data?.url) {
    warn('signin', started.error);
    return 'failed';
  }
  const back = await browse(started.data.url);
  return back === 'cancelled' ? 'cancelled' : exchange(back, 'signin');
}

// ---------- 보관한 익명 세션 ----------

/**
 * 보관한 익명 세션으로 되돌린다. 먼저 그 세션을 되살려 보고, 되면 계정 세션을 로그아웃하고 그 익명으로 둔다.
 * 되살리지 못하면(§18 빈틈 2) 계정 세션을 그대로 두고 false: 새 익명 계정을 만들지 않고 보관본도 남긴다 (알려진 한계: 익명 여행이 닿지 않는 곳에 남음, 지워지지는 않음).
 * 지금 세션이 이미 그 익명 사용자면 보관본만 지운다.
 */
async function restoreAnonymous(): Promise<boolean> {
  const backup = await readBackup();
  if (!backup) return false;
  const now = await readStoredSession();
  if (now?.user.id !== backup.user.id) {
    const restored = await authClient.setSession({ access_token: backup.access_token, refresh_token: backup.refresh_token });
    const session = restored.data?.session;
    if (restored.error || !session) {
      warn('restore', restored.error);
      return false;
    }
    // 계정 세션 로그아웃 (이 기기에서). 로그아웃은 지금 세션을 비우므로 되살린 익명 세션을 다시 놓는다
    await authClient.signOut({ scope: 'local' });
    const again = await authClient.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (again.error || !again.data?.session) {
      warn('restore-again', again.error);
      return false;
    }
  }
  await clearBackup();
  return true;
}

/**
 * claim·choose 본문에 실을 익명 토큰. 만료까지 60초 안이면 먼저 갱신한다 (§16 Q6).
 * 갱신은 그 익명 세션을 지금 세션으로 만들기 때문에, 끝나면 계정 세션을 되돌려 놓는다.
 */
async function anonymousToken(): Promise<string | null> {
  const backup = await readBackup();
  if (!backup) return null;
  if ((backup.expires_at ?? 0) * 1000 - Date.now() > RENEW_WITHIN_SEC * 1000) return backup.access_token;
  const account = await currentSession();
  const renewed = await authClient.refreshSession({ refresh_token: backup.refresh_token });
  if (account) await authClient.setSession({ access_token: account.access_token, refresh_token: account.refresh_token });
  if (renewed.error || !renewed.data.session) {
    warn('renew', renewed.error);
    return null;
  }
  await writeBackup(renewed.data.session);
  return renewed.data.session.access_token;
}

// ---------- 연결 ----------

type DevLogin = { devLoginMode: () => 'new' | 'existing' | null; devLinkNew: () => Promise<boolean>; devSignInExisting: () => Promise<boolean> };

/** [Google 계정으로 계속]을 눌렀을 때 */
export async function connectGoogle(): Promise<Outcome> {
  try {
    const dev = __DEV__ ? (require('./dev-login') as DevLogin) : null;
    const mode = dev ? dev.devLoginMode() : null;
    const anonymous = await currentSession();
    if (!anonymous) return { kind: 'failed' };

    if (dev && mode === 'new') return (await dev.devLinkNew()) ? { kind: 'linked' } : { kind: 'failed' };
    if (dev && mode === 'existing') return await claimAsExisting(anonymous, async () => ((await dev.devSignInExisting()) ? 'ok' : 'failed'));

    const started = await authClient.linkIdentity(OAUTH);
    if (started.error || !started.data?.url) {
      warn('link', started.error);
      return { kind: 'failed' };
    }
    const back = await browse(started.data.url);
    if (back === 'cancelled') return { kind: 'cancelled' };
    if (back.get('error_code') === 'identity_already_exists') return await claimAsExisting(anonymous, signInWithGoogle);
    return (await exchange(back, 'link')) === 'ok' ? { kind: 'linked' } : { kind: 'failed' };
  } catch {
    warn('connect');
    return { kind: 'failed' };
  }
}

/** C4: 익명 세션 보관 -> 그 계정으로 로그인 -> claim */
async function claimAsExisting(anonymous: Session, signIn: () => Promise<Signed>): Promise<Outcome> {
  await writeBackup(anonymous);
  let signed: Signed;
  try {
    signed = await signIn();
  } catch {
    signed = 'failed';
  }
  if (signed === 'cancelled') {
    await clearBackup(); // 세션은 바뀐 것이 없다
    return { kind: 'cancelled' };
  }
  if (signed === 'failed') {
    await restoreAnonymous();
    return { kind: 'failed' };
  }
  const account = await currentSession().catch(() => null);
  if (!account) {
    await restoreAnonymous();
    return { kind: 'failed' };
  }
  return claimWithBackup(account);
}

/** 보관한 익명 토큰으로 POST /account/claim (헤더 = 지금 계정 토큰). 실패(409 포함)면 §16 Q13 복구 */
async function claimWithBackup(account: Session): Promise<Outcome> {
  const token = await anonymousToken().catch(() => null);
  if (!token) {
    await restoreAnonymous();
    return { kind: 'failed' };
  }
  const result = await send({ method: 'POST', path: '/account/claim', body: { anonymous_token: token } satisfies components['schemas']['ClaimBody'] });
  const data = result.ok ? (result.data as Partial<components['schemas']['ClaimResult']> | null) : null;
  if (data?.result === 'moved') {
    await clearBackup();
    return { kind: 'moved' };
  }
  if (data?.result === 'choose' && Array.isArray(data.choices)) return { kind: 'choose', choices: data.choices, email: account.user.email ?? '' };
  await restoreAnonymous(); // claim 실패(409 포함): 계정 로그아웃 -> 익명으로
  return { kind: 'failed' };
}

/**
 * 앱 시작 때 (§18 빈틈 1): 연결 도중 꺼졌다면 보관한 익명 세션이 남아 있다.
 * 지금 세션이 그 익명이면 보관본만 지운다 / 계정이면 claim을 다시 부른다 (moved·choose·실패는 연결할 때와 같다). 보관본이 없으면 null
 */
export async function recoverInterrupted(): Promise<Outcome | null> {
  try {
    const backup = await readBackup();
    if (!backup) return null;
    const now = await readStoredSession();
    if (now && now.user.id === backup.user.id) {
      await clearBackup();
      return null;
    }
    if (!now || now.user.is_anonymous) {
      return (await restoreAnonymous()) ? null : { kind: 'failed' };
    }
    return await claimWithBackup(now);
  } catch {
    warn('recover');
    return null;
  }
}

/** 어느 여행 시트 [이걸로 할래]: 고른 여행의 Trip. 실패하면 계정 로그아웃 + 익명으로 (claim 실패와 같은 복구) */
export async function chooseTrip(tripId: string): Promise<{ ok: true; trip: Trip } | { ok: false }> {
  try {
    const token = await anonymousToken();
    if (token) {
      const result = await send({ method: 'POST', path: '/account/claim/choose', body: { anonymous_token: token, trip_id: tripId } satisfies components['schemas']['ChooseBody'] });
      if (result.ok && isTrip(result.data)) {
        await clearBackup();
        return { ok: true, trip: result.data };
      }
    }
  } catch {
    warn('choose');
  }
  await restoreAnonymous().catch(() => false);
  return { ok: false };
}

/** 어느 여행 시트 [연결 취소]: 서버 호출 없이 보관한 익명 세션으로. 못 돌아가면 false */
export async function cancelChoose(): Promise<boolean> {
  try {
    return await restoreAnonymous();
  } catch {
    return false;
  }
}

// ---------- 로그아웃 · 상태 ----------

/** [로그아웃]: 계정에서 나가 새 익명 계정으로 (여행은 계정에 남는다). 실패하면 false */
export async function logoutToAnonymous(): Promise<boolean> {
  try {
    await authClient.signOut({ scope: 'local' });
    const made = await authClient.signInAnonymously();
    if (made.error || !made.data.session) {
      warn('logout', made.error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type AccountInfo = { linked: boolean; email: string | null };
const toInfo = (session: Session | null): AccountInfo => ({ linked: session !== null && !session.user.is_anonymous, email: session?.user.email ?? null });

/** 지금 세션의 연결 상태 (기기에 저장된 세션을 그대로 읽는다. 새로 받기·네트워크 없음) */
export async function readAccountInfo(): Promise<AccountInfo> {
  return toInfo(await readStoredSession());
}

export function watchAccount(onInfo: (info: AccountInfo) => void): () => void {
  const { data } = authClient.onAuthStateChange((_event, session) => onInfo(toInfo(session)));
  return () => data.subscription.unsubscribe();
}

// ---------- 저장 권유 한 번 (C1) ----------

export const wasAsked = async () => (await read(ASKED_KEY)) !== null;
export const markAsked = () => write(ASKED_KEY, '1');
