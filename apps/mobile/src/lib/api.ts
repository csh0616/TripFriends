import type { components } from 'api-types';

export type Health = components['schemas']['Health'];

const FALLBACK_API_URL = 'http://localhost:8000';

// 서버 주소. 폰(Expo Go)에서는 localhost가 아니라 컴퓨터의 내부 IP를 넣어야 한다 (예: http://192.168.0.10:8000)
// TASK-004 Q30: 주소가 없으면 localhost를 쓰고 콘솔에 경고만 남긴다.
// 점검 전용 주소(EXPO_PUBLIC_CHECK_API_URL)가 있으면 그것을 먼저 쓴다 (.env.local의 API 주소보다 우선).
const configured = process.env.EXPO_PUBLIC_CHECK_API_URL || process.env.EXPO_PUBLIC_API_URL;
if (!configured) {
  console.warn(`EXPO_PUBLIC_API_URL이 없어서 ${FALLBACK_API_URL}을 쓴다. 폰에서는 컴퓨터의 내부 IP를 넣어야 한다.`);
}
export const API_URL = configured || FALLBACK_API_URL;

export async function fetchHealth(): Promise<Health> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) {
    throw new Error(`서버 응답 ${response.status}`);
  }
  return (await response.json()) as Health;
}
