import type { components } from 'api-types';

export type Health = components['schemas']['Health'];

// 서버 주소. 폰(Expo Go)에서는 localhost가 아니라 컴퓨터의 내부 IP를 넣어야 한다 (예: http://192.168.0.10:8000)
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export async function fetchHealth(): Promise<Health> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) {
    throw new Error(`서버 응답 ${response.status}`);
  }
  return (await response.json()) as Health;
}
