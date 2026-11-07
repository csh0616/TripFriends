// TASK-004 §B-3, §B-6 G5: danger 색은 이 부품에서만 쓴다. 모든 화면 같은 자리(머리 오른쪽), 44 원.
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/app-text';
import { color, control, radius, text } from '@/planning/theme';

export function SosButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable testID="sos-button" accessibilityRole="button" accessibilityLabel="SOS" onPress={onPress} style={styles.button}>
      <Text style={text('label', 'surface')}>SOS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: control.sos,
    height: control.sos,
    borderRadius: radius['r-full'],
    backgroundColor: color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
