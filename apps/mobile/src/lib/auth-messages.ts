// TASK-012 §6·§10 Q6·Q7 실패 안내 문장 (문서에 적힌 그대로)
import type { Failure } from './planning-api';

export const STORAGE_DOWN = '지금 저장소에 못 붙었어'; // 서버 503
export const AUTH_FAILED = '로그인 정보를 확인하지 못했어'; // 401, 새로 받아도 안 됨
export const SIGNIN_DOWN = '지금 연결이 안 돼. 잠시 뒤에 다시 해 줘'; // 익명 로그인 실패

/** 새 실패 종류의 안내. 해당 없으면 null */
export function authNotice(failure: Failure): string | null {
  if (failure.kind === 'storage') return STORAGE_DOWN;
  if (failure.kind === 'unauthorized') return AUTH_FAILED;
  if (failure.kind === 'auth_unavailable') return SIGNIN_DOWN;
  return null;
}
