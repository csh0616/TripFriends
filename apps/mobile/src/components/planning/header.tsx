// TASK-004 §B-3: 머리. 높이 52, 왼쪽 뒤로(44 원, 있을 때만), 가운데 제목+부제, 오른쪽 SOS 고정. 안전 영역 아래.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

import { BackIcon } from './icons';
import { SosButton } from './sos-button';

export function Header({
  title,
  subtitle,
  onBack,
  backDisabled,
  onSos,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  backDisabled?: boolean;
  onSos: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable
              testID="header-back"
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              disabled={backDisabled}
              onPress={onBack}
              style={styles.back}
            >
              <BackIcon color={backDisabled ? color.muted : color.ink} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.center}>
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
        <View style={[styles.side, styles.right]}>
          <SosButton onPress={onSos} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: color.surface },
  row: {
    height: layout.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenMargin,
  },
  side: { flex: 1, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  center: { flex: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space['space-2'] },
  centerText: { ...text('heading'), textAlign: 'center' },
  subtitle: { ...text('caption', 'muted'), textAlign: 'center' },
  back: {
    width: control['touch-min'],
    height: control['touch-min'],
    borderRadius: radius['r-full'],
    backgroundColor: color['bg-2'],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
