// TASK-004 §B-2: 앱 틀. 응답 stage가 화면(S0·P1·P2·P3·S9)을 정한다. 앱은 흐름을 혼자 정하지 않고 낙관적 갱신도 하지 않는다.
// 실패 처리는 §7 표와 §12 Q17~Q23을 따른다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InputClearContext } from '@/components/planning/input-bar';
import { LeaveContext } from '@/components/planning/leave-context';
import { Notice } from '@/components/planning/notice';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import {
  requests,
  send,
  type CandidateBatch,
  type CourseResult,
  type Failure,
  type PlanningSession,
  type Request,
  type SeedChosenResult,
  type SeedResult,
  type StageResponse,
} from '@/lib/planning-api';
import { authNotice } from '@/lib/auth-messages';
import { initialPlanningState, planningReducer } from '@/lib/planning-reducer';
import { responseChanged } from '@/lib/response-changed';
import { screenFor } from '@/lib/screen-for';

import { TripNowScreen, type NowRecord } from '@/now/trip-now-screen';

import { fontAssets } from './fonts';
import { color } from './theme';
import { P1Screen, type AnswerBody } from './screens/p1';
import { P2Screen, type NextBody } from './screens/p2';
import { P3Screen } from './screens/p3';
import { S0Screen } from './screens/s0';
import { S9Screen } from './screens/s9';
import type { NoticeData } from './screens/types';

export const STORAGE_KEY = 'tripfriends.planning_session_id';
// TASK-006: 여행 중 화면(SC-04)을 위해 기기에 남기는 값. 위치는 저장하지 않는다
export const NOW_KEY = 'tripfriends.trip_now'; // 마지막 화면이 SC-04였는지 + 하루 요약 + 마지막 데모 시각 (§11 Q16)
const DAY_KEY = 'tripfriends.course_day'; // 코스를 고른 날의 하루 요약 (S9에서 SC-04로 갈 때 필요)
const DEMO_KEY = 'tripfriends.demo_day'; // 시드로 만든 날 (§12 R10)
const NOW_DEMO_START = '17:50'; // §14: 바로 보기는 고정 일정(18:30) 직전부터 시작

// 사용자에게 보이는 문구 (TASK-004 §7)
const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';
const INVALID = '다시 해 볼래?';
const RESTART = '처음부터 다시 하자';
const INFEASIBLE_FALLBACK_NAME = '꼭 갈 곳';
const UNREACHABLE = '고정 일정에 제때 못 가';
const TOO_MANY = '하루에 넣기엔 너무 많아. 몇 곳 빼 볼래?';
const INFEASIBLE_OTHER = '이대로는 코스를 못 짜겠어'; // 표에 없는 이유 (사실과 다른 문구 금지, §13-3 #4)

/** 기기 저장은 실패해도 흐름을 막지 않는다 */
async function rememberQuietly(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    console.warn('STORAGE_FAILED');
  }
}

async function readQuietly(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): NowRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<NowRecord> | null;
    if (value && typeof value.day_id === 'string' && typeof value.at === 'string' && typeof value.day === 'object' && value.day !== null) {
      return { day_id: value.day_id, day: value.day, at: value.at, demo: value.demo === true };
    }
  } catch {
    // 깨진 값은 없는 것으로 본다
  }
  return null;
}

type Kind = 'stage' | 'picks' | 'select';
type Problem = { tone: 'plain' | 'problem'; retry: (() => void) | null };

/**
 * 계획 흐름. 아무것도 안 넘기면 데모(S0부터, 기기에 저장해 이어 가기).
 * TASK-010: dayId = 실제 여행의 그날 계획 대화 (시드 없이 바로 시작, 기기 저장 없음, 끝나면 onLeave).
 * autoStart = 첫 화면의 데모 버튼을 이미 눌렀다. onLeave = 처음으로 돌아갈 때(데모 [처음부터], 날 계획 끝·세션 없음) 첫 화면으로.
 */
export default function PlanningFlow({
  dayId,
  startMode,
  autoStart,
  onLeave,
  resumeSessionId,
  onSession,
  onBackToList,
}: {
  dayId?: string;
  /** 실제 여행의 날: 'auto'면 대화 없이 바로 자동 계획 (TASK-011 [알아서 짜 줘]) */
  startMode?: 'conversation' | 'auto';
  autoStart?: 'demo' | 'now';
  onLeave?: () => void;
  /** 실제 여행의 날: 이미 시작한 대화가 있으면 새로 만들지 않고 GET으로 이어 간다 (TASK-010 §12 답 3) */
  resumeSessionId?: string;
  /** 새 대화가 시작되면 세션 id를 알린다 */
  onSession?: (sessionId: string) => void;
  /** 머리 "‹ 날짜": 대화는 그대로 두고 날짜 목록으로 */
  onBackToList?: () => void;
} = {}) {
  const [fontsReady, fontError] = useFonts(fontAssets);
  // 처음부터·404로 S0에 돌아올 때 Session을 새로 만든다 (상태를 통째로 비운다)
  const [boot, setBoot] = useState<{ epoch: number; start: 'boot' | 's0'; notice: string | null }>({
    epoch: 0,
    start: dayId !== undefined || autoStart !== undefined ? 's0' : 'boot',
    notice: null,
  });

  // 글꼴을 못 읽으면 시스템 글꼴로 그냥 보여 준다 (막지 않음, §7). 읽는 중에만 빈 화면.
  if (!fontsReady && !fontError) return <View style={styles.blank} />;

  return (
    <Session
      key={boot.epoch}
      start={boot.start}
      restartNotice={boot.notice}
      dayId={dayId}
      startMode={startMode}
      resumeSessionId={resumeSessionId}
      onSession={onSession}
      onBackToList={onBackToList}
      autoStart={boot.epoch === 0 ? autoStart : undefined}
      onReset={(notice) => (onLeave ? onLeave() : setBoot((now) => ({ epoch: now.epoch + 1, start: 's0', notice })))}
    />
  );
}

function Session({
  start,
  restartNotice,
  dayId,
  startMode,
  autoStart,
  resumeSessionId,
  onSession,
  onBackToList,
  onReset,
}: {
  start: 'boot' | 's0';
  restartNotice: string | null;
  dayId?: string;
  startMode?: 'conversation' | 'auto';
  autoStart?: 'demo' | 'now';
  resumeSessionId?: string;
  onSession?: (sessionId: string) => void;
  onBackToList?: () => void;
  onReset: (notice: string | null) => void;
}) {
  const tripDay = dayId !== undefined; // 실제 여행의 날: 데모 시드·기기 저장·여행 중 데모 없음
  const [state, dispatch] = useReducer(planningReducer, initialPlanningState);
  const [ready, setReady] = useState(start === 's0');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [showRestart, setShowRestart] = useState(restartNotice !== null);
  const [inputCleared, setInputCleared] = useState(0); // 올라가면 입력창이 글을 지운다 (보낸 글이 성공했을 때만)
  const [nowRecord, setNowRecord] = useState<NowRecord | null>(null); // 있으면 여행 중 화면 (TASK-006 B9)

  const alive = useRef(true);
  const busy = useRef(false); // 한 번에 한 요청 (§6)
  const sid = useRef<string | null>(null);
  const seedDay = useRef<string | null>(dayId ?? null); // S0: 시드는 됐고 세션만 남았을 때 (Q19)
  const lastDay = useRef<PlanningSession['day'] | null>(null); // 마지막으로 받은 하루 요약 (SC-04 진입용)
  const demoDay = useRef<string | null>(null); // 시드로 만든 날 id (데모 시계 버튼용)
  const nowRef = useRef<NowRecord | null>(null);
  const signals = useRef(new Set<AbortController>());
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    alive.current = true;
    const pending = signals.current;
    return () => {
      alive.current = false;
      pending.forEach((controller) => controller.abort());
    };
  }, []);

  /** 실제 여행의 날은 기기에 저장하지 않는다 (다시 켜면 날짜 목록이 처음) */
  const remember = useCallback((key: string, value: string) => (tripDay ? Promise.resolve() : rememberQuietly(key, value)), [tripDay]);

  const fail = useCallback((message: string, next: Problem) => {
    if (!alive.current) return;
    setProblem(next);
    dispatch({ type: 'request_failure', message });
  }, []);

  const clearStoredAndReset = useCallback(
    async (notice: string | null) => {
      if (tripDay) {
        if (alive.current) onReset(notice); // 실제 여행의 날: 기기 저장값은 건드리지 않고 날짜 목록으로
        return;
      }
      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch {
        console.warn('STORAGE_CLEAR_FAILED'); // 지우기 실패해도 처음으로 돌아간다
      }
      for (const key of [NOW_KEY, DAY_KEY, DEMO_KEY]) {
        try {
          await AsyncStorage.removeItem(key);
        } catch {
          // 여행 중 화면용 값: 지우기 실패해도 계속
        }
      }
      if (alive.current) onReset(notice);
    },
    [onReset, tripDay],
  );

  /** 422 문구. 이름은 지금 화면 응답의 day.must_visits에서 찾는다 (Q23) */
  const infeasibleMessage = (reason: string, blocking: string[]): string => {
    if (reason === 'must_visit_overflow') return '꼭 갈 곳이 하루에 다 안 들어가';
    if (reason === 'user_stay_conflict') return '그 시간은 안 맞아';
    if (reason === 'too_many_places') return TOO_MANY;
    if (reason === 'fixed_unreachable') return UNREACHABLE;
    if (reason !== 'must_visit_closed') return INFEASIBLE_OTHER;
    const day = (latest.current.response as { day?: PlanningSession['day'] } | null)?.day;
    const names = blocking.map((id) => day?.must_visits.find((m) => m.place_id === id)?.name ?? INFEASIBLE_FALLBACK_NAME);
    // Q40 이름이 여럿이면 쉼표로 이어 쓴다 (조사를 피함)
    return `${(names.length > 0 ? names : [INFEASIBLE_FALLBACK_NAME]).join(', ')}, 그날 쉬어`;
  };

  /** 한 번 보내고 결과를 반영한다. 성공해서 서버 응답을 반영했으면 true */
  const execute = useCallback(async (request: Request, kind: Kind, fromInput = false, recovery = false): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    dispatch({ type: 'request_start' });
    setProblem(null);
    try {
      return await settle(request, kind, await send(request, signals.current), fromInput, recovery);
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = async (
    request: Request,
    kind: Kind,
    result: Awaited<ReturnType<typeof send>>,
    fromInput = false,
    recovery = false,
  ): Promise<boolean> => {
    if (!alive.current) return false;
    if (result.ok) return accept(request, kind, result.data, fromInput, recovery);
    return failWith(result.failure, request, kind, fromInput, recovery);
  };

  const accept = (request: Request, kind: Kind, data: unknown, fromInput: boolean, recovery: boolean): boolean => {
    // select 200이면 바로 S9 (Q26). 응답에 stage가 없어도 done으로 본다
    const response = kind === 'select' ? { ...(data as object), stage: 'done' } : data;
    const odd = () => {
      // 모르는 stage·모양은 500 줄과 같게 (Q18, §13-2 #7). 화면 숫자는 그대로
      fail(OOPS, { tone: 'plain', retry: () => void execute(request, kind, fromInput, recovery) });
      return false;
    };
    if (kind === 'picks') {
      // 담기·패스 응답(Picks): 담은 곳 글자 목록과 숫자, stage는 없다
      const p = response as Partial<Record<'picks' | 'picks_count' | 'stage', unknown>> | null;
      const ok =
        typeof p === 'object' &&
        p !== null &&
        !Array.isArray(p) &&
        Array.isArray(p.picks) &&
        p.picks.every((id) => typeof id === 'string') &&
        typeof p.picks_count === 'number' &&
        !('stage' in p);
      if (!ok) return odd();
    } else {
      try {
        screenFor(response as { stage?: unknown });
      } catch {
        return odd();
      }
    }
    const dayInResponse = (response as { day?: PlanningSession['day'] } | null)?.day;
    if (typeof dayInResponse === 'object' && dayInResponse !== null) lastDay.current = dayInResponse;
    if (kind === 'select' && lastDay.current) void remember(DAY_KEY, JSON.stringify(lastDay.current));
    // C1: 복구 GET은 응답이 요청 전과 달라졌을 때만 입력 글을 지운다 (지금 화면 응답은 아직 바뀌기 전이다)
    const cleared = fromInput || (recovery && responseChanged(latest.current.response, response));
    dispatch({ type: 'request_success', response });
    if (cleared) setInputCleared((now) => now + 1);
    return true;
  };

  const failWith = async (failure: Failure, request: Request, kind: Kind, fromInput: boolean, recovery: boolean): Promise<boolean> => {
    const same = () => void execute(request, kind, fromInput, recovery);
    const isGet = request.method === 'GET';
    const getAgain = () => void execute(requests.current(sid.current ?? ''), 'stage', false, true);
    switch (failure.kind) {
      case 'network':
        // 요청이 실제로 처리됐을 수 있어서 [다시]는 같은 요청이 아니라 GET으로 지금 상태를 받는다 (Q21)
        fail(OFFLINE, { tone: 'plain', retry: isGet ? same : getAgain });
        return false;
      case 'invalid':
        console.warn('INVALID_REQUEST', request.method, request.path);
        fail(INVALID, { tone: 'plain', retry: null });
        return false;
      case 'infeasible':
        fail(infeasibleMessage(failure.reason, failure.blocking), { tone: 'problem', retry: null });
        return false;
      case 'not_found':
        if (failure.resource === 'session') {
          await clearStoredAndReset(RESTART);
          return false;
        }
        break;
      case 'conflict':
        break;
      case 'unauthorized':
      case 'auth_unavailable':
      case 'auth_down':
      case 'storage':
        fail(authNotice(failure) ?? OOPS, { tone: 'plain', retry: same });
        return false;
      case 'server':
        // Q35·Q42 500은 [다시]가 같은 요청 (GET이면 GET)
        fail(OOPS, { tone: 'plain', retry: same });
        return false;
    }
    // 409, 세션이 아닌 404: 서버 기준으로 GET해서 그 화면으로 복구. 따로 안내하지 않는다 (Q21·Q22)
    if (isGet) {
      // Q36·Q37 GET 자신의 404(세션 밖)·409는 500 줄처럼
      fail(OOPS, { tone: 'plain', retry: same });
      return false;
    }
    const recover = requests.current(sid.current ?? '');
    return settle(recover, 'stage', await send(recover, signals.current), false, true);
  };

  // ---------- 다시 켜기 (§B-2, Q17) ----------
  useEffect(() => {
    if (start !== 'boot') return;
    (async () => {
      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        console.warn('STORAGE_READ_FAILED'); // 읽기 실패는 저장값 없음처럼 S0
      }
      if (!alive.current) return;
      const [nowRaw, dayRaw, demoRaw] = await Promise.all([readQuietly(NOW_KEY), readQuietly(DAY_KEY), readQuietly(DEMO_KEY)]);
      if (!alive.current) return;
      demoDay.current = demoRaw;
      try {
        lastDay.current = dayRaw ? (JSON.parse(dayRaw) as PlanningSession['day']) : null;
      } catch {
        lastDay.current = null;
      }
      const resumed = parseRecord(nowRaw);
      if (resumed) {
        // 마지막 화면이 SC-04였다: 마지막 데모 시각으로 바로 돌아간다 (B9, §11 Q16)
        sid.current = stored;
        nowRef.current = resumed;
        setNowRecord(resumed);
        setReady(true);
        return;
      }
      if (stored) {
        sid.current = stored;
        setSessionId(stored);
        setReady(true);
        void execute(requests.current(stored), 'stage');
      } else {
        setReady(true);
      }
    })();
  }, [start, execute]);

  // ---------- S0: 시드 -> 둘째 날로 세션 시작 (Q19, Q31) ----------
  const startDemo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setShowRestart(false);
    setProblem(null);
    dispatch({ type: 'request_start' });
    const stop = (failure: Failure) => {
      const again = () => void startDemo();
      if (failure.kind === 'network') fail(OFFLINE, { tone: 'plain', retry: again });
      else if (authNotice(failure)) fail(authNotice(failure) as string, { tone: 'plain', retry: again });
      else if (failure.kind === 'invalid') {
        console.warn('INVALID_REQUEST', 'S0');
        fail(INVALID, { tone: 'plain', retry: null });
      } else {
        // Q37 S0의 404 day·그 밖의 실패는 500 줄처럼
        fail(OOPS, { tone: 'plain', retry: again });
      }
    };
    try {
      if (seedDay.current === null) {
        const seeded = await send(requests.seed(), signals.current);
        if (!alive.current) return;
        if (!seeded.ok) return stop(seeded.failure);
        const dayId = (seeded.data as SeedResult | null)?.day_ids?.[1]; // 둘째 날
        if (typeof dayId !== 'string') return stop({ kind: 'server' });
        seedDay.current = dayId;
      }
      // TASK-012 §13: 실제 여행의 날은 먼저 진행 중인 세션을 묻는다. 있으면 이어 가고, 404 session일 때만 새로 시작 ([알아서 짜 줘]는 그대로 새로 시작)
      if (tripDay && startMode !== 'auto') {
        const found = await send(requests.byDay(seedDay.current), signals.current);
        if (!alive.current) return;
        if (found.ok) {
          const data = found.data as { session_id?: unknown; day?: PlanningSession['day'] } | null;
          if (typeof data?.session_id === 'string') {
            sid.current = data.session_id;
            setSessionId(data.session_id);
            onSession?.(data.session_id);
            accept(requests.byDay(seedDay.current), 'stage', found.data, false, false);
            return;
          }
          return stop({ kind: 'server' });
        }
        if (!(found.failure.kind === 'not_found' && found.failure.resource === 'session')) return stop(found.failure);
      }
      const started = await send(requests.start(seedDay.current, tripDay ? startMode : undefined), signals.current);
      if (!alive.current) return;
      if (!started.ok) return stop(started.failure);
      try {
        screenFor(started.data as { stage?: unknown });
      } catch {
        return stop({ kind: 'server' });
      }
      const session = started.data as PlanningSession;
      try {
        if (!tripDay) await AsyncStorage.setItem(STORAGE_KEY, session.session_id);
      } catch {
        // 기기 저장이 실패해도 흐름은 계속. 다시 켜면 이어 가기만 안 된다 (§13-3 저장 실패)
        console.warn('STORAGE_FAILED');
      }
      if (!alive.current) return;
      sid.current = session.session_id;
      setSessionId(session.session_id);
      lastDay.current = session.day;
      if (tripDay) onSession?.(session.session_id);
      if (!tripDay) {
        demoDay.current = seedDay.current; // 시드로 만든 날은 데모 시계를 쓴다 (§12 R10)
        void rememberQuietly(DEMO_KEY, String(seedDay.current));
      }
      dispatch({ type: 'request_success', response: session });
    } finally {
      busy.current = false;
    }
  }, [fail, tripDay]);

  // ---------- S0: [여행 중 데모 바로 보기] (개발 빌드 전용, TASK-006 §14) ----------
  // chosen 시드의 응답 day로 둘째 날 SC-04를 그날 17:50부터 연다. 계획 세션은 시작하지 않는다
  const startNowDemo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setShowRestart(false);
    setProblem(null);
    dispatch({ type: 'request_start' });
    const stop = (failure: Failure) => {
      const again = () => void startNowDemo();
      if (failure.kind === 'network') fail(OFFLINE, { tone: 'plain', retry: again });
      else if (authNotice(failure)) fail(authNotice(failure) as string, { tone: 'plain', retry: again });
      else if (failure.kind === 'invalid') {
        console.warn('INVALID_REQUEST', 'S0');
        fail(INVALID, { tone: 'plain', retry: null });
      } else fail(OOPS, { tone: 'plain', retry: again });
    };
    try {
      const seeded = await send(requests.seedChosen(), signals.current);
      if (!alive.current) return;
      if (!seeded.ok) return stop(seeded.failure);
      const day = (seeded.data as SeedChosenResult | null)?.day;
      if (!day || typeof day.day_id !== 'string' || typeof day.date !== 'string') return stop({ kind: 'server' });
      lastDay.current = day;
      demoDay.current = day.day_id;
      void rememberQuietly(DEMO_KEY, day.day_id);
      const record: NowRecord = { day_id: day.day_id, day, at: `${day.date}T${NOW_DEMO_START}:00`, demo: true };
      nowRef.current = record;
      dispatch({ type: 'request_success', response: null });
      setNowRecord(record);
    } finally {
      busy.current = false;
    }
  }, [fail]);

  // 첫 화면에서 이미 눌렀거나(autoStart), 실제 여행의 날(dayId)이면 한 번 바로 시작한다
  useEffect(() => {
    if (tripDay && resumeSessionId !== undefined) {
      sid.current = resumeSessionId;
      setSessionId(resumeSessionId);
      void execute(requests.current(resumeSessionId), 'stage');
    } else if (tripDay || autoStart === 'demo') void startDemo();
    else if (autoStart === 'now') void startNowDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 화면이 부르는 동작 ----------
  const id = () => sid.current ?? '';
  // 글(text)이 들어 있는 요청은 입력창에서 온 것: 성공하면 입력 글을 지운다
  const onAnswer = (body: AnswerBody) => execute(requests.answer(id(), body), 'stage', typeof body.text === 'string');
  const onReact = (placeId: string, action: 'like' | 'skip' | 'unlike') =>
    execute(requests.react(id(), { place_id: placeId, action }), 'picks');
  const onNext = (body?: NextBody) => execute(requests.next(id(), body), 'stage', typeof body?.text === 'string');
  const onCompose = () => execute(requests.compose(id()), 'stage');
  const onAdjust = (optionId: string, placeId: string, delta: 15 | -15) =>
    execute(requests.adjust(id(), { option_id: optionId, place_id: placeId, delta }), 'stage');
  const onBack = () => execute(requests.back(id()), 'stage');
  const onSelect = (optionId: string) => execute(requests.select(optionId), 'select');

  const onEnterNow = () => {
    const day = lastDay.current;
    if (!day) {
      console.warn('NOW_DAY_MISSING');
      return;
    }
    const record: NowRecord = { day_id: day.day_id, day, at: `${day.date}T${day.start}:00`, demo: demoDay.current === day.day_id };
    nowRef.current = record;
    setNowRecord(record);
  };
  /** 시각이 바뀔 때마다 마지막 데모 시각을 기기에 남긴다 (§11 Q16) */
  const saveAt = useCallback((at: string) => {
    if (!nowRef.current) return;
    nowRef.current = { ...nowRef.current, at };
    void rememberQuietly(NOW_KEY, JSON.stringify(nowRef.current));
  }, []);

  const busyNow = state.inFlight;
  // 요청 중에는 이전 오류를 숨긴다 (다시 시도하는 중)
  const notice: NoticeData | null =
    state.error !== null && !busyNow && problem
      ? { message: state.error, tone: problem.tone, onRetry: problem.retry ?? undefined }
      : null;

  // ---------- 어떤 화면을 그릴지: 응답 stage가 정한다 ----------
  const renderScreen = (): React.ReactNode => {
    if (!ready) return <Loading />;

    if (nowRecord) {
      return <TripNowScreen key={nowRecord.day_id} record={nowRecord} onAtChange={saveAt} onNoCourse={() => void clearStoredAndReset(null)} onExit={() => void clearStoredAndReset(null)} />;
    }

    if (state.response === null) {
      if (sessionId === null && tripDay) {
        // 실제 여행의 날: 데모 첫 화면(S0)이 아니라 불러오는 중 / 안내(다시 해 보기)
        return busyNow || !notice ? (
          <Loading />
        ) : (
          <ScreenFrame>
            <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} />
            <SecondaryButton testID="trip-day-close" label="날짜 목록으로" onPress={() => onReset(null)} />
          </ScreenFrame>
        );
      }
      if (sessionId === null) {
        const shown = notice ?? (showRestart && restartNotice ? { message: restartNotice, tone: 'plain' as const } : null);
        return <S0Screen busy={busyNow} notice={shown} onStart={() => void startDemo()} onStartNow={__DEV__ ? () => void startNowDemo() : undefined} />;
      }
      // 다시 켠 뒤 GET 중이거나 실패: S0으로 보내지 않는다 (Q17)
      return busyNow || !notice ? (
        <Loading />
      ) : (
        <ScreenFrame>
          <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} />
        </ScreenFrame>
      );
    }

    const response = state.response as StageResponse;
    switch (screenFor(response)) {
      case 'P1':
        return <P1Screen key="P1" session={response as PlanningSession} busy={busyNow} notice={notice} onAnswer={onAnswer} />;
      case 'P2':
        return (
          <P2Screen
            key="P2"
            batch={response as CandidateBatch}
            picks={state.picks}
            picksCount={state.picksCount}
            busy={busyNow}
            notice={notice}
            onReact={onReact}
            onNext={onNext}
            onCompose={onCompose}
          />
        );
      case 'P3':
        return (
          <P3Screen
            key="P3"
            course={response as CourseResult}
            busy={busyNow}
            notice={notice}
            onAdjust={onAdjust}
            onBack={onBack}
            onSelect={onSelect}
          />
        );
      case 'S9':
        return tripDay ? (
          <S9Screen key="S9" onClose={() => onReset(null)} />
        ) : (
          <S9Screen key="S9" onRestart={() => void clearStoredAndReset(null)} onEnterNow={onEnterNow} />
        );
    }
  };

  return (
    <LeaveContext.Provider value={tripDay ? (onBackToList ?? null) : null}>
      <InputClearContext.Provider value={inputCleared}>{renderScreen()}</InputClearContext.Provider>
    </LeaveContext.Provider>
  );
}

function Loading() {
  return (
    <ScreenFrame>
      <View testID="app-loading" style={styles.loading}>
        <ActivityIndicator color={color.muted} />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: color.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
