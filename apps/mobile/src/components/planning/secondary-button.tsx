// 보조 버튼: bg-2 바탕 + ink 글자. small이면 높이 btn-sm.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/app-text';
import { color, control, radius, space, text } from '@/planning/theme';

export function SecondaryButton({
  label,
  onPress,
  disabled,
  testID,
  small,
  icon,
}: {
  label: string;
  /** TASK-015 §33 하-18: 글 앞 아이콘 (색을 받아 그린다). [열었어][닫혔어] */
  icon?: (tint: string) => ReactNode;
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
      style={[styles.button, icon !== undefined && styles.withIcon, small && styles.small, disabled && styles.disabled]}
    >
      {icon ? icon(disabled ? color.muted : color.ink) : null}
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
  withIcon: { flexDirection: 'row', gap: space['space-2'] },
  small: { minHeight: control['btn-sm'], paddingHorizontal: space['space-4'] },
  disabled: { backgroundColor: color['bg-2'] },
});
