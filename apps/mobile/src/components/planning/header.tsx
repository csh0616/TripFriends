// TASK-004 §B-3: 머리. 높이 52, 왼쪽 뒤로(44 원, 있을 때만), 가운데 제목+부제, 오른쪽 SOS 고정. 안전 영역 아래.
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { layout } from '@/planning/layout';
import { color, control, fit, fitText, radius, space, text } from '@/planning/theme';

import { BackIcon } from './icons';
import { SosButton } from './sos-button';

export function Header({
  title,
  subtitle,
  onBack,
  backLabel,
  backDisabled,
  left,
  onSos,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** 있으면 "‹ 글자" 뒤로 (back-day: 투명 바탕, 아이콘 + 글자. TASK-011) */
  backLabel?: string;
  backDisabled?: boolean;
  /** 뒤로가 없는 머리의 왼쪽 자리 (날짜 목록의 내 프로필 아바타, TASK-012 C5) */
  left?: React.ReactNode;
  onSos: () => void;
}) {
  const insets = useSafeAreaInsets();
  const day = fit['back-day'];
  const sideStyle = backLabel ? { width: day.side } : styles.side; // back-day 화면의 머리 칸 [84 | 1fr | 84]
  const ink = backDisabled ? day.disabledFg : day.fg;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={sideStyle}>
          {onBack ? (
            backLabel ? (
              <Pressable
                testID="header-back"
                accessibilityRole="button"
                accessibilityLabel="뒤로"
                disabled={backDisabled}
                onPress={onBack}
                style={[styles.backDay, { backgroundColor: backDisabled ? day.disabledBg : day.bg }]}
              >
                <BackIcon color={ink} size={day.icon} />
                <Text style={fitText({ size: day.size, lineHeight: day.lineHeight, weight: day.weight, fg: ink })}>{backLabel}</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="header-back"
                accessibilityRole="button"
                accessibilityLabel="뒤로"
                disabled={backDisabled}
                onPress={onBack}
                style={[styles.back, backDisabled && styles.backOff]}
              >
                <BackIcon color={backDisabled ? color.muted : color.ink} />
              </Pressable>
            )
          ) : (
            left ?? null
          )}
        </View>
        <View style={backLabel ? styles.centerFlex : styles.center}>
          {title ? (
            <Text numberOfLines={1} style={styles.centerText}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[sideStyle, styles.right]}>
          <SosButton onPress={onSos} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: color.surface },
  row: {
    minHeight: layout.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenMargin,
  },
  side: { flex: 1, justifyContent: 'center' },
  right: { alignItems: 'flex-end', justifyContent: 'center' },
  center: { flex: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space['space-2'] },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space['space-2'] },
  centerText: { ...text('heading'), textAlign: 'center' },
  subtitle: { ...text('caption', 'muted'), textAlign: 'center' },
  back: {
    width: control['touch-min'],
    height: control['touch-min'],
    borderRadius: radius['r-full'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // back-day: 투명 · 높이 44 · 안쪽 6/12 · 아이콘 20 + 글자. 왼쪽 끝은 머리 칸에 맞춘다
  backDay: {
    height: fit['back-day'].height,
    paddingVertical: fit['back-day'].paddingVertical,
    paddingHorizontal: fit['back-day'].paddingHorizontal,
    borderRadius: radius['r-full'],
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-1'],
  },
  backOff: { backgroundColor: color['bg-2'] }, // 요청 중 비활성 규칙 (TASK-005 §9 Q19)
});
