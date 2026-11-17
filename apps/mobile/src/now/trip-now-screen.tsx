// TASK-006 B3~B10: 여행 중 화면 SC-04. 지도(바탕) + 카드 시트 3단 + 데모 시계.
// 앱은 그리기만 한다: 카드를 고르지 않고(서버 main이 이긴다, §6) 일정을 바꾸지 않는다. 시각은 데모 시계만 쓴다 (실제 시계는 쓰지 않는다).
import BottomSheet, { BottomSheetScrollView, useGestureEventsHandlersDefault } from '@gorhom/bottom-sheet';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/app-text';
import { DemoPanel } from '@/components/now/demo-panel';
import { MapAdapter, type MapAdapterHandle } from '@/components/now/map-adapter';
import { NowCardView, reasonHidden } from '@/components/now/now-cards';
import { ProfileMenu } from '@/account/profile-menu';
import { FriendAvatar } from '@/components/planning/friend-bubble';
import { LocateIcon } from '@/components/planning/icons';
import { InputBar } from '@/components/planning/input-bar';
import { LocationIntroSheet, LocationOffPill, LocationOffSheet } from '@/components/now/location-ui';
import type { Rect } from '@/lib/pin-overlap';
import { RehearsalBand, RehearsalNotice, NOTICE_SIDE, REHEARSAL_FAILED } from '@/components/now/rehearsal-ui';
import { Notice } from '@/components/planning/notice';
import { RouteDiagram } from '@/components/planning/route-diagram';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { SosButton } from '@/components/planning/sos-button';
import { SosSheet } from '@/components/planning/sos-sheet';
import { failureText } from '@/lib/auth-messages';
import { isFresh } from '@/lib/live-location';
import { atOf, DEMO_PLUS_MIN, DEMO_STEP_MIN, DEMO_TICK_MS, minutesOfAt, NOW_DEBOUNCE_MS, toMinutes } from '@/lib/demo-clock';
import { cityClock } from '@/lib/calendar';
import { dayHeading } from '@/lib/day-list';
import { delayedPosition } from '@/lib/fake-position';
import { rehearsalCamera, type RehearsalCameraResult } from './rehearsal-camera';
import {
  acceptRequest,
  checkRequest,
  dismissRequest,
  nowRequest,
  rehearsalVisitCheckRequest,
  visitCheckRequest,
  type NowCard,
  type NowParams,
  type NowView,
  type RehearsalAction,
} from '@/lib/now-api';
import { send, type DaySummary, type Request, type Result } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

import { useLiveLocation } from './use-live-location';

/** 기기에 저장해 다시 켜도 이 화면으로 돌아오는 값 (§11 Q16, §12 R10) */
export type NowRecord = {
  day_id: string;
  day: DaySummary;
  at: string;
  demo: boolean;
  /** TASK-010 C4·C7: 실제 여행의 오늘. 시계는 도시 시간대의 지금, 위치·데모 시계·데모 버튼 없음. day는 첫 응답 전까지의 임시 값 */
  live?: boolean;
  /** TASK-014 §C: 계획 완료 날 "미리 걸어 보기". check·[닫혔어]는 rehearsal: true, 고르기·그대로 갈래·열었어는 서버에 보내지 않는다. day는 첫 응답 전까지의 임시 값 */
  rehearsal?: boolean;
};

const TOP_ROW = 48; // 위 버튼 줄(프로필·SOS) 높이 (task-014-design §11-1)
const CLOCK_ABOVE_SHEET = 120; // 연습 시계 판 윗변 = 시트 윗변 − 120 (§12-1)
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
const QUEUE_GAP_MS = 100; // 응답이 온 뒤 기다리던 최신 요청을 보내기까지 (§29 ①, 400ms 안)
const LIVE_TICK_MS = 30000; // 실제 시계를 다시 읽는 간격

/** 시각이 바뀔 때는 POST check(위치는 본문), 재실행·되돌림은 GET now (위치 없음). C1 */
type Call = { kind: 'now' | 'check'; params: NowParams; /** 행동 응답 뒤 한 번 더: 보내는 순간의 시각으로 다시 정한다 (기다리는 사이 시계가 더 갔을 수 있다) */ latest?: true };
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
  const rehearsal = record.rehearsal === true;
  const rehTop = rehearsal ? layout.rehBand : 0; // 연습 띠만큼 상단 줄·지도 여백이 내려간다
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();

  const [view, setView] = useState<NowView | null>(null);
  // 실제 여행의 오늘은 첫 응답의 day(서버가 정한 하루 요약)를 쓴다. 그 전까지는 임시 값
  const day = (live || rehearsal) && view ? view.day : record.day;
  const [startMin, endMin] = live ? [0, LIVE_END_MIN] : [toMinutes(day.start), toMinutes(day.end)];

  const [minutes, setMinutes] = useState(() => Math.min(endMin, Math.max(startMin, minutesOfAt(record.at) ?? startMin)));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [oopsText, setOopsText] = useState(rehearsal ? REHEARSAL_FAILED : OOPS_BAND);
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
  const [rehearsalInfo, setRehearsalInfo] = useState(false); // §9 답 7: "연습이라 저장하지 않았어" 한 줄

  const alive = useRef(true);
  const signals = useRef(new Set<AbortController>());
  const seq = useRef(0); // 마지막으로 보낸 요청 번호 (보낸 순서)
  const shownSeq = useRef(0); // 지금 화면에 있는 응답의 요청 번호: 이보다 오래된 응답만 버린다 (§29 ①)
  const floorSeq = useRef(0); // [이걸로]·[닫혔어]를 보낸 때의 번호: 그보다 앞서 보낸 시계·위치 응답은 버린다 (B8)
  const inFlight = useRef(false); // 시계·위치 check(·now)는 동시에 하나만 (§29 ①)
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<{ call: Call; note: string | null } | null>(null); // 기다리는 동안 바뀐 최신 하나
  const last = useRef<Call | null>(null);
  const lastSentLatest = useRef(false); // 마지막 check가 행동 응답 뒤 한 번 더였나
  const lastCheckDelay = useRef(0); // 마지막으로 보낸 check의 지연 (같은 시각·지연을 시계 효과가 또 보내지 않게)
  const lastCheck = useRef<NowParams | null>(null); // accept 409 stale 뒤 같은 시각·위치로 다시 묻는다
  const delayRef = useRef(0);
  const busy = useRef(false); // 이걸로·그대로 갈래 요청 중에는 다시 받지 않는다
  const debounceActive = useRef(false); // 시계가 바뀌어 곧 check가 나갈 예정 (행동 응답 뒤 한 번 더 보낼 필요가 없다)
  const viewRef = useRef<NowView | null>(null);
  const homeMin = useRef<number | null>(null);
  const positioned = useRef(false); // §12 R7: 첫 응답 뒤 위치를 넣어 한 번 더
  const fitted = useRef(false);
  const cameraRef = useRef<RehearsalCameraResult | null>(null); // 연습: 마지막 카메라 결과
  const fittedLeg = useRef<string | null>(null); // 연습: 마지막으로 맞춘 구간
  const currentAt = useRef('');
  const rehearsalLog = useRef<RehearsalAction[]>([]); // §11 연습 기록: 앱 메모리에만. 끝내거나 화면을 떠나면 사라진다
  const skipAt = useRef<string | null>(null); // 연습 첫 응답 뒤 이미 바로 보낸 시각
  const noteShown = useRef(false); // 연습 한 번에 처음 한 번만
  const sentSpot = useRef<{ lat: number; lng: number; timestamp: number } | null>(null); // 실제 위치: 마지막으로 보낸 곳과 잰 시각 (시계로 다시 물을 때도 같이 보낸다, 120초 넘게 오래되면 뺀다)
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
      if (queueTimer.current) clearTimeout(queueTimer.current);
    };
  }, []);

  /** 코스대로 걷는 위치 (B7). 핀이 아직 없으면 보내지 않는다 */
  const positionFor = useCallback(
    (when: string): { lat?: number; lng?: number } => {
      // TASK-014 A3: 실제 여행은 기기가 잰 위치(마지막으로 보낸 곳)를 쓴다. 아직 없거나 쓸 수 없으면 시계만
      if (live) {
        const sent = sentSpot.current;
        // §13 7·§10 Q7: 잰 지 120초보다 오래된 위치는 싣지 않는다 (시계만)
        return sent && isFresh({ ...sent, accuracy: 0 }, Date.now()) ? { lat: sent.lat, lng: sent.lng } : {};
      }
      const now = viewRef.current;
      if (!now || now.pins.length === 0) return {};
      // C2·§14: 지연 중이면 길 위가 아니라 "아직 머무는" 장소 (일정 안 = 그 장소, 이동 중 = 앞 장소, 첫 일정 전 = 숙소)
      const spot = delayedPosition(when, delayRef.current, {
        lodging: rehearsal ? now.day.lodging : day.lodging, // 연습은 첫 응답 전까지 임시 숙소라 응답의 값을 쓴다
        go_home_min: homeMin.current,
        items: now.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng, start: pin.start, end: pin.end, travel_min: pin.travel_min })),
      });
      return spot ? { lat: spot.lat, lng: spot.lng } : {};
    },
    [day.lodging, day.date, live, rehearsal],
  );

  // §29 ②: 연습 점은 서버 position이 아니라 앱이 지금 시계로 바로 계산한다 (화면에 있는 응답의 핀·day.lodging). 카드만 응답을 기다린다
  const rehPosition = useMemo(() => {
    if (!rehearsal || !view || view.pins.length === 0) return null;
    const goHome = [view.main, ...view.subs].find((card) => card.type === 'T-08');
    return delayedPosition(at, delay, {
      lodging: view.day.lodging ?? null,
      go_home_min: goHome && goHome.type === 'T-08' ? goHome.go_home_min : null,
      items: view.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng, start: pin.start, end: pin.end, travel_min: pin.travel_min })),
    });
  }, [rehearsal, view, at, delay]);

  /** 응답(성공·실패)을 화면에 반영한다. 반영했으면 true */
  const show = useCallback((result: Result, shownNote: string | null): boolean => {
    if (!result.ok) {
      const failure = result.failure;
      if (failure.kind === 'not_found' && failure.resource === 'day') {
        onExit(); // 이 날이 서버에 없다: 저장값을 지우고 S0, 안내 없음
        return false;
      }
      if (failure.kind === 'not_found' && failure.resource === 'course') setProblem('no_course');
      else if (rehearsal) {
        // §10 Q12: 연습 중에는 끊김도 오류도 "지금 연습을 못 해" + [다시]. 실제 여행은 그대로
        setOopsText(REHEARSAL_FAILED);
        setProblem('oops');
      } else if (failure.kind === 'network') setProblem('offline');
      else {
        setOopsText(failureText(failure, OOPS_BAND));
        setProblem('oops'); // 500, 400, course가 아닌 404, 409 (§11 Q22)
      }
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
      last.current = call;
      // §29 ① 응답을 기다리는 동안 바뀐 시각·위치는 최신 하나만 들고 있다가 응답이 오면 한 번 보낸다
      if (inFlight.current) {
        queued.current = { call, note: shownNote };
        return;
      }
      inFlight.current = true;
      seq.current += 1;
      const mine = seq.current;
      if (call.kind === 'check') {
        lastCheck.current = call.params;
        lastCheckDelay.current = delayRef.current;
        lastSentLatest.current = call.latest === true;
      }
      const request =
        call.kind === 'check' ? checkRequest(record.day_id, call.params, rehearsal ? [...rehearsalLog.current] : undefined) : nowRequest(record.day_id, call.params.at);
      const result = await send(request, signals.current);
      inFlight.current = false;
      if (!alive.current) return;
      // 응답은 버리지 않는다. 보낸 순서상 화면에 있는 것보다 오래된 것(또는 [이걸로] 앞서 보낸 것)만 버린다
      if (mine >= Math.max(shownSeq.current, floorSeq.current) && show(result, shownNote)) {
        shownSeq.current = mine;
        followUp(call);
      }
      // 기다리는 동안 바뀐 최신 하나가 있으면 잠깐 뒤 한 번 보낸다 (그 사이 새 요청은 그 하나를 대신한다)
      if (!inFlight.current && queued.current) {
        inFlight.current = true;
        queueTimer.current = setTimeout(() => {
          queueTimer.current = null;
          inFlight.current = false;
          const next = queued.current;
          queued.current = null;
          if (alive.current && next) {
            const call: Call = next.call.latest ? { kind: 'check', params: { at: currentAt.current, ...positionFor(currentAt.current) }, latest: true } : next.call;
            void fetchNow(call, next.note);
          }
        }, QUEUE_GAP_MS);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record.day_id, positionFor, show],
  );

  /** 첫 응답 뒤 위치를 넣어 한 번 더 (§12 R7) */
  const followUp = useCallback(
    (call: Call) => {
      const data = viewRef.current;
      if (!positioned.current && data) {
        positioned.current = true;
        if (rehearsal) {
          // §10 Q13: 연습 시계는 하루 시작 시각부터. 시각이 바뀌면 아래 효과가 check를 보낸다. 이미 그 시각이면 지금 바로
          const start = toMinutes(data.day.start);
          const startAt = atOf(data.day.date, start);
          if (start !== minutesOfAt(call.params.at)) {
            skipAt.current = startAt; // 시각이 바뀌어도 아래 효과가 같은 시각을 한 번 더 묻지 않게
            setMinutes(start);
          }
          void fetchNow({ kind: 'check', params: { at: startAt, ...positionFor(startAt) } });
          return;
        }
        // §11 Q5·§12 R7: GET /now로 화면을 받은 뒤, 같은 시각으로 위치를 넣어 check를 한 번 (같은 시각이 아직 화면에 남아 있을 때만)
        if (call.kind === 'now' && data.pins.length > 0 && call.params.at === currentAt.current) {
          const position = positionFor(call.params.at);
          if (position.lat !== undefined) void fetchNow({ kind: 'check', params: { at: call.params.at, ...position } });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positionFor],
  );

  /** 행동 응답을 반영한 뒤 그 사이 시계가 더 갔으면 check 한 번 (§9 Q8 ①). 진행 중이면 fetchNow가 최신 하나로 합쳐 끝난 뒤 보낸다. 곧 나갈 시계 check가 있으면 그것이 대신한다 */
  const followLate = (actionAt: string) => {
    if (!alive.current || debounceActive.current) return;
    const now = currentAt.current;
    if (now === actionAt) return;
    void fetchNow({ kind: 'check', params: { at: now, ...positionFor(now) }, latest: true });
  };

  /** [이걸로]·[그대로 갈래]: 같은 요청을 다시 보내지 않는다 (이미 반영됐을 수 있다, §6) */
  const decide = async (request: Request, accepted: boolean): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    seq.current += 1;
    const mine = seq.current;
    floorSeq.current = mine;
    const actionAt = currentAt.current;
    const result = await send(request, signals.current);
    busy.current = false;
    setChosen(null); // §6: 확정이 성공하든 stale이든 끊기든 고른 상태는 지운다
    if (!alive.current) return;
    // TASK-015 §E ②: 행동의 응답은 뒤에 보낸 조회(check)의 응답이 먼저 왔어도 버리지 않는다. 오래된 것을 버리는 건 조회 응답뿐
    if (result.ok) {
      if (show(result, accepted ? ACCEPTED_NOTE : null)) {
        shownSeq.current = Math.max(shownSeq.current, mine);
        followLate(actionAt);
      }
      return;
    }
    if (mine < shownSeq.current) return;
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
    if (skipAt.current === at) {
      skipAt.current = null;
      return undefined;
    }
    const run = () => {
      debounceActive.current = false;
      // 행동 응답 뒤 check가 이미 이 시각으로 나갔으면 같은 것을 또 보내지 않는다
      if (lastCheck.current?.at === at && lastCheckDelay.current === delayRef.current && !inFlight.current && queued.current === null && lastSentLatest.current) return;      void fetchNow({ kind: 'check', params: { at, ...positionFor(at) } });
    };
    debounceActive.current = true;
    const timer = setTimeout(run, NOW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      debounceActive.current = false;
    };
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
  // 연습 중엔 시트 윗변을 보드 ①-35 자리(874 화면에서 y 434)에 맞추고, 시계 판(112)은 그 위에 뜬다 (§19·§20 Q2)
  const rehSheetHeight = (area: number, topY: number = layout.rehSheetTop) => {
    const boardArea = layout.rehBoardHeight - (space['space-2'] + control.input + layout.rehBoardBottom + space['space-2']);
    const low = area * layout.sheetFractions[0];
    const high = area * layout.sheetFractions[2];
    return Math.round(Math.min(high - 1, Math.max(low + 1, area - (topY * area) / boardArea)));
  };
  const sheetMid = rehearsal ? rehSheetHeight(areaHeight || windowHeight) : (areaHeight || windowHeight) * layout.sheetFractions[1];
  const clockRoom = rehearsal ? layout.rehClock + space['space-3'] : 0; // 카메라 아래 여백 = 시트 + 시계 판
  useEffect(() => {
    if (!mapReady || !view || view.pins.length === 0) return;
    // 연습: 지금 구간만 직접 계산한 영역(보이는 띠 기준), 구간이 바뀔 때만 다시 (같은 구간 안에서 시각만 바뀌면 그대로)
    if (rehearsal) {
      // 시트 영역 높이(onLayout)를 알기 전에는 계산하지 않는다. 안 뒤 결과 객체가 바뀔 때만 한 번 (§26)
      if (areaHeight <= 0) return;
      const camera = rehearsalCamera(
        view.pins,
        rehPosition,
        day.lodging ?? null,
        {
          width,
          height: areaHeight,
          top: insets.top + rehTop + layout.header + layout.pinBubble,
          bottom: areaHeight - sheetMid - clockRoom,
        },
        cameraRef.current ?? undefined,
      );
      if (cameraRef.current === camera) return;
      cameraRef.current = camera;
      fitted.current = true;
      fittedLeg.current = camera.key;
      mapRef.current?.showRegion(camera.region);
      return;
    }
    // 실제 여행: 처음 한 번 모든 핀 + 숙소 (B10)
    if (fitted.current) return;
    fitted.current = true;
    fittedLeg.current = null;
    mapRef.current?.fit(
      [...view.pins.map((pin) => ({ latitude: pin.lat, longitude: pin.lng })), ...(day.lodging ? [{ latitude: day.lodging.lat, longitude: day.lodging.lng }] : [])],
      {
        // 위: 알약·프로필·SOS 줄 + 다음 핀의 이름 말풍선 + 핀 반쪽이 가려지지 않게. 아래: 시트 윗면 + 핀 반쪽
        top: insets.top + rehTop + layout.header + layout.pinBubble + control['touch-min'] + space['space-2'],
        bottom: sheetMid + clockRoom + control['touch-min'] / 2 + space['space-2'],
      },
    );
  }, [mapReady, view, rehearsal, rehPosition, day.lodging, insets.top, sheetMid, clockRoom, areaHeight, width]);

  // TASK-015 §E ③·§9 Q9: 숙소도 핀도 없는 날은 여행 도시의 중심으로 간다. 진짜 지도는 initialRegion을 처음 한 번만 읽으므로 첫 응답 뒤 카메라를 옮긴다
  const cityCenter = view?.city?.center ?? null;
  const movedToCity = useRef(false);
  useEffect(() => {
    if (!mapReady || !view || movedToCity.current || !cityCenter) return;
    if (day.lodging || view.pins.length > 0) return;
    movedToCity.current = true;
    mapRef.current?.moveTo({ latitude: cityCenter.lat, longitude: cityCenter.lng });
  }, [mapReady, view, cityCenter, day.lodging]);

  const retry = () => {
    if (last.current) void fetchNow(last.current);
  };

  /** 실제 여행 오늘의 "지금": 도시 시간대의 지금 시각 (아래 시계 효과와 같은 셈) */
  const liveAt = (): string => {
    const clock = cityClock(Date.now());
    const next = clock.date === record.day.date ? clock.minutes : clock.date > record.day.date ? LIVE_END_MIN : 0;
    return atOf(record.day.date, Math.min(LIVE_END_MIN, next));
  };
  // TASK-014 A3: 좋은 위치가 보낼 만하면 check 본문에 싣는다 (주소창 아님)
  const location = useLiveLocation({
    enabled: live,
    onSend: (spot, timestamp) => {
      sentSpot.current = { ...spot, timestamp };
      void fetchNow({ kind: 'check', params: { at: liveAt(), lat: spot.lat, lng: spot.lng } });
    },
  });
  useEffect(() => {
    if (!live) sentSpot.current = null;
  }, [live]);
  // 읽기가 멈추면(백그라운드·거절·꺼짐) 그 위치는 더 쓰지 않는다 — 시계로 다시 물을 때도 싣지 않는다
  useEffect(() => {
    if (!location.active) sentSpot.current = null;
  }, [location.active]);

  /** 연습 중 고르기·그대로 갈래·열었어: 서버에 쓰지 않고 연습 기록에 쌓은 뒤, 같은 계산(rehearsal: true)으로 화면을 다시 받는다 (§11) */
  const rehearse = (action: RehearsalAction) => {
    rehearsalLog.current.push(action);
    announceRehearsal();
    setChosen(null);
    void fetchNow({ kind: 'check', params: { at: currentAt.current, ...positionFor(currentAt.current) } });
  };
  const announceRehearsal = () => {
    if (noteShown.current) return;
    noteShown.current = true;
    setRehearsalInfo(true);
  };
  /** 연습 중 [닫혔어]: 대안을 계산하는 요청이라 서버에 보내되 rehearsal: true. 성공하면 연습 기록에 쌓는다 */
  const rehearseClosed = async (placeId: string) => {
    if (busy.current) return;
    busy.current = true;
    seq.current += 1;
    const mine = seq.current;
    floorSeq.current = mine;
    const at = currentAt.current;
    last.current = { kind: 'check', params: { at, ...positionFor(at) } }; // 실패하면 [다시]는 지금 시각으로 다시 묻는다
    const body = { day_id: record.day_id, at, was_open: false };
    const result = await send(rehearsalVisitCheckRequest(placeId, body, [...rehearsalLog.current]), signals.current);
    busy.current = false;
    setChosen(null);
    if (!alive.current || (!result.ok && mine < shownSeq.current)) return;
    // TASK-015 §E ②: 연습 [닫혔어]의 응답도 버리지 않는다 — 화면에 보이고(대안 카드) 연습 기록에 쌓인다
    if (show(result, null)) {
      shownSeq.current = Math.max(shownSeq.current, mine);
      rehearsalLog.current.push({ type: 'visit_check', place_id: placeId, ...body });
      announceRehearsal();
      followLate(at);
    }
  };

  const choose = (proposalId: string) => setChosen((now) => (now === proposalId ? null : proposalId));
  const confirm = () => {
    if (chosen === null) return;
    if (rehearsal) {
      const event = viewRef.current?.event;
      if (event) rehearse({ type: 'accept', event, proposal_id: chosen });
      return;
    }
    void decide(acceptRequest(chosen), true);
  };
  const dismiss = (eventId: string) => {
    if (rehearsal) {
      const event = viewRef.current?.event;
      if (event) rehearse({ type: 'dismiss', event });
      return;
    }
    void decide(dismissRequest(eventId), false);
  };
  // T-05 [열었어]/[닫혔어]: 다시 보내지 않는다. 끊기거나 409면 GET /now로 지금 상태를 받는다 (§6)
  const visit = (placeId: string, wasOpen: boolean) => {
    if (rehearsal) {
      if (wasOpen) rehearse({ type: 'visit_check', place_id: placeId, day_id: record.day_id, at: currentAt.current, was_open: true });
      else void rehearseClosed(placeId);
      return;
    }
    void decide(visitCheckRequest(placeId, { day_id: record.day_id, at: currentAt.current, was_open: wasOpen }), false);
  };
  const lateAt = view?.status === 'delayed' ? view.at : null;

  const showToast = () => {
    setToast(OPEN_FAILED);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  // ---------- 시트 ----------
  // 연습 중엔 중간 단 윗변이 보드 자리 (DESIGN-001 §4-13: 시계 판이 시트 위에 떠 있어야 해서)
  // TASK-015 §24(17): 맨 위 단의 윗변은 위 버튼 줄 아래 + 8보다 올라가지 않는다 (task-015-design §12-4: 손잡이 · 위 버튼 줄이 안 가려지게)
  const sheetTopMin = insets.top + rehTop + layout.header + space['space-2'];
  // §24 18번(승현 11-18): 접힌 단 = 지금 메인 카드의 마지막 요소(주 버튼 또는 마지막 줄) 아래 끝 + 16, 모든 카드 같은 규칙.
  // §26: 메인 카드가 바뀌면 새 카드를 잴 때까지 앞 카드의 잰 값을 쓴다 (버리면 옛 16%로 내려갔다 다시 올라와 시트가 두 번 움직인다). 메인 카드가 없으면 버린다
  const mainKey = view && visible(view.main) ? view.main.type : null;
  const [mainBoxY, setMainBoxY] = useState(0);
  const [lastBox, setLastBox] = useState<{ y: number; height: number } | null>(null);
  const lastBottom = lastBox && mainKey !== null ? mainBoxY + lastBox.y + lastBox.height : null;
  // §26: 사용자가 시트(손잡이 · 내용)를 끌고 있는 동안은 접힌 단을 끌기 시작할 때 값으로 둔다 (손가락 밑에서 시트를 옮기지 않게). 놓으면 새 값으로
  const [dragLow, setDragLow] = useState<string | number | null>(null);
  const lowNow = useRef<string | number | null>(null);
  const onDragStart = useCallback(() => setDragLow(lowNow.current), []);
  const onDragEnd = useCallback(() => setDragLow(null), []);
  const sheetGestures = useMemo(() => dragAwareGestures(onDragStart, onDragEnd), [onDragStart, onDragEnd]);
  const snapPoints = useMemo(() => {
    const total = areaHeight || windowHeight;
    return layout.sheetFractions.map((fraction, index) => {
      if (index === 0) return dragLow ?? collapsedSnap(fraction, lastBottom, total);
      if (rehearsal && index === 1) return rehSheetHeight(total);
      if (rehearsal && index === 2) return Math.max(rehSheetHeight(total, layout.rehSheetTopUp), rehSheetHeight(total) + 1); // 위로 끌면 윗변 417 (TASK-015 §B3)
      if (index === layout.sheetFractions.length - 1 && total > 0) {
        const room = (total - sheetTopMin) / total;
        if (room < fraction && room > layout.sheetFractions[index - 1]) return `${Math.floor(room * 1000) / 10}%`;
      }
      return `${Math.round(fraction * 100)}%`;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rehearsal, areaHeight, windowHeight, sheetTopMin, lastBottom, dragLow]);
  useEffect(() => {
    lowNow.current = snapPoints[0];
  }, [snapPoints]);
  const sheetTop = useSharedValue(0);
  const gap = space['space-3'];
  // 떠 있는 줄은 시트 윗면을 따라가되, 위 끝이 상단 줄(SOS가 있는 줄) 아래로 올라가지 못하게 막는다 (시트 높게에서 SOS와 겹침 방지)
  const topLimit = insets.top + rehTop + layout.header;
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
  // 실제 여행: 기기가 잰 좋은 위치만 (위치를 모르면 점도 [내 위치]도 없다, §9 답 4). 데모·연습: 서버가 코스대로 돌려준 자리
  const position = live ? (location.spot ? { lat: location.spot.lat, lng: location.spot.lng } : null) : rehearsal ? rehPosition : (view?.position ?? null);
  // 숙소가 없으면 첫 핀이 지도 처음 중심 (§29 ④)
  const firstPin = view?.pins[0];
  const mapCenter = day.lodging
    ? { latitude: day.lodging.lat, longitude: day.lodging.lng }
    : firstPin
      ? { latitude: firstPin.lat, longitude: firstPin.lng }
      : null;
  // TASK-015 §B6: 계획상 지금 있는 곳이 숙소 = 첫 이동을 떠나기 전, 또는 마지막 일정 뒤 숙소에 닿은 뒤 (숙소가 있을 때만)
  const stayingAtLodging = (() => {
    if (!day.lodging || !view || view.pins.length === 0) return false;
    const first = view.pins[0];
    const lastPin = view.pins[view.pins.length - 1];
    if (minutes < toMinutes(first.start) - first.travel_min) return true;
    return homeMin.current !== null && minutes >= toMinutes(lastPin.end) + homeMin.current;
  })();
  const showClock = !live && (rehearsal || record.demo || __DEV__);
  const pill = view ? PILL[view.status] ?? PILL.on_track : null;
  const bandTop = insets.top + rehTop + layout.header + space['space-2'];
  // TASK-015 §17: 화면에 실제로 떠 있는 판 = 위 버튼 줄(48) · 연습 시계 판(시트 윗변 − 120부터 112) · 아래 시트. 지도 화면 pt, 맨 위 0
  const panelArea = areaHeight || windowHeight;
  const panelSheetTop = panelArea - sheetMid;
  const floatingPanels: Rect[] = [
    { x: 0, y: insets.top + rehTop, width, height: TOP_ROW },
    ...(rehearsal ? [{ x: 0, y: panelSheetTop - CLOCK_ABOVE_SHEET, width, height: layout.rehClock }] : []),
    { x: 0, y: panelSheetTop, width, height: sheetMid },
    // TASK-015 §18 Q3: 지도 위에 그려지는 안내 한 줄도 떠 있는 판
    ...(rehearsalInfo ? [{ x: NOTICE_SIDE, y: bandTop + control.sos, width: Math.max(0, width - 2 * NOTICE_SIDE), height: layout.noticeInfoHeight }] : []),
  ];

  return (
    <View testID="trip-now-screen" style={styles.root}>
      {rehearsal ? <StatusBar style="light" /> : null}
      <View style={styles.area} onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}>
        {live && view === null ? null : mapFailed ? (
          <View testID="map-fallback" style={[styles.fallback, { paddingTop: bandTop + space['space-10'] }]}>
            <Text style={text('body', 'muted')}>{MAP_FAILED}</Text>
            <RouteDiagram
              width={width - 2 * layout.screenMargin}
              home={day.lodging}
              stops={(view?.pins ?? []).map((pin) => ({ seq: pin.seq, lat: pin.lat, lng: pin.lng }))}
            />
            {/* 지도가 없어도 어디를 가는지 읽을 수 있게 핀 이름을 순서대로 (번호만 있는 그림은 코스를 못 읽는다) */}
            {(view?.pins ?? []).map((pin) => (
              <View key={pin.seq} testID={`fallback-stop-${pin.seq}`} style={styles.stopLine}>
                <Text style={text('num-md', 'muted')}>{String(pin.seq)}</Text>
                <Text style={text('caption', 'muted')}>{pin.name}</Text>
              </View>
            ))}
          </View>
        ) : (
          <MapGuard onError={() => setMapFailed(true)}>
            <MapAdapter
              ref={mapRef}
              center={mapCenter}
              home={day.lodging ? { latitude: day.lodging.lat, longitude: day.lodging.lng } : null}
              pins={view?.pins ?? []}
              routeDone={(view?.route.done ?? []).map(([latitude, longitude]) => ({ latitude, longitude }))}
              routeRemaining={(view?.route.remaining ?? []).map(([latitude, longitude]) => ({ latitude, longitude }))}
              position={position ? { latitude: position.lat, longitude: position.lng } : null}
              hollowPosition={rehearsal}
              stayingAtLodging={stayingAtLodging}
              panels={floatingPanels}
              onReady={() => setMapReady(true)}
              onFail={() => setMapFailed(true)}
            />
          </MapGuard>
        )}

        {/* 지도 위 고정: 프로필 · 이동 상태 알약 · SOS (SCREEN-001 §2) */}
        {rehearsal ? (
          <RehearsalBand top={insets.top} label={view ? dayHeading(view.day.day_number - 1, view.day.date) : ''} onEnd={onExit} />
        ) : null}
        <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + rehTop }]}>
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

        {/* TASK-014 D2: 위치를 못 쓰는 동안 "위치 꺼짐" 알약. 끊김 띠가 있는 동안은 숨긴다 (한 번에 경고 하나, §9 답 3) */}
        {live && location.off && problem !== 'offline' ? (
          <LocationOffPill top={insets.top + (layout.header + layout.statusPill) / 2 + layout.pillOffGap} onPress={location.pillPressed} />
        ) : null}
        {rehearsalInfo ? <RehearsalNotice top={bandTop + control.sos} onClose={() => setRehearsalInfo(false)} /> : null}

        {/* 알림 띠: 끊김·오류·코스 없음·길 안내 실패 */}
        <View pointerEvents="box-none" style={[styles.bands, { top: bandTop + control.sos }]}>
          {problem === 'offline' ? (
            <View testID="now-band">
              <Notice message={OFFLINE_BAND} tone="warn" onRetry={retry} />
            </View>
          ) : null}
          {problem === 'oops' ? (
            <View testID="now-band">
              <Notice message={oopsText} tone="problem" onRetry={retry} />
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
          {showClock ? (
            demoOpen || rehearsal ? (
              <DemoPanel
                rehearsal={rehearsal}
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
          {sheetIndex < snapPoints.length - 1 && !rehearsal ? (
            <View pointerEvents="box-none" style={styles.floatRow}>
              {showClock ? (
                <SecondaryButton small testID="demo-toggle" label={demoOpen ? '데모 접기' : '데모'} onPress={() => setDemoOpen((now) => !now)} />
              ) : (
                <View />
              )}
              {live && position === null ? null : (
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
              )}
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
          // §26: 접힌 단 높이가 바뀌면(메인 카드가 바뀜) 시트가 약 250ms 동안 부드럽게 옮겨 간다. 접힌 단에 있을 때만 보이는 움직임이다 (다른 단의 높이는 그대로라)
          animationConfigs={SHEET_ANIMATION}
          gestureEventsHandlersHook={sheetGestures}
          enableDynamicSizing={false}
          style={shadow.sheet}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.handle}
        >
          <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
            {view ? (
              <>
                <View testID="now-main" style={styles.mainBox} onLayout={(event) => setMainBoxY(event.nativeEvent.layout.y)}>
                  {mainCard ? (
                    <NowCardView
                      card={mainCard}
                      main
                      onOpenFailed={showToast}
                      chosenId={chosen}
                      onChoose={choose}
                      onDismiss={dismiss}
                      onVisit={visit}
                      lateAt={lateAt}
                      rehearsal={rehearsal}
                      onLastLayout={(box) => setLastBox({ y: box.y, height: box.height })}
                    />
                  ) : null}
                  {note === null && reasonHidden(mainCard, view.reason) ? null : (
                    <View testID="now-reason">
                      <Text style={text('caption', 'muted')}>{note ?? view.reason}</Text>
                    </View>
                  )}
                </View>
                {subCards.map((card, index) => (
                  <NowCardView key={`${card.type}-${index}`} card={card} main={false} onOpenFailed={showToast} chosenId={chosen} onChoose={choose} onDismiss={dismiss} onVisit={visit} lateAt={lateAt} rehearsal={rehearsal} />
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
        <ProfileMenu restartLabel={live ? '날짜 목록으로' : '처음부터 다시'} onRestart={onExit} onClose={() => setProfileOpen(false)} />
      ) : null}
      {sosOpen ? <SosSheet located={live ? location.spot !== null : position !== null} onClose={() => setSosOpen(false)} /> : null}
      {location.sheet === 'intro' ? <LocationIntroSheet onTurnOn={() => void location.turnOn()} onLater={location.later} /> : null}
      {location.sheet === 'off' ? <LocationOffSheet onSettings={location.openSettings} onClose={location.closeSheet} /> : null}
    </View>
  );
}

/**
 * TASK-015 §26: 시트가 단 사이를 옮겨 갈 때의 움직임 = 250ms 시간 애니메이션 (gorhom 기본 시간과 같은 250ms, 끝에서 천천히 멈춤).
 * 라이브러리가 단 높이 변경 반응을 처음 그릴 때 한 번만 잡아서, 접힌 단일 때만 다른 값을 줄 수 없다 → 끌어 놓을 때도 같은 움직임
 */
const SHEET_ANIMATION = { duration: 250, easing: Easing.out(Easing.cubic) };

/** §26: gorhom 기본 끌기 처리에 "끌기 시작 · 끝" 알림만 더한다 (끌기 동작은 그대로) */
function dragAwareGestures(onStart: () => void, onEnd: () => void) {
  return function useDragAwareGestures() {
    const base = useGestureEventsHandlersDefault();
    return {
      ...base,
      handleOnStart: (source: Parameters<typeof base.handleOnStart>[0], payload: Parameters<typeof base.handleOnStart>[1]) => {
        'worklet';
        scheduleOnRN(onStart);
        base.handleOnStart(source, payload);
      },
      // 놓기는 handleOnEnd로 온다 (그 뒤 gorhom이 handleOnFinalize를 건너뜀). 끝 없이 취소되면 handleOnFinalize로 온다
      handleOnEnd: (source: Parameters<typeof base.handleOnEnd>[0], payload: Parameters<typeof base.handleOnEnd>[1]) => {
        'worklet';
        base.handleOnEnd(source, payload);
        scheduleOnRN(onEnd);
      },
      handleOnFinalize: (source: Parameters<typeof base.handleOnFinalize>[0], payload: Parameters<typeof base.handleOnFinalize>[1]) => {
        'worklet';
        base.handleOnFinalize(source, payload);
        scheduleOnRN(onEnd);
      },
    };
  };
}

/** 손잡이 자리 = gorhom 손잡이 위아래 안쪽 10 + 손잡이 막대 (§24 18번 접힌 단 계산) */
const SHEET_HANDLE_ROOM = 2 * layout.sheetHandlePad + layout.sheetHandleHeight;

/**
 * TASK-015 §24 18번 접힌 단 = 손잡이 자리 + 메인 카드 마지막 요소 아래 끝 + 16 (px, 중간 단보다 낮게). 모든 카드 같은 규칙.
 * 아직 못 잰 첫 그림(메인 카드 없음 · 잰 값 전)에만 옛 비율을 쓴다
 */
function collapsedSnap(fraction: number, lastBottom: number | null, total: number): string | number {
  if (lastBottom === null || total <= 0) return `${Math.round(fraction * 100)}%`;
  const height = SHEET_HANDLE_ROOM + lastBottom + space['space-4'];
  return Math.min(Math.round(height), Math.floor(total * layout.sheetFractions[1]) - 1);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  area: { flex: 1, backgroundColor: color['bg-2'] },
  stopLine: { flexDirection: 'row', alignItems: 'baseline', gap: space['space-2'] },
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
