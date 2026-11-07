// TASK-004 §B-3, §B-6 G7: 주 버튼 = brand 바탕 + on-brand 글자 (흰 글자 금지).
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/app-text';
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
      <Text style={text('heading', disabled ? 'muted' : 'on-brand')}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: control.btn,
    minWidth: control['touch-min'],
    paddingHorizontal: space['space-5'],
    borderRadius: radius['r-md'],
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 비활성은 opacity가 아니라 bg-2 바탕 + muted 글자 (TASK-004 §13-3)
  disabled: { backgroundColor: color['bg-2'] },
});
