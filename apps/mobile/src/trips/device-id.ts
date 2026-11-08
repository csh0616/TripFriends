// TASK-010 §9 Q16: 첫 실행 때 UUID를 만들어 기기 저장소에 둔다 (TASK-006 R10이 쓰는 곳과 같은 AsyncStorage). 비밀 값이 아니다.
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_KEY = 'tripfriends.device_id';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let fallback: string | null = null; // 저장소가 막혔을 때만: 앱이 켜져 있는 동안 같은 값

function newUuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export async function getDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_KEY);
    if (stored !== null && UUID_SHAPE.test(stored)) return stored;
    const made = fallback ?? newUuid();
    await AsyncStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    console.warn('STORAGE_FAILED');
    fallback = fallback ?? newUuid();
    return fallback;
  }
}
