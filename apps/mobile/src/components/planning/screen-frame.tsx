// 모든 계획 화면의 틀 (TASK-004 §B-3 가드레일): 머리(SOS 고정) / 스크롤 본문 / 아래 고정(떠 있는 줄 + 입력창).
// SOS와 입력창은 스크롤 밖에 있어서 화면이 움직여도 같은 자리에 있다. 입력창이 없는 화면(S0·S9)은 input을 비운다.
import { useContext, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { layout } from '@/planning/layout';
import { color, space } from '@/planning/theme';

import { LeaveContext } from './leave-context';
import { FloatingBar } from './floating-bar';
import { Header } from './header';
import { InputBar } from './input-bar';
import { SosSheet } from './sos-sheet';

export type FrameInput = { onSend: (value: string) => void; disabled?: boolean; hint?: string };

export function ScreenFrame({
  title,
  subtitle,
  onBack,
  backLabel,
  backDisabled,
  input,
  footer,
  action,
  listBottomSpace,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** "‹ 날짜" 뒤로의 글자 (읽기만 화면). 실제 여행의 계획 대화는 아래 LeaveContext가 항상 "날짜" */
  backLabel?: string;
  backDisabled?: boolean;
  input?: FrameInput;
  footer?: React.ReactNode;
  /** TASK-010: 스크롤 밖 맨 아래에 고정되는 주 버튼 자리 (입력창이 없는 화면) */
  action?: React.ReactNode;
  /** 후보 카드 목록처럼 아래 고정 줄에 가려질 수 있는 본문: action-bar 높이 + 안전 영역, 적어도 떠 있는 줄 72 + 12만큼 아래 여백 (P2만 켠다, §14 N13) */
  listBottomSpace?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [sosOpen, setSosOpen] = useState(false);
  const leave = useContext(LeaveContext);
  // 실제 여행의 계획 대화는 어느 단계(코스안 포함)에서든 머리 뒤로가 "‹ 날짜" (TASK-010 §12·§13 답 2). 단계 사이 뒤로는 화면의 단추가 맡는다
  return (
    <View style={styles.root}>
      <Header title={title} subtitle={subtitle} onBack={leave ?? onBack} backLabel={leave ? '날짜' : backLabel} backDisabled={backDisabled} onSos={() => setSosOpen(true)} />
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.body}
          contentContainerStyle={listBottomSpace ? [styles.content, { paddingBottom: Math.max(layout.actionBar + insets.bottom, layout.floatingBar + space['space-3']) }] : styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer ? <FloatingBar>{footer}</FloatingBar> : null}
        {action ? <ActionArea>{action}</ActionArea> : null}
        {input ? <InputBar onSend={input.onSend} disabled={input.disabled} disabledHint={input.hint} /> : null}
      </KeyboardAvoidingView>
      {sosOpen ? <SosSheet onClose={() => setSosOpen(false)} /> : null}
    </View>
  );
}

function ActionArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.action, { paddingBottom: insets.bottom + space['space-2'] }]}>{children}</View>;
}

const styles = StyleSheet.create({
  action: { backgroundColor: color.surface, paddingHorizontal: layout.screenMargin, paddingTop: space['space-2'], gap: space['space-2'] },
  root: { flex: 1, backgroundColor: color.surface },
  body: { flex: 1 },
  content: { padding: layout.screenMargin, gap: space['space-4'], flexGrow: 1 },
});
