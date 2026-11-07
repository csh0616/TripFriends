// 보조 버튼: bg-2 바탕 + ink 글자. small이면 높이 btn-sm.
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/app-text';
import { color, control, radius, space, text } from '@/planning/theme';

export function SecondaryButton({
  label,
  onPress,
  disabled,
  testID,
  small,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  small?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, small && styles.small, disabled && styles.disabled]}
    >
      <Text style={text(small ? 'caption' : 'heading', disabled ? 'muted' : 'ink')}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: control.btn,
    minWidth: control['touch-min'],
    paddingHorizontal: space['space-5'],
    borderRadius: radius['r-md'],
    backgroundColor: color['bg-2'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minHeight: control['btn-sm'], paddingHorizontal: space['space-4'] },
  disabled: { backgroundColor: color['bg-2'] },
});
