// TASK-014 §A: 실제 여행의 오늘 화면에서만 쓰는 위치 읽기. 기기에는 아무것도 저장하지 않는다 (좌표는 메모리, "안내를 봤다" 표시만 기기에).
//  - 권한은 "앱 사용 중"만 묻는다 (백그라운드 위치는 부르지 않는다, A1)
//  - 화면이 앞에 있을 때만 읽는다: watch + 1분마다 직접 다시 재기 (§10 Q7). 백그라운드로 가거나 화면을 떠나면 멈춘다 (A3)
//  - 정확도가 100m보다 나쁘거나 값이 없거나 잰 지 120초가 넘은 값은 버린다 (A4·Q7). 보낼지는 live-location.ts의 shouldSend가 정한다
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { isAccurate, isFresh, RESEND_MS, shouldSend, type Reading, type SentSpot, type Spot } from '@/lib/live-location';

/** 안내 시트를 이 기기에서 이미 한 번 보여 줬다는 표시 (§10 Q10 기기당 한 번). 좌표가 아니다 */
export const INTRO_SEEN_KEY = 'tripfriends.location-intro-seen';

export type Permission = 'loading' | 'undetermined' | 'granted' | 'denied';
export type LocationSheet = 'intro' | 'off' | null;

type Options = {
  /** 실제 여행의 오늘 화면이고 연습 중이 아닐 때만 true */
  enabled: boolean;
  /** 좋은 위치(정확·신선)가 보낼 만하면 부른다 (A3) */
  onSend: (spot: Spot) => void;
};

export function useLiveLocation({ enabled, onSend }: Options) {
  const [permission, setPermission] = useState<Permission>('loading');
  const [servicesOn, setServicesOn] = useState(true);
  const [foreground, setForeground] = useState(true); // 이 화면이 열렸다 = 앱은 앞에 있다
  const [sheet, setSheet] = useState<LocationSheet>(null);
  const [spot, setSpot] = useState<Spot | null>(null); // 마지막 좋은 위치 (지도 점·SOS "위치 확인됨"). 메모리에만
  const sent = useRef<SentSpot | null>(null);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 권한·서비스 상태를 읽는다 (읽기만, 권한 창은 띄우지 않는다) */
  const refresh = useCallback(async (): Promise<Permission> => {
    try {
      const [granted, services] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
      const next: Permission = granted.status === 'granted' ? 'granted' : granted.status === 'denied' ? 'denied' : 'undetermined';
      if (alive.current) {
        setServicesOn(services);
        setPermission(next);
      }
      return next;
    } catch {
      if (alive.current) setPermission('denied');
      return 'denied';
    }
  }, []);

  // 처음 열 때: 권한을 읽고, 아직 안 물었고 안내를 못 봤으면 D1 시트 (A1, §10 Q10)
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      const now = await refresh();
      if (now !== 'undetermined' || !alive.current) return;
      const seen = await AsyncStorage.getItem(INTRO_SEEN_KEY).catch(() => null);
      if (seen !== null || !alive.current) return;
      await AsyncStorage.setItem(INTRO_SEEN_KEY, '1').catch(() => undefined);
      if (alive.current) setSheet('intro');
    })();
  }, [enabled, refresh]);

  // 앞/뒤 전환. 앞으로 돌아오면 설정 앱에서 바꿨을 수 있으니 권한을 다시 읽는다
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = AppState.addEventListener('change', (next) => {
      const front = next !== 'background';
      setForeground(front);
      if (front) void refresh();
    });
    return () => listener.remove();
  }, [enabled, refresh]);

  const active = enabled && foreground && permission === 'granted' && servicesOn;

  // 읽기: 앞에 있고 허용됐을 때만. watch + 1분마다 지금 위치를 직접 잰다
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let subscription: { remove: () => void } | null = null;
    const take = (raw: { coords: { latitude: number; longitude: number; accuracy?: number | null }; timestamp: number }) => {
      if (stopped) return;
      const reading: Reading = { lat: raw.coords.latitude, lng: raw.coords.longitude, accuracy: raw.coords.accuracy, timestamp: raw.timestamp };
      if (!isAccurate(reading) || !isFresh(reading, Date.now())) return; // 조용히 시계만 (§9 답 6)
      setSpot({ lat: reading.lat, lng: reading.lng });
      if (shouldSend(sent.current, reading)) {
        sent.current = { lat: reading.lat, lng: reading.lng, timestamp: reading.timestamp };
        sendRef.current({ lat: reading.lat, lng: reading.lng });
      }
    };
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10 }, take)
      .then((made) => {
        if (stopped) made.remove();
        else subscription = made;
      })
      .catch(() => undefined);
    const timer = setInterval(() => {
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(take).catch(() => undefined);
    }, RESEND_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription?.remove();
    };
  }, [active]);

  // 앞으로 돌아오면 마지막으로 보낸 곳 기준을 비운다: 그동안 움직였을 수 있다 (백그라운드 동안 위치는 보내지 않았다)
  useEffect(() => {
    if (!active) sent.current = null;
  }, [active]);

  const usable = permission === 'granted' && servicesOn; // 앞/뒤와 상관없이 "위치를 쓸 수 있는 기기 상태"
  const turnOn = useCallback(async () => {
    setSheet(null);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // 창을 못 띄워도 아래에서 상태를 다시 읽는다
    }
    await refresh();
  }, [refresh]);
  const later = useCallback(() => setSheet(null), []);
  const openSettings = useCallback(() => {
    setSheet(null);
    void Linking.openSettings();
  }, []);
  /** 알약을 눌렀을 때: 아직 안 물었으면 D1(다시 켜 보기), 거절·꺼짐이면 D2(설정 열기) — §9 답 1 */
  const pillPressed = useCallback(() => setSheet(permission === 'undetermined' ? 'intro' : 'off'), [permission]);

  return {
    /** 지금 읽고 있나 (앞에 있고 허용됨) */
    active,
    /** 알약을 보여야 하나: 권한 상태를 읽은 뒤, 위치를 못 쓰는 동안 */
    off: enabled && permission !== 'loading' && !usable,
    /** 부정확·오래됨으로 버린 값은 spot이 되지 않는다 */
    spot: usable ? spot : null,
    sheet,
    turnOn,
    later,
    openSettings,
    pillPressed,
    closeSheet: later,
  };
}
