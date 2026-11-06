// TASK-004 §B-3, §B-6 G7: 주 버튼 = brand 바탕 + on-brand 글자 (흰 글자 금지).
import { Pressable, StyleSheet, Text } from 'react-native';

import { color, control, radius, space, text } from '@/planning/theme';

export function PrimaryButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={text('heading', 'on-brand')}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: control.btn,
    minWidth: control['touch-min'],
    paddingHorizontal: space['space-5'],
    borderRadius: radius['r-md'],
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
});
