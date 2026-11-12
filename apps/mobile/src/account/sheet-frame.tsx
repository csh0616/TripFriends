// TASK-012 2단계 시트 공통 틀 (리뷰 파일 §3 = ①-13 확인 시트와 같은 틀 = DESIGN-001 §4-11 sheet-confirm):
// 스크림 + 위쪽 모서리 28 흰 시트 + 손잡이. 높이는 내용만큼. 스크림을 눌렀을 때는 scrimLabel 이름의 버튼 (없으면 누를 수 없는 막).
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout } from '@/planning/layout';
import { color, fit, radius, shadow, space } from '@/planning/theme';

const SHEET = fit['sheet-confirm'];

export function SheetFrame({
  testID,
  scrimTestID,
  scrimLabel,
  onScrim,
  children,
}: {
  testID: string;
  scrimTestID: string;
  /** 스크림을 눌렀을 때의 뜻 (접근성 이름). onScrim과 함께 */
  scrimLabel?: string;
  onScrim?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.overlay}>
      {onScrim ? (
        <Pressable testID={scrimTestID} accessibilityRole="button" accessibilityLabel={scrimLabel} onPress={onScrim} style={styles.scrim} />
      ) : (
        <View testID={scrimTestID} style={styles.scrim} />
      )}
      <View testID={testID} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SHEET.bottom) }]}>
        <View style={styles.handle} />
        {children}
      </View>
    </View>
  );
}

/** 시트 안 글 묶음 간격 */
export const sheetStyles = StyleSheet.create({
  buttons: { marginTop: SHEET.buttonTop, gap: SHEET.gap },
  note: { marginTop: SHEET.note.top },
});

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
    marginBottom: space['space-3'],
  },
});
