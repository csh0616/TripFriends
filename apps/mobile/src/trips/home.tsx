// TASK-010 §C1 첫 화면: 앱을 켜면 GET /trips/current. 404면 빈 상태 + [여행 만들기] (데모 버튼은 개발 빌드에서만 그 아래 보조),
// 있으면 날짜 목록. 날 줄을 누르면 계획 대화 / 여행 중 화면 (§C3). 실제 여행의 오늘은 시계만 쓰고 데모 시계·버튼이 없다 (§C4·C7).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { AccountProvider, useAccount } from '@/account/account-context';
import { Text } from '@/components/app-text';
import { Notice } from '@/components/planning/notice';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { authNotice } from '@/lib/auth-messages';
import { cityClock } from '@/lib/calendar';
import type { DayDestination } from '@/lib/day-list';
import { send } from '@/lib/planning-api';
import { TripNowScreen, type NowRecord } from '@/now/trip-now-screen';
import { fontAssets } from '@/planning/fonts';
import { layout } from '@/planning/layout';
import PlanningFlow, { NOW_KEY, STORAGE_KEY } from '@/planning/planning-flow';
import { color, space, text } from '@/planning/theme';

import { isTrip, tripRequests, type Trip, type TripDay } from './api';
import { CourseReadonly } from './course-readonly';
import { CreateTripScreen } from './create-trip-screen';
import { TripDays } from './trip-days';

const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';

type View_ =
  | { name: 'loading' }
  | { name: 'empty'; notice: string | null }
  | { name: 'demo'; start?: 'demo' | 'now' }
  | { name: 'create' }
  | { name: 'days' }
  | { name: 'planning'; dayId: string; mode?: 'conversation' | 'auto' }
  | { name: 'course'; day: TripDay }
  | { name: 'now'; record: NowRecord };

const pad = (value: number) => String(value).padStart(2, '0');

/** 실제 여행의 오늘 기록: 시각은 도시 시간대의 지금, 위치·데모 없음. day는 첫 응답 전까지의 임시 값 (응답의 day로 바뀐다) */
function liveRecord(day: TripDay, index: number): NowRecord {
  const clock = cityClock(Date.now());
  return {
    day_id: day.day_id,
    at: `${day.date}T${pad(Math.floor(clock.minutes / 60))}:${pad(clock.minutes % 60)}:00`,
    demo: false,
    live: true,
    day: { day_id: day.day_id, day_number: index + 1, date: day.date, start: '00:00', end: '23:59', lodging: { lat: 0, lng: 0 }, must_visits: [], fixed: [] },
  };
}

/** 계정 연결(저장 권유·어느 여행·실패 알림, TASK-012 2단계)이 홈 위에 올라간다. 옮긴 뒤·고른 뒤의 지금 여행은 홈이 다시 받는다 */
export default function Home() {
  const hooks = useRef<{ reload: () => void; trip: (made: Trip) => void }>({ reload: () => undefined, trip: () => undefined });
  const reload = useCallback(() => hooks.current.reload(), []);
  const onTrip = useCallback((made: Trip) => hooks.current.trip(made), []);
  return (
    <AccountProvider onReload={reload} onTrip={onTrip}>
      <HomeBody hooks={hooks} />
    </AccountProvider>
  );
}

const plannedCount = (trip: Trip | null) => (trip ? trip.trip_days.filter((day) => day.chosen_option_id !== null).length : 0);

function HomeBody({ hooks }: { hooks: React.RefObject<{ reload: () => void; trip: (made: Trip) => void }> }) {
  const account = useAccount();
  const [fontsReady, fontError] = useFonts(fontAssets);
  const [view, setView] = useState<View_>({ name: 'loading' });
  const [trip, setTrip] = useState<Trip | null>(null);
  const sessions = useRef<Record<string, string>>({}); // 날 id -> 계획 대화 세션 (앱이 켜져 있는 동안만)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 서버에 지금 여행을 묻는다 (Bearer). 404 = 빈 첫 화면 */
  const load = useCallback(async (): Promise<Trip | null> => {
    setView({ name: 'loading' });
    const result = await send(tripRequests.current());
    if (!alive.current) return null;
    if (result.ok && isTrip(result.data)) {
      setTrip(result.data);
      setView({ name: 'days' });
      return result.data;
    }
    if (!result.ok && result.failure.kind === 'not_found') {
      setTrip(null);
      // 이어 가던 데모(계획 대화·여행 중 데모)가 기기에 있으면 그대로 이어 간다 (TASK-006 R10)
      const stored = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(NOW_KEY)]).catch(() => [null, null]);
      if (!alive.current) return null;
      setView(stored.some((value) => value !== null) ? { name: 'demo' } : { name: 'empty', notice: null });
      return null;
    }
    // 익명 로그인이 안 됐으면 안내 없이 빈 첫 화면 (§6: 여행 만들기에서 다시 로그인). 저장소 503·401은 안내 + [다시]
    const failure = result.ok ? null : result.failure;
    if (failure?.kind === 'auth_unavailable') {
      setView({ name: 'empty', notice: null });
      return null;
    }
    setView({ name: 'empty', notice: (failure && authNotice(failure)) ?? (failure?.kind === 'network' ? OFFLINE : OOPS) });
    return null;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 계정 연결이 끝난 뒤: 옮겼다/로그아웃했다 -> 지금 여행을 다시 묻고, 어느 여행을 골랐다 -> 그 여행의 날짜 목록
  useEffect(() => {
    hooks.current.reload = () => void load();
    hooks.current.trip = (made) => {
      setTrip(made);
      setView({ name: 'days' });
    };
  }, [hooks, load]);

  const open = (day: TripDay, destination: DayDestination, mode?: 'auto') => {
    if (destination === 'planning') {
      if (mode === 'auto') delete sessions.current[day.day_id]; // [알아서 짜 줘]는 이어 가던 대화가 아니라 새로 자동 계획
      setView({ name: 'planning', dayId: day.day_id, mode });
    }
    else if (destination === 'course' || destination === 'review') setView({ name: 'course', day });
    else if (destination === 'now' && trip) setView({ name: 'now', record: liveRecord(day, trip.trip_days.indexOf(day)) });
  };

  // 글꼴을 못 읽어도 막지 않는다 (시스템 글꼴). 읽는 중에만 빈 화면
  if (!fontsReady && !fontError) return <View style={styles.blank} />;

  switch (view.name) {
    case 'loading':
      return (
        <ScreenFrame>
          <View testID="app-loading" style={styles.center}>
            <ActivityIndicator color={color.muted} />
          </View>
        </ScreenFrame>
      );
    case 'empty':
      return <EmptyHome notice={view.notice} onRetry={view.notice ? () => void load() : undefined} onCreate={() => setView({ name: 'create' })} onDemo={(start) => setView({ name: 'demo', start })} />;
    case 'demo':
      return <PlanningFlow autoStart={view.start} onLeave={() => void load()} />;
    case 'create':
      return (
        <CreateTripScreen
          onBack={() => setView(trip ? { name: 'days' } : { name: 'empty', notice: null })}
          onCreated={(made) => {
            setTrip(made);
            setView({ name: 'days' });
          }}
        />
      );
    case 'course':
      return <CourseReadonly dayId={view.day.day_id} date={view.day.date} number={(trip ? trip.trip_days.indexOf(view.day) : 0) + 1} onBack={() => setView({ name: 'days' })} />;
    case 'planning': {
      // 끝나면(코스 고름·세션 없음) 날짜 목록을 다시 받아 "계획 완료"를 보여 준다. ‹ 날짜로 나가면 대화는 그대로 남고, 다시 들어가면 GET으로 이어 간다
      const dayId = view.dayId;
      return (
        <PlanningFlow
          dayId={dayId}
          startMode={view.mode}
          resumeSessionId={sessions.current[dayId]}
          onSession={(sid) => (sessions.current[dayId] = sid)}
          onBackToList={() => setView({ name: 'days' })}
          onLeave={() => {
            delete sessions.current[dayId];
            // 코스를 고른 그 순간에만 저장 권유 (TASK-012 C1): 계획 완료인 날이 늘었을 때. 데모 뒤·이미 계획한 여행을 열 때는 없다
            const before = plannedCount(trip);
            void load().then((next) => {
              if (next && plannedCount(next) > before) void account.offerSave();
            });
          }}
        />
      );
    }
    case 'now':
      return <TripNowScreen key={view.record.day_id} record={view.record} onAtChange={noop} onNoCourse={() => setView({ name: 'planning', dayId: view.record.day_id })} onExit={() => setView({ name: 'days' })} />;
    case 'days':
      return trip ? (
        <TripDays trip={trip} onOpen={open} onTripChange={setTrip} onNewTrip={() => setView({ name: 'create' })} />
      ) : null;
  }
}

const noop = () => undefined;

function EmptyHome({
  notice,
  onRetry,
  onCreate,
  onDemo,
}: {
  notice: string | null;
  onRetry?: () => void;
  onCreate: () => void;
  onDemo: (start: 'demo' | 'now') => void;
}) {
  return (
    <ScreenFrame>
      <View style={styles.center}>
        <Image
          testID="s0-logo"
          accessibilityLabel="Tripfriends"
          source={require('../../assets/brand/logo-ink.png')}
          resizeMode="contain"
          style={styles.logo}
        />
        <Text style={text('body', 'muted')}>AI 여행친구</Text>
      </View>
      <View style={styles.action}>
        <PrimaryButton testID="home-create" label="여행 만들기" onPress={onCreate} />
        {/* TASK-010 §C1: 데모 버튼은 개발 빌드에서만, 그 아래 보조로 */}
        {__DEV__ ? (
          <>
            <SecondaryButton testID="home-demo" label="데모 여행 시작" onPress={() => onDemo('demo')} />
            <SecondaryButton testID="s0-now-demo" label="여행 중 데모 바로 보기" onPress={() => onDemo('now')} />
          </>
        ) : null}
        {notice ? <Notice message={notice} tone="plain" onRetry={onRetry} /> : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space['space-3'], minHeight: layout.photo },
  logo: { width: layout.logoWidth, height: layout.logoHeight },
  action: { gap: space['space-4'] },
});
