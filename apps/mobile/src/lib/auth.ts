// TASK-012 §B 익명 계정: Supabase는 로그인에만 쓴다 (DB는 서버만 읽고 쓴다, ADR-016 §3-3). 키는 공개 키만 (EXPO_PUBLIC_).
// 세션은 기기 저장소(AsyncStorage)에 둔다 (B1). 토큰은 매번 저장소에서 읽는다 (앱이 따로 들고 있지 않는다).
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// 점검 전용(로컬 Supabase) 값이 있으면 먼저 읽는다 (EXPO_PUBLIC_CHECK_API_URL과 같은 방식)
const url = process.env.EXPO_PUBLIC_CHECK_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_CHECK_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) console.warn('EXPO_PUBLIC_SUPABASE_URL·EXPO_PUBLIC_SUPABASE_KEY가 없어서 익명 로그인이 안 된다.');

const STORAGE_KEY = 'tripfriends-auth'; // 세션을 두는 기기 저장소 칸 이름

// 기기 저장소가 막혀도 로그인은 되게: 저장·읽기가 실패한 값만 앱이 켜져 있는 동안 메모리에 둔다 (예전 기기 ID 저장과 같은 방식)
const kept = new Map<string, string>();
const storage = {
  async getItem(name: string): Promise<string | null> {
    try {
      const stored = await AsyncStorage.getItem(name);
      if (stored !== null) return stored;
    } catch {
      console.warn('STORAGE_FAILED');
    }
    return kept.get(name) ?? null;
  },
  async setItem(name: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(name, value);
      kept.delete(name);
    } catch {
      console.warn('STORAGE_FAILED');
      kept.set(name, value);
    }
  },
  async removeItem(name: string): Promise<void> {
    kept.delete(name);
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      console.warn('STORAGE_FAILED');
    }
  },
};

const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { storage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
});

export type Acquired = { token: string } | { problem: 'unauthorized' | 'unavailable' };

let signing: Promise<Acquired> | null = null;
let refreshing: Promise<string | null> | null = null;

/** 개발 빌드에서만 실패 이유를 남긴다. 오류 객체를 통째로 넘기지 않고 code·message만 (키·토큰 값 금지) */
function warnWhy(where: string, error: unknown) {
  if (!__DEV__) return;
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  console.warn('AUTH_FAILED', where, typeof e.code === 'string' ? e.code : 'no_code', typeof e.message === 'string' ? e.message : '');
}

/**
 * 지금 토큰. 기기에 세션이 있으면 그대로(만료면 supabase가 갱신), 없을 때만 익명 로그인 (B1·Q6).
 * "세션이 있었는지"는 갱신을 시도하기 전 저장소 기준: 있었는데 갱신이 실패하면 새 익명 계정을 만들지 않는다 (unauthorized)
 */
export function acquireToken(): Promise<Acquired> {
  if (signing) return signing;
  const promise = (async (): Promise<Acquired> => {
    const had = (await storage.getItem(STORAGE_KEY)) !== null;
    const { data, error } = await supabase.auth.getSession();
    if (data.session) return { token: data.session.access_token };
    if (error) warnWhy('getSession', error);
    if (had) return { problem: 'unauthorized' };
    const made = await supabase.auth.signInAnonymously();
    if (made.error || !made.data.session) {
      warnWhy('signInAnonymously', made.error);
      return { problem: 'unavailable' };
    }
    return { token: made.data.session.access_token };
  })()
    .catch((): Acquired => ({ problem: 'unavailable' }))
    .finally(() => {
      signing = null;
    });
  signing = promise;
  return promise;
}

export async function ensureToken(): Promise<string | null> {
  const got = await acquireToken();
  return 'token' in got ? got.token : null;
}

/** 401 뒤: 그 사이 다른 요청이 이미 새로 받았으면 그 토큰, 아니면 한 번 새로 받는다. 실패하면 null (새 익명 계정은 만들지 않는다, Q6) */
export function renewToken(used: string): Promise<string | null> {
  if (refreshing) return refreshing;
  const promise = (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session && data.session.access_token !== used) return data.session.access_token;
    const renewed = await supabase.auth.refreshSession();
    if (renewed.error) warnWhy('refreshSession', renewed.error);
    return renewed.error ? null : (renewed.data.session?.access_token ?? null);
  })()
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  refreshing = promise;
  return promise;
}

/** 토큰 없이 열린 길 (API-001): /health, /catalog */
export const isOpenPath = (path: string) => /^\/(health|catalog)(\/|\?|$)/.test(path);
