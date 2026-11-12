// TASK-012 §18 빈틈 1: expo-secure-store 가짜 (iOS Keychain 대신 메모리). 키 이름을 테스트가 정하지 않도록 값만 들여다본다.
const store = new Map<string, string>();

export const secureStore = {
  values: () => [...store.values()],
  clear: () => store.clear(),
};

export const getItemAsync = async (key: string, _options?: unknown) => store.get(key) ?? null;
export const setItemAsync = async (key: string, value: string, _options?: unknown) => {
  store.set(key, value);
};
export const deleteItemAsync = async (key: string, _options?: unknown) => {
  store.delete(key);
};
export const isAvailableAsync = async () => true;
export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED';
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
