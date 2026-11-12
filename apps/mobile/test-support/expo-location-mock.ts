// TASK-014 §A: expo-location 가짜 (가짜 위치 공급자). 실제 GPS·권한 창 0. 아직 설치 전이라 jest.setup.ts가 가상 모듈로 붙인다 (virtual).
// 판단 로직은 없다: 테스트가 권한 상태·서비스 켜짐·위치를 정하고, 앱이 부른 함수와 구독을 기록한다.
//
// 흉내 내는 expo-location API (이름은 저장소 안에 실제 모듈이 없어 기억에 기댄 추측이다 — 질문 목록):
//   getForegroundPermissionsAsync / requestForegroundPermissionsAsync -> {status: 'granted'|'denied'|'undetermined', granted, canAskAgain, expires}
//   getBackgroundPermissionsAsync / requestBackgroundPermissionsAsync (앱이 부르면 안 된다, A1)
//   watchPositionAsync(options, callback, errorHandler?) -> Promise<{remove()}>, callback({coords: {latitude, longitude, accuracy, ...}, timestamp})
//   getCurrentPositionAsync(options?) · getLastKnownPositionAsync(options?) -> 같은 모양의 위치 (없으면 null 또는 실패)
//   hasServicesEnabledAsync() -> 기기 위치 서비스가 켜졌나
//   startLocationUpdatesAsync / stopLocationUpdatesAsync / hasStartedLocationUpdatesAsync (백그라운드 위치. 앱이 부르면 안 된다)
//   Accuracy·PermissionStatus 열거값, useForegroundPermissions 훅
type Status = 'granted' | 'denied' | 'undetermined';
type Coords = { latitude: number; longitude: number; accuracy: number | null | undefined; altitude: number | null; altitudeAccuracy: number | null; heading: number | null; speed: number | null };
type LocationObject = { coords: Coords; timestamp: number; mocked?: boolean };
type Watcher = { callback: (location: LocationObject) => void; onError?: (reason: string) => void; removed: boolean };

const state = {
  permission: 'undetermined' as Status,
  canAskAgain: true,
  answer: 'granted' as Status, // 권한 창에서 사용자가 고를 답
  services: true,
  last: null as LocationObject | null,
  watchers: [] as Watcher[],
  // getCurrentPositionAsync가 돌려줄 값 (TASK-014 §10 Q7: 1분마다 앱이 지금 위치를 다시 잰다). null이면 마지막으로 잰 값(없으면 다음 값을 기다림)
  current: null as null | (() => LocationObject),
  waiting: [] as ((location: LocationObject) => void)[], // 아직 잰 위치가 없을 때 getCurrentPositionAsync는 다음 위치를 기다린다 (실제처럼)
};

// jest.fn 대신 직접 센다: 다른 테스트 파일의 jest.restoreAllMocks()가 가짜의 동작을 지우지 않게
const calls: string[] = [];
function tracked<A extends unknown[], R>(name: string, impl: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    calls.push(name);
    return impl(...args);
  };
}
const count = (...names: string[]) => calls.filter((name) => names.includes(name)).length;

const answer = (status: Status) => ({ status, granted: status === 'granted', canAskAgain: state.canAskAgain, expires: 'never' as const });

type SpotIn = { lat: number; lng: number; accuracy?: number | null; timestamp?: number };
/** accuracy 칸을 아예 안 주면 10m. null·undefined를 직접 주면 그대로 (TASK-014 §10 Q7: 정확도 값 없음 = 버림) */
const toLocation = (spot: SpotIn): LocationObject => ({
  coords: { latitude: spot.lat, longitude: spot.lng, accuracy: 'accuracy' in spot ? spot.accuracy : 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: spot.timestamp ?? Date.now(),
});

export const PermissionStatus = { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' } as const;
export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 } as const;
export const LocationAccuracy = Accuracy;
export const ActivityType = { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 } as const;

export const getForegroundPermissionsAsync = tracked('getForegroundPermissionsAsync', async () => answer(state.permission));
const ask = async () => {
  if (state.permission === 'undetermined') {
    state.permission = state.answer;
    if (state.answer === 'denied') state.canAskAgain = false; // iOS: 한 번 거절하면 앱이 다시 창을 띄울 수 없다
  }
  return answer(state.permission);
};
export const requestForegroundPermissionsAsync = tracked('requestForegroundPermissionsAsync', ask);
export const getBackgroundPermissionsAsync = tracked('getBackgroundPermissionsAsync', async () => answer('undetermined'));
export const requestBackgroundPermissionsAsync = tracked('requestBackgroundPermissionsAsync', async () => answer('denied'));
export const getPermissionsAsync = tracked('getPermissionsAsync', async () => answer(state.permission));
export const requestPermissionsAsync = tracked('requestPermissionsAsync', ask);
export const useForegroundPermissions = tracked('useForegroundPermissions', () => [answer(state.permission), requestForegroundPermissionsAsync, getForegroundPermissionsAsync]);
export const useBackgroundPermissions = tracked('useBackgroundPermissions', () => [answer('undetermined'), requestBackgroundPermissionsAsync, getBackgroundPermissionsAsync]);

export const hasServicesEnabledAsync = tracked('hasServicesEnabledAsync', async () => state.services);
export const enableNetworkProviderAsync = tracked('enableNetworkProviderAsync', async () => undefined);

const usable = () => state.permission === 'granted' && state.services;

export const watchPositionAsync = tracked('watchPositionAsync', async (_options: unknown, callback: (location: LocationObject) => void, onError?: (reason: string) => void) => {
  if (state.permission !== 'granted') throw new Error('Not authorized to use location services');
  if (!state.services) throw new Error('Location services are disabled');
  const watcher: Watcher = { callback, onError, removed: false };
  state.watchers.push(watcher);
  return {
    remove: () => {
      calls.push('remove');
      watcher.removed = true;
    },
  };
});
export const getCurrentPositionAsync = tracked('getCurrentPositionAsync', async (_options?: unknown) => {
  if (!usable()) throw new Error('Current location is unavailable');
  if (state.current) {
    state.last = state.current();
    return state.last;
  }
  if (state.last) return state.last;
  return new Promise<LocationObject>((resolve) => state.waiting.push(resolve));
});
export const getLastKnownPositionAsync = tracked('getLastKnownPositionAsync', async (_options?: unknown) => (usable() ? state.last : null));

export const startLocationUpdatesAsync = tracked('startLocationUpdatesAsync', async () => undefined);
export const stopLocationUpdatesAsync = tracked('stopLocationUpdatesAsync', async () => undefined);
export const hasStartedLocationUpdatesAsync = tracked('hasStartedLocationUpdatesAsync', async () => false);
export const startGeofencingAsync = tracked('startGeofencingAsync', async () => undefined);
export const geocodeAsync = tracked('geocodeAsync', async () => []);
export const reverseGeocodeAsync = tracked('reverseGeocodeAsync', async () => []);


/** 테스트 손잡이 */
export const locationFake = {
  reset() {
    state.permission = 'undetermined';
    state.canAskAgain = true;
    state.answer = 'granted';
    state.services = true;
    state.last = null;
    state.watchers = [];
    state.waiting = [];
    state.current = null;
    calls.length = 0;
  },
  /** 이미 정해진 권한 상태 (앱을 켜기 전 iOS 설정 상태) */
  permit(status: Status, canAskAgain = status !== 'denied') {
    state.permission = status;
    state.canAskAgain = canAskAgain;
  },
  /** 권한 창이 뜨면 사용자가 고를 답 */
  willAnswer(status: Status) {
    state.answer = status;
  },
  services(enabled: boolean) {
    state.services = enabled;
  },
  /** 기기가 새 위치를 잰다: 살아 있는 watch 구독마다 알린다 */
  /** 가만히 있는 사람: 앱이 지금 위치를 물을 때마다 같은 자리를 **지금 잰 값**(timestamp = 그때의 Date.now())으로 준다 */
  stayAt(spot: { lat: number; lng: number; accuracy?: number | null }) {
    state.current = () => toLocation({ ...spot, timestamp: Date.now() });
  },
  /** 폰이 예전 값을 돌려준다: 물을 때마다 ageMs만큼 오래된 timestamp */
  answerOld(spot: { lat: number; lng: number; accuracy?: number | null }, ageMs: number) {
    state.current = () => toLocation({ ...spot, timestamp: Date.now() - ageMs });
  },
  currentCount: () => count('getCurrentPositionAsync'),
  emit(spot: SpotIn) {
    const location = toLocation(spot);
    state.last = location;
    for (const watcher of state.watchers) if (!watcher.removed) watcher.callback(location);
    const waiting = state.waiting.splice(0);
    for (const resolve of waiting) resolve(location);
  },
  /** 살아 있는(remove 안 한) watch 구독 수 */
  activeWatches: () => state.watchers.filter((watcher) => !watcher.removed).length,
  /** 앱이 부른 이 가짜의 함수 이름들 (부른 순서) */
  calls: () => [...calls],
  watchCount: () => count('watchPositionAsync'),
  removeCount: () => count('remove'),
  /** 위치를 읽는 함수 (C6: 연습 중에는 0) */
  readCount: () => count('watchPositionAsync', 'getCurrentPositionAsync', 'getLastKnownPositionAsync'),
  /** 권한을 묻는 함수 (권한 창) */
  askCount: () => count('requestForegroundPermissionsAsync', 'requestPermissionsAsync', 'requestBackgroundPermissionsAsync'),
  foregroundAsks: () => count('requestForegroundPermissionsAsync', 'requestPermissionsAsync'),
  /** 백그라운드 위치 (A1: 0) */
  backgroundCount: () => count('requestBackgroundPermissionsAsync', 'getBackgroundPermissionsAsync', 'startLocationUpdatesAsync', 'startGeofencingAsync'),
  /** 위치에 닿는 모든 것 (권한 상태 읽기 포함) */
  touchCount: () => calls.filter((name) => name !== 'remove').length,
};

export default {
  PermissionStatus,
  Accuracy,
  LocationAccuracy,
  ActivityType,
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  useForegroundPermissions,
  useBackgroundPermissions,
  hasServicesEnabledAsync,
  enableNetworkProviderAsync,
  watchPositionAsync,
  getCurrentPositionAsync,
  getLastKnownPositionAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
  hasStartedLocationUpdatesAsync,
  startGeofencingAsync,
  geocodeAsync,
  reverseGeocodeAsync,
};
