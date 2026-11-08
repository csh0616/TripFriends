// TASK-011 C1 새 여행 확인 시트 (sheet-confirm, DESIGN-001 §4-11): iOS 기본 확인 창 대신. 빨강 안 씀.
// 글 "지금 여행은 보관돼. 새로 만들까?" + 한 줄 + [새로 만들기](주 버튼, 주황) / [그대로 둘게](보조). 바깥 어두운 곳 = [그대로 둘게].
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { color, fit, fitText, radius, shadow, space } from '@/planning/theme';
import { layout } from '@/planning/layout';

const SHEET = fit['sheet-confirm'];

export function NewTripSheet({ onConfirm, onKeep }: { onConfirm: () => void; onKeep: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.overlay}>
      {/* 바깥을 누르면 [그대로 둘게]와 같다 */}
      <Pressable testID="new-trip-sheet-scrim" accessibilityLabel="그대로 둘게" accessibilityRole="button" onPress={onKeep} style={styles.scrim} />
      <View testID="new-trip-sheet" style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SHEET.bottom) }]}>
        <View style={styles.handle} />
        <Text style={fitText(SHEET)}>지금 여행은 보관돼. 새로 만들까?</Text>
        <Text style={[fitText(SHEET.note), styles.note]}>보관한 여행은 지금은 다시 열 수 없어</Text>
        <View style={styles.buttons}>
          <PrimaryButton testID="new-trip-confirm" label="새로 만들기" onPress={onConfirm} />
          <SecondaryButton testID="new-trip-keep" label="그대로 둘게" onPress={onKeep} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: SHEET.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: SHEET.radius,
    borderTopRightRadius: SHEET.radius,
    paddingHorizontal: layout.screenMargin,
    alignItems: 'stretch',
    ...shadow.sheet,
  },
  handle: {
    alignSelf: 'center',
    width: SHEET.handle[0],
    height: SHEET.handle[1],
    borderRadius: radius['r-full'],
    backgroundColor: color.line,
    marginTop: space['space-2'],
    marginBottom: space['space-4'],
  },
  note: { marginTop: SHEET.note.top },
  buttons: { marginTop: SHEET.buttonTop, gap: SHEET.gap },
});
