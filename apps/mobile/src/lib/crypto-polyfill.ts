// TASK-012 §19 F1: 폰(Hermes)에는 crypto.subtle이 없어 supabase-js가 PKCE를 plain으로 보낸다.
// expo-crypto(네이티브)로 getRandomValues·subtle.digest('SHA-256')를 채운다. 이미 있는 구현은 덮어쓰지 않는다.
import * as ExpoCrypto from 'expo-crypto';

type Digest = (algorithm: string, data: ArrayBuffer | ArrayBufferView) => Promise<ArrayBuffer>;

const root = globalThis as unknown as { crypto?: Record<string, unknown> };
if (!root.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
}
const target = root.crypto as { getRandomValues?: unknown; subtle?: { digest?: Digest } };

if (typeof target.getRandomValues !== 'function') {
  target.getRandomValues = <T extends ArrayBufferView>(array: T): T => ExpoCrypto.getRandomValues(array as never) as T;
}

if (typeof target.subtle?.digest !== 'function') {
  const digest: Digest = (algorithm, data) => ExpoCrypto.digest(algorithm as never, data as never) as Promise<ArrayBuffer>;
  try {
    target.subtle = { ...(target.subtle ?? {}), digest };
  } catch {
    Object.defineProperty(target, 'subtle', { value: { digest }, configurable: true });
  }
}
