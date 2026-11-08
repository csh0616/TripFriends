// TASK-006 B3~B10: 여행 중 화면 SC-04. 지도(바탕) + 카드 시트 3단 + 데모 시계.
// 앱은 그리기만 한다: 카드를 고르지 않고(서버 main이 이긴다, §6) 일정을 바꾸지 않는다. 시각은 데모 시계만 쓴다 (실제 시계는 쓰지 않는다).
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Constants from 'expo-constants';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { DemoPanel } from '@/components/now/demo-panel';
import { MapAdapter, type MapAdapterHandle } from '@/components/now/map-adapter';
import { NowCardView } from '@/components/now/now-cards';
import { FriendAvatar } from '@/components/planning/friend-bubble';
import { LocateIcon } from '@/components/planning/icons';
import { InputBar } from '@/components/planning/input-bar';
import { Notice } from '@/components/planning/notice';
import { RouteDiagram } from '@/components/planning/route-diagram';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { SosButton } from '@/components/planning/sos-button';
import { SosSheet } from '@/components/planning/sos-sheet';
import { atOf, DEMO_PLUS_MIN, DEMO_STEP_MIN, DEMO_TICK_MS, minutesOfAt, NOW_DEBOUNCE_MS, toMinutes } from '@/lib/demo-clock';
import { cityClock } from '@/lib/calendar';
import { delayedPosition } from '@/lib/fake-position';
import { acceptRequest, checkRequest, dismissRequest, nowRequest, visitCheckRequest, type NowCard, type NowParams, type NowView } from '@/lib/now-api';
import { send, type DaySummary, type Request, type Result } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

/** 기기에 저장해 다시 켜도 이 화면으로 돌아오는 값 (§11 Q16, §12 R10) */
export type NowRecord = {
  day_id: string;
  day: DaySummary;
  at: string;
  demo: boolean;
  /** TASK-010 C4·C7: 실제 여행의 오늘. 시계는 도시 시간대의 지금, 위치·데모 시계·데모 버튼 없음. day는 첫 응답 전까지의 임시 값 */
  live?: boolean;
};

const OFFLINE_BAND = '연결이 안 돼, 저장된 일정만 보여';
const OOPS_BAND = '잠깐 문제가 생겼어';
const NO_COURSE = '고른 코스가 없어';
const MAP_FAILED = '지도를 불러오지 못했어';
const OPEN_FAILED = '구글 지도를 열 수 없어';
const INPUT_HINT = '곧 말로도 바꿀 수 있어';
const TOAST_MS = 2000;
const ACCEPTED_NOTE = '바꾼 일정으로 안내할게'; // §11 Q15: 서버 reason 대신 앱이 accept 직후에만
const STALE_NOTE = '시간이 지나서 다시 찾아봤어'; // §6: accept 409 stale 뒤
const DELAY_STEP_MIN = 10; // C2
const DELAY_MAX_MIN = 60;
const LIVE_END_MIN = 23 * 60 + 59; // 실제 여행의 오늘은 하루 전체가 시계 범위
const LIVE_TICK_MS = 30000; // 실제 시계를 다시 읽는 간격

/** 시각이 바뀔 때는 POST check(위치는 본문), 재실행·되돌림은 GET now (위치 없음). C1 */
type Call = { kind: 'now' | 'check'; params: NowParams };
const MAX_CARDS = 4; // SCREEN-001 §2·§5: 메인 1 + 보조 최대 3

type Problem = 'offline' | 'oops' | 'no_course';

const PILL = {
  on_track: { fg: 'ok', bg: 'ok-bg' },
  delayed: { fg: 'alert', bg: 'alert-bg' },
  free: { fg: 'ink', bg: 'bg-2' },
} as const;

/**
 * 지도 키가 빌드에 들어갔는지. 이 화면은 extra.googleMapsKeyPresent(있다/없다)만 읽는다.
 * 다만 키 값 자체도 앱 설정(Constants.expoConfig.plugins의 react-native-maps 옵션)에 들어 있어서 JS에서 읽을 수는 있다 (ADR-014: 앱 안에 들어가는 공개 키).
 */
const hasMapKey = (): boolean => Constants.expoConfig?.extra?.googleMapsKeyPresent === true;

/** 사건 카드(T-04·T-06)의 제안 id들. 제안이 없으면 빈 목록 */
const proposalIdsOf = (cards: NowCard[]): string[] => {
  const card = cards.find((one) => one.type === 'T-04' || one.type === 'T-06');
  return card && (card.type === 'T-04' || card.type === 'T-06') ? card.proposals.map((proposal) => proposal.proposal_id) : [];
};

const isNowView = (data: unknown): data is NowView => {
  const view = data as Partial<NowView> | null;
  return (
    typeof view === 'object' &&
    view !== null &&
    typeof view.main === 'object' &&
    view.main !== null &&
    typeof view.main.type === 'string' &&
    Array.isArray(view.subs) &&
    Array.isArray(view.pins) &&
    typeof view.route === 'object' &&
    view.route !== null
  );
};

/** §12 R11: 보조로 빈 남은 일정(T-03)은 숨긴다 */
const visible = (card: NowCard) => !(card.type === 'T-03' && card.items.length === 0);

/** 지도 부품이 그리다 던지면 지도 대신 안내 화면 (§7) */
class MapGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TripNowScreen({
  record,
  onAtChange,
  onNoCourse,
  onExit,
}: {
  record: NowRecord;
  onAtChange: (at: string) => void;
  onNoCourse: () => void;
  /** 저장값을 지우고 S0로 (프로필 [처음부터 다시], /now 404 day) */
  onExit: () => void;
}) {
  const live = record.live === true;
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();

  const [view, setView] = useState<NowView | null>(null);
  // 실제 여행의 오늘은 첫 응답의 day(서버가 정한 하루 요약)를 쓴다. 그 전까지는 임시 값
  const day = live && view ? view.day : record.day;
  const [startMin, endMin] = live ? [0, LIVE_END_MIN] : [toMinutes(day.start), toMinutes(day.end)];

  const [minutes, setMinutes] = useState(() => Math.min(endMin, Math.max(startMin, minutesOfAt(record.at) ?? startMin)));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mapFailed, setMapFailed] = useState(() => !hasMapKey());
  const [mapReady, setMapReady] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [areaHeight, setAreaHeight] = useState(0);
  const [delay, setDelay] = useState(0); // C2: 위치만 이만큼 앞 시각 자리
  const [note, setNote] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(1);
  const [chosen, setChosen] = useState<string | null>(null); // TASK-009 A1: 고른 제안 id. 화면에만 있고 서버에는 보내지 않는다

  const alive = useRef(true);
  const signals = useRef(new Set<AbortController>());
  const seq = useRef(0); // 마지막으로 보낸 요청 번호: 앞 요청의 늦은 응답은 버린다 (B8)
  const last = useRef<Call | null>(null);
  const lastCheck = useRef<NowParams | null>(null); // accept 409 stale 뒤 같은 시각·위치로 다시 묻는다
  const delayRef = useRef(0);
  const busy = useRef(false); // 이걸로·그대로 갈래 요청 중에는 다시 받지 않는다
  const viewRef = useRef<NowView | null>(null);
  const homeMin = useRef<number | null>(null);
  const positioned = useRef(false); // §12 R7: 첫 응답 뒤 위치를 넣어 한 번 더
  const fitted = useRef(false);
  const currentAt = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapAdapterHandle>(null);

  const at = atOf(day.date, minutes);
  currentAt.current = at;
  delayRef.current = delay;

  useEffect(() => {
    alive.current = true;
    const pending = signals.current;
    return () => {
      alive.current = false;
      pending.forEach((controller) => controller.abort());
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  /** 코스대로 걷는 위치 (B7). 핀이 아직 없으면 보내지 않는다 */
  const positionFor = useCallback(
    (when: string): { lat?: number; lng?: number } => {
      if (live) return {}; // C4: 실제 위치는 아직 없다. 위치가 필요한 늦어짐 감지는 꺼져 있다
      const now = viewRef.current;
      if (!now || now.pins.length === 0) return {};
      // C2·§14: 지연 중이면 길 위가 아니라 "아직 머무는" 장소 (일정 안 = 그 장소, 이동 중 = 앞 장소, 첫 일정 전 = 숙소)
      const spot = delayedPosition(when, delayRef.current, {
        lodging: day.lodging,
        go_home_min: homeMin.current,
        items: now.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng, start: pin.start, end: pin.end, travel_min: pin.travel_min })),
      });
      return spot ? { lat: spot.lat, lng: spot.lng } : {};
    },
    [day.lodging, day.date, live],
  );

  /** 응답(성공·실패)을 화면에 반영한다. 반영했으면 true */
  const show = useCallback((result: Result, shownNote: string | null): boolean => {
    if (!result.ok) {
      const failure = result.failure;
      if (failure.kind === 'not_found' && failure.resource === 'day') {
        onExit(); // 이 날이 서버에 없다: 저장값을 지우고 S0, 안내 없음
        return false;
      }
      if (failure.kind === 'network') setProblem('offline');
      else if (failure.kind === 'not_found' && failure.resource === 'course') setProblem('no_course');
      else setProblem('oops'); // 500, 400, course가 아닌 404, 409 (§11 Q22)
      return false;
    }
    if (!isNowView(result.data)) {
      setProblem('oops');
      return false;
    }
    const data = result.data;
    for (const card of [data.main, ...data.subs]) if (card.type === 'T-08') homeMin.current = card.go_home_min;
    viewRef.current = data;
    // §9 Q6: 새 제안에 고른 id가 그대로 있으면 유지, 없어졌으면 해제
    const ids = proposalIdsOf([data.main, ...data.subs]);
    setChosen((now) => (now !== null && ids.includes(now) ? now : null));
    setView(data);
    setNote(shownNote);
    setProblem(null);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNow = useCallback(
    async (call: Call, shownNote: string | null = null): Promise<void> => {
      seq.current += 1;
      const mine = seq.current;
      last.current = call;
      if (call.kind === 'check') lastCheck.current = call.params;
      const request = call.kind === 'check' ? checkRequest(record.day_id, call.params) : nowRequest(record.day_id, call.params.at);
      const result = await send(request, signals.current);
      if (!alive.current || mine !== seq.current) return;
      if (!show(result, shownNote)) return;
      const data = viewRef.current;
      if (!positioned.current && data) {
        positioned.current = true;
        // §11 Q5·§12 R7: GET /now로 화면을 받은 뒤, 같은 시각으로 위치를 넣어 check를 한 번 (같은 시각이 아직 화면에 남아 있을 때만)
        if (call.kind === 'now' && data.pins.length > 0 && call.params.at === currentAt.current) {
          const position = positionFor(call.params.at);
          if (position.lat !== undefined) void fetchNow({ kind: 'check', params: { at: call.params.at, ...position } });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record.day_id, positionFor, show],
  );

  /** [이걸로]·[그대로 갈래]: 같은 요청을 다시 보내지 않는다 (이미 반영됐을 수 있다, §6) */
  const decide = async (request: Request, accepted: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    seq.current += 1;
    const mine = seq.current;
    const result = await send(request, signals.current);
    busy.current = false;
    setChosen(null); // §6: 확정이 성공하든 stale이든 끊기든 고른 상태는 지운다
    if (!alive.current || mine !== seq.current) return;
    if (result.ok) {
      show(result, accepted ? ACCEPTED_NOTE : null);
      return;
    }
    const failure = result.failure;
    const now: Call = { kind: 'now', params: { at: currentAt.current } };
    if (failure.kind === 'conflict' && failure.reason === 'stale' && accepted) {
      const again = lastCheck.current ?? { at: currentAt.current, ...positionFor(currentAt.current) };
      await fetchNow({ kind: 'check', params: again }, STALE_NOTE);
    } else if (failure.kind === 'network' || failure.kind === 'conflict') {
      await fetchNow(now);
    } else {
      show(result, null);
      last.current = now; // 다시는: 요청을 다시 보내지 않고 지금 상태를 받는다
    }
  };

  // 시각이 바뀔 때마다 서버에 다시 묻는다. 처음 한 번은 바로, 그 뒤는 300ms 디바운스 (B8)
  const firstRun = useRef(true);
  useEffect(() => {
    onAtChange(at);
    // 첫 요청은 GET /now (위치 없음), 그 뒤 시각·지연이 바뀔 때는 POST /check
    if (firstRun.current) {
      firstRun.current = false;
      void fetchNow({ kind: 'now', params: { at } });
      return undefined;
    }
    const run = () => void fetchNow({ kind: 'check', params: { at, ...positionFor(at) } });
    const timer = setTimeout(run, NOW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, delay]);

  // 실제 여행의 오늘: 도시 시간대의 지금 시각을 따라간다 (C4). 시각이 바뀌면 아래 효과가 서버에 다시 묻는다
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => {
      const clock = cityClock(Date.now());
      const next = clock.date === record.day.date ? clock.minutes : clock.date > record.day.date ? LIVE_END_MIN : 0;
      setMinutes(Math.min(LIVE_END_MIN, next));
    }, LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [live, record.day.date]);

  // 재생: 1초에 5분. 하루 끝에서 멈춘다 (§11 Q22)
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setMinutes((now) => Math.min(endMin, now + DEMO_STEP_MIN)), DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, [playing, endMin]);
  useEffect(() => {
    if (playing && minutes >= endMin) setPlaying(false);
  }, [playing, minutes, endMin]);

  // 지도 카메라: 처음 한 번만 코스 전체와 숙소가 보이게 (B10). 시트(중간) 높이만큼 아래 여백
  const sheetMid = (areaHeight || windowHeight) * layout.sheetFractions[1];
  useEffect(() => {
    if (!mapReady || fitted.current || !view || view.pins.length === 0) return;
    fitted.current = true;
    mapRef.current?.fit(
      [...view.pins.map((pin) => ({ latitude: pin.lat, longitude: pin.lng })), { latitude: day.lodging.lat, longitude: day.lodging.lng }],
      {
        // 위: 알약·프로필·SOS 줄 + 다음 핀의 이름 말풍선 + 핀 반쪽이 가려지지 않게. 아래: 시트 윗면 + 핀 반쪽
        top: insets.top + layout.header + layout.pinBubble + control['touch-min'] + space['space-2'],
        bottom: sheetMid + control['touch-min'] / 2 + space['space-2'],
      },
    );
  }, [mapReady, view, day.lodging, insets.top, sheetMid]);

  const retry = () => {
    if (last.current) void fetchNow(last.current);
  };

  const choose = (proposalId: string) => setChosen((now) => (now === proposalId ? null : proposalId));
  const confirm = () => {
    if (chosen !== null) void decide(acceptRequest(chosen), true);
  };
  const dismiss = (eventId: string) => void decide(dismissRequest(eventId), false);
  // T-05 [열었어]/[닫혔어]: 다시 보내지 않는다. 끊기거나 409면 GET /now로 지금 상태를 받는다 (§6)
  const visit = (placeId: string, wasOpen: boolean) =>
    void decide(visitCheckRequest(placeId, { day_id: record.day_id, at: currentAt.current, was_open: wasOpen }), false);
  const lateAt = view?.status === 'delayed' ? view.at : null;

  const showToast = () => {
    setToast(OPEN_FAILED);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  // ---------- 시트 ----------
  const snapPoints = useMemo(() => layout.sheetFractions.map((fraction) => `${Math.round(fraction * 100)}%`), []);
  const sheetTop = useSharedValue(0);
  const gap = space['space-3'];
  // 떠 있는 줄은 시트 윗면을 따라가되, 위 끝이 상단 줄(SOS가 있는 줄) 아래로 올라가지 못하게 막는다 (시트 높게에서 SOS와 겹침 방지)
  const topLimit = insets.top + layout.header;
  const floatMin = control['touch-min'];
  const floatStyle = useAnimatedStyle(() => {
    const follow = sheetTop.value > 0 ? areaHeight - sheetTop.value + gap : gap;
    const bottom = Math.min(follow, Math.max(gap, areaHeight - topLimit - floatMin));
    // 데모 패널이 열려 있어도 상단 줄 아래로만 자란다(넘치는 위쪽은 잘림)
    return { bottom, maxHeight: Math.max(floatMin, areaHeight - topLimit - bottom) };
  });

  const mainCard = view && visible(view.main) ? view.main : null;
  const subCards = view ? view.subs.filter(visible).slice(0, MAX_CARDS - (mainCard ? 1 : 0)) : [];

  const choiceCount = proposalIdsOf([...(mainCard ? [mainCard] : []), ...subCards]).length; // Q5: 제안 0개면 확정 줄을 숨긴다
  const position = view?.position ?? null;
  const pill = view ? PILL[view.status] ?? PILL.on_track : null;
  const bandTop = insets.top + layout.header + space['space-2'];

  return (
    <View testID="trip-now-screen" style={styles.root}>
      <View style={styles.area} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
        {live && view === null ? null : mapFailed ? (
          <View testID="map-fallback" style={[styles.fallback, { paddingTop: bandTop + space['space-10'] }]}>
            <Text style={text('body', 'muted')}>{MAP_FAILED}</Text>
            <RouteDiagram
              width={width - 2 * layout.screenMargin}
              home={day.lodging}
              stops={(view?.pins ?? []).map((pin) => ({ seq: pin.seq, lat: pin.lat, lng: pin.lng }))}
            />
          </View>
        ) : (
          <MapGuard onError={() => setMapFailed(true)}>
            <MapAdapter
              ref={mapRef}
              center={{ latitude: day.lodging.lat, longitude: day.lodging.lng }}
              home={{ latitude: day.lodging.lat, longitude: day.lodging.lng }}
              pins={view?.pins ?? []}
              routeDone={(view?.route.done ?? []).map(([latitude, longitude]) => ({ latitude, longitude }))}
              routeRemaining={(view?.route.remaining ?? []).map(([latitude, longitude]) => ({ latitude, longitude }))}
              position={position ? { latitude: position.lat, longitude: position.lng } : null}
              onReady={() => setMapReady(true)}
              onFail={() => setMapFailed(true)}
            />
          </MapGuard>
        )}

        {/* 지도 위 고정: 프로필 · 이동 상태 알약 · SOS (SCREEN-001 §2) */}
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top }]}>
          <View style={styles.topRow} pointerEvents="box-none">
            <View style={styles.side}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="프로필"
                onPress={() => setProfileOpen(true)}
                style={styles.avatarHit}
              >
                <FriendAvatar testID="profile-avatar" />
              </Pressable>
            </View>
            {view && pill ? (
              <View testID="status-pill" style={[styles.pill, { backgroundColor: color[pill.bg] }]}>
                <View style={[styles.pillDot, { backgroundColor: color[pill.fg] }]} />
                <Text numberOfLines={2} style={[text('label', pill.fg), styles.pillText]}>
                  {view.status_text}
                </Text>
              </View>
            ) : (
              <View />
            )}
            <View style={[styles.side, styles.right]}>
              <SosButton onPress={() => setSosOpen(true)} />
            </View>
          </View>
        </View>

        {/* 알림 띠: 끊김·오류·코스 없음·길 안내 실패 */}
        <View pointerEvents="box-none" style={[styles.bands, { top: bandTop + control.sos }]}>
          {problem === 'offline' ? (
            <View testID="now-band">
              <Notice message={OFFLINE_BAND} tone="warn" onRetry={retry} />
            </View>
          ) : null}
          {problem === 'oops' ? (
            <View testID="now-band">
              <Notice message={OOPS_BAND} tone="problem" onRetry={retry} />
            </View>
          ) : null}
          {problem === 'no_course' ? (
            <View testID="now-band" style={styles.noCourse}>
              <Text style={text('body')}>{NO_COURSE}</Text>
              <SecondaryButton small testID="replan-button" label="계획 다시 하기" onPress={onNoCourse} />
            </View>
          ) : null}
          {toast ? (
            <View testID="now-toast" style={styles.toast}>
              <Text style={text('body')}>{toast}</Text>
            </View>
          ) : null}
        </View>

        {/* 시트 위에 떠 있는 것: 데모 시계 패널·버튼, [내 위치] */}
        <Animated.View pointerEvents="box-none" style={[styles.float, floatStyle]}>
          {!live && (record.demo || __DEV__) ? (
            demoOpen ? (
              <DemoPanel
                start={day.start}
                end={day.end}
                minutes={minutes}
                playing={playing}
                onMinutes={setMinutes}
                onPlus={() => setMinutes((now) => Math.min(endMin, now + DEMO_PLUS_MIN))}
                delay={delay}
                onDelay={() => setDelay((now) => Math.min(DELAY_MAX_MIN, now + DELAY_STEP_MIN))}
                onDelayReset={() => setDelay(0)}
                onTogglePlay={() => setPlaying((now) => !now)}
              />
            ) : null
          ) : null}
          {/* F3: 시트가 가장 높을 때 [데모]·[내 위치]는 숨긴다 (열린 패널은 시트 뒤로 간다) */}
          {sheetIndex < snapPoints.length - 1 ? (
            <View pointerEvents="box-none" style={styles.floatRow}>
              {!live && (record.demo || __DEV__) ? (
                <SecondaryButton small testID="demo-toggle" label={demoOpen ? '데모 접기' : '데모'} onPress={() => setDemoOpen((now) => !now)} />
              ) : (
                <View />
              )}
              <Pressable
                testID="my-location-button"
                accessibilityRole="button"
                accessibilityLabel="내 위치"
                disabled={position === null}
                onPress={() => {
                  if (position) mapRef.current?.moveTo({ latitude: position.lat, longitude: position.lng });
                }}
                style={[styles.locate, position === null && styles.locateOff]}
              >
                <LocateIcon color={position === null ? color.muted : color.ink} />
              </Pressable>
            </View>
          ) : null}
        </Animated.View>

        <BottomSheet
          index={1}
          // 기본값(true)이면 시트 안 카드가 하나로 묶여 보조 기술·자동 확인에 낱개로 안 보인다
          accessible={false}
          snapPoints={snapPoints}
          onChange={setSheetIndex}
          animatedPosition={sheetTop}
          enableDynamicSizing={false}
          style={shadow.sheet}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.handle}
        >
          <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
            {view ? (
              <>
                <View testID="now-main" style={styles.mainBox}>
                  {mainCard ? <NowCardView card={mainCard} main onOpenFailed={showToast} chosenId={chosen} onChoose={choose} onDismiss={dismiss} onVisit={visit} lateAt={lateAt} /> : null}
                  <View testID="now-reason">
                    <Text style={text('caption', 'muted')}>{note ?? view.reason}</Text>
                  </View>
                </View>
                {subCards.map((card, index) => (
                  <NowCardView key={`${card.type}-${index}`} card={card} main={false} onOpenFailed={showToast} chosenId={chosen} onChoose={choose} onDismiss={dismiss} onVisit={visit} lateAt={lateAt} />
                ))}
              </>
            ) : problem === null ? (
              <ActivityIndicator color={color.muted} />
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet>
      </View>

      {/* A2: 시트 아래 확정 줄. 고르기 전에는 비활성(bg-2 + muted)이라 화면에 주황 버튼이 없다 */}
      {choiceCount > 0 ? (
        <View testID="action-bar" style={styles.actionBar}>
          <Pressable
            testID="select-confirm"
            accessibilityRole="button"
            accessibilityState={{ disabled: chosen === null }}
            disabled={chosen === null}
            onPress={confirm}
            style={[styles.confirm, chosen === null && styles.confirmOff]}
          >
            <Text style={text('heading', chosen === null ? 'muted' : 'on-brand')}>이걸로 할래</Text>
          </Pressable>
        </View>
      ) : null}
      {/* 입력창은 시트 아래 고정. R1은 비활성 안내 */}
      <InputBar onSend={() => undefined} disabled disabledHint={INPUT_HINT} />
      {profileOpen ? (
        <View style={styles.profileOverlay}>
          <Pressable testID="profile-scrim" accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={() => setProfileOpen(false)} />
          <View testID="profile-sheet" style={styles.profileSheet}>
            <SecondaryButton testID="profile-restart" label={live ? '날짜 목록으로' : '처음부터 다시'} onPress={onExit} />
            <SecondaryButton testID="profile-close" label="닫기" onPress={() => setProfileOpen(false)} />
          </View>
        </View>
      ) : null}
      {sosOpen ? <SosSheet onClose={() => setSosOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  area: { flex: 1, backgroundColor: color['bg-2'] },
  fallback: { ...StyleSheet.absoluteFill, backgroundColor: color['bg-2'], alignItems: 'center', gap: space['space-4'] },
  // 상단 줄(SOS)은 시트·떠 있는 줄보다 항상 위에 그린다: zIndex, Android는 elevation도 시트(sh-sheet)와 같거나 높게
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, elevation: shadow.sheet.elevation },
  topRow: {
    minHeight: layout.header,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenMargin,
    gap: space['space-2'],
  },
  avatarHit: { width: control['touch-min'], height: control['touch-min'], alignItems: 'center', justifyContent: 'center' },
  profileOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', backgroundColor: color.scrim },
  profileSheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius['r-sheet'],
    borderTopRightRadius: radius['r-sheet'],
    padding: layout.screenMargin,
    paddingBottom: space['space-8'],
    gap: space['space-3'],
    ...shadow.sheet,
  },
  side: { minWidth: control.sos, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    paddingHorizontal: space['space-3'],
    paddingVertical: space['space-2'],
    borderRadius: radius['r-full'],
    ...shadow.raise,
  },
  pillDot: { width: layout.dot, height: layout.dot, borderRadius: radius['r-full'] },
  pillText: { flexShrink: 1 },
  // §7 띠·안내는 시트와 떠 있는 줄보다 위, 상단 줄(SOS, zIndex 2)보다는 아래에 그린다
  bands: { position: 'absolute', left: layout.screenMargin, right: layout.screenMargin, gap: space['space-2'], zIndex: 1, elevation: shadow.sheet.elevation },
  noCourse: {
    backgroundColor: color['bg-2'],
    borderRadius: radius['r-lg'],
    padding: space['space-4'],
    gap: space['space-3'],
    alignItems: 'flex-start',
  },
  toast: { backgroundColor: color.surface, borderRadius: radius['r-lg'], padding: space['space-4'], ...shadow.float },
  float: { position: 'absolute', left: layout.screenMargin, right: layout.screenMargin, gap: space['space-3'], justifyContent: 'flex-end', overflow: 'hidden' },
  floatRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  locate: {
    width: control['touch-min'],
    height: control['touch-min'],
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raise,
  },
  locateOff: { backgroundColor: color['bg-2'] }, // 비활성 규칙: bg-2 바탕 + muted (TASK-004 §13-3)
  sheetBackground: { backgroundColor: color.surface, borderTopLeftRadius: radius['r-sheet'], borderTopRightRadius: radius['r-sheet'] },
  handle: { width: layout.sheetHandleWidth, height: layout.sheetHandleHeight, backgroundColor: color.line },
  sheetContent: { paddingHorizontal: layout.screenMargin, paddingBottom: space['space-6'], gap: space['space-4'] },
  actionBar: {
    height: layout.actionBar,
    justifyContent: 'center',
    paddingHorizontal: layout.screenMargin,
    backgroundColor: color.surface,
    borderTopWidth: layout.actionBarLine,
    borderTopColor: color.line,
  },
  confirm: { minHeight: control.btn, borderRadius: radius['r-md'], backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' },
  confirmOff: { backgroundColor: color['bg-2'] },
  mainBox: { gap: space['space-3'] },
});
