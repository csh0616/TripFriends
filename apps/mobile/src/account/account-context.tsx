// TASK-012 2단계 C1·C2·C4·C5: 계정 연결 상태와 화면 조각(저장 권유 시트·어느 여행 시트·실패 알림)을 한 곳에 둔다.
// 홈(trips/home.tsx)이 감싸고, 날짜 목록·여행 중 화면의 프로필 메뉴가 useAccount()로 쓴다.
// 판단은 서버가 한다: 앱은 Supabase 로그인과 /account/claim·choose 호출만 하고 여행을 지우지 않는다 (C6).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import {
  cancelChoose,
  chooseTrip,
  connectGoogle,
  logoutToAnonymous,
  markAsked,
  readAccountInfo,
  wasAsked,
  watchAccount,
  type AccountInfo,
  type Choice,
} from '@/lib/account-link';
import type { Trip } from '@/trips/api';

import { FailNotice } from './fail-notice';
import { PickSheet } from './pick-sheet';
import { SaveSheet } from './save-sheet';

const styles = StyleSheet.create({ fill: { flex: 1 } });

export type Account = {
  /** Google 계정에 연결됐나 (아니면 익명) */
  linked: boolean;
  email: string | null;
  /** 프로필 메뉴 [저장하기] -> 저장 권유 시트 */
  openSave: () => void;
  /** 첫 계획을 마친 날짜 목록 위에서 한 번 (이미 물었거나 연결됐으면 아무것도 안 함) */
  offerSave: () => Promise<void>;
  /** [로그아웃]: 새 익명 계정으로. 끝나면 지금 여행을 다시 묻는다 */
  logout: () => Promise<void>;
};

const NONE: Account = { linked: false, email: null, openSave: () => undefined, offerSave: async () => undefined, logout: async () => undefined };
const AccountContext = createContext<Account>(NONE);
export const useAccount = () => useContext(AccountContext);

type Pick_ = { email: string; choices: Choice[] };

export function AccountProvider({
  onTrip,
  onReload,
  children,
}: {
  /** 어느 여행을 골랐다: 그 여행의 날짜 목록으로 */
  onTrip: (trip: Trip) => void;
  /** 지금 여행을 서버에 다시 묻는다 (옮긴 뒤·로그아웃 뒤) */
  onReload: () => void;
  children: React.ReactNode;
}) {
  const [info, setInfo] = useState<AccountInfo>({ linked: false, email: null });
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState<Pick_ | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0); // 0 = 알림 없음, 실패할 때마다 늘려 6초를 처음부터 센다
  const alive = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    void readAccountInfo().then((now) => alive.current && setInfo(now));
    const stop = watchAccount((now) => alive.current && setInfo(now));
    return () => {
      alive.current = false;
      stop();
    };
  }, []);

  const refresh = useCallback(async () => {
    const now = await readAccountInfo();
    if (alive.current) setInfo(now);
  }, []);

  const fail = useCallback(() => setFailed((count) => count + 1), []);
  const closeNotice = useCallback(() => setFailed(0), []);

  /** 한 번에 하나만 (두 번 눌러도 한 번) */
  const guarded = useCallback(async (job: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await job();
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const later = useCallback(() => {
    if (!busyRef.current) setSaving(false); // [나중에]·스크림. 이미 물었음은 시트를 띄울 때 적었다 (§C1)
  }, []);

  const google = useCallback(
    () =>
      guarded(async () => {
        const outcome = await connectGoogle();
        if (!alive.current) return;
        await refresh();
        if (outcome.kind === 'cancelled') return; // §16 Q7: 알림 없이 시트 그대로
        setSaving(false);
        if (outcome.kind === 'failed') fail();
        else if (outcome.kind === 'moved') onReload();
        else if (outcome.kind === 'choose') setPick({ email: outcome.email, choices: outcome.choices });
      }),
    [guarded, refresh, fail, onReload],
  );

  const confirm = useCallback(
    (tripId: string) =>
      guarded(async () => {
        const result = await chooseTrip(tripId);
        if (!alive.current) return;
        await refresh();
        setPick(null);
        if (result.ok) onTrip(result.trip);
        else fail();
      }),
    [guarded, refresh, fail, onTrip],
  );

  const cancelPick = useCallback(
    () =>
      guarded(async () => {
        const restored = await cancelChoose(); // 서버 호출 없이 연결 전 익명 세션으로 (§9 3)
        if (!alive.current) return;
        await refresh();
        setPick(null);
        if (!restored) fail();
      }),
    [guarded, refresh, fail],
  );

  const logout = useCallback(async () => {
    await guarded(async () => {
      const ok = await logoutToAnonymous();
      if (!alive.current) return;
      await refresh();
      if (ok) onReload();
    });
  }, [guarded, refresh, onReload]);

  const offerSave = useCallback(async () => {
    if (await wasAsked()) return;
    const now = await readAccountInfo();
    if (now.linked || !alive.current) return;
    await markAsked();
    if (alive.current) setSaving(true);
  }, []);

  const value = useMemo<Account>(
    () => ({ linked: info.linked, email: info.email, openSave: () => setSaving(true), offerSave, logout }),
    [info, offerSave, logout],
  );

  return (
    <AccountContext.Provider value={value}>
      {/* 어느 여행 시트가 떠 있는 동안 뒤 화면은 화면 읽기 도구에서 뺀다 (시트가 위에서 화면을 막는다) */}
      <View style={styles.fill} accessibilityElementsHidden={pick !== null} importantForAccessibility={pick !== null ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {saving ? <SaveSheet busy={busy} onGoogle={() => void google()} onLater={later} /> : null}
      {pick ? <PickSheet email={pick.email} choices={pick.choices} busy={busy} onConfirm={(id) => void confirm(id)} onCancel={() => void cancelPick()} /> : null}
      {failed > 0 ? <FailNotice key={failed} onClose={closeNotice} /> : null}
    </AccountContext.Provider>
  );
}
