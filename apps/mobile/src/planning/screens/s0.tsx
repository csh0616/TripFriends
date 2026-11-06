// S0 시작 (TASK-004 §B-2, §12 Q4·Q19·Q34). SOS만 있고 입력창은 없다.
import { useId } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Notice } from '@/components/planning/notice';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';

import { layout } from '../layout';
import { color, radius, space, text } from '../theme';
import type { NoticeData } from './types';

// 로고 타일: 주황 그라데이션(sunset 토큰) 위에 "동그라미 친 한 컷"을 뜻하는 고리 하나
function LogoTile() {
  const id = `logo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const size = layout.logoTile;
  return (
    <View style={styles.logo}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color['sunset-start']} />
            <Stop offset="1" stopColor={color['sunset-end']} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
        <Circle cx={size / 2} cy={size / 2} r={size / 4} fill="none" stroke={color['on-brand']} strokeWidth={layout.routeLine} />
      </Svg>
    </View>
  );
}

export function S0Screen({
  busy,
  notice,
  onStart,
}: {
  busy: boolean;
  notice: NoticeData | null;
  onStart: () => void;
}) {
  return (
    <ScreenFrame>
      <View style={styles.center}>
        <LogoTile />
        <Text style={text('title')}>Tripfriends</Text>
        <Text style={text('body', 'muted')}>AI 여행친구</Text>
      </View>
      <View style={styles.action}>
        <PrimaryButton label="데모 여행 시작" disabled={busy} onPress={() => !busy && onStart()} />
        {busy ? <ActivityIndicator color={color.muted} /> : null}
        {notice ? <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} retryDisabled={busy} /> : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space['space-3'], minHeight: layout.photo },
  logo: { width: layout.logoTile, height: layout.logoTile, borderRadius: radius['r-xl'], overflow: 'hidden' },
  action: { gap: space['space-4'] },
});
