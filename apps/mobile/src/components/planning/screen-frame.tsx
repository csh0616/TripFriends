// 모든 계획 화면의 틀 (TASK-004 §B-3 가드레일): 머리(SOS 고정) / 스크롤 본문 / 아래 고정(떠 있는 줄 + 입력창).
// SOS와 입력창은 스크롤 밖에 있어서 화면이 움직여도 같은 자리에 있다. 입력창이 없는 화면(S0·S9)은 input을 비운다.
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { layout } from '@/planning/layout';
import { color, space } from '@/planning/theme';

import { FloatingBar } from './floating-bar';
import { Header } from './header';
import { InputBar } from './input-bar';
import { SosSheet } from './sos-sheet';

export type FrameInput = { onSend: (value: string) => void; disabled?: boolean; hint?: string };

export function ScreenFrame({
  title,
  subtitle,
  onBack,
  backDisabled,
  input,
  footer,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  backDisabled?: boolean;
  input?: FrameInput;
  footer?: React.ReactNode;
  /** TASK-010: 스크롤 밖 맨 아래에 고정되는 주 버튼 자리 (입력창이 없는 화면) */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sosOpen, setSosOpen] = useState(false);
  return (
    <View style={styles.root}>
      <Header title={title} subtitle={subtitle} onBack={onBack} backDisabled={backDisabled} onSos={() => setSosOpen(true)} />
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.content}
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
