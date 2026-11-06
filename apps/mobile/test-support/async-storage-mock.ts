// 기기 저장소 가짜. 키 이름을 테스트가 정하지 않도록, 값만 들여다볼 수 있게 한다.
const store = new Map<string, string>();

export const memoryStorage = {
  values: () => [...store.values()],
  clear: () => store.clear(),
};

const api = {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: async (key: string) => {
    store.delete(key);
  },
  clear: async () => store.clear(),
  getAllKeys: async () => [...store.keys()],
  multiRemove: async (keys: string[]) => keys.forEach((key) => store.delete(key)),
};

export default api;
export const { getItem, setItem, removeItem, clear, getAllKeys, multiRemove } = api;
