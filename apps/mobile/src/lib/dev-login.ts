// TASK-012 §16 Q11·§17 3 개발용 가짜 로그인 공급자 (Maestro account-link용). 개발 빌드(__DEV__)에서만 쓰인다.
// 다른 파일은 이 모듈을 `__DEV__`가 같은 줄에 있는 require로만 부른다 (import 금지) -> 릴리스 번들에서 죽은 코드로 빠진다 (AC-6).
// 값은 __DEV__ 줄에서만 읽고, 누를 때마다 다시 읽는다 (모듈을 불러올 때 굳히지 않는다).
//   new      : 브라우저·linkIdentity 없이 익명 사용자에 테스트 이메일·비밀번호를 붙인다 (같은 user_id, 연결과 같은 결과)
//   existing : 브라우저 없이 시드된 테스트 계정으로 로그인한다 (그 뒤는 진짜 /account/claim 경로)
import { authClient } from './auth';
import { send } from './planning-api';

/** 릴리스 번들에 이 파일이 들어갔는지 찾는 표시 글자 (이 파일에만 있다) */
export const DEV_FAKE_LOGIN = 'DEV_FAKE_LOGIN';

export type DevLoginMode = 'new' | 'existing';

const NEW_EMAIL = 'link-new@example.test';
const EXISTING_EMAIL = 'link-existing@example.test';
// 로컬 Supabase 시드의 테스트 계정 비밀번호와 같아야 한다 (로컬 전용 값. 실제 계정·비밀 키 아님)
const DEV_PASSWORD = 'dev-login-local-only';

export function devLoginMode(): DevLoginMode | null {
  const raw = __DEV__ ? process.env.EXPO_PUBLIC_DEV_LOGIN : undefined; // __DEV__가 아니면 값이 있어도 무시
  return raw === 'new' || raw === 'existing' ? raw : null;
}

export async function devLinkNew(): Promise<boolean> {
  // TASK-014 §21: 연결 직전에 로컬 테스트 계정을 지운다 (서버가 로컬 DB일 때만 지움). 실패하면 연결하지 않는다. 이메일은 서버가 안다 (본문 없음)
  const reset = await send({ method: 'POST', path: '/debug/reset-test-account' });
  if (!reset.ok) return false;
  const result = await authClient.updateUser({ email: NEW_EMAIL, password: DEV_PASSWORD });
  return !result.error;
}

export async function devSignInExisting(): Promise<boolean> {
  const result = await authClient.signInWithPassword({ email: EXISTING_EMAIL, password: DEV_PASSWORD });
  return !result.error;
}
