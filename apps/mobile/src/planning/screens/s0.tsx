// S0 시작 (TASK-004 §B-2, §12 Q4·Q19·Q34). SOS만 있고 입력창은 없다.
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { Notice } from '@/components/planning/notice';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';

import { layout } from '../layout';
import { color, space, text } from '../theme';
import type { NoticeData } from './types';

export function S0Screen({
  busy,
  notice,
  onStart,
  onStartNow,
}: {
  busy: boolean;
  notice: NoticeData | null;
  onStart: () => void;
  /** 개발 빌드에서만 넘어온다 (TASK-006 §14) */
  onStartNow?: () => void;
}) {
  return (
    <ScreenFrame>
      <View style={styles.center}>
        <Image
          testID="s0-logo"
          accessibilityLabel="Tripfriends"
          source={require('../../../assets/brand/logo-ink.png')}
          resizeMode="contain"
          style={styles.logo}
        />
        {/* 미정(§13): 확정 로고에 "Tripfriends" 글자가 이미 있어서 같은 글자는 지운다. "AI 여행친구"는 남긴다 */}
        <Text style={text('body', 'muted')}>AI 여행친구</Text>
      </View>
      <View style={styles.action}>
        <PrimaryButton label="데모 여행 시작" disabled={busy} onPress={() => !busy && onStart()} />
        {onStartNow ? (
          <SecondaryButton testID="s0-now-demo" label="여행 중 데모 바로 보기" disabled={busy} onPress={() => !busy && onStartNow()} />
        ) : null}
        {busy ? <ActivityIndicator color={color.muted} /> : null}
        {notice ? <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} retryDisabled={busy} /> : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space['space-3'], minHeight: layout.photo },
  logo: { width: layout.logoWidth, height: layout.logoHeight },
  action: { gap: space['space-4'] },
});
