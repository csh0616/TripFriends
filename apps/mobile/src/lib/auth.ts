// TASK-012 §B 익명 계정: Supabase는 로그인에만 쓴다 (DB는 서버만 읽고 쓴다, ADR-016 §3-3). 키는 공개 키만 (EXPO_PUBLIC_).
// 세션은 기기 저장소(AsyncStorage)에 둔다 (B1). 토큰은 매번 저장소에서 읽는다 (앱이 따로 들고 있지 않는다).
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// 점검 전용(로컬 Supabase) 값이 있으면 먼저 읽는다 (EXPO_PUBLIC_CHECK_API_URL과 같은 방식)
const url = process.env.EXPO_PUBLIC_CHECK_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_CHECK_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) console.warn('EXPO_PUBLIC_SUPABASE_URL·EXPO_PUBLIC_SUPABASE_KEY가 없어서 익명 로그인이 안 된다.');

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
  auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
});

let signing: Promise<string | null> | null = null;
let refreshing: Promise<string | null> | null = null;

const once = (slot: 'signing' | 'refreshing', make: () => Promise<string | null>): Promise<string | null> => {
  const current = slot === 'signing' ? signing : refreshing;
  if (current) return current;
  const promise = make()
    .catch(() => null)
    .finally(() => {
      if (slot === 'signing') signing = null;
      else refreshing = null;
    });
  if (slot === 'signing') signing = promise;
  else refreshing = promise;
  return promise;
};

/** 지금 토큰. 기기에 세션이 있으면 그대로, 없을 때만 익명 로그인 (B1·Q6). 실패하면 null */
export function ensureToken(): Promise<string | null> {
  return once('signing', async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session.access_token;
    const made = await supabase.auth.signInAnonymously();
    return made.error ? null : (made.data.session?.access_token ?? null);
  });
}

/** 401 뒤: 그 사이 다른 요청이 이미 새로 받았으면 그 토큰, 아니면 한 번 새로 받는다. 실패하면 null (새 익명 계정은 만들지 않는다, Q6) */
export function renewToken(used: string): Promise<string | null> {
  return once('refreshing', async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session && data.session.access_token !== used) return data.session.access_token;
    const renewed = await supabase.auth.refreshSession();
    return renewed.error ? null : (renewed.data.session?.access_token ?? null);
  });
}

/** 토큰 없이 열린 길 (API-001): /health, /catalog */
export const isOpenPath = (path: string) => /^\/(health|catalog)(\/|\?|$)/.test(path);
