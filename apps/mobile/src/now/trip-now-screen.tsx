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
import { fakePosition } from '@/lib/fake-position';
import { nowRequest, type NowCard, type NowParams, type NowView } from '@/lib/now-api';
import { send, type DaySummary } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

/** 기기에 저장해 다시 켜도 이 화면으로 돌아오는 값 (§11 Q16, §12 R10) */
export type NowRecord = { day_id: string; day: DaySummary; at: string; demo: boolean };

const OFFLINE_BAND = '연결이 안 돼, 저장된 일정만 보여';
const OOPS_BAND = '잠깐 문제가 생겼어';
const NO_COURSE = '고른 코스가 없어';
const MAP_FAILED = '지도를 불러오지 못했어';
const OPEN_FAILED = '구글 지도를 열 수 없어';
const INPUT_HINT = '곧 말로도 바꿀 수 있어';
const TOAST_MS = 2000;
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
}: {
  record: NowRecord;
  onAtChange: (at: string) => void;
  onNoCourse: () => void;
}) {
  const { day } = record;
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const [startMin, endMin] = [toMinutes(day.start), toMinutes(day.end)];

  const [minutes, setMinutes] = useState(() => Math.min(endMin, Math.max(startMin, minutesOfAt(record.at) ?? startMin)));
  const [view, setView] = useState<NowView | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mapFailed, setMapFailed] = useState(() => !hasMapKey());
  const [mapReady, setMapReady] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [areaHeight, setAreaHeight] = useState(0);

  const alive = useRef(true);
  const signals = useRef(new Set<AbortController>());
  const seq = useRef(0); // 마지막으로 보낸 요청 번호: 앞 요청의 늦은 응답은 버린다 (B8)
  const last = useRef<NowParams | null>(null);
  const viewRef = useRef<NowView | null>(null);
  const homeMin = useRef<number | null>(null);
  const positioned = useRef(false); // §12 R7: 첫 응답 뒤 위치를 넣어 한 번 더
  const fitted = useRef(false);
  const currentAt = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapAdapterHandle>(null);

  const at = atOf(day.date, minutes);
  currentAt.current = at;

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
      const now = viewRef.current;
      if (!now || now.pins.length === 0) return {};
      const spot = fakePosition(when, {
        lodging: day.lodging,
        go_home_min: homeMin.current,
        items: now.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng, start: pin.start, end: pin.end, travel_min: pin.travel_min })),
      });
      return spot ? { lat: spot.lat, lng: spot.lng } : {};
    },
    [day.lodging],
  );

  const fetchNow = useCallback(
    async (params: NowParams): Promise<void> => {
      seq.current += 1;
      const mine = seq.current;
      last.current = params;
      const result = await send(nowRequest(record.day_id, params), signals.current);
      if (!alive.current || mine !== seq.current) return;
      if (!result.ok) {
        const failure = result.failure;
        if (failure.kind === 'network') setProblem('offline');
        else if (failure.kind === 'not_found' && failure.resource === 'course') setProblem('no_course');
        else setProblem('oops'); // 500, 400, course가 아닌 404, 409 (§11 Q22)
        return;
      }
      if (!isNowView(result.data)) {
        setProblem('oops');
        return;
      }
      const data = result.data;
      for (const card of [data.main, ...data.subs]) if (card.type === 'T-08') homeMin.current = card.go_home_min;
      viewRef.current = data;
      setView(data);
      setProblem(null);
      if (!positioned.current) {
        positioned.current = true;
        // 같은 시각으로 위치를 넣어 한 번 더 (같은 시각이 아직 화면에 남아 있을 때만)
        if (data.pins.length > 0 && params.at === currentAt.current && params.lat === undefined) {
          const position = positionFor(params.at);
          if (position.lat !== undefined) void fetchNow({ at: params.at, ...position });
        }
      }
    },
    [record.day_id, positionFor],
  );

  // 시각이 바뀔 때마다 서버에 다시 묻는다. 처음 한 번은 바로, 그 뒤는 300ms 디바운스 (B8)
  const firstRun = useRef(true);
  useEffect(() => {
    onAtChange(at);
    const run = () => void fetchNow({ at, ...positionFor(at) });
    if (firstRun.current) {
      firstRun.current = false;
      run();
      return undefined;
    }
    const timer = setTimeout(run, NOW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

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

  const position = view?.position ?? null;
  const pill = view ? PILL[view.status] ?? PILL.on_track : null;
  const bandTop = insets.top + layout.header + space['space-2'];

  return (
    <View testID="trip-now-screen" style={styles.root}>
      <View style={styles.area} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
        {mapFailed ? (
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
              <FriendAvatar testID="profile-avatar" />
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
          {record.demo || __DEV__ ? (
            demoOpen ? (
              <DemoPanel
                start={day.start}
                end={day.end}
                minutes={minutes}
                playing={playing}
                onMinutes={setMinutes}
                onPlus={() => setMinutes((now) => Math.min(endMin, now + DEMO_PLUS_MIN))}
                onTogglePlay={() => setPlaying((now) => !now)}
              />
            ) : null
          ) : null}
          <View pointerEvents="box-none" style={styles.floatRow}>
            {record.demo || __DEV__ ? (
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
        </Animated.View>

        <BottomSheet
          index={1}
          // 기본값(true)이면 시트 안 카드가 하나로 묶여 보조 기술·자동 확인에 낱개로 안 보인다
          accessible={false}
          snapPoints={snapPoints}
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
                  {mainCard ? <NowCardView card={mainCard} main onOpenFailed={showToast} /> : null}
                  <View testID="now-reason">
                    <Text style={text('caption', 'muted')}>{view.reason}</Text>
                  </View>
                </View>
                {subCards.map((card, index) => (
                  <NowCardView key={`${card.type}-${index}`} card={card} main={false} onOpenFailed={showToast} />
                ))}
              </>
            ) : problem === null ? (
              <ActivityIndicator color={color.muted} />
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet>
      </View>

      {/* 입력창은 시트 아래 고정. R1은 비활성 안내 */}
      <InputBar onSend={() => undefined} disabled disabledHint={INPUT_HINT} />
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
  bands: { position: 'absolute', left: layout.screenMargin, right: layout.screenMargin, gap: space['space-2'] },
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
  mainBox: { gap: space['space-3'] },
});
