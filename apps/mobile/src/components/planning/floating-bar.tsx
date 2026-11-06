// TASK-004 §B-3: 떠 있는 줄. 입력창 바로 위, 모서리 24, 그림자 float, 높이 72.
import { StyleSheet, View } from 'react-native';

import { layout } from '@/planning/layout';
import { color, radius, shadow, space } from '@/planning/theme';

export function FloatingBar({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.outer}>
      <View style={styles.bar}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: layout.screenMargin, paddingBottom: space['space-2'], backgroundColor: color.surface },
  bar: {
    minHeight: layout.floatingBar,
    borderRadius: radius['r-xl'],
    backgroundColor: color.surface,
    paddingHorizontal: space['space-3'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['space-2'],
    ...shadow.float,
  },
});
